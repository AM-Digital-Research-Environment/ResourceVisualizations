#!/usr/bin/env node
/**
 * Dependency-free JavaScript syntax sweep for shipped browser assets.
 *
 * The module ships plain JS with no bundler, so `node --check` is the cheapest
 * local guard against parse errors before the files reach Omeka.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = join(import.meta.dirname, '..');
const JS_DIR = join(ROOT, 'asset', 'js');
const files = [];

function collect(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      collect(path);
    } else if (name.endsWith('.js')) {
      files.push(path);
    }
  }
}

collect(JS_DIR);
files.sort();

let failures = 0;
for (const file of files) {
  const rel = relative(ROOT, file).split(sep).join('/');
  const result = spawnSync(process.execPath, ['--check', file], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    failures++;
    console.error(`JS syntax failed: ${rel}`);
    if (result.stderr) console.error(result.stderr.trim());
    if (result.stdout) console.error(result.stdout.trim());
  }
}

if (failures) {
  console.error(`JavaScript syntax: ${failures} file(s) failed.`);
  process.exit(1);
}

console.log(`JavaScript syntax: ${files.length} files clean.`);
