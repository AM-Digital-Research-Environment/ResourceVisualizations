# AMIRA Visualization Porting Audit

Date: 2026-06-19

## Scope

This audit compares the static GitHub Pages dashboard in `AM-Digital-Research-Environment/amira` with the Omeka S module in this repository.

Sources inspected:

- Static dashboard: `AM-Digital-Research-Environment/amira`, local clone at `C:\tmp\amira`, commit `4e6c3a2` from 2026-06-15.
- Omeka S module: `AM-Digital-Research-Environment/DREVisualizations`, current checkout commit `1715b15d` from 2026-06-16.

The review is a code-level audit. I inspected routes, chart components, layout registries, precompute generators, block layouts, resource page blocks, and featured collection registries. I did not run a live Omeka S instance or regenerate every JSON cache.

## Executive Verdict

Most core AMIRA visualizations have been ported to the Omeka S module, and several areas are now richer than the static dashboard. The Omeka module covers the collection overview, per-entity dashboards, item knowledge graphs, sibling sparkline, project explorer, publications dashboard, YouTube dashboard, spatial exploration, what-is-new feed, photo browsing, featured collections, and many reusable chart types.

Follow-up decision and implementation note, 2026-06-19:

- Semantic map and semantic nearest-neighbour item recommendations are intentionally dropped.
- The Spittler featured collection and homepage global filtering are intentionally dropped from parity scope.
- A new Omeka `networkExplorer` page block has been added for the missing collection-wide network views.
- A new Omeka `compareGenres` page block has been added, and the generic compare controller now understands `genres`.
- Regenerate the precomputed visualisation data in Omeka before testing these new blocks; the regeneration now emits `asset/data/network-explorer.json` and `asset/data/item-dashboards/genres-index.json`.

There is one inactive or roadmap-level component, `CalendarHeatmap`, that exists in the static codebase but does not appear to be mounted in current static routes. It is not ported, but I would not treat it as a blocker unless component-level parity is required.

## Static Dashboard Inventory

The static dashboard exposes these main routes:

- `/`: collection overview.
- `/whats-new`: recent additions.
- `/research-sections`
- `/projects`
- `/research-items`
- `/publications`
- `/collections`
- `/collections/[slug]`
- `/people`
- `/groups`
- `/institutions`
- `/genres`
- `/languages`
- `/locations`
- `/resource-types`
- `/subjects`
- `/project-explorer`
- `/compare/[type]`
- `/network`
- `/semantic-map`
- `/sitemap.xml`

Important static chart and visualization components include:

- Time and distribution: `Timeline`, `StackedTimeline`, `StackedAreaChart`, `BarChart`, `PieChart`, `HeatmapChart`, `CalendarHeatmap`, `BeeswarmChart`, `BoxPlot`, `GanttChart`.
- Hierarchical and flow: `SankeyChart`, `SunburstChart`, `TreemapChart`, `ChordDiagram`, `TimeAwareChord`.
- Text and semantic: `WordCloud`, `SemanticScatter`, `SimilarItemsStrip`.
- Network: `NetworkGraph`, `ContributorNetwork`, `EntityKnowledgeGraph`.
- Spatial: `LocationMap`, `MiniMap`, `ChoroplethMap`, `GeoFlowMap`, `LocationsMapView`.
- UX helpers: `ChartDownloadButton`, compare views, item detail views, collection gallery/lightbox views.

The static generic dashboard layout declares these reusable chart keys:

`timeline`, `stackedTimeline`, `languageTimeline`, `subjectTrends`, `calendarHeatmap`, `types`, `languages`, `subjects`, `wordCloud`, `contributors`, `roles`, `heatmap`, `chord`, `coContributors`, `coSubjects`, `sankey`, `sunburst`, `treemap`, `timeAwareChord`, `boxPlot`, `locations`, `selfLocation`, `geoFlows`, `choropleth`, `contributorNetwork`, `affiliationNetwork`, `collabNetwork`, `knowledgeGraph`, `radar`, `similarItems`.

## Omeka Module Inventory

The Omeka module registers these site-page blocks:

- `collectionOverview`
- `collectionDashboard`
- `discursiveCommunities`
- `spatialExploration`
- `publications`
- `youtube`
- `projectExplorer`
- `compareEntity`
- `whatsNew`
- `photoBrowse`
- `featuredCollections`

