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

### Visualizations Dashboard (Item Pages)

Contextual charts adapted per entity type. All chart elements are clickable, linking to the corresponding Omeka S item page. 2,551 dashboards pre-computed across all entity types.

#### Charts by Entity Type

| Chart | Sections | Projects | People | Institutions | Locations | Subjects | Languages | Types | Genres |
|---|---|---|---|---|---|---|---|---|---|
| Stacked Timeline | x | x | | | | | | | |
| Timeline | x | x | x | x | x | x | x | x | x |
| Gantt (project timelines) | x | | | | | | | | |
| Resource Types (pie) | x | x | x | x | x | x | x | | x |
| Heatmap (type x language) | x | x | | | | | | | |
| Sankey (contributor > project > type) | x | x | | | | | | | |
| Sunburst (type > language > subject) | x | x | | | | | | | |
| Geographic Origins (map) | x | x | x | x | | | x | x | |
| Self-location MiniMap | | | | | x | | | | |
| Languages | x | x | x | x | x | x | | x | x |
| Subjects (word cloud) | x | x | x | x | x | | x | x | |
| Subject Co-occurrence (chord) | x | x | | | | | | | |
| Top Associated Persons | x | x | | x | x | x | x | x | x |
| Co-authors | | | x | | | | | | |
| Co-occurring Subjects | | | | | | x | | | |
| Items per Project | x | | | | | | | | |

Maps include fullscreen mode, clustered markers sized by item count, and paginated popups listing associated items with links.

## Installation

Download via Omeka S CLI:

```bash
docker compose exec php omeka-s-cli module:download --base-path /var/www/html gh:fmadore/ResourceVisualizations
```

Then activate in **Admin > Modules**.

### Configure Resource Pages

Go to **Admin > Sites > [site] > Theme > Configure resource pages**:

- **Item page**: add "Knowledge Graph" and "Visualizations" blocks
- **Item set page**: add "Item Set Dashboard" block (optional)

## Pre-computing Data

Visualizations load from pre-computed JSON files stored in the module's `asset/data/` directory. Two Python scripts generate these files by querying the Omeka S MySQL database through `docker compose exec` (no port exposure needed).

### Requirements

- Python 3
- `pymysql` (`sudo apt-get install python3-pymysql`)
- The omeka-s-docker directory must be adjacent to this module, or set `OMEKA_DOCKER_DIR`

### Knowledge Graphs

Generates one JSON file per item (~6,000 files):

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
│   └── ItemSetDashboard.php            # Item set pages — dashboard block
├── view/common/resource-page-block-layout/
│   ├── knowledge-graph.phtml           # Lightweight async container
│   ├── linked-items-dashboard.phtml    # Lightweight async container
│   ├── item-set-dashboard.phtml        # Server-side rendered
│   └── partials/dashboard-charts.phtml # Shared chart rendering (inline mode)
├── asset/
│   ├── js/
│   │   ├── knowledge-graph.js          # Graph: precomputed JSON + API fallback
│   │   └── dashboard.js                # All chart builders + async loading
│   ├── css/
│   │   └── resource-visualizations.css # Styles with CSS custom properties
│   └── data/
│       ├── knowledge-graphs/           # Pre-computed graph JSON (~6,000 files)
│       └── item-dashboards/            # Pre-computed dashboard JSON (~2,500 files)
├── scripts/
│   ├── precompute-graphs.py            # Generate knowledge graph JSON
│   └── precompute-dashboards.py        # Generate dashboard JSON (all entities)
├── ROADMAP.md                          # Full visualization roadmap
└── README.md
```

## Theming

Override CSS custom properties in your theme:

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

## Dependencies

Loaded via CDN (no bundling required):

- [ECharts 6](https://echarts.apache.org/)
- [echarts-wordcloud 2](https://github.com/ecomfe/echarts-wordcloud)
- [MapLibre GL 5](https://maplibre.org/)

## License

MIT
