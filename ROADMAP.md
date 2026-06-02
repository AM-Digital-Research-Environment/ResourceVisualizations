# Visualization Roadmap

Comprehensive plan for adding interactive visualizations to all entity types in the Omeka S instance, inspired by the sibling [amira dashboard](https://github.com/AM-Digital-Research-Environment/amira) (formerly the WissKI dashboard).

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

Lower-priority items that add analytical depth. Several shipped via the parity initiative — **Radar Chart**, **Cross-entity Comparison** (the generalized Compare block), and **Box Plot** are done; **Alluvial/Bump** and **Scatter** remain.

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

## Adding a new visualization — recipes & guardrails

These are the load-bearing conventions that keep the module modular, maintainable, and theme-consistent. They were proven out across the visualization-parity initiative with the sibling [amira dashboard](https://github.com/AM-Digital-Research-Environment/amira) (tracked against [amira#10](https://github.com/AM-Digital-Research-Environment/amira/issues/10)); that initiative is now **complete**, so its per-phase tracker was retired and its reusable playbook preserved here.

### The precompute → registry → builder pattern

Every per-entity chart lands as the same change across the PHP precompute and the JS front-end:

1. **Aggregator** — a pure `public static function buildX(array $itemIds, array $links, array $items, …): ?array` in `src/Precompute/Aggregators.php`, returning a JSON-serializable array **or `null`** when empty. Aggregators are dependency-free and unit-tested.
2. **Runner wiring** — call it in the right place in `src/Precompute/Runner.php` (a per-entity generator such as `addStandardCharts()` / `generatePeople()`, or an overview generator) and store it on the dashboard array: `$dashboard['x'] = Aggregators::buildX(...)`.
3. **Builder** — a vanilla-JS IIFE `asset/js/dashboard-charts-x.js` registering `window.RV.charts.buildX = function (el, data, siteBase, allData) { … }`.
4. **Registry** — add the key to `CHART_MAP`, `CHART_LABELS`, and (optionally) `CHART_DESCRIPTIONS` in `asset/js/dashboard-registry.js`.
5. **Layout** — add the key to the relevant entity layout's `order` (and `wide`/`tall`) in `asset/js/dashboard-layouts.js`.
6. **Asset include** — add `dashboard-charts-x.js` to `DashboardAssets::CHART_SCRIPTS` in `src/View/Helper/DashboardAssets.php` (the single source of truth for the builder chain — add it here and nowhere else).
7. **Test** — add a mock-data case to `tests/AggregatorsTest.php`.
8. **Regenerate** — Admin → Resource Visualizations → "Regenerate now" rebuilds the JSON in-Omeka.

The orchestrator (`asset/js/dashboard.js`) reads `LAYOUTS[data.resourceType]`, **auto-hides any key whose data is empty/null**, and calls `CHART_MAP[key](el, data[key], siteBase, data)` — the 4th argument is the whole dashboard object, which is how data-driven overlays work (see `geoFlows`).

### Cross-cutting features are site-page block layouts, not resource-page blocks

- **`src/Site/BlockLayout/Xxx.php`** extends `Omeka\Site\BlockLayout\AbstractBlockLayout`, registered in `config/module.config.php` under **`block_layouts.invokables`**. These attach to **site pages** (Admin → Sites → [site] → Pages) — where archive-wide views belong. Collection Overview, Compare, Project Explorer, What's New, Discursive Communities, Publications, and Photo Browsing all follow this path (**Recipe B**).
- **`src/Site/ResourcePageBlockLayout/Xxx.php`** (implements `ResourcePageBlockLayoutInterface`, declares `getCompatibleResourceNames()`) is reserved for blocks bound to a single item / item-set page — Knowledge Graph, Item Set Dashboard, Linked Items Dashboard, Sibling-items Sparkline.

### Theme: read DRE tokens, never hard-code

The module styles itself entirely from the [DRE theme](https://github.com/AM-Digital-Research-Environment/DRE-theme) design tokens and follows light/dark automatically:

- **In JS**, resolve every colour through `ns.cssColor('--token', fallback)`. The categorical palette `ns.COLORS` (20 hues) is the only sanctioned theme-independent set (compare-mode needs a stable colour-by-index map); brand identity is carried by `THEME.accent` (= `--primary`).
- **ECharts**: create instances with `ns.initChart(el)`. For graph/structural charts whose per-node/edge colours must re-resolve on toggle, set `chart._rvRebuild`.
- **MapLibre**: register every map with `ns.trackMap(map, rebuild)` and pick the basemap with `ns.getBasemapStyle()`; maps are *rebuilt* on theme toggle.
- **In CSS**, use the `--rv-*` aliases at the top of `asset/css/resource-visualizations.css`. Never introduce a raw hex.

### Other invariants

- **No bundling.** ECharts 6, echarts-wordcloud 2, and MapLibre GL 5 stay CDN-loaded (via `DashboardAssets`).
- **Reuse `window.RV`** (`THEME`, `COLORS`, `initChart`, `truncateLabel`, `toEntries`, `addClickHandler`, `attachToolbar`, `trackMap`, `getBasemapStyle`, `cssColor`). No new globals.
- **Overlays over panels.** When a new signal belongs on an existing chart, write it as an extra key the existing builder reads from its 4th `data` argument (the `geoFlows`-on-`locations` pattern) rather than a new panel.
- **Empty = hidden.** Aggregators return `null` and the orchestrator silently drops empty panels — so adding a key to a layout is safe even if only some entities populate it.

### Recipe A — add a per-entity chart

| Step | File | Change |
|---|---|---|
| 1 | `src/Precompute/Aggregators.php` | `public static function buildX(...): ?array` → array or `null`. |
| 2 | `src/Precompute/Runner.php` | Call it in the right generator; `$dashboard['x'] = Aggregators::buildX(...)`. |
| 3 | `asset/js/dashboard-charts-x.js` | New IIFE builder registering `ns.charts.buildX`. |
| 4 | `asset/js/dashboard-registry.js` | `CHART_MAP['x'] = c.buildX;` + `CHART_LABELS` + `CHART_DESCRIPTIONS`. |
| 5 | `asset/js/dashboard-layouts.js` | Add `'x'` to the chosen layouts' `order`/`wide`/`tall`. |
| 6 | `src/View/Helper/DashboardAssets.php` | Add `dashboard-charts-x.js` to `CHART_SCRIPTS`. |
| 7 | `tests/AggregatorsTest.php` | Mock-data case for `buildX`. |
| 8 | Admin → Regenerate now | Rebuild JSON in-Omeka (pure PHP). |

### Recipe B — add a cross-cutting site-page block

| Step | File | Change |
|---|---|---|
| 1 | `src/Site/BlockLayout/Xxx.php` | `extends AbstractBlockLayout`; `getLabel()`, `form()` (config or "no configuration needed"), `render()` → partial. |
| 2 | `config/module.config.php` | Register `'xxx' => Site\BlockLayout\Xxx::class` under `block_layouts.invokables`. |
| 3 | `view/common/block-layout/xxx.phtml` | Call `$this->dashboardAssets(['cdn' => true, 'controller' => 'xxx'])` (or a lean prelude), emit a `.xxx-container` + spinner. |
| 4 | `asset/js/dashboard-xxx.js` + `DashboardAssets::CONTROLLERS` | Controller IIFE that fetches its JSON, builds UI, renders via `CHART_MAP`; register the chain under `CONTROLLERS['xxx']`. |
| 5 | *(if data-driven)* `src/Precompute/{Aggregators,Runner}.php` | New aggregator emitting an index/feed JSON under `asset/data/`. |
| 6 | README | Document adding the block (Admin → Sites → [site] → Pages). |

### Recipe C — add stat cards to a dashboard

Stat cards (icon + value + label + optional subtitle) are a reusable component spanning precompute → JSON → render. Any dashboard that emits a `stats` array gets a card grid at the top — no template or controller change.

| Step | File | Change |
|---|---|---|
| 1 | `src/Precompute/Runner.php` | In the generator, compute the counts (the standard precompute way) and `$dashboard['stats'] = Aggregators::buildStatCards([['key'=>…,'label'=>…,'value'=>…,'subtitle'=>…?], …]);`. The assembler casts values, drops non-positive cards and clears empty subtitles. |
| 2 | `asset/js/dashboard-stat-cards.js` | *(only if a card needs a new glyph)* add the lucide path to `ICONS` under its `key`, or map a synonym in `ALIAS`. Unknown keys already fall back to a generic icon. |
| 3 | `tests/AggregatorsTest.php` | Cover any non-trivial counting you added. (`buildStatCards` itself is already tested.) |
| 4 | Admin → Regenerate now | Rebuild JSON in-Omeka. |

The renderer (`ns.renderStatCards`, wired into `dashboard.js`) is shared, so the card grid is consistent everywhere and follows the DRE light/dark theme. The Collection Overview is the first consumer (`Runner::buildOverviewStats`).

## Regeneration

After data changes, click **Admin → Modules → Resource Visualizations → "Regenerate now"** — one in-Omeka, pure-PHP job rebuilds the dashboards, communities, publications **and** the per-item knowledge graphs. No Python.

To pull a new module **release** into the container:

```bash
docker compose exec php omeka-s-cli module:download --base-path /var/www/html --force gh:fmadore/ResourceVisualizations
docker compose restart php
```
