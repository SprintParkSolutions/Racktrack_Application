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
const askLimiter = uploadLimiter({ rate: 1, burst: 10 });

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
      nearMisses: (result.matches || []).map((m) => m.id),
    });
  } catch (err) {
    logger?.warn?.(`[support] could not write refusal log: ${err.message}`);
  }
}

// ── POST /api/support/ask ────────────────────────────────────────────
router.post(
  '/api/support/ask',
  askLimiter,
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
          .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_QUESTION_CHARS) }))
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
