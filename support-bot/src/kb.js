/**
 * Knowledge base loading, tier filtering, and prompt formatting.
 *
 * The single most important thing in this file is `filterByTier`. Internal-only
 * knowledge is removed from the entry list BEFORE the prompt is built, not
 * hidden behind an instruction telling the model not to mention it. A prompt
 * instruction can be talked around; content that was never in the context
 * window cannot be leaked no matter what the user types.
 */

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
// KB_PATH override exists so the smoke-test fixture can be swapped in without
// any chance of synthetic content reaching a real deployment.
const KB_PATH = process.env.KB_PATH || join(HERE, '..', 'kb', 'knowledge-base.json')

/** Which audiences each tier is allowed to see. */
export const TIERS = {
  'end-user': ['end-user'],
  admin: ['end-user', 'admin', 'internal-only'],
}

let _cache = null

/** Load and normalize the raw knowledge base from disk. */
export function loadKB() {
  if (_cache) return _cache

  if (!existsSync(KB_PATH)) {
    throw new Error(
      `No knowledge base at ${KB_PATH}.\n` +
        `Generate it first, then re-run. The bot deliberately refuses to start ` +
        `without one - an ungrounded support bot is worse than no bot.`,
    )
  }

  const raw = JSON.parse(readFileSync(KB_PATH, 'utf8'))
  const entries = (raw.entries || []).map((e, i) => ({
    ...e,
    // Stable, human-readable citation id. Users and evals both reference these.
    id: e.id || `${(e.domain || 'gen').toUpperCase().replace(/[^A-Z0-9]/g, '')}-${String(i + 1).padStart(3, '0')}`,
  }))

  _cache = { ...raw, entries }
  return _cache
}

/**
 * Drop every entry the given tier is not cleared to see.
 * Unknown audience values fail closed (treated as internal-only).
 */
export function filterByTier(entries, tier) {
  const allowed = TIERS[tier]
  if (!allowed) throw new Error(`Unknown tier "${tier}". Expected one of: ${Object.keys(TIERS).join(', ')}`)
  return entries.filter((e) => allowed.includes(e.audience))
}

/**
 * Render entries as the text block that goes into the cached system prompt.
 *
 * At realistic KB sizes (a few hundred entries) the whole thing fits in the
 * context window with room to spare, so we pass all of it every time rather
 * than retrieving a subset. Retrieval can miss the relevant entry; passing
 * everything cannot. See README for when that stops being true.
 */
export function renderKB(entries) {
  return entries
    .map((e) => {
      const lines = [
        `### ${e.id}`,
        `Question: ${e.question}`,
        `Answer: ${e.answer}`,
      ]
      if (e.symptoms?.length) lines.push(`Symptoms: ${e.symptoms.join(' | ')}`)
      if (e.rootCause) lines.push(`Cause: ${e.rootCause}`)
      if (e.evidence?.length) {
        lines.push(`Source: ${e.evidence.map((v) => `${v.file}${v.lines ? `:${v.lines}` : ''}`).join(', ')}`)
      }
      lines.push(`Confidence: ${e.confidence || 'unknown'}`)
      return lines.join('\n')
    })
    .join('\n\n')
}

/** Estimate of prompt size, for cache-viability checks. ~3.6 chars/token is a safe rule of thumb. */
export function approxTokens(text) {
  return Math.ceil(text.length / 3.6)
}

// `node src/kb.js --stats`
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--stats')) {
  const kb = loadKB()
  const byAudience = {}
  const byDomain = {}
  for (const e of kb.entries) {
    byAudience[e.audience] = (byAudience[e.audience] || 0) + 1
    byDomain[e.domain] = (byDomain[e.domain] || 0) + 1
  }
  console.log(`Entries: ${kb.entries.length}`)
  console.log('By audience:', byAudience)
  console.log('By domain:', byDomain)
  for (const tier of Object.keys(TIERS)) {
    const visible = filterByTier(kb.entries, tier)
    const tokens = approxTokens(renderKB(visible))
    console.log(`Tier "${tier}": ${visible.length} entries, ~${tokens.toLocaleString()} tokens`)
  }
}
