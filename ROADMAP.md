# Visualization Roadmap

Comprehensive plan for adding interactive visualizations to all entity types in the Omeka S instance, inspired by the [WissKI Dashboard](https://github.com/fmadore/WissKI-dashboard).

## Current State

| Entity | Knowledge Graph | Dashboard Charts | Map | Status |
|---|---|---|---|---|
| Research Items | Force-directed graph | Timeline, Types, Languages, Subjects, Contributors | MapLibre clustered | Done |
| Research Sections (6) | Force-directed graph | Stacked Timeline, Timeline, Gantt, Beeswarm, Types, Languages, Roles, Heatmap, Subjects, Sunburst, Locations, Chord, Contributor Network, Contributors, Projects, Sankey | MapLibre clustered | Done |
| Projects (36 with data) | Force-directed graph | Stacked Timeline, Timeline, Types, Languages, Roles, Heatmap, Subjects, Sunburst, Locations, Chord, Contributor Network, Contributors, Sankey | MapLibre clustered | Done |
| People (~1 242) | Force-directed graph | Timeline, Types, Languages, Subjects, Co-authors, Contributor Network | MapLibre clustered | Done |
| Institutions (~552) | Force-directed graph | Timeline, Types, Languages, Contributors, Subjects, Collaboration Network, Affiliation Network | MapLibre clustered | Done |
| Locations (~161) | Force-directed graph | Self-location MiniMap, Timeline, Types, Languages, Contributors, Subjects | — | Done |
| Subjects (~1 437) | Force-directed graph | Timeline, Types, Languages, Co-subjects, Contributors | MapLibre clustered | Done |
| Languages (28) | — | Timeline, Types, Subjects, Contributors | MapLibre clustered | Done |
| Resource Types (16) | — | Timeline, Languages, Subjects, Contributors | MapLibre clustered | Done |
| Genres (124) | — | Timeline, Types, Languages, Contributors | — | Done |

### Completed phases

**Phase 1 — Extend to All Entity Types** ✓
All entity types now have knowledge graphs + dashboards using shared chart builders.

**Phase 2 — Advanced Visualizations** ✓
Gantt, Heatmap, Chord Diagram, and Collaboration Network for relevant entity types.

**Phase 3 — Complex Data Flows** (partial) ✓
Sankey, Sunburst, and Stacked Timeline implemented. Beeswarm and Compare View remain.

---

## Tier 1 — Complete Phase 3 ✓

Finished.

| Visualization | Entity Types | Description | Data source |
|---|---|---|---|
| **Beeswarm Chart** | Sections | Projects plotted by section (y-axis) × start year (x-axis), bubble size = item count. Gives an at-a-glance view of research activity density across sections and time. | `dcterms:temporal` on projects + `children_of` item counts |
| **Compare View** | Projects | Side-by-side comparison of two projects: stacked timeline, resource types, languages, subjects, plus overlap statistics (shared subjects %). | Fetches two project dashboard JSONs and renders paired charts |

### Architecture notes

- **Beeswarm**: new `dashboard-charts-beeswarm.js` module. Precompute adds `beeswarm` key to section dashboards. Uses ECharts scatter with jitter.
- **Compare View**: new `CompareProjects` block layout + `dashboard-compare.js`. Selector UI for picking two projects, fetches both JSONs, renders 2-column comparison grid.

---

## Tier 2 — Port Proven WissKI Patterns ✓

Implemented. Contributor Network on 694 persons + 36 projects + 6 sections. Affiliation Network on 12 institutions. Roles on 6 sections + 36 projects.

| Visualization | Entity Types | Description | Data source |
|---|---|---|---|
| **Contributor Network** | People, Projects | Force-directed graph showing person → project links. Reveals collaboration clusters beyond the institution level. | `marcrel:*` / `dcterms:creator` / `dcterms:contributor` reverse links |
| **Affiliation Network** | Organisations | Person → institution affiliation links. Shows who is affiliated where and how institutions connect through people. | `dcterms:isPartOf` on persons |
| **Contributor Role Breakdown** | Sections, Projects | Pie or stacked bar showing the proportion of different MARC relator roles (author, collector, photographer, interviewer, etc.). Omeka S has 54 distinct `marcrel:*` roles across 2 899 research items. | Aggregate `marcrel:*` terms per item |

### Architecture notes

- **Contributor Network**: `dashboard-charts-contributor-network.js` with shared bipartite graph builder. `contributorNetwork` key on person, project, and section dashboards.
- **Affiliation Network**: same module, `buildAffiliationNetwork` builder. `affiliationNetwork` key on organisation dashboards.
- **Role Breakdown**: uses existing `buildBarChart` builder via `roles` key. Precomputed as `[{name, value}]` from `marcrel:*` labels.

---

## Tier 3 — New High-Impact Visualizations ✓

Implemented. Subject Trends on 6 sections + 21 projects. Language Timeline on 6 sections + 14 projects. Treemap on 6 sections + 36 projects. Geo Flows on 5 sections + 9 projects.

| Visualization | Entity Types | Description | Data source |
|---|---|---|---|
| **Subject Temporal Trends** | Sections, Projects | Stacked area or small multiples showing how top-N subjects evolve over years. Reveals shifting research focus. | `dcterms:subject` × `dcterms:issued` year aggregation |
| **Geographic Flow Map** | Sections, Projects | Arc lines from item origins (`dcterms:spatial`) to current locations (`dcterms:provenance`). Shows material movement patterns — highly relevant for African studies collections. | `dcterms:spatial` + `dcterms:provenance` pairs with `geo:lat`/`geo:long` |
| **Treemap** | Sections, Projects | Hierarchical space-filling chart: Section → Project → Resource Type, sized by item count. Good alternative to sunburst for showing proportions. | `dcterms:isPartOf` hierarchy + `dcterms:type` |
| **Language × Time Stacked Area** | Sections, Projects | Stacked area chart showing how language distribution evolves over years. Reveals the multilingual character of the research over time. | `dcterms:language` × year aggregation |

### Architecture notes

- `dashboard-charts-stacked-area.js` — shared stacked area builder for subject trends and language timeline.
- `dashboard-charts-treemap.js` — ECharts native treemap with project → type hierarchy.
- `dashboard-charts-geo-flows.js` — MapLibre flow map with origin/current location markers and arc lines.
- Precompute functions: `build_subject_trends`, `build_language_timeline`, `build_treemap`, `build_geo_flows`.

---

## Tier 4 — Polish & Exploration

Lower-priority items that add analytical depth.

| Visualization | Entity Types | Description |
|---|---|---|
| **Radar/Spider Chart** | Projects, People | Multi-axis profile (items, languages, subjects, contributors, year span). Quick visual comparison of entities. |
| **Alluvial/Bump Chart** | Subjects, Languages | Rank changes over time — which subjects/languages rise and fall in prominence. |
| **Scatter Plot** | Sections | X = contributors, Y = items per project, bubble = year span. Reveals collaborative vs. solo projects. |
| **Cross-entity Comparison** | Any entity type | Generalize Compare View beyond projects: compare two people, two institutions, two subjects side-by-side. |
| **Box Plot / Violin** | Sections | Distribution of items-per-project within a section. Shows spread, not just totals. |

---

## Data Architecture

All visualizations use precomputed JSON files stored in `asset/data/`:

```
asset/data/
├── knowledge-graphs/       # One per item — gitignored, regenerated in-Omeka
└── item-dashboards/        # One per entity with data (incl. publications.json)
```

**Everything** regenerates inside Omeka via the admin "Regenerate now" button — a
pure-PHP engine under `src/Precompute/` (`DataLoader` → `Aggregators` / `KnowledgeGraphs`
→ `Runner`) that reuses Omeka's own database connection. No Python, shell access, or extra
credentials — the module ships **zero** Python.

The knowledge-graph JSON (~6 000 files) is **not committed** — it regenerates on demand;
until then the front-end falls back to a lighter live REST-API graph.

### Omeka S data summary

| Entity | Count | Key properties |
|---|---|---|
| Research Items | 2 899 | 54 `marcrel:*` roles, `dcterms:subject` (16 187), `dcterms:format` (12 078), `dcterms:spatial` (4 988), `dcterms:language` (2 079) |
| Persons | 1 242 | Affiliations via `dcterms:isPartOf` |
| Authority (Subjects) | 1 437 | LCSH URIs + free-text tags |
| Institutions | 552 | `foaf:Organization` |
| Locations | 161 | `geo:lat`/`geo:long` coordinates |
| Projects | 92 | `dcterms:temporal` intervals, section membership |
| Languages | 28 | ISO 639-2 codes |
| Genres | 124 | MARC genre classifications |
| Research Sections | 6 | Hierarchical: section → projects → items |

## Module architecture

JavaScript is modular — one file per concern:

```
asset/js/
├── dashboard-core.js               # THEME, COLORS, helpers (window.RV namespace)
├── dashboard-layouts.js             # Per-resource-type layout configs
├── dashboard-charts-basic.js        # Timeline, pie, bar, word cloud
├── dashboard-charts-advanced.js     # Gantt, heatmap, chord, sankey, sunburst, stacked
├── dashboard-charts-beeswarm.js     # Beeswarm scatter (Tier 1)
├── dashboard-charts-map.js          # Geographic maps + mini map
├── dashboard-collab-network.js      # Institution collaboration force graph
├── dashboard-charts-contributor-network.js  # Bipartite: contributor + affiliation networks (Tier 2)
├── dashboard-charts-stacked-area.js # Subject trends + language timeline (Tier 3)
├── dashboard-charts-treemap.js      # Hierarchical treemap (Tier 3)
├── dashboard-charts-geo-flows.js    # Origin → current location flow map (Tier 3)
├── dashboard-compare.js             # Compare View (Tier 1)
├── dashboard-registry.js            # CHART_MAP, CHART_LABELS, CHART_DESCRIPTIONS
├── dashboard.js                     # Orchestrator (async + inline rendering)
└── knowledge-graph.js               # Graph + item map rendering
```

## Regeneration

After data changes, click **Admin → Modules → Resource Visualizations → "Regenerate now"** — one in-Omeka, pure-PHP job rebuilds the dashboards, communities, publications **and** the per-item knowledge graphs. No Python.

To pull a new module **release** into the container:

```bash
docker compose exec php omeka-s-cli module:download --base-path /var/www/html --force gh:fmadore/ResourceVisualizations
docker compose restart php
```
