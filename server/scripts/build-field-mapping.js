#!/usr/bin/env node
/**
 * Print the field mapping sheet from the code that actually does the mapping.
 *
 * For a year the sheet was a Word file maintained by hand, and it drifted:
 * it named NetBox fields that do not exist, missed nine of our sixteen object
 * types, and said cables needed a paid plugin we do not use. None of that can
 * happen to a sheet that is generated, because the generator reads the same
 * three files the exporter reads:
 *
 *   model.js    what RackTrack calls each field
 *   mapping.js  what NetBox calls it
 *   cmdb.js     what ServiceNow calls it, and how it is stored
 *
 * The NetBox half has no declarative column list — its payloads are functions —
 * so each one is run once against a recorder that reports which RackTrack
 * field landed on which NetBox key. Two payloads guard on a value being
 * present, so their fields never appear during a probe; those are declared in
 * GUARDED below and checked by the test.
 *
 * Usage:  node scripts/build-field-mapping.js [--out ../docs/netbox]
 * Writes: field-mapping.html  (the readable sheet)
 *         field-mapping.csv   (the same rows, for a spreadsheet)
 */
const fs = require('fs');
const path = require('path');

const model = require('../lib/netbox/model');
const { SPECS: NB_SPECS } = require('../lib/netbox/mapping');
const cmdb = require('../lib/netbox/cmdb');

const CONSTRUCTOR = {
  manufacturers: 'Manufacturer', deviceTypes: 'DeviceType', deviceRoles: 'DeviceRole',
  sites: 'Site', locations: 'Location', racks: 'Rack', devices: 'Device',
  interfaces: 'Interface', rearPorts: 'RearPort', frontPorts: 'FrontPort',
  powerPorts: 'PowerPort', powerOutlets: 'PowerOutlet',
  vlans: 'VLAN', prefixes: 'Prefix', ipAddresses: 'IPAddress', cables: 'Cable',
};

/**
 * Fields whose payload line is guarded, so a probe never sees them.
 * Keep this list short and explain each one; the test asserts they are real.
 */
const GUARDED = {
  racks: { uHeight: 'u_height' },       // omitted when never stated, so NetBox applies its default
  cables: { a: 'a_terminations', b: 'b_terminations' }, // term() returns [] for a missing end
};

/** Run one NetBox payload against a recorder to learn its field pairs. */
function probeNetbox(spec) {
  const out = {};
  const o = new Proxy({}, { get: (_t, p) => (typeof p === 'string' ? `<<${p}>>` : undefined) });
  const ref = (v) => (typeof v === 'string' && v.startsWith('<<') ? v : null);
  let payload;
  try { payload = spec.payload(o, ref); } catch { return out; }
  for (const [key, value] of Object.entries(payload || {})) {
    const found = JSON.stringify(value === undefined ? '' : value).match(/<<(.+?)>>/);
    if (found) out[found[1]] = key;
  }
  return out;
}

/** Every field a RackTrack object carries, in declaration order. */
function fieldsOf(collection) {
  const make = model[CONSTRUCTOR[collection]];
  if (!make) return [];
  return Object.keys(make(model.observed('probe', model.Evidence.MANUAL), {}));
}

const isRef = (f) => /Uid$/.test(f);
const nbHow = (f, key) => (!key ? 'not supported' : isRef(f) ? 'reference' : 'direct field');
const HOW_WORDS = {
  [cmdb.HOW.FIELD]: 'direct field', [cmdb.HOW.CUSTOM]: 'custom u_ column',
  [cmdb.HOW.REF]: 'reference', [cmdb.HOW.REL]: 'relationship row',
  [cmdb.HOW.NONE]: 'not supported',
};

/** Where a spec's rows land, including the five that fold onto another CI. */
function tableOf(spec) {
  if (!spec) return '';
  if (spec.table) return spec.table;
  if (spec.tableFor) return 'by role';
  if (spec.foldsInto) return tableOf(cmdb.BY_FIELD[spec.foldsInto]);
  return '';
}

/**
 * Two fields every object carries are mapped by the writer rather than by a
 * payload line, so no probe can see them. They are the most important rows in
 * the sheet, so they are stated here instead of coming out blank.
 */
function universal(field, collection) {
  if (field === 'uid') {
    return {
      nbField: 'custom_fields.racktrack_uid', nbHow: 'custom field',
      cmField: cmdb.UID_FIELD, cmHow: 'direct field',
      note: 'our stable id; what makes a re-scan update rather than duplicate',
    };
  }
  if (field === 'evidence') {
    return {
      nbField: collection === 'cables' ? 'status' : '',
      nbHow: collection === 'cables' ? 'derived' : 'not supported',
      cmField: 'comments', cmHow: 'direct field',
      note: collection === 'cables'
        ? 'decides connected vs planned'
        : 'written into the provenance line',
    };
  }
  return null;
}

