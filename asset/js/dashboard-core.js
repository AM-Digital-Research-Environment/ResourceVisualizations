/**
 * Dashboard core: shared design tokens, helpers, and utilities.
 *
 * Initialises the window.RV namespace and exposes THEME, COLORS,
 * and helper functions used by all chart modules.
 *
 * THEMING — follows the DRE theme.
 * ----------------------------------------------------------------------------
 * Chart colours are NOT hard-coded here; they are read at runtime from the
 * Africa Multiple "Digital Research Environment" theme's CSS custom properties
 * (design tokens):
 *   https://github.com/AM-Digital-Research-Environment/DRE-theme
 *
 * `readTheme()` resolves the theme tokens (--primary, --ink, --surface, …) into
 * the shared THEME object and builds an ECharts theme from them. Because the
 * theme re-defines those tokens for dark mode (on `body[data-theme="dark"]`
 * and `@media (prefers-color-scheme: dark)`), the module follows the active
 * light / dark theme — including the live theme toggle, watched below via a
 * MutationObserver — by re-reading the tokens and calling `chart.setTheme()`
 * (ECharts 6) on every live chart and rebuilding every map.
 *
 * ►► Resolve colours through `ns.cssColor('--token', fallback)` — never add a
 *    raw hex value that won't react to the theme. ◄◄
 */
