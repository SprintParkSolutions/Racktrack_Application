#!/usr/bin/env node
/**
 * Build the shareable knowledge-base browser page.
 *
 * SAFETY: internal-only entries are excluded from the output entirely. They are
 * not hidden behind a filter — they never enter the file. A published page can
 * be shared onward at any time, and internal entries quote server internals and
 * (until they were redacted) real credentials. The page reports how many exist
 * so the count is honest, without exposing their content.
 *
 * Secrets are re-scanned here as a second line of defence, independent of the
 * merge gate: a defence that only runs at one point in the pipeline is one
 * refactor away from not running at all.
 *
 *   node build-artifact.js            # writes dist/knowledge-base.html
 *   node build-artifact.js --include-internal   # local review only, never publish
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const KB = process.env.KB_PATH || join(REPO, 'server', 'data', 'support-kb.json')
const TEMPLATE = join(HERE, 'artifact', 'template.html')
const OUT_DIR = join(HERE, 'dist')
const OUT = join(OUT_DIR, 'knowledge-base.html')

const INCLUDE_INTERNAL = process.argv.includes('--include-internal')

const SECRET_PATTERNS = [
  { re: /(password|passwd|pwd)\s*[:=]\s*['"][^'"]{4,}['"]/i, what: 'literal password' },
  { re: /\b(?:Owner|Admin|Test|Demo)@\d{3,}/, what: 'seeded credential' },
  { re: /\b(?:sk|pk|ghp|gho|xox[bpsa])[-_][A-Za-z0-9]{16,}/, what: 'API token' },
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, what: 'JWT' },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, what: 'private key' },
]

const kb = JSON.parse(readFileSync(KB, 'utf8'))
const all = kb.entries || []

const internal = all.filter((e) => e.audience === 'internal-only')
const publishable = INCLUDE_INTERNAL ? all : all.filter((e) => e.audience !== 'internal-only')

// Refuse to build rather than publish a secret. A build failure costs a minute;
// a leaked credential on a shareable URL cannot be recalled.
const offenders = []
for (const e of publishable) {
  const blob = `${e.answer || ''}\n${e.rootCause || ''}\n${(e.symptoms || []).join('\n')}`
  for (const { re, what } of SECRET_PATTERNS) {
    if (re.test(blob)) offenders.push(`${e.id}: ${what}`)
  }
}
if (offenders.length) {
  console.error(`REFUSING TO BUILD — credential-shaped content in publishable entries:`)
  for (const o of offenders) console.error(`  ${o}`)
  console.error(`\nRedact these in ${KB} before building.`)
  process.exit(1)
}

const payload = {
  entries: publishable.map((e) => ({
    id: e.id, d: e.domain || '', a: e.audience || '', c: e.confidence || '',
    q: e.question || '', ans: e.answer || '', s: e.symptoms || [],
    rc: e.rootCause || '',
    ev: (e.evidence || []).map((v) => ({ f: normPath(v.file), l: v.lines || '' })),
    fix: Boolean(e.userCanSelfFix), corr: Boolean(e._corrected),
    v: e._votes || 0, r: e._refuted || 0,
  })),
  dropped: loadJson(join(HERE, 'kb', 'dropped-as-refuted.json'), []).map((d) => ({
    q: d.question || '', reasons: d.reasons || [],
  })),
  pendingCount: loadJson(join(HERE, 'kb', 'unverified-pending.json'), []).length,
  internalCount: INCLUDE_INTERNAL ? 0 : internal.length,
}

function loadJson(p, fallback) {
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return fallback }
}

// Evidence paths are stored inconsistently; show them repo-relative.
function normPath(f) {
  let p = String(f || '').replace(/\\/g, '/')
  const i = p.indexOf('/dark_mobile/')
  if (i >= 0) p = p.slice(i + '/dark_mobile/'.length)
  return p.replace(/^\.?\//, '')
}

if (!existsSync(TEMPLATE)) {
  console.error(`Missing template at ${TEMPLATE}`)
  process.exit(1)
}

const html = readFileSync(TEMPLATE, 'utf8').replace(
  '__KB_DATA__',
  // A literal </script> inside the JSON would close the host <script> early.
  JSON.stringify(payload).replace(/<\/script>/gi, '<\\/script>')
)

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT, html)

const byAud = {}
for (const e of publishable) byAud[e.a || e.audience] = (byAud[e.a || e.audience] || 0) + 1

console.log(`Built ${OUT}`)
console.log(`  published : ${publishable.length} entries (${Object.entries(byAud).map(([k, n]) => `${k}=${n}`).join(', ')})`)
console.log(`  withheld  : ${INCLUDE_INTERNAL ? 0 : internal.length} internal-only entries`)
console.log(`  size      : ${Math.round(html.length / 1024)} KB`)
if (INCLUDE_INTERNAL) {
  console.log(`\n  WARNING: built WITH internal entries. Local review only — do not publish this file.`)
}
