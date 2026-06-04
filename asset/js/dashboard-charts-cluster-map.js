/**
 * Cluster-partner map builder: the Africa Multiple Research Centres (AMRCs) and
 * their partners as colour-coded MapLibre markers with a toggleable legend.
 *
 * DATA-DRIVEN from the precompute (Aggregators::clusterPartners): the institutions
 * that `dcterms:isPartOf` one of the four "African Multiple Partners" category
 * authority records, shaped as
 *   { categories: [{ key, label }, …],   // ordered → legend order + colour order
 *     points: [{ category, latitude, longitude, label, sublabel, itemId }, …] }
 * Category labels come straight from the authority records, and colours are
 * assigned here by category order from the theme palette (ns.COLORS) so they track
 * the active light/dark theme — so adding or renaming a category needs no
 * front-end change. (Previously this list, and its 3 categories, were hard-coded.)
 *
 * Registers into window.RV.charts for the dashboard orchestrator.
 */
(function () {
    'use strict';

    var ns = window.RV;
    var THEME = ns.THEME;
    var getBasemapStyle = ns.getBasemapStyle;

    ns.charts = ns.charts || {};

    // Palette indices into ns.COLORS, applied in category order. Keeps the
    // original AMRC / cooperation / global hues (0 / 7 / 5) and gives further
    // categories distinct ones; wraps if there are more categories than entries.
    var PALETTE = [0, 3, 7, 5, 2, 8, 1, 6];

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
        });
    }

    ns.charts.buildClusterMap = function (el, data, siteBase) {
        // Accept the data-driven { categories, points } shape; tolerate a bare
        // points array for safety.
        var categories = (data && data.categories) || [];
        var points = (data && data.points) || (Array.isArray(data) ? data : []);
        if (!points.length || typeof maplibregl === 'undefined') return null;

        // Derive category order/labels from the data. If categories weren't
        // supplied, fall back to the distinct keys present in the points.
        if (!categories.length) {
            var seen = {};
            points.forEach(function (p) {
                if (p.category != null && !seen[p.category]) {
                    seen[p.category] = true;
                    categories.push({ key: p.category, label: String(p.category) });
                }
            });
        }
        var order = categories.map(function (c) { return c.key; });
        var labelFor = {}, colorFor = {};
        categories.forEach(function (c, i) {
            labelFor[c.key] = c.label;
            colorFor[c.key] = ns.COLORS[PALETTE[i % PALETTE.length] % ns.COLORS.length] || ns.COLORS[0];
        });
        var emphasised = order[0]; // the first category (AMRCs) reads larger

        el.style.borderRadius = '6px';
        el.style.position = 'relative';

        // Visibility persists across the map rebuilds a light/dark toggle triggers.
        var visible = {};
        order.forEach(function (k) { visible[k] = true; });

        // Wrapped so the theme engine can rebuild the map (new basemap + marker
        // colours) on a live light/dark toggle — see dashboard-core ns.refresh().
        function create() {
            // The legend renders BELOW the map (in the panel). Drop a stale one
            // from a previous (pre-rebuild) render before building the new map.
            var panel = el.closest('.chart-panel') || el.parentNode || el;
            var staleLegend = panel.querySelector('.rv-cluster-legend');
            if (staleLegend) staleLegend.remove();

            var map = new maplibregl.Map({
                container: el,
                style: getBasemapStyle(),
                center: [12, 8],
                zoom: 1.3,
                attributionControl: false,
                cooperativeGestures: true
            });
            map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
            map.addControl(new maplibregl.FullscreenControl(), 'top-right');
            if (maplibregl.GlobeControl) map.addControl(new maplibregl.GlobeControl(), 'top-right');

            var markers = [];

            function clearMarkers() {
                markers.forEach(function (m) { m.remove(); });
                markers = [];
            }

            function renderMarkers(fit) {
                clearMarkers();
                points.forEach(function (p) {
                    if (!visible[p.category]) return;
                    // The cluster's own centres (first category) stand out among
                    // the partner dots.
                    var size = p.category === emphasised ? 18 : 13;
                    var dot = document.createElement('div');
                    dot.className = 'rv-cluster-marker';
                    dot.style.width = size + 'px';
                    dot.style.height = size + 'px';
                    dot.style.backgroundColor = colorFor[p.category] || ns.COLORS[0];
                    dot.style.borderColor = THEME.border;

                    var marker = new maplibregl.Marker({ element: dot })
                        .setLngLat([p.longitude, p.latitude]);
                    var title = (siteBase && p.itemId)
                        ? '<a href="' + esc(siteBase) + '/item/' + encodeURIComponent(p.itemId) + '">' + esc(p.label) + '</a>'
                        : esc(p.label);
                    var html = '<div class="rv-popup-content"><strong>' + title + '</strong>'
                        + (p.sublabel ? '<div class="rv-popup-sub">' + esc(p.sublabel) + '</div>' : '')
                        + '</div>';
                    marker.setPopup(new maplibregl.Popup({
                        offset: 14, closeButton: false, maxWidth: '280px', className: 'rv-map-popup'
                    }).setHTML(html));
                    marker.addTo(map);
                    markers.push(marker);
                });
                if (fit) fitToVisible();
            }

            function fitToVisible() {
                var pts = points.filter(function (p) { return visible[p.category]; });
                if (!pts.length) return;
                var bounds = new maplibregl.LngLatBounds();
                pts.forEach(function (p) { bounds.extend([p.longitude, p.latitude]); });
                if (!bounds.isEmpty()) {
                    map.fitBounds(bounds, { padding: 48, maxZoom: 4, duration: 0 });
                }
            }

            // Markers are HTML overlays, so — unlike GeoJSON sources/layers — they
            // do NOT need the style to have loaded, so the partner pins still show
            // even if the basemap tiles are slow or unreachable.
            renderMarkers(true);

            // Legend with per-category toggles. Toggling re-renders the marker set
            // but leaves the camera put (no re-fit), matching the amira overview.
            var legend = document.createElement('div');
            legend.className = 'rv-cluster-legend';
            order.forEach(function (k) {
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'rv-cluster-legend__item';
                btn.setAttribute('aria-pressed', String(visible[k]));
                if (!visible[k]) btn.classList.add('is-off');
                btn.innerHTML = '<span class="rv-cluster-legend__dot" style="background:' + colorFor[k] + '"></span>'
                    + '<span class="rv-cluster-legend__label">' + esc(labelFor[k] || k) + '</span>';
                btn.addEventListener('click', function () {
                    visible[k] = !visible[k];
                    btn.classList.toggle('is-off', !visible[k]);
                    btn.setAttribute('aria-pressed', String(visible[k]));
                    renderMarkers(false);
                });
                legend.appendChild(btn);
            });
            panel.appendChild(legend);

            ns.trackMap(map, create);
            return { resize: function () { map.resize(); } };
        }
        return create();
    };
})();