function buildRows() {
  const nbByField = Object.fromEntries(NB_SPECS.map((sp) => [sp.field, sp]));
  const rows = [];

  for (const collection of model.EXPORT_ORDER) {
    const nbSpec = nbByField[collection];
    const cmSpec = cmdb.BY_FIELD[collection];
    const probed = { ...probeNetbox(nbSpec), ...(GUARDED[collection] || {}) };
    // One RackTrack field can feed several CMDB columns: a device type becomes
    // model_id, manufacturer and model_number. Keep them all, joined.
    const cmByFrom = new Map();
    for (const c of (cmSpec ? cmSpec.columns : [])) {
      if (!c.from) continue;
      if (!cmByFrom.has(c.from)) cmByFrom.set(c.from, []);
      cmByFrom.get(c.from).push(c);
    }

    for (const field of fieldsOf(collection)) {
      if (field === 'provenance') continue; // breadcrumbs, folded into comments

      const fixed = universal(field, collection);
      if (fixed) {
        rows.push({ object: nbSpec.label, field, nbObject: nbSpec.netboxType,
                    cmTable: fixed.cmField ? tableOf(cmSpec) : '', ...fixed });
        continue;
      }

      const nbKey = probed[field] || null;
      const all = cmByFrom.get(field) || [];
      // Prefer a real column over a not-supported note when a field has both.
      const cm = all.find((c) => c.how !== cmdb.HOW.NONE) || all[0] || null;
      const extraCols = all.filter((c) => c !== cm && c.cmdb).map((c) => c.cmdb);
      const carried = cm && cm.how !== cmdb.HOW.NONE;
      // A relationship is a record of its own, so it names cmdb_rel_ci and the
      // relationship type rather than a column that does not exist.
      const isRel = cm && cm.how === cmdb.HOW.REL;
      rows.push({
        object: nbSpec.label,
        field,
        nbObject: nbSpec.netboxType,
        nbField: nbKey || '',
        nbHow: nbHow(field, nbKey),
        cmTable: isRel ? 'cmdb_rel_ci' : (carried ? tableOf(cmSpec) : ''),
        cmField: isRel ? cm.rel : [cm && cm.cmdb, ...extraCols].filter(Boolean).join(', '),
        cmHow: cm ? HOW_WORDS[cm.how] : 'not supported',
        note: (cm && cm.note) || '',
      });
    }
  }
  return rows;
}

// ── Output ──────────────────────────────────────────────────────────────────

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const csvCell = (s) => (/[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s));

function toCsv(rows) {
  const head = ['RackTrack object', 'RackTrack field', 'NetBox object', 'NetBox field', 'How',
                'CMDB table', 'CMDB field', 'How', 'Notes'];
  return [head, ...rows.map((r) => [r.object, r.field, r.nbObject, r.nbField, r.nbHow,
                                    r.cmTable, r.cmField, r.cmHow, r.note])]
    .map((line) => line.map(csvCell).join(',')).join('\n') + '\n';
}

function toHtml(rows, when) {
  const mapped = rows.filter((r) => r.nbField && r.cmField).length;
  const cell = (v, cls = '') => `<td class="${cls}">${v ? esc(v) : '<span class="none">-</span>'}</td>`;
  const body = rows.map((r) => `      <tr>
        <td class="obj">${esc(r.object)}</td><td class="f">${esc(r.field)}</td>
        ${cell(r.nbField, 'f')}<td class="how h-${r.nbHow.split(' ')[0]}">${esc(r.nbHow)}</td>
        ${cell(r.cmTable, 'f')}${cell(r.cmField, 'f')}<td class="how h-${r.cmHow.split(' ')[0]}">${esc(r.cmHow)}</td>
        <td class="note">${esc(r.note)}</td>
      </tr>`).join('\n');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>RackTrack field mapping</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&family=Source+Sans+3:wght@400;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<style>
:root{color-scheme:light;--paper:#fbfcfb;--card:#fff;--ink:#161a17;--body:#39423c;--hair:#e6ebe7;
 --hair2:#d9e0db;--soft:#f3f6f4;--blue:#1f6feb;--blue-bg:#eaf1fd;--green:#0b6a44;--green-bg:#e7f2ec;
 --amber:#8a6d1f;--amber-bg:#f8f1de;--grey:#5a6560;
 --serif:"Newsreader",Georgia,serif;--sans:"Source Sans 3",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
 --mono:"IBM Plex Mono",ui-monospace,Menlo,Consolas,monospace;--pad:clamp(16px,3vw,44px)}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--body);font-family:var(--sans);font-size:16px;line-height:1.55}
.page{padding-inline:var(--pad);padding-block:clamp(28px,4vw,48px) 64px}
.eyebrow{font-family:var(--mono);font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--grey)}
h1{font-family:var(--serif);font-weight:500;font-size:clamp(30px,4.5vw,44px);line-height:1.08;color:var(--ink);margin:10px 0 10px;letter-spacing:-.012em}
.sub{font-family:var(--serif);font-size:clamp(17px,2.2vw,20px);color:var(--body);margin:0;max-width:76ch}
.meta{font-family:var(--mono);font-size:12px;color:var(--grey);line-height:1.85;border-top:1px solid var(--hair);padding-top:12px;margin-top:18px}
.stats{display:grid;gap:1px;background:var(--hair2);border:1px solid var(--hair2);border-radius:6px;
 overflow:hidden;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));margin:26px 0 30px}
