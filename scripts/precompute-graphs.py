#!/usr/bin/env python3
"""
Pre-compute knowledge graph JSON files for all Omeka S items.

Uses `docker compose exec` to query MySQL — no port exposure needed.

Usage:
  python3 scripts/precompute-graphs.py

Set OMEKA_DOCKER_DIR if the omeka-s-docker directory is elsewhere:
  OMEKA_DOCKER_DIR=/path/to/omeka-s-docker python3 scripts/precompute-graphs.py
"""

import json
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODULE_DIR = os.path.dirname(SCRIPT_DIR)
OUTPUT_DIR = os.path.join(MODULE_DIR, 'asset', 'data', 'knowledge-graphs')

sys.path.insert(0, SCRIPT_DIR)
from precompute.db import get_password, query_mysql  # noqa: E402

# Properties to include as graph nodes.
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


def load_data(password):
    print('  Loading items...')
    items = {}
    for row in query_mysql("""
        SELECT r.id, r.title, rc.label, CONCAT(v.prefix, ':', rc.local_name)
        FROM resource r
        LEFT JOIN resource_class rc ON r.resource_class_id = rc.id
        LEFT JOIN vocabulary v ON rc.vocabulary_id = v.id
        WHERE r.resource_type = 'Omeka\\\\Entity\\\\Item'
    """, password):
        items[int(row[0])] = {
            'title': row[1] or f'Item {row[0]}',
            'class_label': row[2] if row[2] != 'NULL' and row[2] else 'Item',
            'class_term': row[3] if row[3] != 'NULL' and row[3] and ':' in row[3] else '',
        }
    print(f'    {len(items)} items')

    print('  Loading relationships...')
    links = {}
    reverse = {}       # for shared-item discovery (shareable terms only)
    all_reverse = {}   # ALL reverse links: target_id -> set of source_ids
    for row in query_mysql("""
        SELECT v.resource_id, CONCAT(vo.prefix, ':', p.local_name), p.label, v.value_resource_id
        FROM value v
        JOIN property p ON v.property_id = p.id
        JOIN vocabulary vo ON p.vocabulary_id = vo.id
        WHERE v.value_resource_id IS NOT NULL
    """, password):
        rid, term, label, vrid = int(row[0]), row[1], row[2], int(row[3])
        links.setdefault(rid, []).append((term, label, vrid))
        all_reverse.setdefault(vrid, set()).add(rid)
        if term in SHAREABLE or term.startswith('marcrel:'):
            reverse.setdefault(vrid, set()).add(rid)
    print(f'    {sum(len(v) for v in links.values())} links, {len(all_reverse)} reverse entries')

    print('  Loading geo coordinates...')
    geo = {}
    for row in query_mysql("""
        SELECT r.id, r.title,
               MAX(CASE WHEN CONCAT(vo.prefix, ':', p.local_name) = 'geo:lat' THEN v.value END) AS lat,
               MAX(CASE WHEN CONCAT(vo.prefix, ':', p.local_name) = 'geo:long' THEN v.value END) AS lon
        FROM resource r
        JOIN value v ON v.resource_id = r.id
        JOIN property p ON v.property_id = p.id
        JOIN vocabulary vo ON p.vocabulary_id = vo.id
        WHERE CONCAT(vo.prefix, ':', p.local_name) IN ('geo:lat', 'geo:long')
        GROUP BY r.id
        HAVING lat IS NOT NULL AND lon IS NOT NULL
    """, password):
        try:
            geo[int(row[0])] = {
                'name': row[1] or f'Location {row[0]}',
                'lat': float(row[2]), 'lon': float(row[3]),
                'itemId': int(row[0]),
            }
        except (ValueError, TypeError):
            pass
    print(f'    {len(geo)} locations with coordinates')

    return items, links, reverse, all_reverse, geo


MAX_DIRECT_NODES = 150
MAX_REVERSE_NODES = 25
MAX_SHARED_NODES = 30

# Priority order for direct relationships when capping.
CAT_PRIORITY = ['Person', 'Contributor', 'Subject', 'Project', 'Location', 'Institution', 'Genre', 'Related Item']


MAX_REVERSE_ITEMS = 40  # For entities like subjects/languages: max items shown linking to them


def build_item_map(item_id, links, geo):
    """Extract origin (dcterms:spatial) and current (dcterms:provenance) locations with coordinates."""
    origins = []
    current = []
    seen = set()
    for term, label, vrid in links.get(item_id, []):
        if term not in ('dcterms:spatial', 'dcterms:provenance'):
            continue
        if vrid in seen or vrid not in geo:
            continue
        seen.add(vrid)
        loc = geo[vrid]
        entry = {'name': loc['name'], 'lat': loc['lat'], 'lon': loc['lon'], 'itemId': loc['itemId']}
        if term == 'dcterms:spatial':
            origins.append(entry)
        else:
            current.append(entry)
    if not origins and not current:
        return None
    return {'origins': origins, 'current': current}


