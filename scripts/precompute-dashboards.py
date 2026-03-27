#!/usr/bin/env python3
"""
Pre-compute dashboard data for all entity types.

Uses `docker compose exec` to query MySQL — no port exposure needed.
Outputs JSON files to asset/data/item-dashboards/ (unified directory).

Supported entities:
  - Research Sections (frapo:ResearchGroup)
  - Projects (resource template 5)
  - People (resource template 4)
  - Institutions (foaf:Organization, excluding groups)
  - Locations (resource template 3, with geo coordinates)
  - Subjects (resource template 6)
  - Languages (item set 19)
  - Resource Types (item set 1)
  - Genres (item set 21)

Usage:
  python3 scripts/precompute-dashboards.py

Set OMEKA_DOCKER_DIR if the omeka-s-docker directory is elsewhere:
  OMEKA_DOCKER_DIR=/path/to/omeka-s-docker python3 scripts/precompute-dashboards.py
"""

import json
import os
import re
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODULE_DIR = os.path.dirname(SCRIPT_DIR)
OUTPUT_DIR = os.path.join(MODULE_DIR, 'asset', 'data', 'item-dashboards')

OMEKA_DIR = os.environ.get('OMEKA_DOCKER_DIR', os.path.join(os.path.dirname(MODULE_DIR), 'omeka-s-docker'))
DB_USER = os.environ.get('DB_USER', 'omeka')
DB_PASS = os.environ.get('DB_PASS', '')
DB_NAME = os.environ.get('DB_NAME', 'omeka')

# Resource template IDs (from Omeka S config).
TEMPLATE_PROJECTS = 5
TEMPLATE_PERSONS = 4
TEMPLATE_LOCATION = 3
TEMPLATE_AUTHORITY = 6


# ── MySQL helper ──────────────────────────────────────────────────────

def get_password():
    if DB_PASS:
        return DB_PASS
    env_file = os.path.join(OMEKA_DIR, '.env')
    if os.path.exists(env_file):
        with open(env_file) as f:
            for line in f:
                if line.startswith('MYSQL_PASSWORD='):
                    return line.strip().split('=', 1)[1]
    print('ERROR: Set DB_PASS or ensure MYSQL_PASSWORD is in .env')
    sys.exit(1)


def query_mysql(sql, password):
    cmd = [
        'docker', 'compose', 'exec', '-T', 'db',
        'mysql', f'-u{DB_USER}', f'-p{password}', DB_NAME,
        '--default-character-set=utf8mb4',
        '--batch', '--skip-column-names', '-e', sql,
    ]
    result = subprocess.run(cmd, capture_output=True, cwd=OMEKA_DIR)
    if result.returncode != 0:
        print(f'  MySQL error: {result.stderr.decode("utf-8", errors="replace").strip()}')
        return []
    stdout = result.stdout.decode('utf-8', errors='replace')
    return [tuple(line.split('\t')) for line in stdout.strip().split('\n') if line]


# ── Data loading ──────────────────────────────────────────────────────

