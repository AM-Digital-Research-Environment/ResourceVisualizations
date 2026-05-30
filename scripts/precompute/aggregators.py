"""Shared aggregation and chart-data builder functions."""

import json
import os
import re
from collections import Counter

from .config import (OUTPUT_DIR, COUNTRIES_GEOJSON,
                     TEMPLATE_PERSONS, TEMPLATE_PROJECTS)


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
    cross = {}
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
    item_values = {}
    value_titles = {}

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

    pair_counts = Counter()
    node_counts = Counter()
    for vals in item_values.values():
        for v in vals:
            node_counts[v] += 1
        for i in range(len(vals)):
            for j in range(i + 1, len(vals)):
                pair = tuple(sorted([vals[i], vals[j]]))
                pair_counts[pair] += 1

    top_nodes = [vrid for vrid, _ in node_counts.most_common(max_nodes)]
    top_set = set(top_nodes)

    chord_links = []
    for (a, b), count in pair_counts.items():
        if count >= min_cooccurrence and a in top_set and b in top_set:
            chord_links.append({
                'source': value_titles[a], 'target': value_titles[b], 'value': count,
            })

    if not chord_links:
        return None

    chord_nodes = [{'name': value_titles[v], 'value': node_counts[v], 'itemId': v}
                   for v in top_nodes if v in value_titles]
    return {'nodes': chord_nodes, 'links': chord_links}


def _weighted_pagerank(graph, weight='weight', alpha=0.85, iters=100, tol=1.0e-6):
    """Pure-Python weighted PageRank (power iteration).

    Avoids networkx's pagerank, which pulls in scipy. The community graph has no
    isolated nodes (built from edges), so dangling-node handling is unnecessary.
    """
    nodes = list(graph.nodes())
    n = len(nodes)
    if not n:
        return {}
    pr = {u: 1.0 / n for u in nodes}
    wdeg = {u: sum(graph[u][v].get(weight, 1) for v in graph[u]) or 1 for u in nodes}
    base = (1.0 - alpha) / n
    for _ in range(iters):
        prev = pr
        pr = {u: base for u in nodes}
        for u in nodes:
            share = alpha * prev[u] / wdeg[u]
            for v in graph[u]:
                pr[v] += share * graph[u][v].get(weight, 1)
        if sum(abs(pr[u] - prev[u]) for u in nodes) < tol:
            break
    total = sum(pr.values()) or 1.0
    return {u: pr[u] / total for u in nodes}


