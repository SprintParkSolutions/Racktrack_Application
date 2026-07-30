/**
 * LLM client — Groq, Gemini, OpenRouter, or a local Ollama model.
 *
 * Backends are tried in priority order and the first that answers wins:
 *
 *   1. OPENROUTER_API_KEY   2. GROQ_API_KEY   3. GEMINI_API_KEY   4. local Ollama
 *
 * Everything here degrades gracefully. If no model is reachable, `isAvailable()`
 * returns false and the bot falls back to deterministic search: verbatim answers
 * still work, ambiguous questions offer a menu instead of a phrased answer, and
 * nothing hard-fails. The model is an enhancement, never a dependency.
 *
 * A model NEVER decides whether an answer is allowed — that is routing's job
 * (docs/ROUTING-CONTRACT.md). This file only transports prompts and text.
 */

// --- Groq config ---
const GROQ_API_KEY = process.env.GROQ_API_KEY || ''
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'

// --- Gemini config ---
// Disabled by default: the free-tier quota this project used is exhausted. Set
// GEMINI_ENABLED=true once a paid plan or a fresh quota is in place.
const GEMINI_ENABLED = process.env.GEMINI_ENABLED === 'true'
const GEMINI_API_KEY = GEMINI_ENABLED ? (process.env.GEMINI_API_KEY || '') : ''
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

// --- OpenRouter config ---
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b:free'

// --- Ollama config ---
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434'
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b'

const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || process.env.OLLAMA_TIMEOUT_MS || 20000)
const MAX_TOKENS = Number(process.env.LLM_MAX_TOKENS || 500)

/**
 * How long an availability result is trusted.
 *
 * Both directions matter: a backend that was down at boot must be picked up
 * without a restart, and a backend that has since failed must not be probed on
 * every single request. A minute is short enough to self-heal and long enough
 * that a busy server is not spending its time on health checks.
 */
const AVAILABILITY_TTL_MS = Number(process.env.LLM_RECHECK_MS || 60_000)

const noisy = process.env.LOG_LEVEL === 'debug'
const note = (msg) => { if (noisy) console.log(`  [llm] ${msg}`) }

let _availability = null
let _availabilityAt = 0
let _backend = null // 'groq' | 'gemini' | 'openrouter' | 'ollama' | null

/** Check whether any LLM backend is reachable. Cached for AVAILABILITY_TTL_MS. */
export async function isAvailable({ recheck = false } = {}) {
  const fresh = _availability !== null && Date.now() - _availabilityAt < AVAILABILITY_TTL_MS
  if (fresh && !recheck) return _availability

  _availability = await probe()
  _availabilityAt = Date.now()
  if (!_availability.ok) _backend = null
  return _availability
}

