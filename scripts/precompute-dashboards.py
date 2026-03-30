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
TEMPLATE_ORGANISATION = 2
TEMPLATE_LOCATION = 3
TEMPLATE_PERSONS = 4
TEMPLATE_PROJECTS = 5
TEMPLATE_AUTHORITY = 6
TEMPLATE_SECTIONS = 7
TEMPLATE_RESEARCH_ITEMS = 10

# Template ID → dashboard resourceType string.
TEMPLATE_RESOURCE_TYPE = {
    TEMPLATE_ORGANISATION: 'organisation',
    TEMPLATE_LOCATION: 'location',
    TEMPLATE_PERSONS: 'person',
    TEMPLATE_PROJECTS: 'project',
    TEMPLATE_SECTIONS: 'section',
    TEMPLATE_RESEARCH_ITEMS: 'researchItem',
}


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
        'subjects': sorted(subjects.values(), key=lambda x: -x['value'])[:200],
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


def build_sankey(item_ids, links, items):
    """Build contributor → project → resource type Sankey flow."""
    flows = {}  # (contributor, project, type) -> count
    all_contributors = set()
    all_projects = set()
    all_types = set()

    for iid in item_ids:
        item_contributors = []
        item_project = None
        item_types = []
        for term, label, vrid in links.get(iid, []):
            title = items.get(vrid, {}).get('title', '')
            if not title:
                continue
            if term.startswith('marcrel:') or term in ('dcterms:creator', 'dcterms:contributor'):
                item_contributors.append(title)
            elif term == 'dcterms:isPartOf':
                item_project = title
            elif term == 'dcterms:type':
                item_types.append(title)

        if not item_project or not item_contributors or not item_types:
            continue

        for c in item_contributors[:3]:  # Limit per item to avoid explosion
            for t in item_types:
                flows[(c, item_project, t)] = flows.get((c, item_project, t), 0) + 1
                all_contributors.add(c)
                all_projects.add(item_project)
                all_types.add(t)

    if not flows:
        return None

    # Keep top 10 contributors to avoid clutter.
    contrib_counts = {}
    for (c, p, t), v in flows.items():
        contrib_counts[c] = contrib_counts.get(c, 0) + v
    top_contribs = set(sorted(contrib_counts, key=lambda x: -contrib_counts[x])[:10])

    node_names = set()
    sankey_links = []
    for (c, p, t), v in flows.items():
        if c not in top_contribs:
            continue
        node_names.update([c, p, t])
        sankey_links.append({'source': c, 'target': p, 'value': v})
        sankey_links.append({'source': p, 'target': t, 'value': v})

    # Deduplicate links.
    link_map = {}
    for l in sankey_links:
        key = (l['source'], l['target'])
        link_map[key] = link_map.get(key, 0) + l['value']

    nodes = [{'name': n} for n in node_names]
    deduped_links = [{'source': s, 'target': t, 'value': v} for (s, t), v in link_map.items()]

    return {'nodes': nodes, 'links': deduped_links} if deduped_links else None


def build_sunburst(item_ids, links, items):
    """Build type → language → subject sunburst hierarchy."""
    # Collect: type -> language -> subject -> count
    tree = {}  # {type: {lang: {subject: count}}}

    for iid in item_ids:
        item_types = []
        item_langs = []
        item_subjects = []
        for term, label, vrid in links.get(iid, []):
            title = items.get(vrid, {}).get('title', '')
            if not title:
                continue
            if term == 'dcterms:type':
                item_types.append(title)
            elif term == 'dcterms:language':
                item_langs.append(title)
            elif term == 'dcterms:subject':
                item_subjects.append(title)

        for t in item_types:
            for l in item_langs:
                if t not in tree:
                    tree[t] = {}
                if l not in tree[t]:
                    tree[t][l] = {}
                if item_subjects:
                    for s in item_subjects[:5]:  # Limit subjects per item
                        tree[t][l][s] = tree[t][l].get(s, 0) + 1
                else:
                    tree[t][l]['(no subject)'] = tree[t][l].get('(no subject)', 0) + 1

    if not tree:
        return None

    # Convert to ECharts sunburst format.
    result = []
    for type_name, langs in tree.items():
        type_node = {'name': type_name, 'children': []}
        for lang_name, subjects in langs.items():
            lang_node = {'name': lang_name, 'children': []}
            # Top 8 subjects per language
            top_subs = sorted(subjects.items(), key=lambda x: -x[1])[:8]
            for sub_name, count in top_subs:
                lang_node['children'].append({'name': sub_name, 'value': count})
            type_node['children'].append(lang_node)
        result.append(type_node)

    return result if result else None