def build_discursive_communities(item_ids, links, items, subject_filter=None,
                                 min_cooccurrence=2, max_nodes=120):
    """Subject co-occurrence network with Louvain communities + PageRank anchors.

    Builds a weighted graph of subjects that co-occur on the same items, detects
    communities (Louvain), ranks nodes by PageRank, and returns the top
    `max_nodes` subjects coloured by community, the edges among them, and a
    per-community summary (size + top-PageRank anchor).

    subject_filter: optional set of subject resource-ids to restrict to
                    (e.g. LCSH-only, to cut free-text-tag noise).

    Returns None if networkx is unavailable or the graph is too small.
    """
    try:
        import networkx as nx
    except ImportError:
        print('  networkx not installed — skipping discursive communities')
        return None

    pair_counts = Counter()
    node_counts = Counter()
    titles = {}
    for iid in item_ids:
        subs = set()
        for term, label, vrid in links.get(iid, []):
            if term == 'dcterms:subject':
                if subject_filter is not None and vrid not in subject_filter:
                    continue
                title = items.get(vrid, {}).get('title', '')
                if title:
                    subs.add(vrid)
                    titles[vrid] = title
        subs = list(subs)
        for v in subs:
            node_counts[v] += 1
        for i in range(len(subs)):
            for j in range(i + 1, len(subs)):
                pair_counts[tuple(sorted((subs[i], subs[j])))] += 1

    graph = nx.Graph()
    for (a, b), w in pair_counts.items():
        if w >= min_cooccurrence:
            graph.add_edge(a, b, weight=w)
    if graph.number_of_nodes() < 3 or graph.number_of_edges() < 2:
        return None

    try:
        communities = nx.community.louvain_communities(graph, weight='weight', seed=42)
    except Exception as exc:  # pragma: no cover - defensive
        print(f'  Louvain failed: {exc}')
        return None
    comm_of = {}
    for ci, comm in enumerate(communities):
        for node in comm:
            comm_of[node] = ci

    pagerank = _weighted_pagerank(graph, weight='weight')
    ranked = sorted(graph.nodes(), key=lambda n: -pagerank.get(n, 0))[:max_nodes]
    top_set = set(ranked)

    nodes = [{
        'name': titles[n], 'value': node_counts[n], 'itemId': n,
        'community': comm_of.get(n, 0), 'rank': round(pagerank.get(n, 0), 6),
    } for n in ranked if n in titles]

    out_links = []
    for (a, b), w in pair_counts.items():
        if w >= min_cooccurrence and a in top_set and b in top_set:
            out_links.append({'source': titles[a], 'target': titles[b], 'value': w})

    summary = {}
    for n in ranked:
        ci = comm_of.get(n, 0)
        s = summary.setdefault(ci, {'id': ci, 'size': 0, 'anchor': None, '_rank': -1.0})
        s['size'] += 1
        if pagerank.get(n, 0) > s['_rank']:
            s['_rank'] = pagerank.get(n, 0)
            s['anchor'] = titles[n]
    communities_list = sorted(
        [{'id': s['id'], 'size': s['size'], 'anchor': s['anchor']} for s in summary.values()],
        key=lambda c: -c['size'])

    return {'nodes': nodes, 'links': out_links, 'communities': communities_list}


def build_sankey(item_ids, links, items):
    """Build contributor → project → resource type Sankey flow."""
    flows = {}
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

        for c in item_contributors[:3]:
            for t in item_types:
                flows[(c, item_project, t)] = flows.get((c, item_project, t), 0) + 1

    if not flows:
        return None

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

    link_map = {}
    for l in sankey_links:
        key = (l['source'], l['target'])
        link_map[key] = link_map.get(key, 0) + l['value']

    nodes = [{'name': n} for n in node_names]
    deduped_links = [{'source': s, 'target': t, 'value': v} for (s, t), v in link_map.items()]
    return {'nodes': nodes, 'links': deduped_links} if deduped_links else None


def build_sunburst(item_ids, links, items):
    """Build type → language → subject sunburst hierarchy."""
    tree = {}
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
                tree.setdefault(t, {}).setdefault(l, {})
                if item_subjects:
                    for s in item_subjects[:5]:
                        tree[t][l][s] = tree[t][l].get(s, 0) + 1
                else:
                    tree[t][l]['(no subject)'] = tree[t][l].get('(no subject)', 0) + 1

    if not tree:
        return None

    result = []
    for type_name, langs in tree.items():
        type_node = {'name': type_name, 'children': []}
        for lang_name, subjects in langs.items():
            lang_node = {'name': lang_name, 'children': []}
            top_subs = sorted(subjects.items(), key=lambda x: -x[1])[:8]
            for sub_name, count in top_subs:
                lang_node['children'].append({'name': sub_name, 'value': count})
            type_node['children'].append(lang_node)
        result.append(type_node)
    return result if result else None


def build_stacked_timeline(item_ids, links, items, item_year):
    """Build stacked timeline: items by year, stacked by resource type."""
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
            year_type.setdefault(year, {})[t] = year_type.get(year, {}).get(t, 0) + 1

    if not year_type:
        return None

    years = sorted(year_type.keys())
    type_list = sorted(all_types)
    series = [{'name': t, 'data': [year_type.get(y, {}).get(t, 0) for y in years]}
              for t in type_list]
    return {'years': years, 'series': series}


