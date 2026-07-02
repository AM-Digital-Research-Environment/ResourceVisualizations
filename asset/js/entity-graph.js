/**
 * Entity Network — the collection-wide, multi-entity co-occurrence graph for the
 * Discursive Communities site-page block. Renders the precomputed
 * communities/entity-graph.json with MapLibre GL — the same WebGL renderer every
 * DRE map already ships — instead of a dedicated graph library.
 *
 * Node positions are baked at precompute time (ForceAtlas2 in PHP, projected to
 * pseudo lng/lat), so the client does ZERO layout work: pan/zoom over ~15k edges
 * stays GPU-bound and the network renders instantly and identically every load.
 * MapLibre symbol layers give label collision for free.
 *
 * Self-contained controller (it does NOT use the ECharts window.RV.charts
 * registry — MapLibre is a separate renderer): it fetches the data, builds the
 * UI, and owns all interaction. It reuses dashboard-core.js only for the shared
 * theme tokens (ns.THEME / ns.COLORS / ns.HALO, resolved to concrete RGB), which
 * it re-reads on every light/dark toggle to recolour the layers in place.
 *
 * Depends on (loaded first, deferred):
 *   - asset/js/dashboard-core.js → window.RV (theme tokens, basePath helpers, and
 *     ns.ensureLibs — the shared lazy loader that pulls in MapLibre GL on mount,
 *     so a page with both a dashboard and this graph loads MapLibre exactly once)
 *
 * Data (compact row arrays, see EntityGraphTrait::buildEntityGraph):
 *   { types: ['Person','Organization','Location','Subject','Tag'],
 *     sections: ['Knowledges', 'Learning', ...],   // research-section overlay labels
 *     nodes: [[id, label, type, count, degree, community, section, lng, lat, rank], ...],
 *     edges: [[sourceIndex, targetIndex, weight], ...],
 *     meta:  { weightMin, weightMax, communityCount, sectionCount, bounds:[w,s,e,n], ... } }
 *
 * `section` is the index of the entity's dominant research section into `sections`,
 * or -2 for a cross-section bridge and -1 for an entity in no sectioned work.
 */
