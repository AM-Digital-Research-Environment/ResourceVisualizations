# DRE Visualizations

An [Omeka S](https://omeka.org/s/) module that adds interactive visualizations to resource pages using [ECharts](https://echarts.apache.org/) and [MapLibre GL](https://maplibre.org/).

> Counterpart to the sibling [**amira** dashboard](https://github.com/AM-Digital-Research-Environment/amira) over the same Africa Multiple research data — see [Related project](#related-project).

## Features

### Knowledge Graph (Item Pages)

A force-directed network showing the item's relationships. For items with rich outgoing links (research items, projects, people), shows linked persons, subjects, locations, and other items sharing the same properties. For items that are primarily linked TO (subjects, languages, locations, genres), shows the research items that reference them.

- Pre-computed JSON for instant loading, regenerated in-Omeka (live REST-API fallback when absent)
- Hover an entity to isolate its connections — its neighbours and their edges brighten while everything else fades
- **Community colours** — a coloured halo rings entities that co-occur through shared items, so connected clusters read at a glance (toggle in the toolbar); the busiest (hub) entities are drawn larger
- Click any node to navigate to its Omeka S page
- Fullscreen mode (Escape to exit)
- Node cap (150 direct + 30 shared) prevents overload on highly-connected entities
- Collapsible section — a native `<details>` disclosure mirroring the DRE theme's *Linked resources* accordion (expanded by default; the graph re-fits on expand)

### Item Location Map (Item Pages)

Automatically rendered below the knowledge graph when an item has geographic data. Shows distinct markers for:

- **Origin** (teal) — where the resource was produced/fieldwork conducted (`dcterms:spatial`)
- **Current location** (orange) — where the resource is currently held (`dcterms:provenance`)

Coordinates are resolved from linked Location **or Institution** items with `geo:lat`/`geo:long` — so an item held at a geocoded institution (an archive, museum, or university) now shows a current-location marker too, not just origins.

### Sibling-items Sparkline (Item Pages)

For a research item that belongs to a project, a compact sparkline of the project's **items-per-year** with the current item's year marked — context for where the item sits in its project's timeline. A **resource page block** (Admin > Sites > [site] > Theme > Configure resource pages); it resolves the parent project + the project's precomputed timeline client-side and hides itself when not applicable.

### Visualizations Dashboard (Item Pages)

Contextual charts adapted per entity type. All chart elements are clickable, linking to the corresponding Omeka S item page. 2,551 dashboards pre-computed across all entity types. The whole dashboard sits in a collapsible `<details>` header (matching the Knowledge Graph and the theme's *Linked resources* accordion); charts re-fit when a collapsed section is re-opened.

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
| Geographic Origins & Current Locations (map) | x | x | x | x | | | x | x | |
| Origin > Current Location (flow map) | x | x | | | x | | | | |
| Items by Country (choropleth) | x | x | | | | | | | |
| Self-location MiniMap | | | | x | x | | | | |
| Affiliation Map | | x | x | | | | | | |
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

The collection / section / project overviews additionally carry a **box plot** of items-per-project across research sections, and a **time-aware chord** (subject co-occurrence with a year slider / play button). Single-project dashboards also carry an **affiliation map** of the geocoded institutions the project's members (PI + team) are affiliated with.

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

### Collection Overview & Collection Dashboard

Two collection-wide **site-page blocks** (Admin > Sites > [site] > Pages) that share one precomputed dataset (`asset/data/item-dashboards/collection-overview.json`, which aggregates every research item **and cluster publication**) but render different slices of it. The slice is chosen by a `data-layout` attribute on the block template, so both stay in sync from a single regeneration.

- **Collection Overview** — a curated, home-page-friendly subset mirroring the [amira dashboard](https://amira.africamultiple.uni-bayreuth.de/) homepage, in this order: summary stat cards → **Africa Multiple Research Centres (AMRCs) and its partners** (cluster-geography map) → **Research Sections** (projects per section) → **Research Section × University** (research items by section and funding university) → **Items by Year and Type** → **Resource Type × Language** → **Languages** → **Resource Types** → **Subjects & Tags** → **Items by Country**. Uses the `collectionOverview` layout. Here "items" regroups research items, cluster publications (the curated Publications item set), cluster podcasts **and YouTube videos**: each publication, podcast or video is folded in under a single synthetic **Publication** / **Podcast** / **YouTube video** resource type — overriding any type of its own — so the whole bibliography reads as one **Publication** category, the podcast episodes as one **Podcast** category and the channel videos as one **YouTube video** category in *Items by Year and Type*, *Resource Types* **and *Resource Type × Language*** (drill into the Publications block for the per-type breakdown). *Subjects & Tags* spans both controlled LCSH subjects and free tags (both are `dcterms:subject`). *Resource Type × Language* drops any resource type that never co-occurs with a language, collapses its tall axis on mobile and hides the per-cell counts so the matrix stays legible on a phone.
- **Collection Dashboard** — the full set of collection-wide visualizations (the former "Collection Overview"): stacked timeline, resource-type / language breakdowns, subject trends, co-occurrence chord, sankey, sunburst, geo flows, choropleth, time-aware chord, items-per-project box plot, and more. Uses the full `section` layout.

Both open with a grid of **summary stat cards** — Research Items, Projects (with items), People, Organisations, Locations (with the number of countries they span), Languages, Subjects & Tags, Resource Types, Publications, Podcasts, and YouTube videos — each with a [lucide](https://lucide.dev) icon. All counts come from the precompute: **People, Organisations, Languages, Subjects & Tags, Resource Types, Publications, Podcasts and YouTube videos** are the sizes of their authority item sets (Persons, Institutions, Languages, Subjects, Type of Resource, Publications, Podcasts, YouTube videos); **Projects** counts projects that have research items, plus each external partner collection (ILAM, BayGlo) — which the amira dashboard models as a virtual project but which has no template-5 project entity of its own; **Research Items and Locations** reflect what is present in the corpus. Cards with a zero count are dropped.

The three Collection Overview-only charts come from the precompute too: **Research Sections** (`Aggregators::buildSectionsBar`) counts projects per `frapo:ResearchGroup`; **Research Section × University** (`Aggregators::buildSectionUniversity`) routes each project's items to its funding university, read from the project's `frapo:isFundedBy` link (UBT / UNILAG / UJKZ / UFBA / Rhodes); and the **AMRCs & partners** map (`Aggregators::clusterPartners`) is **data-driven from Omeka**: every institution that `dcterms:isPartOf` one of the four *African Multiple Partners* category authorities (Africa Multiple Research Centres, Privileged partner, Cooperation partners, Global partner Centres of African Studies) and carries `geo:lat`/`geo:long` coordinates, rendered as colour-coded MapLibre markers with a toggleable legend — the categories, their labels, and the coordinates all come from the authority records and institution items, so curation lives in Omeka (no hard-coded list). A project with no research-section assignment is omitted from the section charts.

The stat cards are a **reusable component**: any dashboard that emits a precomputed `stats` array (`Aggregators::buildStatCards()` on the PHP side, `ns.renderStatCards()` on the front end) gets the same icon grid — see *Recipe C* in [ROADMAP.md](ROADMAP.md). Like every dataset in this module, both blocks refresh on **"Regenerate now"** — run it once after installing this version so the snapshot picks up the stat cards, the new section/cluster charts, and the items-by-country map.

### Project Explorer

A single project selector that retunes a full project dashboard (~12 charts) beneath it — a meta-page over the precomputed per-project dashboards, with no navigation. Added as a **site-page block** (Admin > Sites > [site] > Pages); deep-links via `?project=ID`.

### Compare

Side-by-side comparison of two entities of the **same type** — paired charts, an overlaid A/B **radar** profile, and overlap statistics (shared-item percentage + shared badges). Added as the **Compare (any entity)** site-page block (Admin > Sites > [site] > Pages): an in-page type switcher across **projects, people, institutions, subjects, languages** (opens on projects by default), each with its own paired-chart set + overlap key (e.g. co-occurring subjects when comparing subjects). Loads the matching `{type}-index.json`.

### Discursive Communities — Entity Network

A collection-wide **entity network**: people, organisations, places, subjects and tags that co-occur across the research items, drawn as an explorable force-directed graph with **MapLibre GL** (WebGL). Positions are **precomputed** (ForceAtlas2 in PHP, projected onto a pseudo-Mercator plane), so the client renders ~15k edges with zero layout cost and the network looks identical on every load. Nodes are coloured by entity type and sized by connectivity; an optional toggle re-colours by Louvain co-occurrence cluster. Added as a **site-page block** (Admin > Sites > [site] > Pages), it loads `asset/data/communities/entity-graph.json`. Hover a node to isolate its links, scroll to zoom, search or filter by entity type, raise the minimum link weight, and click an entity for its details and page. Organisations are surfaced through their authors' affiliations (`person → dcterms:isPartOf → foaf:Organization`); subjects split into LCSH **Subjects** vs free **Tags**.

> The graph renders on the **MapLibre GL** the module already vendors for its maps — no extra front-end dependency and no build step. Node positions are baked by `src/Precompute/ForceLayout.php` (a pure-PHP ForceAtlas2 port of graphology's, projected to pseudo lng/lat). The earlier ECharts subject-only `discursive.json` graph is still generated but no longer used by this block.

### Spatial Exploration

A collection-wide **places map**: every geocoded location the research items reference, drawn as **MapLibre GL** bubbles sized by referencing-item count and split into **two separately coloured, toggleable layers** — places of **origin** (`dcterms:spatial`, brand accent) and **current locations** (`dcterms:provenance`, cluster Hellblau), the same colour language as the per-entity dashboard map; the legend doubles as a show/hide toggle. Added as a **site-page block** (Admin > Sites > [site] > Pages), it loads `asset/data/item-dashboards/spatial-exploration.json`. A sidebar entity picker filters the map to a single **project, research section, person, organisation or subject** — the selection is served from a baked entity→places adjacency, so it filters client-side with no extra fetch — a country dropdown (built from the point-in-polygon country index, with per-country zoom bounds) focuses the map, and clicking a bubble opens that location's page. The high-cardinality picker types (people, organisations, subjects) are capped to the top entities by mapped-place count to keep the payload lean.

> Shares the **MapLibre GL** engine and the `dashboardAssets(['spatial' => true])` asset mode (mirroring the entity network's `['graph' => true]`), so a page carrying this block alongside the Discursive Communities graph and the dashboards loads MapLibre exactly once. Built by `Aggregators\SpatialTrait` + `Runner::generateSpatialExploration()`; rendered by `asset/js/spatial-exploration.js`.

### Publications

A bibliographic analytics view over the cluster **Publications** item set (articles, books, chapters, working papers, …). Added as a **site-page block** (Admin > Sites > [site] > Pages), it loads `asset/data/item-dashboards/publications.json` and shows:

- **summary stat cards** — publications, publication types, languages, and the people credited as **authors or editors** (distinct Person records across `bibo:authorList` + `bibo:editorList`) — the same reusable component as the Collection Overview;
- a **publication-type** breakdown (`dcterms:type`: Article vs. Book vs. Chapter …) and publications per year;
- **top venues** (`dcterms:isPartOf`) and **top authors** (`bibo:authorList`, unifying literal names with linked Person records);
- a **collaboration network** — authors and editors who appear together on a publication, with each edge coloured by the relationship (**co-authorship**, **author–editor**, or **co-editorship**) and people matched to a Person record drawn solid (click-through) versus external names muted;
- a **keyword** word cloud and **keyword co-occurrence** chord over `dcterms:subject`, plus Languages as a pie.

Authors/editors matched to Person records and subjects matched to Authority/LCSH records are clickable through to their pages. (The **By Resource Template** chart still appears on person and organisation dashboards, and a person's authored publications surface on their own dashboard.)

### YouTube

Analytics for the cluster **YouTube channel** — the synced **YouTube videos** item set (39192; `bibo:AudioVisualDocument`). Added as a **site-page block** (Admin > Sites > [site] > Pages), it loads `asset/data/item-dashboards/youtube.json` and shows:

- **summary stat cards** — videos, playlists, languages, and the people credited as **speakers** (`marcrel:spk`, manually curated so often empty) — the same reusable component as the Collection Overview;
- **videos by playlist** — each video's `dcterms:isPartOf` links to a playlist authority item (item set 39193 *YouTube playlists*), so this ranks the channel's playlists by video count;
- **videos by year** (upload date, `dcterms:date`) and the **language mix** (`dcterms:language`) plus **languages over time**;
- **speakers**, when credited.

YouTube videos carry no `dcterms:type` of their own, so they don't appear in the resource-type pie *here*; instead they fold into the **Collection Overview** under a single synthetic **YouTube video** type (see above). Playlists and speakers are clickable through to their Omeka pages.

### Podcasts

Analytics for the cluster's curated **podcast episodes** — the manually-catalogued **Podcasts** item set (39095; template 21, `fabio:AudioDocument`). Added as a **site-page block** (Admin > Sites > [site] > Pages), it loads `asset/data/item-dashboards/podcasts.json` and shows:

- **summary stat cards** — episodes, series, distinct **speakers** (`marcrel:spk`), total **hours of audio** (with the average length), and the languages — the same reusable component as the Collection Overview;
- **transcript word cloud** — the headline chart, built in the precompute from the episodes' AI-generated transcripts (`bibo:content`): tokenised, with audio cues (`[music]`), `Speaker N:` labels, numbers and a broad English + French stop-word / filler list removed (`Aggregators::buildTranscriptWordCloud`, tunable);
- **speakers & hosts** (`marcrel:spk` / `hst` / `sde`), the **episode-length** distribution (`dcterms:extent`, ISO-8601, bucketed into bands by `Aggregators::buildDurationHistogram`), **episodes by year** (`dcterms:date`), and **episodes by series** (`dcterms:isPartOf`, clickable through to each series).

Podcasts carry no `dcterms:type` of their own, so (like YouTube videos) they don't appear in the resource-type pie *here*; instead they fold into the **Collection Overview** under a single synthetic **Podcast** type (see above). Speakers and series are clickable through to their Omeka pages.

### What's New

A recent-additions feed with a **3 / 6 / 12-month** window selector and a "most active projects" bar. Added as a **site-page block** (Admin > Sites > [site] > Pages), it loads `asset/data/item-dashboards/whats-new.json`. "Now" is the latest item-creation date in the corpus, so it stays meaningful regardless of when the data was imported.

### Featured Collections

A curated landing grid of **collection cards** (cover mosaic, title, description, partner credit and an item/photo count), added as a **site-page block** (Admin > Sites > [site] > Pages). The collections come from the module registry (`src/FeaturedCollections/Registry.php`) — add an entry and it appears here; the only per-block setting is an optional heading. Counts and cover thumbnails are precomputed (`asset/data/featured-collections/index.json`) with a live API fallback, and most cards link to an in-module **Photo Browsing** detail page.

Two kinds of card are special:

- **Sub-collections** — one item set split into several cards, either by `dcterms:identifier` prefix (the three Museu Afro-Digital sub-collections share item set 6295) or grouped into journal issues by DOI (ILAM).
- **Link-out cards** — a collection with no in-module gallery. The **DECCA** and **Jambo** record-label catalogues are image-less **Audio** recordings credited as the *producer* (`marcrel:prn`) of items inside the "Beyond the Digital Return" collection (item set 6262), so they are not item sets of their own. Their cards show a producer-filtered count and link straight to the matching Omeka listing (the entry's `externalUrl`); set the entry's `thumbnail` to give the card a cover.

### Photo Browsing

Image-first browsing for an image-heavy item set, as a **site-page block** (Admin > Sites > [site] > Pages). Pick an item set in the block settings; the page renders that set's image-bearing items into three browsers sharing one keyboard-navigable **lightbox** (← / → / Esc, with a metadata sidebar and an item deep-link):

- **Grid** — a responsive masonry of lazy-loaded thumbnails;
- **Map** — a clustered MapLibre map of the geolocated photos, loaded on demand so the default Grid view ships zero map weight. Coordinates are resolved by following each photo's `dcterms:spatial` link to a Location item (`geo:lat` / `geo:long`) — the photos themselves rarely carry coordinates;
- **Timeline** — a horizontal strip grouped by year.

The gallery is **precomputed** per item set (like every other dataset — see [Pre-computing Data](#pre-computing-data)), and only for sets that have at least one image-bearing item. Until the first "Regenerate", the block falls back to resolving the gallery live through the Omeka API, so it still works the moment it is added. The Map and Timeline tabs appear only when the set actually has coordinates / dates, and the default tab is configurable.

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

## Embedding visualizations

Every site-page visualization block can be embedded on another website via an `<iframe>`. The embed renders on a bare, chrome-less page that still **follows the active theme** — it loads the site theme's stylesheet, so the design tokens, self-hosted fonts, and light/dark mode all carry over and an embed reads as a native DRE panel rather than a generic chart.

Each site exposes a **snippet gallery** at `/s/<site-slug>/dre-embed` (also linked from **Admin → DRE Visualizations**): it lists every embeddable block with a live preview and a copy-paste iframe + auto-resize snippet.

- **Whole block** — `/s/<site-slug>/dre-embed/<block>`, e.g. `…/dre-embed/publications`. Renders the exact on-page block.
- **Single chart** (dashboard blocks only) — `/s/<site-slug>/dre-embed/<block>/<chart>`, e.g. `…/dre-embed/publications/coAuthorNetwork`. Renders one chart full-bleed, without the dashboard header/accordion. The gallery lists each dashboard's available charts, enumerated live from the layout definitions and filtered to the charts that actually carry data.

You can also grab the code **without leaving the page**: every embeddable visualization on the live site carries a small **copy-embed-code** button — one per chart in the dashboards' toolbars (next to *Save as image*), and one per block on the single-view maps/networks — that copies the matching snippet to the clipboard. It reuses the chart toolbar styling, follows light/dark, and never appears inside an embed itself.

Embeddable blocks: **Collection Overview**, **Collection Dashboard**, **Publications**, **YouTube**, **Podcasts** (these five also support single-chart embeds), **Discursive Communities**, **Spatial Exploration**, **Network Explorer**, **Compare (any entity)**, **Compare Genres**, **Project Explorer**, **What's New**.

The iframe auto-resizes to its content (the snippet pairs each frame with a tiny `postMessage` listener). Two optional query params:

- `?theme=dark` — switch to dark mode. Embeds render **light by default** (an iframe can't read its host page's colour scheme, so light is the safe match for most pages); the embedder opts into dark explicitly.
- `?primary=RRGGBB` — override the brand seed; the theme re-tints every accent, hover, and focus colour from it.

Every embed shows a small **source** link back to the site, and the endpoint sends `Content-Security-Policy: frame-ancestors *` in place of the site-wide `X-Frame-Options: SAMEORIGIN` (set in `Module::relaxEmbedFraming()`) so it can be framed on any origin. If a reverse proxy forces `X-Frame-Options` with `always`, that header must also be relaxed for the `/dre-embed` path there — PHP can't drop a proxy-added header.

> The endpoint is public (it is served into third-party pages), reuses each block's existing precomputed JSON over same-origin fetches, and adds no build step. Single-chart embeds work by pinning the dashboard orchestrator to one chart key via `data-chart-only` (see `asset/js/dashboard.js`), wired up in `src/Controller/Site/EmbedController.php` and `view/dre-visualizations/layout/embed.phtml` + `view/dre-visualizations/embed/*.phtml`.

## Installation

Download via Omeka S CLI:

```bash
docker compose exec php omeka-s-cli module:download --base-path /var/www/html gh:AM-Digital-Research-Environment/DRE-Visualizations
```

Then activate in **Admin > Modules**.

> **Module folder name.** Omeka loads this module from a directory named `DreVisualizations` — it must match the PHP namespace — even though the repository is `DRE-Visualizations`. If you install by hand, clone into that folder: `git clone https://github.com/AM-Digital-Research-Environment/DRE-Visualizations.git modules/DreVisualizations`.

### Configure Resource Pages

Go to **Admin > Sites > [site] > Theme > Configure resource pages**:

- **Item page**: add "Knowledge Graph" and "Visualizations" blocks
- **Item set page**: add "Item Set Dashboard" block (optional)

## Pre-computing Data

Visualizations load from pre-computed JSON in `asset/data/`. **Everything regenerates inside Omeka** — no Python, shell access, or extra credentials.

**Admin → Modules → DRE Visualizations → "Regenerate now"** dispatches an Omeka background job (`src/Precompute/`, pure PHP) that rebuilds, straight from the Omeka database via Omeka's own connection:

- per-entity & category **dashboards** + the **collection overview**
- the **Discursive Communities** graph
- the **Spatial Exploration** places map (`spatial-exploration.json`)
- the **Publications** analytics (`publications.json`)
- the **Photo Browsing** galleries (one JSON per image-bearing item set)
- the per-item **knowledge graphs** + item location maps

Watch progress and any errors at **Admin → Jobs → the job's log**. Re-run after importing or substantially editing items.

> `asset/data/knowledge-graphs/` is **not** committed to the repo (≈6,000 files) — it regenerates on demand. Until the first "Regenerate now", the knowledge-graph block falls back to a lighter live REST-API graph.

### Updating the module

To pull a new module **release** into the container:

```bash
docker compose exec php omeka-s-cli module:download --base-path /var/www/html --force gh:AM-Digital-Research-Environment/DRE-Visualizations
docker compose restart php
```

Then click **"Regenerate now"** to rebuild the precomputed data.

## Architecture

```
DreVisualizations/
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
├── src/Controller/Site/EmbedController.php # Public iframe-embed endpoint (gallery + block/chart)
├── view/dre-visualizations/
│   ├── layout/embed.phtml              # Bare, theme-following layout for iframes
│   ├── embed/index.phtml               # Per-site embed snippet gallery
│   ├── embed/block.phtml               # Whole-block or single-chart embed body
│   └── embed/not-found.phtml           # Bare 404 inside the frame
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
│   │   ├── dashboard-charts-communities.js       # Subject co-occurrence force graph (ECharts; legacy)
│   │   ├── dashboard-communities.js              # Old Discursive Communities controller (legacy)
│   │   ├── entity-graph.js                       # Entity Network — sigma.js renderer + controller
│   │   ├── dashboard-charts-contributor-network.js # Contributor + affiliation networks
│   │   ├── dashboard-collab-network.js           # Institution collaboration network
│   │   ├── dashboard-compare.js                  # Compare controller (any entity type)
│   │   ├── dashboard-explorer.js                 # Project Explorer controller
│   │   ├── item-set-photo-views.js               # Photo Browsing: masonry / map / timeline + lightbox
│   │   ├── dashboard-stat-cards.js               # Reusable summary stat cards (lucide icon + value); renders any dashboard's `stats`
│   │   ├── dashboard-registry.js                 # CHART_MAP, labels, descriptions
│   │   └── dashboard.js                          # Orchestrator: render + async/inline init
│   ├── css/
│   │   └── dre-visualizations.css # Styles with CSS custom properties
│   ├── vendor/                    # Committed third-party bundles (byte-identical upstream)
│   │   └── echarts.min.js, maplibre-gl.js, …   # ECharts + MapLibre (self-hosted)
│   └── data/
│       ├── geo/
│       │   └── countries.geojson       # Natural Earth 110m boundaries (choropleth)
│       ├── communities/
│       │   ├── discursive.json         # Subject co-occurrence + Louvain communities (legacy)
│       │   └── entity-graph.json       # Multi-entity co-occurrence network (MapLibre; baked positions)
│       ├── knowledge-graphs/           # Per-item graph JSON — gitignored, regenerated in-Omeka
│       ├── photo-galleries/            # Per-item-set gallery JSON — gitignored, regenerated in-Omeka
│       └── item-dashboards/            # Dashboard JSON + {type}-index.json (projects/people/…)
├── src/Precompute/                     # PHP precompute engine (admin "Regenerate now")
│   ├── DataLoader.php                  # Items/links/literals/geo via Omeka\Connection
│   ├── Aggregators.php                 # Facade: composes the trait builders + shared constants (unit-tested)
│   ├── Aggregators/                    # Builders split by concern (one trait per file)
│   │   ├── SupportTrait.php            # sort/lookup + PageRank/Louvain primitives
│   │   ├── BasicChartsTrait.php        # aggregateItems, heatmap, roles, templates
│   │   ├── TemporalChartsTrait.php     # timelines, trends, boxplot, time-chord, what's-new
│   │   ├── NetworkChartsTrait.php      # chord, sankey, contributor/affiliation/collab/co-author networks
│   │   ├── GeoChartsTrait.php          # choropleth, geo-flows, country index
│   │   ├── HierarchyChartsTrait.php    # sunburst, treemap
│   │   ├── CommunityTrait.php          # discursive communities (subject-only, legacy)
│   │   ├── EntityGraphTrait.php        # global multi-entity co-occurrence graph (MapLibre block)
│   │   ├── PublicationChartsTrait.php  # top venues, top authors
│   │   └── OverviewChartsTrait.php     # radar, stat cards, sections/section×university, cluster map
│   ├── KnowledgeGraphs.php             # Per-item knowledge-graph builder (IDF-ranked)
│   ├── ForceLayout.php                 # Pure-PHP ForceAtlas2 — bakes entity-network positions
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
>   `asset/css/dre-visualizations.css`; they map straight onto the theme
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

The 12-colour categorical palette (`COLORS`) for multi-series charts follows the
data-colour contract: **stops 1–6 are the `--brand-*` pigments and must stay in
sync; stops 7–12 are an independent harmonious extension.** Stops 1–6 therefore
duplicate the brand tokens on purpose — change them in lockstep with `--brand-*`
(see the theme's [DESIGN.md §9](https://github.com/AM-Digital-Research-Environment/DRE-theme/blob/master/DESIGN.md)).
Compare-mode relies on a stable colour-by-index mapping, and the brand identity is
carried by `THEME.accent` (= `--primary`).

## Dependencies

Loaded via CDN (no bundling required):

- [ECharts 6](https://echarts.apache.org/)
- [echarts-wordcloud 2](https://github.com/ecomfe/echarts-wordcloud)
- [MapLibre GL 5](https://maplibre.org/)

## Related project

This module is the Omeka S half of a two-project initiative with the sibling **[amira dashboard](https://github.com/AM-Digital-Research-Environment/amira)** — a SvelteKit static site (ECharts 6 + MapLibre GL) that browses and visualizes the same **Africa Multiple Cluster of Excellence** research data. (amira was formerly the "WissKI dashboard"; some historical names in `ROADMAP.md` reflect that.)

The two are complementary and were brought to **analytical parity** over the shared dataset — tracked in [AM-Digital-Research-Environment/amira#10](https://github.com/AM-Digital-Research-Environment/amira/issues/10):

- **This module** renders a full per-entity dashboard (7–20 charts) inline on each Omeka resource page, plus cross-cutting site-page blocks — Collection Overview, Collection Dashboard, Compare, Project Explorer, What's New, Discursive Communities, Spatial Exploration, Publications, YouTube, Podcasts, and Photo Browsing.
- **amira** provides the broad cross-archive overviews as a standalone site.

A reader should find roughly the same analytical toolkit on either side. The "how to add a visualization" recipes and architecture guardrails distilled from that initiative live in [ROADMAP.md](ROADMAP.md).

## License

MIT
