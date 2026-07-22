/**
 * Ollama client - the free, local, optional half of the bot.
 *
 * Everything here degrades gracefully. If Ollama is not installed or not
 * running, `isAvailable()` returns false and the bot falls back to pure
 * deterministic search. The bot is useful with zero installation and gets
 * more flexible when a model is present. It never hard-fails on the model.
 */

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434'
const MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b'
const TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 45000)

let _availability = null

/** Check once whether Ollama is reachable and the configured model is pulled. */
export async function isAvailable({ recheck = false } = {}) {
  if (_availability !== null && !recheck) return _availability

  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) {
      _availability = { ok: false, reason: `Ollama returned HTTP ${res.status}` }
      return _availability
    }

    const body = await res.json()
    const models = (body.models || []).map((m) => m.name)
    const hasModel = models.some((m) => m === MODEL || m.startsWith(`${MODEL.split(':')[0]}:`))

    _availability = hasModel
      ? { ok: true, model: MODEL, available: models }
      : {
          ok: false,
          reason: `Ollama is running but model "${MODEL}" is not pulled. Run: ollama pull ${MODEL}`,
          available: models,
        }
  } catch (err) {
    _availability = {
      ok: false,
      reason:
        err.name === 'TimeoutError'
          ? `Ollama did not respond at ${OLLAMA_URL}`
          : `Ollama unreachable at ${OLLAMA_URL} (${err.message})`,
    }
  }

  return _availability
}

/**
 * Generate a grounded answer. Returns { text } or throws.
 *
 * Deterministic settings on purpose: temperature 0 so the same question gives
 * the same answer every time. A support bot that answers differently on each
 * ask is untestable, and untestable means unverifiable.
 */
export async function generate(system, messages, { signal } = {}) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'system', content: system }, ...messages],
      stream: false,
      options: {
        temperature: 0,
        top_p: 1,
        num_predict: 500,
        // Room for the system prompt plus a handful of KB entries. Raise only
        // if you raise the entry count passed to the model.
        num_ctx: 8192,
      },
    }),
    signal: signal || AbortSignal.timeout(TIMEOUT_MS),
  })

  if (!res.ok) {
    throw new Error(`Ollama HTTP ${res.status}: ${await res.text().catch(() => '')}`)
  }

  const body = await res.json()
  const text = body?.message?.content?.trim()
  if (!text) throw new Error('Ollama returned an empty response')

  return { text, model: MODEL, evalCount: body.eval_count }
}

export const config = { url: OLLAMA_URL, model: MODEL, timeoutMs: TIMEOUT_MS }
