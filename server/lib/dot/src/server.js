/**
 * HTTP front end for the RackTrack support bot.
 *
 * Posture is defined by contract §8: auth on every endpoint except
 * /api/health, admin-only observability, validated client input, opaque errors
 * with a correlation id, security headers everywhere, loopback bind and
 * graceful shutdown. Policy decisions live in the small modules next door
 * (config/auth/ratelimit/http-security/logger); this file is the wiring and
 * the request validation.
 *
 * Nothing here re-derives routing behaviour — `ask()` owns that, and its
 * `route` is treated as authoritative, including for deciding what may be
 * written down about a request.
 */

import express from 'express'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'
import { appendFile, stat, rename, rm } from 'node:fs/promises'
import { ask, warmup, THRESHOLDS } from './bot.js'
import { loadKB } from './kb.js'
import { CONFIDENCE_WEIGHTS, FIELD_WEIGHTS, RETRIEVAL_SIGNALS } from './search.js'
import * as semantic from './semantic.js'
import { embedConfig } from './semantic.js'
import * as llm from './llm.js'
import { config } from './config.js'
import { log, newRequestId, errorFields, redactQuestion } from './logger.js'
import { authenticate, requireAdmin, isAdmin, resolveAuth } from './auth.js'
import { createRateLimiter, stopRateLimiters, clientIp } from './ratelimit.js'
import { securityHeaders, cors, noStore } from './http-security.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = join(HERE, '..', 'public')
const FEEDBACK_LOG = join(HERE, '..', 'kb', 'feedback.jsonl')
const FEEDBACK_ROTATED = FEEDBACK_LOG + '.1'

// A misconfigured server must not start. All problems are reported at once so
// the operator fixes the environment in one pass.
if (config.errors.length) {
  process.stderr.write('Refusing to start — invalid configuration:\n')
  for (const problem of config.errors) process.stderr.write(`  - ${problem}\n`)
  process.stderr.write('See .env.example for the accepted values.\n')
  process.exit(1)
}

/** Contract §1 route list, exhaustive. Metrics pre-seed so a zero is visible. */
const ROUTES = [
  'empty',
  'credential-guard',
  'verbatim',
  'grounded',
  'suggestions',
  'needs-access',
  'out-of-scope',
  'general',
  'general-fallback',
  'refusal',
]

/**
 * The same list with an explanation each, for the knowledge dashboard. Kept
 * beside ROUTES so a new route cannot be added without deciding what to tell a
 * reader about it.
 */
const ROUTE_DETAIL = [
  ['credential-guard', 'The message contained something shaped like a secret. Everything stops, the user is told to rotate it, and that text is never logged, stored, or sent to a model — including on later turns.'],
  ['out-of-scope', 'A question no model may answer: pricing, release plans, comparisons with other products, configuration for other vendors\' hardware, a figure we have not verified, or anything not about RackTrack at all. Fixed reply plus a route to a person.'],
  ['verbatim', 'One entry clearly wins, so its human-checked text is returned word for word. Nothing is generated, so nothing can be invented. Most questions land here.'],
  ['needs-access', 'A good answer exists but belongs to an administrator surface. Saying so is a real answer; quietly substituting a different entry is not.'],
  ['grounded', 'Several entries are relevant with no clear winner. The model phrases an answer from those entries only, must cite the one it used, and the citation is checked before display.'],
  ['suggestions', 'Same situation with no model available, or a generated answer that failed its check. The candidate questions are offered as buttons instead of a guess.'],
  ['general-fallback', 'A greeting, a thank-you, arithmetic or the date. Answered by built-in logic with no model involved.'],
  ['general', 'Plainly not about RackTrack, and general answering is switched on. Answered from world knowledge, labelled as unverified, citing nothing, and forbidden from stating a product fact.'],
  ['refusal', 'Nothing relevant, and the question touches the product. Says so and points to a person. This is a feature: the refusal log is the list of answers worth writing next.'],
  ['empty', 'No question was sent.'],
]

const metrics = {
  total: 0,
  totalMs: 0,
  errors: 0,
  rejected: 0,
  byRoute: Object.fromEntries(ROUTES.map((r) => [r, 0])),
  feedbackUp: 0,
  feedbackDown: 0,
}