def build_collab_network(inst_id, inst_title, item_ids, items, links,
                         reverse_links, inst_set, inst_terms, max_nodes=25):
    """Build institution collaboration network from shared research items."""
    collab_counts = Counter()
    for iid in item_ids:
        for term, label, vrid in links.get(iid, []):
            if term in inst_terms and vrid != inst_id and vrid in inst_set:
                collab_counts[vrid] += 1

    if not collab_counts:
        return None

    top_collabs = collab_counts.most_common(max_nodes)
    top_ids = {cid for cid, _ in top_collabs}

    nodes = [{'name': inst_title, 'value': len(item_ids),
              'itemId': inst_id, 'isSelf': True}]
    for cid, count in top_collabs:
        ctitle = items.get(cid, {}).get('title', f'Institution {cid}')
        nodes.append({'name': ctitle, 'value': count, 'itemId': cid})

    net_links = []
    for cid, count in top_collabs:
        ctitle = items.get(cid, {}).get('title', f'Institution {cid}')
        net_links.append({'source': inst_title, 'target': ctitle, 'value': count})

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
                    net_links.append({'source': a_title, 'target': b_title, 'value': shared})

    return {'nodes': nodes, 'links': net_links} if net_links else None


def build_contributor_network(entity_id, entity_title, item_ids, items, links,
                              children_of, max_nodes=30):
    """Build person → project force graph from research items."""
    person_project = Counter()
    person_counts = Counter()
    project_counts = Counter()

    for iid in item_ids:
        item_persons = []
        item_project = None
        for term, label, vrid in links.get(iid, []):
            if term.startswith('marcrel:') or term in ('dcterms:creator', 'dcterms:contributor'):
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
    """Build person → institution affiliation network centred on an institution."""
    affiliated = reverse_links.get(inst_id, {}).get('dcterms:isPartOf', [])
    affiliated_persons = [pid for pid in affiliated
                          if items.get(pid, {}).get('template_id') == TEMPLATE_PERSONS]
    if not affiliated_persons:
        return None

    inst_counts = Counter()
    person_affl = {}
    for pid in affiliated_persons:
        affls = []
        for term, label, vrid in links.get(pid, []):
            if term == 'dcterms:isPartOf' and items.get(vrid, {}).get('class_term') == 'foaf:Organization':
                affls.append(vrid)
                inst_counts[vrid] += 1
        person_affl[pid] = affls

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
    """Build contributor role distribution across all contributors of the items."""
    role_counts = {}
    for iid in item_ids:
        for term, label, vrid in links.get(iid, []):
            if term.startswith('marcrel:') or term in ('dcterms:creator', 'dcterms:contributor'):
                role_counts[label] = role_counts.get(label, 0) + 1
    if not role_counts:
        return None
    return sorted([{'name': n, 'value': c} for n, c in role_counts.items()],
                  key=lambda x: -x['value'])


def build_roles_for(entity_id, item_ids, links):
    """Build the role distribution for one specific entity (e.g. a person).

    Unlike build_roles (which counts every contributor on the items), this
    counts only the roles that *this* entity played — i.e. links whose value
    resource is entity_id — so a person dashboard shows that person's own
    roles (author, photographer, …), not everyone else's.
    """
    role_counts = {}
    for iid in item_ids:
        for term, label, vrid in links.get(iid, []):
            if vrid != entity_id:
                continue
            if term.startswith('marcrel:') or term in ('dcterms:creator', 'dcterms:contributor'):
                role_counts[label] = role_counts.get(label, 0) + 1
    if not role_counts:
        return None
    return sorted([{'name': n, 'value': c} for n, c in role_counts.items()],
                  key=lambda x: -x['value'])


def build_subject_trends(item_ids, links, items, item_year, top_n=10):
    """Build subject × year matrix for temporal trend visualization."""
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
                    subject_year.setdefault(title, {})[year] = \
                        subject_year.get(title, {}).get(year, 0) + 1
                    subject_totals[title] = subject_totals.get(title, 0) + 1

    if not subject_year:
        return None

    top_subjects = sorted(subject_totals, key=lambda s: -subject_totals[s])[:top_n]
    all_years = sorted(set(y for s in top_subjects for y in subject_year.get(s, {})))
    if len(all_years) < 2:
        return None

    series = [{'name': s, 'data': [subject_year.get(s, {}).get(y, 0) for y in all_years]}
              for s in top_subjects]
    return {'years': all_years, 'series': series}


