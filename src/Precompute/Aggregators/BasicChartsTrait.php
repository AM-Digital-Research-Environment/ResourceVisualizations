<?php
declare(strict_types=1);

namespace ResourceVisualizations\Precompute\Aggregators;

/**
 * Core per-item distributions: the primary aggregateItems pass, the
 * resource-type × language heatmap, contributor roles, and the
 * resource-template breakdown.
 *
 * Composed into {@see \ResourceVisualizations\Precompute\Aggregators}; its methods
 * reach shared constants and helpers on that class through `self::`.
 */
trait BasicChartsTrait
{
    /**
     * Aggregate dashboard data from a list of item IDs.
     *
     * `$syntheticTypes` maps an item id to a single resource-type label that
     * REPLACES that item's own dcterms:type in the resource-type pie (e.g. every
     * publication shown as one "Publication" category, whatever its bibliographic
     * type), so the item is counted once. Items without a synthetic label keep
     * their real linked type(s). Pass `[]` to disable.
     *
     * @param array<int,string> $syntheticTypes
     */
    public static function aggregateItems(array $itemIds, array $items, array $links, array $itemYear, array $geo, array $syntheticTypes = []): array
    {
        $timeline = [];
        $types = [];
        $languages = [];
        $subjects = [];
        $contributors = [];
        $locations = [];
        $currentLocations = [];

        foreach ($itemIds as $iid) {
            $year = $itemYear[$iid] ?? null;
            if ($year) {
                $timeline[$year] = ($timeline[$year] ?? 0) + 1;
            }
            // A synthetic type stands in for (and overrides) the item's own
            // dcterms:type, so the item is counted once under that single label.
            $synType = $syntheticTypes[$iid] ?? null;
            $hasSyn = $synType !== null && $synType !== '';
            foreach ($links[$iid] ?? [] as [$term, $label, $vrid]) {
                $title = $items[$vrid]['title'] ?? '';
                if ($title === '') {
                    continue;
                }
                if ($term === 'dcterms:type') {
                    if (!$hasSyn) {
                        $types[$vrid] ??= ['name' => $title, 'value' => 0, 'itemId' => $vrid];
                        $types[$vrid]['value']++;
                    }
                } elseif ($term === 'dcterms:language') {
                    $languages[$vrid] ??= ['name' => $title, 'value' => 0, 'itemId' => $vrid];
                    $languages[$vrid]['value']++;
                } elseif ($term === 'dcterms:subject') {
                    $subjects[$vrid] ??= ['name' => $title, 'value' => 0, 'itemId' => $vrid];
                    $subjects[$vrid]['value']++;
                } elseif ($term === 'dcterms:creator' || $term === 'dcterms:contributor' || str_starts_with($term, 'marcrel:')) {
                    $contributors[$vrid] ??= ['name' => $title, 'value' => 0, 'itemId' => $vrid];
                    $contributors[$vrid]['value']++;
                } elseif ($term === 'dcterms:spatial') {
                    if (isset($geo[$vrid])) {
                        if (!isset($locations[$vrid])) {
                            $g = $geo[$vrid];
                            $locations[$vrid] = [
                                'name' => $g['name'], 'lat' => $g['lat'], 'lon' => $g['lon'],
                                'itemId' => $g['itemId'], 'value' => 0, 'items' => [],
                            ];
                        }
                        $locations[$vrid]['value']++;
                        $itTitle = $items[$iid]['title'] ?? ('Item ' . $iid);
                        $locations[$vrid]['items'][] = ['id' => $iid, 'title' => $itTitle];
                    }
                } elseif ($term === 'dcterms:provenance') {
                    // Current location (where the item is held now). Resolved via
                    // $geo, which is template-agnostic, so an Institution used as a
                    // Current Location is geocoded just like a Location item.
                    if (isset($geo[$vrid])) {
                        if (!isset($currentLocations[$vrid])) {
                            $g = $geo[$vrid];
                            $currentLocations[$vrid] = [
                                'name' => $g['name'], 'lat' => $g['lat'], 'lon' => $g['lon'],
                                'itemId' => $g['itemId'], 'value' => 0, 'items' => [],
                            ];
                        }
                        $currentLocations[$vrid]['value']++;
                        $itTitle = $items[$iid]['title'] ?? ('Item ' . $iid);
                        $currentLocations[$vrid]['items'][] = ['id' => $iid, 'title' => $itTitle];
                    }
                }
            }
            // Synthetic resource type (e.g. publications → "Publication"). Keyed by
            // label, no itemId — the pie slice is informational, not click-through.
            if ($hasSyn) {
                $synKey = 'syn:' . $synType;
                $types[$synKey] ??= ['name' => $synType, 'value' => 0];
                $types[$synKey]['value']++;
            }
        }

        ksort($timeline);
        $subjectsSorted = self::sortByValueDesc(array_values($subjects));
        $contributorsSorted = self::sortByValueDesc(array_values($contributors));

        return [
            'timeline' => $timeline ?: (object) [],
            'types' => self::sortByValueDesc(array_values($types)),
            'languages' => self::sortByValueDesc(array_values($languages)),
            'subjects' => array_slice($subjectsSorted, 0, 200),
            'contributors' => array_slice($contributorsSorted, 0, 30),
            'locations' => self::sortByValueDesc(array_values($locations)),
            'currentLocations' => self::sortByValueDesc(array_values($currentLocations)),
            'totalItems' => count($itemIds),
        ];
    }

