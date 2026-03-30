/**
 * Map chart builders: geographic origins map, self-location mini map.
 *
 * Registers into window.RV.charts for the dashboard orchestrator.
 */
(function () {
    'use strict';

    var ns = window.RV;
    var THEME = ns.THEME, COLORS = ns.COLORS;
    var truncateLabel = ns.truncateLabel, getBasemapStyle = ns.getBasemapStyle;

    ns.charts = ns.charts || {};

    /* -- Map popup builder -- */

    function buildMapPopup(props, locItems, page, perPage, siteBase) {
        var total = locItems.length;
        var totalPages = Math.ceil(total / perPage);
        var start = page * perPage;
        var pageItems = locItems.slice(start, start + perPage);

        var h = '<div class="rv-popup-content">';
        h += '<strong>' + (props.name || '') + '</strong>';
        h += ' <span class="rv-popup-count">' + props.value + ' items</span>';

        if (pageItems.length) {
            h += '<ul class="rv-popup-items">';
            pageItems.forEach(function (it) {
                var url = siteBase ? siteBase + '/item/' + it.id : '#';
                var title = truncateLabel(it.title, 55);
                h += '<li><a href="' + url + '">' + title + '</a></li>';
            });
            h += '</ul>';
        }

        if (totalPages > 1) {
            h += '<div class="rv-popup-pagination">';
            if (page > 0) h += '<button type="button" data-page="' + (page - 1) + '">\u2190</button>';
            h += '<span>' + (page + 1) + ' / ' + totalPages + '</span>';
            if (page < totalPages - 1) h += '<button type="button" data-page="' + (page + 1) + '">\u2192</button>';
            h += '</div>';
        }

        if (props.itemId && siteBase) {
            h += '<a class="rv-popup-location-link" href="' + siteBase + '/item/' + props.itemId + '">View location page \u2192</a>';
        }

        h += '</div>';
        return h;
    }

    /* -- Geographic origins map -- */

    ns.charts.buildMap = function (el, data, siteBase) {
        if (!data || !data.length || typeof maplibregl === 'undefined') return null;

        el.style.borderRadius = '6px';
        var map = new maplibregl.Map({
            container: el,
            style: getBasemapStyle(),
            center: [0, 15],
            zoom: 1.5,
            attributionControl: false,
            cooperativeGestures: true,
        });
        map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
        map.addControl(new maplibregl.FullscreenControl(), 'top-right');
        if (maplibregl.GlobeControl) map.addControl(new maplibregl.GlobeControl(), 'top-right');
        map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left');
        // Attribution hidden — source info in map tiles. Users can inspect via browser.

        map.on('load', function () {

            var features = data.map(function (loc) {
                return {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [loc.lon, loc.lat] },
                    properties: { name: loc.name, value: loc.value, itemId: loc.itemId }
                };
            });

            map.addSource('locations', {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: features },
                cluster: true,
                clusterMaxZoom: 8,
                clusterRadius: 40,
            });

            map.addLayer({
                id: 'clusters', type: 'circle', source: 'locations',
                filter: ['has', 'point_count'],
                paint: {
                    'circle-color': ['step', ['get', 'point_count'], COLORS[0], 10, COLORS[1], 30, COLORS[5]],
                    'circle-radius': ['step', ['get', 'point_count'], 18, 10, 24, 30, 32],
                    'circle-stroke-width': 2, 'circle-stroke-color': '#fff',
                }
            });

            map.addLayer({
                id: 'cluster-count', type: 'symbol', source: 'locations',
                filter: ['has', 'point_count'],
                layout: { 'text-field': '{point_count_abbreviated}', 'text-size': 12 },
                paint: { 'text-color': '#fff' }
            });

            map.addLayer({
                id: 'points', type: 'circle', source: 'locations',
                filter: ['!', ['has', 'point_count']],
                paint: {
                    'circle-color': THEME.accent,
                    'circle-radius': ['interpolate', ['linear'], ['get', 'value'], 1, 7, 50, 18, 200, 28],
                    'circle-stroke-width': 2, 'circle-stroke-color': '#fff', 'circle-opacity': 0.85,
                }
            });

            map.addLayer({
                id: 'point-labels', type: 'symbol', source: 'locations',
                filter: ['!', ['has', 'point_count']],
                layout: { 'text-field': '{name}', 'text-size': 11, 'text-offset': [0, 1.8], 'text-anchor': 'top' },
                paint: { 'text-color': THEME.text, 'text-halo-color': THEME.border, 'text-halo-width': 1.5 }
            });

            var locationItems = {};
            data.forEach(function (loc) {
                if (loc.items && loc.items.length) locationItems[loc.name] = loc.items;
            });

            var activePopup = null;
            map.on('click', 'points', function (e) {
                if (activePopup) activePopup.remove();
                var props = e.features[0].properties;
                var locItems = locationItems[props.name] || [];
                var perPage = 8;

                activePopup = new maplibregl.Popup({ offset: 12, maxWidth: '320px', className: 'rv-map-popup' })
                    .setLngLat(e.lngLat)
                    .setHTML(buildMapPopup(props, locItems, 0, perPage, siteBase))
                    .addTo(map);

                function attachPageHandlers() {
                    var el = activePopup.getElement();
                    if (!el) return;
                    el.querySelectorAll('[data-page]').forEach(function (btn) {
                        btn.addEventListener('click', function (evt) {
                            evt.stopPropagation();
                            var page = parseInt(btn.dataset.page, 10);
                            activePopup.setHTML(buildMapPopup(props, locItems, page, perPage, siteBase));
                            attachPageHandlers();
                        });
                    });
                }
                attachPageHandlers();
            });

            map.on('click', 'clusters', function (e) {
                var clusterId = e.features[0].properties.cluster_id;
                map.getSource('locations').getClusterExpansionZoom(clusterId, function (err, zoom) {
                    if (err) return;
                    map.easeTo({ center: e.lngLat, zoom: zoom });
                });
            });

            map.on('mouseenter', 'points', function () { map.getCanvas().style.cursor = 'pointer'; });
            map.on('mouseleave', 'points', function () { map.getCanvas().style.cursor = ''; });
            map.on('mouseenter', 'clusters', function () { map.getCanvas().style.cursor = 'pointer'; });
            map.on('mouseleave', 'clusters', function () { map.getCanvas().style.cursor = ''; });

            if (features.length > 1) {
                var bounds = new maplibregl.LngLatBounds();
                features.forEach(function (f) { bounds.extend(f.geometry.coordinates); });
                map.fitBounds(bounds, { padding: 40, maxZoom: 6 });
            } else if (features.length === 1) {
                map.setCenter(features[0].geometry.coordinates);
                map.setZoom(4);
            }
        });

        return { resize: function () { map.resize(); } };
    };

    /* -- Self-location mini map -- */

    ns.charts.buildMiniMap = function (el, data) {
        if (!data || !data.lat || typeof maplibregl === 'undefined') return null;
        el.style.borderRadius = '6px';
        var map = new maplibregl.Map({
            container: el,
            style: getBasemapStyle(),
            center: [data.lon, data.lat],
            zoom: 4,
            attributionControl: false,
            scrollZoom: false,
        });
        map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
        map.addControl(new maplibregl.FullscreenControl(), 'top-right');
        map.addControl(new maplibregl.ScaleControl({ maxWidth: 80, unit: 'metric' }), 'bottom-left');
        new maplibregl.Marker({ color: THEME.accent })
            .setLngLat([data.lon, data.lat])
            .setPopup(new maplibregl.Popup({ offset: 12 }).setHTML('<strong>' + (data.name || '') + '</strong>'))
            .addTo(map);
        return { resize: function () { map.resize(); } };
    };
})();
