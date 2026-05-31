# Visualization Parity Roadmap

Tracks the module half of the parity initiative opened by [AM-Digital-Research-Environment/amira#10](https://github.com/AM-Digital-Research-Environment/amira/issues/10) — bringing this Omeka S module and the sibling [amira dashboard](https://github.com/fmadore/WissKI-dashboard) (SvelteKit) to analytical parity over the same Africa Multiple research data.

The two projects complement each other:

- **This module** is *per-entity-heavy*: every entity type gets a full inline dashboard (7–20 charts) rendered on its Omeka page from precomputed JSON. Weak on cross-cutting analytics — there is no single lens onto the whole archive.
- **The dashboard** is *broad-overview-heavy*: rich cross-cutting tools (`/network`, `/project-explorer`, `/compare/[type]`, `/whats-new`, `/collections/[slug]`, `/publications`), weaker per-entity detail.

A user should find roughly the same analytical toolkit on either side. This document captures what to port, how to port it within the module's established architecture, and in what order — **modular, maintainable, and theme-driven throughout**.

The dashboard-side roadmap lives at [WissKI-dashboard/ROADMAP-parity.md](https://github.com/fmadore/WissKI-dashboard/blob/main/ROADMAP-parity.md).

---

## Revision note — 2026-05-29

This revision was rewritten after re-verifying **both** codebases against their current state (the original roadmap was drafted 2026-04-24; the dashboard has grown since).

**What the dashboard gained since the original roadmap** (verified against `src/routes/` and `src/lib/components/charts/`):

- **Publications suite** (`/publications`) — the largest addition. Co-authorship `NetworkGraph`, keyword co-occurrence `ChordDiagram`, faceted bibliography browse, BibTeX/RIS bulk export, and a tested pure-function analytics module (`publications/analytics.ts`). Sources an external ERef/EPub Bayreuth bibliography (146 → 259 records).
- **Per-list-page analytics** — the `/genres`, `/languages`, `/resource-types`, `/locations`, `/subjects` list pages now carry charts (e.g. `ChoroplethMap` + top-cities on `/locations`, `StackedAreaChart` + `HeatmapChart` on `/languages`).
- **Item-detail enhancements** — `SiblingItemsSparkline` (items in the same project over time, current item highlighted) and `SimilarItemsStrip` (semantic-kNN neighbours).
- **All five "new chart types"** from the original Phase 5 are now built and shipping in the dashboard: `CalendarHeatmap`, `ChoroplethMap`, `RadarChart`, `BoxPlot`, `TimeAwareChord`.
- Maintenance/polish: ECharts 6 regression fixes, shared chart-builder extraction (`utils/transforms/charts.ts`), re-anchoring on Africa Multiple brand colours.

**Three scope decisions taken for this revision** (recorded for traceability):

1. **Semantic embeddings are DESCOPED.** No embeddings pipeline will be built in the module. This removes the original Phase 1.1 (Semantic Embeddings scatter / `/semantic-map`) **and** the embeddings-dependent "similar-items strip." Rationale: the dashboard's vectors are Gemini-embedded and keyed by WissKI `dre_id`, which do not map to Omeka `item_id`; re-embedding locally was judged not worth the added pipeline weight and dependency surface right now. See [Descoped](#descoped-deliberately-not-porting).
2. **Publications is GATED.** The Omeka instance has **no** bibliographic records — its data model is Organisation / Location / Person / Project / Subject(Authority) / Section / Research-item only (`scripts/precompute/config.py`). The Publications suite is fully specified in [Phase 8](#phase-8-gated--publications-analytics-suite) but is not built until a bibliographic import exists.
3. **Implementation has begun.** The recommended first slice (Phase 0 → 1 → 2.1 → 2.2) is built; see status below.

## Implementation status — 2026-05-30

| Phase | Status | Notes |
|---|---|---|
| **Phase 0** — asset-include DRY | ✅ Done | `DashboardAssets` view helper is the single source of truth for the builder chain; all 4 templates collapsed to one call. |
| **Phase 1** — parity quick wins | ✅ Done | Gantt+Beeswarm on Projects overview; Group/Tag/Audience layout backfills; person-scoped `roles` on people; geo-flow overlay on locations. |
| **Phase 2.1** — Choropleth | ✅ Done | `build_choropleth` (pure-Python point-in-polygon, no shapely) + MapLibre `buildChoropleth` builder + shared `countries.geojson`; wired into sections, projects, overviews, collection. |
| **Phase 2.2** — Radar | ✅ Done | `build_radar` with per-type maxima normalisation + ECharts `buildRadar` (multi-series ready for Compare); wired into person / institution / project dashboards. |
| **Phase 3** — Discursive Communities | ✅ Done | `build_discursive_communities` (subject co-occurrence + networkx Louvain + pure-Python PageRank, no scipy) → `communities/discursive.json`; `buildCommunities` force-graph + `DiscursiveCommunities` site-page block + controller. |
| **Precompute portability** | ✅ Done | `db.py` gained a direct `pymysql` path (`DB_HOST`, reusing the container's `MYSQL_*`), so the Python pipeline runs inside the Omeka container or over a VPN, not only via local `docker compose`. See [Regeneration](#regeneration). |
| **In-Omeka regeneration** | ✅ Done | Admin "Regenerate" button → Omeka background `Job` → pure-PHP precompute (`src/Precompute/`) on Omeka's own DB connection, with logs at `/admin/job/{id}/log`. No Python/host dependency. |
| **Phase 8** — Publications suite | ✅ Done | Unblocked once `fabio:` bibliographic records landed (~172). Publications site-page block: by-template breakdown, top venues/authors, co-author network (matched persons vs. external), keyword co-occurrence. Plus a reusable `templates` breakdown across entity dashboards; people dashboards now surface `bibo:authorList` publications. **Dashboards are now PHP-only — the Python dashboard pipeline was removed.** |
| **Phase 4.1** — Project Explorer | ✅ Done | Site-page block: a project selector retunes the full project dashboard, reusing `ns.renderInto` + the existing `projects-index.json`; `?project=` deep-link. |
| **Phase 5** — Generalized Compare | ✅ Done | Compare any entity type (projects/people/institutions/subjects/languages) via a `CompareEntity` block with an in-page type switcher; per-type charts + overlap + overlaid A/B radar. New `people/institutions/subjects/languages-index.json` emitters; `CompareProjects` kept (locked to projects). |
| **Phase 2.3–2.5** — Calendar / Box Plot / Time-chord | ✅ Done | Acquisition calendar, items-per-project box plot, and a year-sliding subject chord (ECharts `timeline`) on the collection/projects/section/project overviews; `created` map added to `DataLoader`. |
| **Phase 4.2** — What's New | ✅ Done | Recent-additions feed (3/6/12-month windows off max-`created`) + most-active-projects bar; `whats-new.json` + site-page block. |
| **Phase 7.1** — Sibling sparkline | ✅ Done | Resource-page block: a research item's project cadence with the item's year marked (REST-API + the project's precomputed timeline; no precompute change). |
| **Phase 6** — Photo browsing | ✅ Done | Site-page **PhotoBrowse** block: the editor picks an item set; the view **server-renders** its image items into masonry / clustered-map / year-timeline browsers with a shared keyboard lightbox. Thumbnails are Omeka derivatives, coords/dates resolved at render time — **no precompute**. MapLibre lazy-loads only when the Map tab opens. |

All changes are precompute-and-static; regenerating dashboards populates the new keys. JS/PHP wiring is syntax- and consistency-checked; every new aggregator is unit-validated with mock data (and the choropleth point-in-polygon against the real GeoJSON, the Louvain split on a 2-cluster graph).

### Regeneration

Dashboards regenerate **inside Omeka** (pure PHP) — see [In-Omeka regeneration](#in-omeka-regeneration--done) below. The Python dashboard pipeline has been **retired** (2026-05-30); `scripts/precompute-graphs.py` (per-item knowledge-graph JSON) is the only remaining script.

### In-Omeka regeneration ✅ Done

The precompute now also runs **inside Omeka** — no Python, no shell access, no separate MySQL credentials:

- **Admin → Modules → Resource Visualizations → "Regenerate now"** dispatches an Omeka background `Job` (`src/Job/PrecomputeDashboards.php`); progress + errors stream to `/admin/job/{id}/log`.
- The job runs a pure-PHP port of the precompute (`src/Precompute/` — `DataLoader`, `Aggregators`, `Runner`) using **Omeka's own DBAL connection** (`Omeka\Connection`), so it reuses Omeka's configured database with zero extra config and works on any Omeka install.
- The `Aggregators` are dependency-free and **unit-tested** (mock data + the real GeoJSON for the choropleth point-in-polygon + a Louvain 2-cluster check), mirroring the validated Python. PageRank is pure-PHP (no scipy/native deps).

The dashboards are now **PHP-only**; the redundant Python dashboard pipeline (`precompute-dashboards.py` + `precompute/{aggregators,generators,overviews}.py`) was removed. Only `scripts/precompute-graphs.py` remains, for the per-item knowledge-graph JSON.

---

## Current parity matrix

### Capabilities the dashboard has and this module lacks

Verified against the dashboard's `src/routes/` and `src/lib/components/charts/` trees and this module's `asset/js/` + `scripts/precompute/`.

| Capability | Dashboard location | Module status | Plan |
|---|---|---|---|
| **Discursive Communities network** (Louvain clustering + PageRank anchors) | `/network` tab 5, `NetworkGraph.svelte` | missing | **Phase 3** |
| **Generalized cross-entity Compare** (any type, live selection) | `/compare/[type]`, `EntityCompare` | ✅ **Done** (CompareEntity block) | **Phase 5** |
| **Project Explorer** (one selector retunes ~12 charts) | `/project-explorer` | ✅ **Done** | **Phase 4** |
| **What's New** (recent-items feed + top recent projects) | `/whats-new` | ✅ **Done** | **Phase 4** |
| **Photo browsing** (masonry / map / timeline for image-heavy sets) | `/collections/[slug]` | ✅ **Done** (PhotoBrowse block) | **Phase 6** |
| **Calendar Heatmap** (cadence by day/month/year) | `CalendarHeatmap.svelte` | ✅ **Done** | **Phase 2** |
| **Choropleth Map** (country fill) | `ChoroplethMap.svelte` | missing | **Phase 2** |
| **Radar Chart** (entity profile, 5–7 axes) | `RadarChart.svelte` | ✅ **Done** | **Phase 2** |
| **Box Plot** (distribution) | `BoxPlot.svelte` | ✅ **Done** | **Phase 2** |
| **Time-aware Chord** (chord + year slider) | `TimeAwareChord.svelte` | ✅ **Done** | **Phase 2** |
| **Gantt on Projects overview** | `/projects` | only on Section overview | **Phase 1** |
| **Beeswarm on Projects overview** | `/projects` | only on Section overview | **Phase 1** |
| **Sibling-items sparkline** (item detail) | `SiblingItemsSparkline.svelte` | ✅ **Done** | **Phase 7** |
| **Publications analytics** (co-author net, keyword chord, faceted browse, export) | `/publications` | no source data | **Phase 8 (gated)** |
| **Semantic Embeddings scatter** | `/semantic-map`, `SemanticScatter.svelte` | missing | **Descoped** |
| **Similar-items strip** (item detail) | `SimilarItemsStrip.svelte` | missing | **Descoped** (needs embeddings) |
| Faceted list/browse pages (multi-filter UI) | `/projects`, `/people`, … | Omeka core item browse | Low priority / optional |
| Home cross-tab heatmap (sections × universities) | `/` | module has a type × language heatmap | Low priority / optional |

### What this module has that the dashboard lacks

Kept for context — being ported the other direction in the dashboard's roadmap. Per-entity dashboards (7–20 charts) on Sections, Projects, People, Institutions, Locations, Subjects/Authority, plus category overviews for Genre, Language, Resource Type, Target Audience, Person, Institution, Group, LCSH, Tag, Project. Chart set: stacked timeline, language timeline, timeline, gantt, beeswarm, type pie, languages, roles, heatmap, subject word cloud, subject trends, sunburst, treemap, locations map (with origin→current flow overlay), chord, collaboration / contributor / affiliation networks, co-authors, co-subjects, items-per-project, sankey, self-location mini-map.

---

## Architecture guardrails

These are the load-bearing conventions every phase must follow. They are what keep the module **modular, maintainable, and theme-consistent**.

### The precompute → registry → builder pattern

Every per-entity chart lands as the same five-part change:

1. A `build_*` aggregator in `scripts/precompute/aggregators.py` — signature `build_x(item_ids, links, items, …)` returning a JSON-serializable dict/list **or `None`** when empty.
2. A call wiring it into the right generator: `scripts/precompute/generators.py` (per-entity: `_add_standard_charts`, `generate_people`, …) or `scripts/precompute/overviews.py` (`generate_overview`). The result is stored under a key on the `dashboard` dict, e.g. `dashboard['myChart'] = …`.
3. A registry entry in `asset/js/dashboard-registry.js`: add the key to `CHART_MAP`, `CHART_LABELS`, and (optionally) `CHART_DESCRIPTIONS`.
4. A vanilla-JS builder `asset/js/dashboard-charts-<name>.js`: an IIFE that registers `window.RV.charts.buildX = function (el, data, siteBase, allData) { … }`.
5. A layout-config entry in `asset/js/dashboard-layouts.js`: add the key to the relevant entity layout's `order` (and `wide`/`tall` as appropriate).

The orchestrator (`asset/js/dashboard.js`) ties these together: it reads `LAYOUTS[data.resourceType]`, **auto-hides any key whose data is empty**, hides the basic `timeline` when `stackedTimeline` is present, and calls `CHART_MAP[key](el, data[key], siteBase, data)` — note the **4th argument is the whole dashboard object**, which is how data-driven overlays work (see geoFlows below).

### Cross-cutting features are site-page **block layouts**, not resource-page blocks

> **Correction to the original roadmap.** The original draft said new cross-cutting blocks register under `src/Site/ResourcePageBlockLayout/`. They do **not**. The established pattern (see `CompareProjects` and `CollectionOverview`) is:
>
> - **`src/Site/BlockLayout/Xxx.php`** extending `Omeka\Site\BlockLayout\AbstractBlockLayout`, registered in `config/module.config.php` under **`block_layouts.invokables`**. These attach to **site pages** (the editor's page-block list), which is exactly where archive-wide views belong.
> - `ResourcePageBlockLayout` (KnowledgeGraph, ItemSetDashboard, LinkedItemsDashboard) is reserved for blocks bound to a single item/item-set page.

So Project Explorer, What's New, Discursive Communities, and generalized Compare all follow the `BlockLayout` path. The reusable shape is **Recipe B** below.

### Theme: read DRE tokens, never hard-code

The module styles itself entirely from the [DRE theme](https://github.com/AM-Digital-Research-Environment/DRE-theme) design tokens and follows light/dark automatically. This is non-negotiable for new work:

- **In JS**, resolve every colour through `ns.cssColor('--token', fallback)`. Never inline a hex that won't react to the theme. The categorical multi-series palette `ns.COLORS` (20 hues) is the *only* sanctioned theme-independent colour set, because compare-mode needs a stable colour-by-index map; brand identity is carried by `THEME.accent` (= `--primary`).
- **ECharts**: create instances with `ns.initChart(el)` (applies the shared ECharts theme). Theme toggles are handled globally by `ns.refresh()`. For **graph/structural** charts whose per-node/edge colours must re-resolve on toggle, set `chart._rvRebuild = function () { … }` (see how `refresh()` calls it) instead of relying on `setOption` re-merge.
- **MapLibre**: register every map with `ns.trackMap(map, rebuild)` and pick the basemap with `ns.getBasemapStyle()` (Positron / Dark Matter). Maps are *rebuilt* on theme toggle via the `rebuild` closure.
- **In CSS**, use the `--rv-*` aliases at the top of `asset/css/resource-visualizations.css`; they map straight onto DRE tokens and flip with `body[data-theme]` / `prefers-color-scheme` with zero JS.

### Other invariants

- **No bundling.** ECharts 6, echarts-wordcloud 2, and MapLibre GL 5 stay CDN-loaded.
- **Reuse `window.RV`** (THEME, COLORS, `initChart`, `truncateLabel`, `toEntries`, `addClickHandler`, `attachToolbar`, `buildDataZoom`, `trackMap`, `getBasemapStyle`, `exportBg`). No new globals.
- **`geoFlows` is an overlay, not a panel.** `build_geo_flows()` writes `dashboard['geoFlows']`; the `locations` builder (`dashboard-charts-map.js`) reads it from the 4th `data` argument and draws origin→current arcs on the same map. Use this *data-driven-overlay* pattern when a new signal belongs on an existing chart rather than its own panel.
- **Empty = hidden.** Aggregators return `None` and layouts may list keys that don't always have data; the orchestrator silently drops empty panels. This means **adding a key to a layout is safe even if only some entities populate it.**

---

## Reusable recipes

### Recipe A — add a new per-entity chart

| Step | File | Change |
|---|---|---|
| 1 | `scripts/precompute/aggregators.py` | Add `def build_x(item_ids, links, items, …)` → dict/list or `None`. |
| 2 | `scripts/precompute/generators.py` *and/or* `overviews.py` | Call it in the right generator; `dashboard['x'] = build_x(...)`. |
| 3 | `asset/js/dashboard-charts-x.js` | New IIFE builder registering `ns.charts.buildX`. |
| 4 | `asset/js/dashboard-registry.js` | `CHART_MAP['x'] = c.buildX;` + `CHART_LABELS` + `CHART_DESCRIPTIONS`. |
| 5 | `asset/js/dashboard-layouts.js` | Add `'x'` to the chosen layouts' `order`/`wide`/`tall`. |
| 6 | **Asset include** | Add `dashboard-charts-x.js` to the template `headScript()` lists (see Phase 0 — ideally one place after the refactor). |
| 7 | **Admin → Regenerate now** | Regenerate JSON in-Omeka (pure PHP). |

### Recipe B — add a new cross-cutting site-page block

| Step | File | Change |
|---|---|---|
| 1 | `src/Site/BlockLayout/Xxx.php` | `extends AbstractBlockLayout`; `getLabel()`, `form()` (usually "no configuration needed"), `render()` → `$view->partial('common/block-layout/xxx', ['block' => $block])`. |
| 2 | `config/module.config.php` | Register `'xxx' => Site\BlockLayout\Xxx::class` under `block_layouts.invokables`. |
| 3 | `view/common/block-layout/xxx.phtml` | Self-inject CSS + CDN (echarts/wordcloud/maplibre) + the module JS it needs (core, layouts, builders, registry, controller). Emit a `<div class="xxx-container" data-base-path data-site-base>` + loading spinner. |
| 4 | `asset/js/dashboard-xxx.js` | Controller IIFE: on init, find `.xxx-container`, fetch data from `{basePath}/modules/ResourceVisualizations/asset/data/…`, build UI, render via `CHART_MAP`, `ns.attachToolbar`. Model it on `dashboard-compare.js`. |
| 5 | *(if data-driven)* `scripts/precompute/…` + `precompute-dashboards.py` | New aggregator emitting an index/feed JSON under `asset/data/`. |
| 6 | README / admin | Document adding the block to a site page (**Admin → Sites → [site] → Pages**). |

---

## Phase 0 — Maintainability foundation ✅ Done

The per-template `headScript()` list (~20 chart files) is currently **duplicated** across `view/common/block-layout/compare-projects.phtml` and the resource-page dashboard templates. Every new chart in Recipe A step 6 means editing each copy — a maintenance hazard and the most likely source of "chart silently missing on one surface" bugs.

- [ ] Extract the chart-asset include list into **one** place — a view helper (e.g. `$this->rvDashboardAssets()`) or a shared partial `view/common/rv-dashboard-assets.phtml` — that all dashboard/compare/cross-cutting templates call.
- [ ] Define the canonical script **load order** once (core → layouts → builders → registry → orchestrator/controller), so a new builder is added in exactly one location.
- [ ] (Optional) A tiny PHP manifest array of builder filenames the helper iterates, so "register a chart" is a one-line edit.

This phase pays for itself the moment Phase 2 adds five builders. No behaviour change; pure DRY.

---

## Phase 1 — Parity quick wins (no new pipelines) ✅ Done

Highest value-to-risk ratio: every item here reuses an **existing** builder and aggregator. Several are pure declarative layout edits because `generate_overview()` already emits the data.

### 1.1 Gantt + Beeswarm on the Projects overview

- [ ] `scripts/precompute/overviews.py`: in the Project branch of `generate_category_overviews` (the `OVERVIEW_PROJECT` call), compute `build_beeswarm(...)` and a project `gantt`, attaching `dashboard['beeswarm']` / `dashboard['gantt']`. (Both builders exist; `build_beeswarm(section_title, project_ids, items, children_of, temporal)` and the gantt path already feed the Section overview — generalize the inputs to the projects parent.)
- [ ] `asset/js/dashboard-layouts.js`: insert `gantt`, `beeswarm` near the top of `projectOverview.order` (and into `wide`).
- [ ] No new builders, no registry change.

### 1.2 Backfill category-overview layouts (mostly declarative)

`generate_overview()` already attaches `heatmap`, `roles`, `subjectTrends`, `languageTimeline` to **every** overview when non-empty — but several overview *layouts* don't list those keys, so the data is computed and then never shown. Close the gap by editing `dashboard-layouts.js`:

- [ ] `groupOverview` — add `roles`, `heatmap`, `subjectTrends` to `order`/`wide`.
- [ ] `tagOverview` — add `heatmap`, `roles`.
- [ ] `targetAudienceOverview` — add `heatmap`, `roles`, `subjectTrends`.
- [ ] Verify with a regenerated JSON that these keys are populated for those parents (they may legitimately be empty for sparse categories — the orchestrator will hide them, which is fine).

### 1.3 Roles on Person dashboards

- [ ] `scripts/precompute/generators.py` (`generate_people`): add `build_roles(item_ids, links, items)` → `dashboard['roles']`.
- [ ] `asset/js/dashboard-layouts.js`: add `roles` to `person.order`.
- [ ] **Verify semantics:** `build_roles` aggregates contributor roles across the person's items. Confirm it reflects *this person's* role(s) rather than every contributor's; if not, add a person-scoped variant `build_roles_for(entity_id, …)`.

### 1.4 Geo-flow overlay on Location dashboards

- [ ] `scripts/precompute/generators.py` (`generate_locations`): call `build_geo_flows(item_ids, links, items, geo)` → `dashboard['geoFlows']`.
- [ ] No layout change needed — the `location` layout already includes `locations`, and the map builder draws the flow overlay from the 4th `data` arg automatically.
- [ ] Gate on the location actually having both origin and provenance items (the aggregator already returns `None` otherwise).

---

## Phase 2 — New chart types (5 builders)

Each is a self-contained Recipe-A addition: one builder, one aggregator, registry + layout wiring. They are deliberately grouped because they share the recipe and because three of them unlock later phases (Choropleth → list-page parity; Radar → Compare profiles; Time-aware Chord → subject pages). Match the dashboard component's data shape so the algorithm stays identical across both projects.

### 2.1 Choropleth Map  ✅ Done  *(also closes list-page parity)*

- [ ] Builder `asset/js/dashboard-charts-choropleth.js`: MapLibre fill layer; theme-aware via `ns.trackMap` + `ns.getBasemapStyle`; colour ramp from `ns.cssColor('--primary', …)` (log-spaced, matching the dashboard).
- [ ] Shared asset `asset/data/geo/countries.geojson` — **Natural Earth 110m**, same resolution as the dashboard's `world-countries-110m.json`, so the two stay visually identical. Commit and version it.
- [ ] Aggregator `build_choropleth(item_ids, links, items, geo)` → `[{ country, iso3, count }]` (roll item locations up to country level).
- [ ] Wire into `generate_locations`, `generate_by_item_set` (Language), and the Section/collection overview. Registry key `choropleth`. Layout: Location, Language, Section overviews.

### 2.2 Radar Chart  ✅ Done  *(unlocks Phase 5 Compare profiles)*

- [ ] Builder `asset/js/dashboard-charts-radar.js`: ECharts `radar` with 5–7 normalized axes (items, languages, subjects, contributors, projects, year-span).
- [ ] Aggregator `build_radar(dashboard)` derived from already-aggregated counts (cheap; no new DB work). Returns `{ indicator: [{name,max}], value: [...] }`.
- [ ] Wire into Person, Institution, Project dashboards/overviews. Registry key `radar`.

### 2.3 Calendar Heatmap

- [ ] Builder `asset/js/dashboard-charts-calendar.js`: ECharts `calendar` coord + `heatmap` series; multi-year stacks vertically.
- [ ] Aggregator `build_calendar_heatmap(item_ids, dates)` → `[{ date:'YYYY-MM-DD', value }]`. **Data note:** this is *acquisition cadence*, best keyed on `omeka_resource.created`; `scripts/precompute/db.py` currently loads publication/collection years, not row-creation timestamps — add a small `created` map to `load_all_data`.
- [ ] Wire into collection overview + Section/Project overviews. Registry key `calendar`.

### 2.4 Box Plot

- [ ] Builder `asset/js/dashboard-charts-boxplot.js`: ECharts `boxplot` series (min/Q1/median/Q3/max + outliers).
- [ ] Aggregator `build_boxplot(...)` → `[{ name, values:[…] }]` (e.g. items-per-project within a section; let the builder compute the five-number summary as the dashboard component does).
- [ ] Wire into Section overview (items-per-project distribution), Group/Institution overviews. Registry key `boxplot`.

### 2.5 Time-aware Chord

- [ ] Builder `asset/js/dashboard-charts-time-chord.js`: wrap the existing chord render in a year-slider + play/pause controller; reuse the chord drawing where possible.
- [ ] Aggregator `build_time_chord(item_ids, links, items, item_year)` → year-bucketed co-occurrence `{ buckets: [{ year, nodes, links }] }` (extends `build_chord`'s co-occurrence logic per year bucket).
- [ ] Wire into Section/Project overviews and Subject pages. Registry key `timeChord`.

---

## Phase 3 — Discursive Communities network ✅ Done

**Goal:** port `/network` tab 5 — the Louvain-coloured community view that shows *which topics cluster together* across the whole archive. (No embeddings involved; this is purely subject co-occurrence + community detection, fully in scope.)

- [ ] Aggregator `build_discursive_communities(item_ids, links, items, lcsh_only=…)` in `aggregators.py`:
  - Build a weighted subject co-occurrence graph (extends `build_chord`'s pairing logic, no `max_nodes` cap).
  - Community detection via `networkx.algorithms.community.louvain_communities` (add `networkx` to the precompute requirements).
  - PageRank for per-community anchor nodes.
  - Emit top-N nodes per community coloured by community id: `{ nodes:[{name,value,itemId,community}], links:[{source,target,value}], communities:[…] }`.
- [ ] New precompute entry — fold into `precompute-dashboards.py` (or a small `precompute-communities.py`) emitting `asset/data/communities/discursive.json`.
- [ ] Builder: reuse the bipartite/force base in `dashboard-charts-contributor-network.js` (extract a shared `buildForceGraph` if cleaner) → `asset/js/dashboard-charts-communities.js`, colouring nodes by `community` via `ns.COLORS[community % COLORS.length]`, with `chart._rvRebuild` for theme-toggle recolour.
- [ ] Cross-cutting block (Recipe B): `src/Site/BlockLayout/DiscursiveCommunities.php` + `view/common/block-layout/discursive-communities.phtml` + `asset/js/dashboard-communities.js` controller (loads `discursive.json`, renders, offers a community filter).
- [ ] **Per-entity tie-in:** on Subject/Authority dashboards, add a community badge ("part of community N") + a "peers in this community" bar, reading the same `discursive.json`.
- [ ] **Open decision:** run Louvain over all subjects vs. LCSH-only (free-text tags add noise). Recommend an `lcsh_only` flag, defaulting to LCSH, with tags as an optional pass.

---

## Phase 4 — Cross-cutting browse blocks

User-facing surfaces the dashboard has and we don't. Both reuse the **existing** precomputed per-entity dashboards — no new chart builders — and follow Recipe B, modelled directly on `dashboard-compare.js`.

### 4.1 Project Explorer

**Goal:** one page, a project selector at the top, ~12 charts retuning beneath it. The module already precomputes every project dashboard; this is a meta-page that swaps between them without navigation.

- [ ] `src/Site/BlockLayout/ProjectExplorer.php` + `view/common/block-layout/project-explorer.phtml` (Recipe B).
- [ ] Controller `asset/js/dashboard-explorer.js`:
  - Load `item-dashboards/projects-index.json` (**already produced** by `generate_projects`).
  - Searchable selector (reuse the section-grouped `<optgroup>` builder from `dashboard-compare.js`).
  - On change, lazy-load `item-dashboards/<id>.json` and render via the same `renderDashboard`-style loop used in `dashboard.js` (consider extracting that loop into a shared `ns.renderInto(container, data, siteBase)` so Explorer and the item page share one renderer — modularity win).
  - Query-string deep-linking (`?project=36`).
- [ ] No precompute change (the index already exists).

### 4.2 What's New

**Goal:** recent additions + most-active projects over a rolling window. Engagement, not deep analytics.

- [ ] Aggregator `build_whats_new(items, created, children_of)` → items bucketed by 3/6/12-month windows + top projects by recent-item count per window. (Depends on the `created` map added in Phase 2.3 — sequence after it.)
- [ ] Precompute to `asset/data/whats-new.json` from `precompute-dashboards.py`.
- [ ] `src/Site/BlockLayout/WhatsNew.php` + `view/common/block-layout/whats-new.phtml` (Recipe B).
- [ ] Controller `asset/js/dashboard-whats-new.js`: window selector + recent-item cards + a top-projects bar chart (reuse `buildBarChart`).

---

## Phase 5 — Generalize Compare to any entity type

Today `CompareProjects` + `dashboard-compare.js` handle only project × project. Generalize to mirror the dashboard's `/compare/[type]`. The controller is already 90% generic — selectors, `unifyForComparison` colour alignment, overlap stats, paired charts via `CHART_MAP` all work for any dashboard JSON.

- [ ] Rename `CompareProjects` → `CompareEntity` (`src/Site/BlockLayout/`), keeping a thin `CompareProjects` subclass/stub for backward compatibility with existing site pages.
- [ ] `dashboard-compare.js`: accept an `entity_type` (from a `data-entity-type` attr or an in-page type switcher) + load the matching index.
- [ ] **Index files:** today only `projects-index.json` exists. Add sibling index emitters (`people-index.json`, `institutions-index.json`, `subjects-index.json`, `languages-index.json`) — small additions to the respective generators, mirroring the existing project-index code.
- [ ] Per-type paired-chart map + overlap stats:
  - Project × Project — existing (stacked timeline, types, languages, subjects + subject overlap).
  - Person × Person — timeline, types, languages, subjects, co-authors overlap, affiliation overlap.
  - Institution × Institution — timeline, types, languages, subjects, collaboration overlap.
  - Subject × Subject — timeline, types, languages, co-subjects overlap, geographic overlap.
  - Language × Language — timeline, types, subjects, contributors.
- [ ] Add the **Radar profile** (Phase 2.2) as the headline side-by-side comparison, matching the dashboard's `CompareProfileRadar`.
- [ ] **Confirm the per-type paired-chart map with the dashboard side** to stay aligned.

---

## Phase 6 — Photo browsing views for item sets ✅ Done

**Shipped (v1.25.0)** as a curated **site-page block** rather than the originally-sketched item-set resource-page toggle. The editor picks one image-heavy item set in the block config, so the gallery can live on any page — chosen for editorial control over auto-attachment. The rendering engine is surface-agnostic, so the auto resource-page mode (a view toggle on the item-set page) remains an easy future add if wanted. Ported the dashboard's `PhotoMasonry` + `PhotoMap` + `PhotoTimeline`.

- [x] `src/Site/BlockLayout/PhotoBrowse.php` — config form with an item-set selector, optional heading, and a default-view choice (registered under `block_layouts.invokables`).
- [x] `view/common/block-layout/photo-browse.phtml` — **server-renders** the set's image-bearing items (thumbnail + original derivative URLs, year, place, `geo:lat` / `geo:long`) to a JSON payload. **No precompute** — thumbnails are Omeka S derivatives, everything resolves at render time. Map / Timeline tabs appear only when the set has coordinates / dates; the default tab is configurable.
- [x] `asset/js/item-set-photo-views.js`:
  - **Masonry** — CSS-columns grid with native lazy-loading; relies on Omeka S derivative renditions (no image pipeline).
  - **Map** — MapLibre cluster, theme-aware via `trackMap` / `getBasemapStyle`, **lazy-loaded** on first open so the default Grid view ships zero map weight. Keyed on item-level `geo:lat` / `geo:long`.
  - **Timeline** — horizontal strip grouped by year (the undated bucket is surfaced, not dropped).
- [x] **Lightbox** — a small keyboard-navigable lightbox (← / → / Esc) with a metadata sidebar (title / date / place) + item deep-link.

---

## Phase 7 — Item-page enhancements

Small, high-polish additions to individual item pages (the surface where this module is already strongest).

### 7.1 Sibling-items sparkline

- [ ] Port `SiblingItemsSparkline`: on a research item belonging to a project, show the project's items-per-year as a small timeline with the **current item highlighted**.
- [ ] Reuse the per-project precomputed timeline (`item-dashboards/<project-id>.json`); the item's own page resolves its parent project via `dcterms:isPartOf`. No new aggregator if the project dashboard is already generated; otherwise a tiny `siblingTimeline` key.
- [ ] Render as a compact strip above or beside the existing knowledge graph on the item page template.

---

## Phase 8 — Publications analytics suite ✅ Done

**Unblocked 2026-05-30.** The instance now holds ~172 `fabio:`-classed bibliographic records (Article, Working paper, Conference paper, Book chapter, Book, …). Shipped:

- A **Publications** site-page block (`src/Site/BlockLayout/Publications.php` + `view/common/block-layout/publications.phtml`) rendering `item-dashboards/publications.json` via the standard orchestrator (`resourceType: 'publications'`).
- New PHP aggregators (`buildTemplates`, `buildTopLiteral`, `buildTopAuthors`, `buildCoAuthorNetwork`) reusing existing JS builders (`buildPieChart`, `buildBarChart`, `buildCommunities`, `buildChord`) — no new builder files or controller.
- The co-author network unifies literal `bibo:authorList` names with Person-linked authors and marks **matched persons** distinctly; keyword co-occurrence reuses `buildChord` on `dcterms:subject`.
- A reusable **`templates`** breakdown chart across person/organisation/overview dashboards; people dashboards now surface their `bibo:authorList`/`bibo:editorList` publications.

Original specification (retained for reference):

When a publications corpus exists in Omeka:

- [ ] Aggregators (mirroring the dashboard's tested `publications/analytics.ts`):
  - `build_coauthor_network(pub_ids, links, items)` — author↔author graph (edge = shared works ≥ N), matched persons vs. external collaborators.
  - `build_keyword_cooccurrence(pub_ids, links, items)` — keyword co-occurrence for a chord diagram.
  - `build_top_venues` / `build_top_authors` / keyword frequency — all reuse `buildBarChart` / `buildWordCloud`.
- [ ] Reuse the **co-author network** via the Phase 3 force-graph base, and the **keyword chord** via the existing chord builder — no genuinely new chart types.
- [ ] A `publicationsOverview` layout + a faceted browse block (Recipe B) if a cross-cutting publications page is wanted.
- [ ] **Out of scope even when unblocked:** harvesting ERef/EPub (that's the dashboard's ETL); the module visualizes whatever publication records land in Omeka.

**Note:** the *techniques* here (collection-wide co-author network, keyword co-occurrence) are not unique to bibliographies. If desired ahead of any import, they can be applied to existing **research-item / person** data as an extension of Phase 3 — but that is a separate decision, not part of this gated phase.

---

## Descoped (deliberately not porting)

- **Semantic Embeddings scatter** (`/semantic-map`, `SemanticScatter`) — no embeddings pipeline will be built in the module (decision 1 above). If revisited, the natural fit is a local `precompute-embeddings.py` that embeds Omeka item text and keys by `item_id` (not reusing the dashboard's `dre_id`-keyed Gemini vectors).
- **Similar-items strip** (`SimilarItemsStrip`) — depends on the embeddings above; descoped with it.

Both remain in the dashboard; this is a module-side scope choice, not a removal from the initiative.

---

## Data-pipeline additions (cumulative)

```
asset/data/
├── geo/
│   └── countries.geojson          # Phase 2.1 — Natural Earth 110m, shared w/ dashboard
├── communities/
│   └── discursive.json            # Phase 3 — Louvain subject community graph
├── whats-new.json                 # Phase 4.2 — rolling recent-items feed
├── item-dashboards/
│   ├── projects-index.json        # existing — reused by Project Explorer + Compare
│   ├── people-index.json          # Phase 5 — new
│   ├── institutions-index.json    # Phase 5 — new
│   ├── subjects-index.json        # Phase 5 — new
│   ├── languages-index.json       # Phase 5 — new
│   └── <id>.json                  # existing — gains keys: choropleth, radar, calendar,
│                                   #   boxplot, timeChord, geoFlows (locations), roles (people)
└── (NO semantic/ dir — embeddings descoped)
```

New / changed scripts:

```
scripts/
├── precompute-dashboards.py        # wire new aggregators + emit indexes, whats-new, communities
└── precompute/
    ├── db.py                       # + created-timestamp map (Phase 2.3 / 4.2)
    ├── aggregators.py              # + build_choropleth, build_radar, build_calendar_heatmap,
    │                               #   build_boxplot, build_time_chord, build_discursive_communities,
    │                               #   build_whats_new  (+ per-type index emitters)
    ├── generators.py               # wire choropleth/radar/calendar/geoFlows/roles into entity generators
    └── overviews.py                # wire gantt+beeswarm into Projects; choropleth/boxplot/timeChord into overviews
```

New requirement: `networkx` (Phase 3).

---

## Suggested sequencing & dependencies

```
Phase 0 (DRY asset includes)        ── do first; unblocks clean multi-builder phases
        │
Phase 1 (quick wins)                ── independent; ship anytime
Phase 2 (5 chart types)             ── 2.1 Choropleth & 2.2 Radar first
        │                                   ├─ Choropleth → list-page parity
        │                                   └─ Radar ─────────────┐
Phase 3 (communities)               ── independent (force-graph base)   │
Phase 4 (explorer / whats-new)      ── 4.2 needs db.py `created` (Phase 2.3)
Phase 5 (generalized compare)       ── needs Radar (2.2) + new index files
Phase 6 (photo views)               ── independent
Phase 7 (sibling sparkline)         ── independent; tiny
Phase 8 (publications)              ── GATED on data import
```

Recommended first slice if/when implementation starts: **Phase 0 → Phase 1 → Phase 2.1 (Choropleth) → Phase 2.2 (Radar)** — all low-risk, each independently shippable, and they unlock list-page parity and the Compare profile.

---

## Follow-up issues to file

Each becomes its own issue in this repo.

**Phase 0–1**
- [ ] Centralize dashboard asset-include list (view helper / shared partial)
- [ ] Gantt + Beeswarm on Projects overview
- [ ] Backfill Group / Tag / Audience overview layouts
- [ ] Roles on Person dashboards
- [ ] Geo-flow overlay on Location dashboards

**Phase 2**
- [ ] Choropleth Map chart (+ shared countries.geojson)
- [ ] Radar Chart
- [ ] Calendar Heatmap (+ db.py created timestamps)
- [ ] Box Plot
- [ ] Time-aware Chord

**Phase 3**
- [ ] Discursive Communities block + precompute (networkx Louvain)

**Phase 4**
- [ ] Project Explorer block
- [ ] What's New block + precompute

**Phase 5**
- [ ] Generalize CompareProjects → CompareEntity (+ per-type index files, radar profile)

**Phase 6–7**
- [x] Photo views (masonry / map / timeline) — shipped as the PhotoBrowse site-page block
- [x] Sibling-items sparkline on item pages

**Phase 8 (gated)**
- [ ] Publications analytics suite — open only after a bibliographic import lands

---

## Scope boundaries & open decisions

**Out of scope for this roadmap:**

- Semantic embeddings / semantic map / similar-items (descoped this revision).
- Replacing ECharts or MapLibre.
- A bespoke thumbnail/image pipeline — rely on Omeka S derivatives.
- Real-time updates — precompute remains batch.
- Bibliographic harvesting (ERef/EPub) — that stays on the dashboard side.

**Open decisions to confirm before the relevant phase:**

- **Choropleth GeoJSON** — lock to Natural Earth **110m** (matches the dashboard) and version the committed file. *(Phase 2.1)*
- **Discursive Communities scope** — Louvain over LCSH-only (recommended) vs. all subjects incl. free-text tags. *(Phase 3)*
- **Generalized Compare paired-chart map** — confirm per-type chart sets with the dashboard side to stay aligned. *(Phase 5)*
- **Publications trigger** — what import shape (item set vs. resource template) and which vocabulary (`bibo:`/`fabio:`) signals "this is a publication." *(Phase 8)*
