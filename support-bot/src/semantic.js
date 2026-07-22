/**
 * Semantic search — match on meaning, not words.
 *
 * WHY THIS EXISTS
 * BM25 counts word overlap, and that produces a specific, repeatable failure:
 *
 *   "why do i keep getting signed out"  ->  "my password keeps getting rejected"
 *
 * Those share "keeps getting". They share nothing else. Word counting cannot
 * tell that one is about sessions and the other about passwords, and no amount
 * of synonym tuning fixes it — we tried, and splitting the synonym groups broke
 * more queries than it fixed.
 *
 * An embedding model turns a sentence into a vector positioned by MEANING, so
 * "signed out" lands near "session expired" even with no shared words.
 *
 * WHY HYBRID RATHER THAN PURE SEMANTIC
 * Each method fails where the other is strong. BM25 nails exact strings — error
 * messages, button labels, entry ids — which embeddings blur together.
 * Embeddings handle paraphrase, which BM25 cannot. So both run, and their
 * rankings are fused.
 *
 * Fusion uses Reciprocal Rank Fusion: combine by RANK, never by raw score.
 * BM25 scores and cosine similarities live on unrelated scales, so any
 * weighted-sum of the two would be tuning a meaningless constant.
 *
 * The embedding model is optional. Without it, retrieval falls back to BM25
 * alone and everything still works.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const OLLAMA = process.env.OLLAMA_URL || 'http://127.0.0.1:11434'
const MODEL = process.env.EMBED_MODEL || 'nomic-embed-text'
const ENABLED = process.env.SEMANTIC !== 'off'

/** RRF constant. 60 is the value from the original paper; it damps the top ranks
 *  so a single method cannot dominate on its own confidence. */
const RRF_K = 60

// ── Embedding ────────────────────────────────────────────────────────
/**
 * Query embeddings are cached in-process. The eval asks the same questions
 * across both tiers and re-runs constantly during tuning; without this the
 * suite spends most of its time re-embedding text it has already seen.
 */
const _queryCache = new Map()
const QUERY_CACHE_MAX = 4000

export async function embedCached(text) {
  const key = String(text || '')
  if (_queryCache.has(key)) return _queryCache.get(key)
  const vec = await embed(key)
  if (_queryCache.size >= QUERY_CACHE_MAX) _queryCache.clear()
  _queryCache.set(key, vec)
  return vec
}

