/**
 * Knowledge Graph — async client-side loading via Omeka S REST API.
 *
 * The page loads instantly. Graph data is fetched in the background,
 * then rendered with ECharts.
 */
(function () {
    'use strict';

    var COLORS = [
        '#22817b', '#e07c3e', '#6b5b95', '#d4a574', '#2c5f7c',
        '#c5504d', '#4a8c6f', '#8b6f47', '#7c5295', '#cc8963'
    ];

    // Properties to show as graph nodes (mapped to category names).
    var PROP_CAT = {
        'dcterms:creator': 'Person', 'dcterms:contributor': 'Person', 'foaf:member': 'Person',
        'dcterms:subject': 'Subject',
        'dcterms:spatial': 'Location', 'dcterms:provenance': 'Location',
        'dcterms:isPartOf': 'Project',
        'dcterms:format': 'Genre',
        'frapo:isFundedBy': 'Institution',
        'dcterms:relation': 'Related Item', 'dcterms:hasPart': 'Related Item',
        'dcterms:replaces': 'Related Item', 'dcterms:isReplacedBy': 'Related Item',
        'dcterms:hasVersion': 'Related Item', 'dcterms:isVersionOf': 'Related Item',
        'dcterms:hasFormat': 'Related Item'
    };

    // Properties used to find shared items.
    var SHAREABLE = new Set([
        'dcterms:subject', 'dcterms:isPartOf', 'dcterms:spatial',
        'dcterms:creator', 'dcterms:contributor'
    ]);

    /* ------------------------------------------------------------------ */
    /*  Helpers                                                            */
    /* ------------------------------------------------------------------ */

    function fetchJson(url) {
        return fetch(url).then(function (r) { return r.json(); });
    }

    function getCat(term) {
        if (PROP_CAT[term]) return PROP_CAT[term];
        if (term.indexOf('marcrel:') === 0) return 'Contributor';
        return null;
    }

    function itemUrl(siteBase, id) {
        return siteBase + '/item/' + id;
    }

    /** Extract resource-linked property values from an API item object. */
    function getResValues(item) {
        var out = {};
        for (var key in item) {
            if (!Array.isArray(item[key]) || key.indexOf(':') === -1) continue;
            if (key.indexOf('o:') === 0 || key.indexOf('@') === 0) continue;
            var res = [];
            item[key].forEach(function (v) {
                if (v.value_resource_id) {
                    res.push({ id: v.value_resource_id, title: v.display_title || '', label: v.property_label || key });
                }
            });
            if (res.length) out[key] = res;
        }
        return out;
    }

    /* ------------------------------------------------------------------ */
    /*  Graph builder                                                      */
    /* ------------------------------------------------------------------ */

    function buildGraph(item, sharedItems, reverseItems, siteBase, resourceClass) {
        var itemId = item['o:id'];
        var itemTitle = item['o:title'] || 'Item';
        var centerCat = (item['o:resource_class'] && item['o:resource_class']['o:label']) || 'Item';

        var nodes = [], edges = [], categories = [{ name: centerCat }];
        var catMap = {}; catMap[centerCat] = 0;
        var seen = {};
        var centerLinked = {}; // resourceId -> nodeId

        function ensureCat(name) {
            if (catMap[name] === undefined) { catMap[name] = categories.length; categories.push({ name: name }); }
            return catMap[name];
        }

        // Center node.
        nodes.push({
            id: 'item_' + itemId, name: itemTitle, category: 0,
            symbolSize: 45, isCenter: true, url: itemUrl(siteBase, itemId)
        });

        // Direct relationships.
        var filters = [];
        var vals = getResValues(item);
        for (var term in vals) {
            var cat = getCat(term);
            if (!cat) continue;
            var catIdx = ensureCat(cat);
            var shareable = SHAREABLE.has(term) || term.indexOf('marcrel:') === 0;

            vals[term].forEach(function (r) {
                var nid = 'resource_' + r.id;
                if (!seen[nid]) {
                    seen[nid] = true;
                    nodes.push({ id: nid, name: r.title, category: catIdx, symbolSize: 22, url: itemUrl(siteBase, r.id) });
                }
                edges.push({ source: 'item_' + itemId, target: nid, name: r.label });
                if (shareable) {
                    centerLinked[r.id] = nid;
                    if (filters.length < 12) filters.push({ term: term, id: r.id });
                }
            });
        }

        // Reverse items (projects linking to this section, etc.).
        if (reverseItems && reverseItems.length) {
            var isSection = resourceClass === 'frapo:ResearchGroup';
            var revCatIdx = ensureCat(isSection ? 'Project' : 'Linked Item');
            reverseItems.forEach(function (ri) {
                var rid = ri['o:id'];
                if (rid === itemId) return;
                var rnid = 'item_' + rid;
                if (!seen[rnid]) {
                    seen[rnid] = true;
                    nodes.push({ id: rnid, name: ri['o:title'] || '', category: revCatIdx, symbolSize: 22, url: itemUrl(siteBase, rid) });
                }
                edges.push({ source: rnid, target: 'item_' + itemId, name: 'Is Part Of' });
            });
        }

        // Shared items — connect to ALL matching resources.
        if (sharedItems && sharedItems.length) {
            var siCatIdx = ensureCat('Shared Item');
            sharedItems.forEach(function (si) {
                var sid = si['o:id'];
                if (sid === itemId) return;
                var snid = 'item_' + sid;
                var siVals = getResValues(si);
                var matched = {};

                for (var sTerm in siVals) {
                    siVals[sTerm].forEach(function (r) {
                        var target = centerLinked[r.id];
                        if (target) {
                            var ek = snid + '>' + target;
                            if (!matched[ek]) { matched[ek] = { target: target, name: r.label }; }
                        }
                    });
                }

                var keys = Object.keys(matched);
                if (!keys.length) return;
                if (!seen[snid]) {
                    seen[snid] = true;
                    nodes.push({ id: snid, name: si['o:title'] || '', category: siCatIdx, symbolSize: 16, url: itemUrl(siteBase, sid) });
                }
                keys.forEach(function (k) {
                    edges.push({ source: snid, target: matched[k].target, name: matched[k].name, isShared: true });
                });
            });
        }

        return { nodes: nodes, edges: edges, categories: categories, filters: filters };
    }

    /* ------------------------------------------------------------------ */
    /*  Async data loading                                                 */
    /* ------------------------------------------------------------------ */

    function buildFilterUrl(apiBase, filters) {
        if (!filters.length) return null;
        var parts = filters.map(function (f, i) {
            var p = 'property[' + i + ']';
            var s = p + '[property]=' + encodeURIComponent(f.term) + '&' + p + '[type]=res&' + p + '[text]=' + f.id;
            if (i > 0) s += '&' + p + '[joiner]=or';
            return s;
        });
        return apiBase + '/items?' + parts.join('&') + '&per_page=40';
    }

    function loadGraphData(container) {
        var itemId = container.dataset.itemId;
        var apiBase = container.dataset.apiBase;
        var siteBase = container.dataset.siteBase;
        var resourceClass = container.dataset.resourceClass || '';

        return fetchJson(apiBase + '/items/' + itemId).then(function (item) {
            // Build initial graph to get shareable filters.
            var graph = buildGraph(item, [], [], siteBase, resourceClass);
            var filterUrl = buildFilterUrl(apiBase, graph.filters);
            var reverseUrl = apiBase + '/items?property[0][property]=' + encodeURIComponent('dcterms:isPartOf')
                + '&property[0][type]=res&property[0][text]=' + itemId + '&per_page=25';

            // Fetch shared + reverse in parallel.
            return Promise.all([
                filterUrl ? fetchJson(filterUrl).catch(function () { return []; }) : Promise.resolve([]),
                fetchJson(reverseUrl).catch(function () { return []; })
            ]).then(function (results) {
                return buildGraph(item, results[0], results[1], siteBase, resourceClass);
            });
        });
    }

    /* ------------------------------------------------------------------ */
    /*  ECharts rendering                                                  */
    /* ------------------------------------------------------------------ */

    function renderChart(container, data) {
        var chart = echarts.init(container);
        var n = data.nodes.length;

        data.categories.forEach(function (cat, i) {
            cat.itemStyle = { color: COLORS[i % COLORS.length] };
        });

        var option = {
            tooltip: {
                trigger: 'item',
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
                        id: nd.id, name: nd.name, category: nd.category,
                        symbolSize: nd.symbolSize, url: nd.url,
                        label: { show: !!nd.isCenter, fontSize: nd.isCenter ? 14 : 11, fontWeight: nd.isCenter ? 'bold' : 'normal' },
                        emphasis: { label: { show: true, fontSize: 12, fontWeight: 'bold' } },
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

        loadGraphData(container).then(function (data) {
            if (!data || data.nodes.length < 2) {
                container.innerHTML = '<p class="rv-no-data">No relationships found.</p>';
                return;
            }
            container.innerHTML = '';
            renderChart(container, data);
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
