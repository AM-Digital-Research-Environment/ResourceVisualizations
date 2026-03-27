/**
 * Dashboard visualizations using ECharts.
 *
 * Supports two data formats:
 * - Object format { name: count } (inline, item-set-dashboard)
 * - Array format [{ name, value, itemId }] (precomputed, section dashboards)
 *
 * Array format enables click-to-navigate on chart elements.
 */
(function () {
    'use strict';

    var COLORS = [
        '#22817b', '#e07c3e', '#6b5b95', '#d4a574', '#2c5f7c',
        '#c5504d', '#4a8c6f', '#8b6f47', '#7c5295', '#cc8963',
        '#5ba3a0', '#d49b6a', '#8e7cb8', '#e6c9a8', '#4a8aab',
        '#d87e7a', '#6fb08e', '#a68e6d', '#9e7bb8', '#e0a88a'
    ];

    /* ------------------------------------------------------------------ */
    /*  Data normalization                                                 */
    /* ------------------------------------------------------------------ */

    /** Convert either format to array of { name, value, itemId? }. */
    function toEntries(data) {
        if (!data) return [];
        if (Array.isArray(data)) return data;
        return Object.keys(data).map(function (k) { return { name: k, value: data[k] }; });
    }

    /* ------------------------------------------------------------------ */
    /*  Chart builders                                                     */
    /* ------------------------------------------------------------------ */

    function addClickHandler(chart, entries, siteBase) {
        if (!siteBase) return;
        chart.on('click', function (params) {
            var entry = entries.find(function (e) { return e.name === params.name; });
            if (entry && entry.itemId) {
                window.location.href = siteBase + '/item/' + entry.itemId;
            }
        });
        chart.getZr().on('mousemove', function (e) {
            chart.getZr().setCursorStyle(e.target ? 'pointer' : 'default');
        });
    }

    function buildTimeline(el, data) {
        var raw = (typeof data === 'object' && !Array.isArray(data)) ? data : null;
        if (!raw || !Object.keys(raw).length) return;
        var chart = echarts.init(el);
        var years = Object.keys(raw).sort();
        var values = years.map(function (y) { return raw[y]; });

        chart.setOption({
            tooltip: { trigger: 'axis', confine: true },
            grid: { left: 50, right: 20, top: 20, bottom: 40 },
            xAxis: {
                type: 'category', data: years,
                axisLabel: { rotate: years.length > 15 ? 45 : 0, fontSize: 11 }
            },
            yAxis: { type: 'value', minInterval: 1 },
            series: [{
                type: 'bar', data: values,
                itemStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: COLORS[0] }, { offset: 1, color: '#b2dfdb' }
                    ]),
                    borderRadius: [3, 3, 0, 0]
                },
                barMaxWidth: 40
            }]
        });
        return chart;
    }

    function buildPieChart(el, data, siteBase) {
        var entries = toEntries(data);
        if (!entries.length) return;
        var chart = echarts.init(el);
        entries.sort(function (a, b) { return b.value - a.value; });

        chart.setOption({
            tooltip: { trigger: 'item', confine: true, formatter: '{b}: {c} ({d}%)' },
            legend: {
                orient: 'vertical', right: 10, top: 'center',
                type: 'scroll', textStyle: { fontSize: 11 }
            },
            series: [{
                type: 'pie', radius: ['35%', '65%'], center: ['40%', '50%'],
                avoidLabelOverlap: true,
                itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 },
                label: { show: false },
                emphasis: { label: { show: true, fontSize: 13, fontWeight: 'bold' } },
                data: entries.map(function (e, i) {
                    return { name: e.name, value: e.value, itemStyle: { color: COLORS[i % COLORS.length] } };
                })
            }]
        });
        addClickHandler(chart, entries, siteBase);
        return chart;
    }

    function buildBarChart(el, data, siteBase) {
        var entries = toEntries(data);
        if (!entries.length) return;
        var chart = echarts.init(el);
        entries.sort(function (a, b) { return a.value - b.value; });
        if (entries.length > 20) entries = entries.slice(entries.length - 20);

        var names = entries.map(function (e) { return e.name; });
        var values = entries.map(function (e) { return e.value; });

        chart.setOption({
            tooltip: { trigger: 'axis', confine: true, axisPointer: { type: 'shadow' } },
            grid: {
                left: Math.min(220, Math.max(80, names.reduce(function (m, n) {
                    return Math.max(m, n.length);
                }, 0) * 6.5)),
                right: 20, top: 10, bottom: 20
            },
            xAxis: { type: 'value', minInterval: 1 },
            yAxis: {
                type: 'category', data: names,
                axisLabel: {
                    fontSize: 11, width: 200, overflow: 'truncate',
                    formatter: function (v) { return v.length > 30 ? v.substring(0, 30) + '\u2026' : v; }
                }
            },
            series: [{
                type: 'bar',
                data: values.map(function (v, i) {
                    return { value: v, itemStyle: { color: COLORS[i % COLORS.length], borderRadius: [0, 3, 3, 0] } };
                }),
                barMaxWidth: 24
            }]
        });
        addClickHandler(chart, entries, siteBase);
        return chart;
    }

    function buildWordCloud(el, data, siteBase) {
        var entries = toEntries(data);
        if (!entries.length) return;
        if (!isWordCloudAvailable()) return buildBarChart(el, data, siteBase);

        var chart = echarts.init(el);

        chart.setOption({
            tooltip: {
                confine: true,
                formatter: function (p) { return echarts.format.encodeHTML(p.name) + ': ' + p.value; }
            },
            series: [{
                type: 'wordCloud', shape: 'circle',
                sizeRange: [12, Math.max(40, Math.min(80, entries.length > 10 ? 60 : 80))],
                rotationRange: [-30, 30], rotationStep: 15, gridSize: 8,
                drawOutOfBound: false, layoutAnimation: true,
                textStyle: {
                    fontFamily: 'sans-serif',
                    color: function () { return COLORS[Math.floor(Math.random() * COLORS.length)]; }
                },
                emphasis: { textStyle: { fontWeight: 'bold', shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.3)' } },
                data: entries.map(function (e) { return { name: e.name, value: e.value }; })
            }]
        });
        addClickHandler(chart, entries, siteBase);
        return chart;
    }

    /* ------------------------------------------------------------------ */
    /*  Map (MapLibre GL)                                                  */
    /* ------------------------------------------------------------------ */

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
                var title = it.title.length > 55 ? it.title.substring(0, 55) + '\u2026' : it.title;
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

    function buildMap(el, data, siteBase) {
        if (!data || !data.length || typeof maplibregl === 'undefined') return null;

        el.style.borderRadius = '6px';
        var map = new maplibregl.Map({
            container: el,
            style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
            center: [0, 15],
            zoom: 1.5,
            attributionControl: false,
        });
        map.addControl(new maplibregl.NavigationControl(), 'top-right');
        map.addControl(new maplibregl.AttributionControl({ compact: true, collapsed: true }), 'bottom-right');

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

            // Cluster circles.
            map.addLayer({
                id: 'clusters',
                type: 'circle',
                source: 'locations',
                filter: ['has', 'point_count'],
                paint: {
                    'circle-color': ['step', ['get', 'point_count'], '#22817b', 10, '#e07c3e', 30, '#c5504d'],
                    'circle-radius': ['step', ['get', 'point_count'], 18, 10, 24, 30, 32],
                    'circle-stroke-width': 2,
                    'circle-stroke-color': '#fff',
                }
            });

            // Cluster count labels.
            map.addLayer({
                id: 'cluster-count',
                type: 'symbol',
                source: 'locations',
                filter: ['has', 'point_count'],
                layout: {
                    'text-field': '{point_count_abbreviated}',
                    'text-size': 12,
                },
                paint: { 'text-color': '#fff' }
            });

            // Individual points — size by item count.
            map.addLayer({
                id: 'points',
                type: 'circle',
                source: 'locations',
                filter: ['!', ['has', 'point_count']],
                paint: {
                    'circle-color': '#22817b',
                    'circle-radius': ['interpolate', ['linear'], ['get', 'value'], 1, 7, 50, 18, 200, 28],
                    'circle-stroke-width': 2,
                    'circle-stroke-color': '#fff',
                    'circle-opacity': 0.85,
                }
            });

            // Point labels.
            map.addLayer({
                id: 'point-labels',
                type: 'symbol',
                source: 'locations',
                filter: ['!', ['has', 'point_count']],
                layout: {
                    'text-field': '{name}',
                    'text-size': 11,
                    'text-offset': [0, 1.8],
                    'text-anchor': 'top',
                },
                paint: {
                    'text-color': '#333',
                    'text-halo-color': '#fff',
                    'text-halo-width': 1.5,
                }
            });

            // Build a lookup for location items from the raw data.
            var locationItems = {};
            data.forEach(function (loc) {
                if (loc.items && loc.items.length) {
                    locationItems[loc.name] = loc.items;
                }
            });

            // Popups on point click — show paginated item list.
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
                    var buttons = el.querySelectorAll('[data-page]');
                    buttons.forEach(function (btn) {
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

            // Zoom into cluster on click.
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

            // Fit bounds to data.
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
    }

    var _wordCloudOk = null;
    function isWordCloudAvailable() {
        if (_wordCloudOk !== null) return _wordCloudOk;
        try {
            var d = document.createElement('div');
            d.style.cssText = 'width:1px;height:1px;position:absolute;left:-9999px';
            document.body.appendChild(d);
            var c = echarts.init(d);
            c.setOption({ series: [{ type: 'wordCloud', data: [{ name: 'x', value: 1 }] }] });
            c.dispose(); document.body.removeChild(d);
            _wordCloudOk = true;
        } catch (e) { _wordCloudOk = false; }
        return _wordCloudOk;
    }

    /* ------------------------------------------------------------------ */
    /*  Chart config                                                       */
    /* ------------------------------------------------------------------ */

    function buildMiniMap(el, data, siteBase) {
        if (!data || !data.lat || typeof maplibregl === 'undefined') return null;
        el.style.borderRadius = '6px';
        var map = new maplibregl.Map({
            container: el,
            style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
            center: [data.lon, data.lat],
            zoom: 4,
            attributionControl: false,
        });
        map.addControl(new maplibregl.NavigationControl(), 'top-right');
        new maplibregl.Marker({ color: '#22817b' })
            .setLngLat([data.lon, data.lat])
            .setPopup(new maplibregl.Popup({ offset: 12 }).setHTML('<strong>' + (data.name || '') + '</strong>'))
            .addTo(map);
        return { resize: function () { map.resize(); } };
    }

    var CHART_MAP = {
        'selfLocation': buildMiniMap,
        'timeline': buildTimeline,
        'types': buildPieChart,
        'locations': buildMap,
        'languages': buildBarChart,
        'subjects': buildWordCloud,
        'contributors': buildBarChart,
        'coAuthors': buildBarChart,
        'coSubjects': buildBarChart,
        'projects': buildBarChart
    };

    var CHART_LABELS = {
        'selfLocation': 'Location',
        'timeline': 'Timeline',
        'types': 'Resource Types',
        'languages': 'Languages',
        'subjects': 'Subjects',
        'contributors': 'Top Associated Persons',
        'locations': 'Geographic Origins',
        'coAuthors': 'Co-authors',
        'coSubjects': 'Co-occurring Subjects',
        'projects': 'Items per Project'
    };

    var CHART_DESCRIPTIONS = {
        'timeline': 'Number of research items collected per year.',
        'types': 'Distribution of items by resource type (audio, text, image, etc.).',
        'languages': 'Languages represented across all research items.',
        'subjects': 'Most frequent subject keywords across all items.',
        'selfLocation': '',
        'locations': 'Geographic origins of research items, sized by number of items.',
        'contributors': 'Persons most frequently associated with research items.',
        'coAuthors': 'Persons who most frequently appear alongside this person.',
        'coSubjects': 'Subjects that most frequently appear alongside this one.',
        'projects': 'Number of research items collected per project in this section.'
    };

    /* ------------------------------------------------------------------ */
    /*  Render dashboard                                                   */
    /* ------------------------------------------------------------------ */

    function renderDashboard(container, data, siteBase) {
        var html = '<div class="dashboard-header">'
            + '<h3>Visualizations</h3>'
            + '<span class="dashboard-total">' + (data.totalItems || 0) + ' items</span>'
            + '</div>'
            + '<div class="dashboard-charts">';

        var chartKeys = ['selfLocation', 'timeline', 'types', 'locations', 'languages', 'subjects', 'contributors', 'coAuthors', 'coSubjects', 'projects'];
        chartKeys.forEach(function (key) {
            var d = data[key];
            var hasData = Array.isArray(d) ? d.length > 0 : (d && Object.keys(d).length > 0);
            if (!hasData) return;
            var wideKeys = ['selfLocation', 'subjects', 'locations', 'projects', 'coSubjects'];
            var tallKeys = ['selfLocation', 'subjects', 'locations'];
            var wide = wideKeys.indexOf(key) >= 0 ? ' chart-panel-wide' : '';
            var tall = tallKeys.indexOf(key) >= 0 ? ' chart-container-tall' : '';
            var desc = CHART_DESCRIPTIONS[key] || '';
            html += '<div class="chart-panel' + wide + '">'
                + '<h4>' + (CHART_LABELS[key] || key) + '</h4>'
                + (desc ? '<p class="chart-description">' + desc + '</p>' : '')
                + '<div class="chart-container' + tall + '" data-chart="' + key + '"></div>'
                + '</div>';
        });
        html += '</div>';
        container.innerHTML = html;

        var charts = [];
        chartKeys.forEach(function (key) {
            var el = container.querySelector('[data-chart="' + key + '"]');
            if (el && data[key] && CHART_MAP[key]) {
                var chart = CHART_MAP[key](el, data[key], siteBase);
                if (chart) charts.push(chart);
            }
        });

        var timer;
        window.addEventListener('resize', function () {
            clearTimeout(timer);
            timer = setTimeout(function () { charts.forEach(function (c) { c.resize(); }); }, 100);
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Async dashboard (precomputed JSON)                                 */
    /* ------------------------------------------------------------------ */

    function initAsyncDashboard(container) {
        var itemId = container.dataset.itemId;
        var basePath = container.dataset.basePath || '';
        var siteBase = container.dataset.siteBase || '';
        var moduleBase = basePath + '/modules/ResourceVisualizations/asset/data/';
        var url = moduleBase + 'item-dashboards/' + itemId + '.json';

        fetch(url).then(function (r) {
            if (!r.ok) throw new Error('not found');
            return r.json();
        }).then(function (data) {
            if (!data || !data.totalItems) { container.innerHTML = ''; return; }
            container.innerHTML = '';
            renderDashboard(container, data, siteBase);
        }).catch(function () { container.innerHTML = ''; });
    }

    /* ------------------------------------------------------------------ */
    /*  Inline dashboard (data-dashboard attribute)                        */
    /* ------------------------------------------------------------------ */

    function initInlineDashboard(container) {
        var raw = container.getAttribute('data-dashboard');
        if (!raw) return;
        var data;
        try { data = JSON.parse(raw); } catch (e) { return; }
        var siteBase = container.dataset.siteBase || '';
        renderDashboard(container.parentElement || container, data, siteBase);
    }

    /* ------------------------------------------------------------------ */
    /*  Init                                                               */
    /* ------------------------------------------------------------------ */

    function init() {
        if (typeof echarts === 'undefined') return;
        var async = document.querySelectorAll('.dashboard-async-container');
        for (var i = 0; i < async.length; i++) initAsyncDashboard(async[i]);
        var inline = document.querySelectorAll('.dashboard-container');
        for (var j = 0; j < inline.length; j++) initInlineDashboard(inline[j]);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