def build_language_timeline(item_ids, links, items, item_year):
    """Build language × year stacked area."""
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
                    year_lang.setdefault(year, {})[title] = \
                        year_lang.get(year, {}).get(title, 0) + 1
                    all_langs.add(title)

    if not year_lang or len(year_lang) < 2:
        return None

    years = sorted(year_lang.keys())
    series = [{'name': lang, 'data': [year_lang.get(y, {}).get(lang, 0) for y in years]}
              for lang in sorted(all_langs)]
    return {'years': years, 'series': series}


def build_treemap(item_ids, links, items, children_of, parent_title):
    """Build Project → Type treemap hierarchy."""
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
    flows = {}
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

    node_ids = set()
    for (o, c) in flows:
        node_ids.add(o)
        node_ids.add(c)

    nodes = [{'name': geo[nid]['name'], 'lat': geo[nid]['lat'],
              'lon': geo[nid]['lon'], 'itemId': nid} for nid in node_ids]

    flow_links = []
    for (o, c), count in sorted(flows.items(), key=lambda x: -x[1]):
        og, cg = geo[o], geo[c]
        flow_links.append({
            'from': og['name'], 'fromLat': og['lat'], 'fromLon': og['lon'],
            'to': cg['name'], 'toLat': cg['lat'], 'toLon': cg['lon'],
            'value': count,
        })
    return {'nodes': nodes, 'links': flow_links} if flow_links else None


# -- Choropleth: country-level aggregation -----------------------------------
#
# The module's `geo` is point-based (lat/lon per location), so locations are
# rolled up to countries with a pure-Python point-in-polygon test against the
# shared Natural Earth GeoJSON. The per-location → country map is built once and
# cached for the whole run (the geo set is identical across entities).

_country_index = None     # {location_id: country_name}
_country_features = None   # cached [(country_name, geometry)]


