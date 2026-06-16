<?php
declare(strict_types=1);

namespace DreVisualizations\Precompute;

/**
 * ForceAtlas2 graph layout — a pure-PHP port of graphology-layout-forceatlas2
 * (the very library the Entity Network used to run live in the browser), so the
 * precompute job can bake node positions and MapLibre renders the graph at zero
 * layout cost.
 *
 * The port mirrors graphology's `iterate.js` exactly for the configuration the
 * front end used via `inferSettings(order)` on a sub-2000-node graph:
 *   - linear repulsion, O(n²) (Barnes-Hut kicks in above 2000 nodes there, and
 *     can be added here when the graph grows to include document nodes);
 *   - strong-gravity mode, gravity 0.05, scaling ratio 10;
 *   - linear attraction with edge-weight influence 1;
 *   - the per-node "convergence" speed in the apply step;
 *   - mass = 1 + weighted degree (graphology folds each incident edge weight in).
 *
 * Positions are seeded on a deterministic golden-angle spiral (the same seed the
 * browser used) so the output is stable across runs — identical every regenerate,
 * which keeps the rendered network and the tests deterministic.
 *
 * After the simulation the plane is centred and rescaled into [-1, 1] (aspect
 * preserved) and projected to pseudo lng/lat through the inverse Web-Mercator,
 * so MapLibre's forward projection reproduces the ForceAtlas2 plane isometrically
 * at every zoom (mirrors IWAC's generate_entity_networks.py).
 */
final class ForceLayout
{
    /** Horizontal extent in degrees of longitude (Mercator x is linear in lng). */
    private const LAYOUT_LNG_EXTENT = 140.0;
    /** Vertical extent of the layout in Mercator radians (±2.2 rad ≈ ±77.6°). */
    private const LAYOUT_MERC_EXTENT = 2.2;