/** Circular buffer for the operator dashboard. Question text obeys LOG_QUESTIONS. */
const recentRequests = []

const app = express()
app.disable('x-powered-by')
// Express' own proxy trust would let a client set req.ip via a header; the
// rate limiter decides that question itself from TRUST_PROXY.
app.set('trust proxy', false)

let shuttingDown = false

app.use((req, res, next) => {
  req.id = newRequestId()
  res.set('X-Request-Id', req.id)
  if (shuttingDown) {
    // Drain: refuse new work but let in-flight requests finish.
    res.set('Connection', 'close')
    return res.status(503).json({ error: 'shutting down', requestId: req.id })
  }
  next()
})
app.use(securityHeaders)
app.use(cors)

// Coarse per-IP ceiling in front of everything, including the auth check, so
// token guessing is throttled before it reaches the comparison.
app.use(
  '/api',
  createRateLimiter({
    name: 'global',
    burst: config.rate.global.burst,
    perMin: config.rate.global.perMin,
    key: (req) => `ip:${clientIp(req)}`,
  }),
)
app.use('/api', noStore)
app.use(express.json({ limit: config.bodyLimitBytes, type: 'application/json' }))

const chatLimiter = createRateLimiter({
  name: 'chat',
  burst: config.rate.chat.burst,
  perMin: config.rate.chat.perMin,
})
const feedbackLimiter = createRateLimiter({
  name: 'feedback',
  burst: config.rate.feedback.burst,
  perMin: config.rate.feedback.perMin,
})

// --- static consoles -------------------------------------------------------

/**
 * The two pages are read once and served with a per-request CSP nonce stamped
 * in, which is what allows script-src to stay free of 'unsafe-inline'.
 */
function loadPage(name) {
  return readFileSync(join(PUBLIC_DIR, name), 'utf8')
}
const PAGES = {
  'index.html': loadPage('index.html'),
  'dashboard.html': loadPage('dashboard.html'),
  'knowledge.html': loadPage('knowledge.html'),
}

function servePage(name) {
  return (_req, res) => {
    // The body carries the same nonce as this response's CSP header, so a cache
    // that ever served this body alongside a later header would break every
    // inline block on the page. Cheaper to never store it.
    res.set('Cache-Control', 'no-store')
    res.type('html').send(PAGES[name].replaceAll('__CSP_NONCE__', res.locals.cspNonce))
  }
}

app.get('/', servePage('index.html'))
app.get('/index.html', servePage('index.html'))
// The dashboard document holds no data of its own: everything it shows comes
// from /api/status, which requires an admin token. Serving the shell to anyone
// keeps the page able to prompt for that token.
app.get('/dashboard', servePage('dashboard.html'))
app.get('/dashboard.html', servePage('dashboard.html'))
// Same reasoning: the shell carries no knowledge-base content. Everything on it
// arrives from /api/knowledge, which is admin-only because listing entries would
// otherwise disclose the questions of admin and internal-only content.
app.get('/knowledge', servePage('knowledge.html'))
app.get('/knowledge.html', servePage('knowledge.html'))

// --- validation ------------------------------------------------------------

const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g

/**
 * Collapse anything that could break out of a JSONL record or a log line: a
 * newline inside a field would close the record early and let a caller forge a
 * second entry.
 */
function singleLine(text) {
  return String(text).replace(CONTROL_CHARS, ' ').trim()
}

function validateMessage(body) {
  const message = body?.message
  if (typeof message !== 'string') return { ok: false, reason: 'message must be a string' }
  const trimmed = message.trim()
  if (!trimmed) return { ok: false, reason: 'message is required' }
  if (trimmed.length > config.maxMessageChars) {
    return { ok: false, reason: `message must be at most ${config.maxMessageChars} characters` }
  }
  return { ok: true, value: trimmed }
}

/**
 * Client history is spliced into the model's message array, so it is treated
 * as hostile: only user/assistant turns, a bounded turn count, a bounded
 * length. Contract §8: "Client-supplied `history` is validated: `user`/
 * `assistant` roles only, capped turns and length. A client can never inject a
 * `system` message."
 *
 * The two failure modes are handled differently on purpose. A role or type we
 * do not recognise is a 400 — that is the injection attempt the contract names,
 * and silently dropping it would hide a broken or hostile client. Size is
 * *capped*, not rejected: the caps apply to text this server itself produced on
 * the previous turn (a long `answer` or `detail`), so a 400 there would let one
 * verbose reply wedge a conversation permanently.
 */
