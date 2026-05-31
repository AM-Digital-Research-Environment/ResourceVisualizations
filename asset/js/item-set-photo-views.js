/**
 * Photo Browsing engine — masonry / map / timeline browsers + lightbox.
 *
 * Surface-agnostic: it hydrates every `.photo-browse-container` on the page from
 * the JSON payload the PhotoBrowse block server-renders (id/title/url/thumb/full/
 * year/date/place/lat/lon). No precompute, no chart builders.
 *
 * THEMING — follows the DRE theme like the rest of the module:
 *   - masonry & timeline are pure DOM, styled entirely from --rv-* tokens (CSS
 *     flips them on light/dark with zero JS);
 *   - the map resolves its colours through `ns.cssColor` and re-themes via
 *     `ns.trackMap(map, rebuild)` on the global theme toggle.
 *
 * MapLibre is heavy and only the Map tab needs it, so it is lazy-loaded (from the
 * CDN URLs the block passes as data-attributes) the first time the Map view is
 * opened — the default Grid view ships zero map weight.
 */
(function () {
    'use strict';

    var ns = window.RV = window.RV || {};

    /* ------------------------------------------------------------------ */
    /*  Lazy MapLibre loader (shared across every gallery on the page)     */
    /* ------------------------------------------------------------------ */

    var _maplibrePromise = null;
    function loadMapLibre(cssUrl, jsUrl) {
        if (window.maplibregl) return Promise.resolve();
        if (_maplibrePromise) return _maplibrePromise;
        _maplibrePromise = new Promise(function (resolve, reject) {
            if (cssUrl && !document.querySelector('link[href="' + cssUrl + '"]')) {
                var link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = cssUrl;
                document.head.appendChild(link);
            }
            var s = document.createElement('script');
            s.src = jsUrl;
            s.async = true;
            s.onload = function () { resolve(); };
            s.onerror = function () { reject(new Error('MapLibre failed to load')); };
            document.head.appendChild(s);
        });
        return _maplibrePromise;
    }

    /* ------------------------------------------------------------------ */
    /*  Per-container setup                                                 */
    /* ------------------------------------------------------------------ */

    function setupContainer(container) {
        var dataEl = container.querySelector('script.photo-data');
        if (!dataEl) return;
        var photos;
        try {
            photos = JSON.parse(dataEl.textContent || '[]');
        } catch (e) {
            return;
        }
        if (!photos.length) return;

        var stage = container.querySelector('.photo-browse-stage');
        var buttons = Array.prototype.slice.call(container.querySelectorAll('.photo-view-btn'));
        var defaultView = container.dataset.defaultView || 'masonry';
        var mlCss = container.dataset.maplibreCss || '';
        var mlJs = container.dataset.maplibreJs || '';

        var lightbox = makeLightbox(container, photos);
        var views = {};   // name -> { el, built }

        // Pre-register a slot per view so showView can build lazily.
        ['masonry', 'map', 'timeline'].forEach(function (name) {
            views[name] = { el: null, built: false };
        });

        function showView(name) {
            if (!views[name]) name = 'masonry';

            // Toggle button + tab state.
            buttons.forEach(function (b) {
                var on = b.dataset.view === name;
                b.classList.toggle('is-active', on);
                b.setAttribute('aria-selected', on ? 'true' : 'false');
            });

            // Build on first use.
            if (!views[name].built) {
                if (name === 'map') {
                    buildMap(views[name], photos, lightbox, mlCss, mlJs, stage);
                } else {
                    var el = name === 'timeline'
                        ? buildTimeline(photos, lightbox)
                        : buildMasonry(photos, lightbox);
                    views[name].el = el;
                    views[name].built = true;
                }
            }

            // Swap visible node. The map node persists (kept mounted) so its
            // WebGL context + theme tracking survive tab switches.
            clearLoading(stage);
            Array.prototype.slice.call(stage.children).forEach(function (c) {
                if (c.classList && c.classList.contains('photo-view')) c.hidden = true;
            });
            if (views[name].el) {
                if (views[name].el.parentNode !== stage) stage.appendChild(views[name].el);
                views[name].el.hidden = false;
            }
            // A freshly-shown map must resize to its now-visible box.
            if (name === 'map' && views.map._map) {
                requestAnimationFrame(function () { try { views.map._map.resize(); } catch (e) {} });
            }
        }

        buttons.forEach(function (b) {
            b.addEventListener('click', function () { showView(b.dataset.view); });
        });

        showView(defaultView);
    }

    function clearLoading(stage) {
        var l = stage.querySelector('.rv-loading');
        if (l) l.remove();
    }

    /* ------------------------------------------------------------------ */
    /*  Masonry view                                                       */
    /* ------------------------------------------------------------------ */

    function buildMasonry(photos, lightbox) {
        var view = document.createElement('div');
        view.className = 'photo-view photo-masonry';
        photos.forEach(function (p, i) {
            view.appendChild(makeCard(p, i, lightbox));
        });
        return view;
    }

    /** A clickable thumbnail card. Shared by masonry + timeline. */
    function makeCard(p, index, lightbox) {
        var card = document.createElement('button');
        card.type = 'button';
        card.className = 'photo-card';
        card.title = p.title || '';

        var img = document.createElement('img');
        img.className = 'photo-card-img';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.alt = p.title || '';
        // Attach the error handler BEFORE setting src so a broken thumbnail is
        // reliably hidden even if it resolves synchronously from cache.
        img.addEventListener('error', function () { card.classList.add('is-broken'); });
        img.src = p.thumb;
        card.appendChild(img);

        if (p.year) {
            var tag = document.createElement('span');
            tag.className = 'photo-card-year';
            tag.textContent = p.year;
            card.appendChild(tag);
        }

        card.addEventListener('click', function () { lightbox.open(index); });
        return card;
    }

    /* ------------------------------------------------------------------ */
    /*  Timeline view (horizontal strip grouped by year)                   */
    /* ------------------------------------------------------------------ */

    function buildTimeline(photos, lightbox) {
        var view = document.createElement('div');
        view.className = 'photo-view photo-timeline';

        var byYear = {};
        photos.forEach(function (p, i) {
            var key = p.year != null ? String(p.year) : '__undated__';
            (byYear[key] = byYear[key] || []).push(i);
        });
        var years = Object.keys(byYear)
            .filter(function (k) { return k !== '__undated__'; })
            .sort(function (a, b) { return Number(a) - Number(b); });
        if (byYear.__undated__) years.push('__undated__');

        years.forEach(function (key) {
            var group = document.createElement('div');
            group.className = 'photo-timeline-group';

            var header = document.createElement('div');
            header.className = 'photo-timeline-year';
            header.textContent = key === '__undated__' ? 'Undated' : key;
            group.appendChild(header);

            var items = document.createElement('div');
            items.className = 'photo-timeline-items';
            byYear[key].forEach(function (i) {
                items.appendChild(makeCard(photos[i], i, lightbox));
            });
            group.appendChild(items);
            view.appendChild(group);
        });
        return view;
    }

    /* ------------------------------------------------------------------ */
    /*  Map view (clustered MapLibre, lazy-loaded)                         */
    /* ------------------------------------------------------------------ */

    function buildMap(slot, photos, lightbox, mlCss, mlJs, stage) {
        var view = document.createElement('div');
        view.className = 'photo-view photo-map-view';
        var mapEl = document.createElement('div');
        mapEl.className = 'photo-map';
        view.appendChild(mapEl);
        slot.el = view;
        slot.built = true;
        stage.appendChild(view);

        var geo = [];
        photos.forEach(function (p, i) {
            if (p.lat != null && p.lon != null) {
                geo.push({
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
                    properties: { idx: i, title: p.title || '' }
                });
            }
        });
        var fc = { type: 'FeatureCollection', features: geo };

        loadMapLibre(mlCss, mlJs).then(function () {
            createMap();
        }).catch(function () {
            mapEl.innerHTML = '<div class="rv-empty">Map unavailable.</div>';
        });

        function createMap() {
            var accent = ns.cssColor('--primary', '#22817b');
            var clusterFill = ns.cssColor('--primary-muted', '#6fb08e');
            var textOn = ns.cssColor('--surface', '#ffffff');

            var map = new maplibregl.Map({
                container: mapEl,
                style: ns.getBasemapStyle(),
                attributionControl: { compact: true }
            });
            map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

            map.on('load', function () {
                map.addSource('photos', {
                    type: 'geojson',
                    data: fc,
                    cluster: true,
                    clusterRadius: 50,
                    clusterMaxZoom: 14
                });

                map.addLayer({
                    id: 'clusters', type: 'circle', source: 'photos',
                    filter: ['has', 'point_count'],
                    paint: {
                        'circle-color': clusterFill,
                        'circle-opacity': 0.85,
                        'circle-stroke-color': accent,
                        'circle-stroke-width': 1.5,
                        'circle-radius': ['step', ['get', 'point_count'], 16, 10, 22, 50, 30]
                    }
                });
                map.addLayer({
                    id: 'cluster-count', type: 'symbol', source: 'photos',
                    filter: ['has', 'point_count'],
                    layout: {
                        'text-field': '{point_count_abbreviated}',
                        'text-size': 12,
                        'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold', 'Noto Sans Bold']
                    },
                    paint: { 'text-color': textOn }
                });
                map.addLayer({
                    id: 'points', type: 'circle', source: 'photos',
                    filter: ['!', ['has', 'point_count']],
                    paint: {
                        'circle-color': accent,
                        'circle-radius': 7,
                        'circle-stroke-color': textOn,
                        'circle-stroke-width': 2
                    }
                });

                // Fit to the points (guard the single-point case).
                try {
                    var b = new maplibregl.LngLatBounds();
                    geo.forEach(function (f) { b.extend(f.geometry.coordinates); });
                    if (!b.isEmpty()) {
                        map.fitBounds(b, { padding: 48, maxZoom: 12, duration: 0 });
                    }
                } catch (e) { /* noop */ }
            });

            // Cluster click → zoom in to expand it.
            map.on('click', 'clusters', function (e) {
                var f = map.queryRenderedFeatures(e.point, { layers: ['clusters'] })[0];
                if (!f) return;
                map.getSource('photos').getClusterExpansionZoom(f.properties.cluster_id)
                    .then(function (zoom) {
                        map.easeTo({ center: f.geometry.coordinates, zoom: zoom });
                    }).catch(function () {});
            });
            // Point click → open the lightbox at that photo.
            map.on('click', 'points', function (e) {
                var f = e.features && e.features[0];
                if (f) lightbox.open(f.properties.idx);
            });
            ['clusters', 'points'].forEach(function (layer) {
                map.on('mouseenter', layer, function () { map.getCanvas().style.cursor = 'pointer'; });
                map.on('mouseleave', layer, function () { map.getCanvas().style.cursor = ''; });
            });

            slot._map = map;
            ns.trackMap(map, function () { createMap(); });
            return map;
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Lightbox                                                           */
    /* ------------------------------------------------------------------ */

    function makeLightbox(container, photos) {
        var box = document.createElement('div');
        box.className = 'photo-lightbox';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');
        box.hidden = true;
        box.innerHTML =
            '<div class="photo-lightbox-backdrop" data-close="1"></div>' +
            '<button type="button" class="photo-lightbox-close" data-close="1" aria-label="Close">✕</button>' +
            '<button type="button" class="photo-lightbox-nav photo-lightbox-prev" data-nav="-1" aria-label="Previous">‹</button>' +
            '<button type="button" class="photo-lightbox-nav photo-lightbox-next" data-nav="1" aria-label="Next">›</button>' +
            '<div class="photo-lightbox-body">' +
                '<figure class="photo-lightbox-figure"><img alt=""></figure>' +
                '<aside class="photo-lightbox-meta">' +
                    '<h4 class="photo-lightbox-title"></h4>' +
                    '<dl class="photo-lightbox-fields"></dl>' +
                    '<a class="photo-lightbox-link" href="#">View item →</a>' +
                '</aside>' +
            '</div>';
        container.appendChild(box);

        var img = box.querySelector('.photo-lightbox-figure img');
        var titleEl = box.querySelector('.photo-lightbox-title');
        var fieldsEl = box.querySelector('.photo-lightbox-fields');
        var linkEl = box.querySelector('.photo-lightbox-link');
        var closeBtn = box.querySelector('.photo-lightbox-close');
        var idx = 0;

        function field(label, value) {
            if (!value) return;
            var dt = document.createElement('dt');
            dt.textContent = label;
            var dd = document.createElement('dd');
            dd.textContent = value;
            fieldsEl.appendChild(dt);
            fieldsEl.appendChild(dd);
        }

        function render() {
            var p = photos[idx];
            img.src = p.full || p.thumb;
            img.alt = p.title || '';
            titleEl.textContent = p.title || '';
            fieldsEl.textContent = '';
            field('Date', p.date || (p.year ? String(p.year) : ''));
            field('Place', p.place || '');
            field('Of', (idx + 1) + ' / ' + photos.length);
            linkEl.href = p.url || '#';
        }

        function open(i) {
            idx = (i + photos.length) % photos.length;
            render();
            box.hidden = false;
            document.body.classList.add('photo-lightbox-open');
            closeBtn.focus();
        }
        function close() {
            box.hidden = true;
            document.body.classList.remove('photo-lightbox-open');
        }
        function step(d) {
            idx = (idx + d + photos.length) % photos.length;
            render();
        }

        box.addEventListener('click', function (e) {
            var t = e.target.closest('[data-close],[data-nav]');
            if (!t) return;
            if (t.hasAttribute('data-close')) close();
            else step(Number(t.dataset.nav));
        });
        document.addEventListener('keydown', function (e) {
            if (box.hidden) return;
            if (e.key === 'Escape') close();
            else if (e.key === 'ArrowLeft') step(-1);
            else if (e.key === 'ArrowRight') step(1);
        });

        return { open: open, close: close };
    }

    /* ------------------------------------------------------------------ */
    /*  Boot                                                               */
    /* ------------------------------------------------------------------ */

    function init() {
        Array.prototype.slice.call(document.querySelectorAll('.photo-browse-container'))
            .forEach(setupContainer);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
