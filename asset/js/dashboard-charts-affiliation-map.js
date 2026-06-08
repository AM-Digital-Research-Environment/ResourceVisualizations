/**
 * Affiliation map: a person's affiliated organisations (institutions) that carry
 * coordinates, as markers on a MapLibre map. Hidden by the orchestrator when the
 * `affiliationMap` data key is absent (no affiliation is geocoded).
 *
 * Data format: [{ name, lat, lon, itemId }]
 *
 * Registers into window.RV.charts for the dashboard orchestrator.
 */
(function () {
    'use strict';

    var ns = window.RV;
    var THEME = ns.THEME;

    ns.charts = ns.charts || {};

    ns.charts.buildAffiliationMap = function (el, data, siteBase) {
        if (!data || !data.length || typeof maplibregl === 'undefined') return null;

        el.style.borderRadius = '6px';

        // Wrapped so the theme engine can rebuild the map (new basemap + marker
        // colours) on a live light/dark toggle — see dashboard-core ns.refresh().
        function create() {
            var map = new maplibregl.Map({
                container: el,
                style: ns.getBasemapStyle(),
                center: [data[0].lon, data[0].lat],
                zoom: 3,
                attributionControl: false,
                cooperativeGestures: true,
            });
            map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
            map.addControl(new maplibregl.FullscreenControl(), 'top-right');

            map.on('load', function () {
                data.forEach(function (org) {
                    var html = '<strong>' + (org.name || '') + '</strong><br/>'
                        + '<span style="color:' + THEME.accent + '">Affiliation</span>';
                    // Project affiliation maps carry the affiliated members; the
                    // per-person map omits this field, so the block is skipped there.
                    if (org.members && org.members.length) {
                        html += '<br/><span style="font-size:12px;color:var(--muted,#666)">'
                            + (org.members.length === 1 ? 'Member: ' : 'Members: ')
                            + org.members.join(', ') + '</span>';
                    }
                    if (siteBase && org.itemId) {
                        html += '<br/><a href="' + siteBase + '/item/' + org.itemId + '" style="font-size:12px">View organisation →</a>';
                    }
                    new maplibregl.Marker({ color: THEME.accent })
                        .setLngLat([org.lon, org.lat])
                        .setPopup(new maplibregl.Popup({ offset: 12 }).setHTML(html))
                        .addTo(map);
                });

                if (data.length > 1) {
                    var bounds = new maplibregl.LngLatBounds();
                    data.forEach(function (org) { bounds.extend([org.lon, org.lat]); });
                    map.fitBounds(bounds, { padding: 50, maxZoom: 8 });
                } else {
                    map.setCenter([data[0].lon, data[0].lat]);
                    map.setZoom(5);
                }
            });

            ns.trackMap(map, create);
            return { resize: function () { map.resize(); } };
        }
        return create();
    };
})();
