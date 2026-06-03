/**
 * Choropleth map builder: country-level item counts on Natural Earth 110m.
 *
 * Data: [{ country, count }] — joined against the GeoJSON ADMIN/NAME property
 * (lower-cased), matching the dashboard's ChoroplethMap so the two render the
 * same country set. MapLibre fill layer with a log-spaced step ramp derived
 * from the DRE --primary accent; theme-aware via ns.getBasemapStyle +
 * ns.trackMap (rebuilds on light/dark toggle). The shared countries.geojson is
 * fetched once and cached on the namespace.
 *
 * Registers into window.RV.charts for the dashboard orchestrator.
 */
(function () {
    'use strict';

    var ns = window.RV;
    var THEME = ns.THEME;
    var getBasemapStyle = ns.getBasemapStyle;

    ns.charts = ns.charts || {};

    var NAME_PROPS = ['ADMIN', 'NAME', 'NAME_EN', 'NAME_LONG'];

    /** Fetch + cache the shared countries GeoJSON (promise reused across charts). */
    function loadCountries() {
        if (ns._countriesGeoJSON) return ns._countriesGeoJSON;
        ns._countriesGeoJSON = fetch(ns.moduleAsset('data/geo/countries.geojson'))
            .then(function (r) {
                if (!r.ok) throw new Error('countries.geojson ' + r.status);
                return r.json();
            });
        return ns._countriesGeoJSON;
    }

    /** Parse an 'rgb(r,g,b)' / 'rgba(...)' string to [r, g, b]. */
    function parseRGB(str) {
        var m = /(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(str || '');
        return m ? [+m[1], +m[2], +m[3]] : [34, 129, 123];
    }

    function mix(a, b, t) {
        return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * t) + ','
            + Math.round(a[1] + (b[1] - a[1]) * t) + ','
            + Math.round(a[2] + (b[2] - a[2]) * t) + ')';
    }

    /** Five sequential stops (light tint → accent) + a neutral no-data fill. */
    function buildRamp() {
        var isDark = ns.isDark();
        var accent = parseRGB(THEME.accent);
        var base = parseRGB(ns.cssColor('--surface', isDark ? 'rgb(30,30,30)' : 'rgb(255,255,255)'));
        var ratios = [0.82, 0.62, 0.42, 0.22, 0]; // mix toward base; 0 = full accent
        return {
            stops: ratios.map(function (r) { return mix(accent, base, r); }),
            empty: ns.cssColor('--border-light', isDark ? 'rgb(42,42,42)' : 'rgb(235,235,235)')
        };
    }

    /** Log-spaced breakpoints (5) matching the ramp stops. */
    function buildBreaks(maxCount) {
        var log = Math.log(Math.max(maxCount, 1) + 1);
        return [0, 1, 2, 3, 4].map(function (i) {
            return Math.round(Math.exp(log * i / 4) - 1);
        });
    }

    /** Build a strictly-ascending MapLibre step expression for fill-color. */
    function fillExpression(ramp, breaks) {
        var t = [Math.max(1, breaks[0])];
        for (var i = 1; i < 5; i++) t[i] = Math.max(breaks[i], t[i - 1] + 1);
        return [
            'step', ['get', 'count'],
            ramp.empty,
            t[0], ramp.stops[0],
            t[1], ramp.stops[1],
            t[2], ramp.stops[2],
            t[3], ramp.stops[3],
            t[4], ramp.stops[4]
        ];
    }

    /** Walk Polygon / MultiPolygon rings to extend a LngLatBounds. */
    function extendBounds(bounds, geom) {
        if (!geom) return;
        if (geom.type === 'Polygon') {
            geom.coordinates.forEach(function (ring) {
                ring.forEach(function (c) { bounds.extend([c[0], c[1]]); });
            });
        } else if (geom.type === 'MultiPolygon') {
            geom.coordinates.forEach(function (poly) {
                poly.forEach(function (ring) {
                    ring.forEach(function (c) { bounds.extend([c[0], c[1]]); });
                });
            });
        }
    }

    ns.charts.buildChoropleth = function (el, data, siteBase) {
        if (!data || !data.length || typeof maplibregl === 'undefined') return null;
        el.style.borderRadius = '6px';

        // country (lower-cased) → count, and the running total for shares.
        var counts = {};
        var total = 0;
        data.forEach(function (d) {
            if (!d.country) return;
            var k = String(d.country).toLowerCase();
            counts[k] = (counts[k] || 0) + (d.count || 0);
            total += d.count || 0;
        });
        var maxCount = Math.max.apply(null, data.map(function (d) { return d.count || 0; }).concat(1));

        function lookupCount(props) {
            for (var i = 0; i < NAME_PROPS.length; i++) {
                var v = props[NAME_PROPS[i]];
                if (typeof v === 'string' && counts[v.toLowerCase()] !== undefined) {
                    return counts[v.toLowerCase()];
                }
            }
            return 0;
        }

        function countryName(props) {
            for (var i = 0; i < NAME_PROPS.length; i++) {
                if (typeof props[NAME_PROPS[i]] === 'string') return props[NAME_PROPS[i]];
            }
            return 'Unknown';
        }

        // Wrapped so the theme engine can rebuild the map on a light/dark toggle.
        function create() {
            var map = new maplibregl.Map({
                container: el,
                style: getBasemapStyle(),
                center: [10, 18],
                zoom: 1.3,
                attributionControl: false,
                cooperativeGestures: true
            });
            map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
            map.addControl(new maplibregl.FullscreenControl(), 'top-right');
            if (maplibregl.GlobeControl) map.addControl(new maplibregl.GlobeControl(), 'top-right');

            map.on('load', function () {
                loadCountries().then(function (geo) {
                    if (!map || !map.getStyle) return;
                    var ramp = buildRamp();
                    var breaks = buildBreaks(maxCount);

                    // Inject a numeric `count` the fill expression reads against.
                    var merged = {
                        type: 'FeatureCollection',
                        features: geo.features.map(function (f) {
                            var props = f.properties || {};
                            var copy = {};
                            for (var k in props) copy[k] = props[k];
                            copy.count = lookupCount(props);
                            return { type: 'Feature', geometry: f.geometry, properties: copy };
                        })
                    };

                    map.addSource('countries', { type: 'geojson', data: merged });

                    map.addLayer({
                        id: 'country-fill', type: 'fill', source: 'countries',
                        paint: {
                            'fill-color': fillExpression(ramp, breaks),
                            'fill-outline-color': THEME.border,
                            'fill-opacity': 0.9
                        }
                    });
                    map.addLayer({
                        id: 'country-line', type: 'line', source: 'countries',
                        paint: { 'line-color': THEME.border, 'line-width': 0.5 }
                    });

                    // --- Hover popup (country, count, share) ---
                    var activePopup = null;
                    map.on('mousemove', 'country-fill', function (e) {
                        if (!e.features || !e.features.length) return;
                        var props = e.features[0].properties || {};
                        var count = Number(props.count || 0);
                        map.getCanvas().style.cursor = count > 0 ? 'pointer' : '';
                        var share = total > 0 ? (count / total * 100) : 0;
                        var html = '<div class="rv-popup-content"><strong>' + countryName(props) + '</strong>'
                            + (count > 0
                                ? '<br/><span class="rv-popup-count">' + count + ' item' + (count === 1 ? '' : 's')
                                  + ' · ' + share.toFixed(1) + '%</span>'
                                : '<br/><em>No items</em>')
                            + '</div>';
                        if (!activePopup) {
                            activePopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8, className: 'rv-map-popup' });
                        }
                        activePopup.setLngLat(e.lngLat).setHTML(html).addTo(map);
                    });
                    map.on('mouseleave', 'country-fill', function () {
                        map.getCanvas().style.cursor = '';
                        if (activePopup) { activePopup.remove(); activePopup = null; }
                    });

                    // --- Fit to countries that have data ---
                    var bounds = new maplibregl.LngLatBounds();
                    var any = false;
                    merged.features.forEach(function (f) {
                        if ((f.properties.count || 0) > 0) { extendBounds(bounds, f.geometry); any = true; }
                    });
                    if (any && !bounds.isEmpty()) {
                        map.fitBounds(bounds, { padding: 36, maxZoom: 5, duration: 0 });
                    }

                    // --- Legend ---
                    var oldLegend = el.querySelector('.rv-map-legend');
                    if (oldLegend) oldLegend.remove();
                    var legend = document.createElement('div');
                    legend.className = 'rv-map-legend rv-choropleth-legend';
                    var swatches = ramp.stops.map(function (c) {
                        return '<span class="rv-map-legend-swatch" style="background:' + c + '"></span>';
                    }).join('');
                    legend.innerHTML = '<div class="rv-map-legend-row"><span>1</span>'
                        + swatches + '<span>' + maxCount + '</span></div>'
                        + '<div class="rv-map-legend-caption">Items per country</div>';
                    el.style.position = 'relative';
                    el.appendChild(legend);
                }).catch(function (err) {
                    if (window.console) console.error('Choropleth load failed:', err);
                });
            });

            ns.trackMap(map, create);
            return { resize: function () { map.resize(); } };
        }
        return create();
    };
})();
