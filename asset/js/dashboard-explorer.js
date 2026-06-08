/**
 * Project Explorer: one selector retunes the full project dashboard beneath it.
 *
 * Loads projects-index.json, renders a section-grouped selector, and on change
 * lazy-loads item-dashboards/{id}.json and renders it via ns.renderInto (the
 * shared item-page render loop). Deep-links via ?project=ID.
 *
 * Depends on:
 *   - dashboard-core.js     (helpers, basePath)
 *   - dashboard-registry.js (CHART_MAP, labels, descriptions)
 *   - dashboard.js          (ns.renderInto — the shared render loop)
 */
(function () {
    'use strict';

    var ns = window.RV;
    if (!ns) return;

    function truncate(str, max) {
        return str && str.length > max ? str.substring(0, max) + '…' : (str || '');
    }

    function buildSelector(projects, selectedId, onChange) {
        var wrap = document.createElement('div');
        wrap.className = 'explorer-selector';

        var label = document.createElement('label');
        label.className = 'explorer-selector-label';
        label.textContent = 'Project';

        var select = document.createElement('select');
        select.className = 'compare-select explorer-select';

        var placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Select a project…';
        placeholder.disabled = true;
        if (!selectedId) placeholder.selected = true;
        select.appendChild(placeholder);

        // Group by research section (falls back to "Other").
        var sections = {};
        projects.forEach(function (p) {
            var sec = (p.sections && p.sections[0]) || 'Other';
            (sections[sec] = sections[sec] || []).push(p);
        });
        Object.keys(sections).sort().forEach(function (sec) {
            var group = document.createElement('optgroup');
            group.label = sec;
            sections[sec].forEach(function (p) {
                var opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = truncate(p.name, 70) + ' (' + p.items + ' items)';
                opt.title = p.name;
                if (String(p.id) === String(selectedId)) opt.selected = true;
                group.appendChild(opt);
            });
            select.appendChild(group);
        });

        label.appendChild(select);
        select.addEventListener('change', function () { onChange(select.value); });
        wrap.appendChild(label);
        return wrap;
    }

    function initExplorer(container) {
        var basePath = container.dataset.basePath || '';
        var siteBase = container.dataset.siteBase || '';
        ns.basePath = basePath; // expose for builders that load module assets
        var moduleBase = basePath + '/modules/DreVisualizations/asset/data/item-dashboards/';

        function readParam() {
            try { return new URLSearchParams(window.location.search).get('project'); }
            catch (e) { return null; }
        }
        function writeParam(id) {
            try {
                var u = new URL(window.location.href);
                if (id) { u.searchParams.set('project', id); } else { u.searchParams.delete('project'); }
                history.replaceState(null, '', u.toString());
            } catch (e) { /* no-op */ }
        }

        var selectedId = readParam();

        fetch(moduleBase + 'projects-index.json').then(function (r) {
            if (!r.ok) throw new Error('Project index not found');
            return r.json();
        }).then(function (projects) {
            container.innerHTML = '';

            var header = document.createElement('div');
            header.className = 'dashboard-header';
            header.innerHTML = '<h3>Project Explorer</h3>';
            container.appendChild(header);

            var controls = document.createElement('div');
            controls.className = 'explorer-controls';
            controls.appendChild(buildSelector(projects, selectedId, function (id) {
                selectedId = id;
                writeParam(id);
                load(id);
            }));
            container.appendChild(controls);

            var content = document.createElement('div');
            content.className = 'explorer-content';
            container.appendChild(content);

            function load(id) {
                if (!id) return;
                content.innerHTML = '<div class="rv-loading"><div class="rv-spinner"></div>'
                    + '<span>Loading…</span></div>';
                fetch(moduleBase + id + '.json').then(function (r) {
                    if (!r.ok) throw new Error('not found');
                    return r.json();
                }).then(function (data) {
                    content.innerHTML = '';
                    if (!data || !data.totalItems) {
                        content.innerHTML = '<div class="rv-no-data">No data for this project.</div>';
                        return;
                    }
                    ns.renderInto(content, data, siteBase);
                }).catch(function () {
                    content.innerHTML = '<div class="rv-error">Could not load this project.</div>';
                });
            }

            var exists = selectedId && projects.some(function (p) {
                return String(p.id) === String(selectedId);
            });
            if (exists) {
                load(selectedId);
            } else {
                content.innerHTML = '<div class="rv-no-data">'
                    + 'Select a project to explore its visualisations.</div>';
            }
        }).catch(function () {
            container.innerHTML = '<div class="rv-error">Could not load project data.</div>';
        });
    }

    function init() {
        if (typeof echarts === 'undefined') return;
        var containers = document.querySelectorAll('.dashboard-explorer-container');
        for (var i = 0; i < containers.length; i++) initExplorer(containers[i]);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
