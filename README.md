# Resource Visualizations

An [Omeka S](https://omeka.org/s/) module that adds interactive visualizations to resource pages using [ECharts](https://echarts.apache.org/) and [MapLibre GL](https://maplibre.org/).

## Features

### Knowledge Graph (Item Pages)

A force-directed network showing the item's relationships. For items with rich outgoing links (research items, projects, people), shows linked persons, subjects, locations, and other items sharing the same properties. For items that are primarily linked TO (subjects, languages, locations, genres), shows the research items that reference them.

- Pre-computed JSON for instant loading, regenerated in-Omeka (live REST-API fallback when absent)
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
| Contributor Roles | x | x | x | | | | | | |
| Heatmap (type x language) | x | x | | | | | | | |
| Subjects (word cloud) | x | x | x | x | x | | x | x | |
| Subject Trends over Time | x | x | | | | | | | |
| Sunburst (type > language > subject) | x | x | | | | | | | |
| Treemap (project x type) | x | x | | | | | | | |
| Geographic Origins (map) | x | x | x | x | | | x | x | |
| Origin > Current Location (flow map) | x | x | | | x | | | | |
| Items by Country (choropleth) | x | x | | | | | | | |
| Self-location MiniMap | | | | | x | | | | |
| Profile (radar) | | x | x | x | | | | | |
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

### Category Overviews (Item Pages)

Parent/category items get aggregate dashboards spanning their entire item set. Each overview includes a ranked distribution bar chart of the category members plus contextual charts:

| Overview | Item ID | Distribution Chart | Additional Charts |
|---|---|---|---|
| Genre | 22198 | Top genres (124) | Stacked timeline, types, languages, roles, heatmap, subjects, subject trends |
| Language | 2039 | Top languages (28) | Stacked timeline, language timeline, types, roles, heatmap, subjects, subject trends |
| Resource Type | 22203 | Top types (16) | Stacked timeline, languages, roles, heatmap, subjects, subject trends |
| Target Audience | 22479 | Top audiences (49) | Stacked timeline, types, languages, subjects |
| Person | 22200 | Top persons (1,242) | Stacked timeline, types, languages, roles, heatmap, subjects, subject trends, choropleth |
| Institution | 22202 | Top institutions (552) | Stacked timeline, types, languages, roles, subjects, subject trends, choropleth |
| Group | 22536 | Top groups | Stacked timeline, types, languages, roles, heatmap, subjects, subject trends |
| LCSH Subjects | 3167 | Top LCSH subjects (418) | Stacked timeline, types, languages, roles, heatmap, subjects, subject trends |
| Tags | 22199 | Top tags (773) | Stacked timeline, types, languages, roles, heatmap, subjects, subject trends |
| Research Project | 3346 | Top projects (36) | Stacked timeline, language timeline, gantt, beeswarm, types, languages, roles, heatmap, subjects, subject trends, choropleth |

### Compare Projects

Side-by-side comparison of two projects with paired charts (stacked timeline, resource types, languages, subjects) and overlap statistics (shared subject percentage, shared subject badges). Accessible as a resource page block.

### Discursive Communities

A collection-wide subject co-occurrence network: subjects that appear together across items are clustered into communities (Louvain) and sized by influence (PageRank), each community a distinct colour. Added as a **site-page block** (Admin > Sites > [site] > Pages), it loads `asset/data/communities/discursive.json`. Defaults to LCSH-only subjects to cut free-text-tag noise. Click any subject to open its page.

### Publications

A bibliographic analytics view over every `fabio:`-classed publication (articles, books, chapters, working papers, …). Added as a **site-page block** (Admin > Sites > [site] > Pages), it loads `asset/data/item-dashboards/publications.json` and shows:

- a **by-resource-template** breakdown (Article vs. Book vs. Chapter …) and publications per year;
- **top venues** (`dcterms:isPartOf`) and **top authors** (`bibo:authorList`, unifying literal names with linked Person records);
- a **co-author network** — authors who appear together on a publication, clustered into collaboration communities (Louvain), with authors that match a Person record **ringed** to distinguish them from external names;
- a **keyword co-occurrence** chord over `dcterms:subject`.

Authors matched to Person records and subjects matched to Authority/LCSH records are clickable through to their pages. The same **By Resource Template** chart also appears on person and organisation dashboards, and a person's authored publications now surface on their own dashboard.

### Item Set Dashboard

Inline dashboard for item set pages with server-side aggregation.

#### Chart Features

- **Toolbox**: Save-as-image (2x resolution) and restore on all ECharts charts
- **Word count slider**: Adjust the number of words displayed in the word cloud (5 to max)
- **DataZoom**: Interactive slider on timeline charts with >15 data points
- **ARIA**: Screen reader descriptions on all charts; global decal pattern toggle for accessibility (excluded on wordcloud, chord, heatmap, and sankey where patterns are not meaningful)
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

Visualizations load from pre-computed JSON in `asset/data/`. **Everything regenerates inside Omeka** — no Python, shell access, or extra credentials.

**Admin → Modules → Resource Visualizations → "Regenerate now"** dispatches an Omeka background job (`src/Precompute/`, pure PHP) that rebuilds, straight from the Omeka database via Omeka's own connection:

- per-entity & category **dashboards** + the **collection overview**
- the **Discursive Communities** graph
- the **Publications** analytics (`publications.json`)
- the per-item **knowledge graphs** + item location maps

Watch progress and any errors at **Admin → Jobs → the job's log**. Re-run after importing or substantially editing items.

> `asset/data/knowledge-graphs/` is **not** committed to the repo (≈6,000 files) — it regenerates on demand. Until the first "Regenerate now", the knowledge-graph block falls back to a lighter live REST-API graph.

### Updating the module

To pull a new module **release** into the container:

```bash
docker compose exec php omeka-s-cli module:download --base-path /var/www/html --force gh:fmadore/ResourceVisualizations
docker compose restart php
```

Then click **"Regenerate now"** to rebuild the precomputed data.

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
│   │   ├── dashboard-charts-timeline.js          # Timeline (bar by year)
│   │   ├── dashboard-charts-pie.js               # Pie/donut chart
│   │   ├── dashboard-charts-bar.js               # Horizontal bar chart (top 20)
│   │   ├── dashboard-charts-wordcloud.js         # Word cloud with slider
│   │   ├── dashboard-charts-gantt.js             # Gantt chart (project timelines)
│   │   ├── dashboard-charts-heatmap.js           # Heatmap (type × language)
│   │   ├── dashboard-charts-chord.js             # Chord diagram (co-occurrence)
│   │   ├── dashboard-charts-sankey.js            # Sankey flow diagram
│   │   ├── dashboard-charts-sunburst.js          # Sunburst hierarchy
│   │   ├── dashboard-charts-stacked-timeline.js  # Stacked bar by year and type
│   │   ├── dashboard-charts-beeswarm.js          # Beeswarm scatter (projects by year)
│   │   ├── dashboard-charts-map.js               # Geographic origins map, mini map
│   │   ├── dashboard-charts-stacked-area.js      # Subject trends, language timeline
│   │   ├── dashboard-charts-treemap.js           # Hierarchical treemap
│   │   ├── dashboard-charts-geo-flows.js         # Origin → current location flow map
│   │   ├── dashboard-charts-choropleth.js        # Country choropleth (MapLibre fill)
│   │   ├── dashboard-charts-radar.js             # Entity breadth-profile radar (ECharts)
│   │   ├── dashboard-charts-communities.js       # Discursive communities force graph
│   │   ├── dashboard-communities.js              # Discursive Communities block controller
│   │   ├── dashboard-charts-contributor-network.js # Contributor + affiliation networks
│   │   ├── dashboard-collab-network.js           # Institution collaboration network
│   │   ├── dashboard-compare.js                  # Compare Projects controller
│   │   ├── dashboard-registry.js                 # CHART_MAP, labels, descriptions
│   │   └── dashboard.js                          # Orchestrator: render + async/inline init
│   ├── css/
│   │   └── resource-visualizations.css # Styles with CSS custom properties
│   └── data/
│       ├── geo/
│       │   └── countries.geojson       # Natural Earth 110m boundaries (choropleth)
│       ├── communities/
│       │   └── discursive.json         # Subject co-occurrence + Louvain communities
│       ├── knowledge-graphs/           # Per-item graph JSON — gitignored, regenerated in-Omeka
│       └── item-dashboards/            # Pre-computed dashboard JSON (incl. publications.json)
├── src/Precompute/                     # PHP precompute engine (admin "Regenerate now")
│   ├── DataLoader.php                  # Items/links/literals/geo via Omeka\Connection
│   ├── Aggregators.php                 # aggregateItems(), all build*() (unit-tested)
│   ├── KnowledgeGraphs.php             # Per-item knowledge-graph builder (IDF-ranked)
│   └── Runner.php                      # Entities, overviews, publications, knowledge graphs
├── ROADMAP.md                          # Full visualization roadmap
└── README.md
```

The front-end script chain (chart builders + registry + controller) is injected by a
single view helper — `src/View/Helper/DashboardAssets.php` (`$this->dashboardAssets(...)`).
Registering a new chart means adding its builder file to that helper's `CHART_SCRIPTS`
list once, rather than editing every dashboard/compare/overview template.

The **in-Omeka regeneration** (the admin "Regenerate" button) is a self-contained PHP
port of the precompute under `src/Precompute/` (`DataLoader` → `Aggregators` / `KnowledgeGraphs` → `Runner`),
run by the background job `src/Job/PrecomputeDashboards.php` via the admin
`src/Controller/Admin/MaintenanceController.php`. The `Aggregators` are dependency-free
and unit-testable; the job reuses Omeka's `Omeka\Connection`, so no MySQL variables or
Python are needed at runtime.

## Theming — follows the DRE theme

This module is styled to match, and stay visually consistent with, the Africa
Multiple **Digital Research Environment (DRE) theme**:

> **https://github.com/AM-Digital-Research-Environment/DRE-theme**

It does **not** define its own colours. Every surface, border, text colour,
accent, radius and shadow is taken from the DRE theme's **CSS custom properties
(design tokens)** — `--surface`, `--ink`, `--primary`, `--border`, `--radius-*`,
`--shadow-*`, … — and the chart colours are read from those same tokens at
runtime.

Because the theme re-defines its tokens for dark mode, the module
**automatically follows the active light / dark theme** — including the theme's
live toggle (`body[data-theme="dark"|"light"]`) and the system preference
(`prefers-color-scheme`). No configuration is required.

> [!IMPORTANT]
> **Always reference the DRE theme's variables — never hard-code a colour.**
> - In **CSS**, use the `--rv-*` aliases declared at the top of
>   `asset/css/resource-visualizations.css`; they map straight onto the theme
>   tokens.
> - In **JavaScript**, resolve colours with `ns.cssColor('--token', fallback)`
>   (see `asset/js/dashboard-core.js`).
>
> The `fallback` is used **only** when the module is dropped into a non-DRE
> theme that lacks the token; whenever the DRE theme is present its token wins.
> This is what keeps the module consistent with the theme and dark-mode aware.
> Both files start with a "design contract" comment restating this rule.

### How light / dark works

| Layer | Mechanism |
|---|---|
| CSS chrome (panels, buttons, sliders, popups, legends, cards) | The `--rv-*` aliases resolve theme tokens live, so they flip with `body[data-theme]` / `prefers-color-scheme` with **zero JS**. |
| ECharts charts | `dashboard-core.js` builds an ECharts theme from the tokens and re-applies it live with `chart.setTheme()` (ECharts 6) whenever the theme changes. |
| MapLibre maps | Basemap switches between CartoDB Positron (light) and Dark Matter (dark); maps rebuild with the new basemap + marker colours on toggle. |

The active theme is watched in `dashboard-core.js` (`ns.refresh()`) via a
`MutationObserver` on `body[data-theme]` plus a `prefers-color-scheme` listener.

### CSS tokens used (alias → DRE theme token)

| Module alias (`--rv-*`) | DRE theme token(s) |
|---|---|
| `--rv-bg`, `--rv-bg-raised`, `--rv-bg-sunken`, `--rv-overlay` | `--surface`, `--surface-raised`, `--surface-sunken`, `--surface-overlay` |
| `--rv-border`, `--rv-border-light`, `--rv-border-strong` | `--border`, `--border-light`, `--border-strong` |
| `--rv-heading-color`, `--rv-text-strong`, `--rv-text-color` | `--ink-strong`, `--ink`, `--ink-light` |
| `--rv-accent`, `--rv-accent-hover`, `--rv-accent-contrast` | `--primary`, `--primary-hover`, `--primary-contrast` |
| `--rv-radius`, `--rv-radius-sm` | `--radius-lg`, `--radius-sm` |
| `--rv-shadow`, `--rv-shadow-sm`, `--rv-focus-ring` | `--shadow-lg`, `--shadow-sm`, `--ring-focus` |

### Chart tokens used (`THEME` key → DRE theme token)

`dashboard-core.js`'s shared `THEME` object is populated from these tokens on
load and on every theme change:

| `THEME` key | DRE theme token | Used for |
|---|---|---|
| `accent` | `--primary` | map markers, network hubs, flow lines, accents |
| `text` / `heading` | `--ink` / `--ink-strong` | chart text, titles |
| `textMuted` | `--ink-light` | axis labels, secondary text |
| `border` | `--surface` | segment gaps, marker outlines |
| `grid` / `gridLight` | `--border` / `--border-light` | axis lines, split lines |

The 20-colour categorical palette (`COLORS`) for multi-series charts is kept
theme-independent: the brand token set has only six colours, and compare-mode
relies on a stable colour-by-index mapping. The brand identity is carried by
`THEME.accent` (= `--primary`).

## Dependencies

Loaded via CDN (no bundling required):

- [ECharts 6](https://echarts.apache.org/)
- [echarts-wordcloud 2](https://github.com/ecomfe/echarts-wordcloud)
- [MapLibre GL 5](https://maplibre.org/)

## License

MIT