(function () {
    'use strict';

    var ns = window.RV = window.RV || {};

    // Categorical palette for multi-series charts — led by the Africa Multiple
    // cluster brand colours, then harmonious extensions for charts with many
    // series. Rebuilt per light/dark by readTheme() (via buildPalette) and
    // mutated IN PLACE so modules that captured a reference see the update.
    // Compare-mode still relies on a stable colour-by-index mapping.
    //
    //   Cluster brand: Uni-Grün #009260 · Gelb #F59C08 · Hellblau #44B8F2 ·
    //                  Braun #D57912 · Dunkelblau #00268A · Gold #CCA352
    //
    // The dark variant lifts the two darkest brand hues (Uni-Grün, Dunkelblau),
    // which are near-invisible on the forest-dark surface, and nudges the rest
    // lighter so every series stays legible.
    ns._PALETTE_LIGHT = [
        '#009260', '#f59c08', '#44b8f2', '#d57912', '#00268a', '#cca352',
        '#0e7c71', '#8a4fb0', '#6fa82e', '#b0392e', '#2e6fe0', '#8c6a2b'
    ];
    ns._PALETTE_DARK = [
        '#1fb083', '#f7ae3a', '#7ccbf7', '#ec9a4d', '#6e8ce8', '#dcc084',
        '#3fb8a5', '#b49be6', '#9ccb4e', '#e8705a', '#6ba0f2', '#cba45e'
    ];

    /** The cluster categorical palette for the given mode (fresh copy). */
    ns.buildPalette = function (dark) {
        return (dark ? ns._PALETTE_DARK : ns._PALETTE_LIGHT).slice();
    };

    ns.COLORS = ns.buildPalette(false);

    // Community-halo ring palette (knowledge graph). A ring encodes the node's
    // co-occurrence community while the fill encodes its entity type, so the
    // halos are deliberately DISTINCT from the categorical fills above — but
    // they stay in the same warm "pigment" world as the brand (no Material
    // pink/indigo). Light mode uses deep pigment-pot tones, inkier than every
    // fill, so rings read as drawn outlines on the warm-stone surface; dark
    // mode lifts the same hue stations luminous for the forest surface.
    // Rebuilt per mode by readTheme() and mutated IN PLACE like COLORS, so the
    // graph's _rvRebuild re-colours rings on every light/dark toggle.
    ns._HALO_LIGHT = [
        '#8e2a4c', // wine
        '#9a4a16', // sienna
        '#67701f', // moss
        '#11607e', // petrol
        '#44549b', // slate indigo
        '#7b2f86', // plum
        '#6f4a1d', // cocoa
        '#a83a68'  // magenta clay
    ];
    ns._HALO_DARK = [
        '#e87b9b', // rose
        '#dd8a55', // copper
        '#bdc24f', // chartreuse
        '#54b2d8', // cyan
        '#9b9bee', // periwinkle
        '#c873d2', // orchid
        '#d4a878', // sand
        '#e388b9'  // pink clay
    ];

    /** The community-halo ring palette for the given mode (fresh copy). */
    ns.buildHaloPalette = function (dark) {
        return (dark ? ns._HALO_DARK : ns._HALO_LIGHT).slice();
    };

    ns.HALO = ns.buildHaloPalette(false);

    // Shared design tokens. Colour values are placeholders here; readTheme()
    // overwrites them in place (so modules that captured `ns.THEME` see updates)
    // from the DRE theme's CSS variables on load and on every theme change.
    ns.THEME = {
        accent: '#22817b',        // ← --primary
        accentDark: '#1a655f',    // ← --primary-hover
        accentLight: '#b2dfdb',   // ← --primary-muted
        gradientEnd: '#b2dfdb',   // ← --primary-muted (bar/area gradient tail)
        text: '#333',             // ← --ink (primary chart text)
        textMuted: '#666',        // ← --ink-light (axis labels, secondary)
        heading: '#222',          // ← --ink-strong
        border: '#fff',           // ← --surface (segment gaps, marker strokes)
        grid: '#e0e0e0',          // ← --border (axis lines)
        gridLight: '#f0f0f0',     // ← --border-light (split lines)
        surface: '#fafafa',       // ← --surface (export background)
        fontFamily: 'system-ui, sans-serif',  // ← --font-body (in-chart UI text)
        fontDisplay: 'Georgia, serif',        // ← --font-display (in-canvas titles)
        fontSize: 12,   // Hanken sits visually smaller than the canvas default at 11
        fontSizeTitle: 14,
        fontSizeEmphasis: 13,
        labelMaxLen: 30,
        barMaxWidth: 24,
        barMaxWidthWide: 40
    };

    ns._allCharts = [];   // tracked ECharts instances
    ns._allMaps = [];     // tracked MapLibre maps: { map, rebuild }
    ns._echartsTheme = null;
    ns._darkMode = false;
    ns.basePath = '';     // Omeka base path, set by the dashboard orchestrator

    /** Resolve a module asset (under asset/) to an absolute URL, e.g.
     *  ns.moduleAsset('data/geo/countries.geojson'). Needs ns.basePath. */
    ns.moduleAsset = function (path) {
        return ns.basePath + '/modules/DreVisualizations/asset/' + path;
    };

    /* ------------------------------------------------------------------ */
    /*  Lazy library loader                                                */
    /* ------------------------------------------------------------------ */

    /**
     * Inject the heavy chart/map libraries (ECharts + the word-cloud plugin, and
     * MapLibre with its CSS) on demand, returning a cached Promise that resolves
     * once they are ready. The orchestrator calls this just before it renders a
     * dashboard that has scrolled into view, so a page that never reaches its
     * (below-the-fold) dashboard pays nothing for ~650 KiB of JS or the chart
     * render work.
     *
     * URLs come from window.RV_LIBS (emitted by the DashboardAssets helper on the
     * lazy surfaces). When the libraries were instead loaded eagerly — the
     * dedicated dashboard pages, or item pages via Module.php — `echarts` is
     * already defined and this resolves immediately, so behaviour is unchanged.
     */
    ns.ensureLibs = function () {
        if (ns._libsPromise) return ns._libsPromise;
        if (typeof echarts !== 'undefined') {
            ns._libsPromise = Promise.resolve();
            return ns._libsPromise;
        }
        var cfg = window.RV_LIBS || {};
        var head = document.head || document.getElementsByTagName('head')[0];

        function loadScript(src) {
            return new Promise(function (resolve, reject) {
                if (!src) { resolve(); return; }
                var existing = head.querySelector('script[src="' + src + '"]');
                if (existing) {
                    if (existing.dataset.rvLoaded) { resolve(); return; }
                    existing.addEventListener('load', function () { resolve(); });
                    existing.addEventListener('error', reject);
                    return;
                }
                var s = document.createElement('script');
                s.src = src;
                s.onload = function () { s.dataset.rvLoaded = '1'; resolve(); };
                s.onerror = reject;
                head.appendChild(s);
            });
        }

        function loadStyle(href) {
            if (!href || head.querySelector('link[href="' + href + '"]')) return;
            var l = document.createElement('link');
            l.rel = 'stylesheet';
            l.href = href;
            head.appendChild(l);
        }

        loadStyle(cfg.maplibreCss);
        // ECharts first (the word-cloud plugin extends it); MapLibre in parallel.
        ns._libsPromise = loadScript(cfg.echarts).then(function () {
            return Promise.all([loadScript(cfg.wordcloud), loadScript(cfg.maplibre)]);
        });
        return ns._libsPromise;
    };

    /* ------------------------------------------------------------------ */
    /*  Theme-token resolution                                             */
    /* ------------------------------------------------------------------ */

    // Hidden probe + 1px canvas, used to resolve CSS custom properties — which
    // are oklch()/color-mix() in the DRE theme — into a plain sRGB string in the
    // *currently active* theme. This matters: zrender (ECharts) and MapLibre both
    // FAIL to parse oklch()/oklab(), so handing them the raw token makes text and
    // shapes fall back to wrong colours. We must rasterise to rgb() ourselves.
    var _probe = null;
    var _ctx = null;

    function getProbe() {
        if (!_probe) {
            _probe = document.createElement('span');
            _probe.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:0;height:0;pointer-events:none';
        }
        // Keep the probe parented to <body> so it inherits the active
        // body[data-theme] cascade (it may be created before <body> exists).
        var host = document.body || document.documentElement;
        if (host && _probe.parentNode !== host) host.appendChild(_probe);
        return _probe;
    }

    /**
     * Rasterise any browser-parseable CSS colour (incl. oklch()/oklab()/
     * color-mix()) to a plain rgb()/rgba() string that zrender and MapLibre
     * can parse.
     */
    ns.toRGB = function (color) {
        if (!_ctx) {
            var cv = document.createElement('canvas');
            cv.width = cv.height = 1;
            _ctx = cv.getContext('2d', { willReadFrequently: true });
        }
        _ctx.clearRect(0, 0, 1, 1);
        _ctx.fillStyle = '#000';
        _ctx.fillStyle = color;            // browser parses oklch/color-mix here
        _ctx.fillRect(0, 0, 1, 1);
        var d = _ctx.getImageData(0, 0, 1, 1).data;
        if (d[3] === 0) return 'rgba(0,0,0,0)';
        if (d[3] === 255) return 'rgb(' + d[0] + ',' + d[1] + ',' + d[2] + ')';
        return 'rgba(' + d[0] + ',' + d[1] + ',' + d[2] + ',' + (d[3] / 255).toFixed(3) + ')';
    };

    /**
     * Resolve a CSS custom property to a plain rgb()/rgba() colour string.
     * @param {string} name  e.g. '--primary'
     * @param {string} fallback  used when the host theme lacks the token
     */
    ns.cssColor = function (name, fallback) {
        fallback = fallback || '#000';
        try {
            var probe = getProbe();
            probe.style.color = '';
            probe.style.color = 'var(' + name + ', ' + fallback + ')';
            var resolved = getComputedStyle(probe).color;
            return ns.toRGB(resolved || fallback) || fallback;
        } catch (e) {
            return fallback;
        }
    };

    /**
     * Resolve a CSS custom property holding a font stack (e.g. --font-body)
     * to the active theme's computed font-family string. Unlike colours this
     * needs no rasterising — canvas font shorthand accepts a stack directly.
     */
    ns.cssFont = function (name, fallback) {
        try {
            var probe = getProbe();
            probe.style.fontFamily = '';
            probe.style.fontFamily = 'var(' + name + ', ' + fallback + ')';
            return getComputedStyle(probe).fontFamily || fallback;
        } catch (e) {
            return fallback;
        }
    };

    /** Parse an 'rgb(r,g,b)' / 'rgba(...)' string to a [r,g,b] array. */
    function _parseRGB(s) {
        var m = /(\d+)\D+(\d+)\D+(\d+)/.exec(s || '');
        return m ? [+m[1], +m[2], +m[3]] : [0, 0, 0];
    }

    /** Lerp between two browser-parseable colours (incl. oklch / var()); → 'rgb()'. */
    ns.mix = function (a, b, t) {
        var pa = _parseRGB(ns.toRGB(a)), pb = _parseRGB(ns.toRGB(b));
        return 'rgb(' + Math.round(pa[0] + (pb[0] - pa[0]) * t) + ','
            + Math.round(pa[1] + (pb[1] - pa[1]) * t) + ','
            + Math.round(pa[2] + (pb[2] - pa[2]) * t) + ')';
    };

    /**
     * Five-stop sequential ramp from a faint surface tint (low values) to the
     * brand accent / Uni-Grün (high values), resolved for the ACTIVE theme. Use
     * for heatmap / density visualMaps so low cells sit quietly on the panel and
     * the ramp follows light / dark instead of being locked to a light palette.
     */
    ns.accentRamp = function () {
        var base = ns.cssColor('--surface', ns._darkMode ? '#1e1e1e' : '#ffffff');
        return [0.86, 0.65, 0.44, 0.22, 0].map(function (r) {
            return ns.mix(ns.THEME.accent, base, r);
        });
    };

    /** Whether the active theme is dark: body[data-theme] wins, else system. */
    ns.isDark = function () {
        var attr = document.body && document.body.getAttribute('data-theme');
        if (attr === 'dark') return true;
        if (attr === 'light') return false;
        return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    };

    /** Read DRE theme tokens into THEME (in place) and rebuild the ECharts theme. */
    ns.readTheme = function () {
        ns._darkMode = ns.isDark();

        // Re-point the categorical palette to the active light/dark cluster set,
        // mutating the array in place so captured references stay valid.
        var pal = ns.buildPalette(ns._darkMode);
        ns.COLORS.length = 0;
        Array.prototype.push.apply(ns.COLORS, pal);

        // Same in-place swap for the knowledge-graph community halo rings.
        var halo = ns.buildHaloPalette(ns._darkMode);
        ns.HALO.length = 0;
        Array.prototype.push.apply(ns.HALO, halo);

        var t = ns.THEME;
        var c = ns.cssColor;

        // Type follows the DRE theme: Hanken Grotesk for in-chart UI text,
        // Spectral for the rare in-canvas title — same stacks the page uses,
        // with the theme's own fallbacks for non-DRE hosts.
        t.fontFamily = ns.cssFont('--font-body',
            '"Hanken Grotesk", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif');
        t.fontDisplay = ns.cssFont('--font-display',
            '"Spectral", Georgia, "Times New Roman", serif');

        t.accent      = c('--primary', '#22817b');
        t.accentDark  = c('--primary-hover', '#1a655f');
        t.accentLight = c('--primary-muted', '#b2dfdb');
        t.gradientEnd = c('--primary-muted', '#b2dfdb');
        t.text        = c('--ink', ns._darkMode ? '#e0e0e0' : '#333333');
        t.textMuted   = c('--ink-light', ns._darkMode ? '#aaaaaa' : '#666666');
        t.heading     = c('--ink-strong', ns._darkMode ? '#f0f0f0' : '#222222');
        t.border      = c('--surface', ns._darkMode ? '#1e1e1e' : '#ffffff');
        t.surface     = t.border;
        t.grid        = c('--border', ns._darkMode ? '#3a3a3a' : '#e0e0e0');
        t.gridLight   = c('--border-light', ns._darkMode ? '#333333' : '#f0f0f0');

        ns._echartsTheme = ns.buildEchartsTheme();
        return t;
    };

    /** Build an ECharts theme object from the resolved THEME tokens. */
    ns.buildEchartsTheme = function () {
        var t = ns.THEME;
        // One clean axis style for every axis type. No split lines and no split
        // areas anywhere: charts read cleanly on the panel surface and bar charts
        // (value axis on the x-axis) no longer get vertical "graph paper" lines.
        // ECharts keeps the baseline on category axes and hides it on value axes
        // by default, which is exactly the clean look we want.
        var axis = {
            axisLine:  { lineStyle: { color: t.grid } },
            axisTick:  { lineStyle: { color: t.grid } },
            axisLabel: { color: t.textMuted, fontFamily: t.fontFamily },
            splitLine: { show: false },
            splitArea: { show: false }
        };
        return {
            color: ns.COLORS,
            backgroundColor: 'transparent',   // let the panel --surface show through
            textStyle: { color: t.text, fontFamily: t.fontFamily },
            title: {
                // In-canvas titles take the display serif, matching the HTML
                // <h4> headings the dashboard renders around the charts.
                textStyle: { color: t.heading, fontFamily: t.fontDisplay },
                subtextStyle: { color: t.textMuted, fontFamily: t.fontFamily }
            },
            legend: {
                textStyle: { color: t.text, fontFamily: t.fontFamily },
                pageTextStyle: { color: t.textMuted }
            },
            tooltip: {
                backgroundColor: ns.cssColor('--surface-raised', t.surface),
                borderColor: t.grid,
                textStyle: { color: t.text, fontFamily: t.fontFamily }
            },
            categoryAxis: axis,
            valueAxis: axis,
            logAxis: axis,
            timeAxis: axis,
            line: { lineStyle: { width: 2 } },
            pie: { itemStyle: { borderColor: t.border, borderWidth: 2 } },
            scatter: { itemStyle: { borderColor: t.border, borderWidth: 1 } },
            graph: {
                itemStyle: { borderColor: t.border },
                lineStyle: { color: t.grid },
                label: { color: t.text, fontFamily: t.fontFamily }
            },
            treemap: {
                itemStyle: { borderColor: t.border },
                breadcrumb: { itemStyle: { color: t.gridLight, textStyle: { color: t.text } } }
            },
            sunburst: { itemStyle: { borderColor: t.border, borderWidth: 1 } },
            heatmap: { itemStyle: { borderColor: t.border, borderWidth: 1 } },
            sankey: {
                label: { color: t.text },
                lineStyle: { color: 'source', opacity: 0.4 }
            },
            visualMap: { textStyle: { color: t.text, fontFamily: t.fontFamily } },
            timeline: {
                lineStyle: { color: t.grid },
                label: { color: t.textMuted, fontFamily: t.fontFamily },
                controlStyle: { color: t.textMuted, borderColor: t.grid }
            }
        };
    };

    /* ------------------------------------------------------------------ */
    /*  Chart / map lifecycle                                              */
    /* ------------------------------------------------------------------ */

    /** Init an ECharts instance using the current theme, tracking it for re-theming. */
    ns.initChart = function (el) {
        if (!ns._echartsTheme) ns.readTheme();
        var chart = echarts.init(el, ns._echartsTheme);
        ns._allCharts.push(chart);
        return chart;
    };

    /**
     * Track a MapLibre map for re-theming. `rebuild` is a zero-arg closure that
     * re-creates the map (with the current basemap + theme colours) into the
     * same container; it is invoked on theme change.
     */
    ns.trackMap = function (map, rebuild) {
        ns._allMaps.push({ map: map, rebuild: rebuild });
        return map;
    };

    /**
     * Mount a map legend BELOW the map — appended to the enclosing .chart-panel,
     * not absolutely positioned over the basemap — so it never covers countries,
     * markers or their labels. One placement shared by every map chart
     * (choropleth, geographic origins, …) for consistency; the cluster-partner
     * map builds its own toggleable legend the same way. Any stale legend (e.g.
     * from the rebuild a light/dark theme toggle triggers) is removed first so
     * duplicates never stack.
     *
     * @param {HTMLElement} el          the container the map was rendered into
     * @param {string}      innerHtml   legend markup
     * @param {string}     [extraClass] extra class, e.g. 'rv-choropleth-legend'
     * @returns {HTMLElement} the legend element
     */
    ns.mountMapLegend = function (el, innerHtml, extraClass) {
        var panel = el.closest('.chart-panel') || el.parentNode || el;
        var stale = panel.querySelector('.rv-map-legend');
        if (stale) stale.remove();
        var legend = document.createElement('div');
        legend.className = 'rv-map-legend' + (extraClass ? ' ' + extraClass : '');
        legend.innerHTML = innerHtml;
        panel.appendChild(legend);
        return legend;
    };

    /** Background colour to use when exporting a chart as a PNG. */
    ns.exportBg = function () {
        return ns.cssColor('--surface', ns._darkMode ? '#1e1e1e' : '#ffffff');
    };

    /** Get the appropriate basemap style URL for the current color scheme. */
    ns.getBasemapStyle = function () {
        return ns._darkMode
            ? 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
            : 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
    };

    /** Remove disposed charts from the tracking array. */
    ns.pruneCharts = function () {
        ns._allCharts = ns._allCharts.filter(function (c) { return !c.isDisposed(); });
    };

    /**
     * Re-apply the active theme to every live chart and map. Triggered when the
     * DRE theme toggles between light and dark (or the system preference does).
     */
    /**
     * Re-assert the ACTIVE theme's resolved style colours (tooltip, legend, base
     * text, axes) onto a chart. Necessary because getOption() pins the PREVIOUS
     * theme's resolved values, so re-applying that option (notMerge) would keep
     * e.g. a light tooltip / light axis labels on the dark theme. A final merge
     * setOption with the fresh theme styles overrides those stale pins — this is
     * what makes the hover tooltip and axes follow light / dark.
     */
    ns._reapplyThemeStyles = function (c) {
        var th = ns._echartsTheme, t = ns.THEME, opt = c.getOption();
        var axisStyle = {
            axisLabel: { color: t.textMuted },
            axisLine: { lineStyle: { color: t.grid } },
            axisTick: { lineStyle: { color: t.grid } }
        };
        var ov = {
            color: ns.COLORS,
            textStyle: { color: t.text },
            tooltip: th.tooltip,
            legend: th.legend,
            title: th.title
        };
        ['xAxis', 'yAxis', 'radiusAxis', 'angleAxis', 'singleAxis', 'parallelAxis'].forEach(function (k) {
            if (opt[k] && opt[k].length) ov[k] = opt[k].map(function () { return axisStyle; });
        });
        c.setOption(ov);
    };

    ns.refresh = function () {
        ns.readTheme();
        ns.pruneCharts();

        // ECharts 6: switch the instance theme live, then re-assert the resolved
        // theme styles. Graph-type charts re-apply their structural (per-node /
        // edge) colours via _rvRebuild; the rest get their option re-applied with
        // notMerge (setTheme's documented caveat after merge-mode setOptions).
        // _reapplyThemeStyles then overrides the stale colours getOption() pinned.
        ns._allCharts.forEach(function (c) {
            try {
                c.setTheme(ns._echartsTheme);
                if (typeof c._rvRebuild === 'function') {
                    c._rvRebuild();
                } else {
                    c.setOption(c.getOption(), { notMerge: true });
                }
                ns._reapplyThemeStyles(c);
            } catch (e) { /* keep going */ }
        });

        // MapLibre: rebuild each map so it picks up the new basemap + colours.
        var maps = ns._allMaps.slice();
        ns._allMaps = [];
        maps.forEach(function (entry) {
            try { if (entry.map && entry.map.remove) entry.map.remove(); } catch (e) { /* noop */ }
            try { if (typeof entry.rebuild === 'function') entry.rebuild(); } catch (e) { /* noop */ }
        });
    };

    /* ------------------------------------------------------------------ */
    /*  Helpers                                                            */
    /* ------------------------------------------------------------------ */

    /** Build a dataZoom config (slider + scroll) for timeline-type charts. */
    ns.buildDataZoom = function (count) {
        if (count <= 15) return [];
        return [
            { type: 'slider', start: 0, end: 100, bottom: 8, height: 22 },
            { type: 'inside' }
        ];
    };

    /** Truncate a string with ellipsis if it exceeds maxLen. */
    ns.truncateLabel = function (str, maxLen) {
        if (!str) return '';
        return str.length > maxLen ? str.substring(0, maxLen) + '…' : str;
    };

    /** Convert either format to array of { name, value, itemId? }. */
    ns.toEntries = function (data) {
        if (!data) return [];
        if (Array.isArray(data)) return data;
        return Object.keys(data).map(function (k) { return { name: k, value: data[k] }; });
    };

    /** Add click-to-navigate and pointer cursor on chart elements. */
    ns.addClickHandler = function (chart, entries, siteBase) {
        if (!siteBase) return;
        chart.on('click', function (params) {
            var entry = entries.find(function (e) { return e.name === params.name; });
            if (entry && entry.itemId) {
                window.location.href = siteBase + '/item/' + entry.itemId;
            }
        });
        chart.getZr().on('mousemove', function (e) {
            chart.getZr().setCursorStyle(e.target ? 'pointer' : 'default');
        });
    };

    /* ------------------------------------------------------------------ */
    /*  Reveal-on-scroll (shared)                                          */
    /*                                                                      */
    /*  Fade + rise elements as they enter the viewport, one-shot. Mirrors  */
    /*  the amira dashboard's revealOnScroll action. Two ways to use it:    */
    /*   - dynamic nodes (e.g. masonry tiles built in JS): call             */
    /*     ns.revealOnScroll(node, {delay}) right after creating them;      */
    /*   - server-rendered nodes: add a `data-rv-reveal="<delayMs>"`        */
    /*     attribute and the auto-init below observes them on load.         */
    /*  The CSS (`[data-reveal=hidden|shown]`) does the actual transition,  */
    /*  and honours prefers-reduced-motion; with JS off, nodes stay visible */
    /*  (no `data-reveal` is ever set).                                     */
    /* ------------------------------------------------------------------ */

    ns._revealObserver = null;
    function revealObserver() {
        if (ns._revealObserver) return ns._revealObserver;
        if (!('IntersectionObserver' in window)) return null;
        ns._revealObserver = new IntersectionObserver(function (entries, obs) {
            entries.forEach(function (e) {
                if (!e.isIntersecting) return;
                var el = e.target;
                var delay = +(el.dataset.rvRevealDelay || 0);
                if (delay > 0) {
                    setTimeout(function () { el.setAttribute('data-reveal', 'shown'); }, delay);
                } else {
                    el.setAttribute('data-reveal', 'shown');
                }
                obs.unobserve(el);
            });
        }, { rootMargin: '0px 0px -8% 0px' });
        return ns._revealObserver;
    }

    var _reducedMotion = !!(window.matchMedia
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    ns.revealOnScroll = function (node, opts) {
        opts = opts || {};
        // Reduced motion (or no IntersectionObserver) → leave the node visible.
        if (_reducedMotion) return;
        var obs = revealObserver();
        if (!obs) return;
        if (opts.delay) node.dataset.rvRevealDelay = String(opts.delay);
        node.setAttribute('data-reveal', 'hidden');
        obs.observe(node);
    };

    function initReveal() {
        var els = document.querySelectorAll('[data-rv-reveal]');
        Array.prototype.forEach.call(els, function (el) {
            var d = parseInt(el.getAttribute('data-rv-reveal'), 10);
            ns.revealOnScroll(el, { delay: isFinite(d) ? d : 0 });
        });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initReveal, { once: true });
    } else {
        initReveal();
    }

    /* -- Global decal toggle state -- */

    ns._decalEnabled = false;

    /** Toggle decal patterns on all tracked ECharts instances (skips charts flagged _noDecal). */
    ns.toggleDecals = function () {
        ns._decalEnabled = !ns._decalEnabled;
        ns.pruneCharts();
        ns._allCharts.forEach(function (c) {
            if (c._noDecal) return;
            c.setOption({ aria: { enabled: true, decal: { show: ns._decalEnabled } } });
        });
        // Update all toggle button states.
        document.querySelectorAll('[data-action="decal"]').forEach(function (btn) {
            btn.classList.toggle('rv-toolbar-btn-active', ns._decalEnabled);
            btn.title = ns._decalEnabled ? 'Hide patterns' : 'Show patterns';
        });
    };

    /** Attach HTML-level toolbar (save + decal toggle) to a chart panel header. */
    ns.attachToolbar = function (panel, chart) {
        if (!chart || !chart.getDataURL) return;
        var showDecal = !chart._noDecal;
        var bar = document.createElement('span');
        bar.className = 'rv-chart-toolbar';
        bar.innerHTML = (showDecal
            ? '<button type="button" class="rv-toolbar-btn' + (ns._decalEnabled ? ' rv-toolbar-btn-active' : '') + '" data-action="decal" title="' + (ns._decalEnabled ? 'Hide patterns' : 'Show patterns') + '">'
            + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="20" x2="20" y2="4"/><line x1="4" y1="14" x2="14" y2="4"/><line x1="4" y1="8" x2="8" y2="4"/><line x1="10" y1="20" x2="20" y2="10"/><line x1="16" y1="20" x2="20" y2="16"/></svg>'
            + '</button>'
            : '')
            + '<button type="button" class="rv-toolbar-btn" data-action="save" title="Save as image">'
            + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'
            + '</button>';
        var h4 = panel.querySelector('h4');
        if (h4) h4.appendChild(bar);
        bar.addEventListener('click', function (e) {
            var btn = e.target.closest('[data-action]');
            if (!btn) return;
            if (btn.dataset.action === 'save') {
                var url = chart.getDataURL({ pixelRatio: 2, backgroundColor: ns.exportBg() });
                var a = document.createElement('a');
                a.href = url;
                a.download = (panel.querySelector('h4').textContent || 'chart').trim() + '.png';
                a.click();
            } else if (btn.dataset.action === 'decal') {
                ns.toggleDecals();
            }
        });
    };

    /** Backward-compatible helpers bundle for external chart modules. */
    ns.helpers = {
        THEME: ns.THEME, COLORS: ns.COLORS,
        initChart: ns.initChart, truncateLabel: ns.truncateLabel
    };

    /* ------------------------------------------------------------------ */
    /*  Theme watchers + global resize                                     */
    /* ------------------------------------------------------------------ */

    var _refreshTimer;
    function scheduleRefresh() {
        clearTimeout(_refreshTimer);
        _refreshTimer = setTimeout(function () {
            if (ns.isDark() !== ns._darkMode) ns.refresh();
        }, 60);
    }

    // Body-dependent setup. This script is injected in <head>, so <body> may not
    // exist yet (the colour probe and the MutationObserver both need it). Defer
    // until the DOM is ready; charts/maps also init on DOMContentLoaded, and
    // initChart() lazily resolves the theme as a safety net.
    function setupThemeWatchers() {
        // Resolve tokens now that <body> exists, so the probe inherits the active
        // body[data-theme] cascade and the first chart renders in the right theme.
        ns.readTheme();

        // The DRE theme toggle sets `data-theme` on <body> (and updates it on
        // system changes when no manual choice is stored). Watching that single
        // attribute covers both the manual toggle and the system-preference path.
        if (window.MutationObserver) {
            new MutationObserver(scheduleRefresh).observe(document.body, {
                attributes: true, attributeFilter: ['data-theme']
            });
        }
        // Fallback for host themes that rely solely on the media query.
        if (window.matchMedia) {
            var mq = window.matchMedia('(prefers-color-scheme: dark)');
            var onMqChange = function () {
                if (!(document.body && document.body.getAttribute('data-theme'))) scheduleRefresh();
            };
            if (mq.addEventListener) mq.addEventListener('change', onMqChange);
            else if (mq.addListener) mq.addListener(onMqChange);
        }
    }

    if (document.body) {
        setupThemeWatchers();
    } else {
        document.addEventListener('DOMContentLoaded', setupThemeWatchers, { once: true });
    }

    // Single global resize handler for all tracked charts + maps.
    var _resizeTimer;
    window.addEventListener('resize', function () {
        clearTimeout(_resizeTimer);
        _resizeTimer = setTimeout(function () {
            ns.pruneCharts();
            ns._allCharts.forEach(function (c) { try { c.resize(); } catch (e) {} });
            ns._allMaps.forEach(function (m) { try { m.map.resize(); } catch (e) {} });
        }, 100);
    });

    // Re-fit charts/maps when a collapsible section (.rv-collapsible) is expanded:
    // a chart sized while its panel was hidden (the closed <details> uses
    // content-visibility) needs a resize once the panel is visible again. The
    // `toggle` event does not bubble, so listen in the capture phase. Mirrors the
    // working knowledge-graph fullscreen resize.
    document.addEventListener('toggle', function (e) {
        var d = e.target;
        if (!d || !d.classList || !d.classList.contains('rv-collapsible') || !d.open) return;
        requestAnimationFrame(function () {
            ns.pruneCharts();
            ns._allCharts.forEach(function (c) { try { c.resize(); } catch (e) {} });
            ns._allMaps.forEach(function (m) { try { m.map.resize(); } catch (e) {} });
        });
    }, true);
})();
