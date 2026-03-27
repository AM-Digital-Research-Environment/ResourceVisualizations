#!/usr/bin/env python3
"""
Pre-compute knowledge graph JSON files for all Omeka S items.

Connects directly to MySQL — no Omeka S API, no PHP.
Generates one JSON file per item in the output directory.

Usage (from omeka-s-docker directory):
  docker compose run --rm -v $(pwd)/files:/output python:3.12-slim \
    bash -c "pip install pymysql && python3 /script.py"

Or mount this script and run it however you like, as long as
it can reach the MySQL container on host 'db' port 3306.
"""

import json
import os
import sys
import pymysql

# ── Config ────────────────────────────────────────────────────────────

DB_HOST = os.environ.get('DB_HOST', 'db')
DB_USER = os.environ.get('DB_USER', 'omeka')
DB_PASS = os.environ.get('DB_PASS', 'omeka')
DB_NAME = os.environ.get('DB_NAME', 'omeka')
OUTPUT_DIR = os.environ.get('OUTPUT_DIR', os.path.join(os.path.dirname(__file__), '..', 'asset', 'data', 'knowledge-graphs'))

# Properties to include as graph nodes (prefix:localName -> category).
PROP_CAT = {
    'dcterms:creator': 'Person', 'dcterms:contributor': 'Person', 'foaf:member': 'Person',
    'dcterms:subject': 'Subject',
    'dcterms:spatial': 'Location', 'dcterms:provenance': 'Location',
    'dcterms:isPartOf': 'Project',
    'dcterms:format': 'Genre',
    'frapo:isFundedBy': 'Institution',
    'dcterms:relation': 'Related Item', 'dcterms:hasPart': 'Related Item',
    'dcterms:replaces': 'Related Item', 'dcterms:isReplacedBy': 'Related Item',
    'dcterms:hasVersion': 'Related Item', 'dcterms:isVersionOf': 'Related Item',
    'dcterms:hasFormat': 'Related Item',
}

# Properties used to discover shared items.
SHAREABLE = {
    'dcterms:subject', 'dcterms:isPartOf', 'dcterms:spatial',
    'dcterms:creator', 'dcterms:contributor',
}


def get_category(term):
    if term in PROP_CAT:
        return PROP_CAT[term]
    if term.startswith('marcrel:'):
        return 'Contributor'
    return None


# ── Load all data from MySQL ──────────────────────────────────────────

def load_data(conn):
    cur = conn.cursor()

    # All items: id, title, resource_class label
    print('  Loading items...')
    cur.execute("""
        SELECT r.id, r.title, rc.label as class_label, rc.local_name as class_local_name,
               v2.prefix as class_prefix
        FROM resource r
        LEFT JOIN resource_class rc ON r.resource_class_id = rc.id
        LEFT JOIN vocabulary v2 ON rc.vocabulary_id = v2.id
        WHERE r.resource_type = 'Omeka\\\\Entity\\\\Item'
    """)
    items = {}
    for row in cur.fetchall():
        items[row[0]] = {
            'title': row[1] or f'Item {row[0]}',
            'class_label': row[2] or 'Item',
            'class_term': f"{row[4]}:{row[3]}" if row[3] and row[4] else '',
        }
    print(f'    {len(items)} items')

    # All resource-linked values: resource_id, property term, value_resource_id, property label
    print('  Loading relationships...')
    cur.execute("""
        SELECT v.resource_id,
               CONCAT(vo.prefix, ':', p.local_name) as term,
               p.label as prop_label,
               v.value_resource_id
        FROM value v
        JOIN property p ON v.property_id = p.id
        JOIN vocabulary vo ON p.vocabulary_id = vo.id
        WHERE v.value_resource_id IS NOT NULL
    """)
    # Group by resource_id
    links = {}  # resource_id -> [(term, prop_label, value_resource_id), ...]
    count = 0
    for row in cur.fetchall():
        rid, term, label, vrid = row
        if rid not in links:
            links[rid] = []
        links[rid].append((term, label, vrid))
        count += 1
    print(f'    {count} relationships')

    # Build reverse index: value_resource_id -> [resource_id, ...] (for shared items)
    print('  Building reverse index...')
    reverse = {}  # value_resource_id -> set of resource_ids
    for rid, rels in links.items():
        for term, _, vrid in rels:
            if term in SHAREABLE or term.startswith('marcrel:'):
                if vrid not in reverse:
                    reverse[vrid] = set()
                reverse[vrid].add(rid)
    print(f'    {len(reverse)} shared resource entries')

    cur.close()
    return items, links, reverse


# ── Build graph for one item ──────────────────────────────────────────

