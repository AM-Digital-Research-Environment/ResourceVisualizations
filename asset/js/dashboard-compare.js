/**
 * Compare: side-by-side comparison of two entities of the same type.
 *
 * Generic over entity type (projects, people, institutions, subjects,
 * languages). The block sets `data-entity-type` to lock a type; when absent the
 * controller shows an in-page type switcher (the "Compare (any entity)" block).
 * Fetches the matching {type}-index.json for the dropdowns, loads two dashboard
 * JSONs, and renders paired charts + an overlaid radar headline + overlap stats.
 *
 * Depends on:
 *   - dashboard-core.js        (THEME, COLORS, helpers)
 *   - dashboard-registry.js    (CHART_MAP, CHART_LABELS)
 *   - dashboard-compare-unify.js (ns.unifyForComparison)
 */
(function () {
    'use strict';

    var ns = window.RV;
    if (!ns) return;

    /* ------------------------------------------------------------------ */
    /*  Per-entity-type configuration                                      */
    /* ------------------------------------------------------------------ */

    var TYPES = {
        projects: {
            index: 'projects-index.json', label: 'Projects', singular: 'Project',
            charts: [
                { key: 'stackedTimeline', label: 'Items by Year and Type', tall: false },
                { key: 'types',           label: 'Resource Types',         tall: false },
                { key: 'languages',       label: 'Languages',              tall: false },
                { key: 'subjects',        label: 'Subjects',               tall: true  }
            ],
            unifyKeys: ['types', 'languages', 'subjects'],
            overlapKey: 'subjects', overlapLabel: 'Subject', radar: true, grouped: true
        },
        people: {
            index: 'people-index.json', label: 'People', singular: 'Person',
            charts: [
                { key: 'timeline',  label: 'Timeline',       tall: false },
                { key: 'types',     label: 'Resource Types', tall: false },
                { key: 'languages', label: 'Languages',      tall: false },
                { key: 'subjects',  label: 'Subjects',       tall: true  }
            ],
            unifyKeys: ['types', 'languages', 'subjects'],
            overlapKey: 'subjects', overlapLabel: 'Subject', radar: true, grouped: false
        },
        institutions: {
            index: 'institutions-index.json', label: 'Institutions', singular: 'Institution',
            charts: [
                { key: 'timeline',  label: 'Timeline',       tall: false },
                { key: 'types',     label: 'Resource Types', tall: false },
                { key: 'languages', label: 'Languages',      tall: false },
                { key: 'subjects',  label: 'Subjects',       tall: true  }
            ],
            unifyKeys: ['types', 'languages', 'subjects'],
            overlapKey: 'subjects', overlapLabel: 'Subject', radar: true, grouped: false
        },
        subjects: {
            index: 'subjects-index.json', label: 'Subjects', singular: 'Subject',
            charts: [
                { key: 'timeline',   label: 'Timeline',              tall: false },
                { key: 'types',      label: 'Resource Types',        tall: false },
                { key: 'languages',  label: 'Languages',             tall: false },
                { key: 'coSubjects', label: 'Co-occurring Subjects', tall: true  }
            ],
            unifyKeys: ['types', 'languages', 'coSubjects'],
            overlapKey: 'coSubjects', overlapLabel: 'Co-subject', radar: false, grouped: false
        },
        languages: {
            index: 'languages-index.json', label: 'Languages', singular: 'Language',
            charts: [
                { key: 'timeline',     label: 'Timeline',               tall: false },
                { key: 'types',        label: 'Resource Types',         tall: false },
                { key: 'subjects',     label: 'Subjects',               tall: true  },
                { key: 'contributors', label: 'Top Associated Persons', tall: false }
            ],
            unifyKeys: ['types', 'subjects', 'contributors'],
            overlapKey: 'subjects', overlapLabel: 'Subject', radar: false, grouped: false
        }
    };
    var TYPE_ORDER = ['projects', 'people', 'institutions', 'subjects', 'languages'];

    /* ------------------------------------------------------------------ */
    /*  Overlap computation                                                */
    /* ------------------------------------------------------------------ */

    function computeOverlap(leftData, rightData, key) {
        if (!leftData || !rightData) return null;
        var left = extractNames(leftData[key]);
        var right = extractNames(rightData[key]);
        var intersection = left.filter(function (s) { return right.indexOf(s) >= 0; });
        var union = left.slice();
        right.forEach(function (s) { if (union.indexOf(s) < 0) union.push(s); });
        return {
            percentage: union.length ? Math.round(intersection.length / union.length * 100) : 0,
            shared: intersection.slice(0, 12),
            sharedCount: intersection.length,
            totalCount: union.length
        };
    }

    function extractNames(data) {
        if (!data) return [];
        if (Array.isArray(data)) return data.map(function (d) { return d.name || ''; });
        return Object.keys(data);
    }

    /* ------------------------------------------------------------------ */
    /*  UI builders                                                        */
    /* ------------------------------------------------------------------ */

    function buildSwitcher(activeType, onSwitch) {
        var wrap = document.createElement('div');
        wrap.className = 'compare-type-switcher';
        wrap.setAttribute('role', 'group');
        wrap.setAttribute('aria-label', 'Comparison type');
        TYPE_ORDER.forEach(function (t) {
            var isActive = (t === activeType);
            var btn = document.createElement('button');
            btn.type = 'button';
            // A proper icon + label pill — NOT the fixed 2rem icon-button (.rv-btn),
            // which clipped these text labels into overlapping squares.
            btn.className = 'compare-type-btn' + (isActive ? ' is-active' : '');
            btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
            // Lucide icon — reuses the dashboard stat-card icon set (ns.statIconFor),
            // whose alias map already covers institutions → organisations and
            // subjects → subjectsTags. Omitted gracefully if the helper is absent.
            var icon = ns.statIconFor ? ns.statIconFor(t) : '';
            if (icon) {
                btn.innerHTML = '<svg class="compare-type-icon" xmlns="http://www.w3.org/2000/svg"'
                    + ' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"'
                    + ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
                    + icon + '</svg>';
            }
            var span = document.createElement('span');
            span.textContent = TYPES[t].label;
            btn.appendChild(span);
            btn.addEventListener('click', function () { if (t !== activeType) onSwitch(t); });
            wrap.appendChild(btn);
        });
        return wrap;
    }

    function buildSelector(entries, side, cfg, onChange) {
        var wrap = document.createElement('div');
        wrap.className = 'compare-selector';

        var label = document.createElement('label');
        label.textContent = cfg.singular + (side === 'left' ? ' A' : ' B');
        label.className = 'compare-selector-label';

        var select = document.createElement('select');
        select.className = 'compare-select';

        var placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Select a ' + cfg.singular.toLowerCase() + '…';
        placeholder.disabled = true;
        placeholder.selected = true;
        select.appendChild(placeholder);

        function makeOption(p) {
            var opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = truncate(p.name, 70) + ' (' + p.items + ' items)';
            opt.title = p.name;
            return opt;
        }

        if (cfg.grouped) {
            var sections = {};
            entries.forEach(function (p) {
                var sec = (p.sections && p.sections[0]) || 'Other';
                (sections[sec] = sections[sec] || []).push(p);
            });
            Object.keys(sections).sort().forEach(function (sec) {
                var group = document.createElement('optgroup');
                group.label = sec;
                sections[sec].forEach(function (p) { group.appendChild(makeOption(p)); });
                select.appendChild(group);
            });
        } else {
            entries.forEach(function (p) { select.appendChild(makeOption(p)); });
        }

        select.addEventListener('change', function () {
            var id = select.value, entry = null;
            for (var i = 0; i < entries.length; i++) {
                if (String(entries[i].id) === String(id)) { entry = entries[i]; break; }
            }
            onChange(id, entry);
        });

        wrap.appendChild(label);
        wrap.appendChild(select);
        return wrap;
    }

    function buildStatsPanel(leftData, rightData, cfg) {
        var overlap = computeOverlap(leftData, rightData, cfg.overlapKey);
        var html = '<div class="compare-stats">';

        html += '<div class="compare-stat-card">'
            + '<span class="compare-stat-value">' + (leftData ? leftData.totalItems : '—') + '</span>'
            + '<span class="compare-stat-label">Items (A)</span></div>';

        html += '<div class="compare-stat-card">'
            + '<span class="compare-stat-value">' + (rightData ? rightData.totalItems : '—') + '</span>'
            + '<span class="compare-stat-label">Items (B)</span></div>';

        if (overlap) {
            html += '<div class="compare-stat-card compare-stat-accent">'
                + '<span class="compare-stat-value">' + overlap.percentage + '%</span>'
                + '<span class="compare-stat-label">' + cfg.overlapLabel + ' Overlap'
                + '<br><small>' + overlap.sharedCount + ' shared of ' + overlap.totalCount + ' total</small>'
                + '</span></div>';
        }

        html += '</div>';

        if (overlap && overlap.shared.length > 0) {
            html += '<div class="compare-shared">'
                + '<span class="compare-shared-label">Shared ' + cfg.overlapLabel + 's:</span>';
            overlap.shared.forEach(function (s) {
                html += '<span class="compare-badge">' + escapeHtml(s) + '</span>';
            });
            if (overlap.sharedCount > overlap.shared.length) {
                html += '<span class="compare-badge compare-badge-muted">'
                    + '+' + (overlap.sharedCount - overlap.shared.length) + ' more</span>';
            }
            html += '</div>';
        }

        return html;
    }

    /** Overlaid A/B radar panel (same-type entities share normalized axes). */
    function buildRadarHeadline(leftData, rightData, leftName, rightName, siteBase) {
        if (!leftData || !rightData || !leftData.radar || !rightData.radar) return null;
        var lr = leftData.radar, rr = rightData.radar;
        if (!lr.indicator || !lr.indicator.length || !lr.series || !lr.series.length
            || !rr.series || !rr.series.length) return null;

        var combined = {
            indicator: lr.indicator,
            series: [
                { value: lr.series[0].value, name: truncate(leftName, 22) + ' (A)' },
                { value: rr.series[0].value, name: truncate(rightName, 22) + ' (B)' }
            ]
        };

        var panel = document.createElement('div');
        panel.className = 'chart-panel chart-panel-wide compare-radar-panel';
        var h4 = document.createElement('h4');
        h4.textContent = 'Profile';
        panel.appendChild(h4);
        var el = document.createElement('div');
        el.className = 'chart-container chart-container-tall';
        el.setAttribute('data-chart', 'radar');
        panel.appendChild(el);

        pendingCharts.push({ el: el, key: 'radar', data: combined, siteBase: siteBase, panel: panel });
        return panel;
    }

    function buildChartPair(key, label, leftData, rightData, siteBase, tall) {
        var container = document.createElement('div');
        container.className = 'compare-chart-row';
        container.appendChild(buildChartSide(key, label + ' (A)', leftData, siteBase, tall));
        container.appendChild(buildChartSide(key, label + ' (B)', rightData, siteBase, tall));
        return container;
    }

    /** Pending chart inits — deferred until DOM is ready. */
    var pendingCharts = [];

    function buildChartSide(key, label, data, siteBase, tall) {
        var panel = document.createElement('div');
        panel.className = 'chart-panel compare-chart-panel';

        var h4 = document.createElement('h4');
        h4.textContent = label;
        panel.appendChild(h4);

        var chartData = data ? data[key] : null;
        // For stacked timeline, fall back to basic timeline.
        if (!chartData && key === 'stackedTimeline' && data) {
            chartData = data.timeline;
            key = 'timeline';
        }
        var hasData = Array.isArray(chartData) ? chartData.length > 0
            : (chartData && typeof chartData === 'object' && Object.keys(chartData).length > 0);

        if (!hasData) {
            var empty = document.createElement('div');
            empty.className = 'rv-no-data';
            empty.textContent = 'No data';
            panel.appendChild(empty);
            return panel;
        }

        var el = document.createElement('div');
        el.className = 'chart-container' + (tall ? ' chart-container-tall' : '');
        el.setAttribute('data-chart', key);
        panel.appendChild(el);

        pendingCharts.push({ el: el, key: key, data: chartData, siteBase: siteBase, panel: panel });
        return panel;
    }

    function flushPendingCharts() {
        requestAnimationFrame(function () {
            pendingCharts.forEach(function (p) {
                if (ns.CHART_MAP && ns.CHART_MAP[p.key]) {
                    var chart = ns.CHART_MAP[p.key](p.el, p.data, p.siteBase);
                    if (chart) ns.attachToolbar(p.panel, chart);
                }
            });
            pendingCharts = [];
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Helpers                                                            */
    /* ------------------------------------------------------------------ */

    function truncate(str, max) {
        return str && str.length > max ? str.substring(0, max) + '…' : (str || '');
    }

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    /* ------------------------------------------------------------------ */
    /*  Main controller                                                    */
    /* ------------------------------------------------------------------ */

    function initCompare(container) {
        var basePath = container.dataset.basePath || '';
        var siteBase = container.dataset.siteBase || '';
        ns.basePath = basePath; // expose for builders that load module assets
        var moduleBase = basePath + '/modules/ResourceVisualizations/asset/data/item-dashboards/';

        var fixedType = container.dataset.entityType || '';
        var hasSwitcher = !TYPES[fixedType];
        var activeType = TYPES[fixedType] ? fixedType : 'projects';

        container.innerHTML = '<div class="rv-loading"><div class="rv-spinner"></div>'
            + '<span>Loading…</span></div>';
        loadType(activeType);

        function loadType(type) {
            activeType = type;
            var cfg = TYPES[type];
            fetch(moduleBase + cfg.index).then(function (r) {
                if (!r.ok) throw new Error('index not found');
                return r.json();
            }).then(function (entries) {
                renderType(cfg, entries);
            }).catch(function () {
                container.innerHTML = '<div class="rv-error">Could not load '
                    + cfg.label.toLowerCase() + ' data.</div>';
            });
        }

        function renderType(cfg, entries) {
            container.innerHTML = '';
            var leftId = null, rightId = null;
            var leftData = null, rightData = null;
            var leftEntry = null, rightEntry = null;

            var header = document.createElement('div');
            header.className = 'dashboard-header';
            header.innerHTML = '<h3>Compare ' + cfg.label + '</h3>';
            container.appendChild(header);

            if (hasSwitcher) {
                container.appendChild(buildSwitcher(activeType, function (t) { loadType(t); }));
            }

            var selectors = document.createElement('div');
            selectors.className = 'compare-selectors';
            selectors.appendChild(buildSelector(entries, 'left', cfg, function (id, entry) {
                leftId = id; leftEntry = entry;
                fetchDashboard(id, function (data) { leftData = data; renderComparison(); });
            }));
            var vsSpan = document.createElement('span');
            vsSpan.className = 'compare-vs';
            vsSpan.textContent = 'vs';
            selectors.appendChild(vsSpan);
            selectors.appendChild(buildSelector(entries, 'right', cfg, function (id, entry) {
                rightId = id; rightEntry = entry;
                fetchDashboard(id, function (data) { rightData = data; renderComparison(); });
            }));
            container.appendChild(selectors);

            var content = document.createElement('div');
            content.className = 'compare-content';
            container.appendChild(content);
            renderComparison();

            function renderComparison() {
                content.innerHTML = '';
                if (!leftId && !rightId) {
                    content.innerHTML = '<div class="rv-no-data">Select two '
                        + cfg.label.toLowerCase() + ' to compare.</div>';
                    return;
                }
                if (!leftId || !rightId) {
                    content.innerHTML = '<div class="rv-no-data">Select a second '
                        + cfg.singular.toLowerCase() + ' to compare.</div>';
                    return;
                }

                var unify = ns.unifyForComparison;
                var uLeft = leftData ? JSON.parse(JSON.stringify(leftData)) : null;
                var uRight = rightData ? JSON.parse(JSON.stringify(rightData)) : null;
                if (uLeft && uRight && unify) {
                    cfg.unifyKeys.forEach(function (key) {
                        var order = unify.buildUnifiedOrder(uLeft, uRight, key);
                        uLeft = unify.reorderEntries(uLeft, key, order);
                        uRight = unify.reorderEntries(uRight, key, order);
                    });
                    unify.unifyStackedSeries(uLeft, uRight, 'stackedTimeline');
                }

                var statsDiv = document.createElement('div');
                statsDiv.innerHTML = buildStatsPanel(leftData, rightData, cfg);
                content.appendChild(statsDiv);

                pendingCharts = [];

                if (cfg.radar) {
                    var radarPanel = buildRadarHeadline(
                        leftData, rightData,
                        leftEntry ? leftEntry.name : 'A',
                        rightEntry ? rightEntry.name : 'B',
                        siteBase
                    );
                    if (radarPanel) {
                        var radarRow = document.createElement('div');
                        radarRow.className = 'compare-radar-row';
                        radarRow.appendChild(radarPanel);
                        content.appendChild(radarRow);
                    }
                }

                cfg.charts.forEach(function (c) {
                    content.appendChild(buildChartPair(c.key, c.label, uLeft, uRight, siteBase, c.tall));
                });

                flushPendingCharts();
            }
        }

        function fetchDashboard(id, callback) {
            if (!id) { callback(null); return; }
            fetch(moduleBase + id + '.json').then(function (r) {
                if (!r.ok) throw new Error('not found');
                return r.json();
            }).then(callback).catch(function () { callback(null); });
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Init                                                               */
    /* ------------------------------------------------------------------ */

    function init() {
        if (typeof echarts === 'undefined') return;
        var containers = document.querySelectorAll('.compare-container');
        for (var i = 0; i < containers.length; i++) {
            initCompare(containers[i]);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
