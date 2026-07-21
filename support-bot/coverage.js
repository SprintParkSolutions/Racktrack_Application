#!/usr/bin/env node
/**
 * Coverage audit — which parts of RackTrack the knowledge base can answer for,
 * and which it cannot.
 *
 * Enumerates every user-facing surface in the app (client pages, client
 * components, server API route files) and checks whether any knowledge-base
 * entry cites it as evidence. An uncited surface is a part of the product the
 * support bot is blind to.
 *
 * Counts the harvest too, so coverage can be checked before merging.
 *
 *   node coverage.js               # summary
 *   node coverage.js --gaps        # just the uncovered surfaces, for mining
 *   node coverage.js --json        # machine-readable
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve, relative } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const SHIPPED = join(REPO, 'server', 'data', 'support-kb.json')
const HARVEST = join(HERE, 'kb', 'harvest')

const GAPS_ONLY = process.argv.includes('--gaps')
const AS_JSON = process.argv.includes('--json')

const C = { r: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m' }

// ── Surfaces a user can actually reach ───────────────────────────────
// Files that are not user-facing surfaces: styles, 3D scene internals,
// pure redirects, and dev-only comparison pages.
const NOT_A_SURFACE = /\.(css|scss)$/i
const EXCLUDE_NAMES = new Set(['LogoCompare', 'TopologyScene3D', 'useOrbLook', 'MultiRackRedirect'])

function listFiles(dir, filter) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => !NOT_A_SURFACE.test(f))
    .filter((f) => filter(f))
    .map((f) => join(dir, f))
    .filter((p) => statSync(p).isFile())
}

const surfaces = []

for (const p of listFiles(join(REPO, 'client', 'src', 'pages'), (f) => f.endsWith('.jsx'))) {
  const name = p.split('/').pop().replace('.jsx', '')
  if (EXCLUDE_NAMES.has(name)) continue
  surfaces.push({ kind: 'page', name, file: relative(REPO, p) })
}

for (const p of listFiles(join(REPO, 'client', 'src', 'components'), (f) => f.endsWith('.jsx'))) {
  const name = p.split('/').pop().replace('.jsx', '')
  if (EXCLUDE_NAMES.has(name)) continue
  surfaces.push({ kind: 'component', name, file: relative(REPO, p) })
}

// Server route modules = the API surface behind the UI.
for (const p of listFiles(REPO + '/server', (f) => /(_routes|routes)\.js$/.test(f) || ['app.js', 'auth.js', 'audit.js', 'port_history.js', 'netdisco_proxy.js', 'lab_devices.js', 'demo_topology.js'].includes(f))) {
  const name = p.split('/').pop().replace('.js', '')
  surfaces.push({ kind: 'api', name, file: relative(REPO, p) })
}

// ── What the knowledge base cites ────────────────────────────────────
function loadEntries() {
  const out = []
  if (existsSync(SHIPPED)) {
    const kb = JSON.parse(readFileSync(SHIPPED, 'utf8'))
    for (const e of kb.entries || []) out.push({ ...e, _src: 'shipped' })
  }
  if (existsSync(HARVEST)) {
    for (const f of readdirSync(HARVEST).filter((x) => x.endsWith('.json'))) {
      // raw-*.json are unverified mining dumps; count them separately so the
      // audit can distinguish "covered" from "covered pending verification".
      const src = f.startsWith('raw-') ? 'harvest-raw' : 'harvest-verified'
      try {
        const parsed = JSON.parse(readFileSync(join(HARVEST, f), 'utf8'))
        const list = Array.isArray(parsed) ? parsed : parsed.entries || []
        for (const e of list) out.push({ ...e, _src: src })
      } catch { /* unreadable mid-write; skip */ }
    }
  }
  return out
}

const entries = loadEntries()
const citations = new Map() // file -> Set of source buckets

// Evidence paths are stored inconsistently — some absolute, some repo-relative.
// Normalize to repo-relative before matching, or coverage is under-reported.
function normPath(f) {
  let p = String(f || '').replace(/\\/g, '/')
  const i = p.indexOf('/dark_mobile/')
  if (i >= 0) p = p.slice(i + '/dark_mobile/'.length)
  return p.replace(/^\.?\//, '')
}

for (const e of entries) {
  for (const v of e.evidence || []) {
    if (!v || !v.file) continue
    const key = normPath(v.file)
    if (!citations.has(key)) citations.set(key, new Set())
    citations.get(key).add(e._src)
  }
}

// A surface counts as covered if any entry cites its file path.
for (const s of surfaces) {
  const srcs = citations.get(s.file)
  s.covered = Boolean(srcs)
  s.pendingOnly = Boolean(srcs) && !srcs.has('shipped') && !srcs.has('harvest-verified')
}

// ── Report ───────────────────────────────────────────────────────────
const byKind = {}
for (const s of surfaces) {
  byKind[s.kind] ||= { total: 0, covered: 0, pending: 0, gaps: [] }
  byKind[s.kind].total++
  if (s.covered) {
    byKind[s.kind].covered++
    if (s.pendingOnly) byKind[s.kind].pending++
  } else {
    byKind[s.kind].gaps.push(s.name)
  }
}

const gaps = surfaces.filter((s) => !s.covered)

if (AS_JSON) {
  console.log(JSON.stringify({ surfaces, byKind, gaps: gaps.map((g) => g.file) }, null, 2))
  process.exit(0)
}

if (GAPS_ONLY) {
  for (const g of gaps) console.log(g.file)
  process.exit(0)
}

const counts = entries.reduce((a, e) => ((a[e._src] = (a[e._src] || 0) + 1), a), {})
console.log(`${C.bold}RackTrack support coverage${C.r}`)
console.log(
  `${C.dim}entries: ${Object.entries(counts).map(([k, n]) => `${k}=${n}`).join('  ')}${C.r}\n`
)

for (const [kind, d] of Object.entries(byKind)) {
  const pct = ((d.covered / d.total) * 100).toFixed(0)
  const color = pct >= 90 ? C.green : pct >= 60 ? C.yellow : C.red
  const pend = d.pending ? ` ${C.dim}(${d.pending} pending verification)${C.r}` : ''
  console.log(`  ${kind.padEnd(11)} ${color}${String(d.covered).padStart(3)}/${String(d.total).padEnd(3)} ${pct.padStart(3)}%${C.r}${pend}`)
}

const totalCovered = surfaces.filter((s) => s.covered).length
const overall = ((totalCovered / surfaces.length) * 100).toFixed(1)
console.log(`  ${'─'.repeat(30)}`)
console.log(`  ${'OVERALL'.padEnd(11)} ${String(totalCovered).padStart(3)}/${String(surfaces.length).padEnd(3)} ${overall}%\n`)

if (gaps.length) {
  console.log(`${C.bold}Not covered by any entry${C.r} ${C.dim}(${gaps.length} surfaces)${C.r}`)
  const grouped = {}
  for (const g of gaps) (grouped[g.kind] ||= []).push(g.name)
  for (const [kind, names] of Object.entries(grouped)) {
    console.log(`  ${C.dim}${kind}:${C.r} ${names.join(', ')}`)
  }
  console.log(`\n${C.dim}Feed these to the next mining pass:  node coverage.js --gaps${C.r}`)
} else {
  console.log(`${C.green}Every enumerated surface is cited by at least one entry.${C.r}`)
  console.log(`${C.dim}Coverage of surfaces is not the same as coverage of questions — watch the refusal log for what users actually ask.${C.r}`)
}