    /**
     * Run ForceAtlas2 and return positions in the centred, aspect-preserving
     * [-1, 1] plane.
     *
     * @param int   $n     Node count.
     * @param array $edges List of [sourceIndex, targetIndex, weight] (0-based indices).
     * @param array $mass  Optional per-index mass (1 + weighted degree). Recomputed
     *                     from $edges when omitted.
     * @param array $opts  Optional overrides: iterations, scalingRatio, gravity,
     *                     strongGravityMode, edgeWeightInfluence, slowDown.
     *
     * @return array<int,array{0:float,1:float}> Position [x, y] per node index.
     */
    public static function layout(int $n, array $edges, array $mass = [], array $opts = []): array
    {
        if ($n <= 0) {
            return [];
        }
        if ($n === 1) {
            return [[0.0, 0.0]];
        }

        // Settings — graphology inferSettings(order) for order <= 2000.
        $scalingRatio = (float) ($opts['scalingRatio'] ?? 10.0);
        $gravity = (float) ($opts['gravity'] ?? 0.05);
        $strongGravity = (bool) ($opts['strongGravityMode'] ?? true);
        $edgeInfluence = (float) ($opts['edgeWeightInfluence'] ?? 1.0);
        $slowDown = (float) ($opts['slowDown'] ?? (1.0 + log($n)));
        // Same iteration schedule the browser used to reach a settled layout.
        $iterations = (int) ($opts['iterations'] ?? ($n > 900 ? 260 : ($n > 300 ? 400 : 520)));

        // Mass = 1 + weighted degree (graphology folds each incident edge weight in).
        if (!$mass) {
            $mass = array_fill(0, $n, 1.0);
            foreach ($edges as [$s, $t, $w]) {
                $mass[$s] += $w;
                $mass[$t] += $w;
            }
        }

        // Deterministic golden-angle spiral seed (the front end's initial spread).
        $x = $y = $dx = $dy = $odx = $ody = $conv = [];
        $ga = M_PI * (3.0 - sqrt(5.0));
        for ($i = 0; $i < $n; $i++) {
            $r = sqrt($i + 1) * 3.0;
            $x[$i] = $r * cos($i * $ga);
            $y[$i] = $r * sin($i * $ga);
            $dx[$i] = $dy[$i] = $odx[$i] = $ody[$i] = 0.0;
            $conv[$i] = 1.0;
            if (!isset($mass[$i])) {
                $mass[$i] = 1.0;
            }
        }

        $coef = $scalingRatio;
        $g = $gravity / $scalingRatio; // graphology divides gravity by scalingRatio
        $linearEdge = ($edgeInfluence === 1.0);

        for ($iter = 0; $iter < $iterations; $iter++) {
            // 1) Save previous forces, reset accumulators.
            for ($i = 0; $i < $n; $i++) {
                $odx[$i] = $dx[$i];
                $ody[$i] = $dy[$i];
                $dx[$i] = 0.0;
                $dy[$i] = 0.0;
            }

            // 2) Repulsion — linear, O(n²). factor = coef·m₁·m₂ / dist².
            for ($a = 0; $a < $n; $a++) {
                $xa = $x[$a];
                $ya = $y[$a];
                $ma = $mass[$a];
                $accX = 0.0;
                $accY = 0.0;
                for ($b = 0; $b < $a; $b++) {
                    $xd = $xa - $x[$b];
                    $yd = $ya - $y[$b];
                    $d2 = $xd * $xd + $yd * $yd;
                    if ($d2 > 0.0) {
                        $f = $coef * $ma * $mass[$b] / $d2;
                        $fx = $xd * $f;
                        $fy = $yd * $f;
                        $accX += $fx;
                        $accY += $fy;
                        $dx[$b] -= $fx;
                        $dy[$b] -= $fy;
                    }
                }
                $dx[$a] += $accX;
                $dy[$a] += $accY;
            }

            // 3) Gravity — strong mode pulls to origin with distance-independent force.
            for ($i = 0; $i < $n; $i++) {
                $xi = $x[$i];
                $yi = $y[$i];
                $dist = sqrt($xi * $xi + $yi * $yi);
                if ($dist > 0.0) {
                    $f = $strongGravity
                        ? $coef * $mass[$i] * $g
                        : $coef * $mass[$i] * $g / $dist;
                    $dx[$i] -= $xi * $f;
                    $dy[$i] -= $yi * $f;
                }
            }

            // 4) Attraction — linear spring along each edge (factor = -weight).
            foreach ($edges as [$s, $t, $w]) {
                $ewc = $linearEdge ? $w : ($w ** $edgeInfluence);
                $xd = $x[$s] - $x[$t];
                $yd = $y[$s] - $y[$t];
                $f = -$ewc;
                $fx = $xd * $f;
                $fy = $yd * $f;
                $dx[$s] += $fx;
                $dy[$s] += $fy;
                $dx[$t] -= $fx;
                $dy[$t] -= $fy;
            }

            // 5) Apply forces with per-node convergence speed.
            for ($i = 0; $i < $n; $i++) {
                $ddx = $dx[$i];
                $ddy = $dy[$i];
                $ox = $odx[$i];
                $oy = $ody[$i];
                $sdx = $ox - $ddx;
                $sdy = $oy - $ddy;
                $swinging = $mass[$i] * sqrt($sdx * $sdx + $sdy * $sdy);
                $tdx = $ox + $ddx;
                $tdy = $oy + $ddy;
                $traction = sqrt($tdx * $tdx + $tdy * $tdy) / 2.0;
                $rootSwing = 1.0 + sqrt($swinging);
                $nodespeed = $conv[$i] * log(1.0 + $traction) / $rootSwing;
                $conv[$i] = min(1.0, sqrt($nodespeed * ($ddx * $ddx + $ddy * $ddy) / $rootSwing));
                $step = $nodespeed / $slowDown;
                $x[$i] += $ddx * $step;
                $y[$i] += $ddy * $step;
            }
        }

        // Centre + rescale into [-1, 1], aspect preserved so clusters aren't
        // stretched anisotropically.
        $xMin = $xMax = $x[0];
        $yMin = $yMax = $y[0];
        for ($i = 1; $i < $n; $i++) {
            if ($x[$i] < $xMin) {
                $xMin = $x[$i];
            }
            if ($x[$i] > $xMax) {
                $xMax = $x[$i];
            }
            if ($y[$i] < $yMin) {
                $yMin = $y[$i];
            }
            if ($y[$i] > $yMax) {
                $yMax = $y[$i];
            }
        }
        $xSpan = ($xMax - $xMin) ?: 1.0;
        $ySpan = ($yMax - $yMin) ?: 1.0;
        $scale = 2.0 / max($xSpan, $ySpan);
        $xOff = ($xMin + $xMax) / 2.0;
        $yOff = ($yMin + $yMax) / 2.0;

        $out = [];
        for ($i = 0; $i < $n; $i++) {
            $out[$i] = [($x[$i] - $xOff) * $scale, ($y[$i] - $yOff) * $scale];
        }
        return $out;
    }

    /**
     * Project a layout coordinate in [-1, 1] to pseudo lng/lat through the
     * inverse Web-Mercator, so MapLibre's forward projection reproduces the
     * layout plane isometrically.
     *
     * @return array{0:float,1:float} [lng, lat]
     */
    public static function toPseudoLngLat(float $x, float $y): array
    {
        $lng = $x * self::LAYOUT_LNG_EXTENT;
        $lat = rad2deg(atan(sinh($y * self::LAYOUT_MERC_EXTENT)));
        return [round($lng, 4), round($lat, 4)];
    }
}
