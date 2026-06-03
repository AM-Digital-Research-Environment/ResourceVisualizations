/**
 * Heatmap chart builder: cross-tabulation matrix (e.g. type × language).
 *
 * Registers into window.RV.charts for the dashboard orchestrator.
 */
(function () {
    'use strict';

    var ns = window.RV;
    var THEME = ns.THEME;
    var initChart = ns.initChart, truncateLabel = ns.truncateLabel;

    ns.charts = ns.charts || {};

    ns.charts.buildHeatmap = function (el, data) {
        if (!data || !data.rows || !data.cols || !data.values) return;
        var chart = initChart(el);
        chart._noDecal = true;
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
            // Extra right margin keeps the calculable visualMap (the draggable
            // slider) clear of the cells; extra bottom margin gives the angled
            // x-axis labels room so none are clipped.
            grid: { left: 130, right: 92, top: 12, bottom: 104 },
            xAxis: {
                type: 'category', data: data.cols,
                // interval: 0 forces every column label to render (ECharts otherwise
                // drops some when they crowd); a longer truncation keeps them legible.
                axisLabel: {
                    interval: 0, rotate: 35, fontSize: THEME.fontSize,
                    formatter: function (v) { return truncateLabel(v, 22); }
                }
            },
            yAxis: {
                type: 'category', data: data.rows,
                axisLabel: { fontSize: THEME.fontSize, formatter: function (v) { return truncateLabel(v, 22); } }
            },
            visualMap: {
                min: 0, max: maxVal || 1, calculable: true, orient: 'vertical', right: 12, top: 'center',
                inRange: { color: ns.accentRamp() }
            },
            series: [{
                type: 'heatmap', data: data.values,
                label: { show: true, fontSize: 10 },
                emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.3)' } }
            }]
        });
        // Re-apply the theme-aware ramp when the light/dark theme toggles.
        chart._rvRebuild = function () {
            chart.setOption({ visualMap: { inRange: { color: ns.accentRamp() } } });
        };
        return chart;
    };
})();
