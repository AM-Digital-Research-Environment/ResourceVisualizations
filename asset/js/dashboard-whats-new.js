/**
 * What's New controller: recent additions + most-active projects, with a
 * 3/6/12-month window selector. Loads item-dashboards/whats-new.json.
 *
 * Depends on: dashboard-core.js, dashboard-registry.js (CHART_MAP.topProjects).
 */
(function () {
    'use strict';

    var ns = window.RV;
    if (!ns) return;

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str == null ? '' : String(str)));
        return div.innerHTML;
    }

    function render(container, data, siteBase) {
        container.innerHTML = '';
        var windows = data.windows;
        var active = windows[0];

        var header = document.createElement('div');
        header.className = 'dashboard-header';
        header.innerHTML = "<h3>What's New</h3>"
            + '<span class="dashboard-total">as of ' + escapeHtml(data.reference) + '</span>';
        container.appendChild(header);

        var sw = document.createElement('div');
        sw.className = 'compare-type-switcher whats-new-windows';
        windows.forEach(function (w) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'rv-btn whats-new-window-btn' + (w === active ? ' rv-btn-active' : '');
            btn.textContent = 'Last ' + w.months + ' months';
            btn.addEventListener('click', function () {
                active = w;
                Array.prototype.forEach.call(sw.children, function (b, i) {
                    b.classList.toggle('rv-btn-active', windows[i] === active);
                });
                renderBody();
            });
            sw.appendChild(btn);
        });
        container.appendChild(sw);

        var body = document.createElement('div');
        body.className = 'whats-new-body';
        container.appendChild(body);

        function renderBody() {
            body.innerHTML = '';

            if (active.topProjects && active.topProjects.length) {
                var panel = document.createElement('div');
                panel.className = 'chart-panel chart-panel-wide';
                panel.innerHTML = '<h4>Most active projects</h4>';
                var el = document.createElement('div');
                el.className = 'chart-container';
                panel.appendChild(el);
                body.appendChild(panel);
                if (ns.CHART_MAP && ns.CHART_MAP.topProjects) {
                    var chart = ns.CHART_MAP.topProjects(el, active.topProjects, siteBase);
                    if (chart) ns.attachToolbar(panel, chart);
                }
            }

            var heading = document.createElement('h4');
            heading.className = 'whats-new-heading';
            heading.textContent = active.count + ' new item' + (active.count === 1 ? '' : 's');
            body.appendChild(heading);

            var grid = document.createElement('div');
            grid.className = 'whats-new-grid';
            (active.items || []).forEach(function (it) {
                var card = document.createElement('a');
                card.className = 'whats-new-card';
                card.href = siteBase + '/item/' + it.id;
                card.innerHTML = '<span class="whats-new-card-title">' + escapeHtml(it.title) + '</span>'
                    + '<span class="whats-new-card-date">' + escapeHtml(it.created) + '</span>';
                grid.appendChild(card);
            });
            if (!grid.children.length) {
                grid.innerHTML = '<div class="rv-no-data">No items in this window.</div>';
            }
            body.appendChild(grid);
        }

        renderBody();
    }

    function initWhatsNew(container) {
        var basePath = container.dataset.basePath || '';
        var siteBase = container.dataset.siteBase || '';
        ns.basePath = basePath;
        var url = basePath + '/modules/DreVisualizations/asset/data/item-dashboards/whats-new.json';

        fetch(url).then(function (r) {
            if (!r.ok) throw new Error('not found');
            return r.json();
        }).then(function (data) {
            if (!data || !data.windows || !data.windows.length) {
                container.innerHTML = '<div class="rv-no-data">No recent additions.</div>';
                return;
            }
            render(container, data, siteBase);
        }).catch(function () {
            container.innerHTML = '<div class="rv-error">Could not load recent additions.</div>';
        });
    }

    function init() {
        if (typeof echarts === 'undefined') return;
        var cs = document.querySelectorAll('.whats-new-container');
        for (var i = 0; i < cs.length; i++) initWhatsNew(cs[i]);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
