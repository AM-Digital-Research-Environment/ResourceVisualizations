#!/usr/bin/env node
/**
 * Design-token contract lint — the DRE-theme check, ported to this module so the
 * "no raw colour in CSS" rule (see the DESIGN CONTRACT header in
 * asset/css/dre-visualizations.css) cannot quietly regress. Mirrors
 * DRE-theme/scripts/check-design-tokens.mjs.
 *
 *   node scripts/check-design-tokens.mjs        (also: npm run lint:tokens)
 *
 * Checks every CSS source under asset/css:
 *   1. Raw hex colours outside var(--x, #hex) fallback position.
 *   2. Coloured border-left/right wider than 1px (the "accent side-stripe" AI
 *      tell). CSS-triangle/chevron borders are allowlisted by file.
 *   3. Gradient text (background-clip: text).
 *   4. px-valued font-size (the type scale is rem-only).
 *
 * The canvas colour palettes (ns.COLORS / ns.HALO) live in JS, not CSS: ECharts
 * and the knowledge-graph canvas cannot parse oklch(), so they are intentionally
 * literal there and are out of scope for this CSS contract.
 *
 * Exit code 1 on any finding; prints file:line for each.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const CSS = join(ROOT, 'asset', 'css');

// Files allowed to hold raw colour values, with the reason on record.
const HEX_ALLOW = [];

// Achromatic legibility anchors — true black / white, NOT brand colours. The
// audit sanctioned these for imagery contexts only: the photo-lightbox backdrop
// and its frosted controls over unknown user photos (DESIGN-ROADMAP V3) and the
// map-label halos (V4). Any *coloured* raw hex is still flagged; this carve-out
// permits #000 / #fff alone.
const HEX_VALUE_ALLOW = new Set(['#000', '#fff', '#000000', '#ffffff']);

// border-left/right >1px that are construction, not decoration. The module's one
// hit is a CSS chevron caret (border-right + border-bottom + rotate(45deg) — a
// rotated corner, not an accent side-stripe), mirroring the theme's chevron
// allowlist.
const STRIPE_ALLOW = ['dre-visualizations.css'];

const findings = [];

function* cssFiles(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* cssFiles(p);
    else if (name.endsWith('.css')) yield p;
  }
}

function stripComments(line) {
  return line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
}

for (const file of cssFiles(CSS)) {
  const rel = relative(ROOT, file).split(sep).join('/');
  const relCss = relative(CSS, file).split(sep).join('/');
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);

  lines.forEach((raw, i) => {
    const line = stripComments(raw);
    const loc = `${rel}:${i + 1}`;

    // 1. Raw hex outside allowlist and outside var() fallback position.
    if (!HEX_ALLOW.includes(relCss)) {
      const noFallbacks = line.replace(/var\(\s*--[\w-]+\s*,[^)]*\)/g, '');
      const noDataUri = noFallbacks.replace(/url\([^)]*\)/g, '').replace(/%23[0-9a-fA-F]{3,6}/g, '');
      const hex = noDataUri.match(/#[0-9a-fA-F]{3,8}\b/);
      if (hex && !HEX_VALUE_ALLOW.has(hex[0].toLowerCase())) {
        findings.push(`${loc}  raw hex outside fallback position: ${hex[0]}`);
      }
    }

    // 2. Side-stripe accents.
    if (!STRIPE_ALLOW.includes(relCss)) {
      if (/border-(left|right)\s*:\s*([2-9]|\d{2,})px\s+\w+\s+(var\(|#|oklch|rgb)/.test(line)) {
        findings.push(`${loc}  coloured side-stripe border: ${line.trim()}`);
      }
    }

    // 3. Gradient text.
    if (/background-clip\s*:\s*text/.test(line)) {
      findings.push(`${loc}  gradient text (background-clip: text)`);
    }

    // 4. px type.
    if (/font-size\s*:\s*\d+px/.test(line)) {
      findings.push(`${loc}  px font-size (the type scale is rem-only): ${line.trim()}`);
    }
  });
}

if (findings.length) {
  console.error(`Design-token contract: ${findings.length} finding(s)\n`);
  for (const f of findings) console.error('  ' + f);
  process.exit(1);
} else {
  console.log('Design-token contract: clean.');
}
