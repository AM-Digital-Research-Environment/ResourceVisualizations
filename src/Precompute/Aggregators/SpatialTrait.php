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
     * A location's bubble `count` is the number of DISTINCT items that reference it
     * as either an origin (`dcterms:spatial`) or a current location
     * (`dcterms:provenance`) — read straight from `$reverseLinks[locId]`. Only
     * referenced locations are emitted (an unreferenced place is not worth a bubble).
     *
     * Each location carries the index of its country in the returned `countries`
     * list (or -1 when point-in-polygon found none). Countries are ordered by total
     * item count (densest first) and carry the bounding box of their member points,
     * so the front-end can zoom-to-country without a second geometry lookup.
     *
     * @param array $geo          [locId => ['name'=>, 'lat'=>, 'lon'=>, 'itemId'=>]]
     * @param array $reverseLinks [valueResourceId => [term => [ids]]]
     * @param array $countryIndex [locId => countryName] (from buildCountryIndex)
     * @return array{locations: list<array{0:int,1:string,2:float,3:float,4:int,5:int}>, countries: list<array{0:string,1:int,2:array{0:float,1:float,2:float,3:float}}>}
     */
    public static function buildSpatialPlaces(array $geo, array $reverseLinks, array $countryIndex): array
    {
        // One pass over geocoded locations: distinct-item count + country.
        $rows = [];
        foreach ($geo as $locId => $g) {
            $rev = $reverseLinks[$locId] ?? [];
            $itemSet = [];
            foreach (['dcterms:spatial', 'dcterms:provenance'] as $term) {
                foreach ($rev[$term] ?? [] as $iid) {
                    $itemSet[$iid] = true;
                }
            }
            $count = count($itemSet);
            if ($count === 0) {
                continue; // only plot referenced locations
            }
            $rows[] = [
                'id' => (int) $locId,
                'name' => $g['name'],
                'lat' => (float) $g['lat'],
                'lng' => (float) $g['lon'],
                'count' => $count,
                'country' => $countryIndex[$locId] ?? null,
            ];
        }
        if (!$rows) {
            return ['locations' => [], 'countries' => []];
        }

        // Densest bubbles first (draw order + a sensible default sort for the
        // front-end's "top places" list).
        usort($rows, static fn ($a, $b) => $b['count'] <=> $a['count']);

        // Per-country aggregate: total item count + bounding box of member points.
        $agg = [];
        foreach ($rows as $r) {
            $c = $r['country'];
            if ($c === null) {
                continue;
            }
            if (!isset($agg[$c])) {
                $agg[$c] = ['count' => 0, 'w' => 180.0, 's' => 90.0, 'e' => -180.0, 'n' => -90.0];
            }
            $agg[$c]['count'] += $r['count'];
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
            $locations[] = [$r['id'], $r['name'], $r['lat'], $r['lng'], $r['count'], $ci];
        }
        $countries = [];
        foreach ($countryList as $c) {
            $countries[] = [$c['name'], $c['count'], $c['bounds']];
        }

        return ['locations' => $locations, 'countries' => $countries];
    }

    /**
     * Tally the geocoded places referenced by a set of items, as `[locId => count]`
     * where `count` is the number of distinct items in `$itemIds` that reference the
     * location via `dcterms:spatial` or `dcterms:provenance`. An item that names a
     * place as both origin and current counts once. Returned unsorted; callers sort.
     *
     * This is the per-entity equivalent of {@see self::buildSpatialPlaces}'s global
     * count, used by the Runner to build each picker entity's place adjacency.
     *
     * @param int[] $itemIds
     * @param array $links [id => [[term, label, valueResourceId], ...]]
     * @param array $geo   [locId => ['name'=>, 'lat'=>, 'lon'=>, ...]]
     * @return array<int,int> [locId => distinct-item count]
     */
    public static function placesForItems(array $itemIds, array $links, array $geo): array
    {
        $counts = [];
        foreach ($itemIds as $iid) {
            $seen = [];
            foreach ($links[$iid] ?? [] as [$term, $label, $vrid]) {
                if (($term === 'dcterms:spatial' || $term === 'dcterms:provenance')
                    && isset($geo[$vrid]) && !isset($seen[$vrid])) {
                    $seen[$vrid] = true;
                    $counts[$vrid] = ($counts[$vrid] ?? 0) + 1;
                }
            }
        }
        return $counts;
    }
}
