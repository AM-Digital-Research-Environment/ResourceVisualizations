/**
 * Dashboard visualizations using ECharts.
 *
 * Reads aggregated data from the container's data-dashboard attribute and
 * renders timeline, distributions, word cloud, and contributor charts.
 */
(function () {
    'use strict';

    var COLORS = [
        '#22817b', '#e07c3e', '#6b5b95', '#d4a574', '#2c5f7c',
        '#c5504d', '#4a8c6f', '#8b6f47', '#7c5295', '#cc8963',
        '#5ba3a0', '#d49b6a', '#8e7cb8', '#e6c9a8', '#4a8aab',
        '#d87e7a', '#6fb08e', '#a68e6d', '#9e7bb8', '#e0a88a'
    ];

    /* ------------------------------------------------------------------ */
    /*  Chart builders                                                     */
    /* ------------------------------------------------------------------ */

    function buildTimeline(el, data) {
        if (!data || !Object.keys(data).length) return;
        var chart = echarts.init(el);
        var years = Object.keys(data).sort();
        var values = years.map(function (y) { return data[y]; });

        chart.setOption({
            tooltip: { trigger: 'axis' },
            grid: { left: 50, right: 20, top: 20, bottom: 40 },
            xAxis: {
                type: 'category',
                data: years,
                axisLabel: { rotate: years.length > 15 ? 45 : 0, fontSize: 11 }
            },
            yAxis: { type: 'value', minInterval: 1 },
            series: [{
                type: 'bar',
                data: values,
                itemStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: COLORS[0] },
                        { offset: 1, color: '#b2dfdb' }
                    ]),
                    borderRadius: [3, 3, 0, 0]
                },
                barMaxWidth: 40
            }]
        });
        return chart;
    }

    function buildPieChart(el, data) {
        if (!data || !Object.keys(data).length) return;
        var chart = echarts.init(el);
        var entries = Object.keys(data).map(function (k) {
            return { name: k, value: data[k] };
        });
        entries.sort(function (a, b) { return b.value - a.value; });

        chart.setOption({
            tooltip: {
                trigger: 'item',
                formatter: '{b}: {c} ({d}%)'
            },
            legend: {
                orient: 'vertical',
                right: 10,
                top: 'center',
                type: 'scroll',
                textStyle: { fontSize: 11 }
            },
            series: [{
                type: 'pie',
                radius: ['35%', '65%'],
                center: ['40%', '50%'],
                avoidLabelOverlap: true,
                itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 },
                label: { show: false },
                emphasis: {
                    label: { show: true, fontSize: 13, fontWeight: 'bold' }
                },
                data: entries.map(function (e, i) {
                    e.itemStyle = { color: COLORS[i % COLORS.length] };
                    return e;
                })
            }]
        });
        return chart;
    }

    function buildBarChart(el, data) {
        if (!data || !Object.keys(data).length) return;
        var chart = echarts.init(el);
        var entries = [];
        var keys = Object.keys(data);
        keys.forEach(function (k) { entries.push({ name: k, value: data[k] }); });
        entries.sort(function (a, b) { return a.value - b.value; });

        // Show top 20 for readability.
        if (entries.length > 20) {
            entries = entries.slice(entries.length - 20);
        }

        var names = entries.map(function (e) { return e.name; });
        var values = entries.map(function (e) { return e.value; });

        chart.setOption({
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
            grid: {
                left: Math.min(200, Math.max(80, names.reduce(function (m, n) {
                    return Math.max(m, n.length);
                }, 0) * 7)),
                right: 20,
                top: 10,
                bottom: 20
            },
            xAxis: { type: 'value', minInterval: 1 },
            yAxis: {
                type: 'category',
                data: names,
                axisLabel: {
                    fontSize: 11,
                    formatter: function (v) {
                        return v.length > 25 ? v.substring(0, 25) + '\u2026' : v;
                    }
                }
            },
            series: [{
                type: 'bar',
                data: values.map(function (v, i) {
                    return {
                        value: v,
                        itemStyle: { color: COLORS[i % COLORS.length], borderRadius: [0, 3, 3, 0] }
                    };
                }),
                barMaxWidth: 24
            }]
        });
        return chart;
    }

    function buildWordCloud(el, data) {
        if (!data || !Object.keys(data).length) return;

        // Fallback to bar chart if echarts-wordcloud is not available.
        if (typeof echarts.init === 'function' && !isWordCloudAvailable()) {
            return buildBarChart(el, data);
        }

        var chart = echarts.init(el);
        var maxVal = 0;
        var entries = Object.keys(data).map(function (k) {
            if (data[k] > maxVal) maxVal = data[k];
            return { name: k, value: data[k] };
        });

        chart.setOption({
            tooltip: {
                trigger: 'item',
                formatter: function (params) {
                    return echarts.format.encodeHTML(params.name) + ': ' + params.value;
                }
            },
            series: [{
                type: 'wordCloud',
                shape: 'circle',
                sizeRange: [12, Math.max(40, Math.min(80, entries.length > 10 ? 60 : 80))],
                rotationRange: [-30, 30],
                rotationStep: 15,
                gridSize: 8,
                drawOutOfBound: false,
                layoutAnimation: true,
                textStyle: {
                    fontFamily: 'sans-serif',
                    fontWeight: 'normal',
                    color: function () {
                        return COLORS[Math.floor(Math.random() * COLORS.length)];
                    }
                },
                emphasis: {
                    textStyle: { fontWeight: 'bold', shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.3)' }
                },
                data: entries
            }]
        });
        return chart;
    }

    function isWordCloudAvailable() {
        try {
            var testDiv = document.createElement('div');
            testDiv.style.width = '1px';
            testDiv.style.height = '1px';
            testDiv.style.position = 'absolute';
            testDiv.style.left = '-9999px';
            document.body.appendChild(testDiv);
            var testChart = echarts.init(testDiv);
            testChart.setOption({ series: [{ type: 'wordCloud', data: [{ name: 'test', value: 1 }] }] });
            testChart.dispose();
            document.body.removeChild(testDiv);
            return true;
        } catch (e) {
            return false;
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Dashboard initialization                                           */
    /* ------------------------------------------------------------------ */

    function initDashboard(container) {
        var raw = container.getAttribute('data-dashboard');
        if (!raw) return;

        var data;
        try {
            data = JSON.parse(raw);
        } catch (e) {
            console.error('ResourceVisualizations: invalid dashboard data', e);
            return;
        }

        var charts = [];
        var chartMap = {
            'timeline': buildTimeline,
            'types': buildPieChart,
            'languages': buildBarChart,
            'subjects': buildWordCloud,
            'contributors': buildBarChart
        };

        Object.keys(chartMap).forEach(function (key) {
            var el = container.querySelector('[data-chart="' + key + '"]');
            if (el && data[key]) {
                var chart = chartMap[key](el, data[key]);
                if (chart) charts.push(chart);
            }
        });

        // Responsive resize.
        var resizeTimer;
        window.addEventListener('resize', function () {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(function () {
                charts.forEach(function (c) { c.resize(); });
            }, 100);
        });
    }

    function init() {
        if (typeof echarts === 'undefined') {
            console.warn('ResourceVisualizations: ECharts not loaded');
            return;
        }
        var containers = document.querySelectorAll('.dashboard-container');
        for (var i = 0; i < containers.length; i++) {
            initDashboard(containers[i]);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
