<?php
declare(strict_types=1);

/**
 * Dependency-free regression test for the PHP precompute aggregators
 * (src/Precompute/Aggregators.php).
 *
 * No PHPUnit/Composer needed — run it in a throwaway PHP container from the
 * module root:
 *
 *   docker run --rm -v "$PWD:/m" php:8.4-cli php /m/tests/AggregatorsTest.php
 *
 * Covers: aggregateItems, buildRoles / buildRolesFor (person-scoped), the
 * choropleth point-in-polygon against the real GeoJSON, the radar profile, and
 * the Louvain community split.
 */

require dirname(__DIR__) . '/src/Precompute/Aggregators.php';
require dirname(__DIR__) . '/src/Precompute/KnowledgeGraphs.php';

use ResourceVisualizations\Precompute\Aggregators as A;
use ResourceVisualizations\Precompute\KnowledgeGraphs as KG;

$failures = 0;
function check(bool $cond, string $msg): void
{
    global $failures;
    if ($cond) {
        echo "ok: $msg\n";
    } else {
        $failures++;
        fwrite(STDERR, "FAIL: $msg\n");
    }
}

// --- aggregateItems ---
$items = [
    10 => ['title' => 'Book', 'template_id' => null],
    11 => ['title' => 'English', 'template_id' => null],
    12 => ['title' => 'Islam', 'template_id' => null],
    13 => ['title' => 'Jane', 'template_id' => 4],
];
$links = [
    1 => [['dcterms:type', 'Type', 10], ['dcterms:language', 'Lang', 11], ['dcterms:subject', 'Subj', 12], ['marcrel:aut', 'Author', 13]],
    2 => [['dcterms:type', 'Type', 10], ['dcterms:subject', 'Subj', 12]],
];
$agg = A::aggregateItems([1, 2], $items, $links, [1 => '2018', 2 => '2020'], []);
check($agg['totalItems'] === 2, 'aggregateItems totalItems=2');
check($agg['types'][0] === ['name' => 'Book', 'value' => 2, 'itemId' => 10], 'types Book=2');
check($agg['subjects'][0]['name'] === 'Islam' && $agg['subjects'][0]['value'] === 2, 'subjects Islam=2');
check($agg['timeline'] == ['2018' => 1, '2020' => 1], 'timeline by year');

// --- aggregateItems folds a synthetic resource type (publications) into the pie ---
$synItems = [10 => ['title' => 'Book'], 30 => ['title' => 'English']];
$synLinks = [
    1 => [['dcterms:type', 'T', 10]],     // research item: real type Book
    2 => [['dcterms:language', 'L', 30]],  // publication: no dcterms:type of its own
];
$synAgg = A::aggregateItems([1, 2], $synItems, $synLinks, [], [], [2 => 'Publication']);
$synByName = [];
foreach ($synAgg['types'] as $t) { $synByName[$t['name']] = $t; }
check(($synByName['Book']['value'] ?? 0) === 1, 'aggregateItems keeps real linked type Book=1');
check(($synByName['Publication']['value'] ?? 0) === 1, 'aggregateItems counts synthetic Publication=1');
check(!isset($synByName['Publication']['itemId']), 'synthetic type carries no itemId (not click-through)');

// A synthetic type REPLACES the item's own dcterms:type (no double count): a
// publication that carries a real type still shows only as one "Publication" slice.
$ovItems = [10 => ['title' => 'Book'], 40 => ['title' => 'Article']];
$ovLinks = [
    1 => [['dcterms:type', 'T', 10]],   // research item -> Book
    2 => [['dcterms:type', 'T', 40]],   // publication with a real type Article, overridden
];
$ovAgg = A::aggregateItems([1, 2], $ovItems, $ovLinks, [], [], [2 => 'Publication']);
$ovByName = [];
foreach ($ovAgg['types'] as $t) { $ovByName[$t['name']] = $t['value']; }
check(($ovByName['Publication'] ?? 0) === 1, 'aggregateItems: synthetic type replaces real type (Publication=1)');
check(!isset($ovByName['Article']), 'aggregateItems: real type suppressed when synthetic present (no Article)');
check(($ovByName['Book'] ?? 0) === 1, 'aggregateItems: non-synthetic item keeps its real type (Book=1)');

