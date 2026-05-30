<?php
declare(strict_types=1);

namespace ResourceVisualizations\Precompute;

use Doctrine\DBAL\Connection;

/**
 * Orchestrates the dashboard precompute — a PHP port of generators.py,
 * overviews.py and precompute-dashboards.py main(). Calls the pure
 * {@see Aggregators} (unit-tested) and writes the JSON artefacts Omeka serves.
 *
 * Run from the admin "Regenerate" Job (reusing Omeka's DBAL connection) so the
 * module is self-contained — no Python, no separate MySQL credentials.
 */
final class Runner
{
    // Resource template IDs (from config.py).
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

    private array $items = [];
    private array $links = [];
    private array $reverseLinks = [];
    private array $childrenOf = [];
    private array $itemYear = [];
    private array $temporal = [];
    private array $geo = [];
    private array $itemSets = [];
    private array $templateLabels = [];
    private array $literals = [];
    private array $countryIndex = [];

    private int $fileCount = 0;

    /** @var callable|null A log sink: fn(string $message): void */
    private $logFn;

    public function __construct(
        private readonly Connection $connection,
        private readonly string $outputDir,
        private readonly string $communitiesDir,
        private readonly string $countriesGeojson,
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
        $this->temporal = $data['temporal'];
        $this->geo = $data['geo'];
        $this->itemSets = $data['itemSets'];
        $this->templateLabels = $data['templateLabels'];
        $this->literals = $data['literals'];

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
        $this->generateByItemSet(self::ITEM_SET_LANGUAGE, 'dcterms:language', 'Languages', 'authority', ['languages']);
        $this->generateByItemSet(self::ITEM_SET_GENRE, 'dcterms:format', 'Genres', 'genre', []);
        $this->generateCategoryOverviews();
        $this->generateCollectionOverview();
        $this->generateCommunities();
        $this->generatePublications();

        $this->log('Done. ' . $this->fileCount . ' files written to ' . $this->outputDir);
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
            if ($radar = Aggregators::buildRadar($radarProfiles[$pid] ?? null, $radarMax)) {
                $dashboard['radar'] = $radar;
            }
            $dashboard['resourceType'] = self::TEMPLATE_RESOURCE_TYPE[$this->items[$pid]['template_id']] ?? 'project';
            $this->save($pid, $dashboard);
        }

