<?php
declare(strict_types=1);

namespace DreVisualizations\Precompute\Aggregators;

use DreVisualizations\Precompute\ForceLayout;

/**
 * Entity Network: a global, collection-wide co-occurrence graph linking the
 * five entity types that surface across the collection's items — Person,
 * Organization, Location, Subject (LCSH) and Tag (free subject). Two entities
 * are joined when they appear together on the same item; the edge weight is
 * the number of items in which they co-occur.
 *
 * This is the multi-entity, collection-scale sibling of {@see CommunityTrait}
 * (subjects only) and the per-item {@see \DreVisualizations\Precompute\KnowledgeGraphs}.
 * Node positions are baked here with {@see ForceLayout} (a pure-PHP ForceAtlas2)
 * and projected to pseudo lng/lat, so the MapLibre front end (entity-graph.js)
 * renders the network at zero layout cost. Two optional colour overlays are
 * precomputed alongside the primary by-entity-type colouring: Louvain
 * communities, and — when an `$itemSection` map is supplied — the research
 * section each entity most belongs to (see {@see self::buildEntityGraph()}).
 *
 * Organizations are rarely linked directly from a research item, so they are
 * surfaced through their people: for every Person on an item, that person's
 * affiliated organizations (person → dcterms:isPartOf → foaf:Organization) are
 * folded into the item's entity set. Funders (frapo:isFundedBy) count too.
 *
 * Composed into {@see \DreVisualizations\Precompute\Aggregators}; reaches the
 * shared Louvain helper through `self::louvain()`.
 */
trait EntityGraphTrait
{
    /** Entity-type indices (also the order of the emitted `types` array). */
    private const ENTITY_TYPES = ['Person', 'Organization', 'Location', 'Subject', 'Tag'];
    private const ET_PERSON = 0;
    private const ET_ORG = 1;
    private const ET_LOCATION = 2;
    private const ET_SUBJECT = 3;
    private const ET_TAG = 4;