// --- buildHeatmap drops a resource type that never co-occurs with a language ---
$hmItems = [10 => ['title' => 'Book'], 11 => ['title' => 'English'], 14 => ['title' => 'Map']];
$hmLinks = [
    1 => [['dcterms:type', 'T', 10], ['dcterms:language', 'L', 11]], // Book × English
    2 => [['dcterms:type', 'T', 14]],                                // Map: no language
];
$hm = A::buildHeatmap([1, 2], $hmLinks, $hmItems);
check($hm['rows'] === ['Book'], 'buildHeatmap drops a type with no language (Map excluded)');
check($hm['cols'] === ['English'], 'buildHeatmap keeps only languages paired with a type');
check($hm['values'] === [[0, 0, 1]], 'buildHeatmap Book × English = 1');

// --- buildStackedTimeline: publications stack under their synthetic type, else "(no type)" ---
$stItems = [10 => ['title' => 'Book']];
$stLinks = [
    1 => [['dcterms:type', 'T', 10]], // 2018, Book
    2 => [],                          // 2018, no type, marked publication
    3 => [],                          // 2019, no type, no synthetic -> "(no type)"
];
$st = A::buildStackedTimeline([1, 2, 3], $stLinks, $stItems, [1 => '2018', 2 => '2018', 3 => '2019'], [2 => 'Publication']);
// Years come back as ints (PHP coerces the numeric-string year keys of $yearType).
check($st['years'] === [2018, 2019], 'buildStackedTimeline years sorted');
$stSeries = [];
foreach ($st['series'] as $s) { $stSeries[$s['name']] = $s['data']; }
check(($stSeries['Book'] ?? null) === [1, 0], 'buildStackedTimeline keeps real linked types');
check(($stSeries['Publication'] ?? null) === [1, 0], 'buildStackedTimeline stacks a publication under "Publication"');
check(($stSeries['(no type)'] ?? null) === [0, 1], 'buildStackedTimeline still falls back to "(no type)" without a synthetic label');

// buildStackedTimeline: a synthetic type overrides the item's own dcterms:type
$stOvLinks = [
    1 => [['dcterms:type', 'T', 10]],   // Book (research item)
    2 => [['dcterms:type', 'T', 40]],   // Article, but synthetic "Publication" overrides
];
$stOvItems = [10 => ['title' => 'Book'], 40 => ['title' => 'Article']];
$stOv = A::buildStackedTimeline([1, 2], $stOvLinks, $stOvItems, [1 => '2020', 2 => '2020'], [2 => 'Publication']);
$stOvSeries = [];
foreach ($stOv['series'] as $s) { $stOvSeries[$s['name']] = array_sum($s['data']); }
check(($stOvSeries['Publication'] ?? 0) === 1, 'buildStackedTimeline: synthetic overrides real type (Publication=1)');
check(!isset($stOvSeries['Article']), 'buildStackedTimeline: real type suppressed under synthetic (no Article series)');
check(($stOvSeries['Book'] ?? 0) === 1, 'buildStackedTimeline: research item keeps real type (Book=1)');

// --- person-scoped roles ---
$rlinks = [
    1 => [['marcrel:aut', 'Author', 100], ['marcrel:aut', 'Author', 200]],
    2 => [['marcrel:pht', 'Photographer', 100]],
];
check(A::buildRolesFor(100, [1, 2], $rlinks) === [['name' => 'Author', 'value' => 1], ['name' => 'Photographer', 'value' => 1]], 'buildRolesFor scopes to entity 100');
$allMap = [];
foreach (A::buildRoles([1, 2], $rlinks, []) as $r) { $allMap[$r['name']] = $r['value']; }
check(($allMap['Author'] ?? 0) === 2, 'buildRoles counts all contributors (Author=2)');

