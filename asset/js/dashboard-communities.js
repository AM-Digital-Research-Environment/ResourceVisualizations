/**
 * Discursive Communities controller.
 *
 * Hydrates a `.communities-container` site-page block: loads the precomputed
 * communities/discursive.json and renders the community force graph.
 *
 * Depends on: dashboard-core.js, dashboard-charts-communities.js.
 */
(function () {
    'use strict';

    var ns = window.RV;
    if (!ns) return;

    function render(container, data, siteBase) {
        container.innerHTML = '';

        var header = document.createElement('div');
        header.className = 'dashboard-header';
        header.innerHTML = '<h2>' + 'Discursive Communities' + '</h2>'
            + '<span class="dashboard-total">' + data.nodes.length + ' subjects · '
            + (data.communities ? data.communities.length : 0) + ' communities</span>';
        container.appendChild(header);

        var desc = document.createElement('p');
        desc.className = 'chart-description';
        desc.textContent = 'Subjects that co-occur across the collection, clustered into communities '
            + '(Louvain) and sized by influence (PageRank). Click a subject to open its page.';
        container.appendChild(desc);

        var panel = document.createElement('div');
        panel.className = 'chart-panel chart-panel-wide';
        var el = document.createElement('div');
        el.className = 'chart-container chart-container-tall';
        el.setAttribute('data-chart', 'communities');
        panel.appendChild(el);
        container.appendChild(panel);

        if (ns.charts && ns.charts.buildCommunities) {
            var chart = ns.charts.buildCommunities(el, data, siteBase);
            if (chart) ns.attachToolbar(panel, chart);
        }
    }

    function initCommunities(container) {
        var basePath = container.dataset.basePath || '';
        var siteBase = container.dataset.siteBase || '';
        ns.basePath = basePath;
        var url = basePath + '/modules/DreVisualizations/asset/data/communities/discursive.json';

        fetch(url).then(function (r) {
            if (!r.ok) throw new Error('not found');
            return r.json();
        }).then(function (data) {
            if (!data || !data.nodes || !data.nodes.length) {
                container.innerHTML = '<div class="rv-no-data">No community data available yet.</div>';
                return;
            }
            render(container, data, siteBase);
        }).catch(function () {
            container.innerHTML = '<div class="rv-error">Could not load community data.</div>';
        });
    }

    function init() {
        if (typeof echarts === 'undefined') return;
        var containers = document.querySelectorAll('.communities-container');
        for (var i = 0; i < containers.length; i++) initCommunities(containers[i]);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
