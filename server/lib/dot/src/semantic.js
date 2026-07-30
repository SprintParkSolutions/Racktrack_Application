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
 * WHAT FUSION MAY AND MAY NOT DO (docs/ROUTING-CONTRACT.md §6)
 * Fusion reorders candidates and adds candidates. It never invents keyword
 * evidence: coverage, matched terms and unknown-ratio always describe the words
 * the user typed, and confidence stays on the keyword scale so one set of
 * thresholds is meaningful whether or not the embedding model is running.
 *
 * The embedding model is optional. Without it, retrieval falls back to BM25
 * alone and everything still works.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import { dirname } from 'node:path'
import { THRESHOLDS } from './search.js'

/**
 * Where embeddings come from.
 *
 * Two providers, because they suit different deployments. NVIDIA NIM is a hosted
 * API and needs no local install, which is what a server deployment wants;
 * Ollama runs on the machine and costs nothing per call, which is what a laptop
 * wants. Set EMBED_PROVIDER to force one; otherwise an NVIDIA key selects NVIDIA
 * and its absence falls back to a local Ollama.
 *
 * OpenRouter is deliberately not an option here: it serves chat completions
 * only, and asking it for an embedding returns "model does not exist". The
 * NVIDIA chat model configured in llm.js goes through OpenRouter; embeddings
 * have to come from NVIDIA directly.
 */
const PROVIDER = (process.env.EMBED_PROVIDER || (process.env.NVIDIA_API_KEY ? 'nvidia' : 'ollama')).toLowerCase()

const OLLAMA = process.env.OLLAMA_URL || 'http://127.0.0.1:11434'
const OLLAMA_EMBED_MODEL = process.env.EMBED_MODEL || 'nomic-embed-text'

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || ''
const NVIDIA_BASE_URL = process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1'
/** An asymmetric retrieval model: it embeds a question and a passage differently,
 *  which is exactly the job here. Override with NVIDIA_EMBED_MODEL. */
const NVIDIA_EMBED_MODEL = process.env.NVIDIA_EMBED_MODEL || 'nvidia/llama-3.2-nv-embedqa-1b-v2'

const MODEL = PROVIDER === 'nvidia' ? NVIDIA_EMBED_MODEL : OLLAMA_EMBED_MODEL
const ENABLED = process.env.SEMANTIC !== 'off'

/** How many passages to embed per request. NIM accepts batches; Ollama does not. */
const BATCH = Number(process.env.EMBED_BATCH || 32)

/** RRF constant. 60 is the value from the original paper; it damps the top ranks
 *  so a single method cannot dominate on its own confidence. */
const RRF_K = 60

/**
 * How long a failed availability probe is trusted before we look again.
 * Without a TTL, one probe during startup — while Ollama was still warming up,
 * or briefly unreachable — disabled semantic search for the life of the
 * process, and the only cure was a restart nobody knew they needed.
 */
const AVAILABILITY_TTL_MS = Number(process.env.SEMANTIC_RECHECK_MS || 60_000)

// ── Embedding ────────────────────────────────────────────────────────
/**
 * Query embeddings are cached in-process. The eval asks the same questions
 * across both tiers and re-runs constantly during tuning; without this the
 * suite spends most of its time re-embedding text it has already seen.
 */
const _queryCache = new Map()
const QUERY_CACHE_MAX = 4000

export async function embedCached(text, kind = 'query') {
  const key = `${kind}:${String(text || '')}`
  if (_queryCache.has(key)) {
    // Refresh recency so a hot query is not the one evicted.
    const vec = _queryCache.get(key)
    _queryCache.delete(key)
    _queryCache.set(key, vec)
    return vec
  }
  const vec = await embed(String(text || ''), kind)
  // Evict oldest rather than clearing everything: a full flush at the cap meant
  // a long tuning run periodically re-embedded its entire working set.
  while (_queryCache.size >= QUERY_CACHE_MAX) {
    _queryCache.delete(_queryCache.keys().next().value)
  }
  _queryCache.set(key, vec)
  return vec
}

export async function embed(text, kind = 'query') {
  const [vec] = await embedBatch([text], kind)
  return vec
}

/**
 * Embed several texts at once.
 *
 * `kind` matters for retrieval models that treat the two sides differently: a
 * question and the passage answering it are embedded with different instructions
 * so they land near each other. Getting this backwards quietly degrades every
 * result, which is the kind of bug that looks like "semantic search isn't very
 * good" rather than like a mistake.
 */
export async function embedBatch(texts, kind = 'passage') {
  const inputs = texts.map((t) => String(t || '').slice(0, 2000))
  if (inputs.length === 0) return []
  return PROVIDER === 'nvidia' ? embedNvidia(inputs, kind) : embedOllama(inputs)
}

