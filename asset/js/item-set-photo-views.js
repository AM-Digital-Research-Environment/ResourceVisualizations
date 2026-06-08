/**
 * Photo Browsing engine — masonry / map / timeline browsers + lightbox, plus a
 * journal-issue grouping mode with a table-of-contents modal.
 *
 * Surface-agnostic: it hydrates every `.photo-browse-container` on the page from
 * the JSON payload the PhotoBrowse block server-renders (id/title/url/thumb/full/
 * year/date/place/lat/lon — and, for featured collections, creator and journal
 * volume/issue/pages). No precompute, no chart builders.
 *
 *   - masonry: a responsive round-robin column layout of carded tiles (cover +
 *     title + date/place chips). Cards reserve their box (muted frame, 4:3
 *     placeholder that settles to the image's natural ratio on load) and fade
 *     the image in, so nothing flashes or reflows as lazy images stream in;
 *     they also reveal-on-scroll via ns.revealOnScroll.
 *   - `data-grouping="issue"`: tiles become journal issues (Vol. N No. M), and
 *     clicking opens a table-of-contents modal listing the issue's articles.
 *   - map: clustered MapLibre, lazy-loaded the first time the Map tab is opened.
 *
 * THEMING — follows the DRE theme via the --rv-* tokens (masonry/timeline/TOC are
 * pure DOM) and ns.cssColor / ns.trackMap (the map).
 */