def load_all_data(password):
    print('Loading items...')
    items = {}
    for row in query_mysql("""
        SELECT r.id, r.title, r.resource_template_id,
               CONCAT(v.prefix, ':', rc.local_name) as class_term,
               rc.label as class_label
        FROM resource r
        LEFT JOIN resource_class rc ON r.resource_class_id = rc.id
        LEFT JOIN vocabulary v ON rc.vocabulary_id = v.id
        WHERE r.resource_type = 'Omeka\\\\Entity\\\\Item'
    """, password):
        items[int(row[0])] = {
            'title': row[1] or f'Item {row[0]}',
            'template_id': int(row[2]) if row[2] and row[2] != 'NULL' else None,
            'class_term': row[3] if row[3] and row[3] != 'NULL' and ':' in row[3] else '',
            'class_label': row[4] if row[4] and row[4] != 'NULL' else '',
        }
    print(f'  {len(items)} items')

    print('Loading relationships...')
    links = {}          # resource_id -> [(term, label, value_resource_id)]
    reverse_links = {}  # value_resource_id -> {term -> [resource_id, ...]}
    children_of = {}    # parent_id -> [child_id, ...]
    for row in query_mysql("""
        SELECT v.resource_id, CONCAT(vo.prefix, ':', p.local_name), p.label, v.value_resource_id
        FROM value v
        JOIN property p ON v.property_id = p.id
        JOIN vocabulary vo ON p.vocabulary_id = vo.id
        WHERE v.value_resource_id IS NOT NULL
    """, password):
        rid, term, label, vrid = int(row[0]), row[1], row[2], int(row[3])
        links.setdefault(rid, []).append((term, label, vrid))
        if term == 'dcterms:isPartOf':
            children_of.setdefault(vrid, []).append(rid)
        # Build reverse index: for each target, which items link to it via which property.
        reverse_links.setdefault(vrid, {}).setdefault(term, []).append(rid)
    print(f'  {sum(len(v) for v in links.values())} links')

    print('Loading dates...')
    item_year = {}
    for row in query_mysql("""
        SELECT v.resource_id, v.value
        FROM value v
        JOIN property p ON v.property_id = p.id
        JOIN vocabulary vo ON p.vocabulary_id = vo.id
        WHERE CONCAT(vo.prefix, ':', p.local_name) IN
            ('dcterms:issued', 'dcterms:created', 'dcterms:date', 'fabio:hasDateCollected')
        AND v.value IS NOT NULL AND v.value != ''
    """, password):
        rid = int(row[0])
        if rid not in item_year:
            m = re.search(r'(\d{4})', row[1] or '')
            if m:
                item_year[rid] = m.group(1)
    print(f'  {len(item_year)} items with dates')

    print('Loading temporal intervals (for Gantt)...')
    temporal = {}  # item_id -> (start_date, end_date)
    for row in query_mysql("""
        SELECT v.resource_id, v.value
        FROM value v
        JOIN property p ON v.property_id = p.id
        JOIN vocabulary vo ON p.vocabulary_id = vo.id
        WHERE CONCAT(vo.prefix, ':', p.local_name) = 'dcterms:temporal'
        AND v.value IS NOT NULL AND v.value LIKE '%%/%%'
    """, password):
        rid = int(row[0])
        parts = row[1].split('/')
        if len(parts) == 2:
            temporal[rid] = (parts[0].strip(), parts[1].strip())
    print(f'  {len(temporal)} items with temporal intervals')

    print('Loading geo coordinates...')
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
    print(f'  {len(geo)} locations with coordinates')

    print('Loading item set memberships...')
    item_sets = {}  # item_id -> [item_set_id, ...]
    for row in query_mysql("""
        SELECT item_id, item_set_id FROM item_item_set
    """, password):
        iid, isid = int(row[0]), int(row[1])
        item_sets.setdefault(isid, []).append(iid)
    print(f'  {len(item_sets)} item sets')

    return items, links, reverse_links, children_of, item_year, temporal, geo, item_sets


# ── Shared aggregation ────────────────────────────────────────────────

def aggregate_items(item_ids, items, links, item_year, geo):
    """Aggregate dashboard data from a list of item IDs."""
    timeline = {}
    types = {}
    languages = {}
    subjects = {}
    contributors = {}
    locations = {}

    for iid in item_ids:
        year = item_year.get(iid)
        if year:
            timeline[year] = timeline.get(year, 0) + 1

        for term, label, vrid in links.get(iid, []):
            title = items.get(vrid, {}).get('title', '')
            if not title:
                continue

            if term == 'dcterms:type':
                if vrid not in types:
                    types[vrid] = {'name': title, 'value': 0, 'itemId': vrid}
                types[vrid]['value'] += 1
            elif term == 'dcterms:language':
                if vrid not in languages:
                    languages[vrid] = {'name': title, 'value': 0, 'itemId': vrid}
                languages[vrid]['value'] += 1
            elif term == 'dcterms:subject':
                if vrid not in subjects:
                    subjects[vrid] = {'name': title, 'value': 0, 'itemId': vrid}
                subjects[vrid]['value'] += 1
            elif term in ('dcterms:creator', 'dcterms:contributor') or term.startswith('marcrel:'):
                if vrid not in contributors:
                    contributors[vrid] = {'name': title, 'value': 0, 'itemId': vrid}
                contributors[vrid]['value'] += 1
            elif term == 'dcterms:spatial':
                if vrid in geo:
                    if vrid not in locations:
                        g = geo[vrid]
                        locations[vrid] = {
                            'name': g['name'], 'lat': g['lat'], 'lon': g['lon'],
                            'itemId': g['itemId'], 'value': 0, 'items': [],
                        }
                    locations[vrid]['value'] += 1
                    it_title = items.get(iid, {}).get('title', f'Item {iid}')
                    locations[vrid]['items'].append({'id': iid, 'title': it_title})

    return {
        'timeline': dict(sorted(timeline.items())),
        'types': sorted(types.values(), key=lambda x: -x['value']),
        'languages': sorted(languages.values(), key=lambda x: -x['value']),
        'subjects': sorted(subjects.values(), key=lambda x: -x['value'])[:60],
        'contributors': sorted(contributors.values(), key=lambda x: -x['value'])[:30],
        'locations': sorted(locations.values(), key=lambda x: -x['value']),
        'totalItems': len(item_ids),
    }


