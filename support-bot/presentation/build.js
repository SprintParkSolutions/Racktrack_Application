#!/usr/bin/env node
/**
 * Build the RackTrack Assist briefing page.
 *
 * Every figure on the page is read from the knowledge base and the eval output
 * at build time rather than typed into the HTML. A briefing that quotes stale
 * numbers to a director is worse than one that quotes none — and hand-copied
 * stats go stale the first time anyone re-runs the pipeline.
 *
 *   node presentation/build.js
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const REPO = resolve(ROOT, '..')
const KB = join(REPO, 'server', 'data', 'support-kb.json')
const LOGO = join(REPO, 'client', 'public', 'logo.jpg')

const kb = JSON.parse(readFileSync(KB, 'utf8'))
const entries = kb.entries || []

const by = (k) => entries.filter((e) => e.audience === k).length
const avg = (f) => Math.round(entries.reduce((s, e) => s + (f(e) || '').length, 0) / (entries.length || 1))

const stats = {
  total: entries.length,
  endUser: by('end-user'),
  admin: by('admin'),
  internal: by('internal-only'),
  categories: (kb.categories || []).length,
  withEvidence: entries.filter((e) => (e.evidence || []).length).length,
  corrected: entries.filter((e) => e._corrected).length,
  reviewed: entries.filter((e) => (e._votes || 0) >= 3).length,
  avgShort: avg((e) => e.short),
  avgFull: avg((e) => e.answer),
}
stats.evidencePct = Math.round((stats.withEvidence / stats.total) * 100)

// Discarded material lives beside the knowledge base; count it if present.
const readCount = (p) => {
  try { const j = JSON.parse(readFileSync(p, 'utf8')); return Array.isArray(j) ? j.length : 0 } catch { return 0 }
}
stats.refuted = readCount(join(ROOT, 'kb', 'dropped-as-refuted.json')) + readCount(join(ROOT, 'kb', 'dropped-round2.json'))

const logo = existsSync(LOGO)
  ? `data:image/jpeg;base64,${readFileSync(LOGO).toString('base64')}`
  : ''

const html = readFileSync(join(HERE, 'template.html'), 'utf8')
  .replace(/__LOGO__/g, logo)
  .replace(/__([A-Z_]+)__/g, (m, key) => {
    const map = {
      TOTAL: stats.total, END_USER: stats.endUser, ADMIN: stats.admin,
      INTERNAL: stats.internal, CATEGORIES: stats.categories,
      EVIDENCE_PCT: stats.evidencePct, CORRECTED: stats.corrected,
      REVIEWED: stats.reviewed, REFUTED: stats.refuted,
      AVG_SHORT: stats.avgShort, AVG_FULL: stats.avgFull,
    }
    return map[key] !== undefined ? map[key] : m
  })

const out = join(ROOT, 'dist', 'assist-briefing.html')
writeFileSync(out, html)

console.log(`Built ${out}`)
console.log(`  ${stats.total} entries — ${stats.endUser} end-user, ${stats.admin} admin, ${stats.internal} internal`)
console.log(`  ${stats.evidencePct}% carry source evidence, ${stats.refuted} refuted and discarded`)
console.log(`  logo ${logo ? 'embedded' : 'MISSING'}`)
