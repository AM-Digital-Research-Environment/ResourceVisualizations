#!/usr/bin/env python3
"""
Pre-compute dashboard data for research section items.

Uses `docker compose exec` to query MySQL — no port exposure needed.

Usage (from the omeka-s-docker directory):
  python3 /path/to/ResourceVisualizations/scripts/precompute-section-dashboards.py

Or set OMEKA_DOCKER_DIR if running from elsewhere:
  OMEKA_DOCKER_DIR=/home/user/omeka-s-docker python3 precompute-section-dashboards.py
"""

import json
import os
import re
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODULE_DIR = os.path.dirname(SCRIPT_DIR)
OUTPUT_DIR = os.path.join(MODULE_DIR, 'asset', 'data', 'section-dashboards')

OMEKA_DIR = os.environ.get('OMEKA_DOCKER_DIR', os.path.join(os.path.dirname(MODULE_DIR), 'omeka-s-docker'))
DB_USER = os.environ.get('DB_USER', 'omeka')
DB_PASS = os.environ.get('DB_PASS', '')
DB_NAME = os.environ.get('DB_NAME', 'omeka')


def query_mysql(sql):
    """Run a SQL query via docker compose exec and return rows as list of tuples."""
    if not DB_PASS:
        # Read password from .env
        env_file = os.path.join(OMEKA_DIR, '.env')
        password = ''
        if os.path.exists(env_file):
            with open(env_file) as f:
                for line in f:
                    if line.startswith('MYSQL_PASSWORD='):
                        password = line.strip().split('=', 1)[1]
                        break
        if not password:
            print('ERROR: Set DB_PASS or ensure MYSQL_PASSWORD is in .env')
            sys.exit(1)
    else:
        password = DB_PASS

    cmd = [
        'docker', 'compose', 'exec', '-T', 'db',
        'mysql', f'-u{DB_USER}', f'-p{password}', DB_NAME,
        '--default-character-set=utf8mb4',
        '--batch', '--skip-column-names', '-e', sql,
    ]
    result = subprocess.run(cmd, capture_output=True, cwd=OMEKA_DIR)
    if result.returncode != 0:
        print(f'MySQL error: {result.stderr.decode("utf-8", errors="replace").strip()}')
        return []
    stdout = result.stdout.decode('utf-8', errors='replace')
    rows = []
    for line in stdout.strip().split('\n'):
        if line:
            rows.append(tuple(line.split('\t')))
    return rows


