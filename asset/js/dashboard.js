/**
 * Dashboard orchestrator.
 *
 * Reads chart builders, layouts, labels, and descriptions from
 * the window.RV namespace (populated by the modular JS files)
 * and wires up async + inline dashboard rendering.
 *
 * Load order:
 *   1. dashboard-core.js          (THEME, COLORS, helpers)
 *   2. dashboard-layouts.js       (per-resource-type layouts)
 *   3. dashboard-charts-basic.js  (timeline, pie, bar, word cloud)
 *   4. dashboard-charts-advanced.js (gantt, heatmap, chord, sankey, sunburst, stacked)
 *   5. dashboard-charts-map.js    (geographic map, mini map)
 *   6. dashboard-collab-network.js (collaboration network)
 *   7. dashboard-registry.js      (CHART_MAP, labels, descriptions)
 *   8. dashboard.js               (this file — orchestrator)
 */
(function () {
    'use strict';

    var ns = window.RV;
    if (!ns) return;
    var escapeHtml = ns.escapeHtml || function (value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
        });
    };

    /* ------------------------------------------------------------------ */
    /*  Render dashboard                                                   */
    /* ------------------------------------------------------------------ */

    function renderDashboard(container, data, siteBase, collapsible) {
        // A block template may pin a specific layout via `data-layout` (e.g. the
        // curated "Collection Overview" sets data-layout="collectionOverview" so
        // it renders a trimmed subset of the same JSON the full "Collection
        // Dashboard" shows). Otherwise fall back to the data's own resourceType.
        var layoutKey = (container && container.dataset && container.dataset.layout) || data.resourceType;
        var layout = (ns.LAYOUTS && ns.LAYOUTS[layoutKey]) || ns.DEFAULT_LAYOUT;
        var chartKeys = layout.order;

        // Single-visualization embed: the bare /dre-embed/<block>/<viz> route pins
        // one chart via data-chart-only. Render just that chart — full-bleed, and
        // with no stat cards, dashboard header, or collapsible accordion. The key
        // need not be in this layout's order; the builder loop below still resolves
        // it from the registry and renders it if the JSON carries its data.
        var chartOnly = (container && container.dataset && container.dataset.chartOnly) || '';
        if (chartOnly) {
            chartKeys = [chartOnly];
            collapsible = false;
        }

        // Optional per-dashboard overrides over the shared registry: retitle a
        // chart (`labels`), reword its subheader (`descriptions`), or swap its
        // builder (`builders`, e.g. the Publications page renders Languages as a
        // pie instead of the registry's bar). Absent on every other dashboard, so
        // they all keep the registry defaults unchanged.
        var labelOverrides = data.labels || {};
        var descOverrides = data.descriptions || {};
        var builderOverrides = data.builders || {};

        // Summary stat cards. The home "Collection Overview" layout OMITS them: the
        // DRE theme's home banner renders the same stat set (read from this very
        // precompute), so drawing them here too would duplicate the cards on the
        // home page. Every other dashboard that carries a `stats` array — the full
        // Collection Dashboard, Publications, YouTube — keeps its cards.
        var statsHtml = (!chartOnly && ns.renderStatCards && data.stats && layoutKey !== 'collectionOverview')
            ? ns.renderStatCards(data.stats) : '';

        // Header title. Defaults to "Visualisations" (Publications, YouTube,
        // Collection Dashboard, item-page dashboards) unless the block template
        // pins its own via `data-title` — the curated "Collection Overview"
        // names itself "Collection overview" so its heading matches the block.
        var headTitle = (container && container.dataset && container.dataset.title) || 'Visualisations';
        var headInner = '<h2>' + escapeHtml(headTitle) + '</h2>';

        var chartsHtml = '<div class="dashboard-charts' + (chartOnly ? ' dashboard-charts--single' : '') + '">';
        chartKeys.forEach(function (key) {
            var d = data[key];
            var hasData = Array.isArray(d) ? d.length > 0 : (d && Object.keys(d).length > 0);
            // The geographic map ('locations') also renders a current-location
            // overlay, so keep its panel when only current locations are present
            // (an item held somewhere with no recorded origin).
            if (key === 'locations' && !hasData && data.currentLocations && data.currentLocations.length) {
                hasData = true;
            }
            if (!hasData) return;
            // Skip basic timeline when stacked timeline is available (redundant) —
            // unless a single-chart embed explicitly asked for the basic timeline.
            if (!chartOnly && key === 'timeline' && data.stackedTimeline && data.stackedTimeline.years && data.stackedTimeline.years.length > 0) return;
            // A single-chart embed fills the frame: always full-width and tall.
            var wide = (chartOnly || layout.wide.indexOf(key) >= 0) ? ' chart-panel-wide' : '';
            var tall = (chartOnly || layout.tall.indexOf(key) >= 0) ? ' chart-container-tall' : '';
            var label = labelOverrides[key] || (ns.CHART_LABELS && ns.CHART_LABELS[key]) || key;
            var desc = Object.prototype.hasOwnProperty.call(descOverrides, key)
                ? descOverrides[key]
                : ((ns.CHART_DESCRIPTIONS && ns.CHART_DESCRIPTIONS[key]) || '');
            chartsHtml += '<div class="chart-panel' + wide + '">'
                + '<h3>' + escapeHtml(label) + '</h3>'
                + (desc ? '<p class="chart-description">' + escapeHtml(desc) + '</p>' : '')
                + '<div class="chart-container' + tall + '" data-chart="' + key + '"></div>'
                + '</div>';
        });
        chartsHtml += '</div>';

        // The async dashboards (Collection Overview, Publications, item-page
        // Visualisations) wrap their header + charts in a collapsible disclosure
        // that matches the DRE theme's "Linked resources" accordion. The shared
        // render path (inline mode, Project Explorer) leaves `collapsible`
        // undefined and keeps the flat layout it has always used.
        if (collapsible) {
            container.innerHTML = '<details class="rv-collapsible" open>'
                + '<summary class="rv-collapsible__head">'
                + headInner
                + '<span class="rv-collapsible__chevron" aria-hidden="true"></span>'
                + '</summary>'
                + '<div class="rv-collapsible__panel">'
                + statsHtml
                + chartsHtml
                + '</div>'
                + '</details>';
        } else {
            container.innerHTML = statsHtml
                + (chartOnly ? '' : '<div class="dashboard-header">' + headInner + '</div>')
                + chartsHtml;
        }

        chartKeys.forEach(function (key) {
            var el = container.querySelector('[data-chart="' + key + '"]');
            if (!el || !data[key]) return;
            // Honour a per-dashboard builder override, else the registry default.
            var builderName = builderOverrides[key];
            var builder = (builderName && ns.charts && ns.charts[builderName])
                || (ns.CHART_MAP && ns.CHART_MAP[key]);
            if (!builder) return;
            var chart = builder(el, data[key], siteBase, data);
            if (chart) {
                ns.attachToolbar(el.closest('.chart-panel'), chart);
            }
        });

        // Single-chart embed for a key with no data in this JSON (or an unknown
        // key): leave a quiet note instead of a blank frame.
        if (chartOnly && !container.querySelector('[data-chart]')) {
            container.innerHTML = '<p class="rv-embed-empty">'
                + 'No data available for this visualization.</p>';
        }

        // Live-site only: add a copy-embed-code button to each chart on an
        // embeddable dashboard (no-op elsewhere). Shared impl in dashboard-core.js.
        if (ns.addEmbedButtons) ns.addEmbedButtons(container);

        // Window resizing + light/dark theme changes are handled globally in
        // dashboard-core.js (ns.refresh / the global resize handler). Re-fitting
        // charts after a collapsed panel re-opens is handled by the `toggle`
        // listener there too.
    }

    // Expose the render loop so other controllers (e.g. Project Explorer) reuse
    // the exact item-page renderer instead of duplicating it.
    ns.renderInto = renderDashboard;

    /* ------------------------------------------------------------------ */
    /*  Async dashboard (precomputed JSON)                                 */
    /* ------------------------------------------------------------------ */

    function initAsyncDashboard(container) {
        var itemId = container.dataset.itemId;
        var basePath = container.dataset.basePath || '';
        var siteBase = container.dataset.siteBase || '';
        ns.basePath = basePath; // expose for builders that load module assets (e.g. choropleth GeoJSON)
        var moduleBase = basePath + '/modules/DreVisualizations/asset/data/';
        var url = moduleBase + 'item-dashboards/' + itemId + '.json';

        fetch(url).then(function (r) {
            if (!r.ok) throw new Error('not found');
            return r.json();
        }).then(function (data) {
            if (!data || !data.totalItems) { container.innerHTML = ''; return; }
            container.innerHTML = '';
            renderDashboard(container, data, siteBase, true);
        }).catch(function () { container.innerHTML = ''; });
    }

    /* ------------------------------------------------------------------ */
    /*  Inline dashboard (data-dashboard attribute)                        */
    /* ------------------------------------------------------------------ */

    function initInlineDashboard(container) {
        var raw = container.getAttribute('data-dashboard');
        if (!raw) return;
        var data;
        try { data = JSON.parse(raw); } catch (e) { return; }
        var siteBase = container.dataset.siteBase || '';
        renderDashboard(container.parentElement || container, data, siteBase);
    }

    /* ------------------------------------------------------------------ */
    /*  Init                                                               */
    /* ------------------------------------------------------------------ */

    // Lazy-mount: render a dashboard only once it nears the viewport, loading the
    // heavy chart/map libraries on demand at that moment (ns.ensureLibs). Home and
    // landing dashboards sit below the fold, so this keeps ECharts + MapLibre and
    // the chart-render work off the initial load entirely. A dashboard already in
    // view (a dedicated dashboard page, or libraries loaded eagerly) fires the
    // observer at once and ensureLibs resolves immediately — unchanged there.
    function mountWhenVisible(container, render) {
        var run = function () {
            (ns.ensureLibs ? ns.ensureLibs() : Promise.resolve()).then(render).catch(function () {});
        };
        if (!('IntersectionObserver' in window)) { run(); return; }
        var io = new IntersectionObserver(function (entries) {
            for (var i = 0; i < entries.length; i++) {
                if (entries[i].isIntersecting) { io.disconnect(); run(); break; }
            }
        }, { rootMargin: '600px 0px' });
        io.observe(container);
    }

    function init() {
        var async = document.querySelectorAll('.dashboard-async-container');
        for (var i = 0; i < async.length; i++) {
            (function (c) { mountWhenVisible(c, function () { initAsyncDashboard(c); }); })(async[i]);
        }
        var inline = document.querySelectorAll('.dashboard-container');
        for (var j = 0; j < inline.length; j++) {
            (function (c) { mountWhenVisible(c, function () { initInlineDashboard(c); }); })(inline[j]);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
