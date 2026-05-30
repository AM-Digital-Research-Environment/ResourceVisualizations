<?php
declare(strict_types=1);

namespace ResourceVisualizations\Precompute;

use Doctrine\DBAL\Connection;

/**
 * Loads all data needed by the precompute into memory — a PHP port of
 * scripts/precompute/db.py load_all_data(), but using Omeka's own DBAL
 * connection (so it reuses Omeka's configured MySQL credentials; no separate
 * variables, no `docker compose exec`).
 *
 * Returns the structures the dashboards need:
 *   items, links, reverseLinks, childrenOf, itemYear, temporal, geo, itemSets,
 *   plus templateLabels (resource-template id => label) and literals
 *   (bibliographic literal values keyed by item then term) for the Publications
 *   suite.
 */
final class DataLoader
{
    public function __construct(private readonly Connection $connection)
    {
    }

    private function query(string $sql, array $params = []): array
    {
        return $this->connection->executeQuery($sql, $params)->fetchAllNumeric();
    }

    /** @return array{items:array,links:array,reverseLinks:array,childrenOf:array,itemYear:array,temporal:array,geo:array,itemSets:array,templateLabels:array,literals:array} */
    public function load(?callable $log = null): array
    {
        $log ??= static function (string $m): void {};

        $log('Loading items…');
        $items = [];
        $rows = $this->query(
            'SELECT r.id, r.title, r.resource_template_id,'
            . " CONCAT(v.prefix, ':', rc.local_name) AS class_term, rc.label AS class_label, r.created"
            . ' FROM resource r'
            . ' LEFT JOIN resource_class rc ON r.resource_class_id = rc.id'
            . ' LEFT JOIN vocabulary v ON rc.vocabulary_id = v.id'
            . ' WHERE r.resource_type = ?',
            ['Omeka\\Entity\\Item']
        );
        foreach ($rows as $r) {
            $id = (int) $r[0];
            $classTerm = ($r[3] !== null && str_contains((string) $r[3], ':')) ? (string) $r[3] : '';
            $items[$id] = [
                'title' => ($r[1] !== null && $r[1] !== '') ? (string) $r[1] : ('Item ' . $id),
                'template_id' => $r[2] !== null ? (int) $r[2] : null,
                'class_term' => $classTerm,
                'class_label' => $r[4] !== null ? (string) $r[4] : '',
                'created' => ($r[5] !== null && $r[5] !== '') ? substr((string) $r[5], 0, 10) : '',
            ];
        }
        $log('  ' . count($items) . ' items');

        $log('Loading relationships…');
        $links = [];
        $reverseLinks = [];
        $childrenOf = [];
        $rows = $this->query(
            "SELECT v.resource_id, CONCAT(vo.prefix, ':', p.local_name), p.label, v.value_resource_id"
            . ' FROM value v'
            . ' JOIN property p ON v.property_id = p.id'
            . ' JOIN vocabulary vo ON p.vocabulary_id = vo.id'
            . ' WHERE v.value_resource_id IS NOT NULL'
        );
        $linkCount = 0;
        foreach ($rows as $r) {
            $rid = (int) $r[0];
            $term = (string) $r[1];
            $label = $r[2] !== null ? (string) $r[2] : '';
            $vrid = (int) $r[3];
            $links[$rid][] = [$term, $label, $vrid];
            if ($term === 'dcterms:isPartOf') {
                $childrenOf[$vrid][] = $rid;
            }
            $reverseLinks[$vrid][$term][] = $rid;
            $linkCount++;
        }
        $log('  ' . $linkCount . ' links');

        $log('Loading dates…');
        $itemYear = [];
        $rows = $this->query(
            'SELECT v.resource_id, v.value'
            . ' FROM value v'
            . ' JOIN property p ON v.property_id = p.id'
            . ' JOIN vocabulary vo ON p.vocabulary_id = vo.id'
            . " WHERE CONCAT(vo.prefix, ':', p.local_name) IN"
            . "   ('dcterms:issued', 'dcterms:created', 'dcterms:date', 'fabio:hasDateCollected')"
            . " AND v.value IS NOT NULL AND v.value != ''"
        );
        foreach ($rows as $r) {
            $rid = (int) $r[0];
            if (!isset($itemYear[$rid]) && preg_match('/(\d{4})/', (string) $r[1], $m)) {
                $itemYear[$rid] = $m[1];
            }
        }
        $log('  ' . count($itemYear) . ' items with dates');

        $log('Loading temporal intervals…');
        $temporal = [];
        $rows = $this->query(
            'SELECT v.resource_id, v.value'
            . ' FROM value v'
            . ' JOIN property p ON v.property_id = p.id'
            . ' JOIN vocabulary vo ON p.vocabulary_id = vo.id'
            . " WHERE CONCAT(vo.prefix, ':', p.local_name) = 'dcterms:temporal'"
            . " AND v.value IS NOT NULL AND v.value LIKE '%/%'"
        );
        foreach ($rows as $r) {
            $parts = explode('/', (string) $r[1]);
            if (count($parts) === 2) {
                $temporal[(int) $r[0]] = [trim($parts[0]), trim($parts[1])];
            }
        }
        $log('  ' . count($temporal) . ' items with temporal intervals');

        $log('Loading geo coordinates…');
        $geo = [];
        $rows = $this->query(
            'SELECT r.id, r.title,'
            . " MAX(CASE WHEN CONCAT(vo.prefix, ':', p.local_name) = 'geo:lat' THEN v.value END) AS lat,"
            . " MAX(CASE WHEN CONCAT(vo.prefix, ':', p.local_name) = 'geo:long' THEN v.value END) AS lon"
            . ' FROM resource r'
            . ' JOIN value v ON v.resource_id = r.id'
            . ' JOIN property p ON v.property_id = p.id'
            . ' JOIN vocabulary vo ON p.vocabulary_id = vo.id'
            . " WHERE CONCAT(vo.prefix, ':', p.local_name) IN ('geo:lat', 'geo:long')"
            . ' GROUP BY r.id'
            . ' HAVING lat IS NOT NULL AND lon IS NOT NULL'
        );
        foreach ($rows as $r) {
            if ($r[2] === null || $r[3] === null || !is_numeric($r[2]) || !is_numeric($r[3])) {
                continue;
            }
            $id = (int) $r[0];
            $geo[$id] = [
                'name' => ($r[1] !== null && $r[1] !== '') ? (string) $r[1] : ('Location ' . $id),
                'lat' => (float) $r[2],
                'lon' => (float) $r[3],
                'itemId' => $id,
            ];
        }
        $log('  ' . count($geo) . ' locations with coordinates');

        $log('Loading item set memberships…');
        $itemSets = [];
        $rows = $this->query('SELECT item_id, item_set_id FROM item_item_set');
        foreach ($rows as $r) {
            $itemSets[(int) $r[1]][] = (int) $r[0];
        }
        $log('  ' . count($itemSets) . ' item sets');

        $log('Loading resource template labels…');
        $templateLabels = [];
        $rows = $this->query('SELECT id, label FROM resource_template');
        foreach ($rows as $r) {
            $templateLabels[(int) $r[0]] = ($r[1] !== null && $r[1] !== '') ? (string) $r[1] : ('Template ' . (int) $r[0]);
        }
        $log('  ' . count($templateLabels) . ' templates');

        $log('Loading bibliographic literals…');
        $literals = [];
        $rows = $this->query(
            "SELECT v.resource_id, CONCAT(vo.prefix, ':', p.local_name), v.value"
            . ' FROM value v'
            . ' JOIN property p ON v.property_id = p.id'
            . ' JOIN vocabulary vo ON p.vocabulary_id = vo.id'
            . " WHERE CONCAT(vo.prefix, ':', p.local_name) IN"
            . "   ('bibo:authorList', 'bibo:editorList', 'dcterms:isPartOf', 'dcterms:publisher')"
            . " AND v.value_resource_id IS NULL AND v.value IS NOT NULL AND v.value != ''"
        );
        foreach ($rows as $r) {
            $literals[(int) $r[0]][(string) $r[1]][] = (string) $r[2];
        }
        $log('  ' . count($literals) . ' items with bibliographic literals');

        return [
            'items' => $items,
            'links' => $links,
            'reverseLinks' => $reverseLinks,
            'childrenOf' => $childrenOf,
            'itemYear' => $itemYear,
            'temporal' => $temporal,
            'geo' => $geo,
            'itemSets' => $itemSets,
            'templateLabels' => $templateLabels,
            'literals' => $literals,
        ];
    }
}