def build_graph(item_id, items, links, reverse):
    if item_id not in items:
        return None

    item = items[item_id]
    center_cat = item['class_label']

    nodes = []
    edges = []
    categories = [{'name': center_cat}]
    cat_map = {center_cat: 0}
    seen = set()

    def ensure_cat(name):
        if name not in cat_map:
            cat_map[name] = len(categories)
            categories.append({'name': name})
        return cat_map[name]

    # Center node.
    nodes.append({
        'id': f'item_{item_id}',
        'name': item['title'],
        'category': 0,
        'symbolSize': 45,
        'isCenter': True,
        'itemId': item_id,
    })

    # Direct relationships.
    center_linked = {}  # value_resource_id -> node_id
    item_links = links.get(item_id, [])

    for term, label, vrid in item_links:
        cat = get_category(term)
        if not cat:
            continue

        cat_idx = ensure_cat(cat)
        nid = f'resource_{vrid}'

        if nid not in seen:
            seen.add(nid)
            linked_item = items.get(vrid)
            name = linked_item['title'] if linked_item else f'Resource {vrid}'
            nodes.append({
                'id': nid, 'name': name, 'category': cat_idx,
                'symbolSize': 22, 'itemId': vrid,
            })

        edges.append({'source': f'item_{item_id}', 'target': nid, 'name': label})

        if term in SHAREABLE or term.startswith('marcrel:'):
            center_linked[vrid] = nid

    # Reverse lookups (items linking TO this one via dcterms:isPartOf).
    is_section = item['class_term'] == 'frapo:ResearchGroup'
    reverse_found = False
    for rid, rels in links.items():
        if rid == item_id:
            continue
        for term, label, vrid in rels:
            if term == 'dcterms:isPartOf' and vrid == item_id:
                rnid = f'item_{rid}'
                if rnid not in seen:
                    seen.add(rnid)
                    rev_cat = ensure_cat('Project' if is_section else 'Linked Item')
                    ri = items.get(rid)
                    nodes.append({
                        'id': rnid, 'name': ri['title'] if ri else f'Item {rid}',
                        'category': rev_cat, 'symbolSize': 22, 'itemId': rid,
                    })
                edges.append({'source': rnid, 'target': f'item_{item_id}', 'name': 'Is Part Of'})
                reverse_found = True

    # Shared items: other items linking to the same resources.
    shared_count = 0
    max_shared = 30
    si_cat_idx = None

    for vrid, nid in center_linked.items():
        if shared_count >= max_shared:
            break
        sharing_items = reverse.get(vrid, set())
        for sid in sharing_items:
            if sid == item_id or shared_count >= max_shared:
                continue
            snid = f'item_{sid}'

            # Find ALL connections this shared item has to center's resources.
            matched_edges = []
            shared_links = links.get(sid, [])
            for st, sl, sv in shared_links:
                if sv in center_linked:
                    ek = f'{snid}>{center_linked[sv]}'
                    if not any(e.get('_key') == ek for e in matched_edges):
                        matched_edges.append({
                            '_key': ek,
                            'source': snid,
                            'target': center_linked[sv],
                            'name': sl,
                            'isShared': True,
                        })

            if not matched_edges:
                continue

            if snid not in seen:
                seen.add(snid)
                if si_cat_idx is None:
                    si_cat_idx = ensure_cat('Shared Item')
                si = items.get(sid)
                nodes.append({
                    'id': snid, 'name': si['title'] if si else f'Item {sid}',
                    'category': si_cat_idx, 'symbolSize': 16, 'itemId': sid,
                })
                shared_count += 1

            for me in matched_edges:
                edges.append({
                    'source': me['source'], 'target': me['target'],
                    'name': me['name'], 'isShared': True,
                })

    if len(nodes) <= 1:
        return None

    return {'nodes': nodes, 'edges': edges, 'categories': categories}


# ── Main ──────────────────────────────────────────────────────────────

def main():
    print(f'Connecting to MySQL {DB_HOST}...')
    conn = pymysql.connect(host=DB_HOST, user=DB_USER, password=DB_PASS, database=DB_NAME)

    print('Loading data from database...')
    items, links, reverse = load_data(conn)
    conn.close()

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    print(f'Generating graphs to {OUTPUT_DIR}/ ...')
    generated = 0
    skipped = 0

    for item_id in items:
        graph = build_graph(item_id, items, links, reverse)
        if graph is None:
            skipped += 1
            continue

        path = os.path.join(OUTPUT_DIR, f'{item_id}.json')
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(graph, f, ensure_ascii=False, separators=(',', ':'))

        generated += 1
        if generated % 500 == 0:
            print(f'  {generated} graphs generated...')

    print(f'Done. {generated} graphs generated, {skipped} items skipped.')


if __name__ == '__main__':
    main()
