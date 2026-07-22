// Support bot API.
//
// Routes:
//   POST /api/support/ask     — ask a question, get a grounded answer
//   GET  /api/support/status  — knowledge base size + local model availability
//
// All routes require auth. The knowledge tier is derived from the
// authenticated user's role server-side — never from anything the client
// sends — so a member cannot reach admin or internal knowledge by asking.
//
// Every refusal is logged. That log is the knowledge-base backlog: real
// questions from real users that the bot could not answer, ranked by how
// often they come up.

const path = require('path');
const express = require('express');
const router = express.Router();

const auth = require('./auth');
const bot = require('./lib/support_bot');
const { uploadLimiter } = require('./lib/rate_limit');
const { appendJsonlWithRotation } = require('./lib/jsonl_rotation');
const { logger, recordEvent } = require('./lib/observability');

const REFUSAL_LOG = path.join(__dirname, 'data', 'support-refusals.jsonl');
const MAX_QUESTION_CHARS = 1000;
const MAX_HISTORY_TURNS = 6;
const MAX_NEAR_MISSES = 4;

// Load the knowledge base once at boot. A missing or malformed KB must never
// take the rest of RackTrack down — the support routes just report unavailable
// and everything else keeps serving.
let kbReady = false;
let kbError = null;
try {
  const counts = bot.warmup();
  kbReady = true;
  logger?.info?.(
    `[support] knowledge base loaded — ${Object.entries(counts).map(([t, n]) => `${t}=${n}`).join(', ')}`
  );
} catch (err) {
  kbError = err.message;
  logger?.warn?.(`[support] disabled — ${err.message}`);
}

router.use('/api/support', auth.requireAuth);

router.use('/api/support', (req, res, next) => {
  if (!kbReady) {
    return res.status(503).json({
      error: 'Support assistant is unavailable right now. Please contact your administrator.',
      // Surfaced so an operator can diagnose without reading boot logs. Says
      // what failed to load, never anything about a user or their data.
      reason: kbError,
    });
  }
  next();
});

// Answering is cheap (local BM25) but the optional model is not free of CPU,
// so keep a sane ceiling per user.
//
// This is a conversation, not an upload queue. A technician diagnosing one
// problem asks a question, reads, asks two or three follow-ups, tries a
// suggestion, comes back — a dozen turns in a few minutes is ordinary use. The
// previous 1/min sustained meant the eleventh question of a troubleshooting
// session was refused and every one after it made the user wait a full minute,
// which is a broken support tool rather than a protected one.
//
// 30/hour sustained with a burst of 10 covers a whole session without the user
// ever meeting the limit, and still caps a runaway client at one model call
// every two minutes once the burst is spent.
// 60/hour, not 30. The previous limiter was rate:1/min — i.e. 60/hour — and
// this "fix" set 30/hour while its own comment claimed to be loosening it,
// halving the ceiling and doubling the wait from 60s to 120s. The eleventh
// question of a troubleshooting session was refused either way (burst is what
// governs that), so every dimension of the scenario the comment cites got
// worse. Restores the old sustained rate and keeps the corrected message text.
const ASK_PER_HOUR = 60;
const ASK_BURST = 10;
const askLimiter = uploadLimiter({ rate: ASK_PER_HOUR / 60, burst: ASK_BURST });

/** "in about 2 minutes" / "in about 45 seconds" — what a person needs to know. */
function humanWait(seconds) {
  if (seconds < 90) return `in about ${Math.max(1, Math.round(seconds))} seconds`;
  const mins = Math.round(seconds / 60);
  return `in about ${mins} minute${mins === 1 ? '' : 's'}`;
}

/**
 * The shared limiter speaks in uploads-per-minute; this route is questions per
 * hour. Both the 429 text and the advertised limit are rewritten here so the
 * user is told the real ceiling and a real time to come back, rather than
 * "too many uploads" and a number in the wrong unit.
 */