def build_stacked_timeline(item_ids, links, items, item_year):
    """Build stacked timeline: items by year, stacked by resource type."""
    # Collect: year -> type -> count
    year_type = {}
    all_types = set()

    for iid in item_ids:
        year = item_year.get(iid)
        if not year:
            continue
        item_types = []
        for term, label, vrid in links.get(iid, []):
            if term == 'dcterms:type':
                title = items.get(vrid, {}).get('title', '')
                if title:
                    item_types.append(title)
                    all_types.add(title)
        if not item_types:
            item_types = ['(no type)']
            all_types.add('(no type)')
        for t in item_types:
            if year not in year_type:
                year_type[year] = {}
            year_type[year][t] = year_type[year].get(t, 0) + 1

    if not year_type:
        return None

    years = sorted(year_type.keys())
    type_list = sorted(all_types)
    series = []
    for t in type_list:
        series.append({
            'name': t,
            'data': [year_type.get(y, {}).get(t, 0) for y in years],
        })

    return {'years': years, 'series': series}


def build_collab_network(inst_id, inst_title, item_ids, items, links,
                         reverse_links, inst_set, inst_terms, max_nodes=25):
    """Build institution collaboration network from shared research items."""
    from collections import Counter

    collab_counts = Counter()  # other_inst_id -> shared item count

    for iid in item_ids:
        for term, label, vrid in links.get(iid, []):
            if term in inst_terms and vrid != inst_id and vrid in inst_set:
                collab_counts[vrid] += 1

    if not collab_counts:
        return None

    top_collabs = collab_counts.most_common(max_nodes)
    top_ids = {cid for cid, _ in top_collabs}

    # Self node.
    nodes = [{'name': inst_title, 'value': len(item_ids),
              'itemId': inst_id, 'isSelf': True}]
    for cid, count in top_collabs:
        ctitle = items.get(cid, {}).get('title', f'Institution {cid}')
        nodes.append({'name': ctitle, 'value': count, 'itemId': cid})

    # Self <-> collaborator edges.
    net_links = []
    for cid, count in top_collabs:
        ctitle = items.get(cid, {}).get('title', f'Institution {cid}')
        net_links.append({'source': inst_title, 'target': ctitle, 'value': count})

    # Inter-collaborator edges (shared items between pairs of collaborators).
    collab_items = {}
    for cid in top_ids:
        collab_items[cid] = set(find_items_linking_to(cid, reverse_links, inst_terms))
    collab_list = list(top_ids)
    for i in range(len(collab_list)):
        for j in range(i + 1, len(collab_list)):
            a, b = collab_list[i], collab_list[j]
            shared = len(collab_items[a] & collab_items[b])
            if shared >= 2:
                a_title = items.get(a, {}).get('title', '')
                b_title = items.get(b, {}).get('title', '')
                if a_title and b_title:
                    net_links.append({'source': a_title, 'target': b_title,
                                      'value': shared})

    return {'nodes': nodes, 'links': net_links} if net_links else None


