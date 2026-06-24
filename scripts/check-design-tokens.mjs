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
 *   4. Off-scale type: a raw px/rem font-size instead of --rv-text-* / --text-*.
 *   5. Off-scale spacing: a raw rem margin/padding/gap instead of
 *      --rv-space-* / --space-*. (em is intentional — it scales with the
 *      element's own text, e.g. pill badges — and the photo-browser's px hairline
 *      gaps are their own sub-grid idiom, so neither is flagged. var() fallbacks
 *      for non-DRE hosts are always allowed.)
 *
 * DESIGN.md §9 rule 4 — "Don't invent parallel scales" — is what rules 4 & 5
 * enforce: the module's spacing & type must ride the theme's --space-* / --text-*
 * (via the --rv-* aliases), never a hand-set literal that drifts off the scale.
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

// Strip comments while carrying the open-block state across lines, so prose
// inside a multi-line /* … */ (this file has plenty) can never trip a rule.
function stripComments(raw, inBlock) {
  let out = '';
  for (let i = 0; i < raw.length; ) {
    if (inBlock) {
      const end = raw.indexOf('*/', i);
      if (end === -1) { i = raw.length; } else { inBlock = false; i = end + 2; }
    } else if (raw[i] === '/' && raw[i + 1] === '/') {
      break;                                  // line comment — drop the rest
    } else if (raw[i] === '/' && raw[i + 1] === '*') {
      inBlock = true; i += 2;
    } else {
      out += raw[i]; i++;
    }
  }
  return { code: out, inBlock };
}

for (const file of cssFiles(CSS)) {
  const rel = relative(ROOT, file).split(sep).join('/');
  const relCss = relative(CSS, file).split(sep).join('/');
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);

  let inBlock = false;
  lines.forEach((raw, i) => {
    const stripped = stripComments(raw, inBlock);
    const line = stripped.code;
    inBlock = stripped.inBlock;
    const loc = `${rel}:${i + 1}`;

    // Drop var(--x, fallback) so the rules only ever see the *active* value, not
    // the on-brand fallback a non-DRE host would use.
    const noFallbacks = line.replace(/var\(\s*--[\w-]+\s*,[^)]*\)/g, '');

    // 1. Raw hex outside allowlist and outside var() fallback position.
    if (!HEX_ALLOW.includes(relCss)) {
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

    // 4. Off-scale type — a raw px/rem font-size (var() fallbacks excepted).
    const fontVal = noFallbacks.match(/font-size\s*:\s*([^;{}]*)/i);
    if (fontVal && /-?\d*\.?\d+(px|rem)\b/.test(fontVal[1])) {
      findings.push(`${loc}  raw font-size — use --rv-text-* / --text-*: ${line.trim()}`);
    }

    // 5. Off-scale spacing — a raw rem margin/padding/gap (em / px-grid excepted).
    const spaceVal = noFallbacks.match(/(?:^|[\s;{])(?:margin|padding|gap|row-gap|column-gap)(?:-[a-z]+)?\s*:\s*([^;{}]*)/i);
    if (spaceVal && /-?\d*\.?\d+rem\b/.test(spaceVal[1])) {
      findings.push(`${loc}  raw rem spacing — use --rv-space-* / --space-*: ${line.trim()}`);
    }

    // 6. Off-scale radius — border-radius must use --rv-radius* / --radius-* (or the
    //    full round). 50% circles and 0 are not on the radius scale and are allowed.
    const radVal = noFallbacks.match(/border-radius\s*:\s*([^;{}]*)/i);
    if (radVal && /-?\d*\.?\d+(px|rem)\b/.test(radVal[1])) {
      findings.push(`${loc}  raw border-radius — use --rv-radius* / --radius-*: ${line.trim()}`);
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