function validateHistory(body) {
  const history = body?.history
  if (history === undefined || history === null) return { ok: true, value: [] }
  if (!Array.isArray(history)) return { ok: false, reason: 'history must be an array' }

  const value = []
  for (const turn of history) {
    if (!turn || typeof turn !== 'object' || Array.isArray(turn)) {
      return { ok: false, reason: 'each history turn must be an object' }
    }
    if (turn.role !== 'user' && turn.role !== 'assistant') {
      return { ok: false, reason: 'history roles must be "user" or "assistant"' }
    }
    if (typeof turn.content !== 'string') return { ok: false, reason: 'history content must be a string' }
    // Rebuilt rather than passed through: extra keys never reach the model.
    value.push({ role: turn.role, content: turn.content.slice(0, config.maxHistoryChars) })
  }
  // Keep the newest turns; recency is what carries a conversation. Guarded
  // because slice(-0) is slice(0), which would keep everything.
  const kept = config.maxHistoryTurns > 0 ? value.slice(-config.maxHistoryTurns) : []
  return { ok: true, value: kept }
}

function badRequest(req, res, reason) {
  metrics.rejected++
  log.debug('rejected request', { reqId: req.id, path: req.path, reason })
  return res.status(400).json({ error: reason, requestId: req.id })
}

// --- health ----------------------------------------------------------------

/**
 * Open endpoint, but deliberately thin for strangers: readiness only.
 * Anonymous callers never trigger a live LLM probe — `isAvailable({recheck})`
 * writes a process-wide cache, so an open forced probe lets anyone latch a
 * transient backend failure for everyone.
 */
app.get('/api/health', async (req, res) => {
  const outcome = resolveAuth(req)
  if (outcome.ok) req.auth = outcome.auth

  if (!isAdmin(req)) {
    return res.json({ ok: kbReady, status: kbReady ? 'ready' : 'starting' })
  }

  const model = await llm.isAvailable({ recheck: req.query.recheck === '1' })
  res.json({
    ok: kbReady,
    status: kbReady ? 'ready' : 'starting',
    uptime: process.uptime(),
    knowledgeBase: warmup(),
    thresholds: THRESHOLDS,
    llm: model.ok ? { ok: true, backend: model.backend, model: model.model } : { ok: false, reason: model.reason },
  })
})

/**
 * Everything the console needs to render, scoped to the caller's own tier:
 * an end-user session never learns how many entries admin can see.
 */
app.get('/api/meta', authenticate, async (req, res) => {
  const counts = warmup()
  const model = await llm.isAvailable()
  res.json({
    tier: req.auth.tier,
    credentialed: req.auth.credentialed,
    tierOverrideAllowed: config.allowTierOverride,
    entriesVisible: counts[req.auth.tier] ?? 0,
    thresholds: THRESHOLDS,
    routes: ROUTES,
    // Published so a client trims to the same caps the server enforces rather
    // than hard-coding a copy that drifts when the environment changes.
    limits: {
      maxMessageChars: config.maxMessageChars,
      maxHistoryTurns: config.maxHistoryTurns,
      maxHistoryChars: config.maxHistoryChars,
    },
    llm: { ok: Boolean(model.ok) },
    feedbackEnabled: config.feedbackEnabled,
  })
})

// --- chat ------------------------------------------------------------------