async function embedNvidia(inputs, kind) {
  if (!NVIDIA_API_KEY) throw new Error('NVIDIA_API_KEY is not set')

  const res = await fetch(`${NVIDIA_BASE_URL}/embeddings`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${NVIDIA_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: NVIDIA_EMBED_MODEL,
      input: inputs,
      input_type: kind === 'query' ? 'query' : 'passage',
      encoding_format: 'float',
      truncate: 'END',
    }),
    signal: AbortSignal.timeout(60000),
  })
  if (!res.ok) throw new Error(`NVIDIA embeddings HTTP ${res.status}`)

  const body = await res.json()
  const data = Array.isArray(body?.data) ? body.data : []
  if (data.length !== inputs.length) throw new Error(`NVIDIA returned ${data.length} vectors for ${inputs.length} inputs`)

  // The API documents index ordering but does not promise it, and a silently
  // shuffled batch would attach every vector to the wrong entry.
  const out = new Array(inputs.length)
  for (const item of data) {
    const at = Number.isInteger(item?.index) ? item.index : data.indexOf(item)
    if (!Array.isArray(item?.embedding) || item.embedding.length === 0) throw new Error('NVIDIA returned an empty embedding')
    out[at] = item.embedding
  }
  if (out.some((v) => !v)) throw new Error('NVIDIA response was missing a vector')
  return out
}

