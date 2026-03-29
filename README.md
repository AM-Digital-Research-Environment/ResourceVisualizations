# Resource Visualizations

An [Omeka S](https://omeka.org/s/) module that adds interactive visualizations to resource pages using [ECharts](https://echarts.apache.org/) and [MapLibre GL](https://maplibre.org/).

## Features

### Knowledge Graph (Item Pages)

A force-directed network showing the item's relationships. For items with rich outgoing links (research items, projects, people), shows linked persons, subjects, locations, and other items sharing the same properties. For items that are primarily linked TO (subjects, languages, locations, genres), shows the research items that reference them.

- Pre-computed JSON for instant loading (6,146 graphs)
- Click any node to navigate to its Omeka S page
- Fullscreen mode (Escape to exit)
- Adjacency highlighting on hover
- Node cap (150 direct + 30 shared) prevents overload on highly-connected entities

### Item Location Map (Item Pages)

Automatically rendered below the knowledge graph when an item has geographic data. Shows distinct markers for:

- **Origin** (teal) — where the resource was produced/fieldwork conducted (`dcterms:spatial`)
- **Current location** (orange) — where the resource is currently held (`dcterms:provenance`)

Coordinates are resolved from linked Location items with `geo:lat`/`geo:long`. 2,898 items have location map data.

### Visualizations Dashboard (Item Pages)

Contextual charts adapted per entity type. All chart elements are clickable, linking to the corresponding Omeka S item page. 2,551 dashboards pre-computed across all entity types.

#### Charts by Entity Type

| Chart | Sections | Projects | People | Organisations | Locations | Subjects | Languages | Types | Genres |
|---|---|---|---|---|---|---|---|---|---|
| Stacked Timeline | x | x | | | | | | | |
| Language Timeline | x | x | | | | | | | |
| Timeline | x | x | x | x | x | x | x | x | x |
| Gantt (project timelines) | x | | | | | | | | |
| Beeswarm (projects by year) | x | | | | | | | | |
| Resource Types (pie) | x | x | x | x | x | x | x | | x |
| Languages | x | x | x | x | x | x | | x | x |
| Contributor Roles | x | x | | | | | | | |
| Heatmap (type x language) | x | x | | | | | | | |
| Subjects (word cloud) | x | x | x | x | x | | x | x | |
| Subject Trends over Time | x | x | | | | | | | |
| Sunburst (type > language > subject) | x | x | | | | | | | |
| Treemap (project x type) | x | x | | | | | | | |
| Geographic Origins (map) | x | x | x | x | | | x | x | |
| Origin > Current Location (flow map) | x | x | | | | | | | |
| Self-location MiniMap | | | | | x | | | | |
| Subject Co-occurrence (chord) | x | x | | | | | | | |
| Collaboration Network | | | | x | | | | | |
| Contributor Network | x | x | x | | | | | | |
| Affiliation Network | | | | x | | | | | |
| Top Associated Persons | x | x | | x | x | x | x | x | x |
| Co-authors | | | x | | | | | | |
| Co-occurring Subjects | | | | | | x | | | |
| Items per Project | x | | | | | | | | |
| Sankey (contributor > project > type) | x | x | | | | | | | |

Note: The basic Timeline is automatically hidden when the Stacked Timeline is available (since it's redundant).

Dashboard layouts are resource-type-aware: each resource template has its own chart order and wide/tall configuration defined in `dashboard-layouts.js`. This prevents layout gaps in the 2-column grid by pairing half-width charts side by side.

### Compare Projects

Side-by-side comparison of two projects with paired charts (stacked timeline, resource types, languages, subjects) and overlap statistics (shared subject percentage, shared subject badges). Accessible as a resource page block.

### Item Set Dashboard

Inline dashboard for item set pages with server-side aggregation.

#### Chart Features

- **Toolbox**: Save-as-image (2x resolution) and restore on all ECharts charts
- **Word count slider**: Adjust the number of words displayed in the word cloud (5 to max)
- **DataZoom**: Interactive slider on timeline charts with >15 data points
- **ARIA**: Screen reader descriptions on all charts; decal patterns on pie, stacked, sankey, and sunburst for accessibility
- **Cooperative gestures**: Main maps require Ctrl+scroll to zoom (prevents scroll hijacking)
- **Globe projection**: Main maps default to globe view with a toggle control
- **Scale control**: Metric scale bar on all maps

## Installation

Download via Omeka S CLI:

```bash
docker compose exec php omeka-s-cli module:download --base-path /var/www/html gh:fmadore/ResourceVisualizations
```

Then activate in **Admin > Modules**.

### Configure Resource Pages

Go to **Admin > Sites > [site] > Theme > Configure resource pages**:

- **Item page**: add "Knowledge Graph", "Visualizations", and optionally "Compare Projects" blocks
- **Item set page**: add "Item Set Dashboard" block (optional)

## Pre-computing Data

Visualizations load from pre-computed JSON files stored in the module's `asset/data/` directory. Two Python scripts generate these files by querying the Omeka S MySQL database through `docker compose exec` (no port exposure needed).

### Requirements

- Python 3
- `pymysql` (`sudo apt-get install python3-pymysql`)
- The omeka-s-docker directory must be adjacent to this module, or set `OMEKA_DOCKER_DIR`

### Knowledge Graphs

Generates one JSON file per item (~6,000 files), including embedded location map data for items with spatial/provenance links:

```bash
python3 scripts/precompute-graphs.py
```

### Dashboards (all entity types)

Generates dashboard JSON for sections, projects, people, institutions, locations, subjects, languages, resource types, and genres (~2,500 files):

```bash
python3 scripts/precompute-dashboards.py
```

### After Regenerating

Update the module in the container:

```bash
cd /path/to/omeka-s-docker
docker compose exec php omeka-s-cli module:download --base-path /var/www/html --force gh:fmadore/ResourceVisualizations
docker compose restart php
```

## Architecture

```
ResourceVisualizations/
├── Module.php                          # Asset injection (ECharts, MapLibre CDN)
├── config/
│   ├── module.ini                      # Module metadata
│   └── module.config.php               # Resource page block registration
├── src/Site/ResourcePageBlockLayout/
│   ├── KnowledgeGraph.php              # Item pages — graph block
│   ├── LinkedItemsDashboard.php        # Item pages — visualizations block
│   ├── CompareProjects.php             # Item pages — project comparison block
│   └── ItemSetDashboard.php            # Item set pages — dashboard block
├── view/common/resource-page-block-layout/
│   ├── knowledge-graph.phtml           # Lightweight async container
│   ├── linked-items-dashboard.phtml    # Lightweight async container
│   ├── compare-projects.phtml          # Compare view async container
│   ├── item-set-dashboard.phtml        # Server-side rendered
│   └── partials/dashboard-charts.phtml # Shared chart rendering (inline mode)
├── asset/
│   ├── js/
│   │   ├── knowledge-graph.js                    # Graph + item map
│   │   ├── dashboard-core.js                     # THEME, COLORS, helpers (window.RV)
│   │   ├── dashboard-layouts.js                  # Per-resource-type layout configs
│   │   ├── dashboard-charts-basic.js             # Timeline, pie, bar, word cloud
│   │   ├── dashboard-charts-advanced.js          # Gantt, heatmap, chord, sankey, sunburst, stacked timeline
│   │   ├── dashboard-charts-beeswarm.js          # Beeswarm scatter (projects by year)
│   │   ├── dashboard-charts-map.js               # Geographic origins map, mini map
│   │   ├── dashboard-charts-stacked-area.js      # Subject trends, language timeline
│   │   ├── dashboard-charts-treemap.js           # Hierarchical treemap
│   │   ├── dashboard-charts-geo-flows.js         # Origin → current location flow map
│   │   ├── dashboard-charts-contributor-network.js # Contributor + affiliation networks
│   │   ├── dashboard-collab-network.js           # Institution collaboration network
│   │   ├── dashboard-compare.js                  # Compare Projects controller
│   │   ├── dashboard-registry.js                 # CHART_MAP, labels, descriptions
│   │   └── dashboard.js                          # Orchestrator: render + async/inline init
│   ├── css/
│   │   └── resource-visualizations.css # Styles with CSS custom properties
│   └── data/
│       ├── knowledge-graphs/           # Pre-computed graph JSON (~6,000 files)
│       └── item-dashboards/            # Pre-computed dashboard JSON (~2,500 files)
├── scripts/
│   ├── precompute-graphs.py            # Generate knowledge graph + location map JSON
│   └── precompute-dashboards.py        # Generate dashboard JSON (all entities)
├── ROADMAP.md                          # Full visualization roadmap
└── README.md
```

## Configuration

### THEME Design Tokens

`dashboard-core.js` and `knowledge-graph.js` each define a `THEME` object. Dashboard modules share helpers (THEME, COLORS, initChart, truncateLabel) via the `window.RV` namespace. All design values flow from this config:

```javascript
var THEME = {
    darkModeEnabled: false,  // Set to true to enable auto dark mode
    accent: '#22817b',
    accentDark: '#4db6ac',
    accentLight: '#b2dfdb',
    fontSize: 11,
    fontSizeEmphasis: 13,
    labelMaxLen: 30,
    barMaxWidth: 24,
    barMaxWidthWide: 40
};
```

### CSS Custom Properties

Override in your theme for consistent styling:

```css
:root {
    --rv-bg: #fafafa;
    --rv-border: #e0e0e0;
    --rv-radius: 8px;
    --rv-heading-color: #333;
    --rv-text-color: #666;
    --rv-accent: #22817b;
}
```

### Dark Mode (Disabled by Default)

The module includes full dark mode infrastructure:

- **ECharts**: Auto-detects `prefers-color-scheme` and uses `setTheme('dark')` (ECharts 6)
- **MapLibre**: Switches basemap from CartoDB Positron to Dark Matter
- **CSS**: `.rv-dark-mode` class overrides all custom properties

To enable, set `THEME.darkModeEnabled = true` in both JS files. The CSS dark mode activates automatically via media query.

## Dependencies

Loaded via CDN (no bundling required):

- [ECharts 6](https://echarts.apache.org/)
- [echarts-wordcloud 2](https://github.com/ecomfe/echarts-wordcloud)
- [MapLibre GL 5](https://maplibre.org/)

## License

MIT
