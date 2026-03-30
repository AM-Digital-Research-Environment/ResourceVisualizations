/**
 * Advanced chart builders: gantt, heatmap, chord, sankey, sunburst, stacked timeline.
 *
 * Registers into window.RV.charts for the dashboard orchestrator.
 */
(function () {
    'use strict';

    var ns = window.RV;
    var THEME = ns.THEME, COLORS = ns.COLORS;
    var initChart = ns.initChart, truncateLabel = ns.truncateLabel;
    var buildDataZoom = ns.buildDataZoom;

    ns.charts = ns.charts || {};

    /* -- Gantt -- */

    ns.charts.buildGantt = function (el, data, siteBase) {
        if (!data || !data.length) return;
        var chart = initChart(el);
        var projects = data.slice().reverse();
        var names = projects.map(function (p) { return p.name; });
        var minYear = 9999, maxYear = 0;

        var barData = projects.map(function (p, i) {
            var start = new Date(p.start).getTime();
            var end = new Date(p.end).getTime();
            var sy = new Date(p.start).getFullYear();
            var ey = new Date(p.end).getFullYear();
            if (sy < minYear) minYear = sy;
            if (ey > maxYear) maxYear = ey;
            return {
                name: p.name, value: [i, start, end, p.itemId],
                itemStyle: { color: COLORS[i % COLORS.length], borderRadius: 3 }
            };
        });

        chart.setOption({
            tooltip: {
                confine: true,
                formatter: function (params) {
                    var v = params.value;
                    var s = new Date(v[1]).toLocaleDateString('en', { year: 'numeric', month: 'short' });
                    var e = new Date(v[2]).toLocaleDateString('en', { year: 'numeric', month: 'short' });
                    return '<strong>' + echarts.format.encodeHTML(params.name) + '</strong><br/>' + s + ' \u2192 ' + e;
                }
            },
            aria: { enabled: true },
            grid: { left: 220, right: 30, top: 10, bottom: 30 },
            xAxis: {
                type: 'time',
                min: new Date(minYear, 0, 1).getTime(),
                max: new Date(maxYear + 1, 0, 1).getTime(),
                axisLabel: { fontSize: THEME.fontSize }
            },
            yAxis: {
                type: 'category', data: names,
                axisLabel: {
                    fontSize: THEME.fontSize, width: 200, overflow: 'truncate',
                    formatter: function (v) { return truncateLabel(v, 28); }
                }
            },
            series: [{
                type: 'custom',
                renderItem: function (params, api) {
                    var catIdx = api.value(0);
                    var start = api.coord([api.value(1), catIdx]);
                    var end = api.coord([api.value(2), catIdx]);
                    var height = api.size([0, 1])[1] * 0.6;
                    return {
                        type: 'rect', shape: { x: start[0], y: start[1] - height / 2, width: end[0] - start[0], height: height },
                        style: api.style()
                    };
                },
                encode: { x: [1, 2], y: 0 },
                data: barData
            }]
        });

        chart.on('click', function (p) {
            if (p.value && p.value[3] && siteBase) window.location.href = siteBase + '/item/' + p.value[3];
        });
        return chart;
    };

    /* -- Heatmap -- */

    ns.charts.buildHeatmap = function (el, data) {
        if (!data || !data.rows || !data.cols || !data.values) return;
        var chart = initChart(el);
        var maxVal = 0;
        data.values.forEach(function (v) { if (v[2] > maxVal) maxVal = v[2]; });

        chart.setOption({
            tooltip: {
                confine: true,
                formatter: function (p) {
                    return echarts.format.encodeHTML(data.rows[p.value[1]]) + ' \u00d7 '
                        + echarts.format.encodeHTML(data.cols[p.value[0]]) + ': ' + p.value[2];
                }
            },
            aria: { enabled: true },
            grid: { left: 120, right: 60, top: 10, bottom: 80 },
            xAxis: {
                type: 'category', data: data.cols, splitArea: { show: true },
                axisLabel: { rotate: 35, fontSize: THEME.fontSize, formatter: function (v) { return truncateLabel(v, 15); } }
            },
            yAxis: {
                type: 'category', data: data.rows, splitArea: { show: true },
                axisLabel: { fontSize: THEME.fontSize, formatter: function (v) { return truncateLabel(v, 15); } }
            },
            visualMap: {
                min: 0, max: maxVal || 1, calculable: true, orient: 'vertical', right: 0, top: 'center',
                inRange: { color: ['#f0f9e8', '#bae4bc', '#7bccc4', '#43a2ca', '#0868ac'] }
            },
            series: [{
                type: 'heatmap', data: data.values,
                label: { show: true, fontSize: 10 },
                emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.3)' } }
            }]
        });
        return chart;
    };

    /* -- Chord (circular graph) -- */

    ns.charts.buildChord = function (el, data, siteBase) {
        if (!data || !data.nodes || !data.links || data.nodes.length < 2) return;
        var chart = initChart(el);

        chart.setOption({
            tooltip: {
                confine: true,
                formatter: function (p) {
                    if (p.dataType === 'node') return '<strong>' + echarts.format.encodeHTML(p.name) + '</strong>';
                    if (p.dataType === 'edge') {
                        return echarts.format.encodeHTML(p.data.source) + ' \u2194 '
                            + echarts.format.encodeHTML(p.data.target) + ': ' + p.data.value;
                    }
                    return '';
                }
            },
            aria: { enabled: true },
            series: [{
                type: 'graph', layout: 'circular', circular: { rotateLabel: true },
                data: data.nodes.map(function (n, i) {
                    return {
                        name: n.name, symbolSize: Math.max(10, Math.min(40, n.value * 2)),
                        itemStyle: { color: COLORS[i % COLORS.length] },
                        itemId: n.itemId,
                        label: { fontSize: THEME.fontSize - 1, formatter: function (p) { return truncateLabel(p.name, 20); } }
                    };
                }),
                links: data.links.map(function (l) {
                    return {
                        source: l.source, target: l.target, value: l.value,
                        lineStyle: { width: Math.max(1, Math.min(6, l.value)), curveness: 0.3, opacity: 0.5 }
                    };
                }),
                roam: true, label: { show: true, position: 'right' },
                emphasis: { focus: 'adjacency', lineStyle: { width: 4, opacity: 0.9 } }
            }]
        });

        chart.on('click', function (p) {
            if (p.dataType === 'node' && p.data.itemId && siteBase) window.location.href = siteBase + '/item/' + p.data.itemId;
        });
        return chart;
    };

    /* -- Sankey -- */

    ns.charts.buildSankey = function (el, data) {
        if (!data || !data.nodes || !data.links || data.links.length < 1) return;
        var chart = initChart(el);

        chart.setOption({
            tooltip: { trigger: 'item', confine: true },
            aria: { enabled: true, decal: { show: true } },
            series: [{
                type: 'sankey', layout: 'none',
                emphasis: { focus: 'adjacency' },
                nodeAlign: 'left', orient: 'horizontal',
                nodeWidth: 20, nodeGap: 10,
                lineStyle: { color: 'gradient', curveness: 0.5, opacity: 0.4 },
                label: {
                    fontSize: THEME.fontSize,
                    formatter: function (p) { return truncateLabel(p.name, 25); }
                },
                data: data.nodes.map(function (n, i) {
                    return { name: n.name, itemStyle: { color: COLORS[i % COLORS.length] } };
                }),
                links: data.links
            }]
        });
        return chart;
    };

    /* -- Sunburst -- */

    ns.charts.buildSunburst = function (el, data) {
        if (!data || !data.length) return;
        var chart = initChart(el);

        chart.setOption({
            tooltip: { confine: true },
            aria: { enabled: true, decal: { show: true } },
            series: [{
                type: 'sunburst',
                data: data,
                radius: ['10%', '90%'],
                sort: null,
                emphasis: { focus: 'ancestor' },
                levels: [
                    {},
                    { r0: '10%', r: '40%', label: { fontSize: THEME.fontSize, rotate: 'tangential' }, itemStyle: { borderWidth: 2 } },
                    { r0: '40%', r: '65%', label: { fontSize: THEME.fontSize - 1, rotate: 'tangential' }, itemStyle: { borderWidth: 1 } },
                    { r0: '65%', r: '90%', label: { show: false }, itemStyle: { borderWidth: 0.5 } }
                ]
            }]
        });
        return chart;
    };

    /* -- Stacked timeline -- */

    ns.charts.buildStackedTimeline = function (el, data) {
        if (!data || !data.years || !data.series) return;
        var chart = initChart(el);

        var series = data.series.map(function (s, i) {
            return {
                name: s.name, type: 'bar', stack: 'total',
                data: s.data,
                itemStyle: { color: COLORS[i % COLORS.length] },
                emphasis: { focus: 'series' }
            };
        });

        var zoom = buildDataZoom(data.years.length);
        chart.setOption({
            tooltip: { trigger: 'axis', confine: true },
            aria: { enabled: true, decal: { show: true } },
            dataZoom: zoom,
            legend: { bottom: zoom.length ? 50 : 5, textStyle: { fontSize: THEME.fontSize }, type: 'scroll' },
            grid: { left: 50, right: 20, top: 20, bottom: zoom.length ? 110 : 55 },
            xAxis: {
                type: 'category', data: data.years,
                axisLabel: { rotate: data.years.length > 15 ? 45 : 0, fontSize: THEME.fontSize }
            },
            yAxis: { type: 'value', minInterval: 1 },
            series: series
        });
        return chart;
    };
})();
