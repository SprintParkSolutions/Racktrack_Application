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
let _counts = {};

// import() of an ES module from CommonJS is asynchronous, so kick it off at load
// time, cache the warmup index counts once it resolves, and have ask() await
// readiness. A failed load degrades to a plain "starting up" refusal rather than
// taking the route down.
const _ready = import('./dot/src/bot.js')
  .then((m) => {
    _bot = m;
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

module.exports = { ask, warmup, tierForRole };