It registers these resource-page blocks:

- `knowledgeGraph`
- `itemSetDashboard`
- `linkedItemsDashboard`
- `siblingItemsSparkline`

The JavaScript dashboard registry includes these chart builders:

`selfLocation`, `stackedTimeline`, `timeline`, `gantt`, `beeswarm`, `types`, `heatmap`, `sankey`, `sunburst`, `treemap`, `locations`, `choropleth`, `clusterPartners`, `sectionsBar`, `sectionUniversity`, `radar`, `templates`, `topVenues`, `topAuthors`, `playlists`, `coAuthorNetwork`, `boxplot`, `timeChord`, `languages`, `subjects`, `subjectTrends`, `languageTimeline`, `chord`, `collabNetwork`, `contributorNetwork`, `affiliationNetwork`, `affiliationMap`, `roles`, `genres`, `topLanguages`, `topResourceTypes`, `topAudiences`, `topPersons`, `topInstitutions`, `topGroups`, `topSubjects`, `topTags`, `topProjects`, `contributors`, `coAuthors`, `coSubjects`, `projects`.

Naming differences matter when checking parity:

- Static `boxPlot` maps to module `boxplot`.
- Static `timeAwareChord` maps to module `timeChord`.
- Static `wordCloud` maps to module `subjects`, which uses the module word-cloud builder.
- Static `geoFlows` is not exposed as a standalone registry key. It is generated in precompute data and rendered inside the module `locations` map overlay.
- Static `knowledgeGraph` is not a dashboard registry key in the module. It is a resource-page block.

## Coverage Matrix

| Static visualization area | Omeka counterpart | Status | Notes |
|---|---|---:|---|
| Homepage collection overview | `collectionOverview` block | Ported | Stat cards, cluster partners, research sections, section by university, stacked timeline, type/language heatmap, languages, resource types, subjects/tag cloud, and choropleth are represented. |
| Homepage global filters | None in `collectionOverview` | Partial | Static homepage has a resource type/language/university filter panel. The module overview renders precomputed aggregate charts without the same global cross-chart filtering. |
| Full collection dashboard | `collectionDashboard` block | Ported | Module provides stacked timeline, language timeline, timeline, Gantt, beeswarm, boxplot, types, languages, roles, heatmap, subjects, subject trends, sunburst, treemap, maps, chord/time chord, networks, contributors, projects, and Sankey. |
| Entity dashboards for sections, projects, people, organisations, locations, subjects, languages, genres, resource types | `linkedItemsDashboard`, `itemSetDashboard`, and module layout/precompute generators | Ported | Module layouts and precompute cover the main per-entity dashboards and category overviews. |
| Research item knowledge graph | `knowledgeGraph` resource-page block | Ported | Module has a dedicated resource-page block and per-item graph precompute. |
| Research item map | Knowledge graph/item map data | Ported | Module precompute creates item location maps alongside knowledge graphs. |
| Sibling items sparkline | `siblingItemsSparkline` resource-page block | Ported | Static sparkline behavior has an Omeka resource-page counterpart. |
| Semantic map | None | Dropped | Intentionally retired from the Omeka parity scope on 2026-06-19. |
| Similar item strip | None | Dropped | Intentionally retired from the Omeka parity scope on 2026-06-19. |
| Project explorer | `projectExplorer` block | Ported | Omeka block and assets are present. |
| Generic compare for projects | `compareEntity` block | Ported | Supported in module. |
| Generic compare for people | `compareEntity` block | Ported | Supported in module. |
| Generic compare for institutions | `compareEntity` block | Ported | Supported in module. |
| Generic compare for subjects | `compareEntity` block | Ported | Supported in module. |
| Generic compare for languages | `compareEntity` block | Ported | Supported in module. |
| Generic compare for genres | `compareGenres` block and generic compare `genres` type | Implemented | Added on 2026-06-19. Requires regenerated `genres-index.json`. |
| Network explorer: contributors/projects | `networkExplorer` block | Implemented | Added on 2026-06-19 as a collection-wide tab. Requires regenerated `network-explorer.json`. |
| Network explorer: co-authorship | `networkExplorer` block | Implemented | Added on 2026-06-19 as a collection-wide person co-occurrence tab. |
| Network explorer: people/institutions | `networkExplorer` block | Implemented | Added on 2026-06-19 as a collection-wide affiliation tab. |
| Network explorer: institution collaborations | `networkExplorer` block | Implemented | Added on 2026-06-19 as a collection-wide institution collaboration tab. |
| Network explorer: discursive communities | `discursiveCommunities` block | Ported | Module provides a collection-wide entity graph/discursive communities block. |
| Spatial locations browse/map | `spatialExploration` block plus map charts | Ported | Module has a dedicated spatial exploration block and dashboard map charts. |
| Geo flows | `locations` map overlay and generated `geoFlows` data | Ported with changed UI | The module renders flow lines inside the location map rather than as a separately registered chart key. |
| Publications dashboard | `publications` block | Ported | Module has publication stats, venues, authors, co-author network, keyword chord, word cloud, languages, and timeline. |
| YouTube dashboard | `youtube` block | Ported/extra | Module includes a YouTube dashboard. This is an Omeka-side addition compared with the main static route list. |
| What is new | `whatsNew` block | Ported | Module generates `whats-new.json` and has a site-page block. |
| Collection galleries/photo browsing | `featuredCollections` and `photoBrowse` blocks | Mostly ported | Module has masonry, map/timeline/lightbox/issue-TOC style support through featured/photo blocks. One static collection is missing from the module registry. |
| Featured collection: ILAM | `FeaturedCollections\Registry` | Ported | Present in module registry. |
| Featured collection: UFBA/Museu collection 1 | `FeaturedCollections\Registry` | Ported | Present in module registry. |
| Featured collection: UFBA/Museu collection 2 | `FeaturedCollections\Registry` | Ported | Present in module registry. |
| Featured collection: UFBA/Museu collection 3 | `FeaturedCollections\Registry` | Ported | Present in module registry. |
| Featured collection: Pre-Death Bequest of Gerd Spittler | None | Dropped | Intentionally excluded from the Omeka parity scope on 2026-06-19. |
| Chart image export | Module dashboard toolbar | Ported with changed UI | Static has `ChartDownloadButton`; module has save-as-image and decal controls in dashboard core. |
| Calendar heatmap component | None | Not ported, likely inactive | Static component exists but does not appear to be mounted in current active routes/layouts. |

