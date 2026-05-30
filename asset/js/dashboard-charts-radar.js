/**
 * Radar chart builder: a normalised "breadth" profile for an entity.
 *
 * Data: { indicator: [{ name, max }], series: [{ value: [...], name? }] }
 * Supports one series (per-entity dashboards) or several overlaid (the Compare
 * view). Axes are pre-normalised in precompute against the per-type maxima.
 *
 * Registers into window.RV.charts for the dashboard orchestrator.
 */
(function () {
    'use strict';

    var ns = window.RV;
    var THEME = ns.THEME, COLORS = ns.COLORS;
    var initChart = ns.initChart, truncateLabel = ns.truncateLabel;

    ns.charts = ns.charts || {};

    ns.charts.buildRadar = function (el, data, siteBase) {
        if (!data || !data.indicator || !data.indicator.length
            || !data.series || !data.series.length) return;

        var chart = initChart(el);
        chart._noDecal = true; // decal patterns aren't meaningful on a radar

        var multi = data.series.length > 1;

        chart.setOption({
            tooltip: { confine: true, trigger: 'item' },
            aria: { enabled: true },
            legend: multi ? {
                bottom: 0,
                data: data.series.map(function (s, i) { return s.name || ('Series ' + (i + 1)); }),
                textStyle: { color: THEME.text, fontSize: THEME.fontSize }
            } : undefined,
            radar: {
                center: ['50%', multi ? '52%' : '54%'],
                radius: '66%',
                indicator: data.indicator.map(function (ind) {
                    return { name: truncateLabel(ind.name, 16), max: ind.max || 1 };
                }),
                axisName: { color: THEME.textMuted, fontSize: THEME.fontSize },
                splitLine: { lineStyle: { color: THEME.gridLight } },
                splitArea: { areaStyle: { color: ['transparent'] } },
                axisLine: { lineStyle: { color: THEME.grid } }
            },
            series: [{
                type: 'radar',
                emphasis: { focus: 'series' },
                data: data.series.map(function (s, i) {
                    var color = COLORS[i % COLORS.length];
                    return {
                        value: s.value,
                        name: s.name || 'Profile',
                        symbolSize: 4,
                        lineStyle: { color: color, width: 2 },
                        itemStyle: { color: color },
                        areaStyle: { color: color, opacity: multi ? 0.12 : 0.2 }
                    };
                })
            }]
        });

        return chart;
    };
})();
