/**
 * Knowledge Graph visualization using ECharts force-directed graph.
 *
 * Renders an interactive network with the current item at the center,
 * its direct linked resources, and other items sharing those resources.
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

        // Assign colors to categories.
        data.categories.forEach(function (cat, i) {
            cat.itemStyle = { color: COLORS[i % COLORS.length] };
        });

        // Scale force parameters based on node count.
        var repulsion = nodeCount > 50 ? 500 : nodeCount > 20 ? 400 : 300;
        var edgeLengthRange = nodeCount > 50 ? [80, 280] : [60, 200];

        var option = {
            tooltip: {
                trigger: 'item',
                formatter: function (params) {
                    if (params.dataType === 'node') {
                        var cat = data.categories[params.data.category];
                        return '<strong>' + echarts.format.encodeHTML(params.name) + '</strong>'
                            + '<br/><span style="color:' + COLORS[params.data.category % COLORS.length] + '">'
                            + echarts.format.encodeHTML(cat ? cat.name : '') + '</span>';
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
                textStyle: { fontSize: 11 }
            },
            animationDuration: 800,
            animationEasingUpdate: 'quinticInOut',
            series: [{
                type: 'graph',
                layout: 'force',
                data: data.nodes.map(function (n) {
                    return {
                        id: n.id,
                        name: n.name,
                        category: n.category,
                        symbolSize: n.symbolSize || 25,
                        label: {
                            show: !!n.isCenter,
                            fontSize: n.isCenter ? 13 : 11,
                            fontWeight: n.isCenter ? 'bold' : 'normal'
                        },
                        itemStyle: n.isCenter
                            ? { borderColor: '#333', borderWidth: 2 }
                            : {}
                    };
                }),
                links: data.edges.map(function (e) {
                    return {
                        source: e.source,
                        target: e.target,
                        name: e.name,
                        lineStyle: {
                            color: e.isShared ? '#d0d0d0' : '#aaa',
                            type: e.isShared ? 'dashed' : 'solid',
                            width: e.isShared ? 1 : 1.5,
                            curveness: 0.1,
                            opacity: e.isShared ? 0.4 : 0.6
                        }
                    };
                }),
                categories: data.categories,
                force: {
                    repulsion: repulsion,
                    gravity: 0.08,
                    edgeLength: edgeLengthRange,
                    friction: 0.6
                },
                roam: true,
                draggable: true,
                emphasis: {
                    focus: 'adjacency',
                    lineStyle: { width: 3 }
                },
                label: {
                    position: 'right',
                    formatter: function (params) {
                        var name = params.name || '';
                        return name.length > 30 ? name.substring(0, 30) + '\u2026' : name;
                    }
                },
                lineStyle: {
                    opacity: 0.6,
                    width: 1.5
                },
                scaleLimit: {
                    min: 0.2,
                    max: 5
                }
            }]
        };

        chart.setOption(option);

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
