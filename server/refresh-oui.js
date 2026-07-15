#!/usr/bin/env node
// Rebuild data/oui-vendors.json from the IEEE OUI registry.
//
// The registry maps each manufacturer's 3-byte MAC prefix to the company that
// registered it, which is what lets the Ports → Cables view name a downstream
// device's maker. Run this occasionally; new blocks are assigned monthly.
//
//   node server/refresh-oui.js
//
// Entries registered as "Private" are skipped: the owner paid the IEEE to hide
// the name, so there is nothing useful to show.

const fs = require('fs');
const path = require('path');

const SOURCE = 'https://standards-oui.ieee.org/oui/oui.csv';
const DEST = path.join(__dirname, 'data', 'oui-vendors.json');
const MAX_NAME = 28;

// Legal suffixes ("Inc", "GmbH", "Co., Ltd.") are noise in a 28-char cell.
const SUFFIX = /[,.]?\s*(Inc|Corp|Corporation|Ltd|Limited|LLC|GmbH|Co|Company|S\.A\.|B\.V\.|A\/S|AB|AG|SAS|Pte|Pty|PLC|N\.V\.|S\.p\.A\.|Technologies|Technology)\b\.?/gi;

// Minimal CSV field splitter — the registry quotes any field containing commas.
function splitCsvLine(line) {
  const out = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// Some registrants shout ("REALTEK SEMICONDUCTOR CORP."). Title-case those, but
// leave short words alone so acronyms survive (HP, IBM, ZTE, ASIX, TP-Link).
function unshout(name) {
  if (/[a-z]/.test(name)) return name;
  return name.replace(/[A-Z][A-Z'-]*/g, w =>
    w.length <= 3 ? w : w[0] + w.slice(1).toLowerCase());
}

function tidy(name) {
  const cleaned = unshout(name)
    .replace(SUFFIX, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/^[,.\s]+|[,.\s]+$/g, '');
  return cleaned.slice(0, MAX_NAME) || null;
}

(async () => {
  process.stdout.write(`Fetching ${SOURCE} ...\n`);
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`IEEE registry returned HTTP ${res.status}`);
  const csv = await res.text();

  const table = {};
  const lines = csv.split('\n').slice(1);   // drop the header row
  for (const line of lines) {
    if (!line.trim()) continue;
    const [, assignment, org] = splitCsvLine(line);
    const key = (assignment || '').trim().toUpperCase();
    if (key.length !== 6) continue;
    const raw = (org || '').trim();
    if (!raw || /^(private|ieee registration authority)$/i.test(raw)) continue;
    const name = tidy(raw);
    if (name) table[key] = name;
  }

  const count = Object.keys(table).length;
  if (count < 10000) throw new Error(`Only parsed ${count} entries — registry format may have changed.`);

  fs.mkdirSync(path.dirname(DEST), { recursive: true });
  fs.writeFileSync(DEST, JSON.stringify(table, Object.keys(table).sort()));
  process.stdout.write(`Wrote ${count} vendor prefixes to ${DEST}\n`);
})().catch(err => {
  process.stderr.write(`refresh-oui failed: ${err.message}\n`);
  process.exit(1);
});
