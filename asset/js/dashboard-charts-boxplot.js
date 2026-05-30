/**
 * Box plot builder: distribution of items-per-project, one box per section.
 *
 * Data: [{ name, values: [int, …] }] — the builder computes the five-number
 * summary (min / Q1 / median / Q3 / max) from the raw values.
 *
 * Registers into window.RV.charts for the dashboard orchestrator.
 */
(function () {
    'use strict';

    var ns = window.RV;
    var THEME = ns.THEME;
    var initChart = ns.initChart, truncateLabel = ns.truncateLabel, cssColor = ns.cssColor;

    ns.charts = ns.charts || {};

    function quantile(sorted, q) {
        var pos = (sorted.length - 1) * q;
        var base = Math.floor(pos), rest = pos - base;
        if (sorted[base + 1] !== undefined) {
            return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
        }
        return sorted[base];
    }

    ns.charts.buildBoxplot = function (el, data, siteBase) {
        if (!data || !data.length) return;
        var chart = initChart(el);

        var names = [], boxes = [];
        data.forEach(function (d) {
            var vals = (d.values || []).slice().sort(function (a, b) { return a - b; });
            names.push(d.name);
            if (!vals.length) { boxes.push([0, 0, 0, 0, 0]); return; }
            boxes.push([
                vals[0],
                quantile(vals, 0.25),
                quantile(vals, 0.5),
                quantile(vals, 0.75),
                vals[vals.length - 1]
            ]);
        });

        function render() {
            chart.setOption({
                tooltip: { confine: true, trigger: 'item' },
                aria: { enabled: true },
                grid: { left: 55, right: 18, bottom: names.length > 4 ? 90 : 50, top: 18 },
                xAxis: {
                    type: 'category', data: names, boundaryGap: true,
                    axisLabel: {
                        color: THEME.textMuted, fontSize: THEME.fontSize, interval: 0,
                        rotate: names.length > 4 ? 30 : 0,
                        formatter: function (v) { return truncateLabel(v, 16); }
                    },
                    axisLine: { lineStyle: { color: THEME.grid } }
                },
                yAxis: {
                    type: 'value', name: 'Items / project', min: 0,
                    nameTextStyle: { color: THEME.textMuted, fontSize: THEME.fontSize },
                    axisLabel: { color: THEME.textMuted, fontSize: THEME.fontSize },
                    splitLine: { lineStyle: { color: THEME.gridLight } }
                },
                series: [{
                    type: 'boxplot', data: boxes,
                    itemStyle: {
                        color: cssColor('--primary-muted', '#b2dfdb'),
                        borderColor: cssColor('--primary', THEME.accent)
                    },
                    tooltip: {
                        formatter: function (p) {
                            var v = p.value;
                            return '<strong>' + echarts.format.encodeHTML(p.name) + '</strong>'
                                + '<br/>max ' + v[5] + '<br/>Q3 ' + v[4] + '<br/>median ' + v[3]
                                + '<br/>Q1 ' + v[2] + '<br/>min ' + v[1];
                        }
                    }
                }]
            });
        }

        render();
        chart._rvRebuild = render;
        return chart;
    };
})();