    /**
     * Build resource type × language heatmap data.
     *
     * Both axes are derived from the populated cells only, so a resource type
     * that never co-occurs with a language at all (and, symmetrically, a
     * language that never co-occurs with a type) is dropped rather than drawn
     * as an all-zero row/column.
     */
    public static function buildHeatmap(array $itemIds, array $links, array $items): ?array
    {
        $cross = [];

        foreach ($itemIds as $iid) {
            $itemTypes = [];
            $itemLangs = [];
            foreach ($links[$iid] ?? [] as [$term, $label, $vrid]) {
                $title = $items[$vrid]['title'] ?? '';
                if ($title === '') {
                    continue;
                }
                if ($term === 'dcterms:type') {
                    $itemTypes[] = $title;
                } elseif ($term === 'dcterms:language') {
                    $itemLangs[] = $title;
                }
            }
            foreach ($itemTypes as $t) {
                foreach ($itemLangs as $l) {
                    $cross[$t . "\0" . $l] = ($cross[$t . "\0" . $l] ?? 0) + 1;
                }
            }
        }

        if (!$cross) {
            return null;
        }

        // Axes come from the cross-tab itself: a type/language with no populated
        // cell leaves no key here and so never becomes an empty row/column.
        $rowSet = [];
        $colSet = [];
        foreach ($cross as $key => $v) {
            [$r, $c] = explode("\0", $key);
            $rowSet[$r] = true;
            $colSet[$c] = true;
        }
        $rows = array_keys($rowSet);
        sort($rows);
        $cols = array_keys($colSet);
        sort($cols);
        $rowIdx = array_flip($rows);
        $colIdx = array_flip($cols);

        $values = [];
        foreach ($cross as $key => $v) {
            [$r, $c] = explode("\0", $key);
            $values[] = [$colIdx[$c], $rowIdx[$r], $v];
        }
        return ['rows' => $rows, 'cols' => $cols, 'values' => $values];
    }

    /** Build contributor role distribution across all contributors of the items. */
    public static function buildRoles(array $itemIds, array $links, array $items): ?array
    {
        $roleCounts = [];
        foreach ($itemIds as $iid) {
            foreach ($links[$iid] ?? [] as [$term, $label, $vrid]) {
                if (str_starts_with($term, 'marcrel:') || $term === 'dcterms:creator' || $term === 'dcterms:contributor') {
                    $roleCounts[$label] = ($roleCounts[$label] ?? 0) + 1;
                }
            }
        }
        if (!$roleCounts) {
            return null;
        }
        $rows = [];
        foreach ($roleCounts as $name => $count) {
            $rows[] = ['name' => $name, 'value' => $count];
        }
        return self::sortByValueDesc($rows);
    }

    /** Build the role distribution for one specific entity (e.g. a person). */
    public static function buildRolesFor(int $entityId, array $itemIds, array $links): ?array
    {
        $roleCounts = [];
        foreach ($itemIds as $iid) {
            foreach ($links[$iid] ?? [] as [$term, $label, $vrid]) {
                if ($vrid !== $entityId) {
                    continue;
                }
                if (str_starts_with($term, 'marcrel:') || $term === 'dcterms:creator' || $term === 'dcterms:contributor') {
                    $roleCounts[$label] = ($roleCounts[$label] ?? 0) + 1;
                }
            }
        }
        if (!$roleCounts) {
            return null;
        }
        $rows = [];
        foreach ($roleCounts as $name => $count) {
            $rows[] = ['name' => $name, 'value' => $count];
        }
        return self::sortByValueDesc($rows);
    }

    /**
     * Distribution of items by resource template (Article, Book, …). Returns
     * null when fewer than two distinct templates are present, so it auto-hides
     * on single-template entities (e.g. one whose items are all Research Items).
     * Feeds buildPieChart.
     *
     * @return list<array{name:string,value:int}>|null
     */
    public static function buildTemplates(array $itemIds, array $items, array $templateLabels): ?array
    {
        $counts = [];
        foreach ($itemIds as $iid) {
            $tid = $items[$iid]['template_id'] ?? null;
            if ($tid === null) {
                continue;
            }
            $counts[$tid] = ($counts[$tid] ?? 0) + 1;
        }
        if (count($counts) < 2) {
            return null;
        }
        $out = [];
        foreach ($counts as $tid => $c) {
            $out[] = ['name' => $templateLabels[$tid] ?? ('Template ' . $tid), 'value' => $c];
        }
        return self::sortByValueDesc($out);
    }
}
