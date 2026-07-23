// generic_recipe.js — data-driven poller recipes for the vendors in
// data/switch_cli_matrix.json (converted from the verified Switch_CLI matrix).
//
// The hand-written recipes (cisco-ios, tplink in port_poller.js) parse every
// port row exactly, because each vendor prints `show interfaces status` in its
// own column layout. We do NOT have a verified parser for the other ~50
// vendors, and inventing one would emit confident-but-wrong port/PoE/VLAN data.
//
// So a generic recipe does only what can be done safely across vendors:
//   • runs the vendor's OWN verified commands (identity, status, config, lldp,
//     poe, vlans) from the matrix,
//   • parses the identity output best-effort into device metadata (model,
//     version, serial, MAC, hostname — the fields that appear in predictable
//     forms across CLIs),
//   • returns NO port rows (rows: []) — the port table stays empty for a
//     generic vendor rather than showing guessed data,
//   • keeps every command's raw output under `raw` so the UI can show it
//     verbatim ("parser pending for this vendor") and a real parser can be
//     written later from real output.
//
// A vendor graduates from generic to exact by getting a hand-written recipe in
// port_poller.js; until then it is honestly partial, never wrong.

const fs = require('fs');
const path = require('path');

let _matrix = null;
function matrix() {
  if (_matrix) return _matrix;
  try {
    _matrix = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'switch_cli_matrix.json'), 'utf8'));
  } catch { _matrix = {}; }
  return _matrix;
}

// The matrix cells are a verified REFERENCE, so they carry doc notation a real
// CLI would reject: optional args in [brackets], notes in (parens) or {braces},
// placeholders in <angle>, and several commands joined with "+" or newlines.
// Reduce a cell to the single, executable base command.
function cleanCommand(cell) {
  if (!cell) return null;
  // First command only: split on "+" or a newline, take the first clause.
  let cmd = String(cell).split(/\s*\+\s*|\n/)[0];
  // Remove [optional] / {alt} / (note) / <placeholder> groups, looping so
  // NESTED brackets (D-Link "[INTERFACE-ID [- | ...]]") fully unwind.
  let prev;
  do {
    prev = cmd;
    cmd = cmd
      .replace(/\[[^[\]]*\]/g, ' ')
      .replace(/\{[^{}]*\}/g, ' ')
      .replace(/\([^()]*\)/g, ' ')
      .replace(/<[^<>]*>/g, ' ');
  } while (cmd !== prev);
  // Truncate at any leftover bracket/brace/angle or an option pipe — the base
  // command is everything before the first of them.
  cmd = cmd.split(/[[\]{}<>|]/)[0];
  cmd = cmd.replace(/\bNUMBER\b/gi, ' ').replace(/\s+/g, ' ').trim();
  return cmd || null;
}

// Paging-off is a single control command. Some vendors don't have one — their
// matrix cell is prose ("config system console -> set output standard", "no
// pager by default", "append `without-paging`"). Return null for those rather
// than sending prose down the SSH channel; the poll still runs, output just
// isn't de-paged (the SSH runner tolerates a pager prompt).
function cleanPaging(cell) {
  if (!cell) return null;
  // Multi-step or descriptive → not a single command we can send.
  if (/->|`|\bby default\b|\bappend\b|\bflag\b/i.test(String(cell))) return null;
  // Version alternatives separated by "/" ("disable clipaging (≤22.x) / …").
  let base = cleanCommand(String(cell).split(/\s*\/\s*/)[0]);
  if (!base) return null;
  if (/\blength\b/i.test(base) && !/\d/.test(base)) {
    base = base.replace(/\blength\b/i, 'length 0');
  }
  return base.length <= 30 ? base : null;
}

// Best-effort identity extraction — only fields that appear in a recognisable
// form across vendor CLIs. Anything not confidently found stays null rather
// than being guessed.
function parseGenericIdentity(raw) {
  const text = String(raw || '').replace(/\r/g, '');
  const pick = (re) => { const m = text.match(re); return m ? m[1].trim() : null; };
  return {
    system_description: pick(/^([A-Za-z][^\n]{6,120}(?:Software|Version|System|OS)[^\n]*)/mi),
    sw_version: pick(/(?:Version|Firmware|Software Version|OS Version|Release)\s*[:=]?\s*v?([0-9][^\s,;]*)/i),
    system_name: pick(/(?:System Name|Hostname|Device Name|sysName|Name)\s*[:=]\s*([^\n,]+)/i)
      || pick(/^(\S+)\s+uptime is/mi),
    serial: pick(/(?:Serial(?:\s*Number)?|SN|Serial No\.?|ESN)\s*[:=]?\s*([A-Za-z0-9-]{4,})/i),
    mac: pick(/(?:Base (?:ethernet )?MAC(?: Address)?|System MAC|MAC Address)\s*[:=]?\s*([0-9A-Fa-f]{2}(?:[:.-][0-9A-Fa-f]{2}){2,7})/i),
    hw_version: pick(/(?:Hardware(?: Version| Rev(?:ision)?)?|HW)\s*[:=]\s*([^\n,]+)/i),
    system_location: null,
    model: pick(/(?:Model(?:\s*(?:Name|Number|No\.?))?|Product(?:\s*(?:Name|Model))?|PID)\s*[:=]\s*([^\n,]+)/i),
  };
}

// Build a poller-shaped recipe for a matrix vendor. Returns null for a vendor
// not in the matrix. `generic: true` lets callers label the result.
function buildGenericRecipe(vendorKey) {
  const m = matrix()[vendorKey];
  if (!m) return null;

  const commands = [];
  const add = (key, cell) => { const c = cleanCommand(cell); if (c) commands.push({ key, cmd: c }); };
  add('sysinfo', m.identity);
  add('status',  m.port_status);
  add('config',  m.port_config);
  add('lldp',    m.lldp);
  add('poe',     m.poe);
  add('vlans',   m.vlans);

  return {
    label: m.label || vendorKey,
    generic: true,
    pagingOff: cleanPaging(m.paging_off),
    // Most non-Cisco managed switches don't gate reads behind an enable mode;
    // when they do, the read simply returns a permission error, which the SSH
    // runner records per-command and the parser tolerates.
    enable: undefined,
    commands,
    parse(outputs) {
      const meta = parseGenericIdentity(outputs.sysinfo || '');
      // No port rows: we will not guess a port layout we haven't verified.
      return { rows: [], meta, raw: { ...outputs }, generic: true };
    },
  };
}

function matrixVendors() {
  return Object.entries(matrix()).map(([key, v]) => ({ key, label: v.label || key }));
}

module.exports = { buildGenericRecipe, matrixVendors, cleanCommand, cleanPaging, parseGenericIdentity };
