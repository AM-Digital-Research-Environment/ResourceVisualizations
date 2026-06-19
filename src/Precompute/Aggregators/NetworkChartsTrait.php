<?php
declare(strict_types=1);

namespace DreVisualizations\Precompute\Aggregators;

/**
 * Force-graph / flow builders: subject chord, contributor→project→type
 * sankey, and the contributor / affiliation / collaboration / co-author
 * networks.
 *
 * Composed into {@see \DreVisualizations\Precompute\Aggregators}; its methods
 * reach shared constants and helpers on that class through `self::`.
 */
trait NetworkChartsTrait
{
    private static function isPersonContributionTerm(string $term): bool
    {
        return str_starts_with($term, 'marcrel:')
            || $term === 'dcterms:creator'
            || $term === 'dcterms:contributor'
            || $term === 'bibo:authorList'
            || $term === 'bibo:editorList';
    }

    /** Build a co-occurrence chord diagram for a given property. */
    public static function buildChord(array $itemIds, array $links, array $items, string $termFilter = 'dcterms:subject', int $maxNodes = 20, int $minCooccurrence = 2): ?array
    {
        $itemValues = [];
        $valueTitles = [];
        foreach ($itemIds as $iid) {
            $vals = [];
            foreach ($links[$iid] ?? [] as [$term, $label, $vrid]) {
                if ($term === $termFilter) {
                    $title = $items[$vrid]['title'] ?? '';
                    if ($title !== '') {
                        $vals[] = $vrid;
                        $valueTitles[$vrid] = $title;
                    }
                }
            }
            if (count($vals) >= 2) {
                $itemValues[$iid] = $vals;
            }
        }

        $pairCounts = [];
        $nodeCounts = [];
        foreach ($itemValues as $vals) {
            foreach ($vals as $v) {
                $nodeCounts[$v] = ($nodeCounts[$v] ?? 0) + 1;
            }
            $n = count($vals);
            for ($i = 0; $i < $n; $i++) {
                for ($j = $i + 1; $j < $n; $j++) {
                    $a = $vals[$i];
                    $b = $vals[$j];
                    if ($a > $b) {
                        [$a, $b] = [$b, $a];
                    }
                    $pairCounts[$a . ',' . $b] = ($pairCounts[$a . ',' . $b] ?? 0) + 1;
                }
            }
        }

        arsort($nodeCounts);
        $topNodes = array_slice(array_keys($nodeCounts), 0, $maxNodes);
        $topSet = array_flip($topNodes);

        $chordLinks = [];
        foreach ($pairCounts as $key => $count) {
            [$a, $b] = array_map('intval', explode(',', $key));
            if ($count >= $minCooccurrence && isset($topSet[$a], $topSet[$b])) {
                $chordLinks[] = ['source' => $valueTitles[$a], 'target' => $valueTitles[$b], 'value' => $count];
            }
        }
        if (!$chordLinks) {
            return null;
        }

        $chordNodes = [];
        foreach ($topNodes as $v) {
            if (isset($valueTitles[$v])) {
                $chordNodes[] = ['name' => $valueTitles[$v], 'value' => $nodeCounts[$v], 'itemId' => $v];
            }
        }
        return ['nodes' => $chordNodes, 'links' => $chordLinks];
    }

    /** Build contributor -> project -> resource type Sankey flow. */
    public static function buildSankey(array $itemIds, array $links, array $items): ?array
    {
        $flows = [];
        foreach ($itemIds as $iid) {
            $itemContributors = [];
            $itemProject = null;
            $itemTypes = [];
            foreach ($links[$iid] ?? [] as [$term, $label, $vrid]) {
                $title = $items[$vrid]['title'] ?? '';
                if ($title === '') {
                    continue;
                }
                if (str_starts_with($term, 'marcrel:') || $term === 'dcterms:creator' || $term === 'dcterms:contributor') {
                    $itemContributors[] = $title;
                } elseif ($term === 'dcterms:isPartOf') {
                    $itemProject = $title;
                } elseif ($term === 'dcterms:type') {
                    $itemTypes[] = $title;
                }
            }
            if (!$itemProject || !$itemContributors || !$itemTypes) {
                continue;
            }
            foreach (array_slice($itemContributors, 0, 3) as $c) {
                foreach ($itemTypes as $t) {
                    $k = $c . "\0" . $itemProject . "\0" . $t;
                    $flows[$k] = ($flows[$k] ?? 0) + 1;
                }
            }
        }
        if (!$flows) {
            return null;
        }

        $contribCounts = [];
        foreach ($flows as $k => $v) {
            [$c] = explode("\0", $k);
            $contribCounts[$c] = ($contribCounts[$c] ?? 0) + $v;
        }
        arsort($contribCounts);
        $topContribs = array_flip(array_slice(array_keys($contribCounts), 0, 10));

        $linkMap = [];
        $nodeNames = [];
        foreach ($flows as $k => $v) {
            [$c, $p, $t] = explode("\0", $k);
            if (!isset($topContribs[$c])) {
                continue;
            }
            $nodeNames[$c] = true;
            $nodeNames[$p] = true;
            $nodeNames[$t] = true;
            $linkMap[$c . "\0" . $p] = ($linkMap[$c . "\0" . $p] ?? 0) + $v;
            $linkMap[$p . "\0" . $t] = ($linkMap[$p . "\0" . $t] ?? 0) + $v;
        }

        $nodes = [];
        foreach (array_keys($nodeNames) as $n) {
            $nodes[] = ['name' => $n];
        }
        $dedupedLinks = [];
        foreach ($linkMap as $k => $v) {
            [$s, $t] = explode("\0", $k);
            $dedupedLinks[] = ['source' => $s, 'target' => $t, 'value' => $v];
        }
        return $dedupedLinks ? ['nodes' => $nodes, 'links' => $dedupedLinks] : null;
    }