async function embedOllama(inputs) {
  const out = []
  for (const input of inputs) {
    const res = await fetch(`${OLLAMA}/api/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, prompt: input }),
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) throw new Error(`embeddings HTTP ${res.status}`)
    const body = await res.json()
    if (!Array.isArray(body.embedding) || body.embedding.length === 0) throw new Error('no embedding returned')
    out.push(body.embedding)
  }
  return out
}

let _availability = null
let _availabilityAt = 0

export async function isAvailable({ recheck = false } = {}) {
  if (!ENABLED) return { ok: false, reason: 'disabled via SEMANTIC=off' }

  const fresh = _availability && Date.now() - _availabilityAt < AVAILABILITY_TTL_MS
  if (fresh && !recheck) return _availability

  _availability = PROVIDER === 'nvidia' ? await probeNvidia() : await probeOllama()
  _availabilityAt = Date.now()
  return _availability
}

async function probeNvidia() {
  if (!NVIDIA_API_KEY) {
    return { ok: false, provider: 'nvidia', reason: 'NVIDIA_API_KEY is not set — get one at https://build.nvidia.com' }
  }
  try {
    // One short embedding is the only honest test that the key, the model name
    // and the endpoint all work together. Checking the key alone would report
    // "available" and then fail on every entry.
    const [vec] = await embedNvidia(['ping'], 'query')
    return { ok: true, provider: 'nvidia', model: NVIDIA_EMBED_MODEL, dimensions: vec.length }
  } catch (err) {
    return { ok: false, provider: 'nvidia', reason: `${NVIDIA_EMBED_MODEL}: ${err.message}` }
  }
}

async function probeOllama() {
  try {
    const res = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return { ok: false, provider: 'ollama', reason: `Ollama HTTP ${res.status}` }

    const names = ((await res.json()).models || []).map((m) => m.name)
    const has = names.some((n) => n === OLLAMA_EMBED_MODEL || n.startsWith(`${OLLAMA_EMBED_MODEL}:`))
    return has
      ? { ok: true, provider: 'ollama', model: OLLAMA_EMBED_MODEL }
      : { ok: false, provider: 'ollama', reason: `model "${OLLAMA_EMBED_MODEL}" not pulled — run: ollama pull ${OLLAMA_EMBED_MODEL}` }
  } catch {
    return { ok: false, provider: 'ollama', reason: `unreachable at ${OLLAMA}` }
  }
}

/** What the embedding layer is configured to use, for health output. */
export const embedConfig = {
  provider: PROVIDER,
  model: MODEL,
  hasNvidiaKey: !!NVIDIA_API_KEY,
  ollamaUrl: OLLAMA,
  batch: BATCH,
}

// ── Vector maths ─────────────────────────────────────────────────────
function norm(v) {
  let s = 0
  for (const x of v) s += x * x
  const len = Math.sqrt(s)
  // A zero vector has no direction; normalising it by 1 would leave zeros that
  // silently score 0 against everything. Treat it as absent instead.
  if (!len || !Number.isFinite(len)) return null
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
 * re-embeds only what changed. Embedding a few hundred entries takes about a
 * minute; doing it on every server start would be indefensible.
 */
export async function buildSemanticIndex(entries, cachePath) {
  const avail = await isAvailable()
  if (!avail.ok) return null

  let cache = {}
  if (cachePath && existsSync(cachePath)) {
    try { cache = JSON.parse(readFileSync(cachePath, 'utf8')) } catch { cache = {} }
  }

  const live = new Set()
  let embedded = 0
  let reused = 0
  let failed = 0

  // The text we embed is what a user's question should resemble: the entry's own
  // question plus the symptoms they would describe. Deliberately NOT the full
  // answer — long bodies dilute the vector toward generic prose and everything
  // starts looking equally similar to everything.
  const planned = entries.map((entry) => {
    const text = [entry.question, ...(entry.symptoms || [])].join(' \n ')
    // Provider and model are part of the key: vectors from different models are
    // different lengths and are not comparable, so switching provider has to
    // re-embed rather than silently mix two coordinate systems.
    const key = `${PROVIDER}:${MODEL}::${entry.id}::${hash(text)}`
    live.add(key)
    return { entry, text, key }
  })

  const vectors = planned.map(({ entry, key }) => {
    if (cache[key]) {
      reused++
      return { entry, vec: cache[key] }
    }
    return { entry, vec: null }
  })

  // Everything still missing, in batches. A hosted provider charges per request,
  // so 500 entries as 16 requests rather than 500 matters; Ollama loops
  // internally and is unaffected.
  const missing = planned.map((p, i) => ({ ...p, i })).filter((p) => !vectors[p.i].vec)
  for (let start = 0; start < missing.length; start += BATCH) {
    const slice = missing.slice(start, start + BATCH)
    try {
      const raw = await embedBatch(slice.map((s) => s.text), 'passage')
      slice.forEach((s, j) => {
        const vec = norm(raw[j])
        if (!vec) { failed++; return }
        cache[s.key] = vec
        vectors[s.i] = { entry: s.entry, vec }
        embedded++
      })
    } catch {
      // One failed batch must not sink the index — those entries simply have no
      // vector and stay reachable by keyword search alone.
      failed += slice.length
    }
  }

  if (cachePath && embedded > 0) {
    // Drop vectors for entries that were reworded or deleted. Without this the
    // cache only ever grows: every edit leaves its old vector behind forever.
    const pruned = {}
    for (const key of live) if (cache[key]) pruned[key] = cache[key]
    writeCache(cachePath, pruned)
  }

  return { vectors, provider: PROVIDER, model: MODEL, embedded, reused, failed }
}

/** Write the cache atomically; a half-written cache is worse than none. */
function writeCache(cachePath, cache) {
  try {
    mkdirSync(dirname(cachePath), { recursive: true })
    const tmp = `${cachePath}.tmp`
    writeFileSync(tmp, JSON.stringify(cache))
    renameSync(tmp, cachePath)
  } catch { /* cache is an optimisation, not a requirement */ }
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
  if (!qv) return []

  const scored = []
  for (const { entry, vec } of index.vectors) {
    if (!vec || vec.length !== qv.length) continue
    scored.push({ entry, similarity: dot(qv, vec) })
  }
  scored.sort((a, b) => b.similarity - a.similarity)
  return scored.slice(0, limit)
}

/**
 * Confidence for an entry only semantic search found.
 *
 * Such an entry has no keyword evidence at all, so it can never be quoted
 * verbatim (contract §2) and this value is capped just below DIRECT. Similarity
 * below ~0.4 is the background noise level of this model — unrelated entries
 * routinely sit there — so the scale starts above it.
 */
function semanticOnlyConfidence(similarity) {
  const above = Math.max(0, (similarity ?? 0) - 0.40) / 0.60
  const conf = Math.min(THRESHOLDS.DIRECT - 0.01, above * 0.85)
  return Math.round(Math.max(0, conf) * 100) / 100
}

/**
 * Fuse a keyword ranking and a semantic ranking.
 *
 * Reciprocal Rank Fusion decides the ORDER: each list contributes 1/(k + rank)
 * per entry, so an entry both methods rank highly wins. No score normalization
 * is needed, which is the point — BM25 scores and cosine similarities are not
 * comparable quantities.
 *
 * Confidence is NOT fused. An entry keyword search found keeps its keyword
 * confidence, because that is the number every threshold was tuned against; an
 * entry only embeddings found gets a conservative similarity-derived value that
 * cannot reach the verbatim threshold. Blending the two produced a number on
 * its own private scale, where a keyword match worth 0.20 came out at 0.61 and
 * sailed through a gate designed to stop it.
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
      : {
          entry: r.entry,
          semanticRank: i + 1,
          similarity: r.similarity,
          semanticOnly: true,
          // No keyword evidence exists for this entry. Saying so honestly is
          // what keeps the hard gates meaningful.
          confidence: semanticOnlyConfidence(r.similarity),
          coverage: 0,
          questionOverlap: 0,
          questionPrecision: 0,
          matchedTerms: 0,
          matchedMass: 0,
          unknownRatio: 0,
          score: 0,
        })
  })

  const ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, fused]) => ({ ...meta.get(id), fused }))

  if (ranked.length === 0) return []

  // Margin is recomputed over the fused order, in confidence units, because
  // that is what routing gates on — the keyword margin described a ranking we
  // are no longer returning.
  const best = ranked[0].confidence || 0
  const runnerUp = ranked.length > 1 ? ranked[1].confidence || 0 : 0

  const questionLead = (ranked[0].questionOverlap ?? 0) - (ranked.length > 1 ? ranked[1].questionOverlap ?? 0 : 0)
  const precisionLead = (ranked[0].questionPrecision ?? 0) - (ranked.length > 1 ? ranked[1].questionPrecision ?? 0 : 0)

  return ranked.map((r, i) => ({
    ...r,
    margin: i === 0 ? (best > 0 ? (best - runnerUp) / best : 1) : 0,
    questionLead: i === 0 ? questionLead : 0,
    precisionLead: i === 0 ? precisionLead : 0,
    rank: i + 1,
  }))
}
