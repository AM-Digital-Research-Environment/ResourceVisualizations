<?php
declare(strict_types=1);

namespace DreVisualizations\Precompute;

use Doctrine\DBAL\Connection;
use DreVisualizations\FeaturedCollections\Registry;

/**
 * Orchestrates the dashboard precompute: loads the data, calls the pure
 * {@see Aggregators} (unit-tested) and writes the JSON artefacts Omeka serves.
 *
 * Run from the admin "Regenerate" Job (reusing Omeka's DBAL connection) so the
 * module is self-contained — no Python, no separate MySQL credentials.
 */
final class Runner
{
    // Resource template IDs.
    private const TEMPLATE_ORGANISATION = 2;
    private const TEMPLATE_LOCATION = 3;
    private const TEMPLATE_PERSONS = 4;
    private const TEMPLATE_PROJECTS = 5;
    private const TEMPLATE_AUTHORITY = 6;
    private const TEMPLATE_SECTIONS = 7;
    private const TEMPLATE_RESEARCH_ITEMS = 10;

    private const TEMPLATE_RESOURCE_TYPE = [
        2 => 'organisation', 3 => 'location', 4 => 'person',
        5 => 'project', 7 => 'section', 10 => 'researchItem',
    ];

    // Item set IDs.
    private const ITEM_SET_GENRE = 21;
    private const ITEM_SET_LANGUAGE = 19;
    private const ITEM_SET_RESOURCE_TYPE = 1;
    private const ITEM_SET_TARGET_AUDIENCE = 3169;
    private const ITEM_SET_PERSON = 18;
    private const ITEM_SET_INSTITUTION = 110;
    private const ITEM_SET_SUBJECT = 1852;
    private const ITEM_SET_PROJECT = 20;
    private const ITEM_SET_PUBLICATIONS = 29918;
    private const ITEM_SET_PODCASTS = 39095;
    private const ITEM_SET_YOUTUBE = 39192;
    private const ITEM_SET_YOUTUBE_PLAYLISTS = 39193;

    /**
     * Synthetic resource-type label used to fold cluster publications into the
     * Collection Overview's resource-type pie and year×type timeline (they carry
     * no dcterms:type of their own). See generateCollectionOverview().
     */
    private const SYNTHETIC_TYPE_PUBLICATION = 'Publication';

    /**
     * Synthetic resource-type label folding the curated Podcasts item set (39095)
     * into the Collection Overview as one "Podcast" category. See
     * generateCollectionOverview() and podcastIds().
     */
    private const SYNTHETIC_TYPE_PODCAST = 'Podcast';

    /**
     * Synthetic resource-type label folding the synced YouTube videos item set
     * (39192) into the Collection Overview as one "YouTube video" category. The
     * videos carry a dcterms:language and dcterms:date but no dcterms:type of
     * their own, so the synthetic label is what places them in the resource-type
     * pie, the year×type timeline and the type×language heatmap. See
     * generateCollectionOverview() and youtubeIds().
     */
    private const SYNTHETIC_TYPE_YOUTUBE = 'YouTube video';

    // External partner collections — their items reach the section×university
    // overview via item-set membership (they sit outside the section→project
    // hierarchy: ILAM items have no dcterms:isPartOf, the BayGlo project names no
    // section). Routed onto a partner-university column in generateCollectionOverview().
    private const ITEM_SET_ILAM = 27724;     // International Library of African Music → Rhodes University
    private const ITEM_SET_BAYGLO = 27601;   // Bayreuth Global/Postkolonial → University of Bayreuth

    /**
     * External partner collections, item-set id → routing. The amira dashboard
     * models each as a virtual project (it has items but no projectsData /
     * template-5 project entity), and its items sit outside the
     * section→project→item hierarchy — so generateCollectionOverview() folds
     * them onto a partner-university column of the section×university heatmap.
     */
    private const EXTERNAL_COLLECTIONS = [
        self::ITEM_SET_ILAM => ['section' => 'External', 'university' => 'Rhodes University'],
        self::ITEM_SET_BAYGLO => ['section' => 'External', 'university' => 'University of Bayreuth'],
    ];

    // Parent item IDs for category overviews.
    private const OVERVIEW_GENRE = 22198;
    private const OVERVIEW_LANGUAGE = 2039;
    private const OVERVIEW_RESOURCE_TYPE = 22203;
    private const OVERVIEW_TARGET_AUDIENCE = 22479;
    private const OVERVIEW_PERSON = 22200;
    private const OVERVIEW_INSTITUTION = 22202;
    private const OVERVIEW_GROUP = 22536;
    private const OVERVIEW_LCSH = 3167;
    private const OVERVIEW_TAG = 22199;
    private const OVERVIEW_PROJECT = 3346;

    /**
     * Cluster-partner category authority records (children of "African Multiple
     * Partners" 39074) → the legend category key, in display order. Any
     * Organisation item that `dcterms:isPartOf` one of these and carries
     * coordinates becomes a data-driven marker on the Collection Overview cluster
     * map (see Aggregators::clusterPartners), replacing the former hard-coded list.
     */
    private const CLUSTER_CATEGORY_AUTHORITIES = [
        37685 => 'amrc',         // Africa Multiple Research Centres
        39073 => 'privileged',   // Privileged partner
        39072 => 'cooperation',  // Cooperation partners
        39071 => 'global',       // Global partner Centres of African Studies
    ];

    private array $items = [];
    private array $links = [];
    private array $reverseLinks = [];
    private array $childrenOf = [];
    private array $itemYear = [];
    private array $itemDate = [];
    private array $temporal = [];
    private array $geo = [];
    private array $itemSets = [];
    private array $templateLabels = [];
    private array $literals = [];
    private array $primaryMedia = [];
    private array $countryIndex = [];

    /**
     * Extra literals (dcterms:identifier, dcterms:description, bibo:doi) for the
     * items of the featured-collections item sets only — used to split Museu
     * Afro-Digital by identifier prefix and to derive ILAM volume/issue/pages.
     * Keyed item id => ['ident'=>?, 'desc'=>?, 'doi'=>?]. Loaded scoped (not in
     * the global DataLoader) so the general literal map stays lean.
     */
    private array $featuredLiterals = [];

    /**
     * Entity counts for the Collection Overview stat cards, filled by the
     * per-entity index passes (each counts entities that have ≥1 linked item)
     * and read by {@see self::buildOverviewStats()}.
     */
    private array $statCounts = [];

    /** Safety bound on a single gallery's serialised records (matches the block). */
    private const MAX_GALLERY_PHOTOS = 600;

    /**
     * Spatial Exploration picker cap: the high-cardinality picker types (People,
     * Organisations, Subjects) are trimmed to this many entities — the top N by
     * mapped-place count — so the precomputed payload stays lean. Projects and
     * Research Sections are bounded (~40 / ~6) and kept whole.
     */
    private const SPATIAL_PICKER_CAP = 400;

    private int $fileCount = 0;

    /** @var callable|null A log sink: fn(string $message): void */
    private $logFn;

    public function __construct(
        private readonly Connection $connection,
        private readonly string $outputDir,
        private readonly string $communitiesDir,
        private readonly string $countriesGeojson,
        private readonly string $knowledgeGraphsDir,
        private readonly string $galleriesDir,
        private readonly string $featuredDir,
        ?callable $logFn = null,
    ) {
        $this->logFn = $logFn;
    }

    private function log(string $msg): void
    {
        if ($this->logFn !== null) {
            ($this->logFn)($msg);
        }
    }

