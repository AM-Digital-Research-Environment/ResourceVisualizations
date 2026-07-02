<?php
namespace DreVisualizations\View\Helper;

use Laminas\View\Helper\AbstractHelper;

/**
 * Appends the module's dashboard front-end assets to the page head.
 *
 * Single source of truth for the chart-builder <script> chain, so registering
 * a new chart touches exactly one place (see {@see self::CHART_SCRIPTS}) instead
 * of every dashboard template. Used by every dashboard surface:
 *   - item / item-set resource-page blocks (library URLs + core already
 *     injected by Module.php, so they call it without `cdn`);
 *   - site-page block layouts — Collection Overview, Compare, and the
 *     cross-cutting blocks — which pass `['cdn' => true]` for the legacy option
 *     name because Module.php does not run on page controllers.
 *
 * Laminas's headScript()/headLink() de-duplicate by src, so it is safe for
 * several blocks on one page to each request the library prelude.
 */
class DashboardAssets extends AbstractHelper
{
    // Vendored under asset/vendor/ — self-hosted for same-origin delivery (the
    // Omeka server gzips them to the same wire size jsDelivr served), server-side
    // caching, and no third-party dependency (consistent with the privacy-first
    // posture). Paths are relative to the module asset root: resolve with
    // assetUrl()/the $asset() helper before use. Pinned: echarts 6.1.0,
    // echarts-wordcloud 2.1.0, maplibre-gl 5.24.0.
    const ECHARTS_JS   = 'vendor/echarts.min.js';
    const WORDCLOUD_JS = 'vendor/echarts-wordcloud.min.js';
    const MAPLIBRE_CSS = 'vendor/maplibre-gl.css';
    const MAPLIBRE_JS  = 'vendor/maplibre-gl.js';

    /**
     * The chart-builder chain in load order: layouts first, then every builder
     * (each registers into `window.RV.charts`), then the registry last (which
     * maps the builders into CHART_MAP). Add a new chart's builder file HERE —
     * and nowhere else.
     *
     * @var string[]
     */
    const CHART_SCRIPTS = [
        'js/dashboard-layouts.js',
        'js/dashboard-charts-timeline.js',
        'js/dashboard-charts-pie.js',
        'js/dashboard-charts-bar.js',
        'js/dashboard-charts-histogram.js',
        'js/dashboard-charts-wordcloud.js',
        'js/dashboard-charts-gantt.js',
        'js/dashboard-charts-heatmap.js',
        'js/dashboard-charts-chord.js',
        'js/dashboard-charts-sankey.js',
        'js/dashboard-charts-sunburst.js',
        'js/dashboard-charts-stacked-timeline.js',
        'js/dashboard-charts-beeswarm.js',
        'js/dashboard-charts-map.js',
        'js/dashboard-charts-cluster-map.js',
        'js/dashboard-charts-affiliation-map.js',
        'js/dashboard-collab-network.js',
        'js/dashboard-charts-contributor-network.js',
        'js/dashboard-charts-stacked-area.js',
        'js/dashboard-charts-treemap.js',
        'js/dashboard-charts-geo-flows.js',
        'js/dashboard-charts-choropleth.js',
        'js/dashboard-charts-radar.js',
        'js/dashboard-charts-communities.js',
        'js/dashboard-charts-boxplot.js',
        'js/dashboard-charts-time-chord.js',
        'js/dashboard-stat-cards.js',
        'js/dashboard-registry.js',
    ];

    /**
     * Controller chains, appended after the builder chain.
     *
     * @var array<string, string[]>
     */
    const CONTROLLERS = [
        'dashboard'   => ['js/dashboard.js'],
        'explorer'    => ['js/dashboard.js', 'js/dashboard-explorer.js'],
        'compare'     => ['js/dashboard-compare-unify.js', 'js/dashboard-compare.js'],
        'network'     => ['js/dashboard-network-explorer.js'],
        'communities' => ['js/dashboard-communities.js'],
        'whatsNew'    => ['js/dashboard-whats-new.js'],
    ];