def build_contributor_network(entity_id, entity_title, item_ids, items, links,
                              children_of, max_nodes=30):
    """Build person → project force graph from research items linked to an entity.

    Nodes are persons + projects. Edges connect a person to a project when
    the person contributed to an item belonging to that project.
    """
    from collections import Counter

    person_project = Counter()  # (person_id, project_id) -> count
    person_counts = Counter()
    project_counts = Counter()

    for iid in item_ids:
        item_persons = []
        item_project = None
        for term, label, vrid in links.get(iid, []):
            if (term.startswith('marcrel:') or term in ('dcterms:creator', 'dcterms:contributor')):
                if items.get(vrid, {}).get('template_id') == TEMPLATE_PERSONS:
                    item_persons.append(vrid)
            elif term == 'dcterms:isPartOf':
                if items.get(vrid, {}).get('template_id') == TEMPLATE_PROJECTS:
                    item_project = vrid
        if item_project and item_persons:
            for pid in item_persons:
                person_project[(pid, item_project)] += 1
                person_counts[pid] += 1
            project_counts[item_project] += 1

    if not person_project:
        return None

    # Keep top persons by frequency.
    top_persons = {pid for pid, _ in person_counts.most_common(max_nodes)}
    top_projects = {pid for pid, _ in project_counts.most_common(15)}

    nodes = []
    node_names = set()
    for pid in top_persons:
        title = items.get(pid, {}).get('title', f'Person {pid}')
        nodes.append({'name': title, 'value': person_counts[pid],
                       'itemId': pid, 'category': 'person'})
        node_names.add(title)
    for pid in top_projects:
        title = items.get(pid, {}).get('title', f'Project {pid}')
        nodes.append({'name': title, 'value': project_counts[pid],
                       'itemId': pid, 'category': 'project'})
        node_names.add(title)

    net_links = []
    for (person_id, proj_id), count in person_project.items():
        if person_id in top_persons and proj_id in top_projects:
            p_title = items.get(person_id, {}).get('title', '')
            pr_title = items.get(proj_id, {}).get('title', '')
            if p_title in node_names and pr_title in node_names:
                net_links.append({'source': p_title, 'target': pr_title, 'value': count})

    return {'nodes': nodes, 'links': net_links,
            'categories': ['person', 'project']} if net_links else None


def build_affiliation_network(inst_id, inst_title, items, links, reverse_links,
                              max_nodes=30):
    """Build person → institution affiliation network centred on an institution.

    Nodes are persons + institutions. Edges connect a person to each
    institution they are affiliated with (dcterms:isPartOf).
    """
    from collections import Counter

    # Find persons affiliated with this institution.
    affiliated = reverse_links.get(inst_id, {}).get('dcterms:isPartOf', [])
    affiliated_persons = [pid for pid in affiliated
                          if items.get(pid, {}).get('template_id') == TEMPLATE_PERSONS]
    if not affiliated_persons:
        return None

    # For each affiliated person, find ALL their affiliations.
    inst_counts = Counter()
    person_affl = {}  # person_id -> [inst_id, ...]
    for pid in affiliated_persons:
        affls = []
        for term, label, vrid in links.get(pid, []):
            if term == 'dcterms:isPartOf' and items.get(vrid, {}).get('class_term') == 'foaf:Organization':
                affls.append(vrid)
                inst_counts[vrid] += 1
        person_affl[pid] = affls

    # Keep top institutions + always include self.
    top_insts = {iid for iid, _ in inst_counts.most_common(max_nodes)}
    top_insts.add(inst_id)

    nodes = [{'name': inst_title, 'value': len(affiliated_persons),
              'itemId': inst_id, 'category': 'institution', 'isSelf': True}]
    node_names = {inst_title}

    for iid in top_insts:
        if iid == inst_id:
            continue
        title = items.get(iid, {}).get('title', f'Institution {iid}')
        nodes.append({'name': title, 'value': inst_counts[iid],
                       'itemId': iid, 'category': 'institution'})
        node_names.add(title)

    for pid in affiliated_persons[:max_nodes]:
        title = items.get(pid, {}).get('title', f'Person {pid}')
        nodes.append({'name': title, 'value': len(person_affl.get(pid, [])),
                       'itemId': pid, 'category': 'person'})
        node_names.add(title)

    net_links = []
    for pid in affiliated_persons[:max_nodes]:
        p_title = items.get(pid, {}).get('title', '')
        for iid in person_affl.get(pid, []):
            if iid not in top_insts:
                continue
            i_title = items.get(iid, {}).get('title', '')
            if p_title in node_names and i_title in node_names:
                net_links.append({'source': p_title, 'target': i_title, 'value': 1})

    return {'nodes': nodes, 'links': net_links,
            'categories': ['person', 'institution']} if net_links else None


