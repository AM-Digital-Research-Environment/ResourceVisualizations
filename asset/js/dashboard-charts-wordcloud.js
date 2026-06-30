/**
 * Word cloud chart builder with a word-count slider and an optional language
 * toggle.
 *
 * Accepts either shape:
 *   - flat `[{name, value, itemId?}]` — a single cloud (e.g. subjects, or the
 *     in-PHP transcript fallback);
 *   - `{languages: ['en','fr',…], byLang: {en:[…], fr:[…]}}` — a per-language
 *     cloud (the lemmatised word-cloud inputs), rendered with a language toggle.
 *
 * Falls back to a bar chart if the echarts-wordcloud extension is unavailable.
 * Registers into window.RV.charts for the dashboard orchestrator.
 */
(function () {
    'use strict';

    var ns = window.RV;
    var COLORS = ns.COLORS;
    var initChart = ns.initChart;
    var toEntries = ns.toEntries, addClickHandler = ns.addClickHandler;

    ns.charts = ns.charts || {};

    var LANG_NAMES = { en: 'English', fr: 'French', de: 'German', pt: 'Portuguese' };

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

    ns.charts.buildWordCloud = function (el, data, siteBase) {
        // Multilingual shape carries byLang; anything else is a flat list.
        var multi = !!(data && !Array.isArray(data) && data.byLang);
        var langs = multi
            ? ((data.languages && data.languages.length) ? data.languages.slice() : Object.keys(data.byLang))
            : [];
        var curLang = multi ? langs[0] : null;

        function rawFor() { return multi ? (data.byLang[curLang] || []) : data; }
        var entries = toEntries(rawFor());
        if (!entries.length) return;
        if (!isWordCloudAvailable()) return ns.charts.buildBarChart(el, rawFor(), siteBase);

        var chart = initChart(el);
        chart._noDecal = true;

        function defaultCount() {
            var t = entries.length;
            return Math.min(t, t > 100 ? 80 : 30);
        }

        // Larger fonts fill more of the (wide) panel and read better; the grid
        // scales with them so words still don't collide after the bump.
        function wordCloudOption(count) {
            var slice = entries.slice(0, count);
            var minFont = count > 100 ? 12 : count > 50 ? 14 : 16;
            var maxFont = count > 100 ? 72 : count > 50 ? 84 : (count > 10 ? 96 : 110);
            var grid = count > 100 ? 6 : count > 50 ? 8 : 10;
            return {
                tooltip: {
                    confine: true,
                    formatter: function (p) { return echarts.format.encodeHTML(p.name) + ': ' + p.value; }
                },
                aria: { enabled: true },
                series: [{
                    type: 'wordCloud',
                    shape: function (theta) {
                        var cos = Math.abs(Math.cos(theta));
                        var sin = Math.abs(Math.sin(theta));
                        return 1 / Math.max(cos, sin);
                    },
                    sizeRange: [minFont, maxFont],
                    rotationRange: [-45, 45], rotationStep: 15, gridSize: grid,
                    drawOutOfBound: false, shrinkToFit: true, layoutAnimation: count <= 100,
                    left: 'center', top: 'center', width: '100%', height: '100%',
                    textStyle: {
                        fontFamily: 'sans-serif',
                        color: function () { return COLORS[Math.floor(Math.random() * COLORS.length)]; }
                    },
                    emphasis: { textStyle: { fontWeight: 'bold', shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.3)' } },
                    data: slice.map(function (e) { return { name: e.name, value: e.value }; })
                }]
            };
        }

        // echarts-wordcloud lays out asynchronously; clear() before each relayout
        // so an in-flight pass isn't painted over (the "stacked words" bug).
        function render(count) {
            chart.clear();
            chart.setOption(wordCloudOption(count));
        }

        render(defaultCount());
        // entries is reassigned on a language switch; addClickHandler's closure
        // reads the current value, so it stays correct without re-binding.
        addClickHandler(chart, entries, siteBase);

        var panel = el.closest('.chart-panel');
        if (!panel) return chart;
        var desc = panel.querySelector('.chart-description');
        var anchor = desc ? desc.nextSibling : el;

        var sliderInput = null, sliderValue = null, relayoutTimer = null;

        // Language toggle — only when the data carries more than one language.
        if (multi && langs.length > 1) {
            var langBar = document.createElement('div');
            langBar.className = 'rv-word-langs';
            langs.forEach(function (code) {
                var b = document.createElement('button');
                b.type = 'button';
                b.className = 'rv-word-lang' + (code === curLang ? ' is-active' : '');
                b.textContent = LANG_NAMES[code] || code.toUpperCase();
                b.addEventListener('click', function () {
                    if (code === curLang) return;
                    curLang = code;
                    entries = toEntries(rawFor());
                    langBar.querySelectorAll('.rv-word-lang').forEach(function (x) { x.classList.remove('is-active'); });
                    b.classList.add('is-active');
                    if (sliderInput) {
                        sliderInput.max = String(entries.length);
                        var n = Math.min(parseInt(sliderInput.value, 10), entries.length);
                        sliderInput.value = String(n);
                        sliderValue.textContent = n;
                    }
                    render(sliderInput ? parseInt(sliderInput.value, 10) : defaultCount());
                });
                langBar.appendChild(b);
            });
            panel.insertBefore(langBar, anchor);
            anchor = langBar.nextSibling;
        }

        // Word-count slider.
        if (entries.length > 5) {
            var dc = defaultCount();
            var slider = document.createElement('div');
            slider.className = 'rv-word-slider';
            slider.innerHTML = '<label><span class="rv-word-slider-caption">Words</span>'
                + '<input type="range" min="5" max="' + entries.length + '" value="' + dc + '" step="1">'
                + '<span class="rv-word-slider-value">' + dc + '</span></label>';
            panel.insertBefore(slider, anchor);
            sliderInput = slider.querySelector('input');
            sliderValue = slider.querySelector('.rv-word-slider-value');
            sliderInput.addEventListener('input', function () {
                sliderValue.textContent = this.value;
                var n = parseInt(this.value, 10);
                clearTimeout(relayoutTimer);
                relayoutTimer = setTimeout(function () { render(n); }, 180);
            });
        }

        return chart;
    };
})();
