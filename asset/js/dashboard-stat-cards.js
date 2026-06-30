/**
 * Stat cards — a reusable summary-card component.
 *
 * Renders the amira-style "stat card" grid (icon + value + label + optional
 * subtitle) from a precomputed `stats` array. Any dashboard/overview can use it:
 * compute the counts the standard PHP precompute way (see
 * Aggregators::buildStatCards) and emit a `stats` array of
 * `{key, label, value, subtitle?}`; the orchestrator (dashboard.js) renders it
 * whenever a dashboard carries one. Dashboards without `stats` are unaffected.
 *
 * The `key` selects an icon: a canonical lucide icon if one is registered, else
 * a synonym from ALIAS, else a generic fallback — so a brand-new card key always
 * renders a badge. To give a new key its own glyph, add it to ICONS (or map it
 * in ALIAS to an existing one).
 *
 * THEMING — follows the DRE theme. Icons are inline lucide SVGs (lucide.dev, MIT
 * licence) stroked with `currentColor`, and every surface/colour comes from the
 * `--rv-*` aliases in dre-visualizations.css, so the cards follow the active
 * light / dark theme with zero JS.
 */
(function () {
    'use strict';

    var ns = window.RV;
    if (!ns) return;

    // Canonical lucide icon inner markup, keyed by stat key (lucide.dev, MIT).
    // Drawn inside an SVG that sets fill:none / stroke:currentColor below.
    var ICONS = {
        researchItems: '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
        projects: '<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/>',
        people: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M16 3.128a4 4 0 0 1 0 7.744"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/>',
        organisations: '<path d="M10 12h4"/><path d="M10 8h4"/><path d="M14 21v-3a2 2 0 0 0-4 0v3"/><path d="M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2"/><path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"/>',
        locations: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
        languages: '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>',
        subjectsTags: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
        resourceTypes: '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/>',
        publications: '<path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/>',
        podcasts: '<path d="M16.85 18.58a9 9 0 1 0-9.7 0"/><path d="M8 14a5 5 0 1 1 8 0"/><circle cx="12" cy="11" r="1"/><path d="M13 17a1 1 0 1 0-2 0l.5 4.5a.5.5 0 0 0 1 0Z"/>',
        youtube: '<path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17"/><path d="m10 15 5-3-5-3z"/>',
        playlists: '<path d="M12 12H3"/><path d="M16 6H3"/><path d="M12 18H3"/><path d="m16 12 5 3-5 3v-6Z"/>',
        duration: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
        items: '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><polyline points="3.29 7 12 12 20.71 7"/><path d="m7.5 4.27 9 5.15"/>',
        countries: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>'
    };
    ns.STAT_ICONS = ICONS;

    // Synonyms → a canonical key, so callers can use natural names on any
    // dashboard without duplicating SVG (e.g. a per-entity dashboard's
    // "Contributors" or the Publications block's "Authors").
    var ALIAS = {
        contributors: 'people',
        authors: 'people',
        coAuthors: 'people',
        groups: 'people',
        institutions: 'organisations',
        subjects: 'subjectsTags',
        tags: 'subjectsTags',
        types: 'resourceTypes',
        genres: 'resourceTypes',
        sections: 'projects',
        series: 'playlists'
    };
    ns.STAT_ICON_ALIAS = ALIAS;

    // Generic fallback (lucide chart-column) for any unmapped key.
    var DEFAULT_ICON = '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>';

    function iconFor(key) {
        return ICONS[key] || ICONS[ALIAS[key]] || DEFAULT_ICON;
    }
    ns.statIconFor = iconFor;

    var SVG_OPEN = '<svg class="rv-stat-icon" xmlns="http://www.w3.org/2000/svg"'
        + ' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"'
        + ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">';

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
        });
    }

    // Group digits for legibility (3,975). Falls back to the raw value if it is
    // not a finite number (e.g. an unexpected string).
    function fmt(n) {
        var v = Number(n);
        if (!isFinite(v)) return esc(n);
        try { return v.toLocaleString('en-US'); } catch (e) { return String(v); }
    }

    function cardHtml(s) {
        return '<div class="rv-stat-card">'
            + '<div class="rv-stat-body">'
            + '<p class="rv-stat-label">' + esc(s.label) + '</p>'
            + '<p class="rv-stat-value">' + fmt(s.value) + '</p>'
            + (s.subtitle ? '<p class="rv-stat-sub">' + esc(s.subtitle) + '</p>' : '')
            + '</div>'
            + '<span class="rv-stat-badge">' + SVG_OPEN + iconFor(s.key) + '</svg></span>'
            + '</div>';
    }

    /**
     * Build the stat-card grid HTML from a `stats` array of
     * `{key, label, value, subtitle?}`. Returns '' when there is nothing to show.
     */
    ns.renderStatCards = function (stats) {
        if (!Array.isArray(stats) || !stats.length) return '';
        return '<div class="rv-stat-cards">' + stats.map(cardHtml).join('') + '</div>';
    };
})();
