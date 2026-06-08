<?php
declare(strict_types=1);

namespace DreVisualizations\Precompute\Aggregators;

/**
 * Radar breadth profile and the curated Collection-Overview charts (stat
 * cards, research-sections bar, section × university heatmap,
 * cluster-partner geography).
 *
 * Composed into {@see \DreVisualizations\Precompute\Aggregators}; its methods
 * reach shared constants and helpers on that class through `self::`.
 */
trait OverviewChartsTrait
{
    /**
     * Normalise a list of stat-card specs into the render-ready `stats` array
     * the front-end draws (dashboard-stat-cards.js → ns.renderStatCards).
     *
     * The reusable stat-card component on the precompute side: any generator
     * computes its own counts (the standard PHP precompute way) and passes rows
     * shaped as `['key'=>, 'label'=>, 'value'=>, 'subtitle'=>?]`; this returns
     * the cleaned list — value cast to int, cards with a non-positive value
     * dropped, empty / null subtitles removed, and the given order preserved.
     *
     * The card `key` selects the lucide icon on the front-end (see STAT_ICONS /
     * the alias map in dashboard-stat-cards.js); unknown keys fall back to a
     * generic icon there, so any new card still renders a badge.
     *
     * @param array<array{key?:string,label?:string,value?:int|float,subtitle?:?string}> $cards
     * @return list<array{key:string,label:string,value:int,subtitle?:string}>
     */
    public static function buildStatCards(array $cards): array
    {
        $out = [];
        foreach ($cards as $card) {
            $key = (string) ($card['key'] ?? '');
            $label = (string) ($card['label'] ?? '');
            $value = (int) ($card['value'] ?? 0);
            if ($key === '' || $label === '' || $value <= 0) {
                continue;
            }
            $row = ['key' => $key, 'label' => $label, 'value' => $value];
            $subtitle = $card['subtitle'] ?? null;
            if ($subtitle !== null && (string) $subtitle !== '') {
                $row['subtitle'] = (string) $subtitle;
            }
            $out[] = $row;
        }
        return $out;
    }

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

    /**
     * Projects per research section — the amira homepage "Research Sections" bar.
     * A section's children are projects (`frapo:ResearchGroup` → project via
     * `dcterms:isPartOf`); every project that is part of the section counts once,
     * whether or not it has digitised items yet. The pseudo-section "External" is
     * excluded so the thematic sections stand alone.
     *
     * @param array<int,array> $sections  Section items, keyed by id (class_term frapo:ResearchGroup).
     * @return list<array{name:string,value:int,itemId:int}>|null
     */
    public static function buildSectionsBar(array $sections, array $childrenOf, array $items): ?array
    {
        $out = [];
        foreach ($sections as $sid => $info) {
            $title = (string) ($info['title'] ?? '');
            if ($title === '' || strcasecmp($title, 'External') === 0) {
                continue;
            }
            $projects = 0;
            foreach ($childrenOf[$sid] ?? [] as $pid) {
                if (($items[$pid]['template_id'] ?? null) === self::TEMPLATE_PROJECT) {
                    $projects++;
                }
            }
            if ($projects > 0) {
                $out[] = ['name' => $title, 'value' => $projects, 'itemId' => $sid];
            }
        }
        if (!$out) {
            return null;
        }
        // Deterministic: volume desc, then name — so the committed artifact and a
        // later regenerate agree even when sections tie on project count.
        usort($out, static fn ($a, $b) => ($b['value'] <=> $a['value']) ?: strcmp((string) $a['name'], (string) $b['name']));
        return $out;
    }

