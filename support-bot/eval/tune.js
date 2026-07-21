#!/usr/bin/env node
/**
 * Threshold tuning aid. Prints raw retrieval numbers for a set of probe
 * queries so thresholds get set from data instead of intuition.
 *
 * Left column groups are what we want SEPARATED: real questions must score
 * clearly above off-topic ones. If the two bands overlap, no threshold can
 * split them and the fix is in scoring, not in the threshold.
 *
 * Run: KB_PATH=... node eval/tune.js
 */

import { loadKB, filterByTier } from '../src/kb.js'
import { buildIndex, search } from '../src/search.js'

const index = buildIndex(filterByTier(loadKB().entries, 'end-user'))

const PROBES = {
  'SHOULD ANSWER (real user phrasing)': [
    'cant log in keeps saying wrong',
    'why does it say my password is wrong',
    'scan came back empty',
    'scaning not workin on my ipad',
    'camera wont open',
    'how do i export a report',
    'my report is empty',
    'i scanned with no signal and lost it',
    'keeps logging me out',
  ],
  'SHOULD REFUSE (off-topic / ungrounded)': [
    'How much does RackTrack cost per user?',
    'When will you add support for Juniper switches?',
    'Is RackTrack better than NetBox?',
    'How do I configure a BGP session on a Cisco 9300?',
    'How do I turn on the automatic thermal mapping overlay?',
    'Exactly how many milliseconds is the scan timeout set to?',
    'what is the weather today',
  ],
  // Not a refusal case: the right response to "its broken" is to ask WHAT is
  // broken. These are expected to land in the ambiguous band and are excluded
  // from the separation check on purpose.
  'SHOULD CLARIFY (too vague to answer, should not refuse either)': [
    'its broken',
    'help',
    'not working',
  ],
}

const pad = (s, n) => String(s).padEnd(n)

for (const [group, queries] of Object.entries(PROBES)) {
  console.log(`\n${group}`)
  console.log('-'.repeat(100))
  console.log(`${pad('query', 46)} ${pad('conf', 6)} ${pad('raw', 8)} ${pad("cover", 7)} ${pad("mass", 6)} ${pad("unk", 5)} top match`)
  console.log('-'.repeat(100))

  for (const q of queries) {
    const r = search(index, q, { limit: 3 })
    if (!r.length) {
      console.log(`${pad(q.slice(0, 44), 46)} ${pad('-', 6)} ${pad('-', 8)} ${pad('-', 7)} (no match)`)
      continue
    }
    const t = r[0]
    console.log(
      `${pad(q.slice(0, 44), 46)} ${pad(t.confidence, 6)} ${pad(t.score.toFixed(2), 8)} ` +
        `${pad(t.coverage.toFixed(2), 7)} ${pad(t.matchedMass.toFixed(1), 6)} ${pad(t.unknownRatio.toFixed(2), 5)} ${t.entry.id}`,
    )
  }
}

// Report the separation between the two bands - the number that actually matters.
const answerScores = PROBES['SHOULD ANSWER (real user phrasing)']
  .map((q) => search(index, q, { limit: 4 })[0])
  .filter(Boolean)
const refuseScores = PROBES['SHOULD REFUSE (off-topic / ungrounded)']
  .map((q) => search(index, q, { limit: 4 })[0])
  .filter(Boolean)

const minAnswer = Math.min(...answerScores.map((r) => r.confidence))
const maxRefuse = Math.max(...refuseScores.map((r) => r.confidence))

console.log(`\n${'='.repeat(100)}`)
console.log(`Lowest "should answer" confidence : ${minAnswer.toFixed(2)}`)
console.log(`Highest "should refuse" confidence: ${maxRefuse.toFixed(2)}`)
console.log(
  minAnswer > maxRefuse
    ? `SEPARABLE - set GROUNDED between ${maxRefuse.toFixed(2)} and ${minAnswer.toFixed(2)} (suggest ${((minAnswer + maxRefuse) / 2).toFixed(2)})`
    : `OVERLAPPING by ${(maxRefuse - minAnswer).toFixed(2)} - no threshold can separate these. Fix scoring, not thresholds.`,
)
console.log('='.repeat(100))
