/**
 * Reranking — ask the model which candidate actually answers the question.
 *
 * Retrieval is a similarity problem: find text that looks like the query.
 * Answering is a relevance problem: decide which of those actually addresses
 * what was asked. They are not the same, and every retrieval method — keyword,
 * semantic, or both fused — optimises the first.
 *
 * So after retrieval narrows 351 entries to a handful, the model reads each
 * candidate against the question and scores it. That is a much easier job than
 * writing an answer, and it is where a small model is genuinely reliable.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * It never generates an answer, never reorders toward something that was not
 * retrieved, and never invents a candidate. It only scores what retrieval
 * already found — so the worst a bad rerank can do is pick a different verified
 * answer, never a fabricated one.
 *
 * Optional. Without a model, retrieval order stands unchanged.
 */

const OLLAMA = process.env.OLLAMA_URL || 'http://127.0.0.1:11434'
const MODEL = process.env.RERANK_MODEL || process.env.OLLAMA_MODEL || 'llama3.2:3b'
const ENABLED = process.env.RERANK !== 'off'
const TIMEOUT_MS = Number(process.env.RERANK_TIMEOUT_MS || 12000)

/** How many candidates to score. Beyond ~5 the latency stops being worth it. */
const MAX_CANDIDATES = 5

/**
 * Score one candidate 0-3 for how well it answers the question.
 *
 * A small integer scale rather than 0-100: a 3B model cannot meaningfully
 * distinguish 71 from 78, and asking it to pretend it can produces noise that
 * looks like signal.
 */
const SCALE = `3 = directly answers the question
2 = related and probably useful
1 = same general topic but does not answer it
0 = unrelated`

async function scoreOne(question, entry) {
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: `You judge whether a support answer addresses a user's question.

Reply with ONE digit and nothing else:
${SCALE}

Judge only whether it ANSWERS the question. A well-written answer to a different question scores 0.`,
        },
        {
          role: 'user',
          content: `Question from user:\n${question}\n\nCandidate answer:\n${entry.question}\n${(entry.short || entry.answer || '').slice(0, 400)}\n\nScore (0-3):`,
        },
      ],
      stream: false,
      options: { temperature: 0, top_p: 1, num_predict: 4, num_ctx: 2048 },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`rerank HTTP ${res.status}`)
  const text = (await res.json())?.message?.content || ''
  const m = text.match(/[0-3]/)
  return m ? Number(m[0]) : null
}

export async function isAvailable() {
  if (!ENABLED) return { ok: false, reason: 'disabled via RERANK=off' }
  try {
    const res = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return { ok: false, reason: `Ollama HTTP ${res.status}` }
    const names = ((await res.json()).models || []).map((m) => m.name)
    const has = names.some((n) => n === MODEL || n.startsWith(`${MODEL.split(':')[0]}:`))
    return has ? { ok: true, model: MODEL } : { ok: false, reason: `model "${MODEL}" not pulled` }
  } catch {
    return { ok: false, reason: `unreachable at ${OLLAMA}` }
  }
}

/**
 * Rerank retrieval results by judged relevance.
 *
 * Returns the same objects, reordered, each carrying `relevance` (0-3) and a
 * `rerankMargin` describing how clearly the winner beat the runner-up. Returns
 * the input untouched if the model is unavailable or every score fails.
 *
 * @param {string} question the user's question
 * @param {Array} results retrieval results, best first
 */
export async function rerank(question, results) {
  if (!results || results.length < 2) return results

  const candidates = results.slice(0, MAX_CANDIDATES)
  let scores
  try {
    // Scored in parallel: they are independent, and serially this would add
    // seconds to every ambiguous question.
    scores = await Promise.all(
      candidates.map((r) => scoreOne(question, r.entry).catch(() => null))
    )
  } catch {
    return results
  }

  // If the model could not score anything, retrieval order is all we have.
  if (scores.every((s) => s == null)) return results

  const scored = candidates.map((r, i) => ({
    ...r,
    relevance: scores[i],
    // Preserve retrieval position as the tie-break, so an unscored candidate
    // keeps the order retrieval gave it rather than drifting to the bottom.
    _retrievalRank: i,
  }))

  scored.sort((a, b) => {
    const ar = a.relevance == null ? -1 : a.relevance
    const br = b.relevance == null ? -1 : b.relevance
    if (br !== ar) return br - ar
    return a._retrievalRank - b._retrievalRank
  })

  const best = scored[0].relevance
  const second = scored.length > 1 ? scored[1].relevance : null

  return scored
    .map((r) => ({
      ...r,
      // A judged margin, separate from the retrieval margin. Two candidates
      // both scoring 3 means the model could not separate them either — that
      // is worth knowing before answering one of them verbatim.
      rerankMargin: best != null && second != null ? best - second : 1,
      reranked: true,
    }))
    .concat(results.slice(MAX_CANDIDATES))
}
