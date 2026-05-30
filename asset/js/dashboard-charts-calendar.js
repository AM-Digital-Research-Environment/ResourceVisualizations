/**
 * Calendar heatmap builder: acquisition cadence by day, one calendar per year.
 *
 * Data: [['YYYY-MM-DD', count], …]
 *
 * Registers into window.RV.charts for the dashboard orchestrator.
 */
(function () {
    'use strict';

    var ns = window.RV;
    var THEME = ns.THEME;
    var initChart = ns.initChart, cssColor = ns.cssColor;

    ns.charts = ns.charts || {};

    ns.charts.buildCalendar = function (el, data, siteBase) {
        if (!data || !data.length) return;

        var years = {}, maxVal = 0;
        data.forEach(function (d) {
            years[String(d[0]).slice(0, 4)] = true;
            if (d[1] > maxVal) maxVal = d[1];
        });
        var yearList = Object.keys(years).sort();

        // Grow the container so stacked year calendars are not clipped.
        el.style.height = Math.max(160, 36 + yearList.length * 130) + 'px';

        var chart = initChart(el);
        chart._noDecal = true;

        function buildCalendars() {
            return yearList.map(function (y, i) {
                return {
                    top: 24 + i * 130, left: 45, right: 16,
                    cellSize: [14, 14], range: y,
                    itemStyle: { color: 'transparent', borderColor: THEME.grid, borderWidth: 0.5 },
                    splitLine: { lineStyle: { color: THEME.gridLight } },
                    yearLabel: { show: true, color: THEME.textMuted, fontSize: THEME.fontSize },
                    dayLabel: { color: THEME.textMuted, fontSize: THEME.fontSize - 2 },
                    monthLabel: { color: THEME.textMuted, fontSize: THEME.fontSize - 1 }
                };
            });
        }

        function ramp() {
            return [cssColor('--primary-muted', '#b2dfdb'), cssColor('--primary', THEME.accent)];
        }

        function render() {
            chart.setOption({
                tooltip: {
                    confine: true,
                    formatter: function (p) {
                        return p.value[0] + '<br/><strong>' + p.value[1] + '</strong> item'
                            + (p.value[1] > 1 ? 's' : '');
                    }
                },
                aria: { enabled: true },
                visualMap: {
                    min: 0, max: maxVal || 1, calculable: true,
                    orient: 'horizontal', left: 'center', bottom: 0,
                    inRange: { color: ramp() },
                    textStyle: { color: THEME.textMuted, fontSize: THEME.fontSize }
                },
                calendar: buildCalendars(),
                series: yearList.map(function (y, i) {
                    return {
                        type: 'heatmap', coordinateSystem: 'calendar', calendarIndex: i,
                        data: data.filter(function (d) { return String(d[0]).slice(0, 4) === y; })
                    };
                })
            });
        }

        render();
        chart._rvRebuild = render; // re-resolve theme colours on light/dark toggle
        return chart;
    };
})();
