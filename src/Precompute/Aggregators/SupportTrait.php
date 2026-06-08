<?php
declare(strict_types=1);

namespace DreVisualizations\Precompute\Aggregators;

/**
 * Shared, low-level helpers used across the chart builders: list sorting,
 * reverse-link lookups, and the weighted-PageRank / Louvain primitives the
 * network and community graphs share.
 *
 * Composed into {@see \DreVisualizations\Precompute\Aggregators}; its methods
 * reach shared constants and helpers on that class through `self::`.
 */
trait SupportTrait
{
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
}