def extract_year(date_str):
    """Extract a 4-digit year from a date string."""
    m = re.search(r'(\d{4})', date_str or '')
    return m.group(1) if m else None


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    os.chdir(OMEKA_DIR)

    print('Finding research sections...')
    sections = query_mysql("""
        SELECT r.id, r.title
        FROM resource r
        JOIN resource_class rc ON r.resource_class_id = rc.id
        JOIN vocabulary v ON rc.vocabulary_id = v.id
        WHERE CONCAT(v.prefix, ':', rc.local_name) = 'frapo:ResearchGroup'
        AND r.resource_type = 'Omeka\\\\Entity\\\\Item'
    """)
    if not sections:
        print('No research sections found.')
        return

    print(f'  Found {len(sections)} sections: {[s[1] for s in sections]}')

    # Load all resource links in one query.
    print('Loading all resource links...')
    all_links = query_mysql("""
        SELECT v.resource_id,
               CONCAT(vo.prefix, ':', p.local_name) AS term,
               p.label AS prop_label,
               v.value_resource_id
        FROM value v
        JOIN property p ON v.property_id = p.id
        JOIN vocabulary vo ON p.vocabulary_id = vo.id
        WHERE v.value_resource_id IS NOT NULL
    """)
    print(f'  {len(all_links)} links loaded')

    # Build lookup: resource_id -> [(term, label, value_resource_id)]
    links_by_resource = {}
    for rid, term, label, vrid in all_links:
        rid, vrid = int(rid), int(vrid)
        links_by_resource.setdefault(rid, []).append((term, label, vrid))

    # Build reverse lookup: items where dcterms:isPartOf -> X
    children_of = {}  # parent_id -> [child_id, ...]
    for rid, term, _, vrid in all_links:
        if term == 'dcterms:isPartOf':
            rid, vrid = int(rid), int(vrid)
            children_of.setdefault(vrid, []).append(rid)

    # Load all item titles.
    print('Loading item titles...')
    title_rows = query_mysql("""
        SELECT id, title FROM resource
        WHERE resource_type = 'Omeka\\\\Entity\\\\Item'
    """)
    titles = {int(r[0]): r[1] for r in title_rows}
    print(f'  {len(titles)} titles loaded')

    # Load date values.
    print('Loading date values...')
    date_rows = query_mysql("""
        SELECT v.resource_id, v.value
        FROM value v
        JOIN property p ON v.property_id = p.id
        JOIN vocabulary vo ON p.vocabulary_id = vo.id
        WHERE CONCAT(vo.prefix, ':', p.local_name) IN
            ('dcterms:issued', 'dcterms:created', 'dcterms:date', 'fabio:hasDateCollected')
        AND v.value IS NOT NULL AND v.value != ''
    """)
    # Keep first date per item.
    item_year = {}
    for rid, val in date_rows:
        rid = int(rid)
        if rid not in item_year:
            year = extract_year(val)
            if year:
                item_year[rid] = year
    print(f'  {len(item_year)} items with dates')

    # For each section, build dashboard data.
    for section_id_str, section_title in sections:
        section_id = int(section_id_str)
        print(f'\nProcessing: {section_title} (id={section_id})')

        # Find projects in this section.
        project_ids = children_of.get(section_id, [])
        print(f'  {len(project_ids)} projects')

        # Find research items in those projects.
        item_ids = []
        items_per_project = []
        for pid in project_ids:
            proj_items = children_of.get(pid, [])
            item_ids.extend(proj_items)
            proj_title = titles.get(pid, f'Project {pid}')
            if proj_items:
                items_per_project.append({'name': proj_title, 'value': len(proj_items), 'itemId': pid})

        print(f'  {len(item_ids)} research items')

        if not item_ids:
            continue

        # Aggregate data — track both count and item ID for click-to-navigate.
        timeline = {}
        types = {}       # vrid -> {name, count}
        languages = {}
        subjects = {}
        contributors = {}

        for iid in item_ids:
            year = item_year.get(iid)
            if year:
                timeline[year] = timeline.get(year, 0) + 1

            for term, label, vrid in links_by_resource.get(iid, []):
                vr_title = titles.get(vrid, '')
                if not vr_title:
                    continue

                if term == 'dcterms:type':
                    if vrid not in types:
                        types[vrid] = {'name': vr_title, 'value': 0, 'itemId': vrid}
                    types[vrid]['value'] += 1
                elif term == 'dcterms:language':
                    if vrid not in languages:
                        languages[vrid] = {'name': vr_title, 'value': 0, 'itemId': vrid}
                    languages[vrid]['value'] += 1
                elif term == 'dcterms:subject':
                    if vrid not in subjects:
                        subjects[vrid] = {'name': vr_title, 'value': 0, 'itemId': vrid}
                    subjects[vrid]['value'] += 1
                elif term in ('dcterms:creator', 'dcterms:contributor') or term.startswith('marcrel:'):
                    if vrid not in contributors:
                        contributors[vrid] = {'name': vr_title, 'value': 0, 'itemId': vrid}
                    contributors[vrid]['value'] += 1

        # Sort and trim — output as arrays of {name, value, itemId}.
        timeline = dict(sorted(timeline.items()))
        types_list = sorted(types.values(), key=lambda x: -x['value'])
        languages_list = sorted(languages.values(), key=lambda x: -x['value'])
        subjects_list = sorted(subjects.values(), key=lambda x: -x['value'])[:60]
        contributors_list = sorted(contributors.values(), key=lambda x: -x['value'])[:30]
        items_per_project.sort(key=lambda x: -x['value'])

        dashboard = {
            'timeline': timeline,
            'types': types_list,
            'languages': languages_list,
            'subjects': subjects_list,
            'contributors': contributors_list,
            'projects': items_per_project,
            'totalItems': len(item_ids),
        }

        path = os.path.join(OUTPUT_DIR, f'{section_id}.json')
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(dashboard, f, ensure_ascii=False, separators=(',', ':'))
        print(f'  Saved {path}')

    print('\nDone.')


if __name__ == '__main__':
    main()
