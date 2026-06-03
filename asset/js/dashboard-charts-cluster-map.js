/**
 * Cluster-partner map builder: the Africa Multiple Research Centres (AMRCs) and
 * their partners as colour-coded MapLibre markers with a toggleable legend.
 *
 * Data is the static, curated `clusterPartners` array emitted by the precompute
 * (Aggregators::clusterPartners) — a list of
 * `{category, latitude, longitude, label, sublabel}`. Marker colour is assigned
 * here, per `category`, from the theme palette (ns.COLORS) so it follows the
 * active light/dark theme; the precompute carries no colours.
 *
 * Registers into window.RV.charts for the dashboard orchestrator.
 */
(function () {
    'use strict';

    var ns = window.RV;
    var THEME = ns.THEME;
    var getBasemapStyle = ns.getBasemapStyle;

    ns.charts = ns.charts || {};

    // Canonical category order and palette index (into ns.COLORS).
    var ORDER = ['amrc', 'cooperation', 'global'];
    var COLOR_INDEX = { amrc: 0, cooperation: 7, global: 5 };
    var LEGEND_LABELS = {
        amrc: 'AMRCs & privileged partner',
        cooperation: 'Cooperation partners',
        global: 'Global partner Centers of African Studies'
    };

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
        });
    }

    ns.charts.buildClusterMap = function (el, data) {
        if (!data || !data.length || typeof maplibregl === 'undefined') return null;

        el.style.borderRadius = '6px';
        el.style.position = 'relative';

        // Categories present, in canonical order. Visibility persists across the
        // map rebuilds that a light/dark theme toggle triggers (closure state).
        var cats = ORDER.filter(function (c) {
            return data.some(function (p) { return p.category === c; });
        });
        var visible = {};
        cats.forEach(function (c) { visible[c] = true; });

        function colorFor(cat) {
            var idx = COLOR_INDEX[cat];
            return ns.COLORS[idx % ns.COLORS.length] || ns.COLORS[0];
        }

        // Wrapped so the theme engine can rebuild the map (new basemap + marker
        // colours) on a live light/dark toggle — see dashboard-core ns.refresh().
        function create() {
            // Drop a stale legend left from a previous (pre-rebuild) render.
            var staleLegend = el.querySelector('.rv-cluster-legend');
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
            map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left');

            var markers = [];

            function clearMarkers() {
                markers.forEach(function (m) { m.remove(); });
                markers = [];
            }

            function renderMarkers(fit) {
                clearMarkers();
                data.forEach(function (p) {
                    if (!visible[p.category]) return;
                    // AMRCs read larger so the cluster's own centres stand out
                    // among the partner dots.
                    var size = p.category === 'amrc' ? 18 : 13;
                    var dot = document.createElement('div');
                    dot.className = 'rv-cluster-marker';
                    dot.style.width = size + 'px';
                    dot.style.height = size + 'px';
                    dot.style.backgroundColor = colorFor(p.category);
                    dot.style.borderColor = THEME.border;

                    var marker = new maplibregl.Marker({ element: dot })
                        .setLngLat([p.longitude, p.latitude]);
                    var html = '<div class="rv-popup-content"><strong>' + esc(p.label) + '</strong>'
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
                var pts = data.filter(function (p) { return visible[p.category]; });
                if (!pts.length) return;
                var bounds = new maplibregl.LngLatBounds();
                pts.forEach(function (p) { bounds.extend([p.longitude, p.latitude]); });
                if (!bounds.isEmpty()) {
                    map.fitBounds(bounds, { padding: 48, maxZoom: 4, duration: 0 });
                }
            }

            // Markers are HTML overlays, so — unlike GeoJSON sources/layers — they
            // do NOT need the style to have loaded (matching ns.charts.buildMiniMap).
            // Adding them immediately means the partner pins still show even if the
            // basemap tiles are slow or unreachable.
            renderMarkers(true);

            // Legend with per-category toggles. Toggling re-renders the marker
            // set but leaves the camera put (no re-fit), matching the amira
            // overview's `fitOnUpdate={false}` behaviour.
            var legend = document.createElement('div');
            legend.className = 'rv-cluster-legend';
            cats.forEach(function (c) {
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'rv-cluster-legend__item';
                btn.setAttribute('aria-pressed', String(visible[c]));
                if (!visible[c]) btn.classList.add('is-off');
                btn.innerHTML = '<span class="rv-cluster-legend__dot" style="background:' + colorFor(c) + '"></span>'
                    + '<span class="rv-cluster-legend__label">' + esc(LEGEND_LABELS[c]) + '</span>';
                btn.addEventListener('click', function () {
                    visible[c] = !visible[c];
                    btn.classList.toggle('is-off', !visible[c]);
                    btn.setAttribute('aria-pressed', String(visible[c]));
                    renderMarkers(false);
                });
                legend.appendChild(btn);
            });
            el.appendChild(legend);

            ns.trackMap(map, create);
            return { resize: function () { map.resize(); } };
        }
        return create();
    };
})();
