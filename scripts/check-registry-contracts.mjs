#!/usr/bin/env node
/**
 * Static contract checks for hand-maintained visualization registries.
 *
 * These files intentionally stay build-free, but the chart asset chain, layout
 * keys, registry keys and embed slugs still need to move together. This script
 * catches drift without requiring Omeka or a browser.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import vm from 'node:vm';

const ROOT = join(import.meta.dirname, '..');
const failures = [];

function rel(path) {
  return relative(ROOT, path).split(sep).join('/');
}

function fail(message) {
  failures.push(message);
}

function read(path) {
  return readFileSync(path, 'utf8');
}

function extractBlock(source, constName) {
  const start = source.indexOf(`const ${constName} = [`);
  if (start === -1) {
    fail(`DashboardAssets.php: missing ${constName}`);
    return '';
  }
  const from = source.indexOf('[', start);
  let depth = 0;
  for (let i = from; i < source.length; i++) {
    const ch = source[i];
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return source.slice(from, i + 1);
    }
  }
  fail(`DashboardAssets.php: could not parse ${constName}`);
  return '';
}

function quotedStrings(source) {
  return [...source.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

function loadRegistries() {
  const context = {
    window: { RV: { charts: new Proxy({}, { get: () => function noop() {} }) } },
  };
  context.global = context.window;
  vm.createContext(context);
  vm.runInContext(read(join(ROOT, 'asset/js/dashboard-layouts.js')), context, {
    filename: 'asset/js/dashboard-layouts.js',
  });
  vm.runInContext(read(join(ROOT, 'asset/js/dashboard-registry.js')), context, {
    filename: 'asset/js/dashboard-registry.js',
  });
  return context.window.RV;
}

function checkDashboardAssets() {
  const file = join(ROOT, 'src/View/Helper/DashboardAssets.php');
  const source = read(file);
  const scripts = quotedStrings(extractBlock(source, 'CHART_SCRIPTS'));
  for (const script of scripts) {
    const path = join(ROOT, 'asset', script.replace(/^asset\//, ''));
    if (!existsSync(path)) fail(`DashboardAssets CHART_SCRIPTS missing file: ${script}`);
  }

  const controllerScripts = quotedStrings(extractBlock(source, 'CONTROLLERS'))
    .filter((value) => value.startsWith('js/'));
  for (const script of controllerScripts) {
    const path = join(ROOT, 'asset', script);
    if (!existsSync(path)) fail(`DashboardAssets CONTROLLERS missing file: ${script}`);
  }
}

function checkLayouts(rv) {
  const map = rv.CHART_MAP || {};
  const labels = rv.CHART_LABELS || {};
  const layouts = Object.assign({ DEFAULT_LAYOUT: rv.DEFAULT_LAYOUT }, rv.LAYOUTS || {});

  for (const [name, layout] of Object.entries(layouts)) {
    const order = new Set(layout.order || []);
    for (const key of order) {
      if (!Object.prototype.hasOwnProperty.call(map, key)) {
        fail(`Layout ${name} references chart key without CHART_MAP entry: ${key}`);
      }
    }
    for (const bucket of ['wide', 'tall']) {
      for (const key of layout[bucket] || []) {
        if (!order.has(key)) {
          fail(`Layout ${name}.${bucket} contains key not present in order: ${key}`);
        }
      }
    }
  }

  for (const key of Object.keys(map)) {
    if (!Object.prototype.hasOwnProperty.call(labels, key)) {
      fail(`CHART_MAP key has no CHART_LABELS entry: ${key}`);
    }
  }
}

function parseEmbedBlocks() {
  const source = read(join(ROOT, 'src/Controller/Site/EmbedController.php'));
  const start = source.indexOf('const BLOCKS = [');
  if (start === -1) {
    fail('EmbedController.php: missing BLOCKS');
    return [];
  }
  const end = source.indexOf('];', start);
  const block = source.slice(start, end);
  const entries = [];
  const re = /'([^']+)'\s*=>\s*\[(.*?)\n\s*\]/gs;
  let match;
  while ((match = re.exec(block)) !== null) {
    const body = match[2];
    const get = (key) => {
      const m = new RegExp(`'${key}'\\s*=>\\s*'([^']+)'`).exec(body);
      return m ? m[1] : '';
    };
    entries.push({
      slug: match[1],
      template: get('template'),
      kind: get('kind'),
      layout: get('layout'),
    });
  }
  return entries;
}

function checkEmbeds(rv) {
  const layouts = rv.LAYOUTS || {};
  for (const entry of parseEmbedBlocks()) {
    const templatePath = join(ROOT, 'view/common/block-layout', `${entry.template}.phtml`);
    if (!entry.template || !existsSync(templatePath)) {
      fail(`Embed block ${entry.slug} references missing template: ${entry.template}`);
      continue;
    }
    const template = read(templatePath);
    if (!template.includes(`data-embed-slug="${entry.slug}"`)) {
      fail(`Embed block ${entry.slug} template lacks matching data-embed-slug`);
    }
    if (entry.kind === 'dashboard' && !layouts[entry.layout]) {
      fail(`Embed dashboard ${entry.slug} references missing layout: ${entry.layout}`);
    }
  }
}

checkDashboardAssets();
const rv = loadRegistries();
checkLayouts(rv);
checkEmbeds(rv);

if (failures.length) {
  console.error(`Registry contracts: ${failures.length} finding(s)\n`);
  for (const message of failures) console.error('  ' + message);
  process.exit(1);
}

console.log('Registry contracts: clean.');
