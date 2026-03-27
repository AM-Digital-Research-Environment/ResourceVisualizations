/**
 * Knowledge Graph visualization using ECharts force-directed graph.
 *
 * Renders an interactive network with click-to-navigate support.
 * Nodes link to their Omeka S resource pages.
 */
(function () {
    'use strict';

    var COLORS = [
        '#22817b', '#e07c3e', '#6b5b95', '#d4a574', '#2c5f7c',
        '#c5504d', '#4a8c6f', '#8b6f47', '#7c5295', '#cc8963'
    ];

    function initKnowledgeGraph(container) {
        var raw = container.getAttribute('data-graph');
        if (!raw) return;

        var data;
        try {
            data = JSON.parse(raw);
        } catch (e) {
            console.error('ResourceVisualizations: invalid graph data', e);
            return;
        }

        if (!data.nodes || data.nodes.length < 2) return;

        var chart = echarts.init(container);
        var nodeCount = data.nodes.length;
        var edgeCount = data.edges.length;

        // Assign colors to categories.
        data.categories.forEach(function (cat, i) {
            cat.itemStyle = { color: COLORS[i % COLORS.length] };
        });

        // Build a URL lookup for click navigation.
        var urlMap = {};
        data.nodes.forEach(function (n) {
            if (n.url) urlMap[n.id] = n.url;
        });

        // Scale force parameters based on graph size.
        var repulsion = nodeCount > 60 ? 600 : nodeCount > 30 ? 450 : 300;
        var gravity = nodeCount > 60 ? 0.05 : 0.08;
        var edgeLengthRange = nodeCount > 60 ? [40, 250] : nodeCount > 30 ? [50, 200] : [60, 180];

        var option = {
            tooltip: {
                trigger: 'item',
                formatter: function (params) {
                    if (params.dataType === 'node') {
                        var cat = data.categories[params.data.category];
                        var catName = cat ? cat.name : '';
                        var tip = '<strong>' + echarts.format.encodeHTML(params.name) + '</strong>';
                        tip += '<br/><span style="color:' + COLORS[params.data.category % COLORS.length] + '">'
                            + echarts.format.encodeHTML(catName) + '</span>';
                        if (params.data.url) {
                            tip += '<br/><span style="font-size:11px;color:#888">Click to open</span>';
                        }
                        return tip;
                    }
                    if (params.dataType === 'edge') {
                        return echarts.format.encodeHTML(params.data.name || '');
                    }
                    return '';
                }
            },
            legend: {
                data: data.categories.map(function (c) { return c.name; }),
                orient: 'horizontal',
                bottom: 10,
                textStyle: { fontSize: 11 },
                type: 'scroll'
            },
            animationDuration: 600,
            animationEasingUpdate: 'quinticInOut',
            series: [{
                type: 'graph',
                layout: 'force',
                data: data.nodes.map(function (n) {
                    var isShared = !n.isCenter && n.symbolSize <= 16;
                    return {
                        id: n.id,
                        name: n.name,
                        category: n.category,
                        symbolSize: n.symbolSize || 22,
                        url: n.url || null,
                        label: {
                            show: !!n.isCenter,
                            fontSize: n.isCenter ? 14 : 11,
                            fontWeight: n.isCenter ? 'bold' : 'normal',
                            color: '#333'
                        },
                        emphasis: {
                            label: {
                                show: true,
                                fontSize: 12,
                                fontWeight: 'bold'
                            }
                        },
                        itemStyle: n.isCenter
                            ? { borderColor: '#333', borderWidth: 3, shadowBlur: 8, shadowColor: 'rgba(0,0,0,0.2)' }
                            : isShared
                                ? { opacity: 0.85 }
                                : { borderColor: '#fff', borderWidth: 1 }
                    };
                }),
                links: data.edges.map(function (e) {
                    return {
                        source: e.source,
                        target: e.target,
                        name: e.name,
                        lineStyle: {
                            color: e.isShared ? '#d0d0d0' : '#999',
                            type: e.isShared ? 'dashed' : 'solid',
                            width: e.isShared ? 0.8 : 1.5,
                            curveness: 0.15,
                            opacity: e.isShared ? 0.35 : 0.6
                        }
                    };
                }),
                categories: data.categories,
                force: {
                    repulsion: repulsion,
                    gravity: gravity,
                    edgeLength: edgeLengthRange,
                    friction: 0.6,
                    layoutAnimation: true
                },
                roam: true,
                draggable: true,
                cursor: 'pointer',
                emphasis: {
                    focus: 'adjacency',
                    lineStyle: { width: 2.5, opacity: 0.9 },
                    itemStyle: { shadowBlur: 12, shadowColor: 'rgba(0,0,0,0.25)' }
                },
                blur: {
                    itemStyle: { opacity: 0.15 },
                    lineStyle: { opacity: 0.08 }
                },
                label: {
                    position: 'right',
                    formatter: function (params) {
                        var name = params.name || '';
                        return name.length > 35 ? name.substring(0, 35) + '\u2026' : name;
                    }
                },
                lineStyle: {
                    opacity: 0.5,
                    width: 1.2
                },
                scaleLimit: {
                    min: 0.2,
                    max: 5
                }
            }]
        };

        chart.setOption(option);

        // Click-to-navigate: open the resource's Omeka S page.
        chart.on('click', function (params) {
            if (params.dataType === 'node' && params.data.url) {
                window.location.href = params.data.url;
            }
        });

        // Responsive resize.
        var resizeTimer;
        window.addEventListener('resize', function () {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(function () { chart.resize(); }, 100);
        });

        // Fullscreen toggle.
        var block = container.closest('.knowledge-graph-block');
        if (block) {
            var toggle = block.querySelector('.rv-fullscreen-toggle');
            if (toggle) {
                toggle.addEventListener('click', function () {
                    block.classList.toggle('rv-fullscreen');
                    setTimeout(function () { chart.resize(); }, 50);
                });
                // Escape key exits fullscreen.
                document.addEventListener('keydown', function (e) {
                    if (e.key === 'Escape' && block.classList.contains('rv-fullscreen')) {
                        block.classList.remove('rv-fullscreen');
                        setTimeout(function () { chart.resize(); }, 50);
                    }
                });
            }
        }
    }

    function init() {
        if (typeof echarts === 'undefined') {
            console.warn('ResourceVisualizations: ECharts not loaded');
            return;
        }
        var containers = document.querySelectorAll('.knowledge-graph-container');
        for (var i = 0; i < containers.length; i++) {
            initKnowledgeGraph(containers[i]);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
