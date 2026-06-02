/**
 * Sibling-items sparkline: on a research item that belongs to a project, render
 * the project's items-per-year as a compact line with the current item's year
 * marked. Resolves the parent project + the item's year from the REST API, then
 * reuses the project's precomputed dashboard `timeline`. Stays hidden when not
 * applicable (no parent project with a multi-year dashboard).
 *
 * Depends on: dashboard-core.js (window.RV: THEME, COLORS, initChart).
 */
(function () {
    'use strict';

    var ns = window.RV;
    if (!ns) return;
    var THEME = ns.THEME, initChart = ns.initChart;

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str == null ? '' : String(str)));
        return div.innerHTML;
    }

    function yearOf(item) {
        var props = ['dcterms:issued', 'dcterms:created', 'dcterms:date', 'fabio:hasDateCollected'];
        for (var i = 0; i < props.length; i++) {
            var vals = item[props[i]];
            if (vals && vals.length) {
                var m = String(vals[0]['@value'] || '').match(/(\d{4})/);
                if (m) return m[1];
            }
        }
        return null;
    }

    function parentProjects(item) {
        var out = [];
        (item['dcterms:isPartOf'] || []).forEach(function (v) {
            if (v.value_resource_id) {
                out.push({ id: v.value_resource_id, name: v.display_title || v['o:label'] || null });
            }
        });
        return out;
    }

    function render(container, block, timeline, itemYear, projectName, siteBase, projectId) {
        var years = Object.keys(timeline).sort();
        block.hidden = false;
        container.innerHTML = '<div class="sibling-sparkline-head"><h4>'
            + escapeHtml(projectName || 'Project') + ' — items per year</h4></div>'
            + '<div class="sibling-sparkline-chart"></div>';

        var head = container.querySelector('.sibling-sparkline-head h4');
        if (siteBase && projectId) {
            head.classList.add('sibling-sparkline-link');
            head.addEventListener('click', function () {
                window.location.href = siteBase + '/item/' + projectId;
            });
        }

        var el = container.querySelector('.sibling-sparkline-chart');
        var chart = initChart(el);
        var data = years.map(function (y) { return timeline[y]; });
        var markData = (itemYear && timeline[itemYear] !== undefined)
            ? [{ xAxis: String(itemYear), yAxis: timeline[itemYear] }] : [];

        chart.setOption({
            tooltip: { trigger: 'axis', confine: true },
            grid: { left: 38, right: 16, top: 16, bottom: 26 },
            xAxis: {
                type: 'category', data: years, boundaryGap: false,
                axisLabel: { color: THEME.textMuted, fontSize: THEME.fontSize },
                axisLine: { lineStyle: { color: THEME.grid } }
            },
            yAxis: {
                type: 'value', minInterval: 1,
                axisLabel: { color: THEME.textMuted, fontSize: THEME.fontSize },
                splitLine: { lineStyle: { color: THEME.gridLight } }
            },
            series: [{
                type: 'line', data: data, smooth: true, showSymbol: true, symbolSize: 5,
                lineStyle: { color: THEME.accent, width: 2 },
                itemStyle: { color: THEME.accent },
                areaStyle: { color: THEME.accent, opacity: 0.12 },
                markPoint: markData.length ? {
                    symbolSize: 44, symbol: 'pin',
                    itemStyle: { color: ns.COLORS[1] },
                    data: markData,
                    // Dark label: the pin is always a light amber (COLORS[1]) in
                    // both themes, so near-black reads far better than white.
                    label: { formatter: 'this', color: '#1a1a1a', fontSize: THEME.fontSize - 2 }
                } : undefined
            }]
        });
        return chart;
    }

    function initSparkline(container) {
        var block = container.closest('.sibling-sparkline-block');
        if (!block) return;
        var itemId = container.dataset.itemId;
        var apiBase = container.dataset.apiBase;
        var basePath = container.dataset.basePath || '';
        var siteBase = container.dataset.siteBase || '';
        if (!itemId || !apiBase) return;
        var dashBase = basePath + '/modules/ResourceVisualizations/asset/data/item-dashboards/';

        fetch(apiBase + '/items/' + itemId).then(function (r) { return r.json(); }).then(function (item) {
            var iYear = yearOf(item);
            var parents = parentProjects(item);
            if (!parents.length) return;

            (function tryNext(i) {
                if (i >= parents.length) return;
                var p = parents[i];
                fetch(dashBase + p.id + '.json').then(function (r) {
                    if (!r.ok) throw new Error('no dashboard');
                    return r.json();
                }).then(function (dash) {
                    var tl = dash && dash.timeline;
                    if (tl && Object.keys(tl).length > 1) {
                        render(container, block, tl, iYear, p.name, siteBase, p.id);
                    } else {
                        tryNext(i + 1);
                    }
                }).catch(function () { tryNext(i + 1); });
            })(0);
        }).catch(function () { /* leave the block hidden */ });
    }

    function init() {
        if (typeof echarts === 'undefined') return;
        var cs = document.querySelectorAll('.sibling-sparkline-container');
        for (var i = 0; i < cs.length; i++) initSparkline(cs[i]);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