export async function embed(text) {
  const res = await fetch(`${OLLAMA}/api/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt: String(text || '').slice(0, 2000) }),
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) throw new Error(`embeddings HTTP ${res.status}`)
  const body = await res.json()
  if (!Array.isArray(body.embedding)) throw new Error('no embedding returned')
  return body.embedding
}

export async function isAvailable() {
  if (!ENABLED) return { ok: false, reason: 'disabled via SEMANTIC=off' }
  try {
    const res = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return { ok: false, reason: `Ollama HTTP ${res.status}` }
    const names = ((await res.json()).models || []).map((m) => m.name)
    const has = names.some((n) => n === MODEL || n.startsWith(`${MODEL}:`))
    return has ? { ok: true, model: MODEL } : { ok: false, reason: `model "${MODEL}" not pulled` }
  } catch (err) {
    return { ok: false, reason: `unreachable at ${OLLAMA}` }
  }
}

// ── Vector maths ─────────────────────────────────────────────────────
function norm(v) {
  let s = 0
  for (const x of v) s += x * x
  const len = Math.sqrt(s) || 1
  return v.map((x) => x / len)
}

/** Cosine similarity of two already-normalized vectors is just their dot product. */
function dot(a, b) {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

// ── Index ────────────────────────────────────────────────────────────
/**
 * Build (or load) embeddings for every entry.
 *
 * Cached to disk and keyed by entry id + question, so a knowledge-base edit
 * re-embeds only what changed. Embedding 351 entries takes about a minute;
 * doing it on every server start would be indefensible.
 */
export async function buildSemanticIndex(entries, cachePath) {
  const avail = await isAvailable()
  if (!avail.ok) return null

  let cache = {}
  if (cachePath && existsSync(cachePath)) {
    try { cache = JSON.parse(readFileSync(cachePath, 'utf8')) } catch { cache = {} }
  }

  const vectors = []
  let embedded = 0
  let reused = 0

  for (const entry of entries) {
    // The text we embed is what a user's question should resemble: the entry's
    // own question plus the symptoms they would describe. Deliberately NOT the
    // full answer — long bodies dilute the vector toward generic prose and
    // everything starts looking equally similar to everything.
    const text = [entry.question, ...(entry.symptoms || [])].join(' \n ')
    const key = `${entry.id}::${hash(text)}`

    if (cache[key]) {
      vectors.push({ entry, vec: cache[key] })
      reused++
      continue
    }

    try {
      const vec = norm(await embed(text))
      cache[key] = vec
      vectors.push({ entry, vec })
      embedded++
    } catch (err) {
      // One failure must not sink the index — that entry simply has no vector
      // and is reachable by keyword search alone.
      vectors.push({ entry, vec: null })
    }
  }

  if (cachePath && embedded > 0) {
    try {
      mkdirSync(dirname(cachePath), { recursive: true })
      writeFileSync(cachePath, JSON.stringify(cache))
    } catch { /* cache is an optimisation, not a requirement */ }
  }

  return { vectors, model: avail.model, embedded, reused }
}

/** Cheap stable hash, so a reworded entry invalidates only its own cache line. */
function hash(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

// ── Search ───────────────────────────────────────────────────────────
/** Rank entries by meaning. Returns [{ entry, similarity }] best first. */
export async function semanticSearch(index, query, limit = 12) {
  if (!index) return []
  let qv
  try {
    qv = norm(await embedCached(query))
  } catch {
    return []
  }

  const scored = []
  for (const { entry, vec } of index.vectors) {
    if (!vec) continue
    scored.push({ entry, similarity: dot(qv, vec) })
  }
  scored.sort((a, b) => b.similarity - a.similarity)
  return scored.slice(0, limit)
}

/**
 * Fuse a keyword ranking and a semantic ranking.
 *
 * Reciprocal Rank Fusion: each list contributes 1/(k + rank) per entry. An
 * entry both methods rank highly wins; an entry only one method likes still
 * places, but below it. No score normalization is needed, which is the point —
 * BM25 scores and cosine similarities are not comparable quantities.
 *
 * @param {Array} keyword  BM25 results, best first (carry .entry and .confidence)
 * @param {Array} semantic semantic results, best first
 * @param {number} limit
 */
export function fuse(keyword, semantic, limit = 4) {
  const scores = new Map()
  const meta = new Map()

  keyword.forEach((r, i) => {
    const id = r.entry.id
    scores.set(id, (scores.get(id) || 0) + 1 / (RRF_K + i + 1))
    meta.set(id, { ...r, keywordRank: i + 1 })
  })

  semantic.forEach((r, i) => {
    const id = r.entry.id
    scores.set(id, (scores.get(id) || 0) + 1 / (RRF_K + i + 1))
    const prev = meta.get(id)
    meta.set(id, prev
      ? { ...prev, semanticRank: i + 1, similarity: r.similarity }
      : { entry: r.entry, semanticRank: i + 1, similarity: r.similarity, confidence: 0, coverage: 0, matchedTerms: 0, unknownRatio: 0, score: 0 })
  })

  const ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, fused]) => ({ ...meta.get(id), fused }))

  if (ranked.length === 0) return []

  // Re-derive the fields routing depends on, now over the FUSED order.
  // Confidence and margin must describe the ranking we actually return, not the
  // keyword ranking that produced part of it.
  const best = ranked[0].fused
  const runnerUp = ranked.length > 1 ? ranked[1].fused : 0

  return ranked.map((r, i) => {
    // An entry both methods agree on is more trustworthy than one only a single
    // method surfaced, so agreement lifts confidence.
    const bothAgree = r.keywordRank != null && r.semanticRank != null
    const relative = best > 0 ? r.fused / best : 0
    const agreement = bothAgree ? 1 : 0.72

    return {
      ...r,
      // Keep the keyword signals where we have them — the hard gates
      // (coverage, unknown-ratio) still run on the typed words.
      confidence: Math.round(Math.min(1, relative * agreement * (r.similarity != null ? 0.55 + 0.45 * Math.max(0, r.similarity) : 0.85)) * 100) / 100,
      margin: best > 0 ? (best - runnerUp) / best : 1,
      rank: i + 1,
    }
  })
}