    /** Build person -> project force graph from research items. */
    public static function buildContributorNetwork(int $entityId, string $entityTitle, array $itemIds, array $items, array $links, array $childrenOf, int $maxNodes = 30): ?array
    {
        $personProject = [];
        $personCounts = [];
        $projectCounts = [];
        foreach ($itemIds as $iid) {
            $itemPersons = [];
            $itemProject = null;
            foreach ($links[$iid] ?? [] as [$term, $label, $vrid]) {
                if (str_starts_with($term, 'marcrel:') || $term === 'dcterms:creator' || $term === 'dcterms:contributor') {
                    if (($items[$vrid]['template_id'] ?? null) === self::TEMPLATE_PERSONS) {
                        $itemPersons[] = $vrid;
                    }
                } elseif ($term === 'dcterms:isPartOf') {
                    if (($items[$vrid]['template_id'] ?? null) === self::TEMPLATE_PROJECTS) {
                        $itemProject = $vrid;
                    }
                }
            }
            if ($itemProject && $itemPersons) {
                foreach ($itemPersons as $pid) {
                    $personProject[$pid . ',' . $itemProject] = ($personProject[$pid . ',' . $itemProject] ?? 0) + 1;
                    $personCounts[$pid] = ($personCounts[$pid] ?? 0) + 1;
                }
                $projectCounts[$itemProject] = ($projectCounts[$itemProject] ?? 0) + 1;
            }
        }
        if (!$personProject) {
            return null;
        }

        arsort($personCounts);
        $topPersons = array_flip(array_slice(array_keys($personCounts), 0, $maxNodes));
        arsort($projectCounts);
        $topProjects = array_flip(array_slice(array_keys($projectCounts), 0, 15));

        $nodes = [];
        $nodeNames = [];
        foreach (array_keys($topPersons) as $pid) {
            $title = $items[$pid]['title'] ?? ('Person ' . $pid);
            $nodes[] = ['name' => $title, 'value' => $personCounts[$pid], 'itemId' => $pid, 'category' => 'person'];
            $nodeNames[$title] = true;
        }
        foreach (array_keys($topProjects) as $pid) {
            $title = $items[$pid]['title'] ?? ('Project ' . $pid);
            $nodes[] = ['name' => $title, 'value' => $projectCounts[$pid], 'itemId' => $pid, 'category' => 'project'];
            $nodeNames[$title] = true;
        }

        $netLinks = [];
        foreach ($personProject as $key => $count) {
            [$personId, $projId] = array_map('intval', explode(',', $key));
            if (isset($topPersons[$personId], $topProjects[$projId])) {
                $pTitle = $items[$personId]['title'] ?? '';
                $prTitle = $items[$projId]['title'] ?? '';
                if (isset($nodeNames[$pTitle], $nodeNames[$prTitle])) {
                    $netLinks[] = ['source' => $pTitle, 'target' => $prTitle, 'value' => $count];
                }
            }
        }
        return $netLinks ? ['nodes' => $nodes, 'links' => $netLinks, 'categories' => ['person', 'project']] : null;
    }