.stat{background:var(--card);padding:16px 18px}
.stat .v{font-family:var(--mono);font-size:24px;font-weight:600;color:var(--ink);font-variant-numeric:tabular-nums;display:block}
.stat .k{font-size:13.5px;color:var(--grey)}
.scroll{overflow-x:auto;border:1px solid var(--hair2);border-radius:6px;background:var(--card)}
table{border-collapse:collapse;width:100%;font-size:13.5px;min-width:1040px}
thead th{font-family:var(--mono);font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;
 color:var(--grey);text-align:left;padding:11px 12px;border-bottom:1px solid var(--ink);background:var(--soft);
 position:sticky;top:0;white-space:nowrap}
td{padding:8px 12px;border-bottom:1px solid var(--hair);vertical-align:top}
tbody tr:hover{background:var(--soft)}
td.obj{font-weight:600;color:var(--ink);white-space:nowrap}
td.f{font-family:var(--mono);font-size:12.5px;color:var(--ink);word-break:break-word}
td.note{color:var(--grey);font-size:12.5px;max-width:34ch}
.none{color:#b8c2bb}
.how{font-family:var(--mono);font-size:10.5px;font-weight:600;letter-spacing:.05em;white-space:nowrap}
.h-direct{color:var(--green)} .h-reference{color:var(--blue)} .h-relationship{color:var(--amber)}
.h-custom{color:var(--amber)} .h-not{color:#b8c2bb}
.legend{display:flex;flex-wrap:wrap;gap:8px 20px;margin:16px 0 0;font-size:13px;color:var(--grey)}
.legend b{font-family:var(--mono);font-size:10.5px;letter-spacing:.05em}
footer{margin-top:34px;padding-top:16px;border-top:1px solid var(--hair2);font-family:var(--mono);font-size:12px;color:var(--grey);line-height:1.9}
@media(max-width:620px){body{font-size:15px}}
</style></head><body>
<div class="page">
  <div class="eyebrow">Generated from the code</div>
  <h1>RackTrack field mapping</h1>
  <p class="sub">Every field RackTrack holds, what NetBox calls it, what ServiceNow calls it, and how each
  side stores it. Printed directly from the three files the exporter uses, so it cannot describe
  something the software does not do.</p>
  <div class="meta">
    Generated ${when} by server/scripts/build-field-mapping.js<br>
    Sources: server/lib/netbox/model.js, mapping.js, cmdb.js &middot; do not edit this file by hand
  </div>

  <div class="stats">
    <div class="stat"><span class="v">${model.EXPORT_ORDER.length}</span><span class="k">object types</span></div>
    <div class="stat"><span class="v">${rows.length}</span><span class="k">RackTrack fields</span></div>
    <div class="stat"><span class="v">${mapped}</span><span class="k">mapped to both systems</span></div>
    <div class="stat"><span class="v">${cmdb.tables().length}</span><span class="k">CMDB tables written</span></div>
  </div>

  <div class="scroll">
    <table>
      <thead><tr>
        <th>RackTrack object</th><th>RackTrack field</th>
        <th>NetBox field</th><th>How</th>
        <th>CMDB table</th><th>CMDB field</th><th>How</th>
        <th>Notes</th>
      </tr></thead>
      <tbody>
${body}
      </tbody>
    </table>
  </div>

  <div class="legend">
    <span><b>direct field</b> a plain column on the record</span>
    <span><b>reference</b> points at another object by id</span>
    <span><b>relationship row</b> a separate cmdb_rel_ci record, not a column</span>
    <span><b>custom u_ column</b> a column we add to the CI table</span>
    <span><b>not supported</b> we hold it, that system has nowhere to put it</span>
  </div>

  <footer>
    Regenerate with: node server/scripts/build-field-mapping.js<br>
    The same rows are in field-mapping.csv, for opening in a spreadsheet.
  </footer>
</div></body></html>
`;
}

function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(__dirname, '..', '..', 'docs', 'netbox');
  const when = new Date().toISOString().slice(0, 10);

  const rows = buildRows();
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'field-mapping.html'), toHtml(rows, when));
  fs.writeFileSync(path.join(outDir, 'field-mapping.csv'), toCsv(rows));

  const both = rows.filter((r) => r.nbField && r.cmField).length;
  process.stdout.write(
    `field mapping: ${rows.length} fields across ${model.EXPORT_ORDER.length} objects, ` +
    `${both} mapped to both systems\n  ${path.join(outDir, 'field-mapping.html')}\n` +
    `  ${path.join(outDir, 'field-mapping.csv')}\n`);
}

if (require.main === module) main();

module.exports = { buildRows, probeNetbox, fieldsOf, GUARDED, toCsv };
