/**
 * Discursive Communities builder: subject co-occurrence force graph, nodes
 * coloured by Louvain community and sized by PageRank.
 *
 * Data: { nodes: [{ name, value, itemId, community, rank }],
 *         links: [{ source, target, value }],
 *         communities: [{ id, size, anchor }] }
 *
 * Registers into window.RV.charts; rendered by the Discursive Communities
 * site-page block via dashboard-communities.js.
 */
(function () {
    'use strict';

    var ns = window.RV;
    var THEME = ns.THEME, COLORS = ns.COLORS;
    var initChart = ns.initChart, truncateLabel = ns.truncateLabel;

    ns.charts = ns.charts || {};

    ns.charts.buildCommunities = function (el, data, siteBase) {
        if (!data || !data.nodes || !data.nodes.length || !data.links) return;
        var chart = initChart(el);
        var n = data.nodes.length;
        var communities = (data.communities && data.communities.length)
            ? data.communities : [{ id: 0, size: n, anchor: null }];

        // Re-runnable so the theme engine re-applies community colours on toggle.
        function render() {
            var catIndex = {};
            var cats = communities.map(function (c, i) {
                catIndex[c.id] = i;
                var label = c.anchor ? (c.anchor + ' (' + c.size + ')') : ('Community ' + (c.id + 1));
                return { name: truncateLabel(label, 28), itemStyle: { color: COLORS[c.id % COLORS.length] } };
            });

            var maxRank = data.nodes.reduce(function (m, nd) {
                return Math.max(m, nd.rank || 0);
            }, 0) || 1;

            chart.setOption({
                tooltip: {
                    confine: true,
                    formatter: function (p) {
                        if (p.dataType === 'node') {
                            return '<strong>' + echarts.format.encodeHTML(p.name) + '</strong>'
                                + '<br/>' + p.data.value + ' items'
                                + (p.data.matched ? '<br/><em>matched person</em>' : '')
                                + '<br/><em>community ' + (p.data.community + 1) + '</em>';
                        }
                        if (p.dataType === 'edge') {
                            return echarts.format.encodeHTML(p.data.source) + ' ↔ '
                                + echarts.format.encodeHTML(p.data.target) + ': ' + p.data.value;
                        }
                        return '';
                    }
                },
                aria: { enabled: true },
                legend: cats.length > 1 ? [{
                    data: cats.map(function (c) { return c.name; }),
                    type: 'scroll', bottom: 0,
                    textStyle: { color: THEME.text, fontSize: THEME.fontSize }
                }] : [],
                series: [{
                    type: 'graph', layout: 'force',
                    categories: cats,
                    roam: true, draggable: true,
                    scaleLimit: { min: 0.3, max: 5 },
                    data: data.nodes.map(function (nd) {
                        var size = 8 + Math.sqrt((nd.rank || 0) / maxRank) * 38;
                        var node = {
                            name: nd.name, value: nd.value, itemId: nd.itemId,
                            community: nd.community, matched: nd.matched,
                            category: catIndex[nd.community] != null ? catIndex[nd.community] : 0,
                            symbolSize: size,
                            label: {
                                show: size > 26, color: THEME.text, fontSize: THEME.fontSize,
                                formatter: function (p) { return truncateLabel(p.name, THEME.labelMaxLen); }
                            }
                        };
                        if (nd.matched) {
                            node.itemStyle = { borderColor: THEME.accent || THEME.text, borderWidth: 2.5 };
                        }
                        return node;
                    }),
                    links: data.links.map(function (l) {
                        return {
                            source: l.source, target: l.target, value: l.value,
                            lineStyle: {
                                width: Math.max(0.5, Math.min(4, Math.sqrt(l.value))),
                                opacity: 0.22, curveness: 0.1
                            }
                        };
                    }),
                    force: {
                        repulsion: n > 60 ? 240 : 150,
                        gravity: 0.06, edgeLength: [40, 160], friction: 0.85
                    },
                    emphasis: { focus: 'adjacency', label: { show: true }, lineStyle: { opacity: 0.6 } },
                    blur: { itemStyle: { opacity: 0.12 }, lineStyle: { opacity: 0.04 } }
                }]
            });
        }

        render();
        chart._rvRebuild = render; // re-colour by community on light/dark toggle

        chart.on('click', function (p) {
            if (p.dataType === 'node' && p.data.itemId && siteBase) {
                window.location.href = siteBase + '/item/' + p.data.itemId;
            }
        });
        return chart;
    };
})();