(function () {
    'use strict';

    var ns = window.RV = window.RV || {};

    /* ------------------------------------------------------------------ */
    /*  Small inline-SVG icons (lucide, MIT)                               */
    /* ------------------------------------------------------------------ */

    function svg(inner, cls) {
        return '<svg class="' + (cls || '') + '" viewBox="0 0 24 24" fill="none"'
            + ' stroke="currentColor" stroke-width="2" stroke-linecap="round"'
            + ' stroke-linejoin="round" aria-hidden="true" focusable="false">' + inner + '</svg>';
    }
    var ICON = {
        calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 2v4"/><path d="M16 2v4"/>',
        pin: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
        book: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
        arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
        external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
        chevronLeft: '<path d="m15 18-6-6 6-6"/>',
        chevronRight: '<path d="m9 18 6-6-6-6"/>',
        close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'
    };

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
        var grouping = container.dataset.grouping || 'photo';
        var mlCss = container.dataset.maplibreCss || '';
        var mlJs = container.dataset.maplibreJs || '';

        var lightbox = makeLightbox(container, photos);
        var toc = grouping === 'issue' ? makeTocModal(container) : null;
        var views = {};   // name -> { el, built }

        ['masonry', 'map', 'timeline'].forEach(function (name) {
            views[name] = { el: null, built: false };
        });

        function showView(name) {
            if (!views[name]) name = 'masonry';

            buttons.forEach(function (b) {
                var on = b.dataset.view === name;
                b.classList.toggle('is-active', on);
                b.setAttribute('aria-selected', on ? 'true' : 'false');
            });

            // Build on first use.
            if (!views[name].built) {
                if (name === 'map') {
                    buildMap(views[name], photos, lightbox, mlCss, mlJs, stage);
                } else if (name === 'timeline') {
                    views[name].el = buildTimeline(photos, lightbox);
                    views[name].built = true;
                } else {
                    views[name].el = buildMasonry(photos, lightbox, grouping, toc, stage);
                    views[name].built = true;
                }
            }

            clearLoading(stage);
            Array.prototype.slice.call(stage.children).forEach(function (c) {
                if (c.classList && c.classList.contains('photo-view')) c.hidden = true;
            });
            if (views[name].el) {
                if (views[name].el.parentNode !== stage) stage.appendChild(views[name].el);
                views[name].el.hidden = false;
            }
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
    /*  Masonry view (responsive round-robin columns)                      */
    /* ------------------------------------------------------------------ */

    function columnsForWidth(w) {
        if (w >= 1440) return 5;
        if (w >= 1024) return 4;
        if (w >= 640) return 3;
        return 2;
    }

    function buildMasonry(photos, lightbox, grouping, toc, stage) {
        var view = document.createElement('div');
        view.className = 'photo-view photo-masonry';

        // Build the card nodes ONCE. Re-layout only moves them between columns,
        // so loaded images are never re-fetched (no re-flash) on resize.
        var cards;
        if (grouping === 'issue') {
            cards = buildIssueCards(photos, toc);
        } else {
            cards = photos.map(function (p, i) { return makeCard(p, i, lightbox, false); });
        }

        var currentCols = 0;
        function layout() {
            var w = view.clientWidth || (stage && stage.clientWidth) || window.innerWidth || 1024;
            var n = columnsForWidth(w);
            if (n === currentCols) return;
            currentCols = n;
            view.textContent = '';
            var cols = [];
            for (var i = 0; i < n; i++) {
                var col = document.createElement('div');
                col.className = 'photo-masonry-col';
                view.appendChild(col);
                cols.push(col);
            }
            cards.forEach(function (card, i) { cols[i % n].appendChild(card); });
        }
        layout();

        if ('ResizeObserver' in window) {
            // Observe the stage (always in the DOM) so the first callback fixes
            // the column count once the view is mounted and measurable.
            var ro = new ResizeObserver(function () { layout(); });
            ro.observe(stage || view);
        } else {
            window.addEventListener('resize', layout);
        }
        return view;
    }

    /**
     * A clickable carded tile. `compact` (timeline) drops the body so the strip
     * stays a thin row of thumbnails.
     */
    function makeCard(p, index, lightbox, compact) {
        var card = document.createElement('button');
        card.type = 'button';
        card.className = 'photo-card' + (compact ? ' is-compact' : '');
        card.title = p.title || '';

        card.appendChild(makeFrame(p, !compact));

        if (!compact) {
            var body = document.createElement('div');
            body.className = 'photo-card-body';

            var title = document.createElement('h4');
            title.className = 'photo-card-title';
            title.textContent = p.title || '';
            body.appendChild(title);

            var chips = [];
            if (p.year) chips.push(chip(ICON.calendar, p.year));
            if (p.place) chips.push(chip(ICON.pin, p.place));
            if (chips.length) {
                var meta = document.createElement('div');
                meta.className = 'photo-card-meta';
                chips.forEach(function (c) { meta.appendChild(c); });
                body.appendChild(meta);
            }
            card.appendChild(body);
        }

        card.addEventListener('click', function () { lightbox.open(index); });
        if (ns.revealOnScroll) ns.revealOnScroll(card, { delay: (index % 8) * 25 });
        return card;
    }

    /**
     * The image frame: a muted, box-reserving container that settles from a 4:3
     * placeholder to the image's natural ratio on load and fades the image in —
     * the combination that kills the "flash / reflow as it loads" problem.
     * `settle=false` (timeline) keeps a fixed-height frame (CSS controls it).
     */
    function makeFrame(p, settle) {
        var frame = document.createElement('div');
        frame.className = 'photo-card-frame';
        if (settle) frame.style.aspectRatio = '4 / 3';

        var img = document.createElement('img');
        img.className = 'photo-card-img';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.alt = p.title || '';
        img.addEventListener('error', function () { frame.classList.add('is-broken'); });
        img.addEventListener('load', function () {
            if (settle && img.naturalWidth > 0 && img.naturalHeight > 0) {
                frame.style.aspectRatio = img.naturalWidth + ' / ' + img.naturalHeight;
            }
            img.classList.add('is-loaded');
        });
        img.src = p.thumb;
        frame.appendChild(img);
        return frame;
    }

    function chip(iconInner, label) {
        var span = document.createElement('span');
        span.className = 'photo-card-chip';
        span.innerHTML = svg(iconInner, 'photo-chip-icon');
        span.appendChild(document.createTextNode(' ' + label));
        return span;
    }

    /* ------------------------------------------------------------------ */
    /*  Issue grouping (journal collections, e.g. ILAM)                    */
    /* ------------------------------------------------------------------ */

    /** Group photos by volume.issue, in reading order, into card nodes. */
    function buildIssueCards(photos, toc) {
        var groups = {};
        var order = [];
        photos.forEach(function (p) {
            if (p.volume == null || p.issue == null) return;
            var key = p.volume + '.' + p.issue;
            if (!groups[key]) {
                groups[key] = { volume: p.volume, issue: p.issue, year: p.year || null, items: [] };
                order.push(key);
            }
            var g = groups[key];
            g.items.push(p);
            if (g.year == null && p.year != null) g.year = p.year;
        });

        order.sort(function (a, b) {
            return groups[a].volume - groups[b].volume || groups[a].issue - groups[b].issue;
        });

        return order.map(function (key, i) {
            var g = groups[key];
            g.label = 'Vol. ' + g.volume + ' No. ' + g.issue + (g.year ? ' (' + g.year + ')' : '');
            return makeIssueCard(g, i, toc);
        });
    }

    function makeIssueCard(group, index, toc) {
        var rep = group.items[0] || {};
        var card = document.createElement('button');
        card.type = 'button';
        card.className = 'photo-card photo-issue-card';
        card.title = group.label;

        card.appendChild(makeFrame(rep, true));

        var body = document.createElement('div');
        body.className = 'photo-card-body';
        var title = document.createElement('h4');
        title.className = 'photo-card-title';
        title.textContent = group.label;
        body.appendChild(title);
        var sub = document.createElement('p');
        sub.className = 'photo-card-subtitle';
        sub.textContent = group.items.length + (group.items.length === 1 ? ' article' : ' articles');
        body.appendChild(sub);
        card.appendChild(body);

        card.addEventListener('click', function () { if (toc) toc.open(group); });
        if (ns.revealOnScroll) ns.revealOnScroll(card, { delay: (index % 8) * 25 });
        return card;
    }

    /** First page number in a "95-118" range (for TOC ordering); else +∞. */
    function startPage(pages) {
        if (!pages) return Number.POSITIVE_INFINITY;
        var n = parseInt(String(pages).split(/[–-]/)[0], 10);
        return isFinite(n) ? n : Number.POSITIVE_INFINITY;
    }

    /* ------------------------------------------------------------------ */
    /*  Issue table-of-contents modal                                      */
    /* ------------------------------------------------------------------ */

    function makeTocModal(container) {
        var box = document.createElement('div');
        box.className = 'photo-toc';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');
        box.hidden = true;
        box.innerHTML =
            '<div class="photo-toc-backdrop" data-close="1"></div>' +
            '<div class="photo-toc-frame">' +
                '<button type="button" class="photo-toc-close" data-close="1" aria-label="Close">✕</button>' +
                '<aside class="photo-toc-cover"><img alt=""></aside>' +
                '<section class="photo-toc-body">' +
                    '<header class="photo-toc-header">' +
                        '<p class="photo-toc-eyebrow">' + svg(ICON.book, 'photo-toc-eyebrow-icon') + ' Table of contents</p>' +
                        '<h3 class="photo-toc-title"></h3>' +
                        '<p class="photo-toc-count"></p>' +
                    '</header>' +
                    '<ol class="photo-toc-list"></ol>' +
                '</section>' +
            '</div>';
        container.appendChild(box);

        var coverImg = box.querySelector('.photo-toc-cover img');
        var titleEl = box.querySelector('.photo-toc-title');
        var countEl = box.querySelector('.photo-toc-count');
        var listEl = box.querySelector('.photo-toc-list');

        function open(group) {
            var rep = group.items[0] || {};
            coverImg.src = rep.thumb || '';
            coverImg.alt = group.label || '';
            titleEl.textContent = group.label || 'Table of contents';
            countEl.textContent = group.items.length
                + (group.items.length === 1 ? ' article' : ' articles') + ' in this issue.';

            var items = group.items.slice().sort(function (a, b) {
                var pa = startPage(a.pages), pb = startPage(b.pages);
                if (pa !== pb) return pa - pb;
                return (a.title || '').localeCompare(b.title || '');
            });

            listEl.textContent = '';
            items.forEach(function (it) {
                var li = document.createElement('li');
                li.className = 'photo-toc-item';

                var a = document.createElement('a');
                a.className = 'photo-toc-item-link';
                a.href = it.url || '#';

                var main = document.createElement('div');
                main.className = 'photo-toc-item-main';
                var t = document.createElement('p');
                t.className = 'photo-toc-item-title';
                t.textContent = it.title || 'Untitled';
                main.appendChild(t);
                if (it.creator) {
                    var c = document.createElement('p');
                    c.className = 'photo-toc-item-creator';
                    c.textContent = it.creator;
                    main.appendChild(c);
                }
                a.appendChild(main);

                var metaWrap = document.createElement('div');
                metaWrap.className = 'photo-toc-item-meta';
                if (it.pages) {
                    var pg = document.createElement('span');
                    pg.className = 'photo-toc-item-pages';
                    pg.textContent = 'pp. ' + it.pages;
                    metaWrap.appendChild(pg);
                }
                var arr = document.createElement('span');
                arr.className = 'photo-toc-item-arrow';
                arr.innerHTML = svg(ICON.arrow);
                metaWrap.appendChild(arr);
                a.appendChild(metaWrap);

                li.appendChild(a);
                listEl.appendChild(li);
            });

            box.hidden = false;
            document.body.classList.add('photo-lightbox-open');
        }

        function close() {
            box.hidden = true;
            document.body.classList.remove('photo-lightbox-open');
        }

        box.addEventListener('click', function (e) {
            if (e.target.closest('[data-close]')) close();
        });
        document.addEventListener('keydown', function (e) {
            if (!box.hidden && e.key === 'Escape') close();
        });

        return { open: open, close: close };
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
                items.appendChild(makeCard(photos[i], i, lightbox, true));
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
            // High-contrast markers for the near-white Positron (and dark-matter)
            // basemaps. The old cluster fill was --primary-muted — only 12% green
            // mixed into the surface — so on Positron it rendered as a near-white
            // circle carrying white text: invisible. Clusters are now solid,
            // size-graduated green with near-white counts; single photos are
            // warm-accent pins; both get a surface-coloured "moat" ring that lifts
            // them cleanly off the basemap in light and dark.
            var green       = ns.cssColor('--primary', '#007a50');
            var greenDark   = ns.cssColor('--primary-hover', '#00633f');
            var greenDeep   = ns.cssColor('--primary-active', '#004d30');
            var clusterText = ns.cssColor('--primary-contrast', '#ffffff');
            var pointFill   = ns.cssColor('--accent', '#d57912');
            var moat        = ns.cssColor('--surface', '#ffffff');

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
                        'circle-color': ['step', ['get', 'point_count'],
                            green, 25, greenDark, 75, greenDeep],
                        'circle-opacity': 0.92,
                        'circle-stroke-color': moat,
                        'circle-stroke-width': 2.5,
                        'circle-radius': ['step', ['get', 'point_count'], 18, 10, 24, 50, 32]
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
                    paint: {
                        'text-color': clusterText,
                        'text-halo-color': greenDark,
                        'text-halo-width': 1
                    }
                });
                map.addLayer({
                    id: 'points', type: 'circle', source: 'photos',
                    filter: ['!', ['has', 'point_count']],
                    paint: {
                        'circle-color': pointFill,
                        'circle-radius': 7,
                        'circle-stroke-color': moat,
                        'circle-stroke-width': 2.5
                    }
                });

                try {
                    var b = new maplibregl.LngLatBounds();
                    geo.forEach(function (f) { b.extend(f.geometry.coordinates); });
                    if (!b.isEmpty()) {
                        map.fitBounds(b, { padding: 48, maxZoom: 12, duration: 0 });
                    }
                } catch (e) { /* noop */ }
            });

            map.on('click', 'clusters', function (e) {
                var f = map.queryRenderedFeatures(e.point, { layers: ['clusters'] })[0];
                if (!f) return;
                map.getSource('photos').getClusterExpansionZoom(f.properties.cluster_id)
                    .then(function (zoom) {
                        map.easeTo({ center: f.geometry.coordinates, zoom: zoom });
                    }).catch(function () {});
            });
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
            '<button type="button" class="photo-lightbox-close" data-close="1" aria-label="Close">' + svg(ICON.close) + '</button>' +
            '<button type="button" class="photo-lightbox-nav photo-lightbox-prev" data-nav="-1" aria-label="Previous">' + svg(ICON.chevronLeft) + '</button>' +
            '<button type="button" class="photo-lightbox-nav photo-lightbox-next" data-nav="1" aria-label="Next">' + svg(ICON.chevronRight) + '</button>' +
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
        var pushed = false;   // a history entry is parked while the lightbox is open
        var opener = null;    // element to restore focus to on close (a11y)

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
            opener = document.activeElement;
            idx = (i + photos.length) % photos.length;
            render();
            box.hidden = false;
            document.body.classList.add('photo-lightbox-open');
            closeBtn.focus();
            // Park a history entry so the browser Back button / Android back
            // gesture closes the lightbox and stays on the page, instead of
            // navigating away. One entry covers the whole open session — paging
            // with the arrows doesn't add more.
            if (!pushed) {
                try { history.pushState({ rvPhotoLightbox: true }, ''); pushed = true; }
                catch (e) { /* history unavailable — Esc / ✕ still close */ }
            }
        }
        // `fromPop` is true when a popstate (Back) is what closed us — the browser
        // has already removed our entry, so we must NOT call history.back() again.
        function close(fromPop) {
            if (box.hidden) return;
            box.hidden = true;
            document.body.classList.remove('photo-lightbox-open');
            if (pushed && !fromPop) {
                pushed = false;
                try { history.back(); } catch (e) { /* noop */ }
            } else {
                pushed = false;
            }
            if (opener && typeof opener.focus === 'function') {
                try { opener.focus(); } catch (e) { /* noop */ }
            }
            opener = null;
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
        // Back button / gesture: close the open lightbox in place. The entry was
        // already popped by the browser, so pass fromPop so we don't pop twice.
        window.addEventListener('popstate', function () {
            if (!box.hidden) close(true);
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
