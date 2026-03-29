/**
 * Per-resource-type dashboard layout configurations.
 *
 * Each layout defines:
 *   order — chart keys in render order
 *   wide  — keys that span the full grid width
 *   tall  — keys that use the taller container (420px)
 *
 * Half-width charts are paired left-to-right; place them consecutively
 * so the 2-column CSS grid fills both columns without gaps.
 */
(function () {
    'use strict';

    var ns = window.RV = window.RV || {};

    ns.LAYOUTS = {
        organisation: {
            order: ['timeline', 'types', 'languages', 'contributors',
                    'subjects', 'collabNetwork', 'locations'],
            wide:  ['subjects', 'collabNetwork', 'locations'],
            tall:  ['subjects', 'collabNetwork', 'locations']
        },
        person: {
            order: ['timeline', 'types', 'languages', 'coAuthors',
                    'subjects', 'locations'],
            wide:  ['subjects', 'locations'],
            tall:  ['subjects', 'locations']
        },
        section: {
            order: ['selfLocation', 'stackedTimeline', 'timeline', 'gantt',
                    'types', 'languages', 'heatmap', 'subjects', 'sunburst',
                    'locations', 'chord', 'contributors', 'projects', 'sankey'],
            wide:  ['selfLocation', 'stackedTimeline', 'gantt', 'heatmap',
                    'sankey', 'sunburst', 'subjects', 'locations', 'chord',
                    'projects'],
            tall:  ['selfLocation', 'gantt', 'heatmap', 'sankey', 'sunburst',
                    'subjects', 'locations', 'chord']
        },
        project: {
            order: ['stackedTimeline', 'timeline', 'types', 'languages',
                    'heatmap', 'subjects', 'sunburst', 'locations', 'chord',
                    'contributors', 'sankey'],
            wide:  ['stackedTimeline', 'heatmap', 'sankey', 'sunburst',
                    'subjects', 'locations', 'chord'],
            tall:  ['heatmap', 'sankey', 'sunburst', 'subjects', 'locations',
                    'chord']
        },
        location: {
            order: ['selfLocation', 'timeline', 'types', 'languages',
                    'contributors', 'subjects', 'locations'],
            wide:  ['selfLocation', 'subjects', 'locations'],
            tall:  ['selfLocation', 'subjects', 'locations']
        },
        authority: {
            order: ['timeline', 'types', 'languages', 'coSubjects',
                    'contributors', 'locations'],
            wide:  ['coSubjects', 'locations'],
            tall:  ['coSubjects', 'locations']
        },
        researchItem: {
            order: ['timeline', 'types', 'languages', 'subjects',
                    'contributors', 'locations'],
            wide:  ['subjects', 'contributors', 'locations'],
            tall:  ['subjects', 'locations']
        }
    };

    ns.DEFAULT_LAYOUT = {
        order: ['selfLocation', 'stackedTimeline', 'timeline', 'gantt',
                'types', 'languages', 'heatmap', 'subjects', 'sunburst',
                'locations', 'chord', 'collabNetwork', 'contributors',
                'coAuthors', 'coSubjects', 'projects', 'sankey'],
        wide:  ['selfLocation', 'stackedTimeline', 'gantt', 'heatmap',
                'sankey', 'sunburst', 'subjects', 'locations', 'chord',
                'collabNetwork', 'projects', 'coSubjects'],
        tall:  ['selfLocation', 'gantt', 'heatmap', 'sankey', 'sunburst',
                'subjects', 'locations', 'chord', 'collabNetwork']
    };
})();
