/**
 * Spatial Exploration — the collection-wide places map for the cross-cutting
 * site-page block. Renders the precomputed spatial-exploration.json with MapLibre
 * GL (the same WebGL renderer every DRE map already ships). Every geocoded location
 * the research items reference is drawn as a bubble; origins (dcterms:spatial) and
 * current locations (dcterms:provenance) are kept as two distinct, separately
 * coloured layers — the same colour language as the per-entity dashboard map
 * (origin = brand accent, current = cluster Hellblau) — and the legend doubles as a
 * show/hide toggle. A sidebar entity picker filters the bubbles to one project /
 * research section / person / organisation / subject, a country dropdown zooms in,
 * and clicking a bubble opens that location's page.
 *
 * Self-contained controller (it does NOT use the ECharts window.RV.charts registry
 * — MapLibre is a separate renderer): it fetches the data, builds the UI and owns
 * all interaction, reusing dashboard-core.js only for the shared theme tokens
 * (ns.THEME / ns.COLORS / ns.cssColor, the Positron/Dark-Matter basemap and
 * ns.trackMap), which it re-reads on every light/dark toggle to recolour in place.
 *
 * Depends on (loaded first, deferred):
 *   - asset/js/dashboard-core.js → window.RV (theme tokens, getBasemapStyle,
 *     trackMap, and ns.ensureLibs — the shared lazy loader that pulls in MapLibre
 *     GL on mount, so a page with this block plus a dashboard / entity graph loads
 *     MapLibre exactly once)
 *
 * Data (compact row arrays, see Aggregators::buildSpatialPlaces + Runner):
 *   { types: ['Project','Section','Person','Organisation','Subject'],
 *     locations: [[id, name, lat, lng, originCount, currentCount, countryIdx], ...],
 *     countries: [[name, count, [w,s,e,n]], ...],
 *     pickers:   { Project: [[id, label, placeCount], ...], ... },
 *     entityPlaces: { "<entityId>": [[locId, originCount, currentCount], ...], ... } }
 */
