#!/usr/bin/env node
// Put every font-size and font-weight in the app on the type scale.
//
// The scale lives in src/index.css (--fs-*, --fw-*). This script finds raw
// sizes and weights - in stylesheets and in inline JSX styles - and rewrites
// each one as the token it is nearest to. It is the sweep, not the scale: it
// never invents a size, it only stops the app from writing the same intention
// nine different ways.
//
// Run it again after any branch merges. It is idempotent - a value already
// written as var(--fs-…) is left alone - so a second run over a swept tree
// reports zero changes.
//
//     cd client && node scripts/sweep-type.mjs          # rewrite in place
//     cd client && node scripts/sweep-type.mjs --check   # report only
//
// --check exits 1 when something is still off the scale, so it can guard a
// branch before it lands.

import { readFileSync, writeFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = new URL('../src/', import.meta.url).pathname;
const CHECK = process.argv.includes('--check');
const VERBOSE = process.argv.includes('--verbose');

// ── The scale ────────────────────────────────────────────────────────────
// Ascending, and it must match src/index.css. A size lands on the step it is
// nearest to; a tie goes to the SMALLER step, so the sweep never grows text
// it did not have to.
const SIZES = [
  [10, 'micro'],
  [11, 'label'],
  [12, 'sub'],
  [13, 'body'],
  [14, 'item'],
  [15, 'section'],
  [18, 'head'],
  [22, 'page'],
];
// A tie goes to the HEAVIER weight: losing emphasis reads as a bug, gaining a
// notch reads as intent. Only 500 is ever a tie.
const WEIGHTS = [[400, 'body'], [600, 'label'], [700, 'title']];

// Below this, the size is not UI text: it is a dense rack, port or topology
// overlay, or it is text inside an SVG viewBox where the unit is a user unit
// and 11px would be the size of the whole diagram. Above it, the size is a
// display number - a splash, a hero count - which the scale does not govern.
const FLOOR = 9.6;
const CEIL = 23.9;

// ── What the sweep may not touch ─────────────────────────────────────────
// The scale itself, the @font-face file, and dead code.
const SKIP_ALWAYS = [
  'index.css',
  'fonts.css',
  `pages${sep}_archive`,
];
// Other people's open work. Their STYLESHEETS are still swept - that is
// mechanical and this script can be re-run - but their JSX is left alone so a
// sweep never lands in the middle of someone's edit.
const SKIP_JSX = [
  `pages${sep}ScanPage.jsx`,
  `pages${sep}SetupPage.jsx`,
  `pages${sep}DriftPage.jsx`,
  `pages${sep}ReportPage.jsx`,
  `pages${sep}ResultsPage.jsx`,
  `components${sep}AssignedNotice.jsx`,
  `components${sep}orgsettings${sep}`,
];

// ── Value parsing ────────────────────────────────────────────────────────
const px = (raw) => {
  const v = raw.trim().replace(/!important\s*$/, '').trim().replace(/^['"]|['"]$/g, '').trim();
  if (!v) return null;
  let m = /^(\d*\.?\d+)px$/.exec(v);
  if (m) return Number(m[1]);
  m = /^(\d*\.?\d+)rem$/.exec(v);
  if (m) return Number(m[1]) * 16;
  m = /^(\d*\.?\d+)$/.exec(v); // a bare number, as React writes it
  if (m) return Number(m[1]);
  return null;
};

const nearest = (value, ladder, tieUp) => {
  let best = ladder[0];
  let bestGap = Math.abs(value - ladder[0][0]);
  for (const step of ladder.slice(1)) {
    const gap = Math.abs(value - step[0]);
    if (tieUp ? gap <= bestGap : gap < bestGap) { best = step; bestGap = gap; }
  }
  return best;
};

const sizeToken = (value, mono) => {
  const [, name] = nearest(value, SIZES, false);
  // A rack id, a shelf, a port or an incident number sets in --mono, and the
  // scale gives it its own name at the same size so the intention is on the
  // page. --fs-sub and --fs-mono are both 12px.
  return mono && name === 'sub' ? '--fs-mono' : `--fs-${name}`;
};
const weightToken = (value) => `--fw-${nearest(value, WEIGHTS, true)[1]}`;

// ── Walk ─────────────────────────────────────────────────────────────────
const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { walk(full, out); continue; }
    if (/\.(css|jsx)$/.test(name)) out.push(full);
  }
  return out;
};

const tally = { size: 0, weight: 0, files: new Set(), left: [] };
const record = (rel, line, prop, value, why) => {
  tally.left.push({ rel, line, prop, value: value.trim(), why });
};

// Does this declaration block set --mono as its font-family? Used only to pick
// between two names for the same 12px.
const monoBlocks = (css) => {
  const spans = [];
  const re = /\{[^{}]*\}/g;
  let m;
  while ((m = re.exec(css))) {
    if (/font-family:[^;}]*--mono/.test(m[0]) || /font-family:[^;}]*mono/.test(m[0])) {
      spans.push([m.index, m.index + m[0].length]);
    }
  }
  return (at) => spans.some(([a, b]) => at >= a && at < b);
};

