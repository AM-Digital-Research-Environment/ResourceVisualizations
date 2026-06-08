<?php
declare(strict_types=1);

namespace DreVisualizations\Precompute\Aggregators;

/**
 * Discursive communities: subject co-occurrence graph with Louvain
 * clustering and weighted-PageRank ranking.
 *
 * Composed into {@see \DreVisualizations\Precompute\Aggregators}; its methods
 * reach shared constants and helpers on that class through `self::`.
 */
trait CommunityTrait
{
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
}
