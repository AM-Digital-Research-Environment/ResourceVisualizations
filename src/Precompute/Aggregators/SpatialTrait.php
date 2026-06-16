<?php
declare(strict_types=1);

namespace DreVisualizations\Precompute\Aggregators;

/**
 * Spatial Exploration: the collection-wide place index that feeds the
 * cross-cutting Spatial Exploration site-page block (asset/js/spatial-exploration.js).
 *
 * Where {@see GeoChartsTrait} builds per-entity geographic charts (origin→current
 * flow arcs, the per-country choropleth), this trait builds the *browse-the-whole-
 * collection* dataset: every geocoded location as a bubble sized by how many items
 * reference it, the countries those bubbles fall in (with bounds for zoom-to), and
 * a reusable per-entity place tally so the picker can filter the map.
 *
 * Composed into {@see \DreVisualizations\Precompute\Aggregators}.
 */
trait SpatialTrait
{
    /**
     * Global place bubbles + country index for the Spatial Exploration block.
     *
     * Each location carries TWO counts, kept distinct so the front-end can render
     * origins and current locations as separate layers (mirroring the per-entity
     * dashboard map): `origin` = distinct items linking to it via `dcterms:spatial`,
     * `current` = distinct items linking via `dcterms:provenance` — read straight
     * from `$reverseLinks[locId]`. A place that is both gets a tally in each. Only
     * referenced locations are emitted (an unreferenced place is not worth a bubble).
     *
     * Each location carries the index of its country in the returned `countries`
     * list (or -1 when point-in-polygon found none). Countries are ordered by total
     * references (origin + current, densest first) and carry the bounding box of
     * their member points, so the front-end can zoom-to-country without a second
     * geometry lookup.
     *
     * @param array $geo          [locId => ['name'=>, 'lat'=>, 'lon'=>, 'itemId'=>]]
     * @param array $reverseLinks [valueResourceId => [term => [ids]]]
     * @param array $countryIndex [locId => countryName] (from buildCountryIndex)
     * @return array{locations: list<array{0:int,1:string,2:float,3:float,4:int,5:int,6:int}>, countries: list<array{0:string,1:int,2:array{0:float,1:float,2:float,3:float}}>}
     */
    public static function buildSpatialPlaces(array $geo, array $reverseLinks, array $countryIndex): array
    {
        // One pass over geocoded locations: distinct-item origin/current counts + country.
        $rows = [];
        foreach ($geo as $locId => $g) {
            $rev = $reverseLinks[$locId] ?? [];
            $originItems = [];
            foreach ($rev['dcterms:spatial'] ?? [] as $iid) {
                $originItems[$iid] = true;
            }
            $currentItems = [];
            foreach ($rev['dcterms:provenance'] ?? [] as $iid) {
                $currentItems[$iid] = true;
            }
            $originCount = count($originItems);
            $currentCount = count($currentItems);
            if ($originCount === 0 && $currentCount === 0) {
                continue; // only plot referenced locations
            }
            $rows[] = [
                'id' => (int) $locId,
                'name' => $g['name'],
                'lat' => (float) $g['lat'],
                'lng' => (float) $g['lon'],
                'origin' => $originCount,
                'current' => $currentCount,
                'country' => $countryIndex[$locId] ?? null,
            ];
        }
        if (!$rows) {
            return ['locations' => [], 'countries' => []];
        }

        // Densest bubbles first (draw order + a sensible default sort for the
        // front-end's "top places" list).
        usort($rows, static fn ($a, $b) => ($b['origin'] + $b['current']) <=> ($a['origin'] + $a['current']));

        // Per-country aggregate: total references + bounding box of member points.
        $agg = [];
        foreach ($rows as $r) {
            $c = $r['country'];
            if ($c === null) {
                continue;
            }
            if (!isset($agg[$c])) {
                $agg[$c] = ['count' => 0, 'w' => 180.0, 's' => 90.0, 'e' => -180.0, 'n' => -90.0];
            }
            $agg[$c]['count'] += $r['origin'] + $r['current'];
            if ($r['lng'] < $agg[$c]['w']) { $agg[$c]['w'] = $r['lng']; }
            if ($r['lng'] > $agg[$c]['e']) { $agg[$c]['e'] = $r['lng']; }
            if ($r['lat'] < $agg[$c]['s']) { $agg[$c]['s'] = $r['lat']; }
            if ($r['lat'] > $agg[$c]['n']) { $agg[$c]['n'] = $r['lat']; }
        }
        $countryList = [];
        foreach ($agg as $name => $a) {
            $countryList[] = ['name' => $name, 'count' => $a['count'], 'bounds' => [$a['w'], $a['s'], $a['e'], $a['n']]];
        }
        usort($countryList, static fn ($a, $b) => $b['count'] <=> $a['count']);

        $countryIdx = [];
        foreach ($countryList as $i => $c) {
            $countryIdx[$c['name']] = $i;
        }

        // Emit compact row arrays (mirrors entity-graph.json's payload diet).
        $locations = [];
        foreach ($rows as $r) {
            $ci = ($r['country'] !== null && isset($countryIdx[$r['country']])) ? $countryIdx[$r['country']] : -1;
            $locations[] = [$r['id'], $r['name'], $r['lat'], $r['lng'], $r['origin'], $r['current'], $ci];
        }
        $countries = [];
        foreach ($countryList as $c) {
            $countries[] = [$c['name'], $c['count'], $c['bounds']];
        }

        return ['locations' => $locations, 'countries' => $countries];
    }

    /**
     * Tally the geocoded places referenced by a set of items, split by role:
     * `[locId => [originCount, currentCount]]` where `originCount` is the number of
     * distinct items in `$itemIds` linking the location via `dcterms:spatial` and
     * `currentCount` via `dcterms:provenance`. An item that names a place in both
     * roles is counted once in each. Returned unsorted; callers sort.
     *
     * This is the per-entity equivalent of {@see self::buildSpatialPlaces}'s global
     * counts, used by the Runner to build each picker entity's place adjacency.
     *
     * @param int[] $itemIds
     * @param array $links [id => [[term, label, valueResourceId], ...]]
     * @param array $geo   [locId => ['name'=>, 'lat'=>, 'lon'=>, ...]]
     * @return array<int,array{0:int,1:int}> [locId => [originCount, currentCount]]
     */
    public static function placesForItems(array $itemIds, array $links, array $geo): array
    {
        $counts = [];
        foreach ($itemIds as $iid) {
            $seenOrigin = [];
            $seenCurrent = [];
            foreach ($links[$iid] ?? [] as [$term, $label, $vrid]) {
                if (!isset($geo[$vrid])) {
                    continue;
                }
                if ($term === 'dcterms:spatial' && !isset($seenOrigin[$vrid])) {
                    $seenOrigin[$vrid] = true;
                    $counts[$vrid] ??= [0, 0];
                    $counts[$vrid][0]++;
                } elseif ($term === 'dcterms:provenance' && !isset($seenCurrent[$vrid])) {
                    $seenCurrent[$vrid] = true;
                    $counts[$vrid] ??= [0, 0];
                    $counts[$vrid][1]++;
                }
            }
        }
        return $counts;
    }
}