def build_roles(item_ids, links, items):
    """Build contributor role distribution (marcrel:* + dcterms:creator/contributor)."""
    role_counts = {}  # label -> count

    for iid in item_ids:
        for term, label, vrid in links.get(iid, []):
            if term.startswith('marcrel:') or term in ('dcterms:creator', 'dcterms:contributor'):
                # Use the human-readable label (e.g. "author", "photographer").
                role_counts[label] = role_counts.get(label, 0) + 1

    if not role_counts:
        return None

    return sorted(
        [{'name': name, 'value': count} for name, count in role_counts.items()],
        key=lambda x: -x['value']
    )


def build_subject_trends(item_ids, links, items, item_year, top_n=10):
    """Build subject × year matrix for temporal trend visualization."""
    # Collect: subject -> year -> count
    subject_year = {}
    subject_totals = {}

    for iid in item_ids:
        year = item_year.get(iid)
        if not year:
            continue
        for term, label, vrid in links.get(iid, []):
            if term == 'dcterms:subject':
                title = items.get(vrid, {}).get('title', '')
                if title:
                    subject_year.setdefault(title, {})
                    subject_year[title][year] = subject_year[title].get(year, 0) + 1
                    subject_totals[title] = subject_totals.get(title, 0) + 1

    if not subject_year:
        return None

    # Keep top N subjects by total frequency.
    top_subjects = sorted(subject_totals, key=lambda s: -subject_totals[s])[:top_n]
    all_years = sorted(set(y for s in top_subjects for y in subject_year.get(s, {})))

    if len(all_years) < 2:
        return None

    series = []
    for s in top_subjects:
        sy = subject_year.get(s, {})
        series.append({
            'name': s,
            'data': [sy.get(y, 0) for y in all_years],
        })

    return {'years': all_years, 'series': series}


def build_language_timeline(item_ids, links, items, item_year):
    """Build language × year stacked area (like stackedTimeline but by language)."""
    year_lang = {}
    all_langs = set()

    for iid in item_ids:
        year = item_year.get(iid)
        if not year:
            continue
        for term, label, vrid in links.get(iid, []):
            if term == 'dcterms:language':
                title = items.get(vrid, {}).get('title', '')
                if title:
                    year_lang.setdefault(year, {})
                    year_lang[year][title] = year_lang[year].get(title, 0) + 1
                    all_langs.add(title)

    if not year_lang or len(year_lang) < 2:
        return None

    years = sorted(year_lang.keys())
    lang_list = sorted(all_langs)
    series = []
    for lang in lang_list:
        series.append({
            'name': lang,
            'data': [year_lang.get(y, {}).get(lang, 0) for y in years],
        })

    return {'years': years, 'series': series}


def build_treemap(item_ids, links, items, children_of, parent_title):
    """Build Section → Project → Type treemap hierarchy."""
    # For sections: group items by project, then by type within each project.
    # For projects: group items directly by type.

    # Determine if parent is a section (has child projects) or a project.
    project_ids_set = set()
    for pid in children_of.get(None, []):
        pass  # Not used; we derive from items directly.

    # Group items by project.
    project_items = {}
    unassigned = []
    for iid in item_ids:
        assigned = False
        for term, label, vrid in links.get(iid, []):
            if term == 'dcterms:isPartOf' and items.get(vrid, {}).get('template_id') == TEMPLATE_PROJECTS:
                project_items.setdefault(vrid, []).append(iid)
                assigned = True
                break
        if not assigned:
            unassigned.append(iid)

    if not project_items and not unassigned:
        return None

    def type_children(iids):
        types = {}
        for iid in iids:
            for term, label, vrid in links.get(iid, []):
                if term == 'dcterms:type':
                    title = items.get(vrid, {}).get('title', '')
                    if title:
                        types[title] = types.get(title, 0) + 1
        return [{'name': t, 'value': c} for t, c in sorted(types.items(), key=lambda x: -x[1])]

    result = []
    for pid, iids in sorted(project_items.items(), key=lambda x: -len(x[1])):
        ptitle = items.get(pid, {}).get('title', f'Project {pid}')
        children = type_children(iids)
        if children:
            result.append({'name': ptitle, 'value': len(iids), 'children': children})

    if unassigned:
        children = type_children(unassigned)
        if children:
            result.append({'name': '(unassigned)', 'value': len(unassigned), 'children': children})

    return result if result else None


