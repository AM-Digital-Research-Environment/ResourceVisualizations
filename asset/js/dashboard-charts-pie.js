/**
 * Pie chart builder: donut chart for categorical distributions.
 *
 * Registers into window.RV.charts for the dashboard orchestrator.
 */
(function () {
    'use strict';

    var ns = window.RV;
    var THEME = ns.THEME, COLORS = ns.COLORS;
    var initChart = ns.initChart;
    var toEntries = ns.toEntries, addClickHandler = ns.addClickHandler;

    ns.charts = ns.charts || {};

    ns.charts.buildPieChart = function (el, data, siteBase) {
        var entries = toEntries(data);
        if (!entries.length) return;
        var chart = initChart(el);
        entries.sort(function (a, b) { return b.value - a.value; });

        chart.setOption({
            tooltip: { trigger: 'item', confine: true, formatter: '{b}: {c} ({d}%)' },
            aria: { enabled: true, decal: { show: ns._decalEnabled } },
            // Legend below the chart (horizontal, scrollable) so it never overlaps
            // the donut — long category lists page left/right instead of covering it.
            legend: {
                orient: 'horizontal', bottom: 0, left: 'center',
                type: 'scroll', textStyle: { fontSize: THEME.fontSize }
            },
            series: [{
                // Centred and lifted to leave room for the bottom legend.
                type: 'pie', radius: ['34%', '62%'], center: ['50%', '45%'],
                avoidLabelOverlap: true,
                // borderColor comes from the theme (= --surface) so slice gaps
                // match the panel in light/dark; see dashboard-core buildEchartsTheme.
                itemStyle: { borderRadius: 4, borderWidth: 2 },
                label: { show: false },
                emphasis: { label: { show: true, fontSize: THEME.fontSizeEmphasis, fontWeight: 'bold' } },
                data: entries.map(function (e, i) {
                    return { name: e.name, value: e.value, itemStyle: { color: COLORS[i % COLORS.length] } };
                })
            }]
        });
        addClickHandler(chart, entries, siteBase);
        return chart;
    };
})();
