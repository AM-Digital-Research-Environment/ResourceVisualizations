<?php
/**
 * Pre-compute knowledge graph JSON files for all items.
 *
 * Run from the Omeka S container:
 *   docker compose exec php php /var/www/html/modules/ResourceVisualizations/scripts/precompute-graphs.php
 *
 * Generates one JSON file per item in /var/www/html/files/resource-visualizations/
 * with the full graph data (direct relationships + shared items + reverse lookups).
 */

// Bootstrap Omeka S.
require dirname(__DIR__, 3) . '/bootstrap.php';
$application = \Laminas\Mvc\Application::init(require dirname(__DIR__, 3) . '/application/config/application.config.php');
$services = $application->getServiceManager();
$api = $services->get('Omeka\ApiManager');
$connection = $services->get('Omeka\Connection');

$outputDir = dirname(__DIR__, 3) . '/files/resource-visualizations';
if (!is_dir($outputDir)) {
    mkdir($outputDir, 0775, true);
}

// -- Configuration --------------------------------------------------------

$PROP_CAT = [
    'dcterms:creator'      => 'Person',
    'dcterms:contributor'  => 'Person',
    'foaf:member'          => 'Person',
    'dcterms:subject'      => 'Subject',
    'dcterms:spatial'      => 'Location',
    'dcterms:provenance'   => 'Location',
    'dcterms:isPartOf'     => 'Project',
    'dcterms:format'       => 'Genre',
    'frapo:isFundedBy'     => 'Institution',
    'dcterms:relation'     => 'Related Item',
    'dcterms:hasPart'      => 'Related Item',
    'dcterms:replaces'     => 'Related Item',
    'dcterms:isReplacedBy' => 'Related Item',
    'dcterms:hasVersion'   => 'Related Item',
    'dcterms:isVersionOf'  => 'Related Item',
    'dcterms:hasFormat'    => 'Related Item',
];

$SHAREABLE = [
    'dcterms:subject', 'dcterms:isPartOf', 'dcterms:spatial',
    'dcterms:creator', 'dcterms:contributor',
];

$EXCLUDED = [
    'dcterms:language', 'dcterms:type', 'dcterms:audience',
    'dcterms:license', 'dcterms:accessRights',
    'dre:wisskiUrl', 'dre:mongoId', 'dre:id', 'dre:bitstream',
    'dre:security', 'dre:rdspaceHandle',
];

function getCat(string $term, array $propCat, array $excluded): ?string
{
    if (in_array($term, $excluded, true)) {
        return null;
    }
    if (isset($propCat[$term])) {
        return $propCat[$term];
    }
    if (strpos($term, 'marcrel:') === 0) {
        return 'Contributor';
    }
    return null;
}

// -- Build graph for a single item ----------------------------------------

