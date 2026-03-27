# Visualization Roadmap

Comprehensive plan for adding interactive visualizations to all entity types in the Omeka S instance, inspired by the [WissKI Dashboard](https://github.com/fmadore/WissKI-dashboard).

## Current State

| Entity | Knowledge Graph | Dashboard Charts | Map | Status |
|---|---|---|---|---|
| Research Items | Force-directed graph | — | — | Done |
| Research Sections (6) | Force-directed graph | Timeline, Types, Languages, Subjects, Contributors, Projects | MapLibre clustered | Done |
| Projects (36 with data) | Force-directed graph | Timeline, Types, Languages, Subjects, Contributors | MapLibre clustered | Done |

## Phase 1 — Extend to All Entity Types

Reuses existing chart builders (`buildTimeline`, `buildPieChart`, `buildBarChart`, `buildWordCloud`, `buildMap`). Only requires extending the precompute script.

### People (resource template: Persons)
| Chart | Description |
|---|---|
| Timeline | Items associated with this person by year |
| Resource Types | Pie chart of item types they contributed to |
| Languages | Bar chart of languages in their items |
| Subjects | Word cloud of subjects across their items |
| Map | Geographic origins of their items |
| Co-authors | Bar chart of persons who frequently appear alongside this person |

### Institutions (resource class: foaf:Organization)
| Chart | Description |
|---|---|
| Timeline | Items linked to this institution by year |
| Resource Types | Pie chart of item types |
| Languages | Bar chart |
| Subjects | Word cloud |
| Map | Geographic origins |
| Top Associated Persons | Bar chart of people most linked to this institution's items |

### Locations (resource template: Location)
| Chart | Description |
|---|---|
| Self-location MiniMap | Single marker showing this location's coordinates |
| Timeline | Items from this location by year |
| Resource Types | Pie chart |
| Languages | Bar chart |
| Subjects | Word cloud |
| Top Associated Persons | Bar chart |

### Subjects (resource template: Authority)
| Chart | Description |
|---|---|
| Timeline | Items about this subject by year |
| Resource Types | Pie chart |
| Languages | Bar chart |
| Top Associated Persons | Bar chart |
| Co-occurring Subjects | Bar chart of subjects that frequently appear alongside this one |

### Languages (item set: Languages)
| Chart | Description |
|---|---|
| Timeline | Items in this language by year |
| Resource Types | Pie chart |
| Subjects | Word cloud |
| Top Associated Persons | Bar chart |
| Map | Geographic origins |

### Resource Types (item set: Type of Resource)
| Chart | Description |
|---|---|
| Timeline | Items of this type by year |
| Languages | Bar chart |
| Subjects | Word cloud |
| Top Associated Persons | Bar chart |
| Map | Geographic origins |

### Genres (item set: Genres)
| Chart | Description |
|---|---|
| Timeline | Items of this genre by year |
| Resource Types | Pie chart |
| Languages | Bar chart |
| Top Associated Persons | Bar chart |

## Phase 2 — Advanced Visualizations

New chart types requiring additional JS builders.

| Visualization | Entity Types | Description |
|---|---|---|
| **Gantt Chart** | Sections, Projects | Project timelines with start/end dates |
| **Heatmap** | Sections, Projects | Resource type x language cross-tabulation |
| **Chord Diagram** | Projects, Subjects | Co-occurrence relationships (e.g., subject pairs) |
| **Network Graph** | People, Institutions | Co-authorship and collaboration networks |

## Phase 3 — Complex Data Flows

| Visualization | Entity Types | Description |
|---|---|---|
| **Sankey Chart** | Projects | Contributor → Project → Resource Type flow |
| **Sunburst Chart** | Projects, Sections | Type → Language → Subject hierarchy |
| **Beeswarm Chart** | Sections | Projects by section x year, bubble size = item count |
| **Stacked Timeline** | Sections, Projects | Items by year stacked by resource type |
| **Compare View** | Projects | Side-by-side comparison of two projects |

## Data Architecture

All visualizations use precomputed JSON files stored in `asset/data/`:

```
asset/data/
├── knowledge-graphs/       # One per item (~4000 files)
└── item-dashboards/        # One per entity with data
```

Precompute scripts in `scripts/`:
- `precompute-graphs.py` — knowledge graph JSON for all items
- `precompute-dashboards.py` — dashboard JSON for all entity types

Both use `docker compose exec` to query MySQL directly. No Omeka S API or PHP needed.

## Regeneration

After data changes, regenerate:

```bash
python3 scripts/precompute-graphs.py
python3 scripts/precompute-dashboards.py
```

Then update the module in the container:

```bash
cd /path/to/omeka-s-docker
docker compose exec php omeka-s-cli module:download --base-path /var/www/html --force gh:fmadore/ResourceVisualizations
docker compose restart php
```