def build_heatmap(item_ids, links, items):
    """Build resource type x language heatmap data."""
    # For each item, get its type(s) and language(s), count co-occurrences.
    cross = {}  # (type_title, lang_title) -> count
    type_set = set()
    lang_set = set()

    for iid in item_ids:
        item_types = []
        item_langs = []
        for term, label, vrid in links.get(iid, []):
            title = items.get(vrid, {}).get('title', '')
            if not title:
                continue
            if term == 'dcterms:type':
                item_types.append(title)
                type_set.add(title)
            elif term == 'dcterms:language':
                item_langs.append(title)
                lang_set.add(title)

        for t in item_types:
            for l in item_langs:
                cross[(t, l)] = cross.get((t, l), 0) + 1

    if not cross:
        return None

    rows = sorted(type_set)
    cols = sorted(lang_set)
    row_idx = {r: i for i, r in enumerate(rows)}
    col_idx = {c: i for i, c in enumerate(cols)}
    values = [[col_idx[c], row_idx[r], v] for (r, c), v in cross.items()]

    return {'rows': rows, 'cols': cols, 'values': values}


def build_chord(item_ids, links, items, term_filter='dcterms:subject', max_nodes=20, min_cooccurrence=2):
    """Build a co-occurrence chord diagram for a given property."""
    from collections import Counter

    # For each item, collect values for the given term.
    item_values = {}  # item_id -> [vrid, ...]
    value_titles = {}  # vrid -> title

    for iid in item_ids:
        vals = []
        for term, label, vrid in links.get(iid, []):
            if term == term_filter:
                title = items.get(vrid, {}).get('title', '')
                if title:
                    vals.append(vrid)
                    value_titles[vrid] = title
        if len(vals) >= 2:
            item_values[iid] = vals

    # Count co-occurrences.
    pair_counts = Counter()
    node_counts = Counter()
    for vals in item_values.values():
        for v in vals:
            node_counts[v] += 1
        for i in range(len(vals)):
            for j in range(i + 1, len(vals)):
                pair = tuple(sorted([vals[i], vals[j]]))
                pair_counts[pair] += 1

    # Keep top nodes by frequency.
    top_nodes = [vrid for vrid, _ in node_counts.most_common(max_nodes)]
    top_set = set(top_nodes)

    # Filter links.
    chord_links = []
    for (a, b), count in pair_counts.items():
        if count >= min_cooccurrence and a in top_set and b in top_set:
            chord_links.append({
                'source': value_titles[a], 'target': value_titles[b], 'value': count,
            })

    if not chord_links:
        return None

    chord_nodes = [{'name': value_titles[v], 'value': node_counts[v], 'itemId': v} for v in top_nodes if v in value_titles]

    return {'nodes': chord_nodes, 'links': chord_links}


