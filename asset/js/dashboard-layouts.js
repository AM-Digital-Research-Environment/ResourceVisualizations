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
            order: ['selfLocation', 'timeline', 'types', 'templates', 'languages',
                    'roles', 'radar', 'contributors', 'subjects', 'collabNetwork',
                    'affiliationNetwork', 'locations'],
            wide:  ['selfLocation', 'subjects', 'collabNetwork', 'affiliationNetwork', 'locations'],
            tall:  ['selfLocation', 'subjects', 'collabNetwork', 'affiliationNetwork', 'locations']
        },
        person: {
            order: ['timeline', 'types', 'templates', 'languages', 'roles', 'radar',
                    'coAuthors', 'subjects', 'contributorNetwork', 'locations',
                    'affiliationMap'],
            wide:  ['subjects', 'contributorNetwork', 'locations', 'affiliationMap'],
            tall:  ['subjects', 'contributorNetwork', 'locations', 'affiliationMap']
        },
        section: {
            order: ['selfLocation', 'stackedTimeline', 'languageTimeline',
                    'timeline', 'gantt', 'beeswarm', 'boxplot',
                    'types', 'languages', 'roles', 'heatmap', 'subjects',
                    'subjectTrends', 'sunburst', 'treemap', 'locations',
                    'choropleth', 'chord', 'timeChord', 'contributorNetwork',
                    'contributors', 'projects', 'sankey'],
            wide:  ['selfLocation', 'stackedTimeline', 'languageTimeline',
                    'gantt', 'beeswarm', 'boxplot', 'heatmap',
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
                    'types', 'languages', 'roles', 'radar', 'heatmap',
                    'subjects', 'subjectTrends', 'sunburst', 'treemap', 'locations',
                    'choropleth', 'chord', 'timeChord', 'contributorNetwork',
                    'contributors', 'sankey', 'affiliationMap'],
            wide:  ['stackedTimeline', 'languageTimeline', 'heatmap',
                    'sankey', 'sunburst', 'treemap', 'subjects', 'subjectTrends',
                    'locations', 'choropleth', 'chord', 'timeChord',
                    'contributorNetwork', 'affiliationMap'],
            tall:  ['heatmap', 'sankey', 'sunburst', 'treemap', 'subjects',
                    'subjectTrends', 'locations', 'choropleth', 'chord',
                    'timeChord', 'contributorNetwork', 'affiliationMap']
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
                    'gantt', 'beeswarm', 'boxplot', 'timeline',
                    'types', 'languages', 'roles', 'heatmap', 'subjects',
                    'subjectTrends', 'timeChord', 'locations', 'choropleth',
                    'contributors'],
            wide:  ['topProjects', 'stackedTimeline', 'languageTimeline',
                    'gantt', 'beeswarm', 'boxplot', 'heatmap',
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
        // Half-width charts are paired consecutively (types+languages,
        // topVenues+topAuthors) so neither sits alone on a row; every other key is
        // full-width. `templates` and the (empty) `locations`/`timeline` are
        // intentionally omitted — `types` already breaks publications down by type,
        // and publications carry no geography.
        publications: {
            order: ['types', 'languages', 'stackedTimeline',
                    'topVenues', 'topAuthors', 'coAuthorNetwork',
                    'chord', 'subjects', 'subjectTrends', 'abstractWordcloud'],
            wide:  ['stackedTimeline', 'coAuthorNetwork', 'chord',
                    'subjects', 'subjectTrends', 'abstractWordcloud'],
            tall:  ['coAuthorNetwork', 'chord', 'subjects', 'subjectTrends',
                    'abstractWordcloud']
        },
        // Cluster YouTube channel (youtube.json). Videos carry no resource type
        // or geography, so the layout shows uploads over time, the language mix,
        // the playlists, and any credited speakers (contributors, auto-hidden
        // until speakers are curated). timeline + languages pair on one row.
        youtube: {
            order: ['playlists', 'timeline', 'languages', 'languageTimeline',
                    'contributors'],
            wide:  ['playlists', 'languageTimeline'],
            tall:  ['playlists']
        },
        // Cluster podcast episodes (podcasts.json). The headline is a word cloud
        // built from the AI-generated transcripts; then the most frequent
        // speakers, the episode-length distribution, the publication timeline and
        // the series breakdown. The word cloud spans full width; the rest pair up.
        podcasts: {
            order: ['transcriptWordcloud', 'speakerNetwork', 'contributors',
                    'duration', 'timeline', 'series'],
            wide:  ['transcriptWordcloud', 'speakerNetwork'],
            tall:  ['transcriptWordcloud', 'speakerNetwork']
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
