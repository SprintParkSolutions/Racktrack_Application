/**
 * The plumbing every Approvals route shares.
 *
 * A service function answers with a value, never an exception: either what it
 * did, or a refusal `{ error, code, why, from, to }`. This turns that one
 * shape into one HTTP answer, in one place, so no route has to remember which
 * code is which status:
 *
 *   not_found    404   another organization's plan, or none of that id
 *   bad_request  400   the body is wrong
 *   role         403   the right plan, the wrong person, with a plain sentence
 *   guard        409   the right person, too early: { code, from, to, why }
 *   transition   409   that move does not exist from where the plan is
 *
 * Everything that went well answers `{ ok: true, ... }`.
 */
const service = require('../../lib/approvals/service');

/** True when a service function refused rather than acted. */
const refused = (out) => Boolean(out && typeof out === 'object' && out.code && out.error);

/** Send a refusal with the status its code asks for. */
const fail = (res, out) => res.status(service.httpStatus(out)).json(out);

/** Send a refusal, or `{ ok: true, ...body(out) }`. */
function answer(res, out, body = (o) => o) {
  if (refused(out)) return fail(res, out);
  return res.json({ ok: true, ...body(out) });
}

/**
 * Wrap an async handler so a thrown error becomes one 500, logged, instead of
 * an unhandled rejection that kills the process. Express 4 does not await a
 * handler, so this cannot be left to it.
 */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** The filters a list route accepts, and nothing else a query string can invent. */
const LIST_FILTERS = ['status', 'tenantId', 'rackId', 'scanId', 'priority', 'risk', 'assignee',
  'assigneeUserId', 'createdBy', 'since', 'until', 'q', 'sla', 'open', 'limit', 'cursor', 'orgId'];

/** Only the known filters, so nothing from the query reaches the SQL builder unread. */
function filtersOf(query = {}, allowed = LIST_FILTERS) {
  const out = {};
  for (const key of allowed) {
    if (query[key] !== undefined && query[key] !== '') out[key] = query[key];
  }
  return out;
}

module.exports = { refused, fail, answer, wrap, filtersOf, LIST_FILTERS };
