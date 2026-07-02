<?php
declare(strict_types=1);

namespace DreVisualizations\Precompute;

use RuntimeException;

/**
 * Writes precomputed JSON artifacts with one encoding policy and a best-effort
 * atomic replace. Temp files live beside their targets so the final rename stays
 * on the same filesystem.
 */
final class JsonArtifactWriter
{
    private const JSON_FLAGS = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES;

    public function ensureDirectory(string $dir): void
    {
        if (is_dir($dir)) {
            return;
        }
        if (!mkdir($dir, 0775, true) && !is_dir($dir)) {
            throw new RuntimeException(sprintf('Unable to create directory "%s".', $dir));
        }
    }

    public function write(string $path, array $payload): void
    {
        $dir = dirname($path);
        $this->ensureDirectory($dir);

        $json = json_encode($payload, self::JSON_FLAGS);
        if ($json === false) {
            throw new RuntimeException(sprintf(
                'Unable to encode JSON artifact "%s": %s',
                $path,
                json_last_error_msg()
            ));
        }

        $tmp = $this->temporaryPath($path);
        if (file_put_contents($tmp, $json, LOCK_EX) === false) {
            throw new RuntimeException(sprintf('Unable to write temporary JSON artifact "%s".', $tmp));
        }

        $this->replace($tmp, $path);
    }

    private function temporaryPath(string $path): string
    {
        return sprintf(
            '%s.tmp.%s.%s',
            $path,
            getmypid() ?: 'process',
            str_replace('.', '', uniqid('', true))
        );
    }

    private function replace(string $tmp, string $path): void
    {
        if (@rename($tmp, $path)) {
            return;
        }

        // Windows cannot reliably rename over an existing file. Production Omeka
        // is Linux, but this keeps local regeneration usable from the shared repo.
        if (PHP_OS_FAMILY === 'Windows' && is_file($path)) {
            @unlink($path);
            if (@rename($tmp, $path)) {
                return;
            }
        }

        @unlink($tmp);
        throw new RuntimeException(sprintf('Unable to replace JSON artifact "%s".', $path));
    }
}