// --- choropleth point-in-polygon against the real GeoJSON ---
$features = A::loadCountryFeatures(dirname(__DIR__) . '/asset/data/geo/countries.geojson');
check(count($features) === 177, 'loaded 177 country features');
$geo = [
    500 => ['name' => 'Paris', 'lat' => 48.85, 'lon' => 2.35, 'itemId' => 500],
    501 => ['name' => 'Lagos', 'lat' => 6.45, 'lon' => 3.39, 'itemId' => 501],
    502 => ['name' => 'Ouaga', 'lat' => 12.37, 'lon' => -1.53, 'itemId' => 502],
];
$idx = A::buildCountryIndex($geo, $features);
check(($idx[500] ?? '') === 'France', 'Paris -> France');
check(($idx[501] ?? '') === 'Nigeria', 'Lagos -> Nigeria');
check(str_contains($idx[502] ?? '', 'Burkina'), 'Ouaga -> Burkina Faso');
$chl = A::buildChoropleth([1, 2, 3], [1 => [['dcterms:spatial', 'O', 500]], 2 => [['dcterms:spatial', 'O', 500]], 3 => [['dcterms:spatial', 'O', 501]]], $idx);
check($chl === [['country' => 'France', 'count' => 2], ['country' => 'Nigeria', 'count' => 1]], 'buildChoropleth counts by country');

// --- radar ---
$pA = A::profileFromItems([1, 2], [
    1 => [['dcterms:language', 'L', 10], ['dcterms:subject', 'S', 20], ['dcterms:type', 'T', 30], ['marcrel:aut', 'A', 40]],
    2 => [['dcterms:language', 'L', 11], ['dcterms:subject', 'S', 20]],
], [1 => '2010', 2 => '2018']);
check($pA === ['items' => 2, 'languages' => 2, 'subjects' => 1, 'contributors' => 1, 'types' => 1, 'span' => 8], 'profileFromItems');
$radar = A::buildRadar($pA, A::profileMaxima([$pA, ['items' => 1, 'languages' => 1, 'subjects' => 1, 'contributors' => 1, 'types' => 1, 'span' => 0]]));
check(count($radar['indicator']) === 6 && $radar['series'][0]['value'] === [2, 2, 1, 1, 1, 8], 'buildRadar values');

// --- discursive communities (Louvain 2-cluster) ---
$citems = [];
for ($i = 1; $i <= 6; $i++) { $citems[$i] = ['title' => "Subject $i"]; }
$clinks = [];
$iid = 100;
$add = function (array $subs) use (&$clinks, &$iid) {
    $clinks[$iid++] = array_map(fn ($s) => ['dcterms:subject', 'Subject', $s], $subs);
};
for ($k = 0; $k < 5; $k++) { $add([1, 2, 3]); }
for ($k = 0; $k < 5; $k++) { $add([4, 5, 6]); }
for ($k = 0; $k < 2; $k++) { $add([3, 4]); }
$comm = A::buildDiscursiveCommunities(array_keys($clinks), $clinks, $citems, null, 2);
check($comm !== null && count($comm['nodes']) === 6, 'communities: 6 nodes');
check(count($comm['communities']) === 2, 'communities: 2 clusters');
$byName = [];
foreach ($comm['nodes'] as $nd) { $byName[$nd['name']] = $nd['community']; }
$c123 = [$byName['Subject 1'], $byName['Subject 2'], $byName['Subject 3']];
$c456 = [$byName['Subject 4'], $byName['Subject 5'], $byName['Subject 6']];
check(count(array_unique($c123)) === 1 && count(array_unique($c456)) === 1 && $c123[0] !== $c456[0], 'communities: {1,2,3} vs {4,5,6} split');

// --- buildTemplates (resource-template breakdown) ---
$tplItems = [
    1 => ['title' => 'A', 'template_id' => 10],
    2 => ['title' => 'B', 'template_id' => 10],
    3 => ['title' => 'C', 'template_id' => 11],
];
$tplLabels = [10 => 'Research Items', 11 => 'Article'];
check(A::buildTemplates([1, 2, 3], $tplItems, $tplLabels) === [['name' => 'Research Items', 'value' => 2], ['name' => 'Article', 'value' => 1]], 'buildTemplates groups by template label');
check(A::buildTemplates([1, 2], $tplItems, $tplLabels) === null, 'buildTemplates null when single template (monotone)');

// --- buildTopLiteral (venues) ---
$pubLits = [
    1 => ['dcterms:isPartOf' => ['Antipode']],
    2 => ['dcterms:isPartOf' => ['Antipode']],
    3 => ['dcterms:isPartOf' => ['Society']],
];
check(A::buildTopLiteral([1, 2, 3], $pubLits, 'dcterms:isPartOf') === [['name' => 'Antipode', 'value' => 2], ['name' => 'Society', 'value' => 1]], 'buildTopLiteral counts venue literals');
check(A::buildTopLiteral([1, 2, 3], $pubLits, 'dcterms:publisher') === null, 'buildTopLiteral null when term absent');

