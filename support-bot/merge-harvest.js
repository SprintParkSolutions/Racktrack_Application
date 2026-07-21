#!/usr/bin/env node
/**
 * Merge harvested knowledge-base domains into the shipped knowledge base.
 *
 * Reads every `kb/harvest/<domain>.json` written by the expansion workflow,
 * applies the same integrity checks the original salvage did, and writes a
 * merged knowledge base. Safe to re-run: it always rebuilds from the shipped
 * base plus the harvest, never appending to its own output.
 *
 *   node merge-harvest.js            # dry run: report what would change
 *   node merge-harvest.js --write    # write server/data/support-kb.json
 *
 * Checks applied to every incoming entry, in order:
 *   1. required fields present
 *   2. every cited evidence file actually exists in the repo
 *   3. not a duplicate of an entry already shipped (by normalized question)
 *   4. audience is one of the three known tiers (unknown fails closed)
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const HARVEST = join(HERE, 'kb', 'harvest')
const SHIPPED = join(REPO, 'server', 'data', 'support-kb.json')

const WRITE = process.argv.includes('--write')

const AUDIENCES = new Set(['end-user', 'admin', 'internal-only'])
const REQUIRED = ['question', 'answer', 'audience', 'confidence']

/**
 * Credential-shaped literals that must never enter the knowledge base.
 *
 * A mining agent reading seed scripts will faithfully copy real passwords into
 * an entry — it is documenting a genuine finding, and the `internal-only`
 * audience feels like enough protection. It is not: the knowledge base is
 * committed to git and gets exported to other surfaces, so a secret in here
 * outlives every access control around it. Keep the finding, drop the value.
 */
const SECRET_PATTERNS = [
  { re: /(password|passwd|pwd)\s*[:=]\s*['"][^'"]{4,}['"]/i, what: 'literal password assignment' },
  { re: /\b(?:Owner|Admin|Test|Demo)@\d{3,}/, what: 'seeded credential value' },
  { re: /\b(?:sk|pk|ghp|gho|xox[bpsa])[-_][A-Za-z0-9]{16,}/, what: 'API token' },
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, what: 'JWT' },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, what: 'private key' },
]

function findSecret(entry) {
  const blob = `${entry.answer || ''}\n${entry.rootCause || ''}\n${(entry.symptoms || []).join('\n')}`
  for (const { re, what } of SECRET_PATTERNS) {
    if (re.test(blob)) return what
  }
  return null
}

// Short, stable id prefixes. Anything unmapped falls back to a slug of the key.
const SLUGS = {
  marketplace: 'MKT', firmware: 'FW', history: 'HIST', connections: 'CONN',
  specs: 'SPEC', multirack: 'RACK', navigation: 'NAV',
  'pend-integrations': 'INTEG', 'pend-accuracy': 'ACCUR', 'pend-reports': 'RPT',
  'pend-howto': 'HOWTO', 'pend-misc': 'GEN',
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

function slugFor(domain) {
  if (SLUGS[domain]) return SLUGS[domain]
  return String(domain || 'GEN').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5) || 'GEN'
}

// ── Load what is already shipped ─────────────────────────────────────
if (!existsSync(SHIPPED)) {
  console.error(`No shipped knowledge base at ${SHIPPED}`)
  process.exit(1)
}
const shipped = JSON.parse(readFileSync(SHIPPED, 'utf8'))
const base = shipped.entries || []
const seen = new Set(base.map((e) => norm(e.question)))

console.log(`Shipped knowledge base: ${base.length} entries`)

// ── Load the harvest ─────────────────────────────────────────────────
if (!existsSync(HARVEST)) {
  console.error(`No harvest directory at ${HARVEST} — has the expansion run finished any domains yet?`)
  process.exit(1)
}

// `raw-*.json` are the mining safety nets, not verified output. Skip them.
const files = readdirSync(HARVEST).filter((f) => f.endsWith('.json') && !f.startsWith('raw-'))
if (files.length === 0) {
  console.error(`No verified domain files in ${HARVEST} yet (raw-*.json are unverified and ignored).`)
  process.exit(1)
}

const accepted = []
const rejected = []

