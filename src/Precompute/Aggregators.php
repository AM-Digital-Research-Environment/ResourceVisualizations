<?php
declare(strict_types=1);

namespace ResourceVisualizations\Precompute;

/**
 * Pure aggregation + chart-data builders — a faithful PHP port of
 * scripts/precompute/aggregators.py.
 *
 * Every method is static and operates on plain arrays (no Omeka or DB
 * dependencies), so the logic can be unit-tested in isolation. The in-memory
 * shapes mirror the Python:
 *   - items:        [id => ['title'=>, 'template_id'=>, 'class_term'=>, 'class_label'=>]]
 *   - links:        [id => [[term, label, valueResourceId], ...]]
 *   - reverseLinks: [valueResourceId => [term => [ids]]]
 *   - childrenOf:   [parentId => [childIds]]
 *   - itemYear:     [id => 'YYYY']
 *   - temporal:     [id => [start, end]]
 *   - geo:          [id => ['name'=>, 'lat'=>, 'lon'=>, 'itemId'=>]]
 *
 * Builders return null when there is no data (mirroring the Python `None`),
 * so callers can skip empty keys exactly as the JS orchestrator expects.
 */
final class Aggregators
{
    public const TEMPLATE_PERSONS = 4;
    public const TEMPLATE_PROJECTS = 5;

    /** Find item IDs that link to $entityId via any of the given terms. */
    public static function findItemsLinkingTo(int $entityId, array $reverseLinks, array $terms): array
    {
        $result = [];
        $rev = $reverseLinks[$entityId] ?? [];
        foreach ($terms as $term) {
            foreach ($rev[$term] ?? [] as $id) {
                $result[$id] = true;
            }
        }
        return array_keys($result);
    }

    /** Sort a list of {name,value,...} rows by value descending (stable-ish). */
    private static function sortByValueDesc(array $rows): array
    {
        usort($rows, static fn ($a, $b) => $b['value'] <=> $a['value']);
        return $rows;
    }

