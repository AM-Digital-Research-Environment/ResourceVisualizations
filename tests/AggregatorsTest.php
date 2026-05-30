<?php
declare(strict_types=1);

/**
 * Dependency-free regression test for the PHP precompute aggregators
 * (src/Precompute/Aggregators.php), mirroring the Python pipeline's validation.
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

use ResourceVisualizations\Precompute\Aggregators as A;

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

echo $failures ? "\n$failures FAILURE(S)\n" : "\nALL PHP AGGREGATOR TESTS PASS\n";
exit($failures ? 1 : 0);
