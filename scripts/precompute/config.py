"""Shared configuration: paths, template IDs, item set IDs."""

import os

SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODULE_DIR = os.path.dirname(SCRIPT_DIR)
OUTPUT_DIR = os.path.join(MODULE_DIR, 'asset', 'data', 'item-dashboards')
COMMUNITIES_DIR = os.path.join(MODULE_DIR, 'asset', 'data', 'communities')

# Shared Natural Earth 110m country boundaries (GeoJSON) used by the choropleth
# — the same file the dashboard ships, so country joins match across projects.
COUNTRIES_GEOJSON = os.path.join(MODULE_DIR, 'asset', 'data', 'geo', 'countries.geojson')

OMEKA_DIR = os.environ.get('OMEKA_DOCKER_DIR',
                           os.path.join(os.path.dirname(MODULE_DIR), 'omeka-s-docker'))

# DB credentials. Fall back to the omeka-s-docker `php` service's own MySQL
# environment variables (MYSQL_HOST / MYSQL_USER / MYSQL_PASSWORD /
# MYSQL_DATABASE), so running the precompute inside the Omeka container reuses
# the exact same variables Omeka uses — no separate configuration.
DB_USER = os.environ.get('DB_USER') or os.environ.get('MYSQL_USER', 'omeka')
DB_PASS = os.environ.get('DB_PASS') or os.environ.get('MYSQL_PASSWORD', '')
DB_NAME = os.environ.get('DB_NAME') or os.environ.get('MYSQL_DATABASE', 'omeka')

# Connection mode. By default the precompute shells into a local `db` container
# via `docker compose exec` (cwd = OMEKA_DIR). Set DB_HOST (or rely on the
# container's MYSQL_HOST=db) to connect directly to MySQL via pymysql instead —
# for running inside the Omeka container, or remotely over a VPN — so
# regeneration is not tied to a local Docker stack.
DB_HOST = os.environ.get('DB_HOST') or os.environ.get('MYSQL_HOST')
DB_PORT = int(os.environ.get('DB_PORT', '3306'))

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

# Item set IDs (from Omeka S config).
ITEM_SET_GENRE = 21
ITEM_SET_LANGUAGE = 19
ITEM_SET_RESOURCE_TYPE = 1
ITEM_SET_TARGET_AUDIENCE = 3169
ITEM_SET_PERSON = 18
ITEM_SET_INSTITUTION = 110
ITEM_SET_SUBJECT = 1852
ITEM_SET_PROJECT = 20

# Parent item IDs for category overviews.
OVERVIEW_GENRE = 22198
OVERVIEW_LANGUAGE = 2039
OVERVIEW_RESOURCE_TYPE = 22203
OVERVIEW_TARGET_AUDIENCE = 22479
OVERVIEW_PERSON = 22200
OVERVIEW_INSTITUTION = 22202
OVERVIEW_GROUP = 22536
OVERVIEW_LCSH = 3167
OVERVIEW_TAG = 22199
OVERVIEW_PROJECT = 3346