    /** Aggregate dashboard data from a list of item IDs. */
    public static function aggregateItems(array $itemIds, array $items, array $links, array $itemYear, array $geo): array
    {
        $timeline = [];
        $types = [];
        $languages = [];
        $subjects = [];
        $contributors = [];
        $locations = [];

        foreach ($itemIds as $iid) {
            $year = $itemYear[$iid] ?? null;
            if ($year) {
                $timeline[$year] = ($timeline[$year] ?? 0) + 1;
            }
            foreach ($links[$iid] ?? [] as [$term, $label, $vrid]) {
                $title = $items[$vrid]['title'] ?? '';
                if ($title === '') {
                    continue;
                }
                if ($term === 'dcterms:type') {
                    $types[$vrid] ??= ['name' => $title, 'value' => 0, 'itemId' => $vrid];
                    $types[$vrid]['value']++;
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
                }
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
            'totalItems' => count($itemIds),
        ];
    }

    /** Build resource type x language heatmap data. */
    public static function buildHeatmap(array $itemIds, array $links, array $items): ?array
    {
        $cross = [];
        $typeSet = [];
        $langSet = [];

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
                    $typeSet[$title] = true;
                } elseif ($term === 'dcterms:language') {
                    $itemLangs[] = $title;
                    $langSet[$title] = true;
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

        $rows = array_keys($typeSet);
        sort($rows);
        $cols = array_keys($langSet);
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

    /** Build a co-occurrence chord diagram for a given property. */
    public static function buildChord(array $itemIds, array $links, array $items, string $termFilter = 'dcterms:subject', int $maxNodes = 20, int $minCooccurrence = 2): ?array
    {
        $itemValues = [];
        $valueTitles = [];
        foreach ($itemIds as $iid) {
            $vals = [];
            foreach ($links[$iid] ?? [] as [$term, $label, $vrid]) {
                if ($term === $termFilter) {
                    $title = $items[$vrid]['title'] ?? '';
                    if ($title !== '') {
                        $vals[] = $vrid;
                        $valueTitles[$vrid] = $title;
                    }
                }
            }
            if (count($vals) >= 2) {
                $itemValues[$iid] = $vals;
            }
        }

        $pairCounts = [];
        $nodeCounts = [];
        foreach ($itemValues as $vals) {
            foreach ($vals as $v) {
                $nodeCounts[$v] = ($nodeCounts[$v] ?? 0) + 1;
            }
            $n = count($vals);
            for ($i = 0; $i < $n; $i++) {
                for ($j = $i + 1; $j < $n; $j++) {
                    $a = $vals[$i];
                    $b = $vals[$j];
                    if ($a > $b) {
                        [$a, $b] = [$b, $a];
                    }
                    $pairCounts[$a . ',' . $b] = ($pairCounts[$a . ',' . $b] ?? 0) + 1;
                }
            }
        }

        arsort($nodeCounts);
        $topNodes = array_slice(array_keys($nodeCounts), 0, $maxNodes);
        $topSet = array_flip($topNodes);

        $chordLinks = [];
        foreach ($pairCounts as $key => $count) {
            [$a, $b] = array_map('intval', explode(',', $key));
            if ($count >= $minCooccurrence && isset($topSet[$a], $topSet[$b])) {
                $chordLinks[] = ['source' => $valueTitles[$a], 'target' => $valueTitles[$b], 'value' => $count];
            }
        }
        if (!$chordLinks) {
            return null;
        }

        $chordNodes = [];
        foreach ($topNodes as $v) {
            if (isset($valueTitles[$v])) {
                $chordNodes[] = ['name' => $valueTitles[$v], 'value' => $nodeCounts[$v], 'itemId' => $v];
            }
        }
        return ['nodes' => $chordNodes, 'links' => $chordLinks];
    }

    /** Build contributor -> project -> resource type Sankey flow. */
    public static function buildSankey(array $itemIds, array $links, array $items): ?array
    {
        $flows = [];
        foreach ($itemIds as $iid) {
            $itemContributors = [];
            $itemProject = null;
            $itemTypes = [];
            foreach ($links[$iid] ?? [] as [$term, $label, $vrid]) {
                $title = $items[$vrid]['title'] ?? '';
                if ($title === '') {
                    continue;
                }
                if (str_starts_with($term, 'marcrel:') || $term === 'dcterms:creator' || $term === 'dcterms:contributor') {
                    $itemContributors[] = $title;
                } elseif ($term === 'dcterms:isPartOf') {
                    $itemProject = $title;
                } elseif ($term === 'dcterms:type') {
                    $itemTypes[] = $title;
                }
            }
            if (!$itemProject || !$itemContributors || !$itemTypes) {
                continue;
            }
            foreach (array_slice($itemContributors, 0, 3) as $c) {
                foreach ($itemTypes as $t) {
                    $k = $c . "\0" . $itemProject . "\0" . $t;
                    $flows[$k] = ($flows[$k] ?? 0) + 1;
                }
            }
        }
        if (!$flows) {
            return null;
        }

        $contribCounts = [];
        foreach ($flows as $k => $v) {
            [$c] = explode("\0", $k);
            $contribCounts[$c] = ($contribCounts[$c] ?? 0) + $v;
        }
        arsort($contribCounts);
        $topContribs = array_flip(array_slice(array_keys($contribCounts), 0, 10));

        $linkMap = [];
        $nodeNames = [];
        foreach ($flows as $k => $v) {
            [$c, $p, $t] = explode("\0", $k);
            if (!isset($topContribs[$c])) {
                continue;
            }
            $nodeNames[$c] = true;
            $nodeNames[$p] = true;
            $nodeNames[$t] = true;
            $linkMap[$c . "\0" . $p] = ($linkMap[$c . "\0" . $p] ?? 0) + $v;
            $linkMap[$p . "\0" . $t] = ($linkMap[$p . "\0" . $t] ?? 0) + $v;
        }

        $nodes = [];
        foreach (array_keys($nodeNames) as $n) {
            $nodes[] = ['name' => $n];
        }
        $dedupedLinks = [];
        foreach ($linkMap as $k => $v) {
            [$s, $t] = explode("\0", $k);
            $dedupedLinks[] = ['source' => $s, 'target' => $t, 'value' => $v];
        }
        return $dedupedLinks ? ['nodes' => $nodes, 'links' => $dedupedLinks] : null;
    }

    /** Build type -> language -> subject sunburst hierarchy. */
    public static function buildSunburst(array $itemIds, array $links, array $items): ?array
    {
        $tree = [];
        foreach ($itemIds as $iid) {
            $itemTypes = [];
            $itemLangs = [];
            $itemSubjects = [];
            foreach ($links[$iid] ?? [] as [$term, $label, $vrid]) {
                $title = $items[$vrid]['title'] ?? '';
                if ($title === '') {
                    continue;
                }
                if ($term === 'dcterms:type') {
                    $itemTypes[] = $title;
                } elseif ($term === 'dcterms:language') {
                    $itemLangs[] = $title;
                } elseif ($term === 'dcterms:subject') {
                    $itemSubjects[] = $title;
                }
            }
            foreach ($itemTypes as $t) {
                foreach ($itemLangs as $l) {
                    $tree[$t][$l] ??= [];
                    if ($itemSubjects) {
                        foreach (array_slice($itemSubjects, 0, 5) as $s) {
                            $tree[$t][$l][$s] = ($tree[$t][$l][$s] ?? 0) + 1;
                        }
                    } else {
                        $tree[$t][$l]['(no subject)'] = ($tree[$t][$l]['(no subject)'] ?? 0) + 1;
                    }
                }
            }
        }
        if (!$tree) {
            return null;
        }

        $result = [];
        foreach ($tree as $typeName => $langs) {
            $typeNode = ['name' => $typeName, 'children' => []];
            foreach ($langs as $langName => $subjects) {
                $langNode = ['name' => $langName, 'children' => []];
                arsort($subjects);
                foreach (array_slice($subjects, 0, 8, true) as $subName => $count) {
                    $langNode['children'][] = ['name' => $subName, 'value' => $count];
                }
                $typeNode['children'][] = $langNode;
            }
            $result[] = $typeNode;
        }
        return $result ?: null;
    }

    /** Build stacked timeline: items by year, stacked by resource type. */
    public static function buildStackedTimeline(array $itemIds, array $links, array $items, array $itemYear): ?array
    {
        $yearType = [];
        $allTypes = [];
        foreach ($itemIds as $iid) {
            $year = $itemYear[$iid] ?? null;
            if (!$year) {
                continue;
            }
            $itemTypes = [];
            foreach ($links[$iid] ?? [] as [$term, $label, $vrid]) {
                if ($term === 'dcterms:type') {
                    $title = $items[$vrid]['title'] ?? '';
                    if ($title !== '') {
                        $itemTypes[] = $title;
                        $allTypes[$title] = true;
                    }
                }
            }
            if (!$itemTypes) {
                $itemTypes = ['(no type)'];
                $allTypes['(no type)'] = true;
            }
            foreach ($itemTypes as $t) {
                $yearType[$year][$t] = ($yearType[$year][$t] ?? 0) + 1;
            }
        }
        if (!$yearType) {
            return null;
        }

        $years = array_keys($yearType);
        sort($years);
        $typeList = array_keys($allTypes);
        sort($typeList);
        $series = [];
        foreach ($typeList as $t) {
            $data = [];
            foreach ($years as $y) {
                $data[] = $yearType[$y][$t] ?? 0;
            }
            $series[] = ['name' => $t, 'data' => $data];
        }
        return ['years' => $years, 'series' => $series];
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

    /** Build subject x year matrix for temporal trend visualization. */
    public static function buildSubjectTrends(array $itemIds, array $links, array $items, array $itemYear, int $topN = 10): ?array
    {
        $subjectYear = [];
        $subjectTotals = [];
        foreach ($itemIds as $iid) {
            $year = $itemYear[$iid] ?? null;
            if (!$year) {
                continue;
            }
            foreach ($links[$iid] ?? [] as [$term, $label, $vrid]) {
                if ($term === 'dcterms:subject') {
                    $title = $items[$vrid]['title'] ?? '';
                    if ($title !== '') {
                        $subjectYear[$title][$year] = ($subjectYear[$title][$year] ?? 0) + 1;
                        $subjectTotals[$title] = ($subjectTotals[$title] ?? 0) + 1;
                    }
                }
            }
        }
        if (!$subjectYear) {
            return null;
        }
        arsort($subjectTotals);
        $topSubjects = array_slice(array_keys($subjectTotals), 0, $topN);
        $yearSet = [];
        foreach ($topSubjects as $s) {
            foreach (array_keys($subjectYear[$s] ?? []) as $y) {
                $yearSet[$y] = true;
            }
        }
        $allYears = array_keys($yearSet);
        sort($allYears);
        if (count($allYears) < 2) {
            return null;
        }
        $series = [];
        foreach ($topSubjects as $s) {
            $data = [];
            foreach ($allYears as $y) {
                $data[] = $subjectYear[$s][$y] ?? 0;
            }
            $series[] = ['name' => $s, 'data' => $data];
        }
        return ['years' => $allYears, 'series' => $series];
    }

    /** Build language x year stacked area. */
    public static function buildLanguageTimeline(array $itemIds, array $links, array $items, array $itemYear): ?array
    {
        $yearLang = [];
        $allLangs = [];
        foreach ($itemIds as $iid) {
            $year = $itemYear[$iid] ?? null;
            if (!$year) {
                continue;
            }
            foreach ($links[$iid] ?? [] as [$term, $label, $vrid]) {
                if ($term === 'dcterms:language') {
                    $title = $items[$vrid]['title'] ?? '';
                    if ($title !== '') {
                        $yearLang[$year][$title] = ($yearLang[$year][$title] ?? 0) + 1;
                        $allLangs[$title] = true;
                    }
                }
            }
        }
        if (!$yearLang || count($yearLang) < 2) {
            return null;
        }
        $years = array_keys($yearLang);
        sort($years);
        $langs = array_keys($allLangs);
        sort($langs);
        $series = [];
        foreach ($langs as $lang) {
            $data = [];
            foreach ($years as $y) {
                $data[] = $yearLang[$y][$lang] ?? 0;
            }
            $series[] = ['name' => $lang, 'data' => $data];
        }
        return ['years' => $years, 'series' => $series];
    }

    /** Build Project -> Type treemap hierarchy. */
    public static function buildTreemap(array $itemIds, array $links, array $items, array $childrenOf, string $parentTitle): ?array
    {
        $projectItems = [];
        $unassigned = [];
        foreach ($itemIds as $iid) {
            $assigned = false;
            foreach ($links[$iid] ?? [] as [$term, $label, $vrid]) {
                if ($term === 'dcterms:isPartOf' && ($items[$vrid]['template_id'] ?? null) === self::TEMPLATE_PROJECTS) {
                    $projectItems[$vrid][] = $iid;
                    $assigned = true;
                    break;
                }
            }
            if (!$assigned) {
                $unassigned[] = $iid;
            }
        }
        if (!$projectItems && !$unassigned) {
            return null;
        }

        $typeChildren = static function (array $iids) use ($links, $items): array {
            $types = [];
            foreach ($iids as $iid) {
                foreach ($links[$iid] ?? [] as [$term, $label, $vrid]) {
                    if ($term === 'dcterms:type') {
                        $title = $items[$vrid]['title'] ?? '';
                        if ($title !== '') {
                            $types[$title] = ($types[$title] ?? 0) + 1;
                        }
                    }
                }
            }
            arsort($types);
            $children = [];
            foreach ($types as $t => $c) {
                $children[] = ['name' => $t, 'value' => $c];
            }
            return $children;
        };

        // Sort projects by descending item count.
        uksort($projectItems, static fn ($a, $b) => count($projectItems[$b]) <=> count($projectItems[$a]));

        $result = [];
        foreach ($projectItems as $pid => $iids) {
            $ptitle = $items[$pid]['title'] ?? ('Project ' . $pid);
            $children = $typeChildren($iids);
            if ($children) {
                $result[] = ['name' => $ptitle, 'value' => count($iids), 'children' => $children];
            }
        }
        if ($unassigned) {
            $children = $typeChildren($unassigned);
            if ($children) {
                $result[] = ['name' => '(unassigned)', 'value' => count($unassigned), 'children' => $children];
            }
        }
        return $result ?: null;
    }

    /** Build person -> project force graph from research items. */
    public static function buildContributorNetwork(int $entityId, string $entityTitle, array $itemIds, array $items, array $links, array $childrenOf, int $maxNodes = 30): ?array
    {
        $personProject = [];
        $personCounts = [];
        $projectCounts = [];
        foreach ($itemIds as $iid) {
            $itemPersons = [];
            $itemProject = null;
            foreach ($links[$iid] ?? [] as [$term, $label, $vrid]) {
                if (str_starts_with($term, 'marcrel:') || $term === 'dcterms:creator' || $term === 'dcterms:contributor') {
                    if (($items[$vrid]['template_id'] ?? null) === self::TEMPLATE_PERSONS) {
                        $itemPersons[] = $vrid;
                    }
                } elseif ($term === 'dcterms:isPartOf') {
                    if (($items[$vrid]['template_id'] ?? null) === self::TEMPLATE_PROJECTS) {
                        $itemProject = $vrid;
                    }
                }
            }
            if ($itemProject && $itemPersons) {
                foreach ($itemPersons as $pid) {
                    $personProject[$pid . ',' . $itemProject] = ($personProject[$pid . ',' . $itemProject] ?? 0) + 1;
                    $personCounts[$pid] = ($personCounts[$pid] ?? 0) + 1;
                }
                $projectCounts[$itemProject] = ($projectCounts[$itemProject] ?? 0) + 1;
            }
        }
        if (!$personProject) {
            return null;
        }

        arsort($personCounts);
        $topPersons = array_flip(array_slice(array_keys($personCounts), 0, $maxNodes));
        arsort($projectCounts);
        $topProjects = array_flip(array_slice(array_keys($projectCounts), 0, 15));

        $nodes = [];
        $nodeNames = [];
        foreach (array_keys($topPersons) as $pid) {
            $title = $items[$pid]['title'] ?? ('Person ' . $pid);
            $nodes[] = ['name' => $title, 'value' => $personCounts[$pid], 'itemId' => $pid, 'category' => 'person'];
            $nodeNames[$title] = true;
        }
        foreach (array_keys($topProjects) as $pid) {
            $title = $items[$pid]['title'] ?? ('Project ' . $pid);
            $nodes[] = ['name' => $title, 'value' => $projectCounts[$pid], 'itemId' => $pid, 'category' => 'project'];
            $nodeNames[$title] = true;
        }

        $netLinks = [];
        foreach ($personProject as $key => $count) {
            [$personId, $projId] = array_map('intval', explode(',', $key));
            if (isset($topPersons[$personId], $topProjects[$projId])) {
                $pTitle = $items[$personId]['title'] ?? '';
                $prTitle = $items[$projId]['title'] ?? '';
                if (isset($nodeNames[$pTitle], $nodeNames[$prTitle])) {
                    $netLinks[] = ['source' => $pTitle, 'target' => $prTitle, 'value' => $count];
                }
            }
        }
        return $netLinks ? ['nodes' => $nodes, 'links' => $netLinks, 'categories' => ['person', 'project']] : null;
    }

    /** Build person -> institution affiliation network centred on an institution. */
    public static function buildAffiliationNetwork(int $instId, string $instTitle, array $items, array $links, array $reverseLinks, int $maxNodes = 30): ?array
    {
        $affiliated = $reverseLinks[$instId]['dcterms:isPartOf'] ?? [];
        $affiliatedPersons = [];
        foreach ($affiliated as $pid) {
            if (($items[$pid]['template_id'] ?? null) === self::TEMPLATE_PERSONS) {
                $affiliatedPersons[] = $pid;
            }
        }
        if (!$affiliatedPersons) {
            return null;
        }

        $instCounts = [];
        $personAffl = [];
        foreach ($affiliatedPersons as $pid) {
            $affls = [];
            foreach ($links[$pid] ?? [] as [$term, $label, $vrid]) {
                if ($term === 'dcterms:isPartOf' && ($items[$vrid]['class_term'] ?? '') === 'foaf:Organization') {
                    $affls[] = $vrid;
                    $instCounts[$vrid] = ($instCounts[$vrid] ?? 0) + 1;
                }
            }
            $personAffl[$pid] = $affls;
        }

        arsort($instCounts);
        $topInsts = array_flip(array_slice(array_keys($instCounts), 0, $maxNodes));
        $topInsts[$instId] = true;

        $nodes = [['name' => $instTitle, 'value' => count($affiliatedPersons), 'itemId' => $instId, 'category' => 'institution', 'isSelf' => true]];
        $nodeNames = [$instTitle => true];
        foreach (array_keys($topInsts) as $iid) {
            if ($iid === $instId) {
                continue;
            }
            $title = $items[$iid]['title'] ?? ('Institution ' . $iid);
            $nodes[] = ['name' => $title, 'value' => $instCounts[$iid], 'itemId' => $iid, 'category' => 'institution'];
            $nodeNames[$title] = true;
        }
        foreach (array_slice($affiliatedPersons, 0, $maxNodes) as $pid) {
            $title = $items[$pid]['title'] ?? ('Person ' . $pid);
            $nodes[] = ['name' => $title, 'value' => count($personAffl[$pid] ?? []), 'itemId' => $pid, 'category' => 'person'];
            $nodeNames[$title] = true;
        }

        $netLinks = [];
        foreach (array_slice($affiliatedPersons, 0, $maxNodes) as $pid) {
            $pTitle = $items[$pid]['title'] ?? '';
            foreach ($personAffl[$pid] ?? [] as $iid) {
                if (!isset($topInsts[$iid])) {
                    continue;
                }
                $iTitle = $items[$iid]['title'] ?? '';
                if (isset($nodeNames[$pTitle], $nodeNames[$iTitle])) {
                    $netLinks[] = ['source' => $pTitle, 'target' => $iTitle, 'value' => 1];
                }
            }
        }
        return $netLinks ? ['nodes' => $nodes, 'links' => $netLinks, 'categories' => ['person', 'institution']] : null;
    }

    /** Build institution collaboration network from shared research items. */
    public static function buildCollabNetwork(int $instId, string $instTitle, array $itemIds, array $items, array $links, array $reverseLinks, array $instSet, array $instTerms, int $maxNodes = 25): ?array
    {
        $collabCounts = [];
        $instTermsSet = array_flip($instTerms);
        foreach ($itemIds as $iid) {
            foreach ($links[$iid] ?? [] as [$term, $label, $vrid]) {
                if (isset($instTermsSet[$term]) && $vrid !== $instId && isset($instSet[$vrid])) {
                    $collabCounts[$vrid] = ($collabCounts[$vrid] ?? 0) + 1;
                }
            }
        }
        if (!$collabCounts) {
            return null;
        }
        arsort($collabCounts);
        $topCollabs = array_slice($collabCounts, 0, $maxNodes, true);
        $topIds = array_keys($topCollabs);

        $nodes = [['name' => $instTitle, 'value' => count($itemIds), 'itemId' => $instId, 'isSelf' => true]];
        foreach ($topCollabs as $cid => $count) {
            $ctitle = $items[$cid]['title'] ?? ('Institution ' . $cid);
            $nodes[] = ['name' => $ctitle, 'value' => $count, 'itemId' => $cid];
        }

        $netLinks = [];
        foreach ($topCollabs as $cid => $count) {
            $ctitle = $items[$cid]['title'] ?? ('Institution ' . $cid);
            $netLinks[] = ['source' => $instTitle, 'target' => $ctitle, 'value' => $count];
        }

        $collabItems = [];
        foreach ($topIds as $cid) {
            $collabItems[$cid] = array_flip(self::findItemsLinkingTo($cid, $reverseLinks, $instTerms));
        }
        $n = count($topIds);
        for ($i = 0; $i < $n; $i++) {
            for ($j = $i + 1; $j < $n; $j++) {
                $a = $topIds[$i];
                $b = $topIds[$j];
                $shared = count(array_intersect_key($collabItems[$a], $collabItems[$b]));
                if ($shared >= 2) {
                    $aTitle = $items[$a]['title'] ?? '';
                    $bTitle = $items[$b]['title'] ?? '';
                    if ($aTitle !== '' && $bTitle !== '') {
                        $netLinks[] = ['source' => $aTitle, 'target' => $bTitle, 'value' => $shared];
                    }
                }
            }
        }
        return $netLinks ? ['nodes' => $nodes, 'links' => $netLinks] : null;
    }

    /** Build geographic flow data: origin -> current location arcs. */
    public static function buildGeoFlows(array $itemIds, array $links, array $items, array $geo): ?array
    {
        $flows = [];
        foreach ($itemIds as $iid) {
            $origins = [];
            $currents = [];
            foreach ($links[$iid] ?? [] as [$term, $label, $vrid]) {
                if ($term === 'dcterms:spatial' && isset($geo[$vrid])) {
                    $origins[] = $vrid;
                } elseif ($term === 'dcterms:provenance' && isset($geo[$vrid])) {
                    $currents[] = $vrid;
                }
            }
            foreach ($origins as $o) {
                foreach ($currents as $c) {
                    if ($o !== $c) {
                        $flows[$o . ',' . $c] = ($flows[$o . ',' . $c] ?? 0) + 1;
                    }
                }
            }
        }
        if (!$flows) {
            return null;
        }

        $nodeIds = [];
        foreach (array_keys($flows) as $key) {
            [$o, $c] = array_map('intval', explode(',', $key));
            $nodeIds[$o] = true;
            $nodeIds[$c] = true;
        }
        $nodes = [];
        foreach (array_keys($nodeIds) as $nid) {
            $nodes[] = ['name' => $geo[$nid]['name'], 'lat' => $geo[$nid]['lat'], 'lon' => $geo[$nid]['lon'], 'itemId' => $nid];
        }

        arsort($flows);
        $flowLinks = [];
        foreach ($flows as $key => $count) {
            [$o, $c] = array_map('intval', explode(',', $key));
            $og = $geo[$o];
            $cg = $geo[$c];
            $flowLinks[] = [
                'from' => $og['name'], 'fromLat' => $og['lat'], 'fromLon' => $og['lon'],
                'to' => $cg['name'], 'toLat' => $cg['lat'], 'toLon' => $cg['lon'],
                'value' => $count,
            ];
        }
        return $flowLinks ? ['nodes' => $nodes, 'links' => $flowLinks] : null;
    }

    /** Build beeswarm data: projects as scatter points by start year. */
    public static function buildBeeswarm(string $sectionTitle, array $projectIds, array $items, array $childrenOf, array $temporal): ?array
    {
        $points = [];
        foreach ($projectIds as $pid) {
            $ptitle = $items[$pid]['title'] ?? ('Project ' . $pid);
            $itemCount = count($childrenOf[$pid] ?? []);
            if (isset($temporal[$pid])) {
                if (preg_match('/(\d{4})/', (string) $temporal[$pid][0], $m)) {
                    $points[] = [
                        'category' => $sectionTitle,
                        'value' => (int) $m[1],
                        'label' => $ptitle,
                        'size' => max($itemCount, 1),
                        'itemId' => $pid,
                    ];
                }
            }
        }
        return $points ?: null;
    }

    /* ------------------------------------------------------------------ */
    /*  Choropleth: country-level aggregation (point-in-polygon)           */
    /* ------------------------------------------------------------------ */

    /** Even-odd ray-casting test across all rings of a polygon (handles holes). */
    private static function pointInPolygon(float $x, float $y, array $rings): bool
    {
        $inside = false;
        foreach ($rings as $ring) {
            $n = count($ring);
            $j = $n - 1;
            for ($i = 0; $i < $n; $i++) {
                $xi = $ring[$i][0];
                $yi = $ring[$i][1];
                $xj = $ring[$j][0];
                $yj = $ring[$j][1];
                if ((($yi > $y) !== ($yj > $y)) && ($x < ($xj - $xi) * ($y - $yi) / ($yj - $yi) + $xi)) {
                    $inside = !$inside;
                }
                $j = $i;
            }
        }
        return $inside;
    }

    private static function countryForPoint(float $lon, float $lat, array $features): ?string
    {
        foreach ($features as [$name, $geom]) {
            $type = $geom['type'] ?? '';
            $coords = $geom['coordinates'] ?? [];
            if ($type === 'Polygon') {
                if (self::pointInPolygon($lon, $lat, $coords)) {
                    return $name;
                }
            } elseif ($type === 'MultiPolygon') {
                foreach ($coords as $poly) {
                    if (self::pointInPolygon($lon, $lat, $poly)) {
                        return $name;
                    }
                }
            }
        }
        return null;
    }

    /** Parse the countries GeoJSON into [[name, geometry], ...]. */
    public static function loadCountryFeatures(string $geojsonPath): array
    {
        $features = [];
        if (!is_readable($geojsonPath)) {
            return $features;
        }
        $gj = json_decode((string) file_get_contents($geojsonPath), true);
        foreach ($gj['features'] ?? [] as $ft) {
            $props = $ft['properties'] ?? [];
            $name = $props['ADMIN'] ?? $props['NAME'] ?? $props['NAME_EN'] ?? $props['NAME_LONG'] ?? null;
            $geom = $ft['geometry'] ?? null;
            if ($name && $geom) {
                $features[] = [$name, $geom];
            }
        }
        return $features;
    }

    /** Map each location id to its country name via point-in-polygon. */
    public static function buildCountryIndex(array $geo, array $features): array
    {
        $index = [];
        if (!$features) {
            return $index;
        }
        foreach ($geo as $locId => $g) {
            $lon = $g['lon'] ?? null;
            $lat = $g['lat'] ?? null;
            if ($lon === null || $lat === null) {
                continue;
            }
            $name = self::countryForPoint((float) $lon, (float) $lat, $features);
            if ($name !== null) {
                $index[$locId] = $name;
            }
        }
        return $index;
    }

    /** Aggregate item origins (dcterms:spatial) to per-country counts. */
    public static function buildChoropleth(array $itemIds, array $links, array $countryIndex): ?array
    {
        if (!$countryIndex) {
            return null;
        }
        $counts = [];
        foreach ($itemIds as $iid) {
            $seen = [];
            foreach ($links[$iid] ?? [] as [$term, $label, $vrid]) {
                if ($term === 'dcterms:spatial' && isset($countryIndex[$vrid])) {
                    $country = $countryIndex[$vrid];
                    if (!isset($seen[$country])) {
                        $counts[$country] = ($counts[$country] ?? 0) + 1;
                        $seen[$country] = true;
                    }
                }
            }
        }
        if (!$counts) {
            return null;
        }
        arsort($counts);
        $out = [];
        foreach ($counts as $c => $n) {
            $out[] = ['country' => $c, 'count' => $n];
        }
        return $out;
    }

    /* ------------------------------------------------------------------ */
    /*  Radar profile                                                      */
    /* ------------------------------------------------------------------ */

    public const RADAR_AXES = [
        ['items', 'Items'],
        ['languages', 'Languages'],
        ['subjects', 'Subjects'],
        ['contributors', 'People'],
        ['types', 'Types'],
        ['span', 'Year span'],
    ];

    public static function profileFromItems(array $itemIds, array $links, array $itemYear): array
    {
        $langs = $subs = $contribs = $types = $locs = [];
        $years = [];
        foreach ($itemIds as $iid) {
            $y = $itemYear[$iid] ?? null;
            if ($y !== null && ctype_digit((string) $y)) {
                $years[] = (int) $y;
            }
            foreach ($links[$iid] ?? [] as [$term, $label, $vrid]) {
                if ($term === 'dcterms:language') {
                    $langs[$vrid] = true;
                } elseif ($term === 'dcterms:subject') {
                    $subs[$vrid] = true;
                } elseif ($term === 'dcterms:type') {
                    $types[$vrid] = true;
                } elseif ($term === 'dcterms:spatial') {
                    $locs[$vrid] = true;
                } elseif ($term === 'dcterms:creator' || $term === 'dcterms:contributor' || str_starts_with($term, 'marcrel:')) {
                    $contribs[$vrid] = true;
                }
            }
        }
        $span = count($years) >= 2 ? (max($years) - min($years)) : 0;
        return [
            'items' => count($itemIds), 'languages' => count($langs), 'subjects' => count($subs),
            'contributors' => count($contribs), 'types' => count($types), 'span' => $span,
        ];
    }

    public static function profileMaxima(array $profiles): array
    {
        $mx = [];
        foreach (self::RADAR_AXES as [$k, $l]) {
            $mx[$k] = 0;
        }
        foreach ($profiles as $p) {
            foreach (self::RADAR_AXES as [$k, $l]) {
                $v = $p[$k] ?? 0;
                if ($v > $mx[$k]) {
                    $mx[$k] = $v;
                }
            }
        }
        return $mx;
    }

    public static function buildRadar(?array $profile, array $maxima): ?array
    {
        if (!$profile || !$maxima) {
            return null;
        }
        $indicator = [];
        $values = [];
        $anyNonzero = false;
        foreach (self::RADAR_AXES as [$key, $label]) {
            $mx = $maxima[$key] ?? 0;
            if ($mx <= 0) {
                continue;
            }
            $indicator[] = ['name' => $label, 'max' => $mx];
            $v = $profile[$key] ?? 0;
            $values[] = $v;
            if ($v) {
                $anyNonzero = true;
            }
        }
        if (count($indicator) < 3 || !$anyNonzero) {
            return null;
        }
        return ['indicator' => $indicator, 'series' => [['value' => $values]]];
    }

    /* ------------------------------------------------------------------ */
    /*  Discursive communities (subject co-occurrence + Louvain)           */
    /* ------------------------------------------------------------------ */

    /** Pure-PHP weighted PageRank (power iteration), matching the Python. */
    private static function weightedPagerank(array $adj, array $deg, float $alpha = 0.85, int $iters = 100, float $tol = 1.0e-6): array
    {
        $nodes = array_keys($adj);
        $n = count($nodes);
        if ($n === 0) {
            return [];
        }
        $pr = [];
        foreach ($nodes as $u) {
            $pr[$u] = 1.0 / $n;
        }
        $base = (1.0 - $alpha) / $n;
        for ($it = 0; $it < $iters; $it++) {
            $prev = $pr;
            $pr = [];
            foreach ($nodes as $u) {
                $pr[$u] = $base;
            }
            foreach ($nodes as $u) {
                $d = $deg[$u] ?: 1;
                $share = $alpha * $prev[$u] / $d;
                foreach ($adj[$u] as $v => $w) {
                    $pr[$v] += $share * $w;
                }
            }
            $err = 0.0;
            foreach ($nodes as $u) {
                $err += abs($pr[$u] - $prev[$u]);
            }
            if ($err < $tol) {
                break;
            }
        }
        $total = array_sum($pr) ?: 1.0;
        foreach ($pr as $u => $v) {
            $pr[$u] = $v / $total;
        }
        return $pr;
    }

    /**
     * Single-level Louvain (modularity-maximising local moving) on a weighted
     * undirected graph. Returns [node => communityRepresentativeId]. Sufficient
     * for well-separated subject co-occurrence graphs; relabelled by the caller.
     */
    private static function louvain(array $adj, array $deg, float $m): array
    {
        $comm = [];
        $sigmaTot = [];
        foreach ($adj as $u => $_) {
            $comm[$u] = $u;
            $sigmaTot[$u] = $deg[$u];
        }
        $twoM = 2.0 * $m;
        if ($twoM <= 0) {
            return $comm;
        }
        $nodes = array_keys($adj);
        $improved = true;
        $passes = 0;
        while ($improved && $passes < 50) {
            $improved = false;
            $passes++;
            foreach ($nodes as $u) {
                $ku = $deg[$u];
                $cu = $comm[$u];
                $sigmaTot[$cu] -= $ku;
                $kIn = [];
                foreach ($adj[$u] as $v => $w) {
                    if ($v === $u) {
                        continue;
                    }
                    $cv = $comm[$v];
                    $kIn[$cv] = ($kIn[$cv] ?? 0.0) + $w;
                }
                $best = $cu;
                $bestGain = ($kIn[$cu] ?? 0.0) - $sigmaTot[$cu] * $ku / $twoM;
                foreach ($kIn as $c => $w) {
                    $gain = $w - $sigmaTot[$c] * $ku / $twoM;
                    if ($gain > $bestGain) {
                        $bestGain = $gain;
                        $best = $c;
                    }
                }
                $comm[$u] = $best;
                $sigmaTot[$best] += $ku;
                if ($best !== $cu) {
                    $improved = true;
                }
            }
        }
        return $comm;
    }

    public static function buildDiscursiveCommunities(array $itemIds, array $links, array $items, ?array $subjectFilter = null, int $minCooccurrence = 2, int $maxNodes = 120): ?array
    {
        $pairCounts = [];
        $nodeCounts = [];
        $titles = [];
        $filterSet = $subjectFilter !== null ? array_flip($subjectFilter) : null;
        foreach ($itemIds as $iid) {
            $subs = [];
            foreach ($links[$iid] ?? [] as [$term, $label, $vrid]) {
                if ($term === 'dcterms:subject') {
                    if ($filterSet !== null && !isset($filterSet[$vrid])) {
                        continue;
                    }
                    $title = $items[$vrid]['title'] ?? '';
                    if ($title !== '') {
                        $subs[$vrid] = true;
                        $titles[$vrid] = $title;
                    }
                }
            }
            $subs = array_keys($subs);
            foreach ($subs as $v) {
                $nodeCounts[$v] = ($nodeCounts[$v] ?? 0) + 1;
            }
            $n = count($subs);
            for ($i = 0; $i < $n; $i++) {
                for ($j = $i + 1; $j < $n; $j++) {
                    $a = $subs[$i];
                    $b = $subs[$j];
                    if ($a > $b) {
                        [$a, $b] = [$b, $a];
                    }
                    $pairCounts[$a . ',' . $b] = ($pairCounts[$a . ',' . $b] ?? 0) + 1;
                }
            }
        }

        $adj = [];
        $deg = [];
        $edges = 0;
        foreach ($pairCounts as $key => $w) {
            if ($w < $minCooccurrence) {
                continue;
            }
            [$a, $b] = array_map('intval', explode(',', $key));
            $adj[$a][$b] = $w;
            $adj[$b][$a] = $w;
            $deg[$a] = ($deg[$a] ?? 0) + $w;
            $deg[$b] = ($deg[$b] ?? 0) + $w;
            $edges++;
        }
        if (count($adj) < 3 || $edges < 2) {
            return null;
        }

        $m = array_sum($deg) / 2.0;
        $rawComm = self::louvain($adj, $deg, $m);

        // Relabel community representatives to 0..K-1 (first-seen order).
        $relabel = [];
        $next = 0;
        $commOf = [];
        foreach ($rawComm as $node => $c) {
            if (!isset($relabel[$c])) {
                $relabel[$c] = $next++;
            }
            $commOf[$node] = $relabel[$c];
        }

        $pr = self::weightedPagerank($adj, $deg);
        $rankNodes = array_keys($adj);
        usort($rankNodes, static fn ($x, $y) => ($pr[$y] ?? 0) <=> ($pr[$x] ?? 0));
        $ranked = array_slice($rankNodes, 0, $maxNodes);
        $topSet = array_flip($ranked);

        $nodes = [];
        foreach ($ranked as $nd) {
            if (isset($titles[$nd])) {
                $nodes[] = [
                    'name' => $titles[$nd], 'value' => $nodeCounts[$nd] ?? 0, 'itemId' => $nd,
                    'community' => $commOf[$nd] ?? 0, 'rank' => round($pr[$nd] ?? 0, 6),
                ];
            }
        }

        $outLinks = [];
        foreach ($pairCounts as $key => $w) {
            if ($w < $minCooccurrence) {
                continue;
            }
            [$a, $b] = array_map('intval', explode(',', $key));
            if (isset($topSet[$a], $topSet[$b])) {
                $outLinks[] = ['source' => $titles[$a], 'target' => $titles[$b], 'value' => $w];
            }
        }

        $summary = [];
        foreach ($ranked as $nd) {
            $ci = $commOf[$nd] ?? 0;
            if (!isset($summary[$ci])) {
                $summary[$ci] = ['id' => $ci, 'size' => 0, 'anchor' => null, '_rank' => -1.0];
            }
            $summary[$ci]['size']++;
            if (($pr[$nd] ?? 0) > $summary[$ci]['_rank']) {
                $summary[$ci]['_rank'] = $pr[$nd] ?? 0;
                $summary[$ci]['anchor'] = $titles[$nd] ?? null;
            }
        }
        $communitiesList = [];
        foreach ($summary as $s) {
            $communitiesList[] = ['id' => $s['id'], 'size' => $s['size'], 'anchor' => $s['anchor']];
        }
        usort($communitiesList, static fn ($a, $b) => $b['size'] <=> $a['size']);

        return ['nodes' => $nodes, 'links' => $outLinks, 'communities' => $communitiesList];
    }

    /* ------------------------------------------------------------------ */
    /*  Publications / resource-template dimension                         */
    /* ------------------------------------------------------------------ */

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

    /**
     * Co-author network: authors co-occurring on the same publication, as a
     * force graph in the {nodes, links, communities} shape buildCommunities
     * consumes. Authors come from both literal bibo:authorList names and
     * Person-linked authors; nodes carry a `matched` flag (true = linked Person)
     * so the front-end can mark matched persons distinctly. Communities use the
     * same Louvain + weighted-PageRank as the subject graph.
     *
     * @return array{nodes:list<array>,links:list<array>,communities:list<array>}|null
     */
    public static function buildCoAuthorNetwork(array $itemIds, array $links, array $literals, array $items, int $minCooccurrence = 1, int $maxNodes = 60): ?array
    {
        // Map each distinct author name to an integer node id so the integer-
        // keyed louvain()/weightedPagerank() helpers apply unchanged.
        $nameId = [];
        $idName = [];
        $matched = [];
        $personId = [];
        $next = 0;
        $ensure = static function (string $name) use (&$nameId, &$idName, &$matched, &$next): int {
            if (!isset($nameId[$name])) {
                $nameId[$name] = $next;
                $idName[$next] = $name;
                $matched[$next] = false;
                $next++;
            }
            return $nameId[$name];
        };

        $pairCounts = [];
        $nodeCounts = [];
        foreach ($itemIds as $iid) {
            $authors = [];
            foreach ($links[$iid] ?? [] as [$term, $label, $vrid]) {
                if ($term !== 'bibo:authorList') {
                    continue;
                }
                $title = trim((string) ($items[$vrid]['title'] ?? ''));
                if ($title === '') {
                    continue;
                }
                $aid = $ensure($title);
                $matched[$aid] = true;
                $personId[$aid] = $vrid;
                $authors[$aid] = true;
            }
            foreach ($literals[$iid]['bibo:authorList'] ?? [] as $name) {
                $name = trim((string) $name);
                if ($name === '') {
                    continue;
                }
                $authors[$ensure($name)] = true;
            }
            $authors = array_keys($authors);
            foreach ($authors as $a) {
                $nodeCounts[$a] = ($nodeCounts[$a] ?? 0) + 1;
            }
            $n = count($authors);
            for ($i = 0; $i < $n; $i++) {
                for ($j = $i + 1; $j < $n; $j++) {
                    $a = $authors[$i];
                    $b = $authors[$j];
                    if ($a > $b) {
                        [$a, $b] = [$b, $a];
                    }
                    $pairCounts[$a . ',' . $b] = ($pairCounts[$a . ',' . $b] ?? 0) + 1;
                }
            }
        }

        $adj = [];
        $deg = [];
        $edges = 0;
        foreach ($pairCounts as $key => $w) {
            if ($w < $minCooccurrence) {
                continue;
            }
            [$a, $b] = array_map('intval', explode(',', $key));
            $adj[$a][$b] = $w;
            $adj[$b][$a] = $w;
            $deg[$a] = ($deg[$a] ?? 0) + $w;
            $deg[$b] = ($deg[$b] ?? 0) + $w;
            $edges++;
        }
        if (count($adj) < 3 || $edges < 2) {
            return null;
        }

        $m = array_sum($deg) / 2.0;
        $rawComm = self::louvain($adj, $deg, $m);
        $relabel = [];
        $nextC = 0;
        $commOf = [];
        foreach ($rawComm as $node => $c) {
            if (!isset($relabel[$c])) {
                $relabel[$c] = $nextC++;
            }
            $commOf[$node] = $relabel[$c];
        }

        $pr = self::weightedPagerank($adj, $deg);
        $rankNodes = array_keys($adj);
        usort($rankNodes, static fn ($x, $y) => ($pr[$y] ?? 0) <=> ($pr[$x] ?? 0));
        $ranked = array_slice($rankNodes, 0, $maxNodes);
        $topSet = array_flip($ranked);

        $nodes = [];
        foreach ($ranked as $nd) {
            $node = [
                'name' => $idName[$nd], 'value' => $nodeCounts[$nd] ?? 0,
                'community' => $commOf[$nd] ?? 0, 'rank' => round($pr[$nd] ?? 0, 6),
                'matched' => $matched[$nd] ?? false,
            ];
            if (!empty($matched[$nd]) && isset($personId[$nd])) {
                $node['itemId'] = $personId[$nd];
            }
            $nodes[] = $node;
        }

        $outLinks = [];
        foreach ($pairCounts as $key => $w) {
            if ($w < $minCooccurrence) {
                continue;
            }
            [$a, $b] = array_map('intval', explode(',', $key));
            if (isset($topSet[$a], $topSet[$b])) {
                $outLinks[] = ['source' => $idName[$a], 'target' => $idName[$b], 'value' => $w];
            }
        }

        $summary = [];
        foreach ($ranked as $nd) {
            $ci = $commOf[$nd] ?? 0;
            if (!isset($summary[$ci])) {
                $summary[$ci] = ['id' => $ci, 'size' => 0, 'anchor' => null, '_rank' => -1.0];
            }
            $summary[$ci]['size']++;
            if (($pr[$nd] ?? 0) > $summary[$ci]['_rank']) {
                $summary[$ci]['_rank'] = $pr[$nd] ?? 0;
                $summary[$ci]['anchor'] = $idName[$nd] ?? null;
            }
        }
        $communitiesList = [];
        foreach ($summary as $s) {
            $communitiesList[] = ['id' => $s['id'], 'size' => $s['size'], 'anchor' => $s['anchor']];
        }
        usort($communitiesList, static fn ($a, $b) => $b['size'] <=> $a['size']);

        return ['nodes' => $nodes, 'links' => $outLinks, 'communities' => $communitiesList];
    }

    /* ------------------------------------------------------------------ */
    /*  Cadence / distribution / time charts                               */
    /* ------------------------------------------------------------------ */

    /**
     * Acquisition cadence: item count per calendar day (row-creation date).
     * Feeds the ECharts calendar heatmap.
     *
     * @return list<array{0:string,1:int}>|null
     */
    public static function buildCalendarHeatmap(array $itemIds, array $items): ?array
    {
        $byDay = [];
        foreach ($itemIds as $iid) {
            $day = $items[$iid]['created'] ?? '';
            if ($day === '') {
                continue;
            }
            $byDay[$day] = ($byDay[$day] ?? 0) + 1;
        }
        if (!$byDay) {
            return null;
        }
        ksort($byDay);
        $out = [];
        foreach ($byDay as $day => $count) {
            $out[] = [(string) $day, $count];
        }
        return $out;
    }

    /**
     * Items-per-project distribution, one box per research section. Returns null
     * when fewer than two sections qualify (a single box is uninformative), so
     * it auto-hides on an individual section and shows on the overview.
     *
     * @param array $sections   [sectionId => info] research-group items
     * @return list<array{name:string,values:list<int>}>|null
     */
    public static function buildBoxplot(array $sections, array $childrenOf): ?array
    {
        $out = [];
        foreach ($sections as $sid => $info) {
            $counts = [];
            foreach ($childrenOf[$sid] ?? [] as $pid) {
                $n = count($childrenOf[$pid] ?? []);
                if ($n > 0) {
                    $counts[] = $n;
                }
            }
            if ($counts) {
                $out[] = ['name' => $info['title'] ?? ('Section ' . $sid), 'values' => $counts];
            }
        }
        if (count($out) < 2) {
            return null;
        }
        return $out;
    }

    /**
     * Year-bucketed subject co-occurrence for the time-aware chord. Each bucket
     * is a {nodes, links} chord (same shape as buildChord) over items of that
     * year. Returns null with fewer than two non-empty year buckets.
     *
     * @return array{buckets:list<array>,years:list<string>}|null
     */
    public static function buildTimeChord(array $itemIds, array $links, array $items, array $itemYear, int $maxNodes = 16, int $minCooccurrence = 2): ?array
    {
        $byYear = [];
        foreach ($itemIds as $iid) {
            $year = $itemYear[$iid] ?? null;
            if ($year !== null && $year !== '') {
                $byYear[(string) $year][] = $iid;
            }
        }
        if (count($byYear) < 2) {
            return null;
        }
        ksort($byYear);

        $buckets = [];
        $years = [];
        foreach ($byYear as $year => $ids) {
            $chord = self::buildChord($ids, $links, $items, 'dcterms:subject', $maxNodes, $minCooccurrence);
            if ($chord !== null) {
                $buckets[] = ['year' => (string) $year, 'nodes' => $chord['nodes'], 'links' => $chord['links']];
                $years[] = (string) $year;
            }
        }
        if (count($buckets) < 2) {
            return null;
        }
        return ['buckets' => $buckets, 'years' => $years];
    }

    /**
     * Recent additions in 3/6/12-month windows back from the most recent
     * creation date, plus the most-active projects per window. "Now" = the
     * latest `created` date in the corpus (robust to historical imports).
     *
     * @param array $projectChildren  [projectId => [itemId,…]] (projects only)
     * @return array{reference:string,windows:list<array>}|null
     */
    public static function buildWhatsNew(array $items, array $projectChildren, array $windows = [3, 6, 12], int $maxItems = 24, int $maxProjects = 10): ?array
    {
        $maxDay = '';
        foreach ($items as $info) {
            $d = $info['created'] ?? '';
            if ($d !== '' && $d > $maxDay) {
                $maxDay = $d;
            }
        }
        if ($maxDay === '') {
            return null;
        }
        $refTs = strtotime($maxDay . ' 23:59:59');

        $parentOf = [];
        foreach ($projectChildren as $pid => $kids) {
            foreach ($kids as $kid) {
                if (!isset($parentOf[$kid])) {
                    $parentOf[$kid] = $pid;
                }
            }
        }

        $out = [];
        foreach ($windows as $months) {
            $cutoff = date('Y-m-d', strtotime('-' . (int) $months . ' months', $refTs));
            $recent = [];
            $projCount = [];
            foreach ($items as $id => $info) {
                $d = $info['created'] ?? '';
                if ($d === '' || $d < $cutoff) {
                    continue;
                }
                $recent[] = ['id' => $id, 'title' => $info['title'] ?? ('Item ' . $id), 'created' => $d];
                $pid = $parentOf[$id] ?? null;
                if ($pid !== null) {
                    $projCount[$pid] = ($projCount[$pid] ?? 0) + 1;
                }
            }
            usort($recent, static fn ($a, $b) => strcmp((string) $b['created'], (string) $a['created']));
            $recent = array_slice($recent, 0, $maxItems);

            arsort($projCount);
            $topProjects = [];
            foreach (array_slice($projCount, 0, $maxProjects, true) as $pid => $cnt) {
                $topProjects[] = ['name' => $items[$pid]['title'] ?? ('Project ' . $pid), 'value' => $cnt, 'itemId' => $pid];
            }

            $out[] = ['months' => (int) $months, 'count' => count($recent), 'items' => $recent, 'topProjects' => $topProjects];
        }

        return ['reference' => $maxDay, 'windows' => $out];
    }
}
