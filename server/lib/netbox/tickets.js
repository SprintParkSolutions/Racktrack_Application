/**
 * Raising a ticket in ServiceNow, and hearing back when somebody closes it.
 *
 * The existing ServiceNow connector writes CIs into the CMDB. This is the
 * other half: when a comparison finds something a person has to look at, an
 * incident is raised on the same instance, addressed to the rack's single
 * point of contact, and RackTrack keeps its own row pointing at it.
 *
 * Three rules the shape of this file exists to enforce.
 *
 *   IDEMPOTENT. A rack scanned monthly reports the same unresolved drift every
 *   month. Every incident carries a correlation id built from the rack and the
 *   thing that differs — not from the scan or the date — so the second scan
 *   finds the first incident and adds a comment to it instead of raising a
 *   duplicate. By month three the assignee has one ageing ticket, not four.
 *
 *   OURS FIRST. The row in the plan is the record. ServiceNow is a mirror of
 *   it. If the instance is unreachable, or no instance is configured at all,
 *   the ticket still exists here and the person is still named — it simply has
 *   no external number yet.
 *
 *   THEIRS WINS ON STATE. Once an incident exists, ServiceNow owns whether it
 *   is open or closed. We read that back; we never argue with it.
 *
 * The row shaping is pure, so it can be tested without an instance.
 */

const norm = (s) => String(s ?? '').trim();

/** ServiceNow incident states, as the Table API reports them. */
const STATE = {
  1: 'new', 2: 'in progress', 3: 'on hold',
  6: 'resolved', 7: 'closed', 8: 'cancelled',
};
const CLOSED_STATES = new Set(['resolved', 'closed', 'cancelled']);

/**
 * A stable id for "this problem, in this rack, about this thing".
 *
 * Deliberately free of the scan id and the date. Those change every month and
 * would make every scan look like a new problem.
 */
const correlationFor = (rackId, uid) => `racktrack:${norm(rackId)}:${norm(uid)}`;

/** How urgent, from what the item is. Nothing here is a guess about business impact. */
function urgencyFor(item) {
  if (item.type === 'Device' && item.action === 'create') return 2;   // something is racked that we do not know about
  if (item.type === 'Device' && item.action === 'update') return 2;   // something moved or was replaced
  return 3;
}

/** Plain words for what differs, so the person reading the ticket can act. */
function describe(item) {
  if (item.action === 'create') {
    return `${item.type} "${item.name}" was found in the rack and is not in NetBox.`;
  }
  if (item.action === 'update' && item.diff) {
    const lines = Object.entries(item.diff).map(
      ([field, v]) => `  ${field}: NetBox says ${JSON.stringify(v.from)}, we saw ${JSON.stringify(v.to)}`);
    return `${item.type} "${item.name}" does not match NetBox.\n\n${lines.join('\n')}`;
  }
  return `${item.type} "${item.name}" needs checking. ${norm(item.reason)}`;
}

/**
 * A plan item plus its context -> the incident fields ServiceNow wants.
 *
 * `assigned_to` is the SPOC's email. ServiceNow resolves an email to a user
 * record itself; sending a name would match nothing on most instances.
 */
function toIncident({ item, rackId, rackName, siteName, spoc, question, planId, appUrl }) {
  const where = [rackName || rackId, siteName].filter(Boolean).join(', ');
  const body = [
    describe(item),
    '',
    `Rack: ${where}`,
    `Found by: a RackTrack scan of the rack`,
    question ? `\nThe admin asks: ${question}` : '',
    appUrl ? `\nOpen it in RackTrack: ${appUrl}` : '',
    '',
    'Nothing has been written to NetBox. This is waiting on somebody looking at the rack.',
  ].filter((l) => l !== '').join('\n');

  return {
    correlation_id: correlationFor(rackId, item.uid),
    correlation_display: 'RackTrack',
    short_description: `${where}: ${item.type} "${item.name}" does not match NetBox`,
    description: body,
    category: 'inquiry',
    urgency: urgencyFor(item),
    impact: 3,
    contact_type: 'integration',
    ...(spoc && spoc.email ? { assigned_to: spoc.email } : {}),
    ...(planId ? { u_racktrack_plan: String(planId) } : {}),
  };
}