app.post('/api/chat', authenticate, chatLimiter, async (req, res) => {
  const message = validateMessage(req.body)
  if (!message.ok) return badRequest(req, res, message.reason)
  const history = validateHistory(req.body)
  if (!history.ok) return badRequest(req, res, history.reason)

  const tier = req.auth.tier
  const started = Date.now()
  try {
    const result = await ask(message.value, { tier, history: history.value })
    const ms = Date.now() - started

    metrics.total++
    metrics.totalMs += ms
    metrics.byRoute[result.route] = (metrics.byRoute[result.route] || 0) + 1

    // Contract §8: "Detected credentials are redacted before the question is
    // logged, stored, or sent to any model." The router has already decided
    // that this text contains a secret, so nothing derived from it — not even
    // a truncated preview — is retained.
    const secret = result.route === 'credential-guard'
    const question = redactQuestion(message.value, secret ? { force: 'off' } : undefined)

    if (config.recentBufferSize > 0) {
      recentRequests.push({
        ts: new Date().toISOString(),
        reqId: req.id,
        question,
        redacted: question === null || config.logQuestions !== 'full',
        route: result.route,
        confidence: result.confidence ?? 0,
        sources: result.sources || [],
        tier,
        ms,
      })
      while (recentRequests.length > config.recentBufferSize) recentRequests.shift()
    }

    // Question text, when retained in full, is a debug-level detail only.
    const line = { reqId: req.id, route: result.route, tier, ms, confidence: result.confidence ?? 0, sources: result.sources?.length ?? 0 }
    if (config.logQuestions === 'full') {
      log.info('chat', line)
      if (!secret) log.debug('chat question', { reqId: req.id, question })
    } else {
      log.info('chat', { ...line, question })
    }
    if (result.warnings?.length) log.warn('chat warnings', { reqId: req.id, warnings: result.warnings })

    const { warnings, ...clientResult } = result
    res.json({ ...clientResult, tier, ms, requestId: req.id })
  } catch (err) {
    metrics.errors++
    // Detail stays server-side; the client gets the correlation id and nothing
    // that describes our internals (contract §8).
    log.error('chat failed', { reqId: req.id, ...errorFields(err) })
    res.status(500).json({ error: 'internal error', requestId: req.id })
  }
})

// --- feedback --------------------------------------------------------------

const SOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/**
 * Appends are serialised through one promise chain: concurrent requests can
 * otherwise interleave partial writes and corrupt the JSONL.
 */
let feedbackChain = Promise.resolve()

/**
 * Keep the log bounded. One rotation is enough — this is a review queue, not
 * an audit trail, and an unbounded file on the KB volume is a denial of
 * service that survives a restart.
 */
async function rotateIfNeeded(incomingBytes) {
  let size = 0
  try {
    size = (await stat(FEEDBACK_LOG)).size
  } catch (err) {
    // No file yet is the normal first-write case. Anything else (a permission
    // problem, a directory in the way) must not be mistaken for "empty", or the
    // cap silently stops applying for the life of the process.
    if (err.code === 'ENOENT') return
    throw err
  }
  if (size + incomingBytes <= config.feedbackMaxBytes) return
  await rm(FEEDBACK_ROTATED, { force: true })
  await rename(FEEDBACK_LOG, FEEDBACK_ROTATED)
}

function appendFeedback(entry) {
  const record = JSON.stringify(entry) + '\n'
  const done = feedbackChain.then(async () => {
    await rotateIfNeeded(Buffer.byteLength(record))
    await appendFile(FEEDBACK_LOG, record, 'utf8')
  })
  // The chain must survive a failed write or every later append inherits the
  // rejection; the caller still gets its own outcome from `done`.
  feedbackChain = done.catch(() => {})
  return done
}

