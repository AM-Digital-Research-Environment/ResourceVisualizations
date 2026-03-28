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
    /*  Shared chart config                                                */
    /* ------------------------------------------------------------------ */

    /** Shared design tokens for consistent appearance across all charts. */
    var THEME = {
        /** Set to true to enable automatic dark mode via prefers-color-scheme. */
        darkModeEnabled: false,
        accent: '#22817b',
        accentDark: '#4db6ac',
        accentLight: '#b2dfdb',
        gradientEnd: '#b2dfdb',
        text: '#333',
        textMuted: '#666',
        border: '#fff',
        fontSize: 11,
        fontSizeEmphasis: 13,
        labelMaxLen: 30,
        barMaxWidth: 24,
        barMaxWidthWide: 40
    };

    /** Attach HTML-level save/reset toolbar to a chart panel. */
    function attachToolbar(panel, chart) {
        if (!chart || !chart.getDataURL) return;
        var bar = document.createElement('span');
        bar.className = 'rv-chart-toolbar';
        bar.innerHTML = '<button type="button" class="rv-toolbar-btn" data-action="save" title="Save as image">'
            + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'
            + '</button>';
        var h4 = panel.querySelector('h4');
        if (h4) h4.appendChild(bar);
        bar.addEventListener('click', function (e) {
            var btn = e.target.closest('[data-action]');
            if (!btn) return;
            if (btn.dataset.action === 'save') {
                var url = chart.getDataURL({ pixelRatio: 2, backgroundColor: '#fff' });
                var a = document.createElement('a');
                a.href = url;
                a.download = (panel.querySelector('h4').textContent || 'chart').trim() + '.png';
                a.click();
            }
        });
    }

    /** Dark mode detection (gated by THEME.darkModeEnabled). */
    var _darkQuery = THEME.darkModeEnabled && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    var _darkMode = _darkQuery ? _darkQuery.matches : false;
    var _allCharts = [];

    /** Init an ECharts instance with the correct theme, tracking it for dark mode switches. */
    function initChart(el) {
        var chart = echarts.init(el, _darkMode ? 'dark' : null);
        _allCharts.push(chart);
        return chart;
    }

    /** Get the appropriate basemap style URL for the current color scheme. */
    function getBasemapStyle() {
        return _darkMode
            ? 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
            : 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
    }

    /** Build a dataZoom config (slider + scroll) for timeline-type charts. */
    function buildDataZoom(count) {
        if (count <= 15) return [];
        return [
            { type: 'slider', start: 0, end: 100, bottom: 8, height: 22 },
            { type: 'inside' }
        ];
    }

    /* ------------------------------------------------------------------ */
    /*  Data normalization                                                 */
    /* ------------------------------------------------------------------ */

    /** Truncate a string with ellipsis if it exceeds maxLen. */
    function truncateLabel(str, maxLen) {
        if (!str) return '';
        return str.length > maxLen ? str.substring(0, maxLen) + '\u2026' : str;
    }

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
        var chart = initChart(el);
        var years = Object.keys(raw).sort();
        var values = years.map(function (y) { return raw[y]; });

        var zoom = buildDataZoom(years.length);
        chart.setOption({
            tooltip: { trigger: 'axis', confine: true },

            aria: { enabled: true },
            dataZoom: zoom,
            grid: { left: 50, right: 20, top: 20, bottom: zoom.length ? 60 : 40 },
            xAxis: {
                type: 'category', data: years,
                axisLabel: { rotate: years.length > 15 ? 45 : 0, fontSize: THEME.fontSize }
            },
            yAxis: { type: 'value', minInterval: 1 },
            series: [{
                type: 'bar', data: values,
                itemStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: COLORS[0] }, { offset: 1, color: THEME.gradientEnd }
                    ]),
                    borderRadius: [3, 3, 0, 0]
                },
                barMaxWidth: THEME.barMaxWidthWide
            }]
        });
        return chart;
    }

    function buildPieChart(el, data, siteBase) {
        var entries = toEntries(data);
        if (!entries.length) return;
        var chart = initChart(el);
        entries.sort(function (a, b) { return b.value - a.value; });

        chart.setOption({
            tooltip: { trigger: 'item', confine: true, formatter: '{b}: {c} ({d}%)' },

            aria: { enabled: true, decal: { show: true } },
            legend: {
                orient: 'vertical', right: 10, top: 'center',
                type: 'scroll', textStyle: { fontSize: THEME.fontSize }
            },
            series: [{
                type: 'pie', radius: ['35%', '65%'], center: ['40%', '50%'],
                avoidLabelOverlap: true,
                itemStyle: { borderRadius: 4, borderColor: THEME.border, borderWidth: 2 },
                label: { show: false },
                emphasis: { label: { show: true, fontSize: THEME.fontSizeEmphasis, fontWeight: 'bold' } },
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
        var chart = initChart(el);
        // Sort ascending, then keep only the top 20 (last 20 after asc sort) for readability.
        entries.sort(function (a, b) { return a.value - b.value; });
        if (entries.length > 20) entries = entries.slice(entries.length - 20);

        var names = entries.map(function (e) { return e.name; });
        var values = entries.map(function (e) { return e.value; });

        chart.setOption({
            tooltip: { trigger: 'axis', confine: true, axisPointer: { type: 'shadow' } },

            aria: { enabled: true },
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
                    fontSize: THEME.fontSize, width: 200, overflow: 'truncate',
                    formatter: function (v) { return truncateLabel(v, THEME.labelMaxLen); }
                }
            },
            series: [{
                type: 'bar',
                data: values.map(function (v, i) {
                    return { value: v, itemStyle: { color: COLORS[i % COLORS.length], borderRadius: [0, 3, 3, 0] } };
                }),
                barMaxWidth: THEME.barMaxWidth
            }]
        });
        addClickHandler(chart, entries, siteBase);
        return chart;
    }

    function buildWordCloud(el, data, siteBase) {
        var entries = toEntries(data);
        if (!entries.length) return;
        if (!isWordCloudAvailable()) return buildBarChart(el, data, siteBase);

        var chart = initChart(el);

        chart.setOption({
            tooltip: {
                confine: true,
                formatter: function (p) { return echarts.format.encodeHTML(p.name) + ': ' + p.value; }
            },

            aria: { enabled: true },
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

    function buildMap(el, data, siteBase) {
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
        map.addControl(new maplibregl.AttributionControl({ compact: true, collapsed: true }), 'bottom-right');

        map.on('load', function () {
            if (map.setProjection) map.setProjection({ type: 'globe' });

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
                    'circle-color': ['step', ['get', 'point_count'], COLORS[0], 10, COLORS[1], 30, COLORS[5]],
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
                    'circle-color': THEME.accent,
                    'circle-radius': ['interpolate', ['linear'], ['get', 'value'], 1, 7, 50, 18, 200, 28],
                    'circle-stroke-width': 2,
                    'circle-stroke-color': '#fff',
                    'circle-opacity': 0.85,
                }
            });

            // Point labels — adapt to dark mode.
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
                    'text-color': THEME.text,
                    'text-halo-color': THEME.border,
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

    /* ------------------------------------------------------------------ */
    /*  Phase 2 charts: Gantt, Heatmap, Chord                             */
    /* ------------------------------------------------------------------ */

    function buildGantt(el, data, siteBase) {
        if (!data || !data.length) return;
        var chart = initChart(el);
        var projects = data.slice().reverse();
        var names = projects.map(function (p) { return p.name; });
        var minYear = 9999, maxYear = 0;

        var barData = projects.map(function (p, i) {
            var start = new Date(p.start).getTime();
            var end = new Date(p.end).getTime();
            var sy = new Date(p.start).getFullYear();
            var ey = new Date(p.end).getFullYear();
            if (sy < minYear) minYear = sy;
            if (ey > maxYear) maxYear = ey;
            return {
                name: p.name, value: [i, start, end, p.itemId],
                itemStyle: { color: COLORS[i % COLORS.length], borderRadius: 3 }
            };
        });

        chart.setOption({
            tooltip: {
                confine: true,
                formatter: function (params) {
                    var v = params.value;
                    var s = new Date(v[1]).toLocaleDateString('en', { year: 'numeric', month: 'short' });
                    var e = new Date(v[2]).toLocaleDateString('en', { year: 'numeric', month: 'short' });
                    return '<strong>' + echarts.format.encodeHTML(params.name) + '</strong><br/>' + s + ' \u2192 ' + e;
                }
            },

            aria: { enabled: true },
            grid: { left: 220, right: 30, top: 10, bottom: 30 },
            xAxis: {
                type: 'time',
                min: new Date(minYear, 0, 1).getTime(),
                max: new Date(maxYear + 1, 0, 1).getTime(),
                axisLabel: { fontSize: THEME.fontSize }
            },
            yAxis: {
                type: 'category', data: names,
                axisLabel: {
                    fontSize: THEME.fontSize, width: 200, overflow: 'truncate',
                    formatter: function (v) { return truncateLabel(v, 28); }
                }
            },
            series: [{
                type: 'custom',
                renderItem: function (params, api) {
                    var catIdx = api.value(0);
                    var start = api.coord([api.value(1), catIdx]);
                    var end = api.coord([api.value(2), catIdx]);
                    var height = api.size([0, 1])[1] * 0.6;
                    return {
                        type: 'rect', shape: { x: start[0], y: start[1] - height / 2, width: end[0] - start[0], height: height },
                        style: api.style()
                    };
                },
                encode: { x: [1, 2], y: 0 },
                data: barData
            }]
        });

        chart.on('click', function (p) {
            if (p.value && p.value[3] && siteBase) window.location.href = siteBase + '/item/' + p.value[3];
        });
        return chart;
    }

    function buildHeatmap(el, data) {
        if (!data || !data.rows || !data.cols || !data.values) return;
        var chart = initChart(el);
        var maxVal = 0;
        data.values.forEach(function (v) { if (v[2] > maxVal) maxVal = v[2]; });

        chart.setOption({
            tooltip: {
                confine: true,
                formatter: function (p) {
                    return echarts.format.encodeHTML(data.rows[p.value[1]]) + ' \u00d7 '
                        + echarts.format.encodeHTML(data.cols[p.value[0]]) + ': ' + p.value[2];
                }
            },

            aria: { enabled: true },
            grid: { left: 120, right: 60, top: 10, bottom: 80 },
            xAxis: {
                type: 'category', data: data.cols, splitArea: { show: true },
                axisLabel: { rotate: 35, fontSize: THEME.fontSize, formatter: function (v) { return truncateLabel(v, 15); } }
            },
            yAxis: {
                type: 'category', data: data.rows, splitArea: { show: true },
                axisLabel: { fontSize: THEME.fontSize, formatter: function (v) { return truncateLabel(v, 15); } }
            },
            visualMap: {
                min: 0, max: maxVal || 1, calculable: true, orient: 'vertical', right: 0, top: 'center',
                inRange: { color: ['#f0f9e8', '#bae4bc', '#7bccc4', '#43a2ca', '#0868ac'] }
            },
            series: [{
                type: 'heatmap', data: data.values,
                label: { show: true, fontSize: 10 },
                emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.3)' } }
            }]
        });
        return chart;
    }

    function buildChord(el, data, siteBase) {
        if (!data || !data.nodes || !data.links || data.nodes.length < 2) return;
        var chart = initChart(el);

        chart.setOption({
            tooltip: {
                confine: true,
                formatter: function (p) {
                    if (p.dataType === 'node') return '<strong>' + echarts.format.encodeHTML(p.name) + '</strong>';
                    if (p.dataType === 'edge') {
                        return echarts.format.encodeHTML(p.data.source) + ' \u2194 '
                            + echarts.format.encodeHTML(p.data.target) + ': ' + p.data.value;
                    }
                    return '';
                }
            },

            aria: { enabled: true },
            series: [{
                type: 'graph', layout: 'circular', circular: { rotateLabel: true },
                data: data.nodes.map(function (n, i) {
                    return {
                        name: n.name, symbolSize: Math.max(10, Math.min(40, n.value * 2)),
                        itemStyle: { color: COLORS[i % COLORS.length] },
                        itemId: n.itemId,
                        label: { fontSize: THEME.fontSize - 1, formatter: function (p) { return truncateLabel(p.name, 20); } }
                    };
                }),
                links: data.links.map(function (l) {
                    return {
                        source: l.source, target: l.target, value: l.value,
                        lineStyle: { width: Math.max(1, Math.min(6, l.value)), curveness: 0.3, opacity: 0.5 }
                    };
                }),
                roam: true, label: { show: true, position: 'right' },
                emphasis: { focus: 'adjacency', lineStyle: { width: 4, opacity: 0.9 } }
            }]
        });

        chart.on('click', function (p) {
            if (p.dataType === 'node' && p.data.itemId && siteBase) window.location.href = siteBase + '/item/' + p.data.itemId;
        });
        return chart;
    }

    /* ------------------------------------------------------------------ */
    /*  Phase 3 charts: Sankey, Sunburst, Stacked Timeline                 */
    /* ------------------------------------------------------------------ */

    function buildSankey(el, data) {
        if (!data || !data.nodes || !data.links || data.links.length < 1) return;
        var chart = initChart(el);

        chart.setOption({
            tooltip: { trigger: 'item', confine: true },

            aria: { enabled: true, decal: { show: true } },
            series: [{
                type: 'sankey', layout: 'none',
                emphasis: { focus: 'adjacency' },
                nodeAlign: 'left', orient: 'horizontal',
                nodeWidth: 20, nodeGap: 10,
                lineStyle: { color: 'gradient', curveness: 0.5, opacity: 0.4 },
                label: {
                    fontSize: THEME.fontSize,
                    formatter: function (p) { return truncateLabel(p.name, 25); }
                },
                data: data.nodes.map(function (n, i) {
                    return { name: n.name, itemStyle: { color: COLORS[i % COLORS.length] } };
                }),
                links: data.links
            }]
        });
        return chart;
    }

    function buildSunburst(el, data) {
        if (!data || !data.length) return;
        var chart = initChart(el);

        chart.setOption({
            tooltip: { confine: true },

            aria: { enabled: true, decal: { show: true } },
            series: [{
                type: 'sunburst',
                data: data,
                radius: ['10%', '90%'],
                sort: null,
                emphasis: { focus: 'ancestor' },
                levels: [
                    {},
                    { r0: '10%', r: '40%', label: { fontSize: THEME.fontSize, rotate: 'tangential' }, itemStyle: { borderWidth: 2 } },
                    { r0: '40%', r: '65%', label: { fontSize: THEME.fontSize - 1, rotate: 'tangential' }, itemStyle: { borderWidth: 1 } },
                    { r0: '65%', r: '90%', label: { show: false }, itemStyle: { borderWidth: 0.5 } }
                ]
            }]
        });
        return chart;
    }

    function buildStackedTimeline(el, data) {
        if (!data || !data.years || !data.series) return;
        var chart = initChart(el);

        var series = data.series.map(function (s, i) {
            return {
                name: s.name, type: 'bar', stack: 'total',
                data: s.data,
                itemStyle: { color: COLORS[i % COLORS.length] },
                emphasis: { focus: 'series' }
            };
        });

        var zoom = buildDataZoom(data.years.length);
        chart.setOption({
            tooltip: { trigger: 'axis', confine: true },

            aria: { enabled: true, decal: { show: true } },
            dataZoom: zoom,
            legend: { bottom: zoom.length ? 40 : 5, textStyle: { fontSize: THEME.fontSize }, type: 'scroll' },
            grid: { left: 50, right: 20, top: 20, bottom: zoom.length ? 85 : 55 },
            xAxis: {
                type: 'category', data: data.years,
                axisLabel: { rotate: data.years.length > 15 ? 45 : 0, fontSize: THEME.fontSize }
            },
            yAxis: { type: 'value', minInterval: 1 },
            series: series
        });
        return chart;
    }

    function buildMiniMap(el, data, siteBase) {
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
    }

    var CHART_MAP = {
        'selfLocation': buildMiniMap,
        'stackedTimeline': buildStackedTimeline,
        'timeline': buildTimeline,
        'gantt': buildGantt,
        'types': buildPieChart,
        'heatmap': buildHeatmap,
        'sankey': buildSankey,
        'sunburst': buildSunburst,
        'locations': buildMap,
        'languages': buildBarChart,
        'subjects': buildWordCloud,
        'chord': buildChord,
        'contributors': buildBarChart,
        'coAuthors': buildBarChart,
        'coSubjects': buildBarChart,
        'projects': buildBarChart
    };

    var CHART_LABELS = {
        'selfLocation': 'Location',
        'stackedTimeline': 'Items by Year and Type',
        'timeline': 'Timeline',
        'gantt': 'Project Timelines',
        'types': 'Resource Types',
        'heatmap': 'Resource Type \u00d7 Language',
        'languages': 'Languages',
        'subjects': 'Subjects',
        'chord': 'Subject Co-occurrence',
        'contributors': 'Top Associated Persons',
        'sankey': 'Contributor \u2192 Project \u2192 Type',
        'sunburst': 'Type \u2192 Language \u2192 Subject',
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
        'stackedTimeline': 'Items per year, broken down by resource type.',
        'gantt': 'Duration of each project within this research section.',
        'heatmap': 'Cross-tabulation showing item counts for each type-language combination.',
        'sankey': 'Flow from contributors through projects to resource types.',
        'sunburst': 'Hierarchical view: resource type, then language, then top subjects.',
        'locations': 'Geographic origins of research items, sized by number of items.',
        'chord': 'Subjects that frequently appear together across research items.',
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

        var chartKeys = ['selfLocation', 'stackedTimeline', 'timeline', 'gantt', 'types', 'languages', 'heatmap', 'subjects', 'sunburst', 'locations', 'chord', 'contributors', 'coAuthors', 'coSubjects', 'projects', 'sankey'];
        chartKeys.forEach(function (key) {
            var d = data[key];
            var hasData = Array.isArray(d) ? d.length > 0 : (d && Object.keys(d).length > 0);
            if (!hasData) return;
            // Skip basic timeline when stacked timeline is available (redundant).
            if (key === 'timeline' && data.stackedTimeline && data.stackedTimeline.years && data.stackedTimeline.years.length > 0) return;
            var wideKeys = ['selfLocation', 'stackedTimeline', 'gantt', 'heatmap', 'sankey', 'sunburst', 'subjects', 'locations', 'chord', 'projects', 'coSubjects'];
            var tallKeys = ['selfLocation', 'gantt', 'heatmap', 'sankey', 'sunburst', 'subjects', 'locations', 'chord'];
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
                if (chart) {
                    charts.push(chart);
                    attachToolbar(el.closest('.chart-panel'), chart);
                }
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

    /* ------------------------------------------------------------------ */
    /*  Dark mode: switch ECharts theme when OS preference changes          */
    /* ------------------------------------------------------------------ */

    if (_darkQuery) {
        // Apply initial dark mode class if needed.
        if (_darkMode) document.documentElement.classList.add('rv-dark-mode');
        _darkQuery.addEventListener('change', function () {
            _darkMode = _darkQuery.matches;
            document.documentElement.classList.toggle('rv-dark-mode', _darkMode);
            var theme = _darkMode ? 'dark' : 'default';
            _allCharts.forEach(function (c) {
                if (!c.isDisposed()) c.setTheme(theme);
            });
        });
    }
})();
