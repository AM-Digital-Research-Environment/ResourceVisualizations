<?php
namespace DreVisualizations\View\Helper;

use Laminas\View\Helper\AbstractHelper;

/**
 * Appends the module's dashboard front-end assets to the page head.
 *
 * Single source of truth for the chart-builder <script> chain, so registering
 * a new chart touches exactly one place (see {@see self::CHART_SCRIPTS}) instead
 * of every dashboard template. Used by every dashboard surface:
 *   - item / item-set resource-page blocks (CDN + core already injected by
 *     Module.php, so they call it without `cdn`);
 *   - site-page block layouts — Collection Overview, Compare, and the
 *     cross-cutting blocks — which pass `['cdn' => true]` because Module.php
 *     does not run on page controllers.
 *
 * Laminas's headScript()/headLink() de-duplicate by src, so it is safe for
 * several blocks on one page to each request the CDN prelude.
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
        'communities' => ['js/dashboard-communities.js'],
        'whatsNew'    => ['js/dashboard-whats-new.js'],
    ];

    /**
     * @param array $options {
     *     @var bool   $cdn        Inject the CSS + CDN libraries + dashboard-core.js
     *                             prelude. Use on site-page blocks. Default false.
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
                $headScript->appendScript('window.RV_LIBS=window.RV_LIBS||' . json_encode([
                    'echarts'     => $asset(self::ECHARTS_JS),
                    'wordcloud'   => $asset(self::WORDCLOUD_JS),
                    'maplibre'    => $asset(self::MAPLIBRE_JS),
                    'maplibreCss' => $asset(self::MAPLIBRE_CSS),
                ], JSON_UNESCAPED_SLASHES) . ';');
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
