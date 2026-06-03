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
        // Curated home-page overview (amira homepage parity). Reads the same
        // collection-overview.json as the full `section` layout but shows only
        // this trimmed, ordered subset. Summary stat cards render above the grid
        // automatically (data.stats), so they are not listed here.
        collectionOverview: {
            order: ['clusterPartners', 'sectionsBar', 'sectionUniversity',
                    'stackedTimeline', 'heatmap', 'languages', 'types',
                    'subjects', 'choropleth'],
            wide:  ['clusterPartners', 'sectionsBar', 'sectionUniversity',
                    'stackedTimeline', 'heatmap', 'subjects', 'choropleth'],
            tall:  ['clusterPartners', 'sectionUniversity', 'subjects',
                    'choropleth']
        },
        organisation: {
            order: ['timeline', 'types', 'templates', 'languages', 'roles', 'radar',
                    'contributors', 'subjects', 'collabNetwork',
                    'affiliationNetwork', 'locations'],
            wide:  ['subjects', 'collabNetwork', 'affiliationNetwork', 'locations'],
            tall:  ['subjects', 'collabNetwork', 'affiliationNetwork', 'locations']
        },
        person: {
            order: ['timeline', 'types', 'templates', 'languages', 'roles', 'radar',
                    'coAuthors', 'subjects', 'contributorNetwork', 'locations'],
            wide:  ['subjects', 'contributorNetwork', 'locations'],
            tall:  ['subjects', 'contributorNetwork', 'locations']
        },
        section: {
            order: ['selfLocation', 'stackedTimeline', 'languageTimeline',
                    'timeline', 'gantt', 'beeswarm', 'calendar', 'boxplot',
                    'types', 'languages', 'roles', 'heatmap', 'subjects',
                    'subjectTrends', 'sunburst', 'treemap', 'locations',
                    'choropleth', 'chord', 'timeChord', 'contributorNetwork',
                    'contributors', 'projects', 'sankey'],
            wide:  ['selfLocation', 'stackedTimeline', 'languageTimeline',
                    'gantt', 'beeswarm', 'calendar', 'boxplot', 'heatmap',
                    'sankey', 'sunburst', 'treemap', 'subjects', 'subjectTrends',
                    'locations', 'choropleth', 'chord', 'timeChord',
                    'contributorNetwork', 'projects'],
            tall:  ['selfLocation', 'gantt', 'beeswarm', 'heatmap', 'sankey',
                    'sunburst', 'treemap', 'subjects', 'subjectTrends',
                    'locations', 'choropleth', 'chord', 'timeChord',
                    'contributorNetwork']
        },
        project: {
            order: ['stackedTimeline', 'languageTimeline', 'timeline',
                    'types', 'languages', 'roles', 'radar', 'calendar', 'heatmap',
                    'subjects', 'subjectTrends', 'sunburst', 'treemap', 'locations',
                    'choropleth', 'chord', 'timeChord', 'contributorNetwork',
                    'contributors', 'sankey'],
            wide:  ['stackedTimeline', 'languageTimeline', 'calendar', 'heatmap',
                    'sankey', 'sunburst', 'treemap', 'subjects', 'subjectTrends',
                    'locations', 'choropleth', 'chord', 'timeChord',
                    'contributorNetwork'],
            tall:  ['heatmap', 'sankey', 'sunburst', 'treemap', 'subjects',
                    'subjectTrends', 'locations', 'choropleth', 'chord',
                    'timeChord', 'contributorNetwork']
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
        languageOverview: {
            order: ['topLanguages', 'stackedTimeline', 'languageTimeline',
                    'timeline', 'types', 'roles', 'heatmap', 'subjects',
                    'subjectTrends', 'locations', 'choropleth', 'contributors'],
            wide:  ['topLanguages', 'stackedTimeline', 'languageTimeline',
                    'heatmap', 'subjects', 'subjectTrends', 'locations',
                    'choropleth'],
            tall:  ['topLanguages', 'heatmap', 'subjects', 'subjectTrends',
                    'locations', 'choropleth']
        },
        resourceTypeOverview: {
            order: ['topResourceTypes', 'stackedTimeline', 'timeline',
                    'languages', 'roles', 'heatmap', 'subjects',
                    'subjectTrends', 'locations', 'contributors'],
            wide:  ['topResourceTypes', 'stackedTimeline', 'heatmap',
                    'subjects', 'subjectTrends', 'locations'],
            tall:  ['topResourceTypes', 'heatmap', 'subjects',
                    'subjectTrends', 'locations']
        },
        targetAudienceOverview: {
            order: ['topAudiences', 'stackedTimeline', 'timeline', 'types',
                    'languages', 'roles', 'heatmap', 'subjects',
                    'subjectTrends', 'locations', 'contributors'],
            wide:  ['topAudiences', 'stackedTimeline', 'heatmap', 'subjects',
                    'subjectTrends', 'locations'],
            tall:  ['topAudiences', 'heatmap', 'subjects', 'subjectTrends',
                    'locations']
        },
        personOverview: {
            order: ['topPersons', 'stackedTimeline', 'timeline', 'types',
                    'templates', 'languages', 'roles', 'heatmap', 'subjects',
                    'subjectTrends', 'locations', 'choropleth', 'contributors'],
            wide:  ['topPersons', 'stackedTimeline', 'heatmap', 'subjects',
                    'subjectTrends', 'locations', 'choropleth'],
            tall:  ['topPersons', 'heatmap', 'subjects', 'subjectTrends',
                    'locations', 'choropleth']
        },
        institutionOverview: {
            order: ['topInstitutions', 'stackedTimeline', 'timeline', 'types',
                    'templates', 'languages', 'roles', 'subjects', 'subjectTrends',
                    'locations', 'choropleth', 'contributors'],
            wide:  ['topInstitutions', 'stackedTimeline', 'subjects',
                    'subjectTrends', 'locations', 'choropleth'],
            tall:  ['topInstitutions', 'subjects', 'subjectTrends',
                    'locations', 'choropleth']
        },
        groupOverview: {
            order: ['topGroups', 'stackedTimeline', 'timeline', 'types',
                    'languages', 'roles', 'heatmap', 'subjects',
                    'subjectTrends', 'locations', 'contributors'],
            wide:  ['topGroups', 'stackedTimeline', 'heatmap', 'subjects',
                    'subjectTrends', 'locations'],
            tall:  ['topGroups', 'heatmap', 'subjects', 'subjectTrends',
                    'locations']
        },
        lcshOverview: {
            order: ['topSubjects', 'stackedTimeline', 'timeline', 'types',
                    'languages', 'roles', 'heatmap', 'subjects',
                    'subjectTrends', 'locations', 'contributors'],
            wide:  ['topSubjects', 'stackedTimeline', 'heatmap', 'subjects',
                    'subjectTrends', 'locations'],
            tall:  ['topSubjects', 'heatmap', 'subjects', 'subjectTrends',
                    'locations']
        },
        tagOverview: {
            order: ['topTags', 'stackedTimeline', 'timeline', 'types',
                    'languages', 'roles', 'heatmap', 'subjects',
                    'subjectTrends', 'locations', 'contributors'],
            wide:  ['topTags', 'stackedTimeline', 'heatmap', 'subjects',
                    'subjectTrends', 'locations'],
            tall:  ['topTags', 'heatmap', 'subjects', 'subjectTrends',
                    'locations']
        },
        projectOverview: {
            order: ['topProjects', 'stackedTimeline', 'languageTimeline',
                    'gantt', 'beeswarm', 'calendar', 'boxplot', 'timeline',
                    'types', 'languages', 'roles', 'heatmap', 'subjects',
                    'subjectTrends', 'timeChord', 'locations', 'choropleth',
                    'contributors'],
            wide:  ['topProjects', 'stackedTimeline', 'languageTimeline',
                    'gantt', 'beeswarm', 'calendar', 'boxplot', 'heatmap',
                    'subjects', 'subjectTrends', 'timeChord', 'locations',
                    'choropleth'],
            tall:  ['topProjects', 'gantt', 'beeswarm', 'heatmap', 'subjects',
                    'subjectTrends', 'timeChord', 'locations', 'choropleth']
        },
        researchItem: {
            order: ['timeline', 'types', 'languages', 'subjects',
                    'contributors', 'locations'],
            wide:  ['subjects', 'contributors', 'locations'],
            tall:  ['subjects', 'locations']
        },
        publications: {
            order: ['templates', 'stackedTimeline', 'timeline', 'types',
                    'topVenues', 'topAuthors', 'coAuthorNetwork', 'chord',
                    'languages', 'subjects', 'subjectTrends', 'locations'],
            wide:  ['stackedTimeline', 'coAuthorNetwork', 'chord', 'subjects',
                    'subjectTrends', 'locations'],
            tall:  ['coAuthorNetwork', 'chord', 'subjects', 'subjectTrends',
                    'locations']
        }
    };

    ns.DEFAULT_LAYOUT = {
        order: ['selfLocation', 'stackedTimeline', 'languageTimeline',
                'timeline', 'gantt', 'beeswarm', 'types', 'languages',
                'roles', 'radar', 'genres', 'heatmap', 'subjects', 'subjectTrends', 'sunburst',
                'treemap', 'locations', 'choropleth', 'chord', 'collabNetwork',
                'contributorNetwork', 'affiliationNetwork', 'contributors',
                'coAuthors', 'coSubjects', 'projects', 'sankey'],
        wide:  ['selfLocation', 'stackedTimeline', 'languageTimeline', 'gantt',
                'beeswarm', 'heatmap', 'sankey', 'sunburst', 'treemap',
                'subjects', 'subjectTrends', 'locations', 'choropleth', 'chord',
                'collabNetwork', 'contributorNetwork', 'affiliationNetwork',
                'projects', 'coSubjects'],
        tall:  ['selfLocation', 'gantt', 'beeswarm', 'heatmap', 'sankey',
                'sunburst', 'treemap', 'subjects', 'subjectTrends',
                'locations', 'choropleth', 'chord', 'collabNetwork',
                'contributorNetwork', 'affiliationNetwork']
    };
})();