// --- buildTopAuthors (literal + matched person union) ---
$authItems = [100 => ['title' => 'Daley, Patricia', 'template_id' => 4]];
$authLinks = [
    1 => [['bibo:authorList', 'Author', 100]],
    2 => [['bibo:authorList', 'Author', 100]],
];
$authLits = [
    1 => ['bibo:authorList' => ['Kimari, Wangui']],
    2 => ['bibo:authorList' => ['Kimari, Wangui']],
];
check(A::buildTopAuthors([1, 2], $authLinks, $authLits, $authItems) === [
    ['name' => 'Daley, Patricia', 'value' => 2, 'matched' => true, 'itemId' => 100],
    ['name' => 'Kimari, Wangui', 'value' => 2, 'matched' => false],
], 'buildTopAuthors unions matched persons + literal names');

// --- buildCoAuthorNetwork (2-cluster split, literal authors unmatched) ---
$coLits = [];
$pid = 200;
for ($k = 0; $k < 5; $k++) { $coLits[$pid++] = ['bibo:authorList' => ['A', 'B', 'C']]; }
for ($k = 0; $k < 5; $k++) { $coLits[$pid++] = ['bibo:authorList' => ['D', 'E', 'F']]; }
for ($k = 0; $k < 2; $k++) { $coLits[$pid++] = ['bibo:authorList' => ['C', 'D']]; }
$coNet = A::buildCoAuthorNetwork(array_keys($coLits), [], $coLits, []);
check($coNet !== null && count($coNet['nodes']) === 6, 'coAuthorNetwork: 6 author nodes');
check($coNet !== null && count($coNet['communities']) === 2, 'coAuthorNetwork: 2 communities split');
$coAllUnmatched = true;
foreach (($coNet['nodes'] ?? []) as $nd) { if (!empty($nd['matched'])) { $coAllUnmatched = false; } }
check($coAllUnmatched, 'coAuthorNetwork: literal authors are unmatched');

// --- buildCoAuthorNetwork (matched person carries itemId) ---
$mLinks = [
    300 => [['bibo:authorList', 'Author', 100]],
    301 => [['bibo:authorList', 'Author', 100]],
    302 => [['bibo:authorList', 'Author', 100]],
];
$mLits = [
    300 => ['bibo:authorList' => ['X', 'Y']],
    301 => ['bibo:authorList' => ['X', 'Y']],
    302 => ['bibo:authorList' => ['X', 'Y']],
];
$mItems = [100 => ['title' => 'Linked Person', 'template_id' => 4]];
$mNet = A::buildCoAuthorNetwork([300, 301, 302], $mLinks, $mLits, $mItems);
$lp = null;
foreach (($mNet['nodes'] ?? []) as $nd) { if ($nd['name'] === 'Linked Person') { $lp = $nd; } }
check($lp !== null && $lp['matched'] === true && ($lp['itemId'] ?? null) === 100, 'coAuthorNetwork: linked author marked matched with itemId');

// --- buildCoAuthorNetwork distinguishes author / editor relationships ---
$relLits = [];
for ($k = 0; $k < 3; $k++) { $relLits[400 + $k] = ['bibo:authorList' => ['A', 'B']]; }              // A–B co-authorship
for ($k = 0; $k < 3; $k++) { $relLits[410 + $k] = ['bibo:editorList' => ['C', 'D']]; }              // C–D co-editorship
for ($k = 0; $k < 3; $k++) { $relLits[420 + $k] = ['bibo:authorList' => ['A'], 'bibo:editorList' => ['C']]; } // A–C author–editor
$relLits[430] = ['bibo:authorList' => ['C', 'D']];  // C & D also co-author once → role 'both'; C–D still dominant co-editorship (3 vs 1)
$relNet = A::buildCoAuthorNetwork(array_keys($relLits), [], $relLits, []);
$relOf = [];
foreach (($relNet['links'] ?? []) as $l) { $p = [$l['source'], $l['target']]; sort($p); $relOf[implode('-', $p)] = $l['relation']; }
check(($relOf['A-B'] ?? null) === 'coauthor', 'coAuthorNetwork: A–B edge is co-authorship');
check(($relOf['C-D'] ?? null) === 'coeditor', 'coAuthorNetwork: C–D edge is co-editorship (dominant)');
check(($relOf['A-C'] ?? null) === 'mixed', 'coAuthorNetwork: A–C edge is author–editor');
$roleOf = [];
foreach (($relNet['nodes'] ?? []) as $nd) { $roleOf[$nd['name']] = $nd['role']; }
check(($roleOf['A'] ?? null) === 'author', 'coAuthorNetwork: A role is author');
check(($roleOf['C'] ?? null) === 'both', 'coAuthorNetwork: C role is both (author and editor)');