    /**
     * Collection-wide person -> project force graph from research items.
     *
     * Same chart shape as buildContributorNetwork(), but without anchoring the
     * graph to one entity. This backs the Network Explorer page block.
     */
    public static function buildGlobalContributorNetwork(array $itemIds, array $items, array $links, int $maxPersons = 120, int $maxProjects = 80): ?array
    {
        $personProject = [];
        $personCounts = [];
        $projectCounts = [];

        foreach ($itemIds as $iid) {
            $itemPersons = [];
            $itemProject = null;
            foreach ($links[$iid] ?? [] as [$term, , $vrid]) {
                if (self::isPersonContributionTerm($term)) {
                    if (($items[$vrid]['template_id'] ?? null) === self::TEMPLATE_PERSONS) {
                        $itemPersons[$vrid] = true;
                    }
                } elseif ($term === 'dcterms:isPartOf') {
                    if (($items[$vrid]['template_id'] ?? null) === self::TEMPLATE_PROJECTS) {
                        $itemProject = $vrid;
                    }
                }
            }
            if (!$itemProject || !$itemPersons) {
                continue;
            }
            foreach (array_keys($itemPersons) as $pid) {
                $personProject[$pid . ',' . $itemProject] = ($personProject[$pid . ',' . $itemProject] ?? 0) + 1;
                $personCounts[$pid] = ($personCounts[$pid] ?? 0) + 1;
            }
            $projectCounts[$itemProject] = ($projectCounts[$itemProject] ?? 0) + 1;
        }
        if (!$personProject) {
            return null;
        }

        arsort($personCounts);
        arsort($projectCounts);
        $topPersons = array_flip(array_slice(array_keys($personCounts), 0, $maxPersons));
        $topProjects = array_flip(array_slice(array_keys($projectCounts), 0, $maxProjects));

        $nodes = [];
        $nodeNames = [];
        foreach (array_keys($topPersons) as $pid) {
            $title = $items[$pid]['title'] ?? ('Person ' . $pid);
            $nodes[] = ['name' => $title, 'value' => $personCounts[$pid], 'itemId' => $pid, 'category' => 'person'];
            $nodeNames[$title] = true;
        }
        foreach (array_keys($topProjects) as $pid) {
            $title = $items[$pid]['title'] ?? ('Project ' . $pid);
            $nodes[] = ['name' => $title, 'value' => $projectCounts[$pid], 'itemId' => $pid, 'category' => 'project'];
            $nodeNames[$title] = true;
        }

        $netLinks = [];
        foreach ($personProject as $key => $count) {
            [$personId, $projId] = array_map('intval', explode(',', $key));
            if (isset($topPersons[$personId], $topProjects[$projId])) {
                $pTitle = $items[$personId]['title'] ?? '';
                $prTitle = $items[$projId]['title'] ?? '';
                if (isset($nodeNames[$pTitle], $nodeNames[$prTitle])) {
                    $netLinks[] = ['source' => $pTitle, 'target' => $prTitle, 'value' => $count];
                }
            }
        }

        return $netLinks ? ['nodes' => $nodes, 'links' => $netLinks, 'categories' => ['person', 'project']] : null;
    }

