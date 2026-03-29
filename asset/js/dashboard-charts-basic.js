/**
 * Basic chart builders: timeline, pie, bar, word cloud.
 *
 * Registers into window.RV.charts for the dashboard orchestrator.
 */
(function () {
    'use strict';

    var ns = window.RV;
    var THEME = ns.THEME, COLORS = ns.COLORS;
    var initChart = ns.initChart, truncateLabel = ns.truncateLabel;
    var toEntries = ns.toEntries, addClickHandler = ns.addClickHandler;
    var buildDataZoom = ns.buildDataZoom;

    ns.charts = ns.charts || {};

    /* -- Word cloud availability check -- */

    var _wordCloudOk = null;
    function isWordCloudAvailable() {
        if (_wordCloudOk !== null) return _wordCloudOk;
        try {
            var d = document.createElement('div');
            d.style.cssText = 'width:1px;height:1px;position:absolute;left:-9999px';
            document.body.appendChild(d);
            var c = echarts.init(d);
            c.setOption({ series: [{ type: 'wordCloud', data: [{ name: 'x', value: 1 }] }] });
            c.dispose(); document.body.removeChild(d);
            _wordCloudOk = true;
        } catch (e) { _wordCloudOk = false; }
        return _wordCloudOk;
    }

    /* -- Timeline -- */

    ns.charts.buildTimeline = function (el, data) {
        var raw = (typeof data === 'object' && !Array.isArray(data)) ? data : null;
        if (!raw || !Object.keys(raw).length) return;
        var chart = initChart(el);
        var years = Object.keys(raw).sort();
        var values = years.map(function (y) { return raw[y]; });

        var zoom = buildDataZoom(years.length);
        chart.setOption({
            tooltip: { trigger: 'axis', confine: true },
            aria: { enabled: true },
            dataZoom: zoom,
            grid: { left: 50, right: 20, top: 20, bottom: zoom.length ? 60 : 40 },
            xAxis: {
                type: 'category', data: years,
                axisLabel: { rotate: years.length > 15 ? 45 : 0, fontSize: THEME.fontSize }
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

    /* -- Pie chart -- */

    ns.charts.buildPieChart = function (el, data, siteBase) {
        var entries = toEntries(data);
        if (!entries.length) return;
        var chart = initChart(el);
        entries.sort(function (a, b) { return b.value - a.value; });

        chart.setOption({
            tooltip: { trigger: 'item', confine: true, formatter: '{b}: {c} ({d}%)' },
            aria: { enabled: true, decal: { show: true } },
            legend: {
                orient: 'vertical', right: 10, top: 'center',
                type: 'scroll', textStyle: { fontSize: THEME.fontSize }
            },
            series: [{
                type: 'pie', radius: ['35%', '65%'], center: ['40%', '50%'],
                avoidLabelOverlap: true,
                itemStyle: { borderRadius: 4, borderColor: THEME.border, borderWidth: 2 },
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

    /* -- Bar chart -- */

    ns.charts.buildBarChart = function (el, data, siteBase) {
        var entries = toEntries(data);
        if (!entries.length) return;
        var chart = initChart(el);
        entries.sort(function (a, b) { return a.value - b.value; });
        if (entries.length > 20) entries = entries.slice(entries.length - 20);

        var names = entries.map(function (e) { return e.name; });
        var values = entries.map(function (e) { return e.value; });

        chart.setOption({
            tooltip: { trigger: 'axis', confine: true, axisPointer: { type: 'shadow' } },
            aria: { enabled: true },
            grid: {
                left: Math.min(220, Math.max(80, names.reduce(function (m, n) {
                    return Math.max(m, n.length);
                }, 0) * 6.5)),
                right: 20, top: 10, bottom: 20
            },
            xAxis: { type: 'value', minInterval: 1 },
            yAxis: {
                type: 'category', data: names,
                axisLabel: {
                    fontSize: THEME.fontSize, width: 200, overflow: 'truncate',
                    formatter: function (v) { return truncateLabel(v, THEME.labelMaxLen); }
                }
            },
            series: [{
                type: 'bar',
                data: values.map(function (v, i) {
                    return { value: v, itemStyle: { color: COLORS[i % COLORS.length], borderRadius: [0, 3, 3, 0] } };
                }),
                barMaxWidth: THEME.barMaxWidth
            }]
        });
        addClickHandler(chart, entries, siteBase);
        return chart;
    };

    /* -- Word cloud -- */

    ns.charts.buildWordCloud = function (el, data, siteBase) {
        var entries = toEntries(data);
        if (!entries.length) return;
        if (!isWordCloudAvailable()) return ns.charts.buildBarChart(el, data, siteBase);

        var chart = initChart(el);
        var total = entries.length;
        var defaultCount = Math.min(total, 30);

        function wordCloudOption(count) {
            var slice = entries.slice(0, count);
            return {
                tooltip: {
                    confine: true,
                    formatter: function (p) { return echarts.format.encodeHTML(p.name) + ': ' + p.value; }
                },
                aria: { enabled: true },
                series: [{
                    type: 'wordCloud', shape: 'circle',
                    sizeRange: [12, Math.max(40, Math.min(80, slice.length > 10 ? 60 : 80))],
                    rotationRange: [-30, 30], rotationStep: 15, gridSize: 8,
                    drawOutOfBound: false, layoutAnimation: true,
                    textStyle: {
                        fontFamily: 'sans-serif',
                        color: function () { return COLORS[Math.floor(Math.random() * COLORS.length)]; }
                    },
                    emphasis: { textStyle: { fontWeight: 'bold', shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.3)' } },
                    data: slice.map(function (e) { return { name: e.name, value: e.value }; })
                }]
            };
        }

        chart.setOption(wordCloudOption(defaultCount));
        addClickHandler(chart, entries, siteBase);

        if (total > 5) {
            var panel = el.closest('.chart-panel');
            if (panel) {
                var slider = document.createElement('div');
                slider.className = 'rv-word-slider';
                slider.innerHTML = '<label><input type="range" min="5" max="' + total + '" value="' + defaultCount + '" step="1">'
                    + '<span class="rv-word-slider-value">' + defaultCount + '</span></label>';
                var desc = panel.querySelector('.chart-description');
                var insertRef = desc ? desc.nextSibling : el;
                panel.insertBefore(slider, insertRef);

                var input = slider.querySelector('input');
                input.addEventListener('input', function () {
                    var n = parseInt(this.value, 10);
                    slider.querySelector('.rv-word-slider-value').textContent = n;
                    chart.setOption(wordCloudOption(n), true);
                });
            }
        }

        return chart;
    };
})();
