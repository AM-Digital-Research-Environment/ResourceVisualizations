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

    // Categorical palette for multi-series charts. Kept theme-independent: the
    // DRE token set has a 6-colour brand family but charts need up to 20 stable,
    // mutually-distinct hues, and compare-mode relies on a fixed colour-by-index
    // mapping. The brand identity is carried by THEME.accent (= --primary).
    ns.COLORS = [
        '#22817b', '#e07c3e', '#6b5b95', '#d4a574', '#2c5f7c',
        '#c5504d', '#4a8c6f', '#8b6f47', '#7c5295', '#cc8963',
        '#5ba3a0', '#d49b6a', '#8e7cb8', '#e6c9a8', '#4a8aab',
        '#d87e7a', '#6fb08e', '#a68e6d', '#9e7bb8', '#e0a88a'
    ];

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
        fontSize: 11,
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
        var t = ns.THEME;
        var c = ns.cssColor;

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
            axisLabel: { color: t.textMuted },
            splitLine: { show: false },
            splitArea: { show: false }
        };
        return {
            color: ns.COLORS,
            backgroundColor: 'transparent',   // let the panel --surface show through
            textStyle: { color: t.text },
            title: {
                textStyle: { color: t.heading },
                subtextStyle: { color: t.textMuted }
            },
            legend: {
                textStyle: { color: t.text },
                pageTextStyle: { color: t.textMuted }
            },
            tooltip: {
                backgroundColor: ns.cssColor('--surface-raised', t.surface),
                borderColor: t.grid,
                textStyle: { color: t.text }
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
                label: { color: t.text }
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
            visualMap: { textStyle: { color: t.text } },
            timeline: {
                lineStyle: { color: t.grid },
                label: { color: t.textMuted },
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
    ns.refresh = function () {
        ns.readTheme();
        ns.pruneCharts();

        // ECharts 6: switch the instance theme live. Graph-type charts re-apply
        // their structural (per-node/edge) colours via _rvRebuild; the rest get
        // their current option re-applied with notMerge so setTheme can't discard
        // it (the documented caveat after multiple merge-mode setOption calls).
        ns._allCharts.forEach(function (c) {
            try {
                if (typeof c._rvRebuild === 'function') {
                    c.setTheme(ns._echartsTheme);
                    c._rvRebuild();
                } else {
                    var opt = c.getOption();
                    c.setTheme(ns._echartsTheme);
                    c.setOption(opt, { notMerge: true });
                }
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
})();
