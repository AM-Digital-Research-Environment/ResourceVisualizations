<?php
declare(strict_types=1);

namespace ResourceVisualizations\Precompute\Aggregators;

/**
 * Geography: country point-in-polygon indexing, the per-country
 * choropleth, and the origin→current geographic flow arcs.
 *
 * Composed into {@see \ResourceVisualizations\Precompute\Aggregators}; its methods
 * reach shared constants and helpers on that class through `self::`.
 */
trait GeoChartsTrait
{
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
}