// --- knowledge graph (IDF-ranked shared-item discovery) ---
$kgItems = [
    1 => ['title' => 'Center', 'class_label' => 'Article', 'class_term' => 'fabio:JournalArticle', 'template_id' => 11],
    2 => ['title' => 'Sibling', 'class_label' => 'Article', 'class_term' => 'fabio:JournalArticle', 'template_id' => 11],
    10 => ['title' => 'Subject A', 'class_label' => 'Subject', 'class_term' => '', 'template_id' => 6],
    11 => ['title' => 'Subject B', 'class_label' => 'Subject', 'class_term' => '', 'template_id' => 6],
];
$kgLinks = [
    1 => [['dcterms:subject', 'Subject', 10], ['dcterms:subject', 'Subject', 11]],
    2 => [['dcterms:subject', 'Subject', 10]],
];
$kgReverseLinks = [10 => ['dcterms:subject' => [1, 2]], 11 => ['dcterms:subject' => [1]]];
$kgReverse = KG::buildShareableReverse($kgReverseLinks);
[$kgIdf, $kgFreq] = KG::computeResourceStats($kgLinks, 4);
check(abs(($kgFreq[10] ?? 0) - 50.0) < 0.01, 'KG computeResourceStats: subject shared by 2/4 items = 50%');
$g = KG::buildGraph(1, $kgItems, $kgLinks, $kgReverseLinks, $kgReverse, $kgIdf, $kgFreq);
check($g !== null, 'KG buildGraph returns a graph');
$kgIds = array_map(static fn ($n) => $n['id'], $g['nodes'] ?? []);
check(in_array('item_1', $kgIds, true) && in_array('resource_10', $kgIds, true) && in_array('resource_11', $kgIds, true), 'KG: center + direct subject nodes');
check(in_array('item_2', $kgIds, true), 'KG: discovers shared item via co-occurring subject');
$kgShared = false;
foreach ($g['edges'] ?? [] as $e) { if (!empty($e['isShared'])) { $kgShared = true; } }
check($kgShared, 'KG: shared edge carries isShared/idf metadata');
check(isset($g['stats']['maxStrength'], $g['stats']['maxFreqPct']), 'KG: stats present');
check(KG::buildItemMap(1, $kgLinks, []) === null, 'KG buildItemMap null without geo');

// --- buildCalendarHeatmap (acquisition cadence by created date) ---
$calItems = [
    1 => ['created' => '2024-01-05'], 2 => ['created' => '2024-01-05'],
    3 => ['created' => '2024-02-10'], 4 => ['created' => ''],
];
check(A::buildCalendarHeatmap([1, 2, 3, 4], $calItems) === [['2024-01-05', 2], ['2024-02-10', 1]], 'buildCalendarHeatmap groups by day');
check(A::buildCalendarHeatmap([4], $calItems) === null, 'buildCalendarHeatmap null when no created dates');

// --- buildBoxplot (items-per-project per section; <2 boxes => null) ---
$bpSections = [10 => ['title' => 'Sec A'], 20 => ['title' => 'Sec B']];
$bpChildren = [10 => [100, 101], 20 => [200], 100 => [1, 2, 3], 101 => [4, 5], 200 => [6]];
check(A::buildBoxplot($bpSections, $bpChildren) === [['name' => 'Sec A', 'values' => [3, 2]], ['name' => 'Sec B', 'values' => [1]]], 'buildBoxplot one box per section');
check(A::buildBoxplot([10 => ['title' => 'Sec A']], $bpChildren) === null, 'buildBoxplot null with <2 boxes');