app.post('/api/feedback', authenticate, feedbackLimiter, async (req, res) => {
  if (!config.feedbackEnabled) return res.status(503).json({ error: 'feedback disabled', requestId: req.id })

  const { question, route, sources, verdict } = req.body || {}
  if (verdict !== 'up' && verdict !== 'down') return badRequest(req, res, 'verdict must be "up" or "down"')
  if (typeof question !== 'string' || !question.trim()) return badRequest(req, res, 'question is required')
  if (question.length > config.maxMessageChars) return badRequest(req, res, 'question is too long')
  if (route !== undefined && (typeof route !== 'string' || !ROUTES.includes(route))) {
    return badRequest(req, res, 'route is not a known route')
  }
  if (sources !== undefined) {
    if (!Array.isArray(sources) || sources.length > 10) return badRequest(req, res, 'sources must be an array of at most 10 ids')
    if (!sources.every((s) => typeof s === 'string' && SOURCE_ID.test(s))) {
      return badRequest(req, res, 'sources must be short id strings')
    }
  }

  // The client tells us which route answered, so it can lie; the only thing
  // that decision gates here is whether the text is stored at all, and the safe
  // direction is to believe a claim of credential-guard.
  //
  // Outside that, this file is a human review queue — the question is the whole
  // point of a thumbs-down, so `redacted` (the default) still writes it. Only
  // LOG_QUESTIONS=off means "retain nothing", and it has to mean that here too
  // or the setting is a half-measure.
  const secret = route === 'credential-guard'
  const stored =
    secret || config.logQuestions === 'off'
      ? null
      : singleLine(question).slice(0, config.feedbackMaxQuestionChars)

  try {
    await appendFeedback({
      ts: new Date().toISOString(),
      question: stored,
      route: route || 'unknown',
      sources: (sources || []).slice(0, 10),
      verdict,
      tier: req.auth.tier,
    })
  } catch (err) {
    metrics.errors++
    log.error('feedback write failed', { reqId: req.id, ...errorFields(err) })
    return res.status(500).json({ error: 'internal error', requestId: req.id })
  }

  if (verdict === 'up') metrics.feedbackUp++
  else metrics.feedbackDown++
  res.json({ ok: true, requestId: req.id })
})

// --- observability ---------------------------------------------------------

app.get('/api/status', authenticate, requireAdmin, async (req, res) => {
  const model = await llm.isAvailable()
  res.json({
    uptime: process.uptime(),
    requests: metrics.total,
    byRoute: metrics.byRoute,
    avgMs: metrics.total > 0 ? Math.round(metrics.totalMs / metrics.total) : 0,
    errors: metrics.errors,
    rejected: metrics.rejected,
    feedback: { up: metrics.feedbackUp, down: metrics.feedbackDown },
    questionPolicy: config.logQuestions,
    thresholds: THRESHOLDS,
    recent: recentRequests.slice().reverse(),
    llm: model.ok ? { ok: true, backend: model.backend, model: model.model } : { ok: false, reason: model.reason },
    knowledgeBase: warmup(),
  })
})

/**
 * Everything the bot is working from: where its answers come from, how retrieval
 * is configured, and the full entry list.
 *
 * Admin-only, and not because the numbers are sensitive — because the entry list
 * includes admin and internal-only questions, and their wording alone discloses
 * what those surfaces are. The tier filter that protects the chat path would make
 * this page useless, so the page is gated instead.
 */
app.get('/api/knowledge', authenticate, requireAdmin, async (req, res) => {
  const kb = loadKB()
  const entries = kb.entries

  const tally = (pick) => {
    const out = {}
    for (const e of entries) {
      const k = pick(e) ?? 'unspecified'
      out[k] = (out[k] || 0) + 1
    }
    return out
  }

  // Provenance is the interesting axis: it says which answers were reviewed
  // against the code, which were copied from a documentation page, and which are
  // a summary of other entries.
  const provenance = tally((e) =>
    e._source ? e._source : (Array.isArray(e.evidence) && e.evidence.length && Number(e._votes) > 0 ? 'code-mined' : 'unattributed'))

  const documents = {}
  for (const e of entries) {
    for (const v of e.evidence || []) {
      const file = String(v?.file || '')
      if (!file.startsWith('docs/')) continue
      documents[file] = (documents[file] || 0) + 1
    }
  }

  const [model, embeddings] = await Promise.all([llm.isAvailable(), semantic.isAvailable()])

  res.json({
    counts: {
      total: entries.length,
      byAudience: tally((e) => e.audience),
      byDomain: tally((e) => e.domain),
      byConfidence: tally((e) => e.confidence),
      byProvenance: provenance,
      withShort: entries.filter((e) => e.short).length,
      withSymptoms: entries.filter((e) => e.symptoms?.length).length,
      symptomTotal: entries.reduce((n, e) => n + (e.symptoms?.length || 0), 0),
      visible: warmup(),
    },
    categories: kb.categories || [],
    documents,
    routes: ROUTE_DETAIL.map(([name, what]) => ({ name, what })),
    retrieval: {
      method: 'BM25 keyword search, fused with embedding search when available',
      thresholds: THRESHOLDS,
      confidenceWeights: CONFIDENCE_WEIGHTS,
      fieldWeights: FIELD_WEIGHTS,
      signals: RETRIEVAL_SIGNALS,
      spellingCorrection: true,
      embeddings: embeddings.ok
        ? { ok: true, provider: embeddings.provider, model: embeddings.model, dimensions: embeddings.dimensions || null }
        : { ok: false, provider: embedConfig.provider, model: embedConfig.model, reason: embeddings.reason },
      generation: model.ok
        ? { ok: true, backend: model.backend, model: model.model }
        : { ok: false, reason: model.reason },
      generalAnswers: config.generalAnswers ?? null,
    },
    entries: entries.map((e) => ({
      id: e.id,
      question: e.question,
      audience: e.audience,
      domain: e.domain,
      category: e.category || null,
      confidence: e.confidence,
      source: e._source || (Array.isArray(e.evidence) && e.evidence.length && Number(e._votes) > 0 ? 'code-mined' : 'unattributed'),
      votes: e._votes ?? null,
      symptoms: e.symptoms?.length || 0,
      answerChars: String(e.answer || '').length,
      evidence: (e.evidence || []).map((v) => `${v.file}${v.lines ? ':' + v.lines : ''}`),
    })),
  })
})