def _point_in_polygon(x, y, rings):
    """Even-odd ray-casting test across all rings of a polygon (handles holes)."""
    inside = False
    for ring in rings:
        n = len(ring)
        j = n - 1
        for i in range(n):
            xi, yi = ring[i][0], ring[i][1]
            xj, yj = ring[j][0], ring[j][1]
            if ((yi > y) != (yj > y)) and \
                    (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
                inside = not inside
            j = i
    return inside


def _country_for_point(lon, lat, features):
    for name, geom in features:
        gtype = geom.get('type')
        coords = geom.get('coordinates')
        if gtype == 'Polygon':
            if _point_in_polygon(lon, lat, coords):
                return name
        elif gtype == 'MultiPolygon':
            for poly in coords:
                if _point_in_polygon(lon, lat, poly):
                    return name
    return None


def _load_country_features():
    global _country_features
    if _country_features is not None:
        return _country_features
    _country_features = []
    try:
        with open(COUNTRIES_GEOJSON, encoding='utf-8') as f:
            gj = json.load(f)
    except (OSError, ValueError):
        return _country_features
    for ft in gj.get('features', []):
        props = ft.get('properties', {})
        name = (props.get('ADMIN') or props.get('NAME')
                or props.get('NAME_EN') or props.get('NAME_LONG'))
        geom = ft.get('geometry')
        if name and geom:
            _country_features.append((name, geom))
    return _country_features


def _get_country_index(geo):
    """Build (once) and return {location_id: country_name} via point-in-polygon."""
    global _country_index
    if _country_index is not None:
        return _country_index
    _country_index = {}
    features = _load_country_features()
    if not features:
        return _country_index
    for loc_id, g in geo.items():
        lon, lat = g.get('lon'), g.get('lat')
        if lon is None or lat is None:
            continue
        name = _country_for_point(lon, lat, features)
        if name:
            _country_index[loc_id] = name
    return _country_index


def build_choropleth(item_ids, links, geo):
    """Aggregate item origins (dcterms:spatial) to per-country counts.

    Emits [{country, count}] joined in the browser against the country
    GeoJSON's ADMIN/NAME property. Each item counts once per country it
    references. Returns None when nothing geocodes to a country.
    """
    country_index = _get_country_index(geo)
    if not country_index:
        return None
    counts = {}
    for iid in item_ids:
        seen = set()
        for term, label, vrid in links.get(iid, []):
            if term == 'dcterms:spatial':
                country = country_index.get(vrid)
                if country and country not in seen:
                    counts[country] = counts.get(country, 0) + 1
                    seen.add(country)
    if not counts:
        return None
    return [{'country': c, 'count': n}
            for c, n in sorted(counts.items(), key=lambda x: -x[1])]


# -- Radar profile -----------------------------------------------------------
#
# A small "breadth" profile per entity, normalised against the per-type maxima
# so the polygon size is comparable across entities (a single entity's own
# values would otherwise fill every axis). Primary payoff is the Compare view,
# where two profiles overlay on the same axes.

RADAR_AXES = [
    ('items', 'Items'),
    ('languages', 'Languages'),
    ('subjects', 'Subjects'),
    ('contributors', 'People'),
    ('types', 'Types'),
    ('span', 'Year span'),
]


def profile_from_items(item_ids, links, item_year):
    """Cheap per-entity breadth metrics (no full aggregation)."""
    langs, subs, contribs, types, locs = set(), set(), set(), set(), set()
    years = []
    for iid in item_ids:
        y = item_year.get(iid)
        if y and str(y).isdigit():
            years.append(int(y))
        for term, label, vrid in links.get(iid, []):
            if term == 'dcterms:language':
                langs.add(vrid)
            elif term == 'dcterms:subject':
                subs.add(vrid)
            elif term == 'dcterms:type':
                types.add(vrid)
            elif term == 'dcterms:spatial':
                locs.add(vrid)
            elif term in ('dcterms:creator', 'dcterms:contributor') or term.startswith('marcrel:'):
                contribs.add(vrid)
    span = (max(years) - min(years)) if len(years) >= 2 else 0
    return {'items': len(item_ids), 'languages': len(langs), 'subjects': len(subs),
            'contributors': len(contribs), 'types': len(types), 'span': span}


def profile_maxima(profiles):
    """Per-axis maxima across a collection of profiles (the radar's scale)."""
    mx = {k: 0 for k, _ in RADAR_AXES}
    for p in profiles:
        for k, _ in RADAR_AXES:
            v = p.get(k, 0)
            if v > mx[k]:
                mx[k] = v
    return mx


def build_radar(profile, maxima):
    """Build a radar config: indicators (name + max) + one value series.

    Axes whose maximum is zero across the whole type are dropped — consistently
    for every entity, since `maxima` is shared per type.
    """
    if not profile or not maxima:
        return None
    indicator, values = [], []
    any_nonzero = False
    for key, label in RADAR_AXES:
        mx = maxima.get(key, 0)
        if mx <= 0:
            continue
        indicator.append({'name': label, 'max': mx})
        v = profile.get(key, 0)
        values.append(v)
        if v:
            any_nonzero = True
    if len(indicator) < 3 or not any_nonzero:
        return None
    return {'indicator': indicator, 'series': [{'value': values}]}


def build_beeswarm(section_title, project_ids, items, children_of, temporal):
    """Build beeswarm data: projects as scatter points by start year."""
    points = []
    for pid in project_ids:
        ptitle = items.get(pid, {}).get('title', f'Project {pid}')
        item_count = len(children_of.get(pid, []))
        if pid in temporal:
            m = re.search(r'(\d{4})', temporal[pid][0])
            if m:
                points.append({
                    'category': section_title,
                    'value': int(m.group(1)),
                    'label': ptitle,
                    'size': max(item_count, 1),
                    'itemId': pid,
                })
    return points if points else None
