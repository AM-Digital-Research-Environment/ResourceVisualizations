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

        // Summary stat cards (Collection Overview only — other dashboards carry
        // no `stats` array, so this is empty for them).
        var statsHtml = (ns.renderStatCards && data.stats) ? ns.renderStatCards(data.stats) : '';

        var headInner = '<h3>Visualisations</h3>';

        var chartsHtml = '<div class="dashboard-charts">';
        chartKeys.forEach(function (key) {
            var d = data[key];
            var hasData = Array.isArray(d) ? d.length > 0 : (d && Object.keys(d).length > 0);
            if (!hasData) return;
            // Skip basic timeline when stacked timeline is available (redundant).
            if (key === 'timeline' && data.stackedTimeline && data.stackedTimeline.years && data.stackedTimeline.years.length > 0) return;
            var wide = layout.wide.indexOf(key) >= 0 ? ' chart-panel-wide' : '';
            var tall = layout.tall.indexOf(key) >= 0 ? ' chart-container-tall' : '';
            var desc = (ns.CHART_DESCRIPTIONS && ns.CHART_DESCRIPTIONS[key]) || '';
            chartsHtml += '<div class="chart-panel' + wide + '">'
                + '<h4>' + ((ns.CHART_LABELS && ns.CHART_LABELS[key]) || key) + '</h4>'
                + (desc ? '<p class="chart-description">' + desc + '</p>' : '')
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
                + '<div class="dashboard-header">' + headInner + '</div>'
                + chartsHtml;
        }

        chartKeys.forEach(function (key) {
            var el = container.querySelector('[data-chart="' + key + '"]');
            if (el && data[key] && ns.CHART_MAP && ns.CHART_MAP[key]) {
                var chart = ns.CHART_MAP[key](el, data[key], siteBase, data);
                if (chart) {
                    ns.attachToolbar(el.closest('.chart-panel'), chart);
                }
            }
        });
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
        var moduleBase = basePath + '/modules/ResourceVisualizations/asset/data/';
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

    function init() {
        if (typeof echarts === 'undefined') return;
        var async = document.querySelectorAll('.dashboard-async-container');
        for (var i = 0; i < async.length; i++) initAsyncDashboard(async[i]);
        var inline = document.querySelectorAll('.dashboard-container');
        for (var j = 0; j < inline.length; j++) initInlineDashboard(inline[j]);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
