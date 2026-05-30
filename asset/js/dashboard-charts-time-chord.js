/**
 * Time-aware chord builder: subject co-occurrence, year by year.
 *
 * Data: { buckets: [{ year, nodes:[{name,value,itemId}], links:[{source,target,value}] }], years: [] }
 * Uses ECharts' native `timeline` component (slider + play/pause) with one
 * circular-graph chord option per year — the same series shape as buildChord.
 *
 * Registers into window.RV.charts for the dashboard orchestrator.
 */
(function () {
    'use strict';

    var ns = window.RV;
    var THEME = ns.THEME, COLORS = ns.COLORS;
    var initChart = ns.initChart, truncateLabel = ns.truncateLabel;

    ns.charts = ns.charts || {};

    ns.charts.buildTimeChord = function (el, data, siteBase) {
        if (!data || !data.buckets || data.buckets.length < 2) return;
        var chart = initChart(el);
        chart._noDecal = true;

        function chordOption(bucket) {
            return {
                series: [{
                    type: 'graph', layout: 'circular', circular: { rotateLabel: true },
                    roam: true,
                    label: {
                        show: true, position: 'right', fontSize: THEME.fontSize - 1,
                        formatter: function (p) { return truncateLabel(p.name, 18); }
                    },
                    emphasis: { focus: 'adjacency', lineStyle: { width: 4, opacity: 0.9 } },
                    data: bucket.nodes.map(function (n, i) {
                        return {
                            name: n.name,
                            symbolSize: Math.max(10, Math.min(40, n.value * 2)),
                            itemStyle: { color: COLORS[i % COLORS.length] },
                            itemId: n.itemId
                        };
                    }),
                    links: bucket.links.map(function (l) {
                        return {
                            source: l.source, target: l.target, value: l.value,
                            lineStyle: { width: Math.max(1, Math.min(6, l.value)), curveness: 0.3, opacity: 0.5 }
                        };
                    })
                }]
            };
        }

        function render() {
            chart.setOption({
                baseOption: {
                    timeline: {
                        axisType: 'category', data: data.years,
                        autoPlay: false, playInterval: 1600,
                        left: 30, right: 30, bottom: 0,
                        label: { color: THEME.textMuted, fontSize: THEME.fontSize },
                        controlStyle: { color: THEME.accent, borderColor: THEME.accent },
                        checkpointStyle: { color: THEME.accent, borderColor: THEME.accent },
                        lineStyle: { color: THEME.grid },
                        itemStyle: { color: THEME.gridLight }
                    },
                    tooltip: {
                        confine: true,
                        formatter: function (p) {
                            if (p.dataType === 'node') return '<strong>' + echarts.format.encodeHTML(p.name) + '</strong>';
                            if (p.dataType === 'edge') {
                                return echarts.format.encodeHTML(p.data.source) + ' ↔ '
                                    + echarts.format.encodeHTML(p.data.target) + ': ' + p.data.value;
                            }
                            return '';
                        }
                    },
                    aria: { enabled: true }
                },
                options: data.buckets.map(chordOption)
            });
        }

        render();
        chart._rvRebuild = render; // re-resolve theme colours on light/dark toggle

        chart.on('click', function (p) {
            if (p.dataType === 'node' && p.data.itemId && siteBase) {
                window.location.href = siteBase + '/item/' + p.data.itemId;
            }
        });
        return chart;
    };
})();