(function () {
    'use strict';

    var ns = window.RV || (window.RV = {});

    var SRC = 'rv-spatial-places';
    var L_ORIGIN = 'rv-spatial-origin';
    var L_CURRENT = 'rv-spatial-current';
    var L_LABELS = 'rv-spatial-labels';
    var LABEL_FONT = ['Noto Sans Regular']; // served by the CartoCDN basemap glyphs
    var LIST_CAP = 60;
    var TOP_PLACES = 10;

    /* ------------------------------------------------------------------ */
    /*  Tiny DOM + text helpers                                            */
    /* ------------------------------------------------------------------ */

    function el(tag, cls, text) {
        var node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text != null) node.textContent = text;
        return node;
    }

    /** Lower-case + strip diacritics, so "Côte" matches a "cote" query. */
    function fold(s) {
        s = (s == null ? '' : String(s)).toLowerCase();
        return s.normalize ? s.normalize('NFD').replace(/[̀-ͯ]/g, '') : s;
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }

    function fmtNum(n) {
        return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    }

    /* ------------------------------------------------------------------ */
    /*  Theme bridge (dashboard-core.js)                                   */
    /* ------------------------------------------------------------------ */

    var THEME_FALLBACK = { text: '#473e33', border: '#dcd6cb', accent: '#007a50' };
    function theme() { return ns.THEME || THEME_FALLBACK; }
    function originColor() {
        return ns.cssColor ? ns.cssColor('--primary', THEME_FALLBACK.accent) : (theme().accent || THEME_FALLBACK.accent);
    }
    /** Current-location colour — the cluster Hellblau (COLORS[2]), as the dashboard map uses. */
    function currentColor() {
        return (ns.COLORS && ns.COLORS[2]) ? ns.COLORS[2] : '#44b8f2';
    }

    /* ------------------------------------------------------------------ */
    /*  Decode the compact payload                                         */
    /* ------------------------------------------------------------------ */

    function decode(payload) {
        return {
            types: payload.types || [],
            locations: (payload.locations || []).map(function (r) {
                return { id: r[0], name: r[1], lat: r[2], lng: r[3], oc: r[4], cc: r[5], ci: r[6] };
            }),
            countries: payload.countries || [],     // [name, count, [w,s,e,n]]
            pickers: payload.pickers || {},
            entityPlaces: payload.entityPlaces || {}
        };
    }

    /* ------------------------------------------------------------------ */
    /*  Main build                                                         */
    /* ------------------------------------------------------------------ */

    function build(container, data, ctx) {
        var siteBase = ctx.siteBase;

        var placeById = {};
        data.locations.forEach(function (p) { placeById[p.id] = p; });

        function countryName(ci) {
            return (ci != null && ci >= 0 && data.countries[ci]) ? data.countries[ci][0] : '';
        }

        container.innerHTML = '';

        /* -- header + description -- */
        var header = el('div', 'dashboard-header');
        header.appendChild(el('h3', null, 'Spatial Exploration'));
        header.appendChild(el('span', 'dashboard-total',
            fmtNum(data.locations.length) + ' places · ' + data.countries.length + ' countries'));
        container.appendChild(header);
        container.appendChild(el('p', 'chart-description',
            'Every place the research items reference, as bubbles sized by how many items mention them — '
            + 'split into places of origin and current locations. Toggle a layer in the legend, pick an '
            + 'entity on the left to see only its places, choose a country to zoom in, or click a bubble to '
            + 'open that location’s page.'));

        /* -- stage: sidebar + map -- */
        var stage = el('div', 'rv-spatial-stage');
        var sidebar = el('div', 'rv-spatial-sidebar');
        var main = el('div', 'rv-spatial-main');
        stage.appendChild(sidebar);
        stage.appendChild(main);
        container.appendChild(stage);

        /* -- toolbar: legend toggle + country focus + status -- */
        var toolbar = el('div', 'rv-spatial-toolbar');

        var showOrigin = true, showCurrent = true;
        var legend = el('div', 'rv-spatial-legend');
        var originSwatch = el('span', 'rv-spatial-swatch');
        var currentSwatch = el('span', 'rv-spatial-swatch');
        var originChip = el('button', 'rv-spatial-legend-chip', null);
        originChip.type = 'button';
        originChip.setAttribute('aria-pressed', 'true');
        originChip.appendChild(originSwatch);
        originChip.appendChild(el('span', null, 'Place of origin'));
        var currentChip = el('button', 'rv-spatial-legend-chip', null);
        currentChip.type = 'button';
        currentChip.setAttribute('aria-pressed', 'true');
        currentChip.appendChild(currentSwatch);
        currentChip.appendChild(el('span', null, 'Current location'));
        legend.appendChild(originChip);
        legend.appendChild(currentChip);
        toolbar.appendChild(legend);

        var focusLabel = el('label', 'rv-spatial-focus');
        focusLabel.appendChild(el('span', 'rv-spatial-focus-cap', 'Country'));
        var focusSelect = el('select', 'rv-spatial-focus-select');
        var allOpt = el('option', null, 'Whole collection'); allOpt.value = '';
        focusSelect.appendChild(allOpt);
        data.countries.forEach(function (c, i) {
            var o = el('option', null, c[0] + ' (' + fmtNum(c[1]) + ')'); o.value = String(i);
            focusSelect.appendChild(o);
        });
        focusLabel.appendChild(focusSelect);
        toolbar.appendChild(focusLabel);

        var status = el('span', 'rv-spatial-status');
        toolbar.appendChild(status);
        main.appendChild(toolbar);

        function updateLegendSwatches() {
            originSwatch.style.background = originColor();
            currentSwatch.style.background = currentColor();
        }
        updateLegendSwatches();

        /* -- map canvas -- */
        var canvas = el('div', 'rv-spatial-canvas');
        canvas.setAttribute('role', 'application');
        canvas.setAttribute('aria-label', 'Map of places referenced by the collection');
        main.appendChild(canvas);

        /* -- sidebar skeleton -- */
        function group(labelText, controlEl) {
            var wrap = el('div', 'rv-spatial-group');
            wrap.appendChild(el('div', 'rv-spatial-label', labelText));
            wrap.appendChild(controlEl);
            return wrap;
        }
        var tabs = el('div', 'rv-spatial-tabs');
        sidebar.appendChild(group('Filter by', tabs));

        var searchInput = el('input', 'rv-spatial-search');
        searchInput.type = 'search';
        searchInput.placeholder = 'Search…';
        searchInput.setAttribute('aria-label', 'Search entities');
        var listEl = el('div', 'rv-spatial-list');
        listEl.setAttribute('role', 'listbox');
        var pickGroup = group('Pick an entity', searchInput);
        pickGroup.appendChild(listEl);
        sidebar.appendChild(pickGroup);

        var selBox = el('div', 'rv-spatial-selection');
        sidebar.appendChild(selBox);
        var topBox = el('div', 'rv-spatial-top');
        sidebar.appendChild(topBox);

        /* -- interaction state -- */
        var entityType = data.types[0] || 'Project';
        var selection = null;   // null | { id, label, type, adj: [[locId, oc, cc], ...] }
        var focusIdx = null;    // null | country index
        var map = null;
        var hoverPopup = null;
        var pinnedPopup = null;
        var hoverId = null;

        /* ------------------------------------------------------------------ */
        /*  Current view (selection-aware, focus-filtered)                     */
        /* ------------------------------------------------------------------ */

        function viewPlaces() {
            var list;
            if (selection) {
                list = selection.adj.map(function (t) {     // t = [locId, oc, cc]
                    var p = placeById[t[0]];
                    return p ? { id: p.id, name: p.name, lat: p.lat, lng: p.lng, oc: t[1], cc: t[2], ci: p.ci } : null;
                }).filter(Boolean);
            } else {
                list = data.locations;
            }
            if (focusIdx != null) {
                list = list.filter(function (p) { return p.ci === focusIdx; });
            }
            return list;
        }

        function featureCollection(places) {
            return {
                type: 'FeatureCollection',
                features: places.map(function (p) {
                    return {
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
                        properties: { id: p.id, name: p.name, oc: p.oc, cc: p.cc, total: p.oc + p.cc }
                    };
                })
            };
        }

        function maxOf(places, key) {
            var m = 1;
            places.forEach(function (p) { if (p[key] > m) m = p[key]; });
            return m;
        }

        function radiusExpr(key, max) {
            return ['interpolate', ['linear'], ['get', key], 1, 4, Math.max(max, 2), 26];
        }

        /* ------------------------------------------------------------------ */
        /*  Popups                                                             */
        /* ------------------------------------------------------------------ */

        function rolesLine(oc, cc) {
            var parts = [];
            if (oc > 0) parts.push(fmtNum(oc) + ' as origin');
            if (cc > 0) parts.push(fmtNum(cc) + ' as current');
            return parts.join(' · ');
        }

        function hoverHtml(p, oc, cc) {
            var bits = [];
            var cn = countryName(p.ci);
            if (cn) bits.push(escapeHtml(cn));
            var roles = rolesLine(oc, cc);
            if (roles) bits.push(roles);
            return '<div class="rv-popup-content"><strong>' + escapeHtml(p.name) + '</strong>'
                + '<span class="deg-popup-meta">' + bits.join(' · ') + '</span></div>';
        }

        function pinnedHtml(p, oc, cc) {
            var cn = countryName(p.ci);
            var meta = [];
            if (cn) meta.push(escapeHtml(cn));
            var roles = rolesLine(oc, cc);
            if (roles) meta.push(roles);
            var h = '<div class="rv-popup-content"><strong>' + escapeHtml(p.name) + '</strong>'
                + '<span class="rv-popup-count">' + meta.join(' · ') + '</span>';
            if (siteBase) {
                h += '<a class="rv-popup-location-link" href="' + siteBase + '/item/' + p.id + '">View location page →</a>';
            }
            return h + '</div>';
        }

        function onHover(e) {
            if (!map) return;
            var f = e.features && e.features[0];
            if (!f) return;
            map.getCanvas().style.cursor = 'pointer';
            if (hoverId !== null && hoverId !== f.id) {
                map.setFeatureState({ source: SRC, id: hoverId }, { hover: false });
            }
            hoverId = f.id;
            map.setFeatureState({ source: SRC, id: hoverId }, { hover: true });
            var p = placeById[f.properties.id];
            if (!p) return;
            if (!hoverPopup) {
                hoverPopup = new window.maplibregl.Popup({
                    closeButton: false, closeOnClick: false, offset: 12, className: 'rv-map-popup'
                });
            }
            hoverPopup.setLngLat(f.geometry.coordinates.slice())
                .setHTML(hoverHtml(p, f.properties.oc, f.properties.cc))
                .addTo(map);
        }

        function hideHover() {
            if (!map) return;
            map.getCanvas().style.cursor = '';
            if (hoverId !== null) {
                map.setFeatureState({ source: SRC, id: hoverId }, { hover: false });
                hoverId = null;
            }
            if (hoverPopup) hoverPopup.remove();
        }

        function openPinned(p, lngLat, oc, cc) {
            hideHover();
            if (pinnedPopup) pinnedPopup.remove();
            pinnedPopup = new window.maplibregl.Popup({ offset: 12, maxWidth: '300px', className: 'rv-map-popup' })
                .setLngLat(lngLat)
                .setHTML(pinnedHtml(p, oc, cc))
                .addTo(map);
        }

        function onClickBubble(e) {
            var f = e.features && e.features[0];
            if (!f) return;
            var p = placeById[f.properties.id];
            if (p) openPinned(p, f.geometry.coordinates.slice(), f.properties.oc, f.properties.cc);
        }

        /* ------------------------------------------------------------------ */
        /*  Map                                                                */
        /* ------------------------------------------------------------------ */

        function applyMode() {
            if (map && map.getLayer(L_ORIGIN)) {
                map.setLayoutProperty(L_ORIGIN, 'visibility', showOrigin ? 'visible' : 'none');
            }
            if (map && map.getLayer(L_CURRENT)) {
                map.setLayoutProperty(L_CURRENT, 'visibility', showCurrent ? 'visible' : 'none');
            }
        }

        function hoverPaint(base, hovered) {
            return ['case', ['boolean', ['feature-state', 'hover'], false], hovered, base];
        }

        function addLayers() {
            var places = viewPlaces();
            if (!map.getSource(SRC)) {
                map.addSource(SRC, { type: 'geojson', data: featureCollection(places), generateId: true });
            }
            // Current drawn first (under origin), so the brand-accent origins sit on top.
            if (!map.getLayer(L_CURRENT)) {
                map.addLayer({
                    id: L_CURRENT, type: 'circle', source: SRC,
                    filter: ['>', ['get', 'cc'], 0],
                    paint: {
                        'circle-radius': radiusExpr('cc', maxOf(places, 'cc')),
                        'circle-color': currentColor(),
                        'circle-opacity': hoverPaint(0.6, 0.9),
                        'circle-stroke-width': hoverPaint(1, 2),
                        'circle-stroke-color': theme().border
                    }
                });
            }
            if (!map.getLayer(L_ORIGIN)) {
                map.addLayer({
                    id: L_ORIGIN, type: 'circle', source: SRC,
                    filter: ['>', ['get', 'oc'], 0],
                    paint: {
                        'circle-radius': radiusExpr('oc', maxOf(places, 'oc')),
                        'circle-color': originColor(),
                        'circle-opacity': hoverPaint(0.72, 0.95),
                        'circle-stroke-width': hoverPaint(1.2, 2.5),
                        'circle-stroke-color': theme().border
                    }
                });
            }
            if (!map.getLayer(L_LABELS)) {
                map.addLayer({
                    id: L_LABELS, type: 'symbol', source: SRC,
                    layout: {
                        'text-field': ['get', 'name'],
                        'text-font': LABEL_FONT,
                        'text-size': 11,
                        'text-offset': [0, 1.1],
                        'text-anchor': 'top',
                        // Densest bubbles win label-collision (lower sort key = higher priority).
                        'symbol-sort-key': ['*', -1, ['get', 'total']]
                    },
                    paint: {
                        'text-color': theme().text,
                        'text-halo-color': theme().border,
                        'text-halo-width': 1.3
                    }
                });
            }
            applyMode();
        }

        function create() {
            // Stale popups belong to the previous (removed) map on a theme rebuild.
            hoverPopup = null; pinnedPopup = null; hoverId = null;
            map = new window.maplibregl.Map({
                container: canvas,
                style: ns.getBasemapStyle(),
                center: [10, 5],
                zoom: 1.4,
                attributionControl: false,
                cooperativeGestures: true,
                dragRotate: false,
                pitchWithRotate: false
            });
            map.addControl(new window.maplibregl.NavigationControl({ showCompass: false }), 'top-right');
            if (window.maplibregl.GlobeControl) {
                map.addControl(new window.maplibregl.GlobeControl(), 'top-right');
            }
            map.on('load', function () { addLayers(); updateLegendSwatches(); applyView(true); });
            [L_ORIGIN, L_CURRENT].forEach(function (layer) {
                map.on('click', layer, onClickBubble);
                map.on('mousemove', layer, onHover);
                map.on('mouseleave', layer, hideHover);
            });
            if (window.ResizeObserver) {
                new ResizeObserver(function () { try { map.resize(); } catch (err) {} }).observe(canvas);
            }
            // Register for the theme engine's light/dark rebuild (dashboard-core
            // ns.refresh removes the map and calls create() again).
            ns.trackMap(map, create);
        }

        function fitTo(places) {
            if (!map || !places.length) return;
            if (focusIdx != null && data.countries[focusIdx]) {
                var b = data.countries[focusIdx][2];
                try { map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 48, maxZoom: 8, duration: 600 }); return; }
                catch (err) { /* degenerate bounds */ }
            }
            var w = 180, s = 90, e = -180, n = -90;
            places.forEach(function (p) {
                if (p.lng < w) w = p.lng; if (p.lng > e) e = p.lng;
                if (p.lat < s) s = p.lat; if (p.lat > n) n = p.lat;
            });
            try { map.fitBounds([[w, s], [e, n]], { padding: 48, maxZoom: 8, duration: 600 }); }
            catch (err) { /* degenerate bounds */ }
        }

        function applyView(fit) {
            var places = viewPlaces();
            var src = map && map.getSource(SRC);
            if (src) src.setData(featureCollection(places));
            if (map && map.getLayer(L_ORIGIN)) {
                map.setPaintProperty(L_ORIGIN, 'circle-radius', radiusExpr('oc', maxOf(places, 'oc')));
            }
            if (map && map.getLayer(L_CURRENT)) {
                map.setPaintProperty(L_CURRENT, 'circle-radius', radiusExpr('cc', maxOf(places, 'cc')));
            }
            updateStatus(places);
            renderTopPlaces(places);
            if (fit) fitTo(places);
        }

        function updateStatus(places) {
            var bits = [];
            if (selection) bits.push(selection.label);
            bits.push(fmtNum(places.length) + ' place' + (places.length === 1 ? '' : 's'));
            if (focusIdx != null && data.countries[focusIdx]) bits.push('in ' + data.countries[focusIdx][0]);
            status.textContent = bits.join(' · ');
        }

        /* -- legend toggles -- */
        originChip.addEventListener('click', function () {
            showOrigin = !showOrigin;
            originChip.classList.toggle('is-off', !showOrigin);
            originChip.setAttribute('aria-pressed', String(showOrigin));
            applyMode();
        });
        currentChip.addEventListener('click', function () {
            showCurrent = !showCurrent;
            currentChip.classList.toggle('is-off', !showCurrent);
            currentChip.setAttribute('aria-pressed', String(showCurrent));
            applyMode();
        });

        /* ------------------------------------------------------------------ */
        /*  Sidebar: picker + selection + top places                          */
        /* ------------------------------------------------------------------ */

        function highlightTabs() {
            Array.prototype.forEach.call(tabs.children, function (btn) {
                var on = btn._type === entityType;
                btn.classList.toggle('is-active', on);
                btn.setAttribute('aria-pressed', String(on));
            });
        }

        function renderTabs() {
            tabs.innerHTML = '';
            data.types.forEach(function (t) {
                if (!(data.pickers[t] && data.pickers[t].length)) return; // hide empty types
                var btn = el('button', 'rv-spatial-tab', t);
                btn.type = 'button';
                btn._type = t;
                btn.addEventListener('click', function () {
                    if (entityType === t) return;
                    entityType = t;
                    searchInput.value = '';
                    highlightTabs();
                    renderList();
                });
                tabs.appendChild(btn);
            });
            highlightTabs();
        }

        function pickerRow(row) {
            var id = row[0], label = row[1], placeCount = row[2];
            var btn = el('button', 'rv-spatial-item');
            btn.type = 'button';
            btn.setAttribute('role', 'option');
            var active = selection && selection.id === id;
            if (active) btn.classList.add('is-active');
            btn.setAttribute('aria-selected', String(active));
            btn.appendChild(el('span', 'rv-spatial-item-name', label));
            btn.appendChild(el('span', 'rv-spatial-item-count', fmtNum(placeCount)));
            btn.addEventListener('click', function () {
                if (selection && selection.id === id) clearEntity(); else selectEntity(id, label);
            });
            return btn;
        }

        function renderList() {
            listEl.innerHTML = '';
            var rows = data.pickers[entityType] || [];
            var q = fold(searchInput.value.trim());
            var shown = 0;
            for (var i = 0; i < rows.length && shown < LIST_CAP; i++) {
                if (q && fold(rows[i][1]).indexOf(q) === -1) continue;
                shown++;
                listEl.appendChild(pickerRow(rows[i]));
            }
            if (shown === 0) {
                listEl.appendChild(el('div', 'rv-spatial-muted', q ? 'No matches' : 'No mapped entities'));
            }
        }

        function renderSelection() {
            selBox.innerHTML = '';
            if (!selection) {
                selBox.appendChild(el('p', 'rv-spatial-hint',
                    'Pick an entity to filter the map to its places, or browse the whole collection.'));
                return;
            }
            var chip = el('button', 'rv-spatial-chip', selection.label + ' ×');
            chip.type = 'button';
            chip.setAttribute('aria-label', 'Clear selection: ' + selection.label);
            chip.addEventListener('click', clearEntity);
            selBox.appendChild(chip);
            var n = selection.adj.length;
            selBox.appendChild(el('p', 'rv-spatial-summary',
                fmtNum(n) + ' mapped place' + (n === 1 ? '' : 's')));
            if (siteBase) {
                var a = el('a', 'rv-spatial-link', 'View ' + selection.type.toLowerCase() + ' page →');
                a.href = siteBase + '/item/' + selection.id;
                selBox.appendChild(a);
            }
        }

        function renderTopPlaces(places) {
            topBox.innerHTML = '';
            if (!places.length) return;
            topBox.appendChild(el('div', 'rv-spatial-label', 'Top places'));
            var ul = el('ul', 'rv-spatial-top-list');
            places.slice().sort(function (a, b) { return (b.oc + b.cc) - (a.oc + a.cc); })
                .slice(0, TOP_PLACES).forEach(function (p) {
                    var li = el('li');
                    var btn = el('button', 'rv-spatial-item');
                    btn.type = 'button';
                    btn.appendChild(el('span', 'rv-spatial-item-name', p.name));
                    btn.appendChild(el('span', 'rv-spatial-item-count', fmtNum(p.oc + p.cc)));
                    btn.addEventListener('click', function () { flyTo(p); });
                    li.appendChild(btn);
                    ul.appendChild(li);
                });
            topBox.appendChild(ul);
        }

        function selectEntity(id, label) {
            var adj = data.entityPlaces[id] || data.entityPlaces[String(id)] || [];
            selection = { id: id, label: label, type: entityType, adj: adj };
            renderList();
            renderSelection();
            applyView(true);
        }

        function clearEntity() {
            if (!selection) return;
            selection = null;
            renderList();
            renderSelection();
            applyView(true);
        }

        function flyTo(p) {
            if (!map) return;
            hideHover();
            try { map.easeTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 6), duration: 700 }); }
            catch (err) { /* ignore */ }
            setTimeout(function () { openPinned(p, [p.lng, p.lat], p.oc, p.cc); }, 720);
        }

        /* -- events -- */
        var searchTimer = null;
        searchInput.addEventListener('input', function () {
            if (searchTimer) clearTimeout(searchTimer);
            searchTimer = setTimeout(renderList, 120);
        });
        focusSelect.addEventListener('change', function () {
            focusIdx = focusSelect.value === '' ? null : Number(focusSelect.value);
            applyView(true);
        });

        /* -- go -- */
        renderTabs();
        renderList();
        renderSelection();
        applyView(false);   // status + top-places before the map paints
        create();
    }

    /* ------------------------------------------------------------------ */
    /*  Fetch + mount                                                      */
    /* ------------------------------------------------------------------ */

    function initContainer(container) {
        var basePath = container.dataset.basePath || '';
        var siteBase = container.dataset.siteBase || '';
        ns.basePath = basePath;
        var url = basePath + '/modules/DreVisualizations/asset/data/item-dashboards/spatial-exploration.json';

        var libs = (typeof ns.ensureLibs === 'function') ? ns.ensureLibs() : Promise.resolve();
        Promise.all([
            fetch(url, { cache: 'no-cache' }).then(function (r) {
                if (!r.ok) throw new Error('not found');
                return r.json();
            }),
            libs
        ]).then(function (res) {
            var data = decode(res[0]);
            if (!data.locations.length) {
                container.innerHTML = '<div class="rv-no-data">No spatial data available yet.</div>';
                return;
            }
            if (typeof window.maplibregl === 'undefined') {
                container.innerHTML = '<div class="rv-error">Map library failed to load.</div>';
                return;
            }
            build(container, data, { basePath: basePath, siteBase: siteBase });
        }).catch(function (err) {
            console.error('DreVisualizations spatial-exploration:', err);
            container.innerHTML = '<div class="rv-error">Could not load the spatial exploration.</div>';
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
        var cs = document.querySelectorAll('.dre-spatial-exploration');
        for (var i = 0; i < cs.length; i++) mountWhenVisible(cs[i]);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