    /**
     * @param array $options {
     *     @var bool   $cdn        Inject the CSS + vendored library URLs/eager
     *                             scripts + dashboard-core.js prelude. Legacy
     *                             option name; use on site-page blocks. Default false.
     *     @var string $controller Controller chain to append after the builders:
     *                             'dashboard' (default), 'compare', or '' / null
     *                             for none (e.g. a block with its own controller).
     * }
     * @return self
     */
    public function __invoke(array $options = [])
    {
        $view = $this->getView();
        $cdn = !empty($options['cdn']);
        $controller = array_key_exists('controller', $options)
            ? $options['controller']
            : 'dashboard';

        $headLink = $view->headLink();
        $headScript = $view->headScript();
        // Defer every script so the ~650 KiB ECharts/MapLibre prelude and the
        // chart-builder chain never block first paint. Deferred scripts still
        // execute in append order, after parsing but before DOMContentLoaded,
        // so the controllers' DOMContentLoaded init() finds every builder
        // already registered — same ordering guarantees as blocking <script>s.
        $defer = ['defer' => true];
        $asset = function ($path) use ($view) {
            return $view->assetUrl($path, 'DreVisualizations');
        };

        // Entity Network (MapLibre) block: a self-contained graph that needs the
        // MapLibre engine (already vendored for the module's maps) plus the theme
        // tokens from dashboard-core.js, but neither the ECharts prelude nor the
        // chart-builder chain. Hand the front end the MapLibre URL and load it on
        // demand through ns.ensureLibs (dashboard-core.js) — the SAME lazy loader
        // the dashboards use — so a page carrying BOTH a dashboard and this graph
        // loads MapLibre exactly once. Object.assign-merge into RV_LIBS so neither
        // block's entry shadows the other's, regardless of block order on the page.
        if (!empty($options['graph'])) {
            $headLink->appendStylesheet($asset('css/dre-visualizations.css'));
            $headScript->appendScript('window.RV_LIBS=Object.assign(' . json_encode([
                'maplibre'    => $asset(self::MAPLIBRE_JS),
                'maplibreCss' => $asset(self::MAPLIBRE_CSS),
            ], JSON_UNESCAPED_SLASHES) . ', window.RV_LIBS||{});');
            $headScript->appendFile($asset('js/dashboard-core.js'), 'text/javascript', $defer);
            $headScript->appendFile($asset('js/entity-graph.js'), 'text/javascript', $defer);
            return $this;
        }

        // Spatial Exploration block: the SAME MapLibre-only stack as the Entity
        // Network graph above (theme tokens from dashboard-core.js + ns.ensureLibs,
        // no ECharts prelude, no chart-builder chain), loading the spatial
        // controller instead. Object.assign-merge into RV_LIBS so a page carrying
        // this block AND a dashboard or graph loads MapLibre exactly once.
        if (!empty($options['spatial'])) {
            $headLink->appendStylesheet($asset('css/dre-visualizations.css'));
            $headScript->appendScript('window.RV_LIBS=Object.assign(' . json_encode([
                'maplibre'    => $asset(self::MAPLIBRE_JS),
                'maplibreCss' => $asset(self::MAPLIBRE_CSS),
            ], JSON_UNESCAPED_SLASHES) . ', window.RV_LIBS||{});');
            $headScript->appendFile($asset('js/dashboard-core.js'), 'text/javascript', $defer);
            $headScript->appendFile($asset('js/spatial-exploration.js'), 'text/javascript', $defer);
            return $this;
        }

        if ($cdn) {
            $headLink->appendStylesheet($asset('css/dre-visualizations.css'));
            if ($controller === 'dashboard') {
                // The default 'dashboard' surface (Collection Overview / Dashboard,
                // Publications) renders as a block on a content page, typically
                // below the fold. Rather than load the ~650 KiB ECharts/MapLibre
                // prelude here, hand the front end the library URLs; dashboard.js
                // injects them and renders only when the dashboard scrolls into
                // view (ns.ensureLibs + IntersectionObserver). dashboard-core.js
                // still loads (deferred) so the theme-token probe and watchers are
                // ready, but it pulls in no heavy library on its own.
                // Object.assign-merge (not ||) so an Entity Network graph block's
                // partial RV_LIBS on the same page can't shadow these (and vice-versa).
                $headScript->appendScript('window.RV_LIBS=Object.assign(' . json_encode([
                    'echarts'     => $asset(self::ECHARTS_JS),
                    'wordcloud'   => $asset(self::WORDCLOUD_JS),
                    'maplibre'    => $asset(self::MAPLIBRE_JS),
                    'maplibreCss' => $asset(self::MAPLIBRE_CSS),
                ], JSON_UNESCAPED_SLASHES) . ', window.RV_LIBS||{});');
                $headScript->appendFile($asset('js/dashboard-core.js'), 'text/javascript', $defer);
            } else {
                // Dedicated dashboard pages (compare / explorer / communities /
                // whatsNew): the dashboard IS the page content and sits in the
                // viewport, so load the libraries eagerly (deferred) up front.
                $headScript->appendFile($asset(self::ECHARTS_JS), 'text/javascript', $defer);
                $headScript->appendFile($asset(self::WORDCLOUD_JS), 'text/javascript', $defer);
                $headLink->appendStylesheet($asset(self::MAPLIBRE_CSS));
                $headScript->appendFile($asset(self::MAPLIBRE_JS), 'text/javascript', $defer);
                $headScript->appendFile($asset('js/dashboard-core.js'), 'text/javascript', $defer);
            }
        }

        foreach (self::CHART_SCRIPTS as $script) {
            $headScript->appendFile($asset($script), 'text/javascript', $defer);
        }

        if ($controller && isset(self::CONTROLLERS[$controller])) {
            foreach (self::CONTROLLERS[$controller] as $script) {
                $headScript->appendFile($asset($script), 'text/javascript', $defer);
            }
        }

        return $this;
    }
}
