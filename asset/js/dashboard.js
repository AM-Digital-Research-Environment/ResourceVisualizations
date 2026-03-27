/**
 * Dashboard visualizations using ECharts.
 *
 * Supports two modes:
 * 1. Inline: reads data from data-dashboard attribute (item-set-dashboard)
 * 2. Async: fetches precomputed JSON from module assets (linked-items-dashboard)
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
            tooltip: { trigger: 'axis', confine: true },
            grid: { left: 50, right: 20, top: 20, bottom: 40 },
            xAxis: {
                type: 'category', data: years,
                axisLabel: { rotate: years.length > 15 ? 45 : 0, fontSize: 11 }
            },
            yAxis: { type: 'value', minInterval: 1 },
            series: [{
                type: 'bar', data: values,
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
            tooltip: { trigger: 'item', confine: true, formatter: '{b}: {c} ({d}%)' },
            legend: {
                orient: 'vertical', right: 10, top: 'center',
                type: 'scroll', textStyle: { fontSize: 11 }
            },
            series: [{
                type: 'pie', radius: ['35%', '65%'], center: ['40%', '50%'],
                avoidLabelOverlap: true,
                itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 },
                label: { show: false },
                emphasis: { label: { show: true, fontSize: 13, fontWeight: 'bold' } },
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
        Object.keys(data).forEach(function (k) { entries.push({ name: k, value: data[k] }); });
        entries.sort(function (a, b) { return a.value - b.value; });
        if (entries.length > 20) entries = entries.slice(entries.length - 20);

        var names = entries.map(function (e) { return e.name; });
        var values = entries.map(function (e) { return e.value; });

        chart.setOption({
            tooltip: { trigger: 'axis', confine: true, axisPointer: { type: 'shadow' } },
            grid: {
                left: Math.min(200, Math.max(80, names.reduce(function (m, n) {
                    return Math.max(m, n.length);
                }, 0) * 7)),
                right: 20, top: 10, bottom: 20
            },
            xAxis: { type: 'value', minInterval: 1 },
            yAxis: {
                type: 'category', data: names,
                axisLabel: {
                    fontSize: 11,
                    formatter: function (v) { return v.length > 25 ? v.substring(0, 25) + '\u2026' : v; }
                }
            },
            series: [{
                type: 'bar',
                data: values.map(function (v, i) {
                    return { value: v, itemStyle: { color: COLORS[i % COLORS.length], borderRadius: [0, 3, 3, 0] } };
                }),
                barMaxWidth: 24
            }]
        });
        return chart;
    }

    function buildWordCloud(el, data) {
        if (!data || !Object.keys(data).length) return;
        if (!isWordCloudAvailable()) return buildBarChart(el, data);

        var chart = echarts.init(el);
        var entries = Object.keys(data).map(function (k) { return { name: k, value: data[k] }; });

        chart.setOption({
            tooltip: {
                confine: true,
                formatter: function (p) { return echarts.format.encodeHTML(p.name) + ': ' + p.value; }
            },
            series: [{
                type: 'wordCloud', shape: 'circle',
                sizeRange: [12, Math.max(40, Math.min(80, entries.length > 10 ? 60 : 80))],
                rotationRange: [-30, 30], rotationStep: 15, gridSize: 8,
                drawOutOfBound: false, layoutAnimation: true,
                textStyle: {
                    fontFamily: 'sans-serif',
                    color: function () { return COLORS[Math.floor(Math.random() * COLORS.length)]; }
                },
                emphasis: { textStyle: { fontWeight: 'bold', shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.3)' } },
                data: entries
            }]
        });
        return chart;
    }

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

    /* ------------------------------------------------------------------ */
    /*  Render dashboard from data object                                  */
    /* ------------------------------------------------------------------ */

    var CHART_MAP = {
        'timeline': buildTimeline,
        'types': buildPieChart,
        'languages': buildBarChart,
        'subjects': buildWordCloud,
        'contributors': buildBarChart,
        'projects': buildBarChart
    };

    var CHART_LABELS = {
        'timeline': 'Timeline',
        'types': 'Resource Types',
        'languages': 'Languages',
        'subjects': 'Subjects',
        'contributors': 'Top Contributors',
        'projects': 'Items per Project'
    };

    function renderDashboard(container, data) {
        // Build HTML structure.
        var html = '<div class="dashboard-header">'
            + '<h3>Dashboard</h3>'
            + '<span class="dashboard-total">' + (data.totalItems || 0) + ' items</span>'
            + '</div>'
            + '<div class="dashboard-charts">';

        var chartKeys = ['timeline', 'types', 'languages', 'subjects', 'contributors', 'projects'];
        chartKeys.forEach(function (key) {
            if (!data[key] || !Object.keys(data[key]).length) return;
            var wide = (key === 'timeline' || key === 'subjects') ? ' chart-panel-wide' : '';
            var tall = key === 'subjects' ? ' chart-container-tall' : '';
            html += '<div class="chart-panel' + wide + '">'
                + '<h4>' + (CHART_LABELS[key] || key) + '</h4>'
                + '<div class="chart-container' + tall + '" data-chart="' + key + '"></div>'
                + '</div>';
        });

        html += '</div>';
        container.innerHTML = html;

        // Render charts.
        var charts = [];
        chartKeys.forEach(function (key) {
            var el = container.querySelector('[data-chart="' + key + '"]');
            if (el && data[key] && CHART_MAP[key]) {
                var chart = CHART_MAP[key](el, data[key]);
                if (chart) charts.push(chart);
            }
        });

        var timer;
        window.addEventListener('resize', function () {
            clearTimeout(timer);
            timer = setTimeout(function () { charts.forEach(function (c) { c.resize(); }); }, 100);
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Async dashboard (precomputed JSON)                                 */
    /* ------------------------------------------------------------------ */

    function initAsyncDashboard(container) {
        var itemId = container.dataset.itemId;
        var basePath = container.dataset.basePath || '';
        var url = basePath + '/modules/ResourceVisualizations/asset/data/section-dashboards/' + itemId + '.json';

        fetch(url).then(function (r) {
            if (!r.ok) throw new Error('not found');
            return r.json();
        }).then(function (data) {
            if (!data || !data.totalItems) {
                container.innerHTML = '';
                return;
            }
            container.innerHTML = '';
            renderDashboard(container, data);
        }).catch(function () {
            // No precomputed data — hide the block.
            container.innerHTML = '';
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Inline dashboard (data-dashboard attribute, used by item sets)     */
    /* ------------------------------------------------------------------ */

    function initInlineDashboard(container) {
        var raw = container.getAttribute('data-dashboard');
        if (!raw) return;
        var data;
        try { data = JSON.parse(raw); } catch (e) { return; }
        renderDashboard(container.parentElement || container, data);
    }

    /* ------------------------------------------------------------------ */
    /*  Init                                                               */
    /* ------------------------------------------------------------------ */

    function init() {
        if (typeof echarts === 'undefined') return;

        // Async dashboards (linked-items-dashboard).
        var asyncContainers = document.querySelectorAll('.dashboard-async-container');
        for (var i = 0; i < asyncContainers.length; i++) {
            initAsyncDashboard(asyncContainers[i]);
        }

        // Inline dashboards (item-set-dashboard via partials/dashboard-charts.phtml).
        var inlineContainers = document.querySelectorAll('.dashboard-container');
        for (var j = 0; j < inlineContainers.length; j++) {
            initInlineDashboard(inlineContainers[j]);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