const sweepCss = (rel, src) => {
  const isMono = monoBlocks(src);
  let lineOf = (idx) => src.slice(0, idx).split('\n').length;
  let out = src;
  // Work on the original offsets by collecting edits first.
  const edits = [];
  const add = (re, kind) => {
    let m;
    const rx = new RegExp(re.source, 'g');
    while ((m = rx.exec(src))) {
      const whole = m[0];
      const value = m[1];
      if (/var\(/.test(value)) continue;                 // already on the scale
      if (/type-sweep: *keep/.test(src.slice(m.index - 90, m.index))) {
        record(rel, lineOf(m.index), kind, value, 'pinned with a type-sweep comment');
        continue;
      }
      const bang = /!important/.test(value) ? ' !important' : '';
      const n = px(value);
      if (n === null) { record(rel, lineOf(m.index), kind, value, 'not a plain px or rem value'); continue; }
      if (kind === 'font-size') {
        if (n < FLOOR) { record(rel, lineOf(m.index), kind, value, 'below the scale - dense overlay or SVG user units'); continue; }
        if (n > CEIL) { record(rel, lineOf(m.index), kind, value, 'above the scale - a display number'); continue; }
        edits.push([m.index, m.index + whole.length, `font-size: var(${sizeToken(n, isMono(m.index))})${bang};`]);
        tally.size += 1;
      } else {
        edits.push([m.index, m.index + whole.length, `font-weight: var(${weightToken(n)})${bang};`]);
        tally.weight += 1;
      }
    }
  };
  add(/font-size:\s*([^;{}]+);/, 'font-size');
  add(/font-weight:\s*([^;{}]+);/, 'font-weight');
  edits.sort((a, b) => b[0] - a[0]);
  for (const [a, b, text] of edits) out = out.slice(0, a) + text + out.slice(b);
  return out;
};

const sweepJsx = (rel, src) => {
  let lineOf = (idx) => src.slice(0, idx).split('\n').length;
  let out = src;
  const edits = [];
  const add = (re, kind) => {
    let m;
    const rx = new RegExp(re.source, 'g');
    while ((m = rx.exec(src))) {
      const value = m[2];
      if (/var\(/.test(value)) continue;
      const n = px(value);
      if (n === null) { record(rel, lineOf(m.index), kind, value, 'computed at run time, not a literal'); continue; }
      if (kind === 'fontSize') {
        if (n < FLOOR) { record(rel, lineOf(m.index), kind, value, 'below the scale - dense overlay or SVG user units'); continue; }
        if (n > CEIL) { record(rel, lineOf(m.index), kind, value, 'above the scale - a display number'); continue; }
        edits.push([m.index, m.index + m[0].length, `${m[1]}'var(${sizeToken(n, false)})'`]);
        tally.size += 1;
      } else {
        edits.push([m.index, m.index + m[0].length, `${m[1]}'var(${weightToken(n)})'`]);
        tally.weight += 1;
      }
    }
  };
  // fontSize: 13   fontSize:13   fontSize: '.78rem'   fontSize: '16px'
  add(/(fontSize:\s*)('[^']*'|"[^"]*"|[\d.]+)(?=\s*[,}])/, 'fontSize');
  add(/(fontWeight:\s*)('[^']*'|"[^"]*"|[\d.]+)(?=\s*[,}])/, 'fontWeight');
  edits.sort((a, b) => b[0] - a[0]);
  for (const [a, b, text] of edits) out = out.slice(0, a) + text + out.slice(b);
  return out;
};

for (const full of walk(ROOT).sort()) {
  const rel = relative(ROOT, full);
  if (SKIP_ALWAYS.some((s) => rel.includes(s))) continue;
  const isJsx = rel.endsWith('.jsx');
  if (isJsx && SKIP_JSX.some((s) => rel.includes(s))) continue;
  const src = readFileSync(full, 'utf8');
  const out = isJsx ? sweepJsx(rel, src) : sweepCss(rel, src);
  if (out === src) continue;
  tally.files.add(rel);
  if (!CHECK) writeFileSync(full, out);
}

const byReason = tally.left.reduce((acc, r) => {
  acc[r.why] = (acc[r.why] || 0) + 1;
  return acc;
}, {});

console.log(`${CHECK ? 'off the scale' : 'rewritten'}: ${tally.size} sizes, ${tally.weight} weights, in ${tally.files.size} files`);
console.log('left alone:');
for (const [why, n] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${why}`);
}
if (VERBOSE) {
  for (const r of tally.left) console.log(`  ${r.rel}:${r.line}  ${r.prop}: ${r.value}   (${r.why})`);
}
if (CHECK && tally.size + tally.weight > 0) process.exit(1);