(function () {
    'use strict';

    var ns = window.RV || (window.RV = {});
    var el = ns.el || function (tag, cls, text) {
        var node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text != null) node.textContent = text;
        return node;
    };
    var escapeHtml = ns.escapeHtml || function (value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
        });
    };

    // Glyph endpoint for the symbol (label) layer — the same CartoCDN fonts the
    // DRE basemaps use (ns.getBasemapStyle points at cartocdn), so labels render
    // with no new third-party dependency.
    var GLYPHS = 'https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf';
    var LABEL_FONT = ['Noto Sans Regular'];

    var SRC_NODES = 'eg-nodes';
    var SRC_EDGES = 'eg-edges';
    var L_EDGES = 'eg-edge-lines';
    var L_EDGES_HL = 'eg-edge-lines-hl';
    var L_NODES = 'eg-node-circles';
    var L_LABELS = 'eg-node-labels';

    var MIN_RADIUS = 3;
    var MAX_RADIUS = 18;

    /** Lower-case + strip diacritics, so "Laïcité" matches a "laicite" query. */
    function fold(s) {
        s = (s == null ? '' : String(s)).toLowerCase();
        return s.normalize ? s.normalize('NFD').replace(/[̀-ͯ]/g, '') : s;
    }

    /* ------------------------------------------------------------------ */
    /*  Theme bridge (dashboard-core.js) — concrete RGB, mutated in place  */
    /* ------------------------------------------------------------------ */

    var THEME_FALLBACK = {
        text: '#333', textMuted: '#666', accent: '#22817b', surface: '#fff',
        grid: '#e0e0e0', gridLight: '#f0f0f0',
        fontFamily: 'system-ui, sans-serif'
    };
    function theme() { return ns.THEME || THEME_FALLBACK; }
    function isDark() { return typeof ns.isDark === 'function' ? ns.isDark() : false; }

    function colors() {
        return (ns.COLORS && ns.COLORS.length) ? ns.COLORS
            : ['#22817b', '#f59c08', '#7e57c2', '#2e7d32', '#c2185b', '#0277bd', '#5d4037'];
    }
    function halo() {
        return (ns.HALO && ns.HALO.length) ? ns.HALO : colors();
    }
    function typeColor(typeIdx) {
        var pal = colors();
        return pal[typeIdx % pal.length];
    }
    function dimColor() { return isDark() ? 'rgba(120,130,140,0.30)' : 'rgba(150,160,170,0.30)'; }

    /* ------------------------------------------------------------------ */
    /*  Decode the compact payload                                         */
    /* ------------------------------------------------------------------ */

    function decode(payload) {
        var meta = payload.meta || {};
        return {
            types: payload.types || [],
            sections: payload.sections || [],
            weightMin: meta.weightMin || 2,
            weightMax: meta.weightMax || 2,
            communityCount: meta.communityCount || 0,
            bounds: meta.bounds || null,
            nodes: (payload.nodes || []).map(function (r) {
                // v2.19+ inserts `section` after `community` (10 fields). Older
                // precomputed files omit it (9 fields: …community, lng, lat, rank) —
                // stay compatible until the next regeneration so positions never shift.
                var s = r.length >= 10;
                return {
                    id: r[0], label: r[1], type: r[2], count: r[3], degree: r[4],
                    community: r[5], section: s ? r[6] : -1,
                    lng: s ? r[7] : r[6], lat: s ? r[8] : r[7], rank: (s ? r[9] : r[8]) || 0
                };
            }),
            edges: payload.edges || []
        };
    }

    /* ------------------------------------------------------------------ */
    /*  Main build                                                         */
    /* ------------------------------------------------------------------ */

    function build(container, data, ctx) {
        var types = data.types;
        var sections = data.sections || [];
        var siteBase = ctx.siteBase;

        container.innerHTML = '';

        /* -- header + description -- */
        var header = el('div', 'dashboard-header');
        header.appendChild(el('h3', null, 'Entity Network'));
        header.appendChild(el('span', 'dashboard-total',
            data.nodes.length + ' entities · ' + data.edges.length + ' links'
            + (data.communityCount ? (' · ' + data.communityCount + ' clusters') : '')));
        container.appendChild(header);

        container.appendChild(el('p', 'chart-description',
            'People, organisations, places, subjects and tags that co-occur across the '
            + 'collection, laid out by force-directed clustering. Drag to pan, scroll to '
            + 'zoom, hover to isolate an entity’s links, and click an entity for '
            + 'details and its page.'));

        /* -- toolbar -- */
        var toolbar = el('div', 'deg-toolbar');
        container.appendChild(toolbar);

        /* -- stage: map canvas + side panel -- */
        var stage = el('div', 'deg-stage');
        var canvas = el('div', 'deg-canvas');
        canvas.setAttribute('role', 'application');
        canvas.setAttribute('aria-label', 'Entity co-occurrence network');
        var sidebar = el('div', 'deg-sidebar');
        stage.appendChild(canvas);
        stage.appendChild(sidebar);
        container.appendChild(stage);

        var legend = el('div', 'deg-legend');
        container.appendChild(legend);

        /* -- derived data -- */
        var maxDegree = 1, maxWeight = 1;
        data.nodes.forEach(function (n) { if (n.degree > maxDegree) maxDegree = n.degree; });
        data.edges.forEach(function (e) { if (e[2] > maxWeight) maxWeight = e[2]; });

        var commSet = {};
        data.nodes.forEach(function (n) { if (n.community >= 0) commSet[n.community] = true; });
        var commIds = Object.keys(commSet).map(Number).sort(function (a, b) { return a - b; });

        // adjacency[i] = [{ j, w }] sorted by weight desc.
        var adjacency = data.nodes.map(function () { return []; });
        data.edges.forEach(function (e) {
            adjacency[e[0]].push({ j: e[1], w: e[2] });
            adjacency[e[1]].push({ j: e[0], w: e[2] });
        });
        adjacency.forEach(function (list) { list.sort(function (a, b) { return b.w - a.w; }); });

        var nodeFeatures = {
            type: 'FeatureCollection',
            features: data.nodes.map(function (n, i) {
                return {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [n.lng, n.lat] },
                    properties: {
                        i: i, type: n.type, comm: n.community, sec: n.section,
                        r: MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * Math.sqrt(n.degree / maxDegree),
                        label: n.label, rank: n.rank
                    }
                };
            })
        };
        var edgeFeatures = {
            type: 'FeatureCollection',
            features: data.edges.map(function (e) {
                var s = data.nodes[e[0]], t = data.nodes[e[1]];
                return {
                    type: 'Feature',
                    geometry: { type: 'LineString', coordinates: [[s.lng, s.lat], [t.lng, t.lat]] },
                    properties: {
                        s: e[0], t: e[1], w: e[2], st: s.type, tt: t.type,
                        wn: Math.sqrt(e[2] / maxWeight)
                    }
                };
            })
        };

        var bounds = data.bounds;
        if (!bounds) {
            var w = 180, s = 90, e2 = -180, n2 = -90;
            data.nodes.forEach(function (nd) {
                if (nd.lng < w) w = nd.lng; if (nd.lng > e2) e2 = nd.lng;
                if (nd.lat < s) s = nd.lat; if (nd.lat > n2) n2 = nd.lat;
            });
            bounds = [w, s, e2, n2];
        }

        /* -- interaction state (persists across theme recolours) -- */
        var enabledTypes = {};
        types.forEach(function (_t, i) { enabledTypes[i] = true; });
        var weightMin = data.weightMin;
        var colorMode = 'type';        // 'type' | 'community' | 'section'
        var selectedIndex = null;
        var map = null;
        var fitted = false;
        var hoverPopup = null;
        var hoverId = null;

        /* ------------------------------------------------------------------ */
        /*  Paint expressions                                                  */
        /* ------------------------------------------------------------------ */

        function sectionColor(i) {
            var pal = colors();
            return pal[i % pal.length];
        }

        function nodeColorExpr() {
            var expr, pal, i;
            if (colorMode === 'community') {
                pal = halo();
                expr = ['match', ['get', 'comm']];
                for (i = 0; i < commIds.length; i++) {
                    expr.push(commIds[i], pal[commIds[i] % pal.length]);
                }
                expr.push(dimColor());           // default: unclustered (-1)
                return expr;
            }
            if (colorMode === 'section' && sections.length) {
                expr = ['match', ['get', 'sec']];
                for (i = 0; i < sections.length; i++) {
                    expr.push(i, sectionColor(i));
                }
                expr.push(dimColor());           // default: bridge (-2) / no section (-1)
                return expr;
            }
            pal = colors();
            expr = ['match', ['get', 'type']];
            for (i = 0; i < types.length; i++) {
                expr.push(i, pal[i % pal.length]);
            }
            expr.push(theme().textMuted);
            return expr;
        }

        function edgeOpacityExpr(min, max) {
            return ['+', min, ['*', max - min, ['get', 'wn']]];
        }
        function hoverOpacityExpr(base, hovered) {
            return ['case', ['boolean', ['feature-state', 'hover'], false], hovered, base];
        }

        /* ------------------------------------------------------------------ */
        /*  Filters + selection                                                */
        /* ------------------------------------------------------------------ */

        function enabledList() {
            var out = [];
            types.forEach(function (_t, i) { if (enabledTypes[i]) out.push(i); });
            return out;
        }
        function allTypesOn() { return enabledList().length === types.length; }

        // A facet is "active" whenever the view is narrowed from its default: a type
        // switched off, the min-link raised, or an entity selected. Drives the
        // enabled state of the Clear-filters button (colour mode is a lens, not a facet).
        function filtersActive() {
            return !allTypesOn() || weightMin > data.weightMin || selectedIndex != null;
        }
        function updateClearState() {
            if (clearBtn) clearBtn.disabled = !filtersActive();
        }

        function nodeFilter() {
            if (allTypesOn()) return null;
            return ['in', ['get', 'type'], ['literal', enabledList()]];
        }
        function edgeFilter() {
            var parts = [];
            if (weightMin > data.weightMin) parts.push(['>=', ['get', 'w'], weightMin]);
            if (!allTypesOn()) {
                var lst = ['literal', enabledList()];
                parts.push(['in', ['get', 'st'], lst]);
                parts.push(['in', ['get', 'tt'], lst]);
            }
            if (!parts.length) return null;
            return parts.length === 1 ? parts[0] : ['all'].concat(parts);
        }
        function highlightEdgeFilter() {
            var incident = ['any', ['==', ['get', 's'], selectedIndex], ['==', ['get', 't'], selectedIndex]];
            var base = edgeFilter();
            return base ? ['all', base, incident] : incident;
        }
        function labelFilter() {
            var base = nodeFilter();
            if (selectedIndex == null) return base;
            var ids = [selectedIndex];
            adjacency[selectedIndex].forEach(function (nb) { ids.push(nb.j); });
            var sel = ['in', ['get', 'i'], ['literal', ids]];
            return base ? ['all', base, sel] : sel;
        }

        function applySelectionPaint() {
            if (!map || !map.getLayer(L_NODES)) return;
            if (selectedIndex == null) {
                map.setPaintProperty(L_EDGES, 'line-opacity', edgeOpacityExpr(0.08, 0.5));
                map.setPaintProperty(L_NODES, 'circle-opacity', hoverOpacityExpr(0.9, 1));
                return;
            }
            var ids = [selectedIndex];
            adjacency[selectedIndex].forEach(function (nb) { ids.push(nb.j); });
            map.setPaintProperty(L_EDGES, 'line-opacity', edgeOpacityExpr(0.02, 0.1));
            map.setPaintProperty(L_NODES, 'circle-opacity',
                ['case', ['in', ['get', 'i'], ['literal', ids]], 1, 0.16]);
        }

        function applyFilters() {
            updateClearState();
            if (!map || !map.getLayer(L_EDGES)) return;
            map.setFilter(L_EDGES, edgeFilter());
            map.setFilter(L_NODES, nodeFilter());
            map.setFilter(L_LABELS, labelFilter());
            map.setFilter(L_EDGES_HL, selectedIndex == null ? ['==', ['get', 's'], -1] : highlightEdgeFilter());
            applySelectionPaint();
        }

        function selectIndex(index) {
            selectedIndex = index;
            applyFilters();
            if (index == null) showOverview(); else showDetail(index);
        }

        /* ------------------------------------------------------------------ */
        /*  Layer (re)build                                                    */
        /* ------------------------------------------------------------------ */

        function addAll(m) {
            if (!m.getSource(SRC_EDGES)) m.addSource(SRC_EDGES, { type: 'geojson', data: edgeFeatures, generateId: true });
            if (!m.getSource(SRC_NODES)) m.addSource(SRC_NODES, { type: 'geojson', data: nodeFeatures, generateId: true });

            if (!m.getLayer(L_EDGES)) m.addLayer({
                id: L_EDGES, type: 'line', source: SRC_EDGES,
                layout: { 'line-cap': 'round' },
                paint: {
                    'line-color': theme().grid,
                    'line-width': ['+', 0.4, ['*', 2.1, ['get', 'wn']]],
                    'line-opacity': edgeOpacityExpr(0.08, 0.5)
                }
            });
            if (!m.getLayer(L_EDGES_HL)) m.addLayer({
                id: L_EDGES_HL, type: 'line', source: SRC_EDGES,
                filter: ['==', ['get', 's'], -1],
                layout: { 'line-cap': 'round' },
                paint: {
                    'line-color': theme().accent,
                    'line-width': ['+', 1, ['*', 2.5, ['get', 'wn']]],
                    'line-opacity': 0.85
                }
            });
            if (!m.getLayer(L_NODES)) m.addLayer({
                id: L_NODES, type: 'circle', source: SRC_NODES,
                paint: {
                    'circle-radius': ['get', 'r'],
                    'circle-color': nodeColorExpr(),
                    'circle-opacity': hoverOpacityExpr(0.9, 1),
                    'circle-stroke-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2.5, 1],
                    'circle-stroke-color': theme().surface
                }
            });
            if (!m.getLayer(L_LABELS)) m.addLayer({
                id: L_LABELS, type: 'symbol', source: SRC_NODES,
                layout: {
                    'text-field': ['get', 'label'],
                    'text-font': LABEL_FONT,
                    'text-size': 12,
                    'text-variable-anchor': ['top', 'bottom', 'right', 'left'],
                    'text-radial-offset': ['+', 0.4, ['/', ['get', 'r'], 14]],
                    'text-justify': 'auto',
                    'symbol-sort-key': ['get', 'rank']
                },
                paint: {
                    'text-color': theme().text,
                    'text-halo-color': theme().surface,
                    'text-halo-width': 1.3
                }
            });

            applyFilters();

            if (!fitted && bounds) {
                fitted = true;
                try {
                    m.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]],
                        { padding: 36, duration: 0 });
                } catch (err) { /* degenerate bounds */ }
            }
        }

        /* ------------------------------------------------------------------ */
        /*  Hover popup                                                        */
        /* ------------------------------------------------------------------ */

        function hoverHtml(node) {
            var bits = [];
            if (types[node.type]) bits.push(types[node.type]);
            bits.push(node.count + ' item' + (node.count === 1 ? '' : 's'));
            bits.push(node.degree + ' link' + (node.degree === 1 ? '' : 's'));
            return '<div class="rv-popup-content"><strong>' + escapeHtml(node.label) + '</strong>'
                + '<span class="deg-popup-meta">' + bits.join(' · ') + '</span></div>';
        }
        function showHover(e) {
            var f = e.features && e.features[0];
            if (!f) return;
            map.getCanvas().style.cursor = 'pointer';
            var newId = f.id;
            if (hoverId !== null && hoverId !== newId) {
                map.setFeatureState({ source: SRC_NODES, id: hoverId }, { hover: false });
            }
            hoverId = newId;
            map.setFeatureState({ source: SRC_NODES, id: hoverId }, { hover: true });
            var node = data.nodes[Number(f.properties.i)];
            if (!node) return;
            if (!hoverPopup) {
                hoverPopup = new window.maplibregl.Popup({
                    closeButton: false, closeOnClick: false, offset: 12, className: 'rv-map-popup'
                });
            }
            hoverPopup.setLngLat([node.lng, node.lat]).setHTML(hoverHtml(node)).addTo(map);
        }
        function hideHover() {
            map.getCanvas().style.cursor = '';
            if (hoverId !== null) {
                map.setFeatureState({ source: SRC_NODES, id: hoverId }, { hover: false });
                hoverId = null;
            }
            if (hoverPopup) hoverPopup.remove();
        }

        /* ------------------------------------------------------------------ */
        /*  Map                                                                */
        /* ------------------------------------------------------------------ */

        function graphStyle() {
            return {
                version: 8,
                glyphs: GLYPHS,
                sources: {},
                layers: [{ id: 'bg', type: 'background', paint: { 'background-color': theme().surface } }]
            };
        }

        function createMap() {
            map = new window.maplibregl.Map({
                container: canvas,
                style: graphStyle(),
                center: [0, 0],
                zoom: 1,
                attributionControl: false,
                renderWorldCopies: false,
                dragRotate: false,
                pitchWithRotate: false,
                maxZoom: 9,
                maxBounds: [[-179, -85], [179, 85]]
            });
            map.addControl(new window.maplibregl.NavigationControl({ showCompass: false }), 'top-right');
            map.on('load', function () { addAll(map); });

            map.on('click', function (e) {
                if (!map.getLayer(L_NODES)) return;
                var feats = map.queryRenderedFeatures(e.point, { layers: [L_NODES] });
                selectIndex(feats.length ? Number(feats[0].properties.i) : null);
            });
            map.on('mousemove', L_NODES, showHover);
            map.on('mouseleave', L_NODES, hideHover);

            if (window.ResizeObserver) {
                new ResizeObserver(function () { try { map.resize(); } catch (err) {} }).observe(canvas);
            }
        }

        /* ------------------------------------------------------------------ */
        /*  Sidebar: overview ⇄ selected entity                               */
        /* ------------------------------------------------------------------ */

        function showOverview() {
            sidebar.innerHTML = '';
            sidebar.appendChild(el('div', 'deg-side-title', 'Network'));
            var counts = {};
            data.nodes.forEach(function (n) { counts[n.type] = (counts[n.type] || 0) + 1; });
            var list = el('div', 'deg-type-counts');
            types.forEach(function (label, i) {
                if (!counts[i]) return;
                var row = el('div', 'deg-type-row');
                var sw = el('span', 'deg-swatch'); sw.style.background = typeColor(i);
                row.appendChild(sw);
                row.appendChild(el('span', 'deg-type-name', label));
                row.appendChild(el('span', 'deg-type-val', String(counts[i])));
                list.appendChild(row);
            });
            sidebar.appendChild(list);
            sidebar.appendChild(el('p', 'deg-side-hint', 'Hover or click an entity to focus its connections.'));
        }

        function showDetail(index) {
            var info = data.nodes[index];
            if (!info) return;
            sidebar.innerHTML = '';

            var typeTag = el('div', 'deg-detail-type', types[info.type] || 'Entity');
            typeTag.style.color = typeColor(info.type);
            sidebar.appendChild(typeTag);

            var titleWrap = el('div', 'deg-detail-title');
            if (siteBase && info.id) {
                var a = el('a', null, info.label);
                a.href = siteBase + '/item/' + info.id;
                titleWrap.appendChild(a);
            } else {
                titleWrap.textContent = info.label;
            }
            sidebar.appendChild(titleWrap);

            sidebar.appendChild(el('div', 'deg-detail-stats',
                info.count + ' item' + (info.count === 1 ? '' : 's') + ' · '
                + info.degree + ' connection' + (info.degree === 1 ? '' : 's')));

            if (sections.length) {
                var secLabel = info.section >= 0 ? sections[info.section]
                    : (info.section === -2 ? 'Multiple sections' : null);
                if (secLabel) {
                    var secRow = el('div', 'deg-detail-stats');
                    secRow.appendChild(el('span', 'deg-detail-section-label', 'Section: '));
                    secRow.appendChild(el('span', null, secLabel));
                    sidebar.appendChild(secRow);
                }
            }

            var nbrs = adjacency[index] || [];
            if (nbrs.length) {
                sidebar.appendChild(el('div', 'deg-detail-subhead',
                    'Top connections (' + Math.min(nbrs.length, 15) + ' of ' + nbrs.length + ')'));
                var ul = el('div', 'deg-neighbors');
                nbrs.slice(0, 15).forEach(function (nb) {
                    var ni = data.nodes[nb.j];
                    if (!ni) return;
                    var btn = el('button', 'deg-neighbor'); btn.type = 'button';
                    var sw = el('span', 'deg-swatch'); sw.style.background = typeColor(ni.type);
                    btn.appendChild(sw);
                    btn.appendChild(el('span', 'deg-neighbor-name', ni.label));
                    btn.appendChild(el('span', 'deg-neighbor-w', String(nb.w)));
                    btn.addEventListener('click', function () { focusNode(nb.j); });
                    ul.appendChild(btn);
                });
                sidebar.appendChild(ul);
            }

            if (siteBase && info.id) {
                var open = el('a', 'deg-open', 'Open page →');
                open.href = siteBase + '/item/' + info.id;
                sidebar.appendChild(open);
            }
        }

        /** Centre the camera on a node and select it (used by search + neighbours). */
        function focusNode(index) {
            var node = data.nodes[index];
            if (!node) return;
            hideHover();
            try {
                map.easeTo({ center: [node.lng, node.lat], zoom: Math.max(map.getZoom(), 4), duration: 500 });
            } catch (err) { /* ignore */ }
            selectIndex(index);
        }

        /* ------------------------------------------------------------------ */
        /*  Toolbar controls                                                   */
        /* ------------------------------------------------------------------ */

        // Search ----------------------------------------------------------
        var searchWrap = el('div', 'deg-search');
        var search = el('input', 'deg-search-input');
        search.type = 'search';
        search.placeholder = 'Search entities…';
        search.setAttribute('aria-label', 'Search entities');
        var results = el('div', 'deg-search-results'); results.hidden = true;
        searchWrap.appendChild(search); searchWrap.appendChild(results);
        toolbar.appendChild(searchWrap);

        search.addEventListener('input', function () {
            var q = fold(search.value.trim());
            results.innerHTML = '';
            if (q.length < 2) { results.hidden = true; return; }
            var hits = [];
            for (var i = 0; i < data.nodes.length && hits.length < 8; i++) {
                if (fold(data.nodes[i].label).indexOf(q) !== -1) hits.push(i);
            }
            if (!hits.length) { results.hidden = true; return; }
            hits.forEach(function (idx) {
                var n = data.nodes[idx];
                var item = el('button', 'deg-search-hit'); item.type = 'button';
                var sw = el('span', 'deg-swatch'); sw.style.background = typeColor(n.type);
                item.appendChild(sw);
                item.appendChild(el('span', 'deg-search-hit-name', n.label));
                item.addEventListener('click', function () {
                    search.value = n.label; results.hidden = true; focusNode(idx);
                });
                results.appendChild(item);
            });
            results.hidden = false;
        });
        search.addEventListener('blur', function () { setTimeout(function () { results.hidden = true; }, 150); });

        // Type filter chips ----------------------------------------------
        var chips = el('div', 'deg-chips');
        types.forEach(function (label, i) {
            if (!data.nodes.some(function (n) { return n.type === i; })) return;
            var chip = el('button', 'deg-chip deg-chip-on'); chip.type = 'button';
            chip.setAttribute('aria-pressed', 'true');
            var sw = el('span', 'deg-swatch'); sw.style.background = typeColor(i);
            chip.appendChild(sw);
            chip.appendChild(el('span', null, label));
            chip.addEventListener('click', function () {
                enabledTypes[i] = !enabledTypes[i];
                chip.classList.toggle('deg-chip-on', enabledTypes[i]);
                chip.setAttribute('aria-pressed', String(enabledTypes[i]));
                if (selectedIndex != null && !enabledTypes[data.nodes[selectedIndex].type]) {
                    selectIndex(null);
                } else {
                    applyFilters();
                }
            });
            chip._sw = sw; chip._i = i;
            chips.appendChild(chip);
        });
        toolbar.appendChild(chips);

        // Min-weight select ----------------------------------------------
        var weightSelect = null;
        var steps = [data.weightMin, 3, 5, 10, 20].filter(function (v, idx) {
            return idx === 0 || (v > data.weightMin && v <= data.weightMax);
        });
        if (steps.length > 1) {
            var wWrap = el('label', 'deg-weight');
            wWrap.appendChild(el('span', null, 'Min. link'));
            var sel = el('select', 'deg-weight-select');
            steps.forEach(function (v, idx) {
                var o = el('option', null, idx === 0 ? 'All' : ('≥ ' + v));
                o.value = String(v); sel.appendChild(o);
            });
            sel.addEventListener('change', function () {
                weightMin = Number(sel.value) || data.weightMin;
                applyFilters();
            });
            wWrap.appendChild(sel);
            toolbar.appendChild(wWrap);
            weightSelect = sel;
        }

        // Clear filters --------------------------------------------------
        // One click back to the default view: all types on, min-link at "All",
        // search emptied and any selection dropped. Disabled while nothing is active.
        var clearBtn = el('button', 'deg-btn deg-clear'); clearBtn.type = 'button';
        clearBtn.textContent = 'Clear filters';
        clearBtn.title = 'Reset the type, link-weight and selection filters';
        clearBtn.disabled = true;
        clearBtn.addEventListener('click', function () {
            types.forEach(function (_t, i) { enabledTypes[i] = true; });
            Array.prototype.forEach.call(chips.querySelectorAll('.deg-chip'), function (chip) {
                chip.classList.add('deg-chip-on');
                chip.setAttribute('aria-pressed', 'true');
            });
            weightMin = data.weightMin;
            if (weightSelect) weightSelect.value = String(data.weightMin);
            search.value = '';
            results.hidden = true;
            selectIndex(null); // resets selection + calls applyFilters() → updateClearState()
        });
        toolbar.appendChild(clearBtn);

        toolbar.appendChild(el('div', 'deg-spacer'));

        // Colour-by control (type / cluster / section) -------------------
        var colorModes = [{ id: 'type', label: 'Type' }];
        if (data.communityCount > 0) colorModes.push({ id: 'community', label: 'Cluster' });
        if (sections.length) colorModes.push({ id: 'section', label: 'Section' });
        if (colorModes.length > 1) {
            var modeWrap = el('div', 'deg-colormode');
            modeWrap.setAttribute('role', 'group');
            modeWrap.setAttribute('aria-label', 'Colour nodes by');
            modeWrap.appendChild(el('span', 'deg-colormode-label', 'Colour'));
            var modeBtns = {};
            var setMode = function (id) {
                if (colorMode === id) return;
                colorMode = id;
                Object.keys(modeBtns).forEach(function (k) {
                    var on = k === id;
                    modeBtns[k].classList.toggle('is-on', on);
                    modeBtns[k].setAttribute('aria-pressed', String(on));
                });
                if (map && map.getLayer(L_NODES)) map.setPaintProperty(L_NODES, 'circle-color', nodeColorExpr());
                rebuildLegend();
                if (selectedIndex != null) showDetail(selectedIndex);
            };
            colorModes.forEach(function (m) {
                var b = el('button', 'deg-btn deg-mode-btn'); b.type = 'button';
                b.textContent = m.label;
                b.title = 'Colour nodes by ' + m.label.toLowerCase();
                b.classList.toggle('is-on', colorMode === m.id);
                b.setAttribute('aria-pressed', String(colorMode === m.id));
                b.addEventListener('click', function () { setMode(m.id); });
                modeBtns[m.id] = b;
                modeWrap.appendChild(b);
            });
            toolbar.appendChild(modeWrap);
        }

        // Reset view ------------------------------------------------------
        var resetBtn = el('button', 'rv-btn'); resetBtn.type = 'button';
        resetBtn.title = 'Reset view'; resetBtn.setAttribute('aria-label', 'Reset view');
        resetBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9"/><polyline points="3 4 3 9 8 9"/></svg>';
        resetBtn.addEventListener('click', function () {
            selectIndex(null);
            if (map && bounds) {
                try {
                    map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 36, duration: 500 });
                } catch (err) {}
            }
        });
        toolbar.appendChild(resetBtn);

        /* ------------------------------------------------------------------ */
        /*  Legend                                                             */
        /* ------------------------------------------------------------------ */

        function rebuildLegend() {
            legend.innerHTML = '';
            if (colorMode === 'community') {
                legend.appendChild(el('span', 'deg-legend-note',
                    'Node colour = co-occurrence cluster · grey = unclustered'));
                return;
            }
            if (colorMode === 'section') {
                sections.forEach(function (label, i) {
                    if (!data.nodes.some(function (n) { return n.section === i; })) return;
                    var row = el('span', 'deg-legend-item');
                    var sw = el('span', 'deg-swatch'); sw.style.background = sectionColor(i);
                    row.appendChild(sw);
                    row.appendChild(el('span', null, label));
                    legend.appendChild(row);
                });
                var hasBridge = data.nodes.some(function (n) { return n.section === -2; });
                var hasNone = data.nodes.some(function (n) { return n.section === -1; });
                if (hasBridge || hasNone) {
                    var grow = el('span', 'deg-legend-item');
                    var gsw = el('span', 'deg-swatch'); gsw.style.background = dimColor();
                    grow.appendChild(gsw);
                    grow.appendChild(el('span', null,
                        hasBridge && hasNone ? 'Multiple / no section'
                            : (hasBridge ? 'Multiple sections' : 'No section')));
                    legend.appendChild(grow);
                }
                return;
            }
            types.forEach(function (label, i) {
                if (!data.nodes.some(function (n) { return n.type === i; })) return;
                var row = el('span', 'deg-legend-item');
                var sw = el('span', 'deg-swatch'); sw.style.background = typeColor(i);
                row.appendChild(sw);
                row.appendChild(el('span', null, label));
                legend.appendChild(row);
            });
        }

        /* ------------------------------------------------------------------ */
        /*  Theme: recolour layers + chrome in place (no re-layout)           */
        /* ------------------------------------------------------------------ */

        function applyTheme() {
            if (typeof ns.readTheme === 'function') ns.readTheme();
            if (map && map.getLayer(L_NODES)) {
                map.setPaintProperty('bg', 'background-color', theme().surface);
                map.setPaintProperty(L_NODES, 'circle-color', nodeColorExpr());
                map.setPaintProperty(L_NODES, 'circle-stroke-color', theme().surface);
                map.setPaintProperty(L_EDGES, 'line-color', theme().grid);
                map.setPaintProperty(L_EDGES_HL, 'line-color', theme().accent);
                map.setPaintProperty(L_LABELS, 'text-color', theme().text);
                map.setPaintProperty(L_LABELS, 'text-halo-color', theme().surface);
            }
            Array.prototype.forEach.call(chips.querySelectorAll('.deg-chip'), function (chip) {
                if (chip._sw) chip._sw.style.background = typeColor(chip._i);
            });
            rebuildLegend();
            if (selectedIndex != null) showDetail(selectedIndex); else showOverview();
        }

        if (window.MutationObserver && document.body) {
            var tTimer;
            new MutationObserver(function () {
                clearTimeout(tTimer);
                tTimer = setTimeout(applyTheme, 80);
            }).observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });
        }

        /* -- go -- */
        rebuildLegend();
        showOverview();
        createMap();
    }

    /* ------------------------------------------------------------------ */
    /*  Fetch + mount                                                      */
    /* ------------------------------------------------------------------ */

    function initContainer(container) {
        var basePath = container.dataset.basePath || '';
        var siteBase = container.dataset.siteBase || '';
        ns.basePath = basePath;
        var url = basePath + '/modules/DreVisualizations/asset/data/communities/entity-graph.json';

        // Load MapLibre on demand through the shared loader (dashboard-core.js) —
        // the same path the dashboards use — so a page with both a dashboard and
        // this graph loads MapLibre exactly once. Fetch the data in parallel.
        var libs = (typeof ns.ensureLibs === 'function') ? ns.ensureLibs({ maplibre: true }) : Promise.resolve();
        Promise.all([
            fetch(url, { cache: 'no-cache' }).then(function (r) {
                if (!r.ok) throw new Error('not found');
                return r.json();
            }),
            libs
        ]).then(function (res) {
            var data = decode(res[0]);
            if (!data.nodes.length) {
                container.innerHTML = '<div class="rv-no-data">No entity-network data available yet.</div>';
                return;
            }
            if (typeof window.maplibregl === 'undefined') {
                container.innerHTML = '<div class="rv-error">Map library failed to load.</div>';
                return;
            }
            build(container, data, { basePath: basePath, siteBase: siteBase });
        }).catch(function (err) {
            console.error('DreVisualizations entity-graph:', err);
            container.innerHTML = '<div class="rv-error">Could not load the entity network.</div>';
        });
    }

    /** Defer the (heavier) fetch + render until the block nears the viewport. */
    function mountWhenVisible(container) {
        var run = function () { initContainer(container); };
        if (!('IntersectionObserver' in window)) { run(); return; }
        var io = new IntersectionObserver(function (entries) {
            for (var i = 0; i < entries.length; i++) {
                if (entries[i].isIntersecting) { io.disconnect(); run(); break; }
            }
        }, { rootMargin: '600px 0px' });
        io.observe(container);
    }

    function init() {
        var cs = document.querySelectorAll('.dre-entity-graph');
        for (var i = 0; i < cs.length; i++) mountWhenVisible(cs[i]);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