function askRateLimit(req, res, next) {
  const sendJson = res.json.bind(res);
  res.json = (body) => {
    if (body && body.error === 'rate_limited') {
      const retryAfter = Number(res.getHeader('Retry-After')) || 60;
      res.setHeader('X-RateLimit-Limit', String(ASK_PER_HOUR));
      return sendJson({
        error: 'rate_limited',
        message:
          `That's a lot of questions at once — you can ask up to ${ASK_PER_HOUR} an hour. ` +
          `Try again ${humanWait(retryAfter)}.`,
        retryAfterSeconds: retryAfter,
      });
    }
    return sendJson(body);
  };
  askLimiter(req, res, () => {
    res.setHeader('X-RateLimit-Limit', String(ASK_PER_HOUR));
    next();
  });
}

function safeAsync(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      const status = err.statusCode || 500;
      logger?.error?.(`[support] ${req.method} ${req.originalUrl} — ${err.message}`);
      res.status(status).json({ error: status === 500 ? 'internal error' : err.message });
    }
  };
}

/**
 * Log a question the bot could not answer, so the KB can be grown to cover it.
 * Questions are user data: we store the text (we need it to fix the gap) but
 * nothing else identifying beyond the user id, and never the answer body.
 */
function logRefusal(req, question, result) {
  try {
    appendJsonlWithRotation(REFUSAL_LOG, {
      at: new Date().toISOString(),
      userId: req.user?.id ?? null,
      tier: result.tier,
      route: result.route,
      confidence: result.confidence,
      question: question.slice(0, MAX_QUESTION_CHARS),
      // The near misses are the point of this log. A bare list of ids says a
      // question was refused; id + title + score says WHY — whether the right
      // entry exists and scored just under the bar (fix the entry's wording) or
      // whether nothing came close at all (write a new entry).
      nearMisses: (result.matches || []).slice(0, MAX_NEAR_MISSES).map((m) => ({
        id: m.id,
        title: m.question,
        score: m.score,
        confidence: m.confidence,
      })),
    });
  } catch (err) {
    logger?.warn?.(`[support] could not write refusal log: ${err.message}`);
  }
}

// ── POST /api/support/ask ────────────────────────────────────────────
router.post(
  '/api/support/ask',
  askRateLimit,
  safeAsync(async (req, res) => {
    const { message, history } = req.body || {};

    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'message is required' });
    }
    if (message.length > MAX_QUESTION_CHARS) {
      return res.status(413).json({ error: `message must be under ${MAX_QUESTION_CHARS} characters` });
    }

    // Tier comes from the verified session, never the request body.
    const tier = bot.tierForRole(req.user?.role);

    // Only accept well-formed prior turns, and only a few of them.
    const safeHistory = Array.isArray(history)
      ? history
          .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
          .slice(-MAX_HISTORY_TURNS)
          .map((m) => ({
            role: m.role,
            content: m.content.slice(0, MAX_QUESTION_CHARS),
            // Carry the ids the bot offered, so a reply of "2" can be resolved
            // back to the entry it numbered. Client-supplied, so bounded and
            // shape-checked here; the bot looks each id up against the
            // answerable audiences, so a forged id cannot reach anything a
            // normal question could not already reach.
            ...(Array.isArray(m.sources) && m.sources.length
              ? { sources: m.sources.filter((x) => typeof x === 'string' && x.length <= 40).slice(0, 10) }
              : {}),
          }))
      : [];

    const started = Date.now();
    const result = await bot.ask(message, { tier, history: safeHistory });
    const ms = Date.now() - started;

    if (result.route === 'refusal') {
      logRefusal(req, message, { ...result, tier });
    }

    recordEvent?.('support_bot_answer', { route: result.route, tier });
    if (result.warnings?.length) {
      logger?.warn?.(`[support] ${result.route}: ${result.warnings.join('; ')}`);
    }

    // `matches` and `warnings` are diagnostic — they can expose entry ids and
    // internal state, so they stay server-side.
    res.json({
      answer: result.answer,
      // Full text when the short answer was trimmed, so the client can offer
      // "more detail" without another round trip. Null when there is no more.
      detail: result.detail || null,
      sources: result.sources,
      route: result.route,
      ms,
    });
  })
);

// ── GET /api/support/status ──────────────────────────────────────────
router.get(
  '/api/support/status',
  safeAsync(async (req, res) => {
    const tier = bot.tierForRole(req.user?.role);
    const counts = bot.warmup();
    const model = await bot.llmAvailable();
    res.json({
      ok: true,
      tier,
      entries: counts[tier],
      mode: model.ok ? 'search+model' : 'search-only',
    });
  })
);

module.exports = router;
