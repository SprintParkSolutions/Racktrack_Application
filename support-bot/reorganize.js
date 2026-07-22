#!/usr/bin/env node
/**
 * Reorganize the knowledge base into categories a human can navigate.
 *
 * The domain names currently in the knowledge base are pipeline artifacts, not
 * categories. They arrived three ways and it shows:
 *   - hand-picked slugs   ops, acct, rpt, accur      (cryptic)
 *   - agent free-text     multi-rack-topology-and-side-by-side-comparison
 *   - process state       pend-integrations, pend-misc
 *
 * "pend-" meant "pending verification" — a stage in MY build, leaked into the
 * product. Worse, it split six topics in half: `accur` and `pend-accuracy` are
 * the same subject, sitting in different buckets purely because they were
 * verified on different days.
 *
 * This maps everything onto one flat set of categories named for what the user
 * is trying to DO, merges the split pairs, and renumbers ids consistently.
 *
 *   node reorganize.js            # show the mapping and what merges
 *   node reorganize.js --write    # apply
 */

import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const KB = process.env.KB_PATH || join(REPO, 'server', 'data', 'support-kb.json')
const WRITE = process.argv.includes('--write')

/**
 * The categories. Ordered roughly by how early a user meets them, which is also
 * the order they are listed in the UI — a new user's problems cluster at the
 * top, an admin's at the bottom.
 *
 * `id` is the citation prefix (kept short: it appears in every SOURCES line).
 * `label` is what a human reads. `blurb` explains the category in the browser.
 */
const CATEGORIES = [
  { key: 'signing-in',    id: 'SIGNIN', label: 'Signing in',            blurb: 'Logging in, passwords, sessions and being locked out.' },
  { key: 'account',       id: 'ACCT',   label: 'Your account & team',   blurb: 'Joining an organization, invites, roles and what each role can do.' },
  { key: 'the-app',       id: 'APP',    label: 'Installing the app',    blurb: 'Getting RackTrack onto a phone or tablet, updates and device problems.' },
  { key: 'getting-around',id: 'NAV',    label: 'Finding your way',      blurb: 'Screens, navigation and where to find a feature.' },
  { key: 'scanning',      id: 'SCAN',   label: 'Scanning a rack',       blurb: 'Capturing a rack, what the camera needs, and scans that fail or come back empty.' },
  { key: 'results',       id: 'RES',    label: 'Reading results',       blurb: 'Understanding what a scan produced — units, ports, cables and the 3D view.' },
  { key: 'accuracy',      id: 'FIX',    label: 'When it gets it wrong', blurb: 'Wrong port counts, misidentified devices, and how to correct them.' },
  { key: 'racks',         id: 'RACK',   label: 'Racks & topology',      blurb: 'Multi-rack views, comparing racks, and the topology map.' },
  { key: 'devices',       id: 'DEV',    label: 'Device details',        blurb: 'Specifications, vendor identification and switch information.' },
  { key: 'firmware',      id: 'FW',     label: 'Firmware & security',   blurb: 'Firmware versions and security advisories on your equipment.' },
  { key: 'history',       id: 'HIST',   label: 'Past work',             blurb: 'Finding earlier scans and audits, and what is kept.' },
  { key: 'reports',       id: 'RPT',    label: 'Reports & exports',     blurb: 'Generating a report, export formats, and empty or failed exports.' },
  { key: 'offline',       id: 'SYNC',   label: 'Working offline',       blurb: 'What works with no signal, and how work syncs back.' },
  { key: 'marketplace',   id: 'MKT',    label: 'Marketplace',           blurb: 'Buying and selling equipment through RackTrack.' },
  { key: 'integrations',  id: 'INTEG',  label: 'Connected systems',     blurb: 'ServiceNow, the CMDB and network data sources.' },
  { key: 'admin',         id: 'ADMIN',  label: 'Running RackTrack',     blurb: 'Operations Console, logs and platform administration.' },
  { key: 'help',          id: 'HELP',   label: 'Getting help',          blurb: 'Using the assistant and reaching a person.' },
]

const BY_KEY = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]))

/**
 * Old domain → category. Every historical name is listed explicitly rather than
 * pattern-matched: a silent fallback would quietly dump anything unrecognised
 * into one bucket, and that is exactly how the mess started.
 */