    /**
     * Collection-wide person-person collaboration network from research items.
     *
     * This is a projection of the contributor graph: two persons are linked when
     * they appear together on the same research item. Louvain communities and
     * weighted PageRank are computed so the existing community graph builder can
     * render the result.
     */
    public static function buildPersonCollaborationNetwork(array $itemIds, array $items, array $links, int $minCooccurrence = 2, int $maxNodes = 120): ?array
    {
        $pairCounts = [];
        $nodeCounts = [];
        $titles = [];

        foreach ($itemIds as $iid) {
            $persons = [];
            foreach ($links[$iid] ?? [] as [$term, , $vrid]) {
                if (!self::isPersonContributionTerm($term)) {
                    continue;
                }
                if (($items[$vrid]['template_id'] ?? null) === self::TEMPLATE_PERSONS) {
                    $persons[$vrid] = true;
                    $titles[$vrid] = $items[$vrid]['title'] ?? ('Person ' . $vrid);
                }
            }
            $persons = array_keys($persons);
            foreach ($persons as $pid) {
                $nodeCounts[$pid] = ($nodeCounts[$pid] ?? 0) + 1;
            }
            $n = count($persons);
            for ($i = 0; $i < $n; $i++) {
                for ($j = $i + 1; $j < $n; $j++) {
                    $a = $persons[$i];
                    $b = $persons[$j];
                    if ($a > $b) {
                        [$a, $b] = [$b, $a];
                    }
                    $pairCounts[$a . ',' . $b] = ($pairCounts[$a . ',' . $b] ?? 0) + 1;
                }
            }
        }

        $adj = [];
        $deg = [];
        $edges = 0;
        foreach ($pairCounts as $key => $w) {
            if ($w < $minCooccurrence) {
                continue;
            }
            [$a, $b] = array_map('intval', explode(',', $key));
            $adj[$a][$b] = $w;
            $adj[$b][$a] = $w;
            $deg[$a] = ($deg[$a] ?? 0) + $w;
            $deg[$b] = ($deg[$b] ?? 0) + $w;
            $edges++;
        }
        if (count($adj) < 3 || $edges < 2) {
            return null;
        }

        $m = array_sum($deg) / 2.0;
        $rawComm = self::louvain($adj, $deg, $m);
        $relabel = [];
        $next = 0;
        $commOf = [];
        foreach ($rawComm as $node => $c) {
            if (!isset($relabel[$c])) {
                $relabel[$c] = $next++;
            }
            $commOf[$node] = $relabel[$c];
        }

        $pr = self::weightedPagerank($adj, $deg);
        $rankNodes = array_keys($adj);
        usort($rankNodes, static fn ($x, $y) => ($pr[$y] ?? 0) <=> ($pr[$x] ?? 0));
        $ranked = array_slice($rankNodes, 0, $maxNodes);
        $topSet = array_flip($ranked);

        $nodes = [];
        foreach ($ranked as $nd) {
            $nodes[] = [
                'name' => $titles[$nd] ?? ('Person ' . $nd),
                'value' => $nodeCounts[$nd] ?? 0,
                'itemId' => $nd,
                'community' => $commOf[$nd] ?? 0,
                'rank' => round($pr[$nd] ?? 0, 6),
                'matched' => true,
                'role' => 'contributor',
            ];
        }

        $outLinks = [];
        foreach ($pairCounts as $key => $w) {
            if ($w < $minCooccurrence) {
                continue;
            }
            [$a, $b] = array_map('intval', explode(',', $key));
            if (isset($topSet[$a], $topSet[$b])) {
                $outLinks[] = ['source' => $titles[$a] ?? ('Person ' . $a), 'target' => $titles[$b] ?? ('Person ' . $b), 'value' => $w];
            }
        }

        $summary = [];
        foreach ($ranked as $nd) {
            $ci = $commOf[$nd] ?? 0;
            if (!isset($summary[$ci])) {
                $summary[$ci] = ['id' => $ci, 'size' => 0, 'anchor' => null, '_rank' => -1.0];
            }
            $summary[$ci]['size']++;
            if (($pr[$nd] ?? 0) > $summary[$ci]['_rank']) {
                $summary[$ci]['_rank'] = $pr[$nd] ?? 0;
                $summary[$ci]['anchor'] = $titles[$nd] ?? null;
            }
        }
        $communitiesList = [];
        foreach ($summary as $s) {
            $communitiesList[] = ['id' => $s['id'], 'size' => $s['size'], 'anchor' => $s['anchor']];
        }
        usort($communitiesList, static fn ($a, $b) => $b['size'] <=> $a['size']);

        return ['nodes' => $nodes, 'links' => $outLinks, 'communities' => $communitiesList];
    }

    /** Build a collection-wide person -> institution affiliation network. */
    public static function buildGlobalAffiliationNetwork(array $items, array $links, int $maxPersons = 120, int $maxInstitutions = 80): ?array
    {
        $personAffiliations = [];
        $personCounts = [];
        $institutionCounts = [];

        foreach ($items as $pid => $info) {
            if (($info['template_id'] ?? null) !== self::TEMPLATE_PERSONS) {
                continue;
            }
            $affiliations = [];
            foreach ($links[$pid] ?? [] as [$term, , $vrid]) {
                if ($term === 'dcterms:isPartOf' && ($items[$vrid]['class_term'] ?? '') === 'foaf:Organization') {
                    $affiliations[$vrid] = true;
                }
            }
            if (!$affiliations) {
                continue;
            }
            $personAffiliations[$pid] = array_keys($affiliations);
            $personCounts[$pid] = count($affiliations);
            foreach (array_keys($affiliations) as $iid) {
                $institutionCounts[$iid] = ($institutionCounts[$iid] ?? 0) + 1;
            }
        }
        if (!$personAffiliations) {
            return null;
        }

        arsort($personCounts);
        arsort($institutionCounts);
        $topPersons = array_flip(array_slice(array_keys($personCounts), 0, $maxPersons));
        $topInstitutions = array_flip(array_slice(array_keys($institutionCounts), 0, $maxInstitutions));

        $nodes = [];
        $nodeNames = [];
        foreach (array_keys($topPersons) as $pid) {
            $title = $items[$pid]['title'] ?? ('Person ' . $pid);
            $nodes[] = ['name' => $title, 'value' => $personCounts[$pid], 'itemId' => $pid, 'category' => 'person'];
            $nodeNames[$title] = true;
        }
        foreach (array_keys($topInstitutions) as $iid) {
            $title = $items[$iid]['title'] ?? ('Institution ' . $iid);
            $nodes[] = ['name' => $title, 'value' => $institutionCounts[$iid], 'itemId' => $iid, 'category' => 'institution'];
            $nodeNames[$title] = true;
        }

        $netLinks = [];
        foreach ($personAffiliations as $pid => $affiliations) {
            if (!isset($topPersons[$pid])) {
                continue;
            }
            $personTitle = $items[$pid]['title'] ?? '';
            foreach ($affiliations as $iid) {
                if (!isset($topInstitutions[$iid])) {
                    continue;
                }
                $institutionTitle = $items[$iid]['title'] ?? '';
                if (isset($nodeNames[$personTitle], $nodeNames[$institutionTitle])) {
                    $netLinks[] = ['source' => $personTitle, 'target' => $institutionTitle, 'value' => 1];
                }
            }
        }

        return $netLinks ? ['nodes' => $nodes, 'links' => $netLinks, 'categories' => ['person', 'institution']] : null;
    }

