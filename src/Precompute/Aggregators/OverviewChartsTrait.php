<?php
declare(strict_types=1);

namespace ResourceVisualizations\Precompute\Aggregators;

/**
 * Radar breadth profile and the curated Collection-Overview charts (stat
 * cards, research-sections bar, section × university heatmap,
 * cluster-partner geography).
 *
 * Composed into {@see \ResourceVisualizations\Precompute\Aggregators}; its methods
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
     * Static, curated geography of the Africa Multiple cluster — ported verbatim
     * from the amira dashboard's clusterPartners.ts: the AMRCs and privileged
     * partner, cooperation partners, and global partner Centers of African
     * Studies. Marker colours are assigned per `category` by the front-end
     * (dashboard-charts-cluster-map.js) so they follow the active light/dark theme.
     *
     * @return list<array{category:string,latitude:float,longitude:float,label:string,sublabel:string}>
     */
    public static function clusterPartners(): array
    {
        $amrc = 'African Cluster Centre (AMRC)';
        $coop = 'Cooperation partner';
        $glob = 'Global partner Centre of African Studies';
        return [
            // AMRCs + privileged partner.
            ['category' => 'amrc', 'latitude' => 49.9457, 'longitude' => 11.5775, 'label' => 'University of Bayreuth', 'sublabel' => 'Cluster lead'],
            ['category' => 'amrc', 'latitude' => 12.3714, 'longitude' => -1.5197, 'label' => 'Université Joseph Ki-Zerbo', 'sublabel' => $amrc],
            ['category' => 'amrc', 'latitude' => 6.5244, 'longitude' => 3.3792, 'label' => 'University of Lagos', 'sublabel' => $amrc],
            ['category' => 'amrc', 'latitude' => 0.5143, 'longitude' => 35.2698, 'label' => 'Moi University', 'sublabel' => $amrc],
            ['category' => 'amrc', 'latitude' => -33.3117, 'longitude' => 26.5197, 'label' => 'Rhodes University', 'sublabel' => $amrc],
            ['category' => 'amrc', 'latitude' => -12.9974, 'longitude' => -38.5124, 'label' => 'Centro de Estudos Afro-Orientais (CEAO) at the Universidade Federal da Bahia (UFBA)', 'sublabel' => 'Privileged partner'],
            // Cooperation partners.
            ['category' => 'cooperation', 'latitude' => 44.8073, 'longitude' => -0.6024, 'label' => 'Les Afriques dans le Monde (LAM), Sciences Po Bordeaux', 'sublabel' => $coop],
            ['category' => 'cooperation', 'latitude' => 14.6921, 'longitude' => -17.4467, 'label' => 'Council for the Development of Social Science Research in Africa (CODESRIA), Dakar, Senegal', 'sublabel' => $coop],
            ['category' => 'cooperation', 'latitude' => 6.4156, 'longitude' => 2.3447, 'label' => 'Université d’Abomey-Calavi, Cotonou, Benin', 'sublabel' => $coop],
            ['category' => 'cooperation', 'latitude' => -6.779, 'longitude' => 39.2083, 'label' => 'University of Dar es Salaam, Tanzania', 'sublabel' => $coop],
            ['category' => 'cooperation', 'latitude' => 33.9716, 'longitude' => -6.8498, 'label' => 'Mohammed V University of Rabat, Morocco', 'sublabel' => $coop],
            ['category' => 'cooperation', 'latitude' => 35.8245, 'longitude' => 10.6346, 'label' => 'Université de Sousse, Tunisia', 'sublabel' => $coop],
            ['category' => 'cooperation', 'latitude' => -25.951, 'longitude' => 32.6053, 'label' => 'Universidade Eduardo Mondlane, Maputo, Mozambique', 'sublabel' => $coop],
            ['category' => 'cooperation', 'latitude' => 37.5973, 'longitude' => 127.0586, 'label' => 'Institute of African Studies, Hankuk University of Foreign Studies, Seoul, South Korea', 'sublabel' => $coop],
            ['category' => 'cooperation', 'latitude' => 28.5403, 'longitude' => 77.167, 'label' => 'Centre for African Studies, Jawaharlal Nehru University, New Delhi, India', 'sublabel' => $coop],
            ['category' => 'cooperation', 'latitude' => 12.6392, 'longitude' => -8.0029, 'label' => 'Point Sud — Centre for Research on Local Knowledge, Bamako, Mali', 'sublabel' => $coop],
            ['category' => 'cooperation', 'latitude' => 5.651, 'longitude' => -0.1864, 'label' => 'Merian Institute for Advanced Studies in Africa (MIASA), University of Ghana, Legon', 'sublabel' => $coop],
            // Global partner Centers of African Studies.
            ['category' => 'global', 'latitude' => 45.5048, 'longitude' => -73.6131, 'label' => 'Université de Montréal, Canada', 'sublabel' => $glob],
            ['category' => 'global', 'latitude' => 43.6629, 'longitude' => -79.3957, 'label' => 'University of Toronto, Canada', 'sublabel' => $glob],
            ['category' => 'global', 'latitude' => 39.1683, 'longitude' => -86.5235, 'label' => 'African Studies Program, Indiana University Bloomington, USA', 'sublabel' => $glob],
            ['category' => 'global', 'latitude' => 20.0263, 'longitude' => -75.8242, 'label' => 'Universidad de Oriente (UO), Santiago de Cuba, Cuba', 'sublabel' => $glob],
            ['category' => 'global', 'latitude' => 9.9377, 'longitude' => -84.05, 'label' => 'Universidad de Costa Rica (UCR), San José, Costa Rica', 'sublabel' => $glob],
            ['category' => 'global', 'latitude' => 10.4236, 'longitude' => -75.544, 'label' => 'Universidad de Cartagena, Colombia', 'sublabel' => $glob],
            ['category' => 'global', 'latitude' => 35.0264, 'longitude' => 135.7813, 'label' => 'Center for African Area Studies, Kyoto University, Japan', 'sublabel' => $glob],
            ['category' => 'global', 'latitude' => -32.0058, 'longitude' => 115.8949, 'label' => 'Curtin University, Perth, Australia', 'sublabel' => $glob],
            ['category' => 'global', 'latitude' => -29.8676, 'longitude' => 30.981, 'label' => 'African Institute in Indigenous Knowledge Systems, University of KwaZulu-Natal, Durban, South Africa', 'sublabel' => $glob],
        ];
    }
}