    /**
     * Research items by research section × university — the amira homepage heatmap.
     * For each section's project children, the project's item count flows into the
     * column of its university (first `frapo:isFundedBy`). External partner
     * collections that sit outside the section→project hierarchy are supplied as
     * `$externalBuckets` (each `{itemIds, section, university}`) and folded in
     * directly — e.g. ILAM → Rhodes University and BayGlo → University of Bayreuth,
     * both under an "External" row. Axes are ordered by total volume so the matrix
     * reads densest-first.
     *
     * @param array<int,array> $sections  Section items, keyed by id.
     * @param list<array{itemIds:list<int>,section:string,university:string}> $externalBuckets
     * @return array{rows:list<string>,cols:list<string>,values:list<array{0:int,1:int,2:int}>}|null
     */
    public static function buildSectionUniversity(array $sections, array $childrenOf, array $items, array $links, array $externalBuckets = []): ?array
    {
        $matrix = [];        // "section\0university" => item count
        $secTotals = [];
        $uniTotals = [];
        foreach ($sections as $sid => $info) {
            $section = (string) ($info['title'] ?? '');
            if ($section === '' || strcasecmp($section, 'External') === 0) {
                continue;
            }
            foreach ($childrenOf[$sid] ?? [] as $pid) {
                if (($items[$pid]['template_id'] ?? null) !== self::TEMPLATE_PROJECT) {
                    continue;
                }
                $itemCount = count($childrenOf[$pid] ?? []);
                if ($itemCount === 0) {
                    continue;
                }
                $uni = self::resolveUniversity($pid, $links, $items);
                if ($uni === null) {
                    continue;
                }
                $key = $section . "\0" . $uni;
                $matrix[$key] = ($matrix[$key] ?? 0) + $itemCount;
                $secTotals[$section] = ($secTotals[$section] ?? 0) + $itemCount;
                $uniTotals[$uni] = ($uniTotals[$uni] ?? 0) + $itemCount;
            }
        }
        // External partner collections (ILAM, BayGlo) reach the heatmap through
        // item-set membership, not the section→project→item hierarchy: ILAM items
        // carry no dcterms:isPartOf at all, and the BayGlo project names no research
        // section. Pin each bucket's items onto a partner-university column under
        // its given row (mirrors the dashboard's synthetic Rhodes/UBT routing in
        // buildResearchSectionUniversityHeatmap).
        foreach ($externalBuckets as $bucket) {
            $n = count($bucket['itemIds'] ?? []);
            if ($n === 0) {
                continue;
            }
            $section = (string) ($bucket['section'] ?? '');
            $uni = (string) ($bucket['university'] ?? '');
            if ($section === '' || $uni === '') {
                continue;
            }
            $key = $section . "\0" . $uni;
            $matrix[$key] = ($matrix[$key] ?? 0) + $n;
            $secTotals[$section] = ($secTotals[$section] ?? 0) + $n;
            $uniTotals[$uni] = ($uniTotals[$uni] ?? 0) + $n;
        }
        if (!$matrix) {
            return null;
        }
        // Order each axis by total volume desc, then label asc — deterministic so
        // the committed artifact matches a later regenerate regardless of source
        // iteration order.
        $byVolume = static function (array $totals): array {
            uksort($totals, static fn ($a, $b) => ($totals[$b] <=> $totals[$a]) ?: strcmp((string) $a, (string) $b));
            return array_keys($totals);
        };
        $rows = $byVolume($secTotals);   // sections → yAxis
        $cols = $byVolume($uniTotals);   // universities → xAxis
        $rowIdx = array_flip($rows);
        $colIdx = array_flip($cols);
        $values = [];
        foreach ($matrix as $key => $v) {
            [$s, $u] = explode("\0", $key);
            $values[] = [$colIdx[$u], $rowIdx[$s], $v];
        }
        // Stable cell order ([col, row]) so the values array is reproducible.
        usort($values, static fn ($a, $b) => ($a[0] <=> $b[0]) ?: ($a[1] <=> $b[1]));
        return ['rows' => $rows, 'cols' => $cols, 'values' => $values];
    }

    /** Resolve a project's funding university (first `frapo:isFundedBy`), mapped
     *  to a canonical label. Returns null when the project names no funder. */
    private static function resolveUniversity(int $pid, array $links, array $items): ?string
    {
        foreach ($links[$pid] ?? [] as [$term, $label, $vrid]) {
            if ($term === 'frapo:isFundedBy') {
                $title = (string) ($items[$vrid]['title'] ?? '');
                if ($title !== '') {
                    return self::UNIVERSITY_LABELS[$title] ?? $title;
                }
            }
        }
        return null;
    }

    /**
     * Data-driven geography of the Africa Multiple cluster: every Organisation
     * item that `dcterms:isPartOf` one of the four "African Multiple Partners"
     * category authority records (``$authorityKeys``: authority item id => legend
     * category key, in display order) and that carries coordinates. Replaces the
     * former hard-coded list — the partners, their coordinates, and their category
     * now come straight from Omeka, so curation happens there. Category labels are
     * read from each authority record's title; marker colours are assigned by the
     * front-end (dashboard-charts-cluster-map.js) per category order.
     *
     * @param array<int,array> $items item id => info (class_term, title, …)
     * @param array<int,list<array{0:string,1:string,2:int}>> $links item id => [term,label,vrid]
     * @param array<int,array{name:string,lat:float,lon:float}> $geo geocoded items
     * @param array<int,string> $authorityKeys authority item id => category key (ordered)
     * @return array{categories:list<array{key:string,label:string}>,points:list<array{category:string,latitude:float,longitude:float,label:string,sublabel:string,itemId:int}>}|array{}
     */
    public static function clusterPartners(array $items, array $links, array $geo, array $authorityKeys): array
    {
        $points = [];
        foreach ($items as $iid => $info) {
            if (($info['class_term'] ?? '') !== 'foaf:Organization' || !isset($geo[$iid])) {
                continue;
            }
            foreach ($links[$iid] ?? [] as [$term, , $vrid]) {
                if ($term !== 'dcterms:isPartOf' || !isset($authorityKeys[$vrid])) {
                    continue;
                }
                $g = $geo[$iid];
                $points[] = [
                    'category' => $authorityKeys[$vrid],
                    'latitude' => $g['lat'],
                    'longitude' => $g['lon'],
                    'label' => $g['name'] ?? ($info['title'] ?? ''),
                    'sublabel' => $items[$vrid]['title'] ?? '',
                    'itemId' => (int) $iid,
                ];
                break; // one category per partner
            }
        }
        if (!$points) {
            return [];
        }

        // Ordered legend categories — only those that actually have points, each
        // labelled from its authority record's title (data-driven).
        $categories = [];
        foreach ($authorityKeys as $authId => $key) {
            foreach ($points as $p) {
                if ($p['category'] === $key) {
                    $categories[] = ['key' => $key, 'label' => $items[$authId]['title'] ?? $key];
                    break;
                }
            }
        }

        // Stable order: by category order, then label.
        $rank = array_flip(array_values($authorityKeys));
        usort($points, static fn (array $a, array $b): int =>
            [$rank[$a['category']] ?? 99, $a['label']] <=> [$rank[$b['category']] ?? 99, $b['label']]);

        return ['categories' => $categories, 'points' => $points];
    }
}
