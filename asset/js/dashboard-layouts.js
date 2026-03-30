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
            order: ['timeline', 'types', 'languages', 'roles', 'contributors',
                    'subjects', 'collabNetwork', 'affiliationNetwork', 'locations'],
            wide:  ['subjects', 'collabNetwork', 'affiliationNetwork', 'locations'],
            tall:  ['subjects', 'collabNetwork', 'affiliationNetwork', 'locations']
        },
        person: {
            order: ['timeline', 'types', 'languages', 'coAuthors',
                    'subjects', 'contributorNetwork', 'locations'],
            wide:  ['subjects', 'contributorNetwork', 'locations'],
            tall:  ['subjects', 'contributorNetwork', 'locations']
        },
        section: {
            order: ['selfLocation', 'stackedTimeline', 'languageTimeline',
                    'timeline', 'gantt', 'beeswarm', 'types', 'languages',
                    'roles', 'heatmap', 'subjects', 'subjectTrends',
                    'sunburst', 'treemap', 'locations', 'geoFlows', 'chord',
                    'contributorNetwork', 'contributors', 'projects', 'sankey'],
            wide:  ['selfLocation', 'stackedTimeline', 'languageTimeline',
                    'gantt', 'beeswarm', 'heatmap', 'sankey', 'sunburst',
                    'treemap', 'subjects', 'subjectTrends', 'locations',
                    'geoFlows', 'chord', 'contributorNetwork', 'projects'],
            tall:  ['selfLocation', 'gantt', 'beeswarm', 'heatmap', 'sankey',
                    'sunburst', 'treemap', 'subjects', 'subjectTrends',
                    'locations', 'geoFlows', 'chord', 'contributorNetwork']
        },
        project: {
            order: ['stackedTimeline', 'languageTimeline', 'timeline',
                    'types', 'languages', 'roles', 'heatmap', 'subjects',
                    'subjectTrends', 'sunburst', 'treemap', 'locations',
                    'geoFlows', 'chord', 'contributorNetwork', 'contributors',
                    'sankey'],
            wide:  ['stackedTimeline', 'languageTimeline', 'heatmap', 'sankey',
                    'sunburst', 'treemap', 'subjects', 'subjectTrends',
                    'locations', 'geoFlows', 'chord', 'contributorNetwork'],
            tall:  ['heatmap', 'sankey', 'sunburst', 'treemap', 'subjects',
                    'subjectTrends', 'locations', 'geoFlows', 'chord',
                    'contributorNetwork']
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
        genre: {
            order: ['timeline', 'types', 'languages', 'subjects',
                    'contributors', 'locations'],
            wide:  ['subjects', 'locations'],
            tall:  ['subjects', 'locations']
        },
        genreOverview: {
            order: ['genres', 'stackedTimeline', 'timeline', 'types',
                    'languages', 'roles', 'heatmap', 'subjects',
                    'subjectTrends', 'locations', 'contributors'],
            wide:  ['genres', 'stackedTimeline', 'heatmap', 'subjects',
                    'subjectTrends', 'locations'],
            tall:  ['genres', 'heatmap', 'subjects', 'subjectTrends',
                    'locations']
        },
        researchItem: {
            order: ['timeline', 'types', 'languages', 'subjects',
                    'contributors', 'locations'],
            wide:  ['subjects', 'contributors', 'locations'],
            tall:  ['subjects', 'locations']
        }
    };

    ns.DEFAULT_LAYOUT = {
        order: ['selfLocation', 'stackedTimeline', 'languageTimeline',
                'timeline', 'gantt', 'beeswarm', 'types', 'languages',
                'roles', 'genres', 'heatmap', 'subjects', 'subjectTrends', 'sunburst',
                'treemap', 'locations', 'geoFlows', 'chord', 'collabNetwork',
                'contributorNetwork', 'affiliationNetwork', 'contributors',
                'coAuthors', 'coSubjects', 'projects', 'sankey'],
        wide:  ['selfLocation', 'stackedTimeline', 'languageTimeline', 'gantt',
                'beeswarm', 'heatmap', 'sankey', 'sunburst', 'treemap',
                'subjects', 'subjectTrends', 'locations', 'geoFlows', 'chord',
                'collabNetwork', 'contributorNetwork', 'affiliationNetwork',
                'projects', 'coSubjects'],
        tall:  ['selfLocation', 'gantt', 'beeswarm', 'heatmap', 'sankey',
                'sunburst', 'treemap', 'subjects', 'subjectTrends',
                'locations', 'geoFlows', 'chord', 'collabNetwork',
                'contributorNetwork', 'affiliationNetwork']
    };
})();
