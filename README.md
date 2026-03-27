# Resource Visualizations

An [Omeka S](https://omeka.org/s/) module that adds interactive visualizations to resource pages using [ECharts](https://echarts.apache.org/) and [MapLibre GL](https://maplibre.org/).

## Features

### Knowledge Graph (Item Pages)

A force-directed network showing the item's relationships — linked persons, subjects, locations, projects — plus other items sharing the same properties. Pre-computed for instant loading.

- Click any node to navigate to its Omeka S page
- Fullscreen mode (Escape to exit)
- Adjacency highlighting on hover

### Visualizations Dashboard (Item Pages)

For items using the **Research Sections** or **Projects** resource templates, displays:

- **Timeline** — items collected per year
- **Resource Types** — pie chart distribution
- **Geographic Origins** — MapLibre GL map with clustered markers
- **Languages** — horizontal bar chart
- **Subjects** — word cloud
- **Top Associated Persons** — bar chart
- **Items per Project** — bar chart (sections only)

All chart elements are clickable, linking to the corresponding Omeka S item page.

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

Generates one JSON file per item (~4000 files):

```bash
python3 scripts/precompute-graphs.py
```

### Section & Project Dashboards

Generates dashboard JSON for research sections and projects:

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
│   └── partials/dashboard-charts.phtml # Shared chart rendering
├── asset/
│   ├── js/
│   │   ├── knowledge-graph.js          # Graph loading + ECharts rendering
│   │   └── dashboard.js                # Dashboard loading + charts + map
│   ├── css/
│   │   └── resource-visualizations.css # Styles with CSS custom properties
│   └── data/
│       ├── knowledge-graphs/           # Pre-computed graph JSON (per item)
│       ├── section-dashboards/         # Pre-computed section JSON (6 files)
│       └── project-dashboards/         # Pre-computed project JSON (~36 files)
└── scripts/
    ├── precompute-graphs.py            # Generate knowledge graph JSON
    └── precompute-dashboards.py        # Generate section + project JSON
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