## Detailed Findings

### 1. Core Dashboard Coverage Is Strong

The Omeka module has a broad site-page block and resource-page block surface:

- `config/module.config.php` registers all main Omeka visualization blocks.
- `asset/js/dashboard-layouts.js` defines collection, entity, category, publication, and YouTube layouts.
- `asset/js/dashboard-registry.js` maps dashboard keys to ECharts, MapLibre, and custom builders.
- `src/Precompute/Runner.php` generates most aggregate JSON payloads.

The precompute runner covers:

- Sections
- Projects
- People
- Institutions
- Locations
- Subjects
- Resource types, languages, and genres through item-set generation
- Category overviews
- Collection overview
- Discursive communities/entity graph
- Spatial exploration
- Publications
- YouTube
- What's new
- Photo galleries
- Featured collections
- Knowledge graphs

This means the static dashboard's central analytical layer has largely moved into the Omeka module.

### 2. Semantic Visualization Is Retired

The semantic map and semantic nearest-neighbour item strip are not being ported.

The static dashboard has a semantic workflow:

- `src/routes/semantic-map/+page.svelte`
- `src/lib/components/charts/SemanticScatter.svelte`
- `scripts/generate_embeddings.py`
- `static/data/embeddings/map.json`
- `static/data/embeddings/similar.json`
- `SimilarItemsStrip` on research item detail pages

The Omeka module has no comparable semantic-map block, embedding generator, embedding JSON convention, UMAP/scatter builder, or similar-items strip. This is now an intentional retirement decision rather than a blocker.

### 3. Static Network Explorer Follow-Up

The static `/network` route has five tabs:

- Contributors ↔ Projects
- Co-authorship
- People ↔ Institutions
- Institution collaborations
- Discursive communities

The Omeka module now provides:

- `discursiveCommunities` as a site-page block.
- `networkExplorer` as a site-page block for the other four collection-wide tabs.
- `asset/data/network-explorer.json`, generated by the precompute runner.
- `asset/js/dashboard-network-explorer.js`, which renders the tabbed ECharts explorer.

