<?php
declare(strict_types=1);

namespace ResourceVisualizations\Precompute\Aggregators;

/**
 * Publication-specific aggregations: top literal venues and the
 * top-authors union of linked persons and literal names.
 *
 * Composed into {@see \ResourceVisualizations\Precompute\Aggregators}; its methods
 * reach shared constants and helpers on that class through `self::`.
 */
trait PublicationChartsTrait
{
    /**
     * Top literal values of a property across items (e.g. dcterms:isPartOf
     * venue names). Feeds buildBarChart.
     *
     * @return list<array{name:string,value:int}>|null
     */
    public static function buildTopLiteral(array $itemIds, array $literals, string $term, int $topN = 20): ?array
    {
        $counts = [];
        foreach ($itemIds as $iid) {
            foreach ($literals[$iid][$term] ?? [] as $val) {
                $val = trim((string) $val);
                if ($val === '') {
                    continue;
                }
                $counts[$val] = ($counts[$val] ?? 0) + 1;
            }
        }
        if (!$counts) {
            return null;
        }
        $out = [];
        foreach ($counts as $name => $c) {
            $out[] = ['name' => (string) $name, 'value' => $c];
        }
        return array_slice(self::sortByValueDesc($out), 0, $topN);
    }

    /**
     * Top authors across publications, unioning literal bibo:authorList names
     * with Person-linked authors (resolved to their titles). Each row carries a
     * `matched` flag (true = a linked Person entity) and, when matched, an
     * itemId. Feeds buildBarChart.
     *
     * @return list<array{name:string,value:int,matched:bool,itemId?:int}>|null
     */
    public static function buildTopAuthors(array $itemIds, array $links, array $literals, array $items, int $topN = 20): ?array
    {
        $counts = [];
        $matched = [];
        $itemIdOf = [];
        foreach ($itemIds as $iid) {
            $seen = [];
            foreach ($links[$iid] ?? [] as [$term, $label, $vrid]) {
                if ($term !== 'bibo:authorList') {
                    continue;
                }
                $title = trim((string) ($items[$vrid]['title'] ?? ''));
                if ($title === '' || isset($seen[$title])) {
                    continue;
                }
                $seen[$title] = true;
                $counts[$title] = ($counts[$title] ?? 0) + 1;
                $matched[$title] = true;
                $itemIdOf[$title] = $vrid;
            }
            foreach ($literals[$iid]['bibo:authorList'] ?? [] as $name) {
                $name = trim((string) $name);
                if ($name === '' || isset($seen[$name])) {
                    continue;
                }
                $seen[$name] = true;
                $counts[$name] = ($counts[$name] ?? 0) + 1;
                $matched[$name] ??= false;
            }
        }
        if (!$counts) {
            return null;
        }
        $out = [];
        foreach ($counts as $name => $c) {
            $name = (string) $name;
            $row = ['name' => $name, 'value' => $c, 'matched' => $matched[$name] ?? false];
            if (!empty($matched[$name]) && isset($itemIdOf[$name])) {
                $row['itemId'] = $itemIdOf[$name];
            }
            $out[] = $row;
        }
        return array_slice(self::sortByValueDesc($out), 0, $topN);
    }
}