async function probe() {
  // 1. OpenRouter. Probed via the lightweight /auth/key endpoint rather than a
  //    generation: free models can take 20-30s even for a single token, which
  //    made a generation-based health check time out and report "unavailable".
  if (OPENROUTER_API_KEY) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
        headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` },
        signal: AbortSignal.timeout(8000),
      })
      if (res.ok) {
        _backend = 'openrouter'
        return { ok: true, model: OPENROUTER_MODEL, backend: 'openrouter' }
      }
      note(`OpenRouter returned ${res.status}; trying next backend`)
    } catch (err) {
      note(`OpenRouter unreachable (${err.message}); trying next backend`)
    }
  }

  // 2. Groq. A 429 still means the backend is there and configured correctly.
  if (GROQ_API_KEY) {
    try {
      const res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: GROQ_MODEL, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
        signal: AbortSignal.timeout(8000),
      })
      if (res.ok || res.status === 429) {
        _backend = 'groq'
        return { ok: true, model: GROQ_MODEL, backend: 'groq' }
      }
      note(`Groq returned ${res.status}; trying next backend`)
    } catch (err) {
      note(`Groq unreachable (${err.message}); trying next backend`)
    }
  }

  // 3. Gemini.
  if (GEMINI_API_KEY) {
    try {
      const res = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'hi' }] }],
          generationConfig: { maxOutputTokens: 1 },
        }),
        signal: AbortSignal.timeout(8000),
      })
      if (res.ok || res.status === 429) {
        _backend = 'gemini'
        return { ok: true, model: GEMINI_MODEL, backend: 'gemini' }
      }
      note(`Gemini returned ${res.status}; trying next backend`)
    } catch (err) {
      note(`Gemini unreachable (${err.message}); trying next backend`)
    }
  }

  // 4. Local Ollama.
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return { ok: false, reason: `Ollama returned HTTP ${res.status}` }

    const models = ((await res.json()).models || []).map((m) => m.name)
    const hasModel = models.some((m) => m === OLLAMA_MODEL || m.startsWith(`${OLLAMA_MODEL.split(':')[0]}:`))
    if (hasModel) {
      _backend = 'ollama'
      return { ok: true, model: OLLAMA_MODEL, backend: 'ollama', available: models }
    }
    return {
      ok: false,
      reason: `Ollama is running but model "${OLLAMA_MODEL}" is not pulled. Run: ollama pull ${OLLAMA_MODEL}`,
      available: models,
    }
  } catch (err) {
    const configured = [
      OPENROUTER_API_KEY && 'OpenRouter',
      GROQ_API_KEY && 'Groq',
      GEMINI_API_KEY && 'Gemini',
    ].filter(Boolean)
    const parts = configured.map((n) => `${n} not reachable`)
    parts.push(
      err.name === 'TimeoutError'
        ? `Ollama did not respond at ${OLLAMA_URL}`
        : `Ollama unreachable at ${OLLAMA_URL}`,
    )
    return { ok: false, reason: parts.join('; ') }
  }
}

/**
 * Generate an answer. Returns { text, model, backend } or throws.
 *
 * Deterministic settings on purpose: temperature 0 so the same question gives
 * the same answer every time. A support bot that answers differently on each
 * ask is untestable, and untestable means unverifiable.
 */
export async function generate(system, messages, { signal } = {}) {
  if (!Array.isArray(messages) || messages.length === 0) throw new Error('no messages to send')

  // Try the selected backend first, then the rest in priority order.
  const backends = ['openrouter', 'groq', 'gemini', 'ollama']
  const startIdx = backends.indexOf(_backend)
  const chain = startIdx >= 0 ? [...backends.slice(startIdx), ...backends.slice(0, startIdx)] : backends

  let lastError = null
  for (const backend of chain) {
    try {
      if (backend === 'groq' && GROQ_API_KEY) {
        return await generateOpenAICompatible(GROQ_URL, GROQ_API_KEY, GROQ_MODEL, 'groq', system, messages, { signal })
      }
      if (backend === 'gemini' && GEMINI_API_KEY) {
        return await generateGemini(system, messages, { signal })
      }
      if (backend === 'openrouter' && OPENROUTER_API_KEY) {
        return await generateOpenAICompatible(OPENROUTER_URL, OPENROUTER_API_KEY, OPENROUTER_MODEL, 'openrouter', system, messages, {
          signal,
          extraHeaders: { 'HTTP-Referer': 'http://localhost:4545', 'X-Title': 'RackTrack Support Bot' },
        })
      }
      if (backend === 'ollama') {
        return await generateOllama(system, messages, { signal })
      }
    } catch (err) {
      note(`${backend} generate failed (${err.message}); trying next backend`)
      lastError = err
    }
  }

  throw lastError || new Error('All LLM backends failed')
}

/** Shared handler for OpenAI-compatible APIs (Groq, OpenRouter). */
async function generateOpenAICompatible(url, apiKey, model, backend, system, messages, { signal, extraHeaders } = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, ...messages],
      temperature: 0,
      top_p: 1,
      max_tokens: MAX_TOKENS,
    }),
    signal: signal || AbortSignal.timeout(TIMEOUT_MS),
  })

  if (!res.ok) throw new Error(`${backend} HTTP ${res.status}`)

  const body = await res.json()
  const text = stripThinking(body?.choices?.[0]?.message?.content)
  if (!text) throw new Error(`${backend} returned an empty response`)

  return { text, model, backend }
}

async function generateGemini(system, messages, { signal } = {}) {
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))

  const res = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { temperature: 0, topP: 1, maxOutputTokens: MAX_TOKENS },
    }),
    signal: signal || AbortSignal.timeout(TIMEOUT_MS),
  })

  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`)

  const body = await res.json()
  const text = stripThinking(body?.candidates?.[0]?.content?.parts?.[0]?.text)
  if (!text) throw new Error('Gemini returned an empty response')

  return { text, model: GEMINI_MODEL, backend: 'gemini' }
}

async function generateOllama(system, messages, { signal } = {}) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [{ role: 'system', content: system }, ...messages],
      stream: false,
      options: { temperature: 0, top_p: 1, num_predict: MAX_TOKENS, num_ctx: 8192 },
    }),
    signal: signal || AbortSignal.timeout(TIMEOUT_MS),
  })

  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`)

  const body = await res.json()
  const text = stripThinking(body?.message?.content)
  if (!text) throw new Error('Ollama returned an empty response')

  return { text, model: OLLAMA_MODEL, backend: 'ollama', evalCount: body.eval_count }
}

/** Reasoning models emit <think> blocks before the answer; those are not output. */
function stripThinking(raw) {
  return String(raw || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
}

export const config = {
  backend: () => _backend,
  groq: { model: GROQ_MODEL, hasKey: !!GROQ_API_KEY },
  gemini: { model: GEMINI_MODEL, hasKey: !!GEMINI_API_KEY, enabled: GEMINI_ENABLED },
  openrouter: { url: OPENROUTER_URL, model: OPENROUTER_MODEL, hasKey: !!OPENROUTER_API_KEY },
  ollama: { url: OLLAMA_URL, model: OLLAMA_MODEL },
  timeoutMs: TIMEOUT_MS,
  maxTokens: MAX_TOKENS,
}