### 4. Genre Compare Follow-Up

The static compare system supports:

- projects
- people
- institutions
- subjects
- languages
- genres

The Omeka module compare block originally supported:

- projects
- people
- institutions
- subjects
- languages

Genre comparison is now implemented through:

- `compareGenres` page block.
- `genres` support in `asset/js/dashboard-compare.js`.
- `genres-index.json`, generated by the precompute runner.

### 5. Featured Collection Registry Scope

The static registry includes Spittler, ILAM, and three UFBA/Museu collections.

The Omeka module registry includes ILAM, the three UFBA/Museu collections, and DECCA/Jambo link-out cards.

The Spittler collection is intentionally dropped from the parity scope.

### 6. Homepage Filters Are Retired

The static homepage uses a global filter panel for resource type, language, and university. This interaction is intentionally dropped from the Omeka parity scope.

### 7. Geo Flow Port Is a UI Change, Not a Missing Feature

The static dashboard has an explicit `geoFlows` chart key. The module precompute still generates `geoFlows`, and the map chart code consumes this data inside the `locations` map. The registry does not expose `geoFlows` as a standalone dashboard key.

This should be documented as a changed presentation model rather than a missing port.

### 8. Calendar Heatmap Appears Inactive

The static codebase contains a `CalendarHeatmap` component and a `calendarHeatmap` chart key in the generic layout type. I did not find evidence that it is mounted in an active current route. The Omeka module does not have a calendar heatmap builder.

Recommendation: do not block deprecation on this unless the static site currently exposes a calendar heatmap in production or stakeholders require component-level parity.

## Remaining Actions

### P1: Regenerate Omeka Precomputed Data

Run the module's admin regeneration job before testing the new blocks. The new code needs:

- `asset/data/network-explorer.json`
- `asset/data/item-dashboards/genres-index.json`

### P2: Runtime-Verify the New Blocks

Add these blocks to Omeka pages and verify the rendered output:

- `Network Explorer`
- `Compare Genres`

### P3: Ignore or Retire Calendar Heatmap Unless Needed

Only port calendar heatmap if a real current page depends on it or if it is part of a desired future dashboard.

## Files That Anchored the Audit

Static dashboard:

- `src/routes/+page.svelte`
- `src/routes/network/+page.svelte`
- `src/routes/semantic-map/+page.svelte`
- `src/lib/components/dashboards/entityDashboardLayouts.ts`
- `src/lib/components/compare/compareTypes.ts`
- `src/lib/components/research-items/ItemDetail.svelte`
- `src/lib/components/research-items/SimilarItemsStrip.svelte`
- `src/lib/components/charts/SemanticScatter.svelte`
- `src/lib/utils/collectionsRegistry.ts`
- `scripts/generate_embeddings.py`

Omeka module:

- `config/module.config.php`
- `src/Precompute/Runner.php`
- `src/Site/BlockLayout/CollectionOverview.php`
- `src/Site/BlockLayout/CollectionDashboard.php`
- `src/Site/BlockLayout/DiscursiveCommunities.php`
- `src/Site/BlockLayout/SpatialExploration.php`
- `src/Site/BlockLayout/CompareEntity.php`
- `src/Site/BlockLayout/FeaturedCollections.php`
- `src/Site/BlockLayout/PhotoBrowse.php`
- `src/Site/ResourcePageBlockLayout/KnowledgeGraph.php`
- `src/Site/ResourcePageBlockLayout/LinkedItemsDashboard.php`
- `src/Site/ResourcePageBlockLayout/SiblingItemsSparkline.php`
- `src/FeaturedCollections/Registry.php`
- `asset/js/dashboard-registry.js`
- `asset/js/dashboard-layouts.js`
- `asset/js/dashboard-compare.js`
- `asset/js/dashboard-charts-map.js`
- `asset/js/entity-graph.js`

## Deprecation Readiness

The static dashboard should not be fully retired as a visualization source of record until one of these is true:

1. The new Network Explorer and Compare Genres blocks are runtime-verified after regeneration.
2. The project records semantic visualizations, Spittler, and homepage global filters as retired or intentionally changed in the Omeka version.

For most conventional dashboard analytics, the Omeka module is ready and appears to be the more complete destination. The remaining work is operational verification of the new block surfaces, not broad chart parity.
