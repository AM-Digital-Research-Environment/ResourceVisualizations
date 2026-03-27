#!/usr/bin/env python3
"""
Pre-compute dashboard data for research sections and projects.

Uses `docker compose exec` to query MySQL — no port exposure needed.
Outputs JSON files to the module's asset directory.

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
OUTPUT_BASE = os.path.join(MODULE_DIR, 'asset', 'data')

OMEKA_DIR = os.environ.get('OMEKA_DOCKER_DIR', os.path.join(os.path.dirname(MODULE_DIR), 'omeka-s-docker'))
DB_USER = os.environ.get('DB_USER', 'omeka')
DB_PASS = os.environ.get('DB_PASS', '')
DB_NAME = os.environ.get('DB_NAME', 'omeka')


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
               CONCAT(v.prefix, ':', rc.local_name) as class_term
        FROM resource r
        LEFT JOIN resource_class rc ON r.resource_class_id = rc.id
        LEFT JOIN vocabulary v ON rc.vocabulary_id = v.id
        WHERE r.resource_type = 'Omeka\\\\Entity\\\\Item'
    """, password):
        items[int(row[0])] = {
            'title': row[1] or f'Item {row[0]}',
            'template_id': int(row[2]) if row[2] and row[2] != 'NULL' else None,
            'class_term': row[3] if row[3] and row[3] != 'NULL' and ':' in row[3] else '',
        }
    print(f'  {len(items)} items')

    print('Loading relationships...')
    links = {}
    children_of = {}  # parent_id -> [child_id, ...]
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

    print('Loading geo coordinates...')
    geo = {}  # location_item_id -> {name, lat, lon}
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
                'lat': float(row[2]),
                'lon': float(row[3]),
                'itemId': int(row[0]),
            }
        except (ValueError, TypeError):
            pass
    print(f'  {len(geo)} locations with coordinates')

    return items, links, children_of, item_year, geo


# ── Shared aggregation ────────────────────────────────────────────────

def aggregate_items(item_ids, items, links, item_year, geo):
    """Aggregate dashboard data from a list of item IDs."""
    timeline = {}
    types = {}
    languages = {}
    subjects = {}
    contributors = {}
    locations = {}  # location_id -> {name, lat, lon, itemId, value, items}

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
                    item_title = items.get(iid, {}).get('title', f'Item {iid}')
                    locations[vrid]['items'].append({'id': iid, 'title': item_title})

    return {
        'timeline': dict(sorted(timeline.items())),
        'types': sorted(types.values(), key=lambda x: -x['value']),
        'languages': sorted(languages.values(), key=lambda x: -x['value']),
        'subjects': sorted(subjects.values(), key=lambda x: -x['value'])[:60],
        'contributors': sorted(contributors.values(), key=lambda x: -x['value'])[:30],
        'locations': sorted(locations.values(), key=lambda x: -x['value']),
        'totalItems': len(item_ids),
    }


def save_json(output_dir, item_id, data):
    os.makedirs(output_dir, exist_ok=True)
    path = os.path.join(output_dir, f'{item_id}.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))


# ── Section dashboards ────────────────────────────────────────────────

def generate_section_dashboards(items, links, children_of, item_year, geo):
    output_dir = os.path.join(OUTPUT_BASE, 'section-dashboards')
    sections = [(iid, info) for iid, info in items.items()
                if info['class_term'] == 'frapo:ResearchGroup']

    print(f'\n=== Research Sections ({len(sections)}) ===')

    for section_id, section_info in sections:
        project_ids = children_of.get(section_id, [])
        item_ids = []
        projects_breakdown = []

        for pid in project_ids:
            proj_items = children_of.get(pid, [])
            item_ids.extend(proj_items)
            if proj_items:
                projects_breakdown.append({
                    'name': items.get(pid, {}).get('title', f'Project {pid}'),
                    'value': len(proj_items),
                    'itemId': pid,
                })

        if not item_ids:
            continue

        dashboard = aggregate_items(item_ids, items, links, item_year, geo)
        projects_breakdown.sort(key=lambda x: -x['value'])
        dashboard['projects'] = projects_breakdown

        save_json(output_dir, section_id, dashboard)
        print(f'  {section_info["title"]}: {len(item_ids)} items, {len(project_ids)} projects')


# ── Project dashboards ────────────────────────────────────────────────

PROJECTS_TEMPLATE_ID = 5  # Resource template ID for "Projects"

def generate_project_dashboards(items, links, children_of, item_year, geo):
    output_dir = os.path.join(OUTPUT_BASE, 'project-dashboards')
    projects = [(iid, info) for iid, info in items.items()
                if info['template_id'] == PROJECTS_TEMPLATE_ID]

    print(f'\n=== Projects ({len(projects)}) ===')

    generated = 0
    for project_id, project_info in projects:
        item_ids = children_of.get(project_id, [])
        if not item_ids:
            continue

        dashboard = aggregate_items(item_ids, items, links, item_year, geo)
        save_json(output_dir, project_id, dashboard)
        generated += 1

    print(f'  {generated} project dashboards generated')


# ── Main ──────────────────────────────────────────────────────────────

def main():
    password = get_password()
    os.chdir(OMEKA_DIR)

    items, links, children_of, item_year, geo = load_all_data(password)

    generate_section_dashboards(items, links, children_of, item_year, geo)
    generate_project_dashboards(items, links, children_of, item_year, geo)

    print('\nDone.')


if __name__ == '__main__':
    main()