def build_graph(item_id, items, links, reverse, all_reverse=None):
    if item_id not in items:
        return None

    item = items[item_id]
    center_cat = item['class_label']

    nodes, edges = [], []
    categories = [{'name': center_cat}]
    cat_map = {center_cat: 0}
    seen = set()
    center_linked = {}

    def ensure_cat(name):
        if name not in cat_map:
            cat_map[name] = len(categories)
            categories.append({'name': name})
        return cat_map[name]

    nodes.append({'id': f'item_{item_id}', 'name': item['title'], 'category': 0,
                  'symbolSize': 45, 'isCenter': True, 'itemId': item_id})

    # Collect and prioritize direct relationships.
    direct_rels = []  # (priority, term, label, vrid, cat)
    for term, label, vrid in links.get(item_id, []):
        cat = get_category(term)
        if not cat:
            continue
        pri = CAT_PRIORITY.index(cat) if cat in CAT_PRIORITY else len(CAT_PRIORITY)
        direct_rels.append((pri, term, label, vrid, cat))

    direct_rels.sort(key=lambda x: x[0])

    direct_count = 0
    for pri, term, label, vrid, cat in direct_rels:
        nid = f'resource_{vrid}'
        if nid not in seen:
            if direct_count >= MAX_DIRECT_NODES:
                continue
            seen.add(nid)
            nodes.append({'id': nid, 'name': items.get(vrid, {}).get('title', f'Resource {vrid}'),
                          'category': ensure_cat(cat), 'symbolSize': 22, 'itemId': vrid})
            direct_count += 1
        edges.append({'source': f'item_{item_id}', 'target': nid, 'name': label})
        if term in SHAREABLE or term.startswith('marcrel:'):
            center_linked[vrid] = nid

    # Reverse lookups (items linking TO this one).
    is_section = item['class_term'] == 'frapo:ResearchGroup'
    reverse_count = 0
    for rid, rels in links.items():
        if rid == item_id or reverse_count >= MAX_REVERSE_NODES:
            continue
        for term, label, vrid in rels:
            if term == 'dcterms:isPartOf' and vrid == item_id:
                rnid = f'item_{rid}'
                if rnid not in seen:
                    seen.add(rnid)
                    nodes.append({'id': rnid, 'name': items.get(rid, {}).get('title', f'Item {rid}'),
                                  'category': ensure_cat('Project' if is_section else 'Linked Item'),
                                  'symbolSize': 22, 'itemId': rid})
                    reverse_count += 1
                edges.append({'source': rnid, 'target': f'item_{item_id}', 'name': 'Is Part Of'})

    # For items with very few direct relationships (subjects, languages, locations, etc.),
    # build graph from ALL items that reference this entity.
    if all_reverse and direct_count < 5:
        referencing_ids = all_reverse.get(item_id, set())
        ref_cat_idx = ensure_cat('Research Item')
        ref_count = 0
        for rid in referencing_ids:
            if ref_count >= MAX_REVERSE_ITEMS:
                break
            rnid = f'item_{rid}'
            if rnid in seen:
                continue
            seen.add(rnid)
            ref_title = items.get(rid, {}).get('title', f'Item {rid}')
            nodes.append({'id': rnid, 'name': ref_title, 'category': ref_cat_idx,
                          'symbolSize': 16, 'itemId': rid})
            edges.append({'source': rnid, 'target': f'item_{item_id}', 'name': 'references'})
            ref_count += 1

    # Shared items — other items sharing the same resources.
    shared_count = 0
    si_cat = None
    for vrid, nid in center_linked.items():
        if shared_count >= MAX_SHARED_NODES:
            break
        for sid in reverse.get(vrid, set()):
            if sid == item_id or shared_count >= MAX_SHARED_NODES:
                continue
            snid = f'item_{sid}'
            matched = []
            for st, sl, sv in links.get(sid, []):
                if sv in center_linked:
                    ek = f'{snid}>{center_linked[sv]}'
                    if not any(e.get('_key') == ek for e in matched):
                        matched.append({'_key': ek, 'source': snid, 'target': center_linked[sv],
                                        'name': sl, 'isShared': True})
            if not matched:
                continue
            if snid not in seen:
                seen.add(snid)
                if si_cat is None:
                    si_cat = ensure_cat('Shared Item')
                nodes.append({'id': snid, 'name': items.get(sid, {}).get('title', f'Item {sid}'),
                              'category': si_cat, 'symbolSize': 16, 'itemId': sid})
                shared_count += 1
            for m in matched:
                edges.append({'source': m['source'], 'target': m['target'], 'name': m['name'], 'isShared': True})

    return {'nodes': nodes, 'edges': edges, 'categories': categories} if len(nodes) > 1 else None


def main():
    password = get_password()
    print(f'Loading data via docker compose exec...')
    items, links, reverse, all_reverse, geo = load_data(password)

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    print(f'Generating graphs to {OUTPUT_DIR}/')

    generated = skipped = map_count = 0
    for item_id in items:
        graph = build_graph(item_id, items, links, reverse, all_reverse)
        if not graph:
            skipped += 1
            continue
        # Embed location map data when the item has spatial/provenance links.
        item_map = build_item_map(item_id, links, geo)
        if item_map:
            graph['itemMap'] = item_map
            map_count += 1
        with open(os.path.join(OUTPUT_DIR, f'{item_id}.json'), 'w', encoding='utf-8') as f:
            json.dump(graph, f, ensure_ascii=False, separators=(',', ':'))
        generated += 1
        if generated % 500 == 0:
            print(f'  {generated} graphs...')

    print(f'Done. {generated} generated ({map_count} with location maps), {skipped} skipped.')


if __name__ == '__main__':
    main()
