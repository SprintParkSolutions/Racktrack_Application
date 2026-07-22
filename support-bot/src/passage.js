/**
 * Passage selection — answer the question that was asked, not the entry.
 *
 * The failure this exists to fix: someone asked "how do I create an account as
 * a TENANT" and got the opening of the account-creation entry, which explains
 * how to create a new organization. The answer to their actual question was in
 * the same entry, three sentences later:
 *
 *   "It does not add you to a team that already exists — to join an existing
 *    team you need an invite link from your organization admin."
 *
 * The right entry was retrieved; the wrong part of it was shown. Choosing the
 * passage that matches the question is a large share of what "understanding the
 * question" looks like in practice, and it needs no model — the text is already
 * verified, so surfacing a different part of it introduces no new risk.
 *
 * This never generates or rewrites. It only chooses which verified sentences to
 * lead with, so the accuracy guarantee is unchanged.
 */

import { tokenize, expandQuery } from './search.js'

/** Split an answer into passages: paragraphs, with long ones broken at sentences. */
function toPassages(answer) {
  const text = String(answer || '').trim()
  if (!text) return []

  const out = []
  for (const para of text.split(/\n\s*\n/)) {
    const p = para.trim()
    if (!p) continue

    // A short paragraph is one idea; keep it whole.
    if (p.length <= 420) { out.push(p); continue }

    // A long one usually holds several. Split at sentence ends, then regroup
    // into chunks that are still readable on their own.
    const sentences = p.match(/[^.!?]+[.!?]+(\s|$)/g) || [p]
    let buf = ''
    for (const s of sentences) {
      if ((buf + s).length > 340 && buf) { out.push(buf.trim()); buf = '' }
      buf += s
    }
    if (buf.trim()) out.push(buf.trim())
  }
  return out
}

/**
 * Score how well a passage answers the query.
 *
 * Weighted by term rarity: a passage matching "tenant" tells us far more than
 * one matching "account", which every passage in an account entry contains.
 */
function scorePassage(passage, queryWeights, idf, maxIdf) {
  const terms = new Set(tokenize(passage))
  let matched = 0
  let total = 0

  for (const [t, qw] of queryWeights) {
    const w = (idf.has(t) ? idf.get(t) : maxIdf) * qw
    total += w
    if (terms.has(t)) matched += w
  }
  return total > 0 ? matched / total : 0
}

/**
 * Choose the passage of `entry.answer` that best answers `query`.
 *
 * Returns null when no passage is clearly better than the entry's own lead —
 * in that case the caller should keep the existing short answer. Reordering an
 * answer is only worth doing when it demonstrably helps.
 *
 * @param {object} entry     knowledge-base entry
 * @param {string} query     the user's question
 * @param {Map}    idf       corpus IDF, from the search index
 * @param {number} maxIdf    highest IDF in the corpus
 */
export function selectPassage(entry, query, idf, maxIdf) {
  const passages = toPassages(entry.answer)
  if (passages.length < 2) return null

  // Expand with domain synonyms so a question asking about a "tenant" can match
  // a passage that only ever says "organization".
  const queryWeights = expandQuery(tokenize(query))
  if (queryWeights.size === 0) return null

  const scored = passages.map((text, i) => ({
    text,
    i,
    score: scorePassage(text, queryWeights, idf, maxIdf),
  }))

  const best = scored.reduce((a, b) => (b.score > a.score ? b : a))
  const lead = scored[0]

  // Only override the lead when the winning passage is meaningfully better.
  // Without this margin, near-ties would shuffle answers for no gain and make
  // the bot's output feel arbitrary between similar questions.
  if (best.i === 0 || best.score < 0.5 || best.score - lead.score < 0.2) return null

  return {
    text: best.text,
    // The lead usually carries context the chosen passage assumes ("Tap Create
    // an organization…"), so keep it as a follow-on rather than dropping it.
    context: lead.text,
    score: Number(best.score.toFixed(2)),
    index: best.i,
  }
}
