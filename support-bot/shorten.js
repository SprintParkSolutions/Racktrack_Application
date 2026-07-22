#!/usr/bin/env node
/**
 * Add a short answer to every knowledge-base entry.
 *
 * The mined answers average ~1,070 characters. That is an essay for someone
 * standing in a cold aisle holding a phone one-handed — they read the first
 * line, maybe the second. Nothing here is deleted; the detail is kept and the
 * lead is put in front of it.
 *
 * This is deliberately NOT an LLM pass. Shortening by generation would put an
 * unverified sentence in front of a verified answer, which is exactly the
 * failure mode the whole system exists to prevent. Instead it extracts the
 * opening of the existing verified text, so the short answer is a literal
 * prefix of something three reviewers already checked.
 *
 *   node shorten.js            # report what would change
 *   node shorten.js --write    # add `short` to every entry
 */

import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const KB = process.env.KB_PATH || join(REPO, 'server', 'data', 'support-kb.json')
const WRITE = process.argv.includes('--write')

/** Target for the short answer. Long enough for a fix, short enough to read at a glance. */
const TARGET = 320
const HARD_MAX = 420

/**
 * Take the leading actionable chunk of an answer.
 *
 * Rules, in order of preference:
 *  1. If the answer opens with a lead paragraph followed by numbered steps,
 *     keep the lead plus the first three steps — that is the fix.
 *  2. Otherwise keep whole sentences up to the target length.
 *  3. Never cut mid-sentence; never end on a colon promising a list that
 *     was truncated away.
 */
function shorten(answer) {
  let text = String(answer || '').trim()

  // Structured blocks have no sentence boundaries, so sentence-splitting cuts
  // straight into the middle of a table row or a code line and emits a
  // fragment like "format=html`) | Rack ID, scan time…". Take only the prose
  // that precedes the first block; if there is none, fall back to the whole
  // text with blocks stripped.
  const blockAt = firstBlockIndex(text)
  if (blockAt > 0) {
    const prose = text.slice(0, blockAt).trim()
    if (prose.length >= 60) text = prose
    else text = stripBlocks(text)
  } else if (blockAt === 0) {
    text = stripBlocks(text)
  }

  if (text.length <= TARGET) return { short: text, truncated: text !== String(answer || '').trim() }

  const paras = text.split(/\n\s*\n/)
  const lead = paras[0].trim()

  // Numbered steps carry the actual instructions; keep the first few.
  const stepLines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^\d+[.)]\s/.test(l))

  if (stepLines.length >= 2) {
    // Individual steps can themselves be paragraphs. Trim each to its first
    // sentence so the short answer stays scannable, then enforce the cap by
    // dropping steps rather than cutting one mid-instruction.
    const trimStep = (s) => {
      const m = /^(\d+[.)]\s*)([\s\S]*)$/.exec(s)
      return m ? m[1] + firstSentences(m[2], 110) : firstSentences(s, 120)
    }
    const leadPart = firstSentences(lead, 150)
    const steps = stepLines.slice(0, 3).map(trimStep)

    for (let n = steps.length; n >= 1; n--) {
      const out = `${leadPart}\n${steps.slice(0, n).join('\n')}`.trim()
      if (out.length <= HARD_MAX || n === 1) {
        return { short: out.length <= HARD_MAX ? out : firstSentences(text, TARGET), truncated: true }
      }
    }
  }

  return { short: firstSentences(text, TARGET), truncated: true }
}

/** Index of the first markdown table row or fenced code block, or -1. */
function firstBlockIndex(text) {
  const idxs = [text.search(/^\s*\|.*\|/m), text.search(/^\s*```/m)].filter((i) => i >= 0)
  return idxs.length ? Math.min(...idxs) : -1
}

/** Remove table rows and fenced code, keeping the prose around them. */
function stripBlocks(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .split('\n')
    .filter((l) => !/^\s*\|/.test(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * A short answer must read as a complete thought. These are the shapes that
 * mean the extraction went wrong rather than merely being terse.
 */
function looksBroken(s) {
  const t = String(s || '').trim()
  if (t.length < 25) return true
  if (/^[a-z)|`\]]/.test(t)) return true          // starts mid-sentence
  if (/[|`]/.test(t.slice(0, 40))) return true     // opens inside markup
  if (/^\W/.test(t) && !/^["'(]/.test(t)) return true
  return false
}

/** Whole sentences only, up to `limit` characters. */
function firstSentences(text, limit) {
  const flat = text.replace(/\s*\n\s*/g, ' ').trim()
  if (flat.length <= limit) return flat

  const sentences = flat.match(/[^.!?]+[.!?]+(\s|$)/g) || [flat]
  let out = ''
  for (const s of sentences) {
    if ((out + s).length > limit && out) break
    out += s
  }
  out = out.trim()

  if (!out) {
    // One very long sentence: cut at the last word boundary and mark it.
    out = `${flat.slice(0, limit).replace(/\s+\S*$/, '')}…`
  }
  // A trailing colon promises a list that is no longer there.
  return out.replace(/:$/, '.')
}

const kb = JSON.parse(readFileSync(KB, 'utf8'))
const entries = kb.entries || []

let changed = 0
const lens = []

let repaired = 0
for (const e of entries) {
  let { short, truncated } = shorten(e.answer)

  if (looksBroken(short)) {
    // Fall back to the first clean prose paragraph; if even that is unusable,
    // keep the full answer. A long answer is a UX problem; a fragment that
    // starts mid-table is a correctness problem.
    const prose = stripBlocks(String(e.answer || ''))
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .find((p) => p.length >= 40 && !looksBroken(p))
    short = prose ? firstSentences(prose, TARGET) : String(e.answer || '').trim()
    if (looksBroken(short)) short = String(e.answer || '').trim()
    repaired++
  }

  // A trailing colon promises a list that the short answer no longer contains.
  short = short.replace(/\s*:\s*$/, '.')
  e.short = short
  if (truncated) changed++
  lens.push(short.length)
}

const before = entries.map((e) => (e.answer || '').length)
const avg = (a) => Math.round(a.reduce((s, x) => s + x, 0) / (a.length || 1))

console.log(`entries         ${entries.length}`)
console.log(`full answer avg ${avg(before)} chars   (max ${Math.max(...before)})`)
console.log(`short avg       ${avg(lens)} chars   (max ${Math.max(...lens)})`)
console.log(`shortened       ${changed}  (${entries.length - changed} were already brief)`)
console.log(`repaired        ${repaired}  (extraction produced a fragment; fell back to clean prose)`)

console.log(`\nSample:`)
for (const e of entries.filter((x) => x.audience === 'end-user').slice(0, 3)) {
  console.log(`\n  ${e.id}  ${e.question}`)
  console.log(`  ${'─'.repeat(56)}`)
  console.log(
    e.short
      .split('\n')
      .map((l) => `  ${l}`)
      .join('\n')
  )
  console.log(`  ${'…'} (${(e.answer || '').length - e.short.length} more chars available on request)`)
}

if (!WRITE) {
  console.log(`\nDry run. Re-run with --write to apply.`)
  process.exit(0)
}

copyFileSync(KB, `${KB}.bak`)
writeFileSync(KB, JSON.stringify(kb, null, 2))
console.log(`\nWrote ${KB} (backup at ${KB}.bak)`)
