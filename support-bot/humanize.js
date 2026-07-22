#!/usr/bin/env node
/**
 * Rewrite end-user answers in the reader's language, not the developer's.
 *
 * 35% of end-user answers leaked system vocabulary — "the server", "/api/scan/
 * <rack ID>/report", "a 403 response", "ConnectionsContext.jsx". A technician
 * standing at a rack does not know what any of that is, and it makes a correct
 * answer read as somebody else's problem.
 *
 * WHY THIS IS DETERMINISTIC AND NOT A MODEL PASS
 * The first version of this used the local model to rewrite. Its output was
 * rejected every single time by the fabrication check — it invented an
 * "Organization Created" screen and a "Connect Data Sources" button, neither of
 * which exists. That is the exact failure this whole system is built to
 * prevent, so generation is the wrong tool here.
 *
 * These are substitutions instead. Each one preserves meaning and cannot
 * introduce a fact, because it only ever swaps a system word for the thing the
 * reader actually experiences — in their world, "the server" IS RackTrack.
 *
 * Only the SHORT answer is touched. The full verified text stays untouched
 * behind "More detail", so nothing is lost.
 *
 *   node humanize.js            # dry run with before/after
 *   node humanize.js --write    # apply
 */

import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const KB = process.env.KB_PATH || join(REPO, 'server', 'data', 'support-kb.json')
const WRITE = process.argv.includes('--write')

/**
 * Ordered substitutions. Longest and most specific first — "on the server"
 * must be handled before the bare "the server", or the phrasing comes out
 * clumsy ("on RackTrack" instead of "in RackTrack").
 */