const origin = (cfg) => String(cfg.instanceUrl || '').replace(/\/+$/, '');
const base = (cfg, table) => `${origin(cfg)}/api/now/table/${table || 'incident'}`;

/*
 * HOW WE AUTHENTICATE, AND WHY IT IS NOT THE OBVIOUS WAY.
 *
 * Every integration guide says: send `Authorization: Basic user:password`.
 * ServiceNow's Zurich release (2025) refuses that for REST on developer
 * instances — every call returns 401 "User is not authenticated", for every
 * user, every role, every password, even though the same credentials sign in
 * fine through a browser. It cost an afternoon to find out that the message
 * means "not this way", not "wrong password".
 *
 * So we sign in the way the browser does: POST the login form, keep the
 * cookies it sets, and send them with the CSRF token (`X-UserToken`) on every
 * REST call. That path is open on every release, and it is what a person's
 * browser is doing anyway. Sessions are cached per instance+user and rebuilt
 * on a 401, so a login happens once, not once per call.
 */
const sessions = new Map();

/** Cookies from a response, folded into a Cookie header we can send back. */
function harvestCookies(res, jar) {
  const set = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean);
  for (const line of set) {
    const [pair] = String(line).split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}
const cookieHeader = (jar) => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

/** Sign in as the browser does. Returns {cookie, token} or throws with the reason. */
async function login(cfg, fetchImpl = fetch) {
  const jar = new Map();
  const ua = { 'User-Agent': 'RackTrack/1.0', Accept: 'text/html,application/json' };

  const page = await fetchImpl(`${origin(cfg)}/login.do`, { headers: ua, redirect: 'follow' });
  harvestCookies(page, jar);
  const html = await page.text();
  const ck = html.match(/name="sysparm_ck"\s+value="([^"]+)"/);

  const form = new URLSearchParams({
    user_name: cfg.username || '', user_password: cfg.password || '',
    sys_action: 'sysverb_login', ...(ck ? { sysparm_ck: ck[1] } : {}),
  });
  const post = await fetchImpl(`${origin(cfg)}/login.do`, {
    method: 'POST', redirect: 'manual',
    headers: { ...ua, 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader(jar) },
    body: form.toString(),
  });
  harvestCookies(post, jar);

  // A successful login sets glide_user_route; a failed one bounces to login.do
  // with the same pre-auth cookies and nothing else.
  if (!jar.has('glide_user_route')) {
    throw new Error('ServiceNow refused the sign-in: check the instance, user and password');
  }

  // The CSRF token lives on the page after login. Fetch a small one to read it.
  const after = await fetchImpl(`${origin(cfg)}/login_redirect.do?sysparm_stack=no`, {
    headers: { ...ua, Cookie: cookieHeader(jar) }, redirect: 'follow',
  });
  harvestCookies(after, jar);
  const body = await after.text();
  const tok = body.match(/g_ck\s*=\s*['"]([0-9a-f]{72})['"]/);
  return { cookie: cookieHeader(jar), token: tok ? tok[1] : null, at: Date.now() };
}

const sessionKey = (cfg) => `${origin(cfg)}|${cfg.username || ''}`;

async function session(cfg, fetchImpl, fresh = false) {
  const key = sessionKey(cfg);
  if (!fresh && sessions.has(key)) return sessions.get(key);
  const s = await login(cfg, fetchImpl);
  sessions.set(key, s);
  return s;
}

const headers = (cfg, s) => ({
  'Content-Type': 'application/json',
  Accept: 'application/json',
  Cookie: s.cookie,
  ...(s.token ? { 'X-UserToken': s.token } : {}),
});

/**
 * One REST call, signed with a session. On a 401 the session is rebuilt once
 * and the call retried, so an expired login heals itself.
 */
async function req(url, method, _hdrsUnused, body, timeoutMs = 15000, cfg = null, fetchImpl = fetch) {
  const doCall = async (s) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method, headers: headers(cfg, s), body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      const text = await res.text();
      let parsed;
      try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = text.slice(0, 300); }
      return { status: res.status, ok: res.ok, body: parsed };
    } finally {
      clearTimeout(timer);
    }
  };
  if (!cfg) throw new Error('req() needs the ServiceNow config to sign the call');
  let s = await session(cfg, fetchImpl);
  let out = await doCall(s);
  if (out.status === 401) {
    s = await session(cfg, fetchImpl, true);
    out = await doCall(s);
  }
  return out;
}