def build_geo_flows(item_ids, links, items, geo):
    """Build geographic flow data: origin → current location arcs."""
    flows = {}  # (origin_id, current_id) -> count

    for iid in item_ids:
        origins = []
        currents = []
        for term, label, vrid in links.get(iid, []):
            if term == 'dcterms:spatial' and vrid in geo:
                origins.append(vrid)
            elif term == 'dcterms:provenance' and vrid in geo:
                currents.append(vrid)
        for o in origins:
            for c in currents:
                if o != c:
                    flows[(o, c)] = flows.get((o, c), 0) + 1

    if not flows:
        return None

    # Build node and link lists.
    node_ids = set()
    for (o, c) in flows:
        node_ids.add(o)
        node_ids.add(c)

    nodes = []
    for nid in node_ids:
        g = geo[nid]
        nodes.append({
            'name': g['name'], 'lat': g['lat'], 'lon': g['lon'], 'itemId': nid,
        })

    flow_links = []
    for (o, c), count in sorted(flows.items(), key=lambda x: -x[1]):
        og, cg = geo[o], geo[c]
        flow_links.append({
            'from': og['name'], 'fromLat': og['lat'], 'fromLon': og['lon'],
            'to': cg['name'], 'toLat': cg['lat'], 'toLon': cg['lon'],
            'value': count,
        })

    return {'nodes': nodes, 'links': flow_links} if flow_links else None


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

def build_beeswarm(section_title, project_ids, items, children_of, temporal):
    """Build beeswarm data: projects as scatter points by start year, sized by item count."""
    points = []
    for pid in project_ids:
        ptitle = items.get(pid, {}).get('title', f'Project {pid}')
        proj_items = children_of.get(pid, [])
        item_count = len(proj_items)
        if pid in temporal:
            start_str = temporal[pid][0]
            m = re.search(r'(\d{4})', start_str)
            if m:
                points.append({
                    'category': section_title,
                    'value': int(m.group(1)),
                    'label': ptitle,
                    'size': max(item_count, 1),
                    'itemId': pid,
                })
    return points if points else None


def generate_sections(items, links, reverse_links, children_of, item_year, temporal, geo):
    sections = [(iid, info) for iid, info in items.items()
                if info['class_term'] == 'frapo:ResearchGroup']
    print(f'\n=== Research Sections ({len(sections)}) ===')

    # Collect cross-section beeswarm data for a global file.
    all_beeswarm = []

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
        # Beeswarm: per-section projects by start year.
        beeswarm = build_beeswarm(sinfo['title'], project_ids, items, children_of, temporal)
        if beeswarm:
            dashboard['beeswarm'] = beeswarm
            all_beeswarm.extend(beeswarm)
        heatmap = build_heatmap(item_ids, links, items)
        if heatmap:
            dashboard['heatmap'] = heatmap
        chord = build_chord(item_ids, links, items)
        if chord:
            dashboard['chord'] = chord
        stacked = build_stacked_timeline(item_ids, links, items, item_year)
        if stacked:
            dashboard['stackedTimeline'] = stacked
        sankey = build_sankey(item_ids, links, items)
        if sankey:
            dashboard['sankey'] = sankey
        sunburst = build_sunburst(item_ids, links, items)
        if sunburst:
            dashboard['sunburst'] = sunburst
        roles = build_roles(item_ids, links, items)
        if roles:
            dashboard['roles'] = roles
        contrib_net = build_contributor_network(sid, sinfo['title'], item_ids,
                                                items, links, children_of)
        if contrib_net:
            dashboard['contributorNetwork'] = contrib_net
        # Tier 3 charts.
        subj_trends = build_subject_trends(item_ids, links, items, item_year)
        if subj_trends:
            dashboard['subjectTrends'] = subj_trends
        lang_timeline = build_language_timeline(item_ids, links, items, item_year)
        if lang_timeline:
            dashboard['languageTimeline'] = lang_timeline
        treemap = build_treemap(item_ids, links, items, children_of, sinfo['title'])
        if treemap:
            dashboard['treemap'] = treemap
        geo_flows = build_geo_flows(item_ids, links, items, geo)
        if geo_flows:
            dashboard['geoFlows'] = geo_flows
        dashboard['resourceType'] = TEMPLATE_RESOURCE_TYPE.get(items[sid]['template_id'], 'section')
        save_json(sid, dashboard)
        print(f'  {sinfo["title"]}: {len(item_ids)} items')

    # Save cross-section beeswarm as a standalone file.
    if all_beeswarm:
        path = os.path.join(OUTPUT_DIR, 'beeswarm-all-sections.json')
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(all_beeswarm, f, ensure_ascii=False, separators=(',', ':'))
        print(f'  Cross-section beeswarm: {len(all_beeswarm)} points')