    /**
     * Build a collection-wide institution collaboration graph.
     *
     * Institutions are linked when they co-occur through direct research-item
     * organisation links, contributor affiliations on the same item, or project
     * funding organisations associated with that item's project.
     */
    public static function buildGlobalInstitutionCollaborationNetwork(array $itemIds, array $items, array $links, int $minShared = 1, int $maxNodes = 80): ?array
    {
        $pairCounts = [];
        $nodeCounts = [];
        $titles = [];

        foreach ($itemIds as $iid) {
            $institutions = [];
            $projectId = null;
            foreach ($links[$iid] ?? [] as [$term, , $vrid]) {
                $isOrg = ($items[$vrid]['class_term'] ?? '') === 'foaf:Organization';
                if ($term === 'dcterms:isPartOf' && ($items[$vrid]['template_id'] ?? null) === self::TEMPLATE_PROJECTS) {
                    $projectId = $vrid;
                } elseif ($isOrg && ($term === 'frapo:isFundedBy' || $term === 'dcterms:provenance' || str_starts_with($term, 'marcrel:'))) {
                    $institutions[$vrid] = true;
                } elseif (self::isPersonContributionTerm($term) && ($items[$vrid]['template_id'] ?? null) === self::TEMPLATE_PERSONS) {
                    foreach ($links[$vrid] ?? [] as [$pTerm, , $affId]) {
                        if ($pTerm === 'dcterms:isPartOf' && ($items[$affId]['class_term'] ?? '') === 'foaf:Organization') {
                            $institutions[$affId] = true;
                        }
                    }
                }
            }
            if ($projectId !== null) {
                foreach ($links[$projectId] ?? [] as [$pTerm, , $fundId]) {
                    if ($pTerm === 'frapo:isFundedBy' && ($items[$fundId]['class_term'] ?? '') === 'foaf:Organization') {
                        $institutions[$fundId] = true;
                    }
                }
            }

            $ids = array_keys($institutions);
            foreach ($ids as $instId) {
                $nodeCounts[$instId] = ($nodeCounts[$instId] ?? 0) + 1;
                $titles[$instId] = $items[$instId]['title'] ?? ('Institution ' . $instId);
            }
            $n = count($ids);
            for ($i = 0; $i < $n; $i++) {
                for ($j = $i + 1; $j < $n; $j++) {
                    $a = $ids[$i];
                    $b = $ids[$j];
                    if ($a > $b) {
                        [$a, $b] = [$b, $a];
                    }
                    $pairCounts[$a . ',' . $b] = ($pairCounts[$a . ',' . $b] ?? 0) + 1;
                }
            }
        }
        if (!$pairCounts) {
            return null;
        }

        arsort($nodeCounts);
        $topInstitutions = array_flip(array_slice(array_keys($nodeCounts), 0, $maxNodes));
        $nodes = [];
        $nodeNames = [];
        foreach (array_keys($topInstitutions) as $iid) {
            $title = $titles[$iid] ?? ($items[$iid]['title'] ?? ('Institution ' . $iid));
            $nodes[] = ['name' => $title, 'value' => $nodeCounts[$iid], 'itemId' => $iid];
            $nodeNames[$title] = true;
        }

        $netLinks = [];
        foreach ($pairCounts as $key => $count) {
            if ($count < $minShared) {
                continue;
            }
            [$a, $b] = array_map('intval', explode(',', $key));
            if (isset($topInstitutions[$a], $topInstitutions[$b])) {
                $aTitle = $titles[$a] ?? ($items[$a]['title'] ?? '');
                $bTitle = $titles[$b] ?? ($items[$b]['title'] ?? '');
                if (isset($nodeNames[$aTitle], $nodeNames[$bTitle])) {
                    $netLinks[] = ['source' => $aTitle, 'target' => $bTitle, 'value' => $count];
                }
            }
        }

        return $netLinks ? ['nodes' => $nodes, 'links' => $netLinks] : null;
    }