const RULES = [
  // Whole phrases, most specific first.
  [/\benforced on the server\b/gi, 'enforced by RackTrack itself'],
  [/\bstored on the server\b/gi, 'stored in RackTrack'],
  [/\bsaved on the server\b/gi, 'saved in RackTrack'],
  [/\bfinished on the server\b/gi, 'finished'],
  [/\bsent to the server\b/gi, 'saved to RackTrack'],
  [/\breach the server\b/gi, 'reach RackTrack'],
  [/\bon the server\b/gi, 'in RackTrack'],
  [/\bfrom the server\b/gi, 'from RackTrack'],
  [/\bthe server or tunnel\b/gi, 'RackTrack'],
  [/\bThe server's\b/g, "RackTrack's"],
  [/\bthe server's\b/gi, "RackTrack's"],
  [/\ba server rebuild\b/gi, 'a system rebuild'],
  [/\bserver-side problem\b/gi, "a problem on RackTrack's side"],
  [/\bserver-side\b/gi, "on RackTrack's side"],
  [/\bclient-side\b/gi, 'on your device'],
  [/\bThe server\b/g, 'RackTrack'],
  [/\bthe server address\b/gi, "RackTrack's address"],
  [/\bserver address\b/gi, "RackTrack's address"],
  [/\bthe RackTrack server\b/gi, 'RackTrack'],
  [/\bRackTrack server\b/gi, 'RackTrack'],
  [/\bmail server\b/gi, 'mail system'],
  [/\bthe server\b/gi, 'RackTrack'],

  // Status codes → what the reader is actually told.
  [/\ba 403(?:\s*(?:response|error|status))?\b/gi, "a message saying you don't have access"],
  [/\ba 401(?:\s*(?:response|error|status))?\b/gi, 'a message asking you to sign in again'],
  [/\ba 404(?:\s*(?:response|error|status))?\b/gi, "a message saying it can't be found"],
  [/\ba 429(?:\s*(?:response|error|status))?\b/gi, 'a message asking you to slow down'],
  [/\ba 50\d(?:\s*(?:response|error|status))?\b/gi, 'an error from RackTrack'],
  [/\bHTTP\s*\d{3}\b/gi, 'an error'],

  // Architecture nouns the reader never sees.
  [/\bthe backend\b/gi, 'RackTrack'],
  [/\bthe front-?end\b/gi, 'the app'],
  [/\bfeedback endpoints?\b/gi, 'correction'],
  [/\ban? (?:API )?endpoints?\b/gi, 'RackTrack'],
  [/\bendpoints?\b/gi, 'part of RackTrack'],
  [/\bthe payload\b/gi, 'the data'],

  // Parenthetical developer detail: drop the aside, keep the sentence.
  [/\s*\((?:at\s+)?`?\/api\/[^)]*\)/gi, ''],
  [/\s*\(see\s+[\w-]+\.(?:jsx|js|py)[^)]*\)/gi, ''],
  [/\s*\((?:in\s+)?[\w-]+\.(?:jsx|js|py|json)[^)]*\)/gi, ''],

  // Bare technical tokens left in prose.
  [/`\/api\/[^`]*`/gi, 'RackTrack'],
  [/\/api\/[\w<>/\-{}:]+/gi, 'RackTrack'],
  [/\b[\w-]+\.(?:jsx|js|py|json|sql|db)\b/gi, 'RackTrack'],
  [/\bthe SQLite database\b|\bthe SQL database\b/gi, 'RackTrack'],
  [/\bJSON\b/g, 'data'],
  [/\blocalStorage\b|\bsessionStorage\b/gi, 'your device'],
]

/**
 * Anything still here after a pass means a rule was missed — EXCEPT text inside
 * quotes, which is an error message the user sees on screen verbatim and must
 * not be paraphrased, and plain file sizes like "500 KB".
 */
const REMAINING = [
  /\bserver\b/i, /\bendpoint\b/i, /\bbackend\b/i, /\bfront-?end\b/i,
  /\/api\//i, /\.jsx\b/i, /\.js\b/i, /\bSQLite\b/i, /\bJWT\b/i,
  /\bHTTP\s*\d/i, /\blocalhost\b/i,
]

function humanize(text) {
  let out = String(text || '')
  for (const [re, to] of RULES) out = out.replace(re, to)

  // Substitution can leave doubled articles or spacing artefacts.
  // No space-before-punctuation cleanup: none of the rules above can create
  // that, and a blanket version corrupts answers that list literal characters
  // ("a Username — letters, digits and . _ -"), turning them into "and. _ -".
  out = out
    .replace(/\bRackTrack RackTrack\b/g, 'RackTrack')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\(\s*\)/g, '')
    .trim()

  return out
}

function stillTechnical(text) {
  return REMAINING.filter((re) => re.test(text)).map((re) => String(re))
}

/** Numbers and quoted labels must survive a substitution untouched. */
function factsPreserved(before, after) {
  const grab = (t) => ({
    nums: (String(t).match(/\b\d+(?:[.,]\d+)?\b/g) || []).sort().join('|'),
    quoted: ([...String(t).matchAll(/["“”]([^"“”]{2,40})["“”]/g)].map((m) => m[1]).sort().join('|')),
  })
  const b = grab(before)
  const a = grab(after)
  // Status-code rules deliberately remove a number, so only require that no
  // NEW number appeared and that quoted UI labels are identical.
  const newNums = (String(after).match(/\b\d+(?:[.,]\d+)?\b/g) || [])
    .filter((n) => !String(before).includes(n))
  if (newNums.length) return `introduced number ${newNums[0]}`
  if (a.quoted !== b.quoted) return 'changed a quoted label'
  return null
}

// ── Run ──────────────────────────────────────────────────────────────
const kb = JSON.parse(readFileSync(KB, 'utf8'))
const entries = kb.entries || []

let changed = 0
let skipped = 0
const leftovers = []
const samples = []

for (const e of entries) {
  if (e.audience !== 'end-user') continue
  const before = e.short || e.answer
  const after = humanize(before)
  if (after === before) continue

  const broke = factsPreserved(before, after)
  if (broke) { skipped++; continue }

  const left = stillTechnical(after)
  if (left.length) leftovers.push({ id: e.id, left, after })

  if (samples.length < 6) samples.push({ id: e.id, before, after })
  e.short = after
  e._humanized = true
  changed++
}

console.log(`end-user answers rewritten : ${changed}`)
console.log(`skipped (would alter facts): ${skipped}`)
console.log(`still contain system words : ${leftovers.length}`)

for (const s of samples.slice(0, 4)) {
  console.log(`\n${s.id}`)
  console.log(`  BEFORE  ${s.before.replace(/\n/g, ' ').slice(0, 165)}`)
  console.log(`  AFTER   ${s.after.replace(/\n/g, ' ').slice(0, 165)}`)
}

if (leftovers.length) {
  console.log(`\nStill technical (add a rule for these):`)
  for (const l of leftovers.slice(0, 5)) {
    console.log(`  ${l.id}: ${l.after.replace(/\n/g, ' ').slice(0, 110)}`)
  }
}

if (!WRITE) {
  console.log(`\nDry run — nothing written. Re-run with --write to apply.`)
  process.exit(0)
}

copyFileSync(KB, `${KB}.bak`)
writeFileSync(KB, JSON.stringify(kb, null, 2))
console.log(`\nWrote ${KB} (backup at ${KB}.bak)`)
