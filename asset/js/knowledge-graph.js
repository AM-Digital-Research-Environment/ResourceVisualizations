/**
 * Knowledge Graph — loads precomputed JSON files, falls back to REST API.
 *
 * Priority:
 * 1. Try /files/resource-visualizations/{id}.json (precomputed, instant)
 * 2. Fall back to REST API (lightweight: direct relationships only)
 */
(function () {
    'use strict';

    var COLORS = [
        '#22817b', '#e07c3e', '#6b5b95', '#d4a574', '#2c5f7c',
        '#c5504d', '#4a8c6f', '#8b6f47', '#7c5295', '#cc8963'
    ];

    // Property -> category mapping (used in API fallback only).
    var PROP_CAT = {
        'dcterms:creator': 'Person', 'dcterms:contributor': 'Person', 'foaf:member': 'Person',
        'dcterms:subject': 'Subject', 'dcterms:spatial': 'Location', 'dcterms:provenance': 'Location',
        'dcterms:isPartOf': 'Project', 'dcterms:format': 'Genre', 'frapo:isFundedBy': 'Institution',
        'dcterms:relation': 'Related Item', 'dcterms:hasPart': 'Related Item',
        'dcterms:replaces': 'Related Item', 'dcterms:isReplacedBy': 'Related Item',
        'dcterms:hasVersion': 'Related Item', 'dcterms:isVersionOf': 'Related Item',
        'dcterms:hasFormat': 'Related Item'
    };

    function getCat(term) {
        if (PROP_CAT[term]) return PROP_CAT[term];
        if (term.indexOf('marcrel:') === 0) return 'Contributor';
        return null;
    }

    /* ------------------------------------------------------------------ */
    /*  Load precomputed or fall back to API                               */
    /* ------------------------------------------------------------------ */

    function loadGraphData(container) {
        var itemId = container.dataset.itemId;
        var basePath = container.dataset.basePath || '';
        var apiBase = container.dataset.apiBase;
        var precomputedUrl = basePath + '/modules/ResourceVisualizations/asset/data/knowledge-graphs/' + itemId + '.json';

        // Try precomputed file first.
        return fetch(precomputedUrl).then(function (resp) {
            if (resp.ok) return resp.json();
            throw new Error('not found');
        }).catch(function () {
            // Fall back to lightweight API (direct relationships only).
            return fetch(apiBase + '/items/' + itemId)
                .then(function (r) { return r.json(); })
                .then(function (item) { return buildFromApi(item); });
        });
    }

    /** Build graph from a single REST API item response (no shared items). */
    function buildFromApi(item) {
        var itemId = item['o:id'];
        var title = item['o:title'] || 'Item';
        var rc = item['o:resource_class'];
        var centerCat = (rc && rc['o:label']) || 'Item';

        var nodes = [], edges = [], categories = [{ name: centerCat }];
        var catMap = {}; catMap[centerCat] = 0;
        var seen = {};

        function ensureCat(name) {
            if (catMap[name] === undefined) { catMap[name] = categories.length; categories.push({ name: name }); }
            return catMap[name];
        }

        nodes.push({ id: 'item_' + itemId, name: title, category: 0, symbolSize: 45, isCenter: true, itemId: itemId });

        for (var key in item) {
            if (!Array.isArray(item[key]) || key.indexOf(':') === -1) continue;
            if (key.indexOf('o:') === 0 || key.indexOf('@') === 0) continue;

            var cat = getCat(key);
            if (!cat) continue;
            var catIdx = ensureCat(cat);

            item[key].forEach(function (v) {
                if (!v.value_resource_id) return;
                var nid = 'resource_' + v.value_resource_id;
                if (!seen[nid]) {
                    seen[nid] = true;
                    nodes.push({ id: nid, name: v.display_title || '', category: catIdx, symbolSize: 22, itemId: v.value_resource_id });
                }
                edges.push({ source: 'item_' + itemId, target: nid, name: v.property_label || key });
            });
        }

        return { nodes: nodes, edges: edges, categories: categories };
    }

    /* ------------------------------------------------------------------ */
    /*  ECharts rendering                                                  */
    /* ------------------------------------------------------------------ */

    function renderChart(container, data, siteBase) {
        // Add URLs to nodes.
        data.nodes.forEach(function (n) {
            if (n.itemId && siteBase) {
                n.url = siteBase + '/item/' + n.itemId;
            }
        });

        var chart = echarts.init(container);
        var n = data.nodes.length;

        data.categories.forEach(function (cat, i) {
            cat.itemStyle = { color: COLORS[i % COLORS.length] };
        });

        var option = {
            tooltip: {
                trigger: 'item',
                confine: true,
                formatter: function (p) {
                    if (p.dataType === 'node') {
                        var c = data.categories[p.data.category];
                        var t = '<strong>' + echarts.format.encodeHTML(p.name) + '</strong><br/>'
                            + '<span style="color:' + COLORS[p.data.category % COLORS.length] + '">'
                            + echarts.format.encodeHTML(c ? c.name : '') + '</span>';
                        if (p.data.url) t += '<br/><span style="font-size:11px;color:#888">Click to open</span>';
                        return t;
                    }
                    return p.dataType === 'edge' ? echarts.format.encodeHTML(p.data.name || '') : '';
                }
            },
            legend: {
                data: data.categories.map(function (c) { return c.name; }),
                bottom: 10, textStyle: { fontSize: 11 }, type: 'scroll'
            },
            animationDuration: 600,
            series: [{
                type: 'graph', layout: 'force',
                data: data.nodes.map(function (nd) {
                    var sh = !nd.isCenter && nd.symbolSize <= 16;
                    return {
                        id: nd.id, name: nd.name, category: nd.category, url: nd.url || null,
                        symbolSize: nd.symbolSize,
                        label: {
                            show: !!nd.isCenter, fontSize: nd.isCenter ? 14 : 11,
                            fontWeight: nd.isCenter ? 'bold' : 'normal',
                            width: 150, overflow: 'break'
                        },
                        emphasis: { label: { show: true, fontSize: 12, fontWeight: 'bold', width: 180, overflow: 'break' } },
                        itemStyle: nd.isCenter
                            ? { borderColor: '#333', borderWidth: 3, shadowBlur: 8, shadowColor: 'rgba(0,0,0,0.2)' }
                            : sh ? { opacity: 0.85 } : { borderColor: '#fff', borderWidth: 1 }
                    };
                }),
                links: data.edges.map(function (e) {
                    return {
                        source: e.source, target: e.target, name: e.name,
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
                    repulsion: n > 60 ? 600 : n > 30 ? 450 : 300,
                    gravity: n > 60 ? 0.05 : 0.08,
                    edgeLength: n > 60 ? [40, 250] : [60, 200],
                    friction: 0.6
                },
                roam: true, draggable: true, cursor: 'pointer',
                emphasis: { focus: 'adjacency', lineStyle: { width: 2.5, opacity: 0.9 } },
                blur: { itemStyle: { opacity: 0.15 }, lineStyle: { opacity: 0.08 } },
                label: { position: 'right', formatter: function (p) { var s = p.name || ''; return s.length > 35 ? s.substring(0, 35) + '\u2026' : s; } },
                lineStyle: { opacity: 0.5, width: 1.2 },
                scaleLimit: { min: 0.2, max: 5 }
            }]
        };

        chart.setOption(option);

        chart.on('click', function (p) {
            if (p.dataType === 'node' && p.data.url) window.location.href = p.data.url;
        });

        var timer;
        window.addEventListener('resize', function () { clearTimeout(timer); timer = setTimeout(function () { chart.resize(); }, 100); });

        var block = container.closest('.knowledge-graph-block');
        if (block) {
            var toggle = block.querySelector('.rv-fullscreen-toggle');
            if (toggle) {
                toggle.addEventListener('click', function () {
                    block.classList.toggle('rv-fullscreen');
                    setTimeout(function () { chart.resize(); }, 50);
                });
            }
            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape' && block.classList.contains('rv-fullscreen')) {
                    block.classList.remove('rv-fullscreen');
                    setTimeout(function () { chart.resize(); }, 50);
                }
            });
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Init                                                               */
    /* ------------------------------------------------------------------ */

    function initKnowledgeGraph(container) {
        if (!container.dataset.itemId) return;
        var siteBase = container.dataset.siteBase || '';

        loadGraphData(container).then(function (data) {
            if (!data || !data.nodes || data.nodes.length < 2) {
                container.innerHTML = '<p class="rv-no-data">No relationships found.</p>';
                return;
            }
            container.innerHTML = '';
            renderChart(container, data, siteBase);
        }).catch(function (err) {
            console.error('ResourceVisualizations:', err);
            container.innerHTML = '<p class="rv-error">Failed to load knowledge graph.</p>';
        });
    }

    function init() {
        if (typeof echarts === 'undefined') {
            console.warn('ResourceVisualizations: ECharts not loaded');
            return;
        }
        var cs = document.querySelectorAll('.knowledge-graph-container');
        for (var i = 0; i < cs.length; i++) initKnowledgeGraph(cs[i]);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