    /** Build person -> institution affiliation network centred on an institution. */
    public static function buildAffiliationNetwork(int $instId, string $instTitle, array $items, array $links, array $reverseLinks, int $maxNodes = 30): ?array
    {
        $affiliated = $reverseLinks[$instId]['dcterms:isPartOf'] ?? [];
        $affiliatedPersons = [];
        foreach ($affiliated as $pid) {
            if (($items[$pid]['template_id'] ?? null) === self::TEMPLATE_PERSONS) {
                $affiliatedPersons[] = $pid;
            }
        }
        if (!$affiliatedPersons) {
            return null;
        }

        $instCounts = [];
        $personAffl = [];
        foreach ($affiliatedPersons as $pid) {
            $affls = [];
            foreach ($links[$pid] ?? [] as [$term, $label, $vrid]) {
                if ($term === 'dcterms:isPartOf' && ($items[$vrid]['class_term'] ?? '') === 'foaf:Organization') {
                    $affls[] = $vrid;
                    $instCounts[$vrid] = ($instCounts[$vrid] ?? 0) + 1;
                }
            }
            $personAffl[$pid] = $affls;
        }

        arsort($instCounts);
        $topInsts = array_flip(array_slice(array_keys($instCounts), 0, $maxNodes));
        $topInsts[$instId] = true;

        $nodes = [['name' => $instTitle, 'value' => count($affiliatedPersons), 'itemId' => $instId, 'category' => 'institution', 'isSelf' => true]];
        $nodeNames = [$instTitle => true];
        foreach (array_keys($topInsts) as $iid) {
            if ($iid === $instId) {
                continue;
            }
            $title = $items[$iid]['title'] ?? ('Institution ' . $iid);
            $nodes[] = ['name' => $title, 'value' => $instCounts[$iid], 'itemId' => $iid, 'category' => 'institution'];
            $nodeNames[$title] = true;
        }
        foreach (array_slice($affiliatedPersons, 0, $maxNodes) as $pid) {
            $title = $items[$pid]['title'] ?? ('Person ' . $pid);
            $nodes[] = ['name' => $title, 'value' => count($personAffl[$pid] ?? []), 'itemId' => $pid, 'category' => 'person'];
            $nodeNames[$title] = true;
        }

        $netLinks = [];
        foreach (array_slice($affiliatedPersons, 0, $maxNodes) as $pid) {
            $pTitle = $items[$pid]['title'] ?? '';
            foreach ($personAffl[$pid] ?? [] as $iid) {
                if (!isset($topInsts[$iid])) {
                    continue;
                }
                $iTitle = $items[$iid]['title'] ?? '';
                if (isset($nodeNames[$pTitle], $nodeNames[$iTitle])) {
                    $netLinks[] = ['source' => $pTitle, 'target' => $iTitle, 'value' => 1];
                }
            }
        }
        return $netLinks ? ['nodes' => $nodes, 'links' => $netLinks, 'categories' => ['person', 'institution']] : null;
    }

    /** Build institution collaboration network from shared research items. */
    public static function buildCollabNetwork(int $instId, string $instTitle, array $itemIds, array $items, array $links, array $reverseLinks, array $instSet, array $instTerms, int $maxNodes = 25): ?array
    {
        $collabCounts = [];
        $instTermsSet = array_flip($instTerms);
        foreach ($itemIds as $iid) {
            foreach ($links[$iid] ?? [] as [$term, $label, $vrid]) {
                if (isset($instTermsSet[$term]) && $vrid !== $instId && isset($instSet[$vrid])) {
                    $collabCounts[$vrid] = ($collabCounts[$vrid] ?? 0) + 1;
                }
            }
        }
        if (!$collabCounts) {
            return null;
        }
        arsort($collabCounts);
        $topCollabs = array_slice($collabCounts, 0, $maxNodes, true);
        $topIds = array_keys($topCollabs);

        $nodes = [['name' => $instTitle, 'value' => count($itemIds), 'itemId' => $instId, 'isSelf' => true]];
        foreach ($topCollabs as $cid => $count) {
            $ctitle = $items[$cid]['title'] ?? ('Institution ' . $cid);
            $nodes[] = ['name' => $ctitle, 'value' => $count, 'itemId' => $cid];
        }

        $netLinks = [];
        foreach ($topCollabs as $cid => $count) {
            $ctitle = $items[$cid]['title'] ?? ('Institution ' . $cid);
            $netLinks[] = ['source' => $instTitle, 'target' => $ctitle, 'value' => $count];
        }

        $collabItems = [];
        foreach ($topIds as $cid) {
            $collabItems[$cid] = array_flip(self::findItemsLinkingTo($cid, $reverseLinks, $instTerms));
        }
        $n = count($topIds);
        for ($i = 0; $i < $n; $i++) {
            for ($j = $i + 1; $j < $n; $j++) {
                $a = $topIds[$i];
                $b = $topIds[$j];
                $shared = count(array_intersect_key($collabItems[$a], $collabItems[$b]));
                if ($shared >= 2) {
                    $aTitle = $items[$a]['title'] ?? '';
                    $bTitle = $items[$b]['title'] ?? '';
                    if ($aTitle !== '' && $bTitle !== '') {
                        $netLinks[] = ['source' => $aTitle, 'target' => $bTitle, 'value' => $shared];
                    }
                }
            }
        }
        return $netLinks ? ['nodes' => $nodes, 'links' => $netLinks] : null;
    }