def generate_projects(items, links, reverse_links, children_of, item_year, geo):
    projects = [(iid, info) for iid, info in items.items()
                if info['template_id'] == TEMPLATE_PROJECTS]
    print(f'\n=== Projects ({len(projects)}) ===')

    # Collect project index for Compare View selector.
    project_index = []

    count = 0
    for pid, pinfo in projects:
        item_ids = children_of.get(pid, [])
        if not item_ids:
            continue

        # Find section name(s) for this project.
        section_names = []
        for term, label, vrid in links.get(pid, []):
            if term == 'dcterms:isPartOf' and items.get(vrid, {}).get('class_term') == 'frapo:ResearchGroup':
                section_names.append(items[vrid]['title'])

        project_index.append({
            'id': pid,
            'name': pinfo['title'],
            'items': len(item_ids),
            'sections': section_names,
        })

        dashboard = aggregate_items(item_ids, items, links, item_year, geo)
        heatmap = build_heatmap(item_ids, links, items)
        if heatmap:
            dashboard['heatmap'] = heatmap
        chord = build_chord(item_ids, links, items)
        if chord:
            dashboard['chord'] = chord
        stacked = build_stacked_timeline(item_ids, links, items, item_year)
        if stacked:
            dashboard['stackedTimeline'] = stacked
        sankey = build_sankey(item_ids, links, items)
        if sankey:
            dashboard['sankey'] = sankey
        sunburst = build_sunburst(item_ids, links, items)
        if sunburst:
            dashboard['sunburst'] = sunburst
        roles = build_roles(item_ids, links, items)
        if roles:
            dashboard['roles'] = roles
        contrib_net = build_contributor_network(pid, pinfo['title'], item_ids,
                                                items, links, children_of)
        if contrib_net:
            dashboard['contributorNetwork'] = contrib_net
        # Tier 3 charts.
        subj_trends = build_subject_trends(item_ids, links, items, item_year)
        if subj_trends:
            dashboard['subjectTrends'] = subj_trends
        lang_timeline = build_language_timeline(item_ids, links, items, item_year)
        if lang_timeline:
            dashboard['languageTimeline'] = lang_timeline
        treemap = build_treemap(item_ids, links, items, children_of, pinfo['title'])
        if treemap:
            dashboard['treemap'] = treemap
        geo_flows = build_geo_flows(item_ids, links, items, geo)
        if geo_flows:
            dashboard['geoFlows'] = geo_flows
        dashboard['resourceType'] = TEMPLATE_RESOURCE_TYPE.get(items[pid]['template_id'], 'project')
        save_json(pid, dashboard)
        count += 1
    print(f'  {count} dashboards generated')

    # Save project index for Compare View.
    project_index.sort(key=lambda p: p['name'])
    path = os.path.join(OUTPUT_DIR, 'projects-index.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(project_index, f, ensure_ascii=False, separators=(',', ':'))
    print(f'  Project index: {len(project_index)} projects')


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
        # People: co-authors replaces contributors (redundant).
        dashboard.pop('contributors', None)
        # Contributor network: person → project links.
        contrib_net = build_contributor_network(pid, pinfo['title'], item_ids,
                                                items, links, children_of)
        if contrib_net:
            dashboard['contributorNetwork'] = contrib_net
        dashboard['resourceType'] = TEMPLATE_RESOURCE_TYPE.get(items[pid]['template_id'], 'person')
        save_json(pid, dashboard)
        count += 1
    print(f'  {count} dashboards generated')


def generate_institutions(items, links, reverse_links, children_of, item_year, geo):
    institutions = [(iid, info) for iid, info in items.items()
                    if info['class_term'] == 'foaf:Organization']
    print(f'\n=== Institutions ({len(institutions)}) ===')

    inst_set = {iid for iid, _ in institutions}

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

        collab = build_collab_network(iid, iinfo['title'], item_ids, items,
                                      links, reverse_links, inst_set, inst_terms)
        if collab:
            dashboard['collabNetwork'] = collab

        affil = build_affiliation_network(iid, iinfo['title'], items, links, reverse_links)
        if affil:
            dashboard['affiliationNetwork'] = affil

        dashboard['resourceType'] = TEMPLATE_RESOURCE_TYPE.get(items[iid]['template_id'], 'organisation')
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
        dashboard['resourceType'] = TEMPLATE_RESOURCE_TYPE.get(items[lid]['template_id'], 'location')
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
        # Subjects: remove self-referential subjects chart.
        dashboard.pop('subjects', None)
        dashboard['resourceType'] = 'authority'
        save_json(sid, dashboard)
        count += 1
    print(f'  {count} dashboards generated')


def generate_by_item_set(items, links, reverse_links, item_year, geo, item_sets,
                         set_id, term, label, resource_type='authority',
                         exclude_keys=None):
    """Generate dashboards for items in a specific item set, using reverse links."""
    set_items = item_sets.get(set_id, [])
    print(f'\n=== {label} (item set {set_id}, {len(set_items)} items) ===')

    count = 0
    for eid in set_items:
        item_ids = find_items_linking_to(eid, reverse_links, {term})
        if not item_ids:
            continue
        dashboard = aggregate_items(item_ids, items, links, item_year, geo)
        # Remove self-referential charts.
        if exclude_keys:
            for k in exclude_keys:
                dashboard.pop(k, None)
        dashboard['resourceType'] = resource_type
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
                         set_id=1, term='dcterms:type', label='Resource Types',
                         exclude_keys=['types'])
    generate_by_item_set(items, links, reverse_links, item_year, geo, item_sets,
                         set_id=19, term='dcterms:language', label='Languages',
                         exclude_keys=['languages'])
    generate_by_item_set(items, links, reverse_links, item_year, geo, item_sets,
                         set_id=21, term='dcterms:format', label='Genres')

    # ── Collection Overview (all research items) ─────────────────────────
    research_items = [iid for iid, info in items.items()
                      if info['template_id'] == TEMPLATE_RESEARCH_ITEMS]
    print(f'\n=== Collection Overview ({len(research_items)} research items) ===')
    if research_items:
        dashboard = aggregate_items(research_items, items, links, item_year, geo)
        stacked = build_stacked_timeline(research_items, links, items, item_year)
        if stacked:
            dashboard['stackedTimeline'] = stacked
        heatmap = build_heatmap(research_items, links, items)
        if heatmap:
            dashboard['heatmap'] = heatmap
        roles = build_roles(research_items, links, items)
        if roles:
            dashboard['roles'] = roles
        subj_trends = build_subject_trends(research_items, links, items, item_year)
        if subj_trends:
            dashboard['subjectTrends'] = subj_trends
        lang_timeline = build_language_timeline(research_items, links, items, item_year)
        if lang_timeline:
            dashboard['languageTimeline'] = lang_timeline
        chord = build_chord(research_items, links, items)
        if chord:
            dashboard['chord'] = chord
        sankey = build_sankey(research_items, links, items)
        if sankey:
            dashboard['sankey'] = sankey
        sunburst = build_sunburst(research_items, links, items)
        if sunburst:
            dashboard['sunburst'] = sunburst
        geo_flows = build_geo_flows(research_items, links, items, geo)
        if geo_flows:
            dashboard['geoFlows'] = geo_flows
        # Use section layout since it has the most charts.
        dashboard['resourceType'] = 'section'
        path = os.path.join(OUTPUT_DIR, 'collection-overview.json')
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(dashboard, f, ensure_ascii=False, separators=(',', ':'))
        print(f'  Overview dashboard saved ({dashboard["totalItems"]} items)')

    print(f'\nDone. Files in {OUTPUT_DIR}/')


if __name__ == '__main__':
    main()