// --- fallbacks -------------------------------------------------------------

app.use((req, res) => {
  res.status(404).json({ error: 'not found', requestId: req.id })
})

// Body-parser failures land here (malformed JSON, oversized payload). The
// parser's message quotes the offending body, so it is logged, never returned.
app.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500
  if (status >= 500) {
    metrics.errors++
    log.error('request failed', { reqId: req.id, ...errorFields(err) })
    return res.status(500).json({ error: 'internal error', requestId: req.id })
  }
  metrics.rejected++
  log.debug('request rejected', { reqId: req.id, status, ...errorFields(err) })
  res.status(status).json({ error: status === 413 ? 'payload too large' : 'invalid request', requestId: req.id })
})

// --- boot ------------------------------------------------------------------

let kbReady = false
let counts = {}
try {
  counts = warmup()
  kbReady = true
} catch (err) {
  log.error('knowledge base failed to load', errorFields(err))
  process.exit(1)
}

const server = app.listen(config.port, config.host, () => {
  for (const warning of config.warnings) log.warn('configuration', { warning })
  log.info('listening', {
    url: `http://${config.host}:${config.port}`,
    env: config.nodeEnv,
    entries: counts,
    anonymous: config.allowAnonymous,
    tierOverride: config.allowTierOverride,
    logQuestions: config.logQuestions,
    tokens: config.tokens.length,
  })
  if (config.devAdminToken) {
    // Development convenience: no AUTH_TOKENS configured, so this ephemeral
    // token is the only way to reach the dashboard. It changes every boot.
    log.warn('generated a development admin token (set AUTH_TOKENS to disable)', { token: config.devAdminToken })
  }
})

// Slow-loris protection: a connection that never finishes its headers is not
// allowed to hold a socket forever.
server.headersTimeout = 20000
server.requestTimeout = 60000
server.keepAliveTimeout = 5000

/**
 * Stop accepting, let in-flight work finish, then close. The timer is the
 * backstop for a client that keeps a connection open past the drain window.
 */
function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  log.info('shutting down', { signal })

  const forced = setTimeout(() => {
    log.warn('shutdown timed out, closing remaining connections')
    server.closeAllConnections?.()
    process.exit(1)
  }, config.shutdownTimeoutMs)
  forced.unref()

  server.close((err) => {
    stopRateLimiters()
    clearTimeout(forced)
    if (err) {
      log.error('shutdown error', errorFields(err))
      process.exit(1)
    }
    // Let a queued feedback append land before the process goes away.
    feedbackChain.finally(() => {
      log.info('stopped')
      process.exit(0)
    })
  })
  server.closeIdleConnections?.()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('unhandledRejection', (reason) => {
  log.error('unhandled rejection', errorFields(reason))
})
// Node's default is an unstructured stack on stderr and exit 1; a log shipper
// would lose the one event that explains why the process disappeared.
process.on('uncaughtException', (err) => {
  log.error('uncaught exception', errorFields(err))
  process.exit(1)
})
