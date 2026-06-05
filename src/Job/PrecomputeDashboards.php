<?php
declare(strict_types=1);

namespace ResourceVisualizations\Job;

use Omeka\Job\AbstractJob;
use ResourceVisualizations\Precompute\Runner;
use Throwable;

/**
 * Background job: regenerate all precomputed dashboard data.
 *
 * Dispatched from the admin "Regenerate" button (MaintenanceController). Runs
 * the pure-PHP {@see Runner} against Omeka's own DBAL connection — no Python,
 * no separate MySQL credentials — and writes the JSON artefacts the front-end
 * charts load. Long-running on a large corpus; progress is visible at
 * /admin/job/{id}/log. Throwing marks the job ERROR.
 */
class PrecomputeDashboards extends AbstractJob
{
    public function perform(): void
    {
        $services = $this->getServiceLocator();
        $logger = $services->get('Omeka\Logger');
        $connection = $services->get('Omeka\Connection');

        // src/Job/PrecomputeDashboards.php → module root is two levels up.
        $moduleRoot = dirname(__DIR__, 2);
        $dataDir = $moduleRoot . '/asset/data';

        $logger->info('ResourceVisualizations: starting dashboard precompute', [
            'job_id' => $this->job->getId(),
        ]);

        try {
            $runner = new Runner(
                $connection,
                $dataDir . '/item-dashboards',
                $dataDir . '/communities',
                $dataDir . '/geo/countries.geojson',
                $dataDir . '/knowledge-graphs',
                $dataDir . '/photo-galleries',
                $dataDir . '/featured-collections',
                static fn (string $message) => $logger->info($message)
            );
            $stats = $runner->run();
        } catch (Throwable $e) {
            $logger->err('ResourceVisualizations: precompute failed: ' . $e->getMessage());
            // Re-throw so AbstractJob marks the job as ERROR.
            throw $e;
        }

        $logger->info('ResourceVisualizations: precompute complete', $stats);
    }
}