const MAP = {
  auth: 'signing-in',
  acct: 'account',
  app: 'the-app',
  'navigation-and-home-screens': 'getting-around',
  nav: 'getting-around',
  scan: 'scanning',
  scanning: 'scanning',
  howto: 'results',
  'pend-howto': 'results',
  accur: 'accuracy',
  'pend-accuracy': 'accuracy',
  'multi-rack-topology-and-side-by-side-comparison': 'racks',
  multirack: 'racks',
  'device-specifications': 'devices',
  specs: 'devices',
  firmware: 'firmware',
  'history-past-scans': 'history',
  history: 'history',
  rpt: 'reports',
  'pend-reports': 'reports',
  sync: 'offline',
  marketplace: 'marketplace',
  'marketplace-a': 'marketplace',
  'marketplace-b': 'marketplace',
  integ: 'integrations',
  'pend-integrations': 'integrations',
  connections: 'integrations',
  'connections-a': 'integrations',
  'connections-b': 'integrations',
  ops: 'admin',
  'server-internals': 'admin',
  'tenant-mat': 'admin',
  'getting-help': 'help',
  'profile-appearance': 'account',
  'visual-aids': 'results',
  'firmware-rest': 'firmware',
  // Genuinely mixed bucket from the salvage; routed by content below.
  'pend-misc': null,
}

/** Last resort for entries whose old domain carried no meaning. */
function guessFromContent(entry) {
  const t = `${entry.question} ${entry.answer}`.toLowerCase()
  const rules = [
    [/\b(log ?in|sign ?in|password|session|locked out)\b/, 'signing-in'],
    [/\b(scan|camera|shutter|photo|capture)\b/, 'scanning'],
    [/\b(report|export|csv|pdf|download)\b/, 'reports'],
    [/\b(offline|sync|no signal|upload)\b/, 'offline'],
    [/\b(invite|role|member|organi[sz]ation|permission)\b/, 'account'],
    [/\b(install|update|version|ipa|apk|device)\b/, 'the-app'],
    [/\b(servicenow|cmdb|netdisco|connection profile)\b/, 'integrations'],
    [/\b(firmware|cve|advisory)\b/, 'firmware'],
    [/\b(topology|multi-?rack|side by side)\b/, 'racks'],
    [/\b(port count|wrong|misidentif|incorrect)\b/, 'accuracy'],
  ]
  for (const [re, key] of rules) if (re.test(t)) return key
  return 'results'
}

const kb = JSON.parse(readFileSync(KB, 'utf8'))
const entries = kb.entries || []

const moves = {}
const unmapped = new Set()

for (const e of entries) {
  const old = e.domain || ''
  let key = MAP[old]
  if (key === undefined) { unmapped.add(old); key = guessFromContent(e) }
  if (key === null) key = guessFromContent(e)
  e._newCategory = key
  moves[`${old} → ${key}`] = (moves[`${old} → ${key}`] || 0) + 1
}

if (unmapped.size) {
  console.log(`\nNOT IN THE MAP (routed by content — add them to MAP if this is wrong):`)
  for (const u of unmapped) console.log(`  ${u}`)
}

// ── Report ───────────────────────────────────────────────────────────
console.log(`\nMoves:`)
for (const [m, n] of Object.entries(moves).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${m}`)
}

const counts = {}
for (const e of entries) counts[e._newCategory] = (counts[e._newCategory] || 0) + 1

console.log(`\n${'Category'.padEnd(26)} ${'entries'.padStart(7)}`)
console.log('─'.repeat(36))
for (const c of CATEGORIES) {
  const n = counts[c.key] || 0
  const flag = n === 0 ? '   (empty)' : ''
  console.log(`  ${c.label.padEnd(24)} ${String(n).padStart(6)}${flag}`)
}
console.log('─'.repeat(36))
console.log(`  ${'TOTAL'.padEnd(24)} ${String(entries.length).padStart(6)}`)

if (!WRITE) {
  console.log(`\nDry run. Re-run with --write to apply.`)
  process.exit(0)
}

// ── Apply ────────────────────────────────────────────────────────────
// Renumber within each category so ids read in category order.
const counters = {}
const idRemap = {}

// Keep entries in their existing relative order inside each new category.
for (const e of entries) {
  const cat = BY_KEY[e._newCategory]
  counters[cat.id] = (counters[cat.id] || 0) + 1
  const newId = `${cat.id}-${String(counters[cat.id]).padStart(3, '0')}`
  if (e.id && e.id !== newId) idRemap[e.id] = newId
  e.id = newId
  e.domain = cat.key
  e.category = cat.label
  delete e._newCategory
}

copyFileSync(KB, `${KB}.bak`)
writeFileSync(
  KB,
  JSON.stringify(
    {
      ...kb,
      categories: CATEGORIES.map(({ key, id, label, blurb }) => ({ key, id, label, blurb })),
      counts: { total: entries.length, byCategory: counts },
      entries,
    },
    null,
    2
  )
)

console.log(`\nWrote ${KB}`)
console.log(`  ${Object.keys(idRemap).length} entries renumbered`)
console.log(`  backup at ${KB}.bak`)
console.log(`\nRe-run the eval — entry ids changed, so the suite must be re-baselined:`)
console.log(`  KB_PATH=${KB} npm run eval`)
