// server/lib/support_bot.js
//
// The app's support bot IS the standalone "DOT" engine, vendored verbatim under
// ./dot/ (an ES-module package with its own knowledge base). This thin CommonJS
// bridge loads that engine and re-exposes the small surface support_routes.js
// uses — warmup() / tierForRole() / ask() — so the route layer is unchanged and
// every answer comes straight from the vendored engine (server/lib/dot/src/bot.js)
// and its KB (server/lib/dot/kb/knowledge-base.json).
const { logger } = require('./observability');

let _bot = null;
let _llm = null;
let _counts = {};

// import() of an ES module from CommonJS is asynchronous, so kick it off at load
// time, cache the warmup index counts once it resolves, and have ask() await
// readiness. A failed load degrades to a plain "starting up" refusal rather than
// taking the route down.
//
// llm.js is pulled in alongside so this bridge can answer "is a model
// reachable?" — the status route asks, and until now this module simply did not
// export it, so /api/support/status threw TypeError on EVERY request and the
// Help page told every user "DOT isn't running right now" while DOT was running
// perfectly well. A missing model is not a missing engine: search-only is a
// fully working mode, so the two load independently.
const _ready = Promise.all([
  import('./dot/src/bot.js'),
  import('./dot/src/llm.js').catch((e) => {
    logger?.warn?.(`[support_bot] llm module unavailable: ${e.message}`);
    return null;
  }),
])
  .then(([m, llm]) => {
    _bot = m;
    _llm = llm;
    try { _counts = typeof m.warmup === 'function' ? m.warmup() : {}; }
    catch (e) { logger?.warn?.(`[support_bot] warmup failed: ${e.message}`); }
    logger?.info?.('[support_bot] DOT engine loaded');
    return m;
  })
  .catch((e) => { logger?.error?.(`[support_bot] engine load failed: ${e.message}`); return null; });

async function ask(message, opts = {}) {
  const m = _bot || (await _ready);
  if (!m || typeof m.ask !== 'function') {
    return { answer: 'The assistant is starting up — please try again in a moment.', route: 'refusal', sources: [], warnings: ['engine not loaded'] };
  }
  return m.ask(message, opts);
}

// support_routes derives the tier from the signed-in user's role; the DOT engine
// expects 'end-user' | 'admin' (admins also see admin entries; internal-only
// entries are never answerable to anyone).
function tierForRole(role) {
  return (role === 'owner' || role === 'org_admin' || role === 'site_manager') ? 'admin' : 'end-user';
}

// Synchronous best-effort counts for /api/support/status; {} until the engine
// finishes loading, then the real per-tier index sizes.
function warmup() { return _counts; }

/**
 * Is an LLM backend reachable? Answers {ok} for the status route's
 * 'search+model' / 'search-only' badge.
 *
 * Never throws and never rejects: a probe that fails means no model, which the
 * caller renders as search-only — it must not be able to fail the status check
 * itself, because "the health probe errored" reads to the user as "Help is
 * down". The engine caches the real probe for a minute, so this is one network
 * round trip per minute at most, not one per page load.
 */
async function llmAvailable() {
  if (!_llm) await _ready;
  const llm = _llm;
  if (!llm || typeof llm.isAvailable !== 'function') return { ok: false };
  try {
    return (await llm.isAvailable()) || { ok: false };
  } catch (e) {
    logger?.warn?.(`[support_bot] llm probe failed: ${e.message}`);
    return { ok: false };
  }
}

module.exports = { ask, warmup, tierForRole, llmAvailable };