/** Find an incident we raised before for exactly this problem. */
async function findExisting(cfg, correlationId, fetchImpl = req) {
  const url = `${base(cfg, cfg.incidentTable)}`
    + `?sysparm_query=correlation_id=${encodeURIComponent(correlationId)}`
    + '&sysparm_limit=1&sysparm_display_value=false';
  const r = await fetchImpl(url, 'GET', null, undefined, 15000, cfg);
  if (!r.ok) return { ok: false, status: r.status, error: r.body };
  const row = (r.body && r.body.result && r.body.result[0]) || null;
  return { ok: true, incident: row };
}

/**
 * Raise it, or add to the one already open.
 *
 * Returns the same shape either way, with `reused` saying which happened, so
 * the caller can tell a person "this was first raised in March" rather than
 * pretending it is new.
 */
async function raise(cfg, ctx, fetchImpl = req) {
  const fields = toIncident(ctx);
  const found = await findExisting(cfg, fields.correlation_id, fetchImpl);
  if (!found.ok) return { ok: false, error: found.error, status: found.status };

  if (found.incident) {
    const sysId = found.incident.sys_id;
    const state = STATE[Number(found.incident.state)] || 'unknown';
    // Already closed, and the problem is back: reopen rather than duplicate.
    const patch = CLOSED_STATES.has(state)
      ? { state: 2, work_notes: 'Seen again on a later RackTrack scan. Reopened.' }
      : { work_notes: `Seen again on a later RackTrack scan.\n\n${fields.description}` };
    const r = await fetchImpl(`${base(cfg, cfg.incidentTable)}/${sysId}`, 'PATCH', null, patch, 15000, cfg);
    if (!r.ok) return { ok: false, status: r.status, error: r.body };
    const row = (r.body && r.body.result) || found.incident;
    return {
      ok: true, reused: true, reopened: CLOSED_STATES.has(state),
      sysId, number: row.number || found.incident.number,
      state: STATE[Number(row.state)] || state,
      url: `${String(cfg.instanceUrl).replace(/\/+$/, '')}/nav_to.do?uri=incident.do?sys_id=${sysId}`,
    };
  }

  const r = await fetchImpl(base(cfg, cfg.incidentTable), 'POST', null, fields, 15000, cfg);
  if (!r.ok) return { ok: false, status: r.status, error: r.body };
  const row = (r.body && r.body.result) || {};
  return {
    ok: true, reused: false, reopened: false,
    sysId: row.sys_id, number: row.number,
    state: STATE[Number(row.state)] || 'new',
    url: row.sys_id
      ? `${String(cfg.instanceUrl).replace(/\/+$/, '')}/nav_to.do?uri=incident.do?sys_id=${row.sys_id}`
      : null,
  };
}

/**
 * Ask ServiceNow what happened to the incidents we raised.
 *
 * This is how the loop closes: somebody updates the ticket in their own tool,
 * and RackTrack notices. State is theirs — we report it, we do not set it.
 */
async function statusOf(cfg, sysIds, fetchImpl = req) {
  const ids = (sysIds || []).filter(Boolean);
  if (!ids.length) return { ok: true, states: {} };
  const url = `${base(cfg, cfg.incidentTable)}`
    + `?sysparm_query=sys_idIN${ids.join(',')}`
    + '&sysparm_fields=sys_id,number,state,close_notes,resolved_at,assigned_to'
    + `&sysparm_limit=${ids.length}`;
  const r = await fetchImpl(url, 'GET', null, undefined, 15000, cfg);
  if (!r.ok) return { ok: false, status: r.status, error: r.body };

  const states = {};
  for (const row of (r.body && r.body.result) || []) {
    const state = STATE[Number(row.state)] || 'unknown';
    states[row.sys_id] = {
      number: row.number,
      state,
      closed: CLOSED_STATES.has(state),
      notes: norm(row.close_notes) || null,
      resolvedAt: norm(row.resolved_at) || null,
    };
  }
  return { ok: true, states };
}

module.exports = {
  toIncident, describe, correlationFor, urgencyFor,
  raise, statusOf, findExisting, login,
  STATE, CLOSED_STATES,
  _req: req, _sessions: sessions,
};