        usort($projectIndex, static fn ($a, $b) => strcmp((string) $a['name'], (string) $b['name']));
        file_put_contents($this->outputDir . '/projects-index.json', json_encode($projectIndex, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
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

        foreach ($people as $pid => $pinfo) {
            $itemIds = Aggregators::findItemsLinkingTo($pid, $this->reverseLinks, $personTerms);
            if (!$itemIds) {
                continue;
            }
            $dashboard = Aggregators::aggregateItems($itemIds, $this->items, $this->links, $this->itemYear, $this->geo);
            if ($v = Aggregators::buildTemplates($itemIds, $this->items, $this->templateLabels)) {
                $dashboard['templates'] = $v;
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

        foreach ($institutions as $iid => $iinfo) {
            $itemIds = Aggregators::findItemsLinkingTo($iid, $this->reverseLinks, $instTerms);
            if (!$itemIds) {
                continue;
            }
            $dashboard = Aggregators::aggregateItems($itemIds, $this->items, $this->links, $this->itemYear, $this->geo);
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
    }

    private function generateLocations(): void
    {
        $locs = $this->itemsWhere(fn ($info) => ($info['template_id'] ?? null) === self::TEMPLATE_LOCATION);
        $this->log('=== Locations (' . count($locs) . ') ===');
        foreach ($locs as $lid => $linfo) {
            $itemIds = Aggregators::findItemsLinkingTo($lid, $this->reverseLinks, ['dcterms:spatial', 'dcterms:provenance']);
            if (!$itemIds) {
                continue;
            }
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
    }

    private function generateSubjects(): void
    {
        $subjects = $this->itemsWhere(fn ($info) => ($info['template_id'] ?? null) === self::TEMPLATE_AUTHORITY);
        $this->log('=== Subjects/Authority (' . count($subjects) . ') ===');
        foreach ($subjects as $sid => $sinfo) {
            $itemIds = Aggregators::findItemsLinkingTo($sid, $this->reverseLinks, ['dcterms:subject']);
            if (!$itemIds) {
                continue;
            }
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
    }

    private function generateByItemSet(int $setId, string $term, string $label, string $resourceType, array $excludeKeys): void
    {
        $setItems = $this->itemSets[$setId] ?? [];
        $this->log('=== ' . $label . ' (item set ' . $setId . ', ' . count($setItems) . ') ===');
        foreach ($setItems as $eid) {
            $itemIds = Aggregators::findItemsLinkingTo($eid, $this->reverseLinks, [$term]);
            if (!$itemIds) {
                continue;
            }
            $dashboard = Aggregators::aggregateItems($itemIds, $this->items, $this->links, $this->itemYear, $this->geo);
            foreach ($excludeKeys as $k) {
                unset($dashboard[$k]);
            }
            $dashboard['resourceType'] = $resourceType;
            $this->save($eid, $dashboard);
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Category overviews (mirrors overviews.py)                          */
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
        return $extra;
    }

    private function generateCollectionOverview(): void
    {
        $researchItems = array_keys($this->itemsWhere(fn ($info) => ($info['template_id'] ?? null) === self::TEMPLATE_RESEARCH_ITEMS));
        $this->log('=== Collection Overview (' . count($researchItems) . ' research items) ===');
        if (!$researchItems) {
            return;
        }
        $dashboard = Aggregators::aggregateItems($researchItems, $this->items, $this->links, $this->itemYear, $this->geo);
        if ($v = Aggregators::buildStackedTimeline($researchItems, $this->links, $this->items, $this->itemYear)) {
            $dashboard['stackedTimeline'] = $v;
        }
        if ($v = Aggregators::buildHeatmap($researchItems, $this->links, $this->items)) {
            $dashboard['heatmap'] = $v;
        }
        if ($v = Aggregators::buildRoles($researchItems, $this->links, $this->items)) {
            $dashboard['roles'] = $v;
        }
        if ($v = Aggregators::buildSubjectTrends($researchItems, $this->links, $this->items, $this->itemYear)) {
            $dashboard['subjectTrends'] = $v;
        }
        if ($v = Aggregators::buildLanguageTimeline($researchItems, $this->links, $this->items, $this->itemYear)) {
            $dashboard['languageTimeline'] = $v;
        }
        if ($v = Aggregators::buildChord($researchItems, $this->links, $this->items)) {
            $dashboard['chord'] = $v;
        }
        if ($v = Aggregators::buildSankey($researchItems, $this->links, $this->items)) {
            $dashboard['sankey'] = $v;
        }
        if ($v = Aggregators::buildSunburst($researchItems, $this->links, $this->items)) {
            $dashboard['sunburst'] = $v;
        }
        if ($v = Aggregators::buildGeoFlows($researchItems, $this->links, $this->items, $this->geo)) {
            $dashboard['geoFlows'] = $v;
        }
        if ($v = Aggregators::buildChoropleth($researchItems, $this->links, $this->countryIndex)) {
            $dashboard['choropleth'] = $v;
        }
        $dashboard['resourceType'] = 'section';
        $this->save('collection-overview', $dashboard);
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
     * Publications overview — every bibliographic (fabio:) item as one corpus.
     * Adds the by-template breakdown, top venues/authors, co-author network and
     * keyword co-occurrence on top of the standard aggregation. Saved under
     * 'publications' and rendered by the Publications site-page block.
     */
    private function generatePublications(): void
    {
        $pubs = array_keys($this->itemsWhere(static fn ($info) => str_starts_with($info['class_term'] ?? '', 'fabio:')));
        $this->log('=== Publications (' . count($pubs) . ' fabio: items) ===');
        if (count($pubs) < 3) {
            return;
        }
        $dashboard = Aggregators::aggregateItems($pubs, $this->items, $this->links, $this->itemYear, $this->geo);
        if ($v = Aggregators::buildTemplates($pubs, $this->items, $this->templateLabels)) {
            $dashboard['templates'] = $v;
        }
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
        $dashboard['resourceType'] = 'publications';
        $this->save('publications', $dashboard);
        $this->log('  publications dashboard written (' . count($pubs) . ' items)');
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
