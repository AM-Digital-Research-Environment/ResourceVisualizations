/**
 * Histogram builder: vertical bars over ordered categorical bands.
 *
 * Unlike buildBarChart (which ranks by value and keeps the top 20), this keeps
 * the input order, so distribution bands — e.g. episode-length buckets — read
 * left → right in their natural order. Expects an ordered `[{name, value}]`
 * array. Registers into window.RV.charts for the dashboard orchestrator.
 */
(function () {
    'use strict';

    var ns = window.RV;
    var THEME = ns.THEME, COLORS = ns.COLORS;
    var initChart = ns.initChart;
    var toEntries = ns.toEntries;

    ns.charts = ns.charts || {};

    ns.charts.buildHistogram = function (el, data) {
        var entries = toEntries(data);
        if (!entries.length) return;
        var chart = initChart(el);

        var names = entries.map(function (e) { return e.name; });
        var values = entries.map(function (e) { return e.value; });

        chart.setOption({
            tooltip: { trigger: 'axis', confine: true, axisPointer: { type: 'shadow' } },
            aria: { enabled: true },
            grid: { left: 50, right: 20, top: 20, bottom: 40 },
            xAxis: {
                type: 'category', data: names,
                axisLabel: { fontSize: THEME.fontSize, rotate: names.length > 6 ? 30 : 0 }
            },
            yAxis: { type: 'value', minInterval: 1 },
            series: [{
                type: 'bar', data: values,
                itemStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: COLORS[0] }, { offset: 1, color: THEME.gradientEnd }
                    ]),
                    borderRadius: [3, 3, 0, 0]
                },
                barMaxWidth: THEME.barMaxWidthWide
            }]
        });
        return chart;
    };
})();
