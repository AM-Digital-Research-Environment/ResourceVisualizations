<?php
declare(strict_types=1);

namespace ResourceVisualizations\Precompute\Aggregators;

/**
 * Time-aware charts: stacked timeline, subject / language trends,
 * beeswarm, acquisition calendar, items-per-project box plot,
 * time-bucketed chord, and the What's-New windows.
 *
 * Composed into {@see \ResourceVisualizations\Precompute\Aggregators}; its methods
 * reach shared constants and helpers on that class through `self::`.
 */
trait TemporalChartsTrait
{
    /**
     * Build stacked timeline: items by year, stacked by resource type.
     *
     * `$syntheticTypes` maps an item id to a resource-type label used as its
     * stack in place of (overriding) the item's own dcterms:type — e.g. every
     * publication stacks under one "Publication" series, whatever its
     * bibliographic type. Items with neither a synthetic label nor a dcterms:type
     * fall back to the generic "(no type)" bucket. Pass `[]` to disable.
     *
     * @param array<int,string> $syntheticTypes
     */
    public static function buildStackedTimeline(array $itemIds, array $links, array $items, array $itemYear, array $syntheticTypes = []): ?array
    {
        $yearType = [];
        $allTypes = [];
        foreach ($itemIds as $iid) {
            $year = $itemYear[$iid] ?? null;
            if (!$year) {
                continue;
            }
            $synType = $syntheticTypes[$iid] ?? null;
            $itemTypes = [];
            if ($synType !== null && $synType !== '') {
                // Synthetic type overrides the item's own dcterms:type(s): the item
                // stacks under this single label (e.g. publications → "Publication").
                $itemTypes[] = $synType;
                $allTypes[$synType] = true;
            } else {
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