    private function save(int|string $id, array $dashboard): void
    {
        $path = $this->outputDir . '/' . $id . '.json';
        file_put_contents($path, json_encode($dashboard, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        $this->fileCount++;
    }

    /** Write a Compare/Explorer index (`[{id,name,items}]`), sorted by name. */
    private function saveIndex(string $file, array $index): void
    {
        usort($index, static fn ($a, $b) => strcmp((string) $a['name'], (string) $b['name']));
        file_put_contents($this->outputDir . '/' . $file, json_encode($index, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        $this->log('  ' . $file . ': ' . count($index) . ' entries');
    }

    /** Entry point. Returns a small stats array for the job log. */
    public function run(): array
    {
        if (!is_dir($this->outputDir)) {
            mkdir($this->outputDir, 0775, true);
        }

        $data = (new DataLoader($this->connection))->load(fn (string $m) => $this->log($m));
        $this->items = $data['items'];
        $this->links = $data['links'];
        $this->reverseLinks = $data['reverseLinks'];
        $this->childrenOf = $data['childrenOf'];
        $this->itemYear = $data['itemYear'];
        $this->itemDate = $data['itemDate'];
        $this->temporal = $data['temporal'];
        $this->geo = $data['geo'];
        $this->itemSets = $data['itemSets'];
        $this->templateLabels = $data['templateLabels'];
        $this->literals = $data['literals'];
        $this->primaryMedia = $data['primaryMedia'];
        $this->loadFeaturedLiterals();

        $features = Aggregators::loadCountryFeatures($this->countriesGeojson);
        $this->countryIndex = Aggregators::buildCountryIndex($this->geo, $features);
        $this->log('  country index: ' . count($this->countryIndex) . ' locations geocoded');

        $this->generateSections();
        $this->generateProjects();
        $this->generatePeople();
        $this->generateInstitutions();
        $this->generateLocations();
        $this->generateSubjects();
        $this->generateByItemSet(self::ITEM_SET_RESOURCE_TYPE, 'dcterms:type', 'Resource Types', 'authority', ['types']);
        $this->generateByItemSet(self::ITEM_SET_LANGUAGE, 'dcterms:language', 'Languages', 'authority', ['languages'], 'languages-index.json');
        $this->generateByItemSet(self::ITEM_SET_GENRE, 'dcterms:format', 'Genres', 'genre', [], 'genres-index.json');
        $this->generateCategoryOverviews();
        $this->generateCollectionOverview();
        $this->generateCommunities();
        $this->generateEntityGraph();
        $this->generateNetworkExplorer();
        $this->generateSpatialExploration();
        $this->generatePublications();
        $this->generateYouTube();
        $this->generateWhatsNew();
        $this->generatePhotoGalleries();
        $this->generateFeaturedCollections();
        $this->generateKnowledgeGraphs();

        $this->log('Done. ' . $this->fileCount . ' files written.');
        return ['files' => $this->fileCount];
    }

    /* ------------------------------------------------------------------ */
    /*  Shared standard chart set (mirrors generators._add_standard_charts) */
    /* ------------------------------------------------------------------ */

    private function addStandardCharts(array &$dashboard, int $entityId, string $entityTitle, array $itemIds): void
    {
        if ($v = Aggregators::buildHeatmap($itemIds, $this->links, $this->items)) {
            $dashboard['heatmap'] = $v;
        }
        if ($v = Aggregators::buildChord($itemIds, $this->links, $this->items)) {
            $dashboard['chord'] = $v;
        }
        if ($v = Aggregators::buildStackedTimeline($itemIds, $this->links, $this->items, $this->itemYear)) {
            $dashboard['stackedTimeline'] = $v;
        }
        if ($v = Aggregators::buildSankey($itemIds, $this->links, $this->items)) {
            $dashboard['sankey'] = $v;
        }
        if ($v = Aggregators::buildSunburst($itemIds, $this->links, $this->items)) {
            $dashboard['sunburst'] = $v;
        }
        if ($v = Aggregators::buildRoles($itemIds, $this->links, $this->items)) {
            $dashboard['roles'] = $v;
        }
        if ($v = Aggregators::buildContributorNetwork($entityId, $entityTitle, $itemIds, $this->items, $this->links, $this->childrenOf)) {
            $dashboard['contributorNetwork'] = $v;
        }
        if ($v = Aggregators::buildSubjectTrends($itemIds, $this->links, $this->items, $this->itemYear)) {
            $dashboard['subjectTrends'] = $v;
        }
        if ($v = Aggregators::buildLanguageTimeline($itemIds, $this->links, $this->items, $this->itemYear)) {
            $dashboard['languageTimeline'] = $v;
        }
        if ($v = Aggregators::buildTreemap($itemIds, $this->links, $this->items, $this->childrenOf, $entityTitle)) {
            $dashboard['treemap'] = $v;
        }
        if ($v = Aggregators::buildGeoFlows($itemIds, $this->links, $this->items, $this->geo)) {
            $dashboard['geoFlows'] = $v;
        }
        if ($v = Aggregators::buildChoropleth($itemIds, $this->links, $this->countryIndex)) {
            $dashboard['choropleth'] = $v;
        }
        if ($v = Aggregators::buildTimeChord($itemIds, $this->links, $this->items, $this->itemYear)) {
            $dashboard['timeChord'] = $v;
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Per-entity generators                                              */
    /* ------------------------------------------------------------------ */

    private function generateSections(): void
    {
        $sections = $this->itemsWhere(fn ($info) => ($info['class_term'] ?? '') === 'frapo:ResearchGroup');
        $this->log('=== Research Sections (' . count($sections) . ') ===');
        $allBeeswarm = [];

        foreach ($sections as $sid => $sinfo) {
            $projectIds = $this->childrenOf[$sid] ?? [];
            $itemIds = [];
            $projectsBreakdown = [];
            $ganttData = [];
            foreach ($projectIds as $pid) {
                $projItems = $this->childrenOf[$pid] ?? [];
                $itemIds = array_merge($itemIds, $projItems);
                $ptitle = $this->items[$pid]['title'] ?? ('Project ' . $pid);
                if ($projItems) {
                    $projectsBreakdown[] = ['name' => $ptitle, 'value' => count($projItems), 'itemId' => $pid];
                }
                if (isset($this->temporal[$pid])) {
                    [$start, $end] = $this->temporal[$pid];
                    $ganttData[] = ['name' => $ptitle, 'start' => $start, 'end' => $end, 'itemId' => $pid];
                }
            }
            if (!$itemIds) {
                continue;
            }
            $dashboard = Aggregators::aggregateItems($itemIds, $this->items, $this->links, $this->itemYear, $this->geo);
            usort($projectsBreakdown, static fn ($a, $b) => $b['value'] <=> $a['value']);
            $dashboard['projects'] = $projectsBreakdown;
            if ($ganttData) {
                usort($ganttData, static fn ($a, $b) => strcmp((string) $a['start'], (string) $b['start']));
                $dashboard['gantt'] = $ganttData;
            }
            $beeswarm = Aggregators::buildBeeswarm($sinfo['title'], $projectIds, $this->items, $this->childrenOf, $this->temporal);
            if ($beeswarm) {
                $dashboard['beeswarm'] = $beeswarm;
                $allBeeswarm = array_merge($allBeeswarm, $beeswarm);
            }
            $this->addStandardCharts($dashboard, $sid, $sinfo['title'], $itemIds);
            $dashboard['resourceType'] = self::TEMPLATE_RESOURCE_TYPE[$this->items[$sid]['template_id']] ?? 'section';
            $this->save($sid, $dashboard);
        }

        if ($allBeeswarm) {
            file_put_contents($this->outputDir . '/beeswarm-all-sections.json', json_encode($allBeeswarm, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        }
    }

    private function generateProjects(): void
    {
        $projects = $this->itemsWhere(fn ($info) => ($info['template_id'] ?? null) === self::TEMPLATE_PROJECTS);
        $this->log('=== Projects (' . count($projects) . ') ===');

        // Radar normalisation: per-project breadth maxima.
        $radarProfiles = [];
        foreach ($projects as $pid => $_) {
            $ids = $this->childrenOf[$pid] ?? [];
            if ($ids) {
                $radarProfiles[$pid] = Aggregators::profileFromItems($ids, $this->links, $this->itemYear);
            }
        }
        $radarMax = Aggregators::profileMaxima(array_values($radarProfiles));

        $projectIndex = [];
        foreach ($projects as $pid => $pinfo) {
            $itemIds = $this->childrenOf[$pid] ?? [];
            if (!$itemIds) {
                continue;
            }
            $sectionNames = [];
            foreach ($this->links[$pid] ?? [] as [$term, $label, $vrid]) {
                if ($term === 'dcterms:isPartOf' && ($this->items[$vrid]['class_term'] ?? '') === 'frapo:ResearchGroup') {
                    $sectionNames[] = $this->items[$vrid]['title'];
                }
            }
            $projectIndex[] = ['id' => $pid, 'name' => $pinfo['title'], 'items' => count($itemIds), 'sections' => $sectionNames];

            $dashboard = Aggregators::aggregateItems($itemIds, $this->items, $this->links, $this->itemYear, $this->geo);
            $this->addStandardCharts($dashboard, $pid, $pinfo['title'], $itemIds);
            // Map of the geocoded institutions the project's members (PI + team) are
            // affiliated with — mirrors the per-person affiliation map.
            if ($affMap = Aggregators::buildProjectAffiliationMap($pid, $this->links, $this->items, $this->geo)) {
                $dashboard['affiliationMap'] = $affMap;
            }
            if ($radar = Aggregators::buildRadar($radarProfiles[$pid] ?? null, $radarMax)) {
                $dashboard['radar'] = $radar;
            }
            $dashboard['resourceType'] = self::TEMPLATE_RESOURCE_TYPE[$this->items[$pid]['template_id']] ?? 'project';
            $this->save($pid, $dashboard);
        }

        usort($projectIndex, static fn ($a, $b) => strcmp((string) $a['name'], (string) $b['name']));
        file_put_contents($this->outputDir . '/projects-index.json', json_encode($projectIndex, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        $this->statCounts['projects'] = count($projectIndex);
    }

    private function generatePeople(): void
    {
        $people = $this->itemsWhere(fn ($info) => ($info['template_id'] ?? null) === self::TEMPLATE_PERSONS);
        $this->log('=== People (' . count($people) . ') ===');

        $personTerms = ['dcterms:creator', 'dcterms:contributor', 'foaf:member', 'bibo:authorList', 'bibo:editorList'];
        foreach ($this->reverseLinks as $revTerms) {
            foreach ($revTerms as $t => $_) {
                if (str_starts_with($t, 'marcrel:')) {
                    $personTerms[$t] = $t;
                }
            }
        }
        $personTerms = array_values(array_unique($personTerms));

        $radarProfiles = [];
        foreach ($people as $pid => $_) {
            $ids = Aggregators::findItemsLinkingTo($pid, $this->reverseLinks, $personTerms);
            if ($ids) {
                $radarProfiles[$pid] = Aggregators::profileFromItems($ids, $this->links, $this->itemYear);
            }
        }
        $radarMax = Aggregators::profileMaxima(array_values($radarProfiles));

        $index = [];
        foreach ($people as $pid => $pinfo) {
            $itemIds = Aggregators::findItemsLinkingTo($pid, $this->reverseLinks, $personTerms);
            if (!$itemIds) {
                continue;
            }
            $index[] = ['id' => $pid, 'name' => $pinfo['title'], 'items' => count($itemIds)];
            $dashboard = Aggregators::aggregateItems($itemIds, $this->items, $this->links, $this->itemYear, $this->geo);
            if ($v = Aggregators::buildTemplates($itemIds, $this->items, $this->templateLabels)) {
                $dashboard['templates'] = $v;
            }
            // Map of the person's geocoded institution affiliations (dcterms:isPartOf).
            if ($affMap = Aggregators::buildAffiliationMap($pid, $this->links, $this->items, $this->geo)) {
                $dashboard['affiliationMap'] = $affMap;
            }

            $coauthors = [];
            foreach ($itemIds as $iid) {
                foreach ($this->links[$iid] ?? [] as [$term, $label, $vrid]) {
                    if (($term === 'dcterms:creator' || $term === 'dcterms:contributor' || $term === 'bibo:authorList' || $term === 'bibo:editorList' || str_starts_with($term, 'marcrel:')) && $vrid !== $pid) {
                        if (($this->items[$vrid]['template_id'] ?? null) === self::TEMPLATE_PERSONS) {
                            $coauthors[$vrid] ??= ['name' => $this->items[$vrid]['title'], 'value' => 0, 'itemId' => $vrid];
                            $coauthors[$vrid]['value']++;
                        }
                    }
                }
            }
            usort($coauthors, static fn ($a, $b) => $b['value'] <=> $a['value']);
            $dashboard['coAuthors'] = array_slice(array_values($coauthors), 0, 20);
            unset($dashboard['contributors']);

            if ($roles = Aggregators::buildRolesFor($pid, $itemIds, $this->links)) {
                $dashboard['roles'] = $roles;
            }
            if ($radar = Aggregators::buildRadar($radarProfiles[$pid] ?? null, $radarMax)) {
                $dashboard['radar'] = $radar;
            }
            if ($net = Aggregators::buildContributorNetwork($pid, $pinfo['title'], $itemIds, $this->items, $this->links, $this->childrenOf)) {
                $dashboard['contributorNetwork'] = $net;
            }
            $dashboard['resourceType'] = self::TEMPLATE_RESOURCE_TYPE[$this->items[$pid]['template_id']] ?? 'person';
            $this->save($pid, $dashboard);
        }

        $this->saveIndex('people-index.json', $index);
    }

    private function generateInstitutions(): void
    {
        $institutions = $this->itemsWhere(fn ($info) => ($info['class_term'] ?? '') === 'foaf:Organization');
        $this->log('=== Institutions (' . count($institutions) . ') ===');

        $instSet = [];
        foreach ($institutions as $iid => $_) {
            $instSet[$iid] = true;
        }
        $instTerms = ['frapo:isFundedBy', 'dcterms:provenance'];
        foreach ($this->reverseLinks as $rev) {
            foreach ($rev as $t => $_) {
                if (str_starts_with($t, 'marcrel:')) {
                    $instTerms[$t] = $t;
                }
            }
        }
        $instTerms = array_values(array_unique($instTerms));

        $radarProfiles = [];
        foreach ($institutions as $iid => $_) {
            $ids = Aggregators::findItemsLinkingTo($iid, $this->reverseLinks, $instTerms);
            if ($ids) {
                $radarProfiles[$iid] = Aggregators::profileFromItems($ids, $this->links, $this->itemYear);
            }
        }
        $radarMax = Aggregators::profileMaxima(array_values($radarProfiles));

        $index = [];
        foreach ($institutions as $iid => $iinfo) {
            $itemIds = Aggregators::findItemsLinkingTo($iid, $this->reverseLinks, $instTerms);
            if (!$itemIds) {
                continue;
            }
            $index[] = ['id' => $iid, 'name' => $iinfo['title'], 'items' => count($itemIds)];
            $dashboard = Aggregators::aggregateItems($itemIds, $this->items, $this->links, $this->itemYear, $this->geo);
            // The institution's own location (it now carries geo:lat/long like a
            // Location), shown as a self-location mini-map on its page.
            if (isset($this->geo[$iid])) {
                $g = $this->geo[$iid];
                $dashboard['selfLocation'] = ['name' => $g['name'], 'lat' => $g['lat'], 'lon' => $g['lon'], 'itemId' => $iid];
            }
            if ($v = Aggregators::buildTemplates($itemIds, $this->items, $this->templateLabels)) {
                $dashboard['templates'] = $v;
            }
            if ($collab = Aggregators::buildCollabNetwork($iid, $iinfo['title'], $itemIds, $this->items, $this->links, $this->reverseLinks, $instSet, $instTerms)) {
                $dashboard['collabNetwork'] = $collab;
            }
            if ($affil = Aggregators::buildAffiliationNetwork($iid, $iinfo['title'], $this->items, $this->links, $this->reverseLinks)) {
                $dashboard['affiliationNetwork'] = $affil;
            }
            if ($radar = Aggregators::buildRadar($radarProfiles[$iid] ?? null, $radarMax)) {
                $dashboard['radar'] = $radar;
            }
            $dashboard['resourceType'] = self::TEMPLATE_RESOURCE_TYPE[$this->items[$iid]['template_id']] ?? 'organisation';
            $this->save($iid, $dashboard);
        }

        $this->saveIndex('institutions-index.json', $index);
    }

    private function generateLocations(): void
    {
        $locs = $this->itemsWhere(fn ($info) => ($info['template_id'] ?? null) === self::TEMPLATE_LOCATION);
        $this->log('=== Locations (' . count($locs) . ') ===');
        $withItems = 0;
        foreach ($locs as $lid => $linfo) {
            $itemIds = Aggregators::findItemsLinkingTo($lid, $this->reverseLinks, ['dcterms:spatial', 'dcterms:provenance']);
            if (!$itemIds) {
                continue;
            }
            $withItems++;
            $dashboard = Aggregators::aggregateItems($itemIds, $this->items, $this->links, $this->itemYear, $this->geo);
            if (isset($this->geo[$lid])) {
                $g = $this->geo[$lid];
                $dashboard['selfLocation'] = ['name' => $g['name'], 'lat' => $g['lat'], 'lon' => $g['lon'], 'itemId' => $lid];
            }
            if ($geoFlows = Aggregators::buildGeoFlows($itemIds, $this->links, $this->items, $this->geo)) {
                $dashboard['geoFlows'] = $geoFlows;
            }
            $dashboard['resourceType'] = self::TEMPLATE_RESOURCE_TYPE[$this->items[$lid]['template_id']] ?? 'location';
            $this->save($lid, $dashboard);
        }
        $this->statCounts['locations'] = $withItems;
    }

    private function generateSubjects(): void
    {
        $subjects = $this->itemsWhere(fn ($info) => ($info['template_id'] ?? null) === self::TEMPLATE_AUTHORITY);
        $this->log('=== Subjects/Authority (' . count($subjects) . ') ===');
        $index = [];
        foreach ($subjects as $sid => $sinfo) {
            $itemIds = Aggregators::findItemsLinkingTo($sid, $this->reverseLinks, ['dcterms:subject']);
            if (!$itemIds) {
                continue;
            }
            $index[] = ['id' => $sid, 'name' => $sinfo['title'], 'items' => count($itemIds)];
            $dashboard = Aggregators::aggregateItems($itemIds, $this->items, $this->links, $this->itemYear, $this->geo);
            $cosubs = [];
            foreach ($itemIds as $iid) {
                foreach ($this->links[$iid] ?? [] as [$term, $label, $vrid]) {
                    if ($term === 'dcterms:subject' && $vrid !== $sid) {
                        $cosubs[$vrid] ??= ['name' => $this->items[$vrid]['title'] ?? '', 'value' => 0, 'itemId' => $vrid];
                        $cosubs[$vrid]['value']++;
                    }
                }
            }
            usort($cosubs, static fn ($a, $b) => $b['value'] <=> $a['value']);
            $dashboard['coSubjects'] = array_slice(array_values($cosubs), 0, 30);
            unset($dashboard['subjects']);
            $dashboard['resourceType'] = 'authority';
            $this->save($sid, $dashboard);
        }

        $this->saveIndex('subjects-index.json', $index);
    }

    private function generateByItemSet(int $setId, string $term, string $label, string $resourceType, array $excludeKeys, ?string $indexFile = null): void
    {
        $setItems = $this->itemSets[$setId] ?? [];
        $this->log('=== ' . $label . ' (item set ' . $setId . ', ' . count($setItems) . ') ===');
        $index = [];
        foreach ($setItems as $eid) {
            $itemIds = Aggregators::findItemsLinkingTo($eid, $this->reverseLinks, [$term]);
            if (!$itemIds) {
                continue;
            }
            $index[] = ['id' => $eid, 'name' => $this->items[$eid]['title'] ?? ('Item ' . $eid), 'items' => count($itemIds)];
            $dashboard = Aggregators::aggregateItems($itemIds, $this->items, $this->links, $this->itemYear, $this->geo);
            foreach ($excludeKeys as $k) {
                unset($dashboard[$k]);
            }
            $dashboard['resourceType'] = $resourceType;
            $this->save($eid, $dashboard);
        }
        if ($indexFile !== null) {
            $this->saveIndex($indexFile, $index);
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Category overviews                                                 */
    /* ------------------------------------------------------------------ */

    private function generateOverview(int $parentId, string $label, array $setItems, array $terms, string $resourceType, string $distributionKey, ?callable $filterFn = null, array $extra = []): void
    {
        $members = [];
        foreach ($setItems as $sid) {
            if ($filterFn === null || $filterFn($sid)) {
                $members[] = $sid;
            }
        }
        if (!$members) {
            return;
        }
        $allItems = [];
        $memberCounts = [];
        foreach ($members as $mid) {
            $linked = Aggregators::findItemsLinkingTo($mid, $this->reverseLinks, $terms);
            foreach ($linked as $iid) {
                $allItems[$iid] = true;
            }
            if ($linked) {
                $mtitle = $this->items[$mid]['title'] ?? ('Item ' . $mid);
                $memberCounts[] = ['name' => $mtitle, 'value' => count($linked), 'itemId' => $mid];
            }
        }
        $allItems = array_keys($allItems);
        if (!$allItems) {
            return;
        }

        $dashboard = Aggregators::aggregateItems($allItems, $this->items, $this->links, $this->itemYear, $this->geo);
        usort($memberCounts, static fn ($a, $b) => $b['value'] <=> $a['value']);
        $dashboard[$distributionKey] = $memberCounts;

        if ($v = Aggregators::buildStackedTimeline($allItems, $this->links, $this->items, $this->itemYear)) {
            $dashboard['stackedTimeline'] = $v;
        }
        if ($v = Aggregators::buildHeatmap($allItems, $this->links, $this->items)) {
            $dashboard['heatmap'] = $v;
        }
        if ($v = Aggregators::buildRoles($allItems, $this->links, $this->items)) {
            $dashboard['roles'] = $v;
        }
        if ($v = Aggregators::buildSubjectTrends($allItems, $this->links, $this->items, $this->itemYear)) {
            $dashboard['subjectTrends'] = $v;
        }
        if ($v = Aggregators::buildLanguageTimeline($allItems, $this->links, $this->items, $this->itemYear)) {
            $dashboard['languageTimeline'] = $v;
        }
        if ($v = Aggregators::buildChoropleth($allItems, $this->links, $this->countryIndex)) {
            $dashboard['choropleth'] = $v;
        }
        if ($v = Aggregators::buildTemplates($allItems, $this->items, $this->templateLabels)) {
            $dashboard['templates'] = $v;
        }
        foreach ($extra as $k => $v) {
            $dashboard[$k] = $v;
        }
        $dashboard['resourceType'] = $resourceType;
        $this->save($parentId, $dashboard);
    }

    private function generateCategoryOverviews(): void
    {
        $this->log('=== Category Overviews ===');
        $personTerms = ['dcterms:creator', 'dcterms:contributor', 'bibo:authorList', 'bibo:editorList'];
        $instTerms = ['frapo:isFundedBy', 'dcterms:provenance'];
        foreach ($this->reverseLinks as $rev) {
            foreach ($rev as $t => $_) {
                if (str_starts_with($t, 'marcrel:')) {
                    $personTerms[$t] = $t;
                    $instTerms[$t] = $t;
                }
            }
        }
        $personTerms = array_values(array_unique($personTerms));
        $instTerms = array_values(array_unique($instTerms));

        $isLcsh = function (int $sid): bool {
            foreach ($this->links[$sid] ?? [] as [$term, $label, $vrid]) {
                if ($term === 'dcterms:type' && $vrid === self::OVERVIEW_LCSH) {
                    return true;
                }
            }
            return false;
        };

        $this->generateOverview(self::OVERVIEW_GENRE, 'Genre', $this->itemSets[self::ITEM_SET_GENRE] ?? [], ['dcterms:format'], 'genreOverview', 'genres');
        $this->generateOverview(self::OVERVIEW_LANGUAGE, 'Language', $this->itemSets[self::ITEM_SET_LANGUAGE] ?? [], ['dcterms:language'], 'languageOverview', 'topLanguages');
        $this->generateOverview(self::OVERVIEW_RESOURCE_TYPE, 'Resource Type', $this->itemSets[self::ITEM_SET_RESOURCE_TYPE] ?? [], ['dcterms:type'], 'resourceTypeOverview', 'topResourceTypes');
        $this->generateOverview(self::OVERVIEW_TARGET_AUDIENCE, 'Target Audience', $this->itemSets[self::ITEM_SET_TARGET_AUDIENCE] ?? [], ['dcterms:audience'], 'targetAudienceOverview', 'topAudiences');
        $this->generateOverview(self::OVERVIEW_PERSON, 'Person', $this->itemSets[self::ITEM_SET_PERSON] ?? [], $personTerms, 'personOverview', 'topPersons');
        $this->generateOverview(self::OVERVIEW_INSTITUTION, 'Institution', $this->itemSets[self::ITEM_SET_INSTITUTION] ?? [], $instTerms, 'institutionOverview', 'topInstitutions', fn (int $iid) => ($this->items[$iid]['class_term'] ?? '') === 'foaf:Organization');
        $this->generateOverview(self::OVERVIEW_GROUP, 'Group', $this->itemSets[self::ITEM_SET_INSTITUTION] ?? [], $instTerms, 'groupOverview', 'topGroups');
        $this->generateOverview(self::OVERVIEW_LCSH, 'LCSH Subject', $this->itemSets[self::ITEM_SET_SUBJECT] ?? [], ['dcterms:subject'], 'lcshOverview', 'topSubjects', $isLcsh);
        $this->generateOverview(self::OVERVIEW_TAG, 'Tag', $this->itemSets[self::ITEM_SET_SUBJECT] ?? [], ['dcterms:subject'], 'tagOverview', 'topTags', fn (int $sid) => !$isLcsh($sid));

        $projMembers = $this->itemSets[self::ITEM_SET_PROJECT] ?? [];
        $projExtra = $this->buildProjectsTimelineCharts($projMembers);
        $this->generateOverview(self::OVERVIEW_PROJECT, 'Research Project', $projMembers, ['dcterms:isPartOf'], 'projectOverview', 'topProjects', null, $projExtra);
    }

    /** Gantt + section-grouped beeswarm for the Projects overview. */
    private function buildProjectsTimelineCharts(array $projectIds): array
    {
        $extra = [];
        $projSet = array_flip($projectIds);

        $gantt = [];
        foreach ($projectIds as $pid) {
            if (isset($this->temporal[$pid])) {
                [$start, $end] = $this->temporal[$pid];
                $gantt[] = ['name' => $this->items[$pid]['title'] ?? ('Project ' . $pid), 'start' => $start, 'end' => $end, 'itemId' => $pid];
            }
        }
        if ($gantt) {
            usort($gantt, static fn ($a, $b) => strcmp((string) $a['start'], (string) $b['start']));
            $extra['gantt'] = $gantt;
        }

        $beeswarm = [];
        $grouped = [];
        $sections = $this->itemsWhere(fn ($info) => ($info['class_term'] ?? '') === 'frapo:ResearchGroup');
        foreach ($sections as $sid => $sinfo) {
            $secProjects = [];
            foreach ($this->childrenOf[$sid] ?? [] as $pid) {
                if (isset($projSet[$pid])) {
                    $secProjects[] = $pid;
                }
            }
            $pts = Aggregators::buildBeeswarm($sinfo['title'], $secProjects, $this->items, $this->childrenOf, $this->temporal);
            if ($pts) {
                $beeswarm = array_merge($beeswarm, $pts);
                foreach ($secProjects as $pid) {
                    $grouped[$pid] = true;
                }
            }
        }
        $leftover = [];
        foreach ($projectIds as $pid) {
            if (!isset($grouped[$pid])) {
                $leftover[] = $pid;
            }
        }
        if ($leftover) {
            $pts = Aggregators::buildBeeswarm('Other', $leftover, $this->items, $this->childrenOf, $this->temporal);
            if ($pts) {
                $beeswarm = array_merge($beeswarm, $pts);
            }
        }
        if ($beeswarm) {
            $extra['beeswarm'] = $beeswarm;
        }
        if ($bx = Aggregators::buildBoxplot($sections, $this->childrenOf)) {
            $extra['boxplot'] = $bx;
        }
        $allProjItems = [];
        foreach ($projectIds as $pid) {
            foreach ($this->childrenOf[$pid] ?? [] as $iid) {
                $allProjItems[$iid] = true;
            }
        }
        $allProjItems = array_keys($allProjItems);
        if ($tc = Aggregators::buildTimeChord($allProjItems, $this->links, $this->items, $this->itemYear)) {
            $extra['timeChord'] = $tc;
        }
        return $extra;
    }

    private function generateCollectionOverview(): void
    {
        $researchItems = array_keys($this->itemsWhere(fn ($info) => ($info['template_id'] ?? null) === self::TEMPLATE_RESEARCH_ITEMS));
        // "Items" in the Collection Overview regroups research items AND cluster
        // publications: the curated Publications item set (same corpus as the
        // Publications block — see publicationIds()) is folded into the same
        // charts, with each publication bucketed under a synthetic "Publication"
        // resource type that overrides its bibliographic type, so it shows as one
        // "Publication" category in the resource-type pie and the year×type
        // timeline. (A `fabio:` class filter is NOT used here: FaBiO classes are
        // also carried by research items and authority records, which would inflate
        // the "Publication" slice ~12× — see publicationIds().)
        $publications = $this->publicationIds();
        $podcasts = $this->podcastIds();
        $youtube = $this->youtubeIds();
        $this->log('=== Collection Overview (' . count($researchItems) . ' research items + ' . count($publications) . ' publications + ' . count($podcasts) . ' podcasts + ' . count($youtube) . ' YouTube videos) ===');
        if (!$researchItems && !$publications && !$podcasts && !$youtube) {
            return;
        }
        // Combined corpus, de-duplicated. Research items are template 10,
        // publications templates 11–20, podcasts template 21 and YouTube videos
        // template 22 (disjoint item sets), but flatten through array_flip to
        // guard against overlap anyway.
        $overviewItems = array_keys(array_flip(array_merge($researchItems, $publications, $podcasts, $youtube)));
        // Each publication / podcast / YouTube video is folded under one synthetic
        // resource type (overriding its own dcterms:type, if any) so it appears as a
        // single "Publication" / "Podcast" / "YouTube video" category in the
        // resource-type pie, the year×type timeline AND the type×language heatmap —
        // keeping the high-level overview readable. The fine-grained publication
        // types stay in the dedicated Publications block.
        $syntheticTypes = [];
        foreach ($publications as $pid) {
            $syntheticTypes[$pid] = self::SYNTHETIC_TYPE_PUBLICATION;
        }
        foreach ($podcasts as $pid) {
            $syntheticTypes[$pid] = self::SYNTHETIC_TYPE_PODCAST;
        }
        foreach ($youtube as $pid) {
            $syntheticTypes[$pid] = self::SYNTHETIC_TYPE_YOUTUBE;
        }

        $dashboard = Aggregators::aggregateItems($overviewItems, $this->items, $this->links, $this->itemYear, $this->geo, $syntheticTypes);
        if ($v = Aggregators::buildStackedTimeline($overviewItems, $this->links, $this->items, $this->itemYear, $syntheticTypes)) {
            $dashboard['stackedTimeline'] = $v;
        }
        if ($v = Aggregators::buildHeatmap($overviewItems, $this->links, $this->items, $syntheticTypes)) {
            $dashboard['heatmap'] = $v;
        }
        if ($v = Aggregators::buildRoles($overviewItems, $this->links, $this->items)) {
            $dashboard['roles'] = $v;
        }
        if ($v = Aggregators::buildSubjectTrends($overviewItems, $this->links, $this->items, $this->itemYear)) {
            $dashboard['subjectTrends'] = $v;
        }
        if ($v = Aggregators::buildLanguageTimeline($overviewItems, $this->links, $this->items, $this->itemYear)) {
            $dashboard['languageTimeline'] = $v;
        }
        if ($v = Aggregators::buildChord($overviewItems, $this->links, $this->items)) {
            $dashboard['chord'] = $v;
        }
        if ($v = Aggregators::buildSankey($overviewItems, $this->links, $this->items)) {
            $dashboard['sankey'] = $v;
        }
        if ($v = Aggregators::buildSunburst($overviewItems, $this->links, $this->items)) {
            $dashboard['sunburst'] = $v;
        }
        if ($v = Aggregators::buildGeoFlows($overviewItems, $this->links, $this->items, $this->geo)) {
            $dashboard['geoFlows'] = $v;
        }
        if ($v = Aggregators::buildChoropleth($overviewItems, $this->links, $this->countryIndex)) {
            $dashboard['choropleth'] = $v;
        }
        if ($v = Aggregators::buildTimeChord($overviewItems, $this->links, $this->items, $this->itemYear)) {
            $dashboard['timeChord'] = $v;
        }
        $sections = $this->itemsWhere(fn ($info) => ($info['class_term'] ?? '') === 'frapo:ResearchGroup');
        if ($v = Aggregators::buildBoxplot($sections, $this->childrenOf)) {
            $dashboard['boxplot'] = $v;
        }
        // Curated home-overview charts (amira homepage parity): projects per
        // research section, research items by section × funding university, and
        // the static cluster-partner geography. The full "Collection Dashboard"
        // (section) layout ignores these keys; the curated "Collection Overview"
        // layout renders them — see dashboard-layouts.js.
        if ($v = Aggregators::buildSectionsBar($sections, $this->childrenOf, $this->items)) {
            $dashboard['sectionsBar'] = $v;
        }
        // External partner collections are folded onto a partner-university column
        // (ILAM → Rhodes University, BayGlo → University of Bayreuth) under an
        // "External" row; their items sit outside the section→project hierarchy.
        $externalBuckets = [];
        foreach (self::EXTERNAL_COLLECTIONS as $setId => $route) {
            $externalBuckets[] = [
                'itemIds' => $this->itemSets[$setId] ?? [],
                'section' => $route['section'],
                'university' => $route['university'],
            ];
        }
        if ($v = Aggregators::buildSectionUniversity($sections, $this->childrenOf, $this->items, $this->links, $externalBuckets)) {
            $dashboard['sectionUniversity'] = $v;
        }
        if ($cp = Aggregators::clusterPartners($this->items, $this->links, $this->geo, self::CLUSTER_CATEGORY_AUTHORITIES)) {
            $dashboard['clusterPartners'] = $cp;
        }
        // amira-style summary stat cards. Country count comes from the choropleth
        // just built above (one entry per distinct country of origin).
        $countries = is_array($dashboard['choropleth'] ?? null) ? count($dashboard['choropleth']) : 0;
        $dashboard['stats'] = $this->buildOverviewStats(count($researchItems), $countries);
        $dashboard['resourceType'] = 'section';
        $this->save('collection-overview', $dashboard);
    }

    /**
     * Build the ordered summary stat cards for the Collection Overview, mirroring
     * the amira dashboard's overview cards. Each entry is
     * `{key, label, value[, subtitle]}`; the front-end (dashboard-stat-cards.js)
     * pairs the `key` with a lucide icon and renders the grid.
     *
     * Counts come from the per-entity index passes that already ran in run()
     * (projects / people / organisations / subjects&tags / languages / resource
     * types — each counting entities that have ≥1 linked item), so the cards
     * equal what a reader gets by browsing each category. The Publications card is
     * counted here from the fabio:-classed corpus. Cards with a zero count are
     * dropped to keep the grid tidy in non-amira installs.
     *
     * @return list<array{key:string,label:string,value:int,subtitle?:string}>
     */
    private function buildOverviewStats(int $researchItemCount, int $countries): array
    {
        // People, Organisations, Languages, Subjects & Tags, Resource Types,
        // Research projects and Publications are the sizes of their
        // authority item sets — the full curated count, not just entities linked
        // to a research item. Locations stays as the "present in the collection"
        // count gathered by its index pass.
        $setCount = fn (int $setId): int => count($this->itemSets[$setId] ?? []);

        // Assemble via the reusable component — it casts values, drops empty
        // cards (Research Items aside, always > 0) and clears null subtitles.
        return Aggregators::buildStatCards([
            ['key' => 'researchItems', 'label' => 'Research Items', 'value' => $researchItemCount],
            ['key' => 'projects', 'label' => 'Research projects', 'value' => $setCount(self::ITEM_SET_PROJECT)],
            ['key' => 'people', 'label' => 'People', 'value' => $setCount(self::ITEM_SET_PERSON)],
            ['key' => 'organisations', 'label' => 'Organisations', 'value' => $setCount(self::ITEM_SET_INSTITUTION)],
            ['key' => 'locations', 'label' => 'Locations', 'value' => $this->statCounts['locations'] ?? 0,
                'subtitle' => $countries > 0 ? ('in ' . $countries . ' ' . ($countries === 1 ? 'country' : 'countries')) : null],
            ['key' => 'languages', 'label' => 'Languages', 'value' => $setCount(self::ITEM_SET_LANGUAGE)],
            ['key' => 'subjectsTags', 'label' => 'Subjects & Tags', 'value' => $setCount(self::ITEM_SET_SUBJECT)],
            ['key' => 'resourceTypes', 'label' => 'Resource Types', 'value' => $setCount(self::ITEM_SET_RESOURCE_TYPE)],
            ['key' => 'publications', 'label' => 'Publications', 'value' => $setCount(self::ITEM_SET_PUBLICATIONS)],
            ['key' => 'podcasts', 'label' => 'Podcasts', 'value' => $setCount(self::ITEM_SET_PODCASTS)],
            ['key' => 'youtube', 'label' => 'YouTube videos', 'value' => $setCount(self::ITEM_SET_YOUTUBE)],
        ]);
    }

    private function generateCommunities(): void
    {
        $this->log('=== Discursive Communities ===');
        $lcshIds = [];
        foreach ($this->links as $sid => $slinks) {
            foreach ($slinks as [$term, $label, $vrid]) {
                if ($term === 'dcterms:type' && $vrid === self::OVERVIEW_LCSH) {
                    $lcshIds[] = $sid;
                    break;
                }
            }
        }
        $researchItems = array_keys($this->itemsWhere(fn ($info) => ($info['template_id'] ?? null) === self::TEMPLATE_RESEARCH_ITEMS));
        $communities = Aggregators::buildDiscursiveCommunities($researchItems, $this->links, $this->items, $lcshIds ?: null);
        if ($communities) {
            if (!is_dir($this->communitiesDir)) {
                mkdir($this->communitiesDir, 0775, true);
            }
            file_put_contents($this->communitiesDir . '/discursive.json', json_encode($communities, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
            $this->log('  ' . count($communities['nodes']) . ' subjects, ' . count($communities['communities']) . ' communities');
        }
    }

    /**
     * Global Entity Network: the collection-wide co-occurrence graph linking
     * people, organizations, locations, subjects and tags, rendered by the
     * MapLibre block (entity-graph.js). ForceAtlas2 positions are baked into the
     * payload here, so the client renders nodes + edges with no layout work.
     */
    private function generateEntityGraph(): void
    {
        $this->log('=== Entity Network ===');
        $lcshIds = [];
        foreach ($this->links as $sid => $slinks) {
            foreach ($slinks as [$term, $label, $vrid]) {
                if ($term === 'dcterms:type' && $vrid === self::OVERVIEW_LCSH) {
                    $lcshIds[] = $sid;
                    break;
                }
            }
        }
        $researchItems = array_keys($this->itemsWhere(fn ($info) => ($info['template_id'] ?? null) === self::TEMPLATE_RESEARCH_ITEMS));
        // Fold the curated Publications, Podcasts and YouTube item sets in too, so
        // their authors (bibo:authorList/editorList), subjects and places join the
        // network alongside the research items.
        $scanItems = array_values(array_unique(array_merge(
            $researchItems,
            $this->publicationIds(),
            $this->podcastIds(),
            $this->youtubeIds()
        )));
        // Strong core, uncapped: keep the "share >=2 items" edge rule but lift the
        // node cap from 1200 so the full connected core shows.
        $graph = Aggregators::buildEntityGraph($scanItems, $this->links, $this->items, $lcshIds, 2, 4000);
        if ($graph) {
            if (!is_dir($this->communitiesDir)) {
                mkdir($this->communitiesDir, 0775, true);
            }
            file_put_contents($this->communitiesDir . '/entity-graph.json', json_encode($graph, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
            $this->log('  ' . count($graph['nodes']) . ' entities, ' . count($graph['edges']) . ' links, ' . ($graph['meta']['communityCount'] ?? 0) . ' communities');
        }
    }

    /**
     * Collection-wide Network Explorer payload.
     *
     * The static /network page had four ECharts-based network views in addition
     * to the separate discursive-communities graph. This emits those four graphs
     * as one JSON file for the Network Explorer site-page block.
     */
    private function generateNetworkExplorer(): void
    {
        $researchItems = array_keys($this->itemsWhere(fn ($info) => ($info['template_id'] ?? null) === self::TEMPLATE_RESEARCH_ITEMS));
        $this->log('=== Network Explorer (' . count($researchItems) . ' research items) ===');
        if (!$researchItems) {
            return;
        }

        $payload = [
            'contributors' => Aggregators::buildGlobalContributorNetwork($researchItems, $this->items, $this->links),
            'collaboration' => Aggregators::buildPersonCollaborationNetwork($researchItems, $this->items, $this->links),
            'affiliations' => Aggregators::buildGlobalAffiliationNetwork($this->items, $this->links),
            'institutions' => Aggregators::buildGlobalInstitutionCollaborationNetwork($researchItems, $this->items, $this->links),
        ];
        $payload = array_filter($payload, static fn ($v) => $v !== null);
        if (!$payload) {
            $this->log('  no network explorer graphs had enough data');
            return;
        }

        $path = dirname($this->outputDir) . '/network-explorer.json';
        file_put_contents($path, json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        $this->fileCount++;

        $summary = [];
        foreach ($payload as $key => $graph) {
            $summary[] = $key . ': ' . count($graph['nodes'] ?? []) . ' nodes / ' . count($graph['links'] ?? []) . ' links';
        }
        $this->log('  network-explorer.json: ' . implode('; ', $summary));
    }

    /**
     * Spatial Exploration: the collection-wide place map for the cross-cutting
     * site-page block (asset/js/spatial-exploration.js). Bakes every geocoded,
     * item-referenced location as a bubble (sized by referencing-item count), the
     * countries they fall in (with bounds for zoom-to), per-type picker indexes,
     * and a compact entity→places adjacency so selecting a project / section /
     * person / organisation / subject filters the bubbles client-side with no extra
     * fetch. Entity ids are globally unique, so one flat entityPlaces map keyed by
     * id is unambiguous. Saved as spatial-exploration.json.
     */
    private function generateSpatialExploration(): void
    {
        $this->log('=== Spatial Exploration ===');
        $spatial = Aggregators::buildSpatialPlaces($this->geo, $this->reverseLinks, $this->countryIndex);
        if (!$spatial['locations']) {
            $this->log('  no geocoded, item-referenced locations — skipped');
            return;
        }

        // Person / organisation contributor-role terms, assembled exactly as in
        // generatePeople() / generateInstitutions() (the fixed credits plus every
        // marcrel:* role actually present in the data).
        $personTerms = ['dcterms:creator', 'dcterms:contributor', 'foaf:member', 'bibo:authorList', 'bibo:editorList'];
        $instTerms = ['frapo:isFundedBy', 'dcterms:provenance'];
        foreach ($this->reverseLinks as $rev) {
            foreach ($rev as $t => $_) {
                if (str_starts_with($t, 'marcrel:')) {
                    $personTerms[$t] = $t;
                    $instTerms[$t] = $t;
                }
            }
        }
        $personTerms = array_values(array_unique($personTerms));
        $instTerms = array_values(array_unique($instTerms));

        $entityPlaces = [];

        // Build a type's picker rows ([id, label, placeCount], densest first) and
        // populate $entityPlaces[id] = [[locId, origin, current], ...]. High-cardinality
        // types are capped to the top SPATIAL_PICKER_CAP by mapped-place count.
        $buildType = function (array $entities, bool $cap) use (&$entityPlaces): array {
            $rows = [];
            foreach ($entities as $eid => $info) {
                $places = Aggregators::placesForItems($info['itemIds'], $this->links, $this->geo);
                if (!$places) {
                    continue;
                }
                // Densest places (origin + current) first.
                uasort($places, static fn ($a, $b) => ($b[0] + $b[1]) <=> ($a[0] + $a[1]));
                $adj = [];
                foreach ($places as $locId => $rc) {
                    $adj[] = [(int) $locId, $rc[0], $rc[1]];
                }
                $rows[] = ['id' => (int) $eid, 'label' => $info['label'], 'adj' => $adj];
            }
            usort($rows, static fn ($a, $b) => count($b['adj']) <=> count($a['adj']));
            if ($cap && count($rows) > self::SPATIAL_PICKER_CAP) {
                $rows = array_slice($rows, 0, self::SPATIAL_PICKER_CAP);
            }
            $picker = [];
            foreach ($rows as $r) {
                $picker[] = [$r['id'], $r['label'], count($r['adj'])];
                $entityPlaces[$r['id']] = $r['adj'];
            }
            return $picker;
        };

        // Projects (uncapped — ~40): their member research items.
        $projects = [];
        foreach ($this->itemsWhere(fn ($i) => ($i['template_id'] ?? null) === self::TEMPLATE_PROJECTS) as $pid => $pinfo) {
            $projects[$pid] = ['label' => $pinfo['title'], 'itemIds' => $this->childrenOf[$pid] ?? []];
        }

        // Research sections (uncapped — ~6): items unioned over their child projects.
        $sections = [];
        foreach ($this->itemsWhere(fn ($i) => ($i['class_term'] ?? '') === 'frapo:ResearchGroup') as $sid => $sinfo) {
            $itemIds = [];
            foreach ($this->childrenOf[$sid] ?? [] as $pid) {
                foreach ($this->childrenOf[$pid] ?? [] as $iid) {
                    $itemIds[] = $iid;
                }
            }
            $sections[$sid] = ['label' => $sinfo['title'], 'itemIds' => $itemIds];
        }

        // People (capped): the items they are credited on.
        $people = [];
        foreach ($this->itemsWhere(fn ($i) => ($i['template_id'] ?? null) === self::TEMPLATE_PERSONS) as $pid => $pinfo) {
            $people[$pid] = ['label' => $pinfo['title'], 'itemIds' => Aggregators::findItemsLinkingTo($pid, $this->reverseLinks, $personTerms)];
        }

        // Organisations (capped): items funded by / held by / credited to them.
        $orgs = [];
        foreach ($this->itemsWhere(fn ($i) => ($i['class_term'] ?? '') === 'foaf:Organization') as $oid => $oinfo) {
            $orgs[$oid] = ['label' => $oinfo['title'], 'itemIds' => Aggregators::findItemsLinkingTo($oid, $this->reverseLinks, $instTerms)];
        }

        // Subjects (capped): the items they classify (dcterms:subject).
        $subjects = [];
        foreach ($this->itemsWhere(fn ($i) => ($i['template_id'] ?? null) === self::TEMPLATE_AUTHORITY) as $sid => $sinfo) {
            $subjects[$sid] = ['label' => $sinfo['title'], 'itemIds' => Aggregators::findItemsLinkingTo($sid, $this->reverseLinks, ['dcterms:subject'])];
        }

        $pickers = [
            'Project' => $buildType($projects, false),
            'Section' => $buildType($sections, false),
            'Person' => $buildType($people, true),
            'Organisation' => $buildType($orgs, true),
            'Subject' => $buildType($subjects, true),
        ];

        $payload = [
            'meta' => ['locations' => count($spatial['locations']), 'generatedAt' => date('Y-m-d')],
            'types' => ['Project', 'Section', 'Person', 'Organisation', 'Subject'],
            'locations' => $spatial['locations'],
            'countries' => $spatial['countries'],
            'pickers' => $pickers,
            // Force a JSON object even when empty (an empty PHP array encodes as []).
            'entityPlaces' => $entityPlaces ?: new \stdClass(),
        ];
        file_put_contents(
            $this->outputDir . '/spatial-exploration.json',
            json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
        );
        $this->fileCount++;
        $pickerSummary = [];
        foreach ($pickers as $type => $rows) {
            $pickerSummary[] = $type . '=' . count($rows);
        }
        $this->log('  ' . count($spatial['locations']) . ' locations, ' . count($spatial['countries'])
            . ' countries; pickers: ' . implode(', ', $pickerSummary));
    }

    /**
     * Item ids of the curated Publications item set (29918) — the cluster
     * bibliography landed by the ERef/EPub pipeline. This is the authoritative
     * ~250-item corpus: a `fabio:` resource-class filter is NOT equivalent, since
     * FaBiO classes are also carried by ordinary research items and authority
     * records, which would sweep thousands of non-publications into the set.
     */
    private function publicationIds(): array
    {
        return array_values($this->itemSets[self::ITEM_SET_PUBLICATIONS] ?? []);
    }

    /**
     * Item ids of the curated Podcasts item set (39095) — cluster podcast
     * episodes hand-catalogued in Omeka (template 21, fabio:AudioDocument). Folded
     * into the Collection Overview under the synthetic "Podcast" resource type.
     */
    private function podcastIds(): array
    {
        return array_values($this->itemSets[self::ITEM_SET_PODCASTS] ?? []);
    }

    /**
     * Item ids of the synced YouTube videos item set (39192) — the cluster's
     * YouTube channel, synced into Omeka by MongoDB2OmekaS (template 22,
     * bibo:AudioVisualDocument). Folded into the Collection Overview under the
     * synthetic "YouTube video" resource type.
     */
    private function youtubeIds(): array
    {
        return array_values($this->itemSets[self::ITEM_SET_YOUTUBE] ?? []);
    }

    /**
     * Publications overview — the curated Publications item set (29918) as one
     * corpus. Adds top venues/authors, the author/editor collaboration network
     * and keyword co-occurrence on top of the standard aggregation. Saved under
     * 'publications' and rendered by the Publications site-page block.
     */
    private function generatePublications(): void
    {
        $pubs = $this->publicationIds();
        $this->log('=== Publications (' . count($pubs) . ' items in set ' . self::ITEM_SET_PUBLICATIONS . ') ===');
        if (count($pubs) < 3) {
            return;
        }
        $dashboard = Aggregators::aggregateItems($pubs, $this->items, $this->links, $this->itemYear, $this->geo);
        if ($v = Aggregators::buildTopLiteral($pubs, $this->literals, 'dcterms:isPartOf')) {
            $dashboard['topVenues'] = $v;
        }
        if ($v = Aggregators::buildTopAuthors($pubs, $this->links, $this->literals, $this->items)) {
            $dashboard['topAuthors'] = $v;
        }
        if ($v = Aggregators::buildCoAuthorNetwork($pubs, $this->links, $this->literals, $this->items)) {
            $dashboard['coAuthorNetwork'] = $v;
        }
        if ($v = Aggregators::buildChord($pubs, $this->links, $this->items)) {
            $dashboard['chord'] = $v;
        }
        if ($v = Aggregators::buildStackedTimeline($pubs, $this->links, $this->items, $this->itemYear)) {
            $dashboard['stackedTimeline'] = $v;
        }
        if ($v = Aggregators::buildSubjectTrends($pubs, $this->links, $this->items, $this->itemYear)) {
            $dashboard['subjectTrends'] = $v;
        }

        // Summary stat cards: total publications, distinct publication types
        // (dcterms:type), languages, and the people credited as authors or editors
        // — distinct linked Person records across bibo:authorList + bibo:editorList.
        $peopleIds = [];
        foreach ($pubs as $iid) {
            foreach ($this->links[$iid] ?? [] as [$term, , $vrid]) {
                if ($term === 'bibo:authorList' || $term === 'bibo:editorList') {
                    $peopleIds[$vrid] = true;
                }
            }
        }
        $dashboard['stats'] = Aggregators::buildStatCards([
            ['key' => 'publications', 'label' => 'Publications', 'value' => count($pubs)],
            ['key' => 'types', 'label' => 'Types', 'value' => count($dashboard['types'] ?? [])],
            ['key' => 'languages', 'label' => 'Languages', 'value' => count($dashboard['languages'] ?? [])],
            ['key' => 'people', 'label' => 'Authors & Editors', 'value' => count($peopleIds)],
        ]);

        // Publications-specific chart wording, plus the Languages pie. The shared
        // registry renders Languages as a bar chart and titles charts for research
        // items; these per-dashboard overrides retitle them for the bibliography
        // and swap Languages to a pie. Read by renderDashboard() in dashboard.js.
        $dashboard['builders'] = ['languages' => 'buildPieChart'];
        $dashboard['labels'] = [
            'types' => 'Publication Types',
            'stackedTimeline' => 'Publications by Year and Type',
            'coAuthorNetwork' => 'Collaboration Network',
            'chord' => 'Keyword Co-occurrence',
            'subjects' => 'Keywords',
            'subjectTrends' => 'Keyword Trends over Time',
        ];
        $dashboard['descriptions'] = [
            'types' => 'Breakdown of publications by type (article, book, chapter, thesis, …).',
            'languages' => 'Languages the publications are written in.',
            'stackedTimeline' => 'Publications per year, broken down by type.',
            'topVenues' => 'Journals and book series in which these publications most often appear.',
            'topAuthors' => 'Authors credited on the most publications.',
            'coAuthorNetwork' => 'Authors and editors linked when they appear together on a publication. Edge colour marks the relationship: co-authorship, author–editor, or co-editorship.',
            'chord' => 'Keywords that frequently appear together across these publications.',
            'subjects' => 'Most frequent keywords assigned to these publications.',
            'subjectTrends' => 'How the most frequent keywords evolve over time.',
        ];

        $dashboard['resourceType'] = 'publications';
        $this->save('publications', $dashboard);
        $this->log('  publications dashboard written (' . count($pubs) . ' items)');
    }

    /**
     * YouTube dashboard — the cluster's YouTube channel (item set 39192, synced
     * by MongoDB2OmekaS), rendered by the dedicated YouTube site-page block.
     * Surfaces what the videos actually carry: a by-year upload timeline, the
     * language mix (and its drift over time), the playlists the channel is
     * organised into, and any credited speakers. Saved under 'youtube'
     * (resourceType 'youtube' → the youtube layout in dashboard-layouts.js).
     */
    private function generateYouTube(): void
    {
        $videos = $this->youtubeIds();
        $this->log('=== YouTube (' . count($videos) . ' videos in set ' . self::ITEM_SET_YOUTUBE . ') ===');
        if (count($videos) < 3) {
            return;
        }
        $dashboard = Aggregators::aggregateItems($videos, $this->items, $this->links, $this->itemYear, $this->geo);
        if ($v = $this->buildYoutubePlaylists($videos)) {
            $dashboard['playlists'] = $v;
        }
        if ($v = Aggregators::buildLanguageTimeline($videos, $this->links, $this->items, $this->itemYear)) {
            $dashboard['languageTimeline'] = $v;
        }

        // Summary stat cards: videos, playlists, languages, and the people
        // credited as speakers (marcrel:spk — manually curated, so often empty).
        $speakerIds = [];
        foreach ($videos as $iid) {
            foreach ($this->links[$iid] ?? [] as [$term, , $vrid]) {
                if ($term === 'marcrel:spk') {
                    $speakerIds[$vrid] = true;
                }
            }
        }
        $dashboard['stats'] = Aggregators::buildStatCards([
            ['key' => 'youtube', 'label' => 'Videos', 'value' => count($videos)],
            ['key' => 'playlists', 'label' => 'Playlists', 'value' => count($dashboard['playlists'] ?? [])],
            ['key' => 'languages', 'label' => 'Languages', 'value' => count($dashboard['languages'] ?? [])],
            ['key' => 'people', 'label' => 'Speakers', 'value' => count($speakerIds)],
        ]);

        // YouTube-specific chart wording. The shared registry titles charts for
        // research items; these retitle them for the channel. Read by
        // renderDashboard() in dashboard.js.
        $dashboard['labels'] = [
            'timeline' => 'Videos by Year',
            'contributors' => 'Speakers',
        ];
        $dashboard['descriptions'] = [
            'timeline' => 'Number of videos uploaded per year.',
            'languages' => 'Languages spoken across the channel\'s videos.',
            'languageTimeline' => 'How the language mix of the uploads shifts over time.',
            'contributors' => 'People credited as speakers in the videos.',
        ];

        $dashboard['resourceType'] = 'youtube';
        $this->save('youtube', $dashboard);
        $this->log('  youtube dashboard written (' . count($videos) . ' videos)');
    }

    /**
     * Top playlists by number of videos. Videos link to their playlist authority
     * items (item set 39193) via dcterms:isPartOf, so each playlist's video count
     * is the size of its childrenOf set restricted to the channel's videos.
     * Returns `[{name,value,itemId}]` sorted by count desc, then name.
     *
     * @return list<array{name:string,value:int,itemId:int}>
     */
    private function buildYoutubePlaylists(array $videoIds): array
    {
        $videoSet = array_flip($videoIds);
        $out = [];
        foreach ($this->itemSets[self::ITEM_SET_YOUTUBE_PLAYLISTS] ?? [] as $plId) {
            $title = $this->items[$plId]['title'] ?? '';
            if ($title === '') {
                continue;
            }
            $n = 0;
            foreach ($this->childrenOf[$plId] ?? [] as $childId) {
                if (isset($videoSet[$childId])) {
                    $n++;
                }
            }
            if ($n > 0) {
                $out[] = ['name' => $title, 'value' => $n, 'itemId' => (int) $plId];
            }
        }
        usort($out, static fn ($a, $b) => ($b['value'] <=> $a['value']) ?: strcmp((string) $a['name'], (string) $b['name']));
        return $out;
    }

    /**
     * "What's New" — recent additions in 3/6/12-month windows back from the most
     * recent creation date, with the most-active projects per window. Written to
     * whats-new.json and rendered by the What's New site-page block.
     */
    private function generateWhatsNew(): void
    {
        $this->log('=== What\'s New ===');
        $projects = $this->itemsWhere(fn ($info) => ($info['template_id'] ?? null) === self::TEMPLATE_PROJECTS);
        $projectChildren = [];
        foreach ($projects as $pid => $_) {
            $kids = $this->childrenOf[$pid] ?? [];
            if ($kids) {
                $projectChildren[$pid] = $kids;
            }
        }
        $whatsNew = Aggregators::buildWhatsNew($this->items, $projectChildren);
        if ($whatsNew) {
            file_put_contents($this->outputDir . '/whats-new.json', json_encode($whatsNew, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
            $this->log('  whats-new.json: reference ' . $whatsNew['reference'] . ', ' . count($whatsNew['windows']) . ' windows');
        }
    }

    /**
     * Photo Browsing galleries — one JSON per item set that has at least one
     * image-bearing public item. Sets with no images are skipped entirely
     * (nothing to render), so no empty galleries are written.
     *
     * Pure data only: item id, title, primary-media storage_id + extension,
     * year, raw date, and the origin place + coordinates resolved by following
     * the item's dcterms:spatial link to a Location item (a literal spatial
     * value yields a label but no coordinates — the same indirection the
     * knowledge-graph and item-location map already use). The block rebuilds the
     * file/item URLs from these ids in the view, so the JSON stays free of any
     * environment-specific absolute URLs.
     */
    private function generatePhotoGalleries(): void
    {
        $this->log('=== Photo Galleries ===');
        if (!is_dir($this->galleriesDir)) {
            mkdir($this->galleriesDir, 0775, true);
        }

        // Registry sets get extra per-photo fields: the identifier (so the
        // PhotoBrowse view can split a shared set into sub-collections) and, for
        // journal collections, the volume/issue/pages/creator the issue TOC
        // needs. Issue sets are NOT capped — every article must be present for a
        // complete table of contents.
        $issueSets = [];
        $prefixSets = [];
        foreach (Registry::all() as $rc) {
            if ($rc['grouping'] === 'issue') {
                $issueSets[$rc['itemSetId']] = true;
            }
            if ($rc['identifierPrefix'] !== null) {
                $prefixSets[$rc['itemSetId']] = true;
            }
        }

        $setCount = 0;
        foreach ($this->itemSets as $setId => $itemIds) {
            $isIssue = isset($issueSets[$setId]);
            $isPrefix = isset($prefixSets[$setId]);
            $cap = $isIssue ? PHP_INT_MAX : self::MAX_GALLERY_PHOTOS;
            $photos = [];
            $total = 0;
            foreach ($itemIds as $itemId) {
                $media = $this->primaryMedia[$itemId] ?? null;
                if ($media === null) {
                    continue; // not an image-bearing item
                }
                if (!($this->items[$itemId]['public'] ?? false)) {
                    continue; // never expose a non-public item in a gallery
                }
                $total++;
                if (count($photos) >= $cap) {
                    continue; // cap what we serialise, but keep counting the true total
                }

                // Origin place + coordinates: first linked dcterms:spatial → Location.
                $place = null;
                $lat = null;
                $lon = null;
                foreach ($this->links[$itemId] ?? [] as [$term, , $vrid]) {
                    if ($term === 'dcterms:spatial') {
                        $place = $this->items[$vrid]['title'] ?? null;
                        if (isset($this->geo[$vrid])) {
                            $lat = $this->geo[$vrid]['lat'];
                            $lon = $this->geo[$vrid]['lon'];
                        }
                        break; // first spatial wins (mirrors the block)
                    }
                }
                // No linked place → fall back to a literal dcterms:spatial label.
                if ($place === null && isset($this->literals[$itemId]['dcterms:spatial'][0])) {
                    $place = $this->literals[$itemId]['dcterms:spatial'][0];
                }

                $rec = [
                    'id'      => $itemId,
                    'title'   => $this->items[$itemId]['title'] ?? ('Item ' . $itemId),
                    'storage' => $media['storage'],
                    'ext'     => $media['ext'],
                    'year'    => isset($this->itemYear[$itemId]) ? (int) $this->itemYear[$itemId] : null,
                    'date'    => $this->itemDate[$itemId] ?? null,
                    'place'   => $place,
                    'lat'     => $lat,
                    'lon'     => $lon,
                ];
                if ($isPrefix) {
                    $rec['ident'] = $this->featuredLiterals[$itemId]['ident'] ?? '';
                }
                if ($isIssue) {
                    [$vol, $iss] = $this->parseVolIssue($this->featuredLiterals[$itemId]['doi'] ?? null);
                    $rec['volume']  = $vol;
                    $rec['issue']   = $iss;
                    $rec['pages']   = $this->parsePages($this->featuredLiterals[$itemId]['desc'] ?? null);
                    $rec['creator'] = $this->firstCreator($itemId);
                }
                $photos[] = $rec;
            }

            if (!$photos) {
                continue; // item set with no image-bearing public items — skip
            }

            file_put_contents(
                $this->galleriesDir . '/' . $setId . '.json',
                json_encode(['total' => $total, 'photos' => $photos],
                    JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
            );
            $this->fileCount++;
            $setCount++;
        }
        $this->log('  ' . $setCount . ' photo galleries written');
    }

    /**
     * Load dcterms:identifier / dcterms:description / bibo:doi for the items of
     * the featured-collections item sets only (Museu 6295, ILAM 27724, …). DOIs
     * are URI values, so COALESCE the literal value with the uri column. Item
     * ids are integers from the DB, so an intval-joined IN list is injection-safe
     * and avoids DBAL array-parameter version differences.
     */
    private function loadFeaturedLiterals(): void
    {
        $setIds = Registry::itemSetIds();
        $itemIds = [];
        foreach ($setIds as $sid) {
            foreach ($this->itemSets[$sid] ?? [] as $iid) {
                $itemIds[$iid] = true;
            }
        }
        if (!$itemIds) {
            return;
        }
        $idList = implode(',', array_map('intval', array_keys($itemIds)));
        $rows = $this->connection->executeQuery(
            "SELECT v.resource_id, CONCAT(vo.prefix, ':', p.local_name), COALESCE(NULLIF(v.value, ''), v.uri)"
            . ' FROM value v'
            . ' JOIN property p ON v.property_id = p.id'
            . ' JOIN vocabulary vo ON p.vocabulary_id = vo.id'
            . " WHERE v.resource_id IN ($idList)"
            . "   AND CONCAT(vo.prefix, ':', p.local_name) IN ('dcterms:identifier', 'dcterms:description', 'bibo:doi')"
            . "   AND COALESCE(NULLIF(v.value, ''), v.uri) IS NOT NULL"
        )->fetchAllNumeric();
        $key = ['dcterms:identifier' => 'ident', 'dcterms:description' => 'desc', 'bibo:doi' => 'doi'];
        foreach ($rows as $r) {
            $k = $key[(string) $r[1]] ?? null;
            if ($k === null) {
                continue;
            }
            $iid = (int) $r[0];
            // First value per key wins (mirrors how the view reads value(0)).
            if (!isset($this->featuredLiterals[$iid][$k])) {
                $this->featuredLiterals[$iid][$k] = (string) $r[2];
            }
        }
        $this->log('  featured literals: ' . count($this->featuredLiterals) . ' items');
    }

    /**
     * Per-collection counts + cover storage ids for the Featured Collections
     * landing grid, honouring each entry's sub-collection prefix and (for ILAM)
     * journal-issue grouping. Written to featured-collections/index.json and read
     * by the FeaturedCollections block (with a live API fallback when absent).
     */
    private function generateFeaturedCollections(): void
    {
        $this->log('=== Featured Collections ===');
        if (!is_dir($this->featuredDir)) {
            mkdir($this->featuredDir, 0775, true);
        }

        $index = [];
        foreach (Registry::all() as $entry) {
            $setId = $entry['itemSetId'];
            $prefix = $entry['identifierPrefix'];
            $producerId = $entry['producerId'];
            $isIssue = $entry['grouping'] === 'issue';
            $itemCount = 0;
            $photoItems = 0;
            $covers = [];
            $issues = [];
            foreach ($this->itemSets[$setId] ?? [] as $itemId) {
                if (!($this->items[$itemId]['public'] ?? false)) {
                    continue;
                }
                if ($prefix !== null
                    && !str_starts_with((string) ($this->featuredLiterals[$itemId]['ident'] ?? ''), $prefix)
                ) {
                    continue;
                }
                // Producer subset (DECCA / Jambo): keep only items crediting this
                // org via marcrel:prn (Production company).
                if ($producerId !== null && !$this->itemHasProducer($itemId, $producerId)) {
                    continue;
                }
                $itemCount++;
                if ($isIssue) {
                    [$vol, $iss] = $this->parseVolIssue($this->featuredLiterals[$itemId]['doi'] ?? null);
                    if ($vol !== null && $iss !== null) {
                        $issues[$vol . '.' . $iss] = true;
                    }
                }
                $media = $this->primaryMedia[$itemId] ?? null;
                if ($media !== null) {
                    $photoItems++;
                    if (count($covers) < 4) {
                        $covers[] = $media['storage'];
                    }
                }
            }
            $index[$entry['slug']] = [
                'itemCount'  => $itemCount,
                // Producer subsets are image-less audio: report no photo count so
                // the card footer reads "N items", not "0 photos · N items".
                'photoCount' => $isIssue ? count($issues) : ($producerId !== null ? null : $photoItems),
                'covers'     => $covers,
            ];
        }

        file_put_contents(
            $this->featuredDir . '/index.json',
            json_encode($index, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
        );
        $this->fileCount++;
        $this->log('  ' . count($index) . ' featured collections indexed');
    }

    /** Volume + issue from a DOI like ".../amj.v11i4.123"; [null,null] if none. */
    private function parseVolIssue(?string $doi): array
    {
        if ($doi !== null && preg_match('/v(\d+)i(\d+)/i', $doi, $m)) {
            return [(int) $m[1], (int) $m[2]];
        }
        return [null, null];
    }

    /** Page range from a "pages: 95-118" note; null if none. */
    private function parsePages(?string $text): ?string
    {
        if ($text !== null
            && preg_match('/pages?\s*[:\-]?\s*([0-9ivxlcdm]+(?:\s*[\x{2013}\-]\s*[0-9ivxlcdm]+)?)/iu', $text, $m)
        ) {
            return preg_replace('/\s+/', '', $m[1]);
        }
        return null;
    }

    /** Whether an item credits the given Organisation as its producer (marcrel:prn). */
    private function itemHasProducer(int $itemId, int $producerId): bool
    {
        foreach ($this->links[$itemId] ?? [] as [$term, , $vrid]) {
            if ($term === 'marcrel:prn' && $vrid === $producerId) {
                return true;
            }
        }
        return false;
    }

    /** First contributor's display name (creator → author → contributor). */
    private function firstCreator(int $itemId): ?string
    {
        foreach ($this->links[$itemId] ?? [] as [$term, , $vrid]) {
            if (in_array($term, ['marcrel:aut', 'dcterms:creator', 'dcterms:contributor'], true)) {
                $name = $this->items[$vrid]['title'] ?? null;
                if ($name !== null && $name !== '') {
                    return $name;
                }
            }
        }
        return null;
    }

    private function generateKnowledgeGraphs(): void
    {
        $this->log('=== Knowledge Graphs ===');
        if (!is_dir($this->knowledgeGraphsDir)) {
            mkdir($this->knowledgeGraphsDir, 0775, true);
        }
        [$idf, $freqPct] = KnowledgeGraphs::computeResourceStats($this->links, count($this->items));
        $reverse = KnowledgeGraphs::buildShareableReverse($this->reverseLinks);
        $this->log('  ' . count($idf) . ' resources scored');

        $generated = 0;
        $skipped = 0;
        $mapCount = 0;
        foreach ($this->items as $iid => $info) {
            $graph = KnowledgeGraphs::buildGraph((int) $iid, $this->items, $this->links, $this->reverseLinks, $reverse, $idf, $freqPct);
            if ($graph === null) {
                $skipped++;
                continue;
            }
            $itemMap = KnowledgeGraphs::buildItemMap((int) $iid, $this->links, $this->geo);
            if ($itemMap !== null) {
                $graph['itemMap'] = $itemMap;
                $mapCount++;
            }
            file_put_contents($this->knowledgeGraphsDir . '/' . $iid . '.json', json_encode($graph, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
            $generated++;
            if ($generated % 500 === 0) {
                $this->log('  ' . $generated . ' graphs…');
            }
        }
        $this->fileCount += $generated;
        $this->log('  ' . $generated . ' graphs (' . $mapCount . ' with location maps), ' . $skipped . ' skipped');
    }

    /** @return array<int,array> id => info, preserving insertion order */
    private function itemsWhere(callable $pred): array
    {
        $out = [];
        foreach ($this->items as $id => $info) {
            if ($pred($info)) {
                $out[$id] = $info;
            }
        }
        return $out;
    }
}
