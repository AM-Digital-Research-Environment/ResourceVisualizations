/**
 * Chart registry: maps data keys to builder functions, labels, and descriptions.
 *
 * Reads chart builders from window.RV.charts (populated by the chart modules).
 */
(function () {
    'use strict';

    var ns = window.RV;
    var c = ns.charts;

    ns.CHART_MAP = {
        'selfLocation':    c.buildMiniMap,
        'stackedTimeline': c.buildStackedTimeline,
        'timeline':        c.buildTimeline,
        'gantt':           c.buildGantt,
        'types':           c.buildPieChart,
        'heatmap':         c.buildHeatmap,
        'sankey':          c.buildSankey,
        'sunburst':        c.buildSunburst,
        'locations':       c.buildMap,
        'languages':       c.buildBarChart,
        'subjects':        c.buildWordCloud,
        'chord':           c.buildChord,
        'collabNetwork':   c.buildCollabNetwork,
        'contributors':    c.buildBarChart,
        'coAuthors':       c.buildBarChart,
        'coSubjects':      c.buildBarChart,
        'projects':        c.buildBarChart
    };

    ns.CHART_LABELS = {
        'selfLocation':    'Location',
        'stackedTimeline': 'Items by Year and Type',
        'timeline':        'Timeline',
        'gantt':           'Project Timelines',
        'types':           'Resource Types',
        'heatmap':         'Resource Type \u00d7 Language',
        'languages':       'Languages',
        'subjects':        'Subjects',
        'chord':           'Subject Co-occurrence',
        'collabNetwork':   'Collaboration Network',
        'contributors':    'Top Associated Persons',
        'sankey':          'Contributor \u2192 Project \u2192 Type',
        'sunburst':        'Type \u2192 Language \u2192 Subject',
        'locations':       'Geographic Origins',
        'coAuthors':       'Co-authors',
        'coSubjects':      'Co-occurring Subjects',
        'projects':        'Items per Project'
    };

    ns.CHART_DESCRIPTIONS = {
        'timeline':        'Number of research items collected per year.',
        'types':           'Distribution of items by resource type (audio, text, image, etc.).',
        'languages':       'Languages represented across all research items.',
        'subjects':        'Most frequent subject keywords across all items.',
        'selfLocation':    '',
        'stackedTimeline': 'Items per year, broken down by resource type.',
        'gantt':           'Duration of each project within this research section.',
        'heatmap':         'Cross-tabulation showing item counts for each type-language combination.',
        'sankey':          'Flow from contributors through projects to resource types.',
        'sunburst':        'Hierarchical view: resource type, then language, then top subjects.',
        'locations':       'Geographic origins of research items, sized by number of items.',
        'chord':           'Subjects that frequently appear together across research items.',
        'collabNetwork':   'Institutions connected through shared research items.',
        'contributors':    'Persons most frequently associated with research items.',
        'coAuthors':       'Persons who most frequently appear alongside this person.',
        'coSubjects':      'Subjects that most frequently appear alongside this one.',
        'projects':        'Number of research items collected per project in this section.'
    };
})();