function buildGraph($item, $api, $propCat, $shareable, $excluded): array
{
    $itemId = $item->id();
    $itemTitle = $item->displayTitle();
    $rc = $item->resourceClass();
    $centerCat = $rc ? $rc->label() : 'Item';

    $nodes = [];
    $edges = [];
    $categories = [['name' => $centerCat]];
    $categoryMap = [$centerCat => 0];
    $seen = [];
    $centerLinked = []; // resourceId => nodeId

    $ensureCat = function (string $name) use (&$categoryMap, &$categories): int {
        if (!isset($categoryMap[$name])) {
            $categoryMap[$name] = count($categories);
            $categories[] = ['name' => $name];
        }
        return $categoryMap[$name];
    };

    $nodes[] = [
        'id' => 'item_' . $itemId,
        'name' => $itemTitle,
        'category' => 0,
        'symbolSize' => 45,
        'isCenter' => true,
        'itemId' => $itemId,
    ];

    // -- Pass 1: direct relationships ------------------------------------
    $shareableFilters = [];

    foreach ($item->values() as $term => $propData) {
        $cat = getCat($term, $propCat, $excluded);
        if (!$cat) {
            continue;
        }
        $catIdx = $ensureCat($cat);
        $isShareable = in_array($term, $shareable, true) || strpos($term, 'marcrel:') === 0;
        $label = $propData['property']->label();

        foreach ($propData['values'] as $value) {
            $vr = $value->valueResource();
            if (!$vr) {
                continue;
            }
            $lid = $vr->id();
            $nid = 'resource_' . $lid;

            if (!isset($seen[$nid])) {
                $seen[$nid] = true;
                $nodes[] = [
                    'id' => $nid,
                    'name' => $vr->displayTitle(),
                    'category' => $catIdx,
                    'symbolSize' => 22,
                    'itemId' => $lid,
                ];
            }
            $edges[] = ['source' => 'item_' . $itemId, 'target' => $nid, 'name' => $label];

            if ($isShareable) {
                $centerLinked[$lid] = $nid;
                if (count($shareableFilters) < 12) {
                    $shareableFilters[] = ['property' => $term, 'text' => (string) $lid, 'type' => 'res', 'joiner' => 'or'];
                }
            }
        }
    }

    // -- Pass 2: reverse lookups -----------------------------------------
    try {
        $reverseItems = $api->search('items', [
            'property' => [['property' => 'dcterms:isPartOf', 'type' => 'res', 'text' => (string) $itemId]],
            'per_page' => 25,
        ])->getContent();
    } catch (\Exception $e) {
        $reverseItems = [];
    }

    if (!empty($reverseItems)) {
        $isSection = $rc && $rc->term() === 'frapo:ResearchGroup';
        $revCatIdx = $ensureCat($isSection ? 'Project' : 'Linked Item');
        foreach ($reverseItems as $ri) {
            $rid = $ri->id();
            if ($rid === $itemId) continue;
            $rnid = 'item_' . $rid;
            if (!isset($seen[$rnid])) {
                $seen[$rnid] = true;
                $nodes[] = ['id' => $rnid, 'name' => $ri->displayTitle(), 'category' => $revCatIdx, 'symbolSize' => 22, 'itemId' => $rid];
            }
            $edges[] = ['source' => $rnid, 'target' => 'item_' . $itemId, 'name' => 'Is Part Of'];
        }
    }

    // -- Pass 3: shared items (multi-connection) -------------------------
    if (!empty($shareableFilters)) {
        try {
            $candidates = $api->search('items', [
                'property' => $shareableFilters,
                'per_page' => 40,
            ])->getContent();
        } catch (\Exception $e) {
            $candidates = [];
        }

        if (!empty($candidates)) {
            $siCatIdx = $ensureCat('Shared Item');
            foreach ($candidates as $cand) {
                $cid = $cand->id();
                if ($cid === $itemId) continue;
                $cnid = 'item_' . $cid;
                $matched = [];

                foreach ($cand->values() as $sTerm => $sPropData) {
                    $sLabel = $sPropData['property']->label();
                    foreach ($sPropData['values'] as $sv) {
                        $svr = $sv->valueResource();
                        if ($svr && isset($centerLinked[$svr->id()])) {
                            $ek = $cnid . '>' . $centerLinked[$svr->id()];
                            if (!isset($matched[$ek])) {
                                $matched[$ek] = ['target' => $centerLinked[$svr->id()], 'name' => $sLabel];
                            }
                        }
                    }
                }

                if (empty($matched)) continue;
                if (!isset($seen[$cnid])) {
                    $seen[$cnid] = true;
                    $nodes[] = ['id' => $cnid, 'name' => $cand->displayTitle(), 'category' => $siCatIdx, 'symbolSize' => 16, 'itemId' => $cid];
                }
                foreach ($matched as $m) {
                    $edges[] = ['source' => $cnid, 'target' => $m['target'], 'name' => $m['name'], 'isShared' => true];
                }
            }
        }
    }

    return ['nodes' => $nodes, 'edges' => $edges, 'categories' => $categories];
}

// -- Main -----------------------------------------------------------------

echo "Pre-computing knowledge graphs...\n";

$page = 1;
$total = 0;
$skipped = 0;

do {
    $response = $api->search('items', ['per_page' => 50, 'page' => $page]);
    $items = $response->getContent();

    foreach ($items as $item) {
        $id = $item->id();
        $graph = buildGraph($item, $api, $PROP_CAT, $SHAREABLE, $EXCLUDED);

        // Only save if there are relationships.
        if (count($graph['nodes']) <= 1) {
            $skipped++;
            continue;
        }

        $json = json_encode($graph, JSON_UNESCAPED_UNICODE);
        file_put_contents($outputDir . '/' . $id . '.json', $json);
        $total++;

        if ($total % 100 === 0) {
            echo "  Processed $total items...\n";
        }
    }

    $page++;
} while (count($items) === 50);

echo "Done. Generated $total graph files, skipped $skipped items with no relationships.\n";
echo "Output: $outputDir/\n";