// --- buildTimeChord (per-year subject co-occurrence) ---
$tcItems = [
    1 => ['title' => 'I1'], 2 => ['title' => 'I2'], 3 => ['title' => 'I3'], 4 => ['title' => 'I4'],
    10 => ['title' => 'S1'], 11 => ['title' => 'S2'], 12 => ['title' => 'S3'],
];
$tcLinks = [
    1 => [['dcterms:subject', 'S', 10], ['dcterms:subject', 'S', 11]],
    2 => [['dcterms:subject', 'S', 10], ['dcterms:subject', 'S', 11]],
    3 => [['dcterms:subject', 'S', 11], ['dcterms:subject', 'S', 12]],
    4 => [['dcterms:subject', 'S', 11], ['dcterms:subject', 'S', 12]],
];
$tcYear = [1 => '2019', 2 => '2019', 3 => '2020', 4 => '2020'];
$tc = A::buildTimeChord([1, 2, 3, 4], $tcLinks, $tcItems, $tcYear);
check($tc !== null && count($tc['buckets']) === 2 && $tc['years'] === ['2019', '2020'], 'buildTimeChord 2 year buckets');
check($tc !== null && $tc['buckets'][0]['year'] === '2019' && count($tc['buckets'][0]['links']) >= 1, 'buildTimeChord bucket carries chord links');

// --- buildWhatsNew (windows off max-created + top projects) ---
$wnItems = [
    1 => ['title' => 'New1', 'created' => '2024-12-01', 'template_id' => 10],
    2 => ['title' => 'New2', 'created' => '2024-11-15', 'template_id' => 10],
    3 => ['title' => 'Old',  'created' => '2023-01-01', 'template_id' => 10],
    50 => ['title' => 'Proj', 'created' => '2020-01-01', 'template_id' => 5],
];
$wn = A::buildWhatsNew($wnItems, [50 => [1, 2, 3]]);
check($wn !== null && $wn['reference'] === '2024-12-01', 'buildWhatsNew reference = max created');
$w3 = $wn['windows'][0];
check($w3['months'] === 3 && $w3['count'] === 2, 'buildWhatsNew 3-month window has 2 recent items');
check(count($w3['topProjects']) === 1 && $w3['topProjects'][0]['itemId'] === 50 && $w3['topProjects'][0]['value'] === 2, 'buildWhatsNew top project counts recent items');

// --- buildStatCards (reusable stat-card assembler) ---
check(A::buildStatCards([
    ['key' => 'researchItems', 'label' => 'Research Items', 'value' => 3975],
    ['key' => 'projects', 'label' => 'Projects', 'value' => 92],
]) === [
    ['key' => 'researchItems', 'label' => 'Research Items', 'value' => 3975],
    ['key' => 'projects', 'label' => 'Projects', 'value' => 92],
], 'buildStatCards passes well-formed cards through in order');
check(A::buildStatCards([
    ['key' => 'a', 'label' => 'A', 'value' => 5],
    ['key' => 'b', 'label' => 'B', 'value' => 0],
    ['key' => 'c', 'label' => 'C', 'value' => -3],
]) === [['key' => 'a', 'label' => 'A', 'value' => 5]], 'buildStatCards drops zero / negative cards');
check(A::buildStatCards([['key' => 'x', 'label' => 'X', 'value' => '12']]) === [['key' => 'x', 'label' => 'X', 'value' => 12]], 'buildStatCards casts value to int');
check(A::buildStatCards([['key' => 'loc', 'label' => 'Locations', 'value' => 142, 'subtitle' => 'in 57 countries']]) === [['key' => 'loc', 'label' => 'Locations', 'value' => 142, 'subtitle' => 'in 57 countries']], 'buildStatCards keeps a non-empty subtitle');
check(A::buildStatCards([['key' => 'loc', 'label' => 'Locations', 'value' => 1, 'subtitle' => null]]) === [['key' => 'loc', 'label' => 'Locations', 'value' => 1]], 'buildStatCards strips a null subtitle');
check(A::buildStatCards([['label' => 'No key', 'value' => 9], ['key' => 'k', 'value' => 9]]) === [], 'buildStatCards drops cards missing key or label');
check(A::buildStatCards([]) === [], 'buildStatCards empty input -> empty list');

echo $failures ? "\n$failures FAILURE(S)\n" : "\nALL PHP AGGREGATOR TESTS PASS\n";
exit($failures ? 1 : 0);