    /**
     * @param int[]      $itemIds        Research-item ids to scan.
     * @param array      $links          [id => [[term, label, valueResourceId], ...]] for ALL items
     *                                   (person rows are read for affiliations).
     * @param array      $items          [id => ['title'=>, 'class_term'=>, ...]].
     * @param int[]      $lcshIds        Subject ids carrying the LCSH `dcterms:type` marker;
     *                                   subjects in this set are typed Subject, the rest Tag.
     * @param int        $minCooccurrence Drop edges below this co-occurrence weight.
     * @param int        $maxNodes       Keep at most this many entities (top by hubness).
     * @param array      $itemSection    [itemId => researchSectionName] for the scanned
     *                                   works, driving the optional "colour by research
     *                                   section" overlay. Each entity is tagged with the
     *                                   section its works most name: a strict majority
     *                                   wins its index, an even split is a cross-section
     *                                   bridge (-2), and no sectioned work at all is -1.
     *
     * @return array{meta:array,types:string[],sections:string[],nodes:array,edges:array}|null
     *         null when the graph is too small to be worth rendering.
     */
    public static function buildEntityGraph(array $itemIds, array $links, array $items, array $lcshIds = [], int $minCooccurrence = 2, int $maxNodes = 1200, array $itemSection = []): ?array
    {
        $lcsh = array_flip($lcshIds);

        $typeOf = [];     // vrid => entity-type index (lowest/most-specific wins)
        $titleOf = [];    // vrid => display title
        $nodeCount = [];  // vrid => number of items it appears in
        $pairCounts = []; // "a,b" (a<b) => co-occurrence weight
        $sectTally = [];  // vrid => [sectionName => number of the entity's items in it]

        // Record an entity's type/title. Lower type index wins so a resource that
        // could be read two ways keeps its more specific identity. Returns false
        // for untitled resources (skipped — nothing to show or link to).
        $assign = function (int $vrid, int $type, string $title) use (&$typeOf, &$titleOf): bool {
            if ($title === '') {
                return false;
            }
            if (!isset($typeOf[$vrid]) || $type < $typeOf[$vrid]) {
                $typeOf[$vrid] = $type;
            }
            $titleOf[$vrid] = $title;
            return true;
        };

        foreach ($itemIds as $iid) {
            $ents = []; // distinct entity vrids on this item

            foreach ($links[$iid] ?? [] as [$term, $label, $vrid]) {
                $title = $items[$vrid]['title'] ?? '';
                if ($title === '') {
                    continue;
                }
                if ($term === 'dcterms:creator' || $term === 'dcterms:contributor'
                    || $term === 'foaf:member' || $term === 'bibo:authorList'
                    || $term === 'bibo:editorList' || str_starts_with($term, 'marcrel:')) {
                    if ($assign($vrid, self::ET_PERSON, $title)) {
                        $ents[$vrid] = true;
                    }
                    // Surface the person's affiliated organizations.
                    foreach ($links[$vrid] ?? [] as [$pterm, $plabel, $org]) {
                        if ($pterm === 'dcterms:isPartOf' && ($items[$org]['class_term'] ?? '') === 'foaf:Organization') {
                            if ($assign($org, self::ET_ORG, $items[$org]['title'] ?? '')) {
                                $ents[$org] = true;
                            }
                        }
                    }
                } elseif ($term === 'dcterms:subject') {
                    $t = isset($lcsh[$vrid]) ? self::ET_SUBJECT : self::ET_TAG;
                    if ($assign($vrid, $t, $title)) {
                        $ents[$vrid] = true;
                    }
                } elseif ($term === 'dcterms:spatial' || $term === 'dcterms:provenance') {
                    if ($assign($vrid, self::ET_LOCATION, $title)) {
                        $ents[$vrid] = true;
                    }
                } elseif ($term === 'frapo:isFundedBy') {
                    if ($assign($vrid, self::ET_ORG, $title)) {
                        $ents[$vrid] = true;
                    }
                }
            }

            $ids = array_keys($ents);
            $sec = $itemSection[$iid] ?? '';
            foreach ($ids as $v) {
                $nodeCount[$v] = ($nodeCount[$v] ?? 0) + 1;
                if ($sec !== '') {
                    $sectTally[$v][$sec] = ($sectTally[$v][$sec] ?? 0) + 1;
                }
            }
            $n = count($ids);
            for ($i = 0; $i < $n; $i++) {
                for ($j = $i + 1; $j < $n; $j++) {
                    $a = $ids[$i];
                    $b = $ids[$j];
                    if ($a > $b) {
                        [$a, $b] = [$b, $a];
                    }
                    $key = $a . ',' . $b;
                    $pairCounts[$key] = ($pairCounts[$key] ?? 0) + 1;
                }
            }
        }

        // Prune weak edges; build an unweighted degree (neighbour count) for ranking.
        $degree = [];
        $kept = []; // "a,b" => weight, only edges that clear the threshold
        foreach ($pairCounts as $key => $w) {
            if ($w < $minCooccurrence) {
                continue;
            }
            [$a, $b] = array_map('intval', explode(',', $key));
            $kept[$key] = $w;
            $degree[$a] = ($degree[$a] ?? 0) + 1;
            $degree[$b] = ($degree[$b] ?? 0) + 1;
        }
        if (count($degree) < 3 || !$kept) {
            return null;
        }

        // Rank entities by hubness (degree counts triple the raw frequency) and
        // keep the top N. Deterministic id tie-break keeps the output stable.
        $candidates = array_keys($degree);
        usort($candidates, static function ($x, $y) use ($degree, $nodeCount) {
            $sx = ($degree[$x] ?? 0) * 3 + ($nodeCount[$x] ?? 0);
            $sy = ($degree[$y] ?? 0) * 3 + ($nodeCount[$y] ?? 0);
            return $sx !== $sy ? $sy <=> $sx : $x <=> $y;
        });
        $top = array_slice($candidates, 0, $maxNodes);
        $topSet = array_flip($top);

        // Keep edges whose endpoints both survived the cap; build the weighted
        // adjacency Louvain needs and the visible (neighbour-count) degree.
        $adj = [];
        $wdeg = [];
        $visDeg = [];
        $edgeList = [];
        $weightMax = 0;
        $m = 0.0;
        foreach ($kept as $key => $w) {
            [$a, $b] = array_map('intval', explode(',', $key));
            if (!isset($topSet[$a], $topSet[$b])) {
                continue;
            }
            $adj[$a][$b] = $w;
            $adj[$b][$a] = $w;
            $wdeg[$a] = ($wdeg[$a] ?? 0) + $w;
            $wdeg[$b] = ($wdeg[$b] ?? 0) + $w;
            $visDeg[$a] = ($visDeg[$a] ?? 0) + 1;
            $visDeg[$b] = ($visDeg[$b] ?? 0) + 1;
            $edgeList[] = [$a, $b, $w];
            $m += $w;
            if ($w > $weightMax) {
                $weightMax = $w;
            }
        }
        if (!$edgeList) {
            return null;
        }

        // Louvain on the capped subgraph, relabelled by size (largest = 0).
        // Singletons and pairs stay uncoloured (-1): the colour overlay is only
        // meaningful for genuine clusters; node fill already encodes type.
        $rawComm = self::louvain($adj, $wdeg, $m);
        $groups = [];
        foreach ($rawComm as $node => $rep) {
            $groups[$rep][] = $node;
        }
        $sized = [];
        foreach ($groups as $members) {
            $sized[] = $members;
        }
        usort($sized, static fn ($p, $q) => count($q) <=> count($p));
        $communityOf = [];
        $cid = 0;
        foreach ($sized as $members) {
            if (count($members) < 3) {
                continue;
            }
            foreach ($members as $node) {
                $communityOf[$node] = $cid;
            }
            $cid++;
        }

        // Research-section overlay. Order the sections that surface among the kept
        // entities by how often they appear (name tie-break, so colours are stable),
        // then tag every entity with its dominant section: a strict majority wins its
        // index, an even split is a cross-section bridge (-2), and an entity whose
        // works name no section at all is -1. Empty when no $itemSection was given.
        $sectionWeight = [];
        foreach ($top as $vrid) {
            if (!isset($visDeg[$vrid])) {
                continue;
            }
            foreach ($sectTally[$vrid] ?? [] as $name => $c) {
                $sectionWeight[$name] = ($sectionWeight[$name] ?? 0) + $c;
            }
        }
        $sectionNames = array_keys($sectionWeight);
        usort($sectionNames, static function ($a, $b) use ($sectionWeight) {
            return $sectionWeight[$b] !== $sectionWeight[$a]
                ? $sectionWeight[$b] <=> $sectionWeight[$a]
                : strcmp($a, $b);
        });
        $sectionIdx = array_flip($sectionNames);
        $sectionOf = static function (int $vrid) use ($sectTally, $sectionIdx): int {
            $counts = $sectTally[$vrid] ?? [];
            if (!$counts) {
                return -1;
            }
            $total = array_sum($counts);
            arsort($counts);
            $topName = array_key_first($counts);
            if (count($counts) > 1 && $counts[$topName] * 2 <= $total) {
                return -2; // no majority: a cross-section bridge
            }
            return $sectionIdx[$topName];
        };

        // Emit nodes in rank order; map vrid → array index for the edges, and
        // build the mass vector (1 + weighted degree) ForceAtlas2 needs.
        $nodes = [];
        $indexOf = [];
        $massByIndex = [];
        $i = 0;
        foreach ($top as $vrid) {
            if (!isset($visDeg[$vrid])) {
                continue; // dropped: all its edges fell outside the cap
            }
            $indexOf[$vrid] = $i;
            $massByIndex[$i] = 1.0 + ($wdeg[$vrid] ?? 0);
            $nodes[] = [
                $vrid,
                $titleOf[$vrid],
                $typeOf[$vrid],
                $nodeCount[$vrid] ?? 0,
                $visDeg[$vrid],
                $communityOf[$vrid] ?? -1,
                $sectionOf($vrid),
            ];
            $i++;
        }
        $edges = [];
        foreach ($edgeList as [$a, $b, $w]) {
            if (!isset($indexOf[$a], $indexOf[$b])) {
                continue;
            }
            $edges[] = [$indexOf[$a], $indexOf[$b], $w];
        }
        if (count($nodes) < 3 || !$edges) {
            return null;
        }

        // Bake node positions with ForceAtlas2 (the algorithm + settings the
        // browser used to run live), then project [-1,1] → pseudo lng/lat so
        // MapLibre renders the network without any client-side layout work.
        $xy = ForceLayout::layout(count($nodes), $edges, $massByIndex);
        $minLng = $minLat = INF;
        $maxLng = $maxLat = -INF;
        foreach ($nodes as $idx => &$row) {
            [$lng, $lat] = ForceLayout::toPseudoLngLat($xy[$idx][0], $xy[$idx][1]);
            $row[] = $lng;
            $row[] = $lat;
            if ($lng < $minLng) { $minLng = $lng; }
            if ($lng > $maxLng) { $maxLng = $lng; }
            if ($lat < $minLat) { $minLat = $lat; }
            if ($lat > $maxLat) { $maxLat = $lat; }
        }
        unset($row);

        // Label priority: hubs first (degree×3 + item count). Lower rank wins
        // MapLibre's symbol-collision so the most-connected entities keep labels.
        $rankOrder = array_keys($nodes);
        usort($rankOrder, static function ($p, $q) use ($nodes) {
            $sp = $nodes[$p][4] * 3 + $nodes[$p][3];
            $sq = $nodes[$q][4] * 3 + $nodes[$q][3];
            return $sp !== $sq ? $sq <=> $sp : $p <=> $q;
        });
        foreach ($rankOrder as $rank => $idx) {
            $nodes[$idx][] = $rank;
        }

        return [
            'meta' => [
                'generatedAt' => gmdate('c'),
                'weightMin' => $minCooccurrence,
                'weightMax' => $weightMax,
                'nodeCount' => count($nodes),
                'edgeCount' => count($edges),
                'communityCount' => $cid,
                'sectionCount' => count($sectionNames),
                'bounds' => [
                    round($minLng, 4), round($minLat, 4),
                    round($maxLng, 4), round($maxLat, 4),
                ],
                'columns' => [
                    'nodes' => ['id', 'label', 'type', 'count', 'degree', 'community', 'section', 'lng', 'lat', 'rank'],
                    'edges' => ['source', 'target', 'weight'],
                ],
            ],
            'types' => self::ENTITY_TYPES,
            'sections' => $sectionNames,
            'nodes' => $nodes,
            'edges' => $edges,
        ];
    }
}