    /**
     * Co-author network: authors and editors co-occurring on the same publication,
     * as a force graph in the {nodes, links, communities} shape buildCommunities
     * consumes. Contributors come from both literal and Person-linked
     * bibo:authorList / bibo:editorList values; nodes carry a `matched` flag (true
     * = linked Person) and a `role` ('author' | 'editor' | 'both'), and each link
     * carries a `relation` ('coauthor' | 'coeditor' | 'mixed') — its dominant
     * relationship across the publications the pair shares — so the front-end can
     * tell co-authorship apart from author–editor and co-editorship ties.
     * Communities use the same Louvain + weighted-PageRank as the subject graph.
     *
     * @return array{nodes:list<array>,links:list<array>,communities:list<array>}|null
     */
    public static function buildCoAuthorNetwork(array $itemIds, array $links, array $literals, array $items, int $minCooccurrence = 1, int $maxNodes = 60): ?array
    {
        // Map each distinct contributor name to an integer node id so the integer-
        // keyed louvain()/weightedPagerank() helpers apply unchanged. Each node
        // tracks a role mask (bit 1 = listed as author, bit 2 = listed as editor)
        // and whether it resolved to a linked Person record (matched).
        $nameId = [];
        $idName = [];
        $matched = [];
        $personId = [];
        $roleMask = [];
        $next = 0;
        $ensure = static function (string $name) use (&$nameId, &$idName, &$matched, &$roleMask, &$next): int {
            if (!isset($nameId[$name])) {
                $nameId[$name] = $next;
                $idName[$next] = $name;
                $matched[$next] = false;
                $roleMask[$next] = 0;
                $next++;
            }
            return $nameId[$name];
        };

        $pairCounts = [];   // "a,b" => number of publications the pair shares
        $pairRel = [];      // "a,b" => [relation => count] across those publications
        $nodeCounts = [];
        foreach ($itemIds as $iid) {
            $authorIds = [];
            $editorIds = [];
            foreach ($links[$iid] ?? [] as [$term, $label, $vrid]) {
                if ($term !== 'bibo:authorList' && $term !== 'bibo:editorList') {
                    continue;
                }
                $title = trim((string) ($items[$vrid]['title'] ?? ''));
                if ($title === '') {
                    continue;
                }
                $aid = $ensure($title);
                $matched[$aid] = true;
                $personId[$aid] = $vrid;
                if ($term === 'bibo:authorList') {
                    $roleMask[$aid] |= 1;
                    $authorIds[$aid] = true;
                } else {
                    $roleMask[$aid] |= 2;
                    $editorIds[$aid] = true;
                }
            }
            foreach ($literals[$iid]['bibo:authorList'] ?? [] as $name) {
                $name = trim((string) $name);
                if ($name === '') {
                    continue;
                }
                $aid = $ensure($name);
                $roleMask[$aid] |= 1;
                $authorIds[$aid] = true;
            }
            foreach ($literals[$iid]['bibo:editorList'] ?? [] as $name) {
                $name = trim((string) $name);
                if ($name === '') {
                    continue;
                }
                $aid = $ensure($name);
                $roleMask[$aid] |= 2;
                $editorIds[$aid] = true;
            }

            // Contributors on this publication = the union of its authors and editors.
            $contribs = array_keys($authorIds + $editorIds);
            foreach ($contribs as $a) {
                $nodeCounts[$a] = ($nodeCounts[$a] ?? 0) + 1;
            }
            $n = count($contribs);
            for ($i = 0; $i < $n; $i++) {
                for ($j = $i + 1; $j < $n; $j++) {
                    $a = $contribs[$i];
                    $b = $contribs[$j];
                    if ($a > $b) {
                        [$a, $b] = [$b, $a];
                    }
                    $key = $a . ',' . $b;
                    $pairCounts[$key] = ($pairCounts[$key] ?? 0) + 1;
                    // Relationship on THIS publication: co-authorship when both are
                    // listed as authors, co-editorship when both editors, else an
                    // author–editor (mixed) tie. Someone listed as both on one item
                    // counts as an author for that item.
                    $ra = isset($authorIds[$a]) ? 'a' : 'e';
                    $rb = isset($authorIds[$b]) ? 'a' : 'e';
                    $rel = ($ra === 'a' && $rb === 'a') ? 'coauthor'
                        : (($ra === 'e' && $rb === 'e') ? 'coeditor' : 'mixed');
                    $pairRel[$key][$rel] = ($pairRel[$key][$rel] ?? 0) + 1;
                }
            }
        }

        $adj = [];
        $deg = [];
        $edges = 0;
        foreach ($pairCounts as $key => $w) {
            if ($w < $minCooccurrence) {
                continue;
            }
            [$a, $b] = array_map('intval', explode(',', $key));
            $adj[$a][$b] = $w;
            $adj[$b][$a] = $w;
            $deg[$a] = ($deg[$a] ?? 0) + $w;
            $deg[$b] = ($deg[$b] ?? 0) + $w;
            $edges++;
        }
        if (count($adj) < 3 || $edges < 2) {
            return null;
        }

        $m = array_sum($deg) / 2.0;
        $rawComm = self::louvain($adj, $deg, $m);
        $relabel = [];
        $nextC = 0;
        $commOf = [];
        foreach ($rawComm as $node => $c) {
            if (!isset($relabel[$c])) {
                $relabel[$c] = $nextC++;
            }
            $commOf[$node] = $relabel[$c];
        }

        $pr = self::weightedPagerank($adj, $deg);
        $rankNodes = array_keys($adj);
        usort($rankNodes, static fn ($x, $y) => ($pr[$y] ?? 0) <=> ($pr[$x] ?? 0));
        $ranked = array_slice($rankNodes, 0, $maxNodes);
        $topSet = array_flip($ranked);

        $roleName = static function (int $mask): string {
            if ($mask === 3) {
                return 'both';
            }
            return $mask === 2 ? 'editor' : 'author';
        };

        $nodes = [];
        foreach ($ranked as $nd) {
            $node = [
                'name' => $idName[$nd], 'value' => $nodeCounts[$nd] ?? 0,
                'community' => $commOf[$nd] ?? 0, 'rank' => round($pr[$nd] ?? 0, 6),
                'matched' => $matched[$nd] ?? false, 'role' => $roleName($roleMask[$nd] ?? 1),
            ];
            if (!empty($matched[$nd]) && isset($personId[$nd])) {
                $node['itemId'] = $personId[$nd];
            }
            $nodes[] = $node;
        }

        $outLinks = [];
        foreach ($pairCounts as $key => $w) {
            if ($w < $minCooccurrence) {
                continue;
            }
            [$a, $b] = array_map('intval', explode(',', $key));
            if (isset($topSet[$a], $topSet[$b])) {
                // Dominant relationship across the publications this pair shares.
                $rels = $pairRel[$key] ?? [];
                arsort($rels);
                $relation = $rels ? (string) array_key_first($rels) : 'coauthor';
                $outLinks[] = ['source' => $idName[$a], 'target' => $idName[$b], 'value' => $w, 'relation' => $relation];
            }
        }

        $summary = [];
        foreach ($ranked as $nd) {
            $ci = $commOf[$nd] ?? 0;
            if (!isset($summary[$ci])) {
                $summary[$ci] = ['id' => $ci, 'size' => 0, 'anchor' => null, '_rank' => -1.0];
            }
            $summary[$ci]['size']++;
            if (($pr[$nd] ?? 0) > $summary[$ci]['_rank']) {
                $summary[$ci]['_rank'] = $pr[$nd] ?? 0;
                $summary[$ci]['anchor'] = $idName[$nd] ?? null;
            }
        }
        $communitiesList = [];
        foreach ($summary as $s) {
            $communitiesList[] = ['id' => $s['id'], 'size' => $s['size'], 'anchor' => $s['anchor']];
        }
        usort($communitiesList, static fn ($a, $b) => $b['size'] <=> $a['size']);

        return ['nodes' => $nodes, 'links' => $outLinks, 'communities' => $communitiesList];
    }
}