for (const file of files.sort()) {
  const domain = file.replace(/\.json$/, '')
  let incoming
  try {
    incoming = JSON.parse(readFileSync(join(HARVEST, file), 'utf8'))
  } catch (err) {
    console.log(`  ${file.padEnd(26)} SKIPPED — unreadable (${err.message})`)
    continue
  }
  if (!Array.isArray(incoming)) {
    console.log(`  ${file.padEnd(26)} SKIPPED — expected an array`)
    continue
  }

  let kept = 0
  const reasons = { missingField: 0, badAudience: 0, badEvidence: 0, duplicate: 0, secret: 0 }

  for (const entry of incoming) {
    const missing = REQUIRED.filter((k) => !entry || !entry[k])
    if (missing.length) { reasons.missingField++; rejected.push({ domain, q: entry?.question, why: `missing ${missing.join(',')}` }); continue }

    // Hard stop, regardless of audience tier.
    const secret = findSecret(entry)
    if (secret) { reasons.secret++; rejected.push({ domain, q: entry.question, why: `REJECTED — contains a ${secret}` }); continue }

    if (!AUDIENCES.has(entry.audience)) { reasons.badAudience++; rejected.push({ domain, q: entry.question, why: `unknown audience "${entry.audience}"` }); continue }

    // An entry that cites a file which does not exist was not grounded in this
    // codebase, so its claim cannot be trusted regardless of how it reads.
    const bad = (entry.evidence || [])
      .map((v) => v && v.file)
      .filter((f) => f && !existsSync(join(REPO, f)))
    if (bad.length) { reasons.badEvidence++; rejected.push({ domain, q: entry.question, why: `cites missing file(s): ${bad.join(', ')}` }); continue }

    const key = norm(entry.question)
    if (seen.has(key)) { reasons.duplicate++; rejected.push({ domain, q: entry.question, why: 'duplicate of an existing entry' }); continue }
    seen.add(key)

    accepted.push({ ...entry, domain })
    kept++
  }

  const dropped = incoming.length - kept
  const detail = dropped
    ? ` (${Object.entries(reasons).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ')})`
    : ''
  console.log(`  ${file.padEnd(26)} ${String(kept).padStart(3)} accepted, ${String(dropped).padStart(3)} rejected${detail}`)
}

// ── Assign ids, preserving those already shipped ─────────────────────
const counters = {}
for (const e of base) {
  const m = /^([A-Z]+)-(\d+)$/.exec(e.id || '')
  if (m) counters[m[1]] = Math.max(counters[m[1]] || 0, Number(m[2]))
}
for (const e of accepted) {
  const slug = slugFor(e.domain)
  counters[slug] = (counters[slug] || 0) + 1
  e.id = `${slug}-${String(counters[slug]).padStart(3, '0')}`
}

const merged = base.concat(accepted)
const byAudience = {}
for (const e of merged) byAudience[e.audience] = (byAudience[e.audience] || 0) + 1

console.log(`\n${'─'.repeat(58)}`)
console.log(`accepted   ${accepted.length}`)
console.log(`rejected   ${rejected.length}`)
console.log(`total      ${base.length} → ${merged.length}`)
console.log(`audience   ${Object.entries(byAudience).map(([a, n]) => `${a}=${n}`).join('  ')}`)

if (rejected.length) {
  console.log(`\nRejected (first 12):`)
  for (const r of rejected.slice(0, 12)) {
    console.log(`  [${r.domain}] ${String(r.q || '').slice(0, 58)}\n      ${r.why}`)
  }
}

if (!WRITE) {
  console.log(`\nDry run. Re-run with --write to apply.`)
  console.log(`Then re-tune and re-test — thresholds are corpus-size dependent:`)
  console.log(`  KB_PATH=${SHIPPED} node eval/tune.js`)
  console.log(`  KB_PATH=${SHIPPED} npm run eval`)
  process.exit(0)
}

// Keep one rollback copy. Overwriting a verified knowledge base with no way
// back is not a risk worth taking for a script that runs in a second.
const backup = `${SHIPPED}.bak`
copyFileSync(SHIPPED, backup)

writeFileSync(
  SHIPPED,
  JSON.stringify(
    {
      ...shipped,
      counts: { kept: merged.length, byAudience },
      entries: merged,
    },
    null,
    2
  )
)

console.log(`\nWrote ${SHIPPED} (${merged.length} entries)`)
console.log(`Previous version saved to ${backup}`)
console.log(`\nNow re-tune and re-test — thresholds shift with corpus size:`)
console.log(`  KB_PATH=${SHIPPED} node eval/tune.js`)
console.log(`  KB_PATH=${SHIPPED} npm run eval`)
