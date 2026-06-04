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

    // Edge-relationship palette for the co-author network (used only when links
    // carry a `relation`). Pulled from the active cluster palette at render time
    // so it follows the light / dark theme; the legend and the edges read it from
    // the same place, so they stay in sync.
    function relStyles() {
        var P = COLORS;
        return {
            coauthor: { label: 'Co-authorship', color: P[4 % P.length] },
            mixed:    { label: 'Author–editor', color: P[1 % P.length] },
            coeditor: { label: 'Co-editorship', color: P[9 % P.length] }
        };
    }

    // Mount the relationship key below the graph (in the .chart-panel) — the same
    // below-the-canvas placement the map legends use. Idempotent: a stale legend
    // (e.g. from the light/dark rebuild) is removed first, so it never stacks.
    function mountEdgeLegend(el, rel, present) {
        var panel = el.closest('.chart-panel') || el.parentNode || el;
        var stale = panel.querySelector('.rv-edge-legend');
        if (stale) stale.remove();
        var rows = ['coauthor', 'mixed', 'coeditor'].filter(function (k) { return present[k]; })
            .map(function (k) {
                return '<span class="rv-map-legend-row">'
                    + '<span class="rv-map-legend-line" style="background:' + rel[k].color + '"></span>'
                    + echarts.format.encodeHTML(rel[k].label) + '</span>';
            });
        if (!rows.length) return;
        var legend = document.createElement('div');
        legend.className = 'rv-edge-legend';
        legend.innerHTML = rows.join('');
        panel.appendChild(legend);
    }

    ns.charts.buildCommunities = function (el, data, siteBase) {
        if (!data || !data.nodes || !data.nodes.length || !data.links) return;
        var chart = initChart(el);
        var n = data.nodes.length;
        // When links carry a `relation` (the co-author network), colour is reserved
        // for the edge relationship and the legend lists those; the subject graph
        // (no relation) keeps colouring nodes by Louvain community as before.
        var hasRel = data.links.some(function (l) { return !!l.relation; });
        var communities = (data.communities && data.communities.length)
            ? data.communities : [{ id: 0, size: n, anchor: null }];

        // Re-runnable so the theme engine re-applies colours on light/dark toggle.
        function render() {
            var rel = relStyles();
            var present = {};

            var catIndex = {};
            var cats = hasRel
                ? [{ name: 'Contributor', itemStyle: { color: THEME.accent } }]
                : communities.map(function (c, i) {
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
                            var meta = hasRel
                                ? '<br/><em>' + (p.data.role === 'both' ? 'author & editor'
                                    : p.data.role === 'editor' ? 'editor' : 'author')
                                    + (p.data.matched ? '' : ', external name') + '</em>'
                                : (p.data.matched ? '<br/><em>matched person</em>' : '')
                                    + '<br/><em>community ' + (p.data.community + 1) + '</em>';
                            return '<strong>' + echarts.format.encodeHTML(p.name) + '</strong>'
                                + '<br/>' + p.data.value + (hasRel ? ' publications' : ' items') + meta;
                        }
                        if (p.dataType === 'edge') {
                            var r = p.data.relation && rel[p.data.relation];
                            return echarts.format.encodeHTML(p.data.source) + ' ↔ '
                                + echarts.format.encodeHTML(p.data.target) + ': ' + p.data.value
                                + (r ? '<br/><em>' + r.label + '</em>' : '');
                        }
                        return '';
                    }
                },
                aria: { enabled: true },
                legend: (!hasRel && cats.length > 1) ? [{
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
                            community: nd.community, matched: nd.matched, role: nd.role,
                            category: (!hasRel && catIndex[nd.community] != null) ? catIndex[nd.community] : 0,
                            symbolSize: size,
                            label: {
                                show: size > 26, color: THEME.text, fontSize: THEME.fontSize,
                                formatter: function (p) { return truncateLabel(p.name, THEME.labelMaxLen); }
                            }
                        };
                        if (hasRel) {
                            // Solid accent = person matched to a record (click-through);
                            // muted = an external (literal) name.
                            node.itemStyle = {
                                color: nd.matched ? THEME.accent : THEME.textMuted,
                                opacity: nd.matched ? 1 : 0.6
                            };
                        } else if (nd.matched) {
                            node.itemStyle = { borderColor: THEME.accent || THEME.text, borderWidth: 2.5 };
                        }
                        return node;
                    }),
                    links: data.links.map(function (l) {
                        var ls = {
                            width: Math.max(0.5, Math.min(4, Math.sqrt(l.value))),
                            opacity: hasRel ? 0.55 : 0.22, curveness: 0.1
                        };
                        if (hasRel && rel[l.relation]) {
                            ls.color = rel[l.relation].color;
                            present[l.relation] = true;
                        }
                        return { source: l.source, target: l.target, value: l.value, relation: l.relation, lineStyle: ls };
                    }),
                    force: {
                        repulsion: n > 60 ? 240 : 150,
                        gravity: 0.06, edgeLength: [40, 160], friction: 0.85
                    },
                    emphasis: { focus: 'adjacency', label: { show: true }, lineStyle: { opacity: 0.6 } },
                    blur: { itemStyle: { opacity: 0.12 }, lineStyle: { opacity: 0.04 } }
                }]
            });

            if (hasRel) mountEdgeLegend(el, rel, present);
        }

        render();
        chart._rvRebuild = render; // re-colour on light/dark toggle

        chart.on('click', function (p) {
            if (p.dataType === 'node' && p.data.itemId && siteBase) {
                window.location.href = siteBase + '/item/' + p.data.itemId;
            }
        });
        return chart;
    };
})();