def save_json(item_id, data):
    path = os.path.join(OUTPUT_DIR, f'{item_id}.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))


def find_items_linking_to(entity_id, reverse_links, terms):
    """Find item IDs that link to entity_id via any of the given terms."""
    result = set()
    rev = reverse_links.get(entity_id, {})
    for term in terms:
        result.update(rev.get(term, []))
    return list(result)


# ── Entity generators ─────────────────────────────────────────────────

def generate_sections(items, links, reverse_links, children_of, item_year, temporal, geo):
    sections = [(iid, info) for iid, info in items.items()
                if info['class_term'] == 'frapo:ResearchGroup']
    print(f'\n=== Research Sections ({len(sections)}) ===')

    for sid, sinfo in sections:
        project_ids = children_of.get(sid, [])
        item_ids = []
        projects_breakdown = []
        gantt_data = []
        for pid in project_ids:
            proj_items = children_of.get(pid, [])
            item_ids.extend(proj_items)
            ptitle = items.get(pid, {}).get('title', f'Project {pid}')
            if proj_items:
                projects_breakdown.append({'name': ptitle, 'value': len(proj_items), 'itemId': pid})
            if pid in temporal:
                start, end = temporal[pid]
                gantt_data.append({'name': ptitle, 'start': start, 'end': end, 'itemId': pid})
        if not item_ids:
            continue
        dashboard = aggregate_items(item_ids, items, links, item_year, geo)
        projects_breakdown.sort(key=lambda x: -x['value'])
        dashboard['projects'] = projects_breakdown
        if gantt_data:
            gantt_data.sort(key=lambda x: x['start'])
            dashboard['gantt'] = gantt_data
        heatmap = build_heatmap(item_ids, links, items)
        if heatmap:
            dashboard['heatmap'] = heatmap
        chord = build_chord(item_ids, links, items)
        if chord:
            dashboard['chord'] = chord
        save_json(sid, dashboard)
        print(f'  {sinfo["title"]}: {len(item_ids)} items')


def generate_projects(items, links, reverse_links, children_of, item_year, geo):
    projects = [(iid, info) for iid, info in items.items()
                if info['template_id'] == TEMPLATE_PROJECTS]
    print(f'\n=== Projects ({len(projects)}) ===')
    count = 0
    for pid, pinfo in projects:
        item_ids = children_of.get(pid, [])
        if not item_ids:
            continue
        dashboard = aggregate_items(item_ids, items, links, item_year, geo)
        heatmap = build_heatmap(item_ids, links, items)
        if heatmap:
            dashboard['heatmap'] = heatmap
        chord = build_chord(item_ids, links, items)
        if chord:
            dashboard['chord'] = chord
        save_json(pid, dashboard)
        count += 1
    print(f'  {count} dashboards generated')


def generate_people(items, links, reverse_links, children_of, item_year, geo):
    people = [(iid, info) for iid, info in items.items()
              if info['template_id'] == TEMPLATE_PERSONS]
    print(f'\n=== People ({len(people)}) ===')

    # All marcrel + dcterms:creator/contributor terms for reverse lookup.
    person_terms = {'dcterms:creator', 'dcterms:contributor', 'foaf:member'}
    # Also collect all marcrel:* terms from data.
    all_terms_in_data = set()
    for rev_terms in reverse_links.values():
        for t in rev_terms:
            if t.startswith('marcrel:'):
                all_terms_in_data.add(t)
    person_terms.update(all_terms_in_data)

    count = 0
    for pid, pinfo in people:
        item_ids = find_items_linking_to(pid, reverse_links, person_terms)
        if not item_ids:
            continue
        dashboard = aggregate_items(item_ids, items, links, item_year, geo)

        # Co-authors: other persons appearing in the same items.
        coauthors = {}
        for iid in item_ids:
            for term, label, vrid in links.get(iid, []):
                if (term.startswith('marcrel:') or term in ('dcterms:creator', 'dcterms:contributor')) and vrid != pid:
                    if vrid not in coauthors and items.get(vrid, {}).get('template_id') == TEMPLATE_PERSONS:
                        coauthors[vrid] = {'name': items[vrid]['title'], 'value': 0, 'itemId': vrid}
                    if vrid in coauthors:
                        coauthors[vrid]['value'] += 1
        dashboard['coAuthors'] = sorted(coauthors.values(), key=lambda x: -x['value'])[:20]
        save_json(pid, dashboard)
        count += 1
    print(f'  {count} dashboards generated')


def generate_institutions(items, links, reverse_links, children_of, item_year, geo):
    institutions = [(iid, info) for iid, info in items.items()
                    if info['class_term'] == 'foaf:Organization']
    print(f'\n=== Institutions ({len(institutions)}) ===')

    inst_terms = {'frapo:isFundedBy', 'dcterms:provenance'}
    # Also marcrel properties (institutions can be publishers etc.)
    all_marcrel = {t for rev in reverse_links.values() for t in rev if t.startswith('marcrel:')}
    inst_terms.update(all_marcrel)

    count = 0
    for iid, iinfo in institutions:
        item_ids = find_items_linking_to(iid, reverse_links, inst_terms)
        if not item_ids:
            continue
        dashboard = aggregate_items(item_ids, items, links, item_year, geo)
        save_json(iid, dashboard)
        count += 1
    print(f'  {count} dashboards generated')


def generate_locations(items, links, reverse_links, children_of, item_year, geo):
    locs = [(iid, info) for iid, info in items.items()
            if info['template_id'] == TEMPLATE_LOCATION]
    print(f'\n=== Locations ({len(locs)}) ===')

    count = 0
    for lid, linfo in locs:
        item_ids = find_items_linking_to(lid, reverse_links, {'dcterms:spatial', 'dcterms:provenance'})
        if not item_ids:
            continue
        dashboard = aggregate_items(item_ids, items, links, item_year, geo)
        # Add self-location for minimap.
        if lid in geo:
            g = geo[lid]
            dashboard['selfLocation'] = {'name': g['name'], 'lat': g['lat'], 'lon': g['lon'], 'itemId': lid}
        save_json(lid, dashboard)
        count += 1
    print(f'  {count} dashboards generated')


def generate_subjects(items, links, reverse_links, children_of, item_year, geo):
    subjects = [(iid, info) for iid, info in items.items()
                if info['template_id'] == TEMPLATE_AUTHORITY]
    print(f'\n=== Subjects/Authority ({len(subjects)}) ===')

    count = 0
    for sid, sinfo in subjects:
        item_ids = find_items_linking_to(sid, reverse_links, {'dcterms:subject'})
        if not item_ids:
            continue
        dashboard = aggregate_items(item_ids, items, links, item_year, geo)

        # Co-occurring subjects: other subjects appearing in the same items.
        cosubs = {}
        for iid in item_ids:
            for term, label, vrid in links.get(iid, []):
                if term == 'dcterms:subject' and vrid != sid:
                    if vrid not in cosubs:
                        cosubs[vrid] = {'name': items.get(vrid, {}).get('title', ''), 'value': 0, 'itemId': vrid}
                    cosubs[vrid]['value'] += 1
        dashboard['coSubjects'] = sorted(cosubs.values(), key=lambda x: -x['value'])[:30]
        save_json(sid, dashboard)
        count += 1
    print(f'  {count} dashboards generated')


def generate_by_item_set(items, links, reverse_links, item_year, geo, item_sets, set_id, term, label):
    """Generate dashboards for items in a specific item set, using reverse links."""
    set_items = item_sets.get(set_id, [])
    print(f'\n=== {label} (item set {set_id}, {len(set_items)} items) ===')

    count = 0
    for eid in set_items:
        item_ids = find_items_linking_to(eid, reverse_links, {term})
        if not item_ids:
            continue
        dashboard = aggregate_items(item_ids, items, links, item_year, geo)
        save_json(eid, dashboard)
        count += 1
    print(f'  {count} dashboards generated')


# ── Main ──────────────────────────────────────────────────────────────

def main():
    password = get_password()
    os.chdir(OMEKA_DIR)

    data = load_all_data(password)
    items, links, reverse_links, children_of, item_year, temporal, geo, item_sets = data

    # Clean output directory.
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    generate_sections(items, links, reverse_links, children_of, item_year, temporal, geo)
    generate_projects(items, links, reverse_links, children_of, item_year, geo)
    generate_people(items, links, reverse_links, children_of, item_year, geo)
    generate_institutions(items, links, reverse_links, children_of, item_year, geo)
    generate_locations(items, links, reverse_links, children_of, item_year, geo)
    generate_subjects(items, links, reverse_links, children_of, item_year, geo)
    generate_by_item_set(items, links, reverse_links, item_year, geo, item_sets,
                         set_id=1, term='dcterms:type', label='Resource Types')
    generate_by_item_set(items, links, reverse_links, item_year, geo, item_sets,
                         set_id=19, term='dcterms:language', label='Languages')
    generate_by_item_set(items, links, reverse_links, item_year, geo, item_sets,
                         set_id=21, term='dcterms:format', label='Genres')

    print(f'\nDone. Files in {OUTPUT_DIR}/')


if __name__ == '__main__':
    main()
