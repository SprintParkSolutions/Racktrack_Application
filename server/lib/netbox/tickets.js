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

const base = (cfg, table) =>
  `${String(cfg.instanceUrl || '').replace(/\/+$/, '')}/api/now/table/${table || 'incident'}`;

const headers = (cfg) => ({
  'Content-Type': 'application/json',
  Accept: 'application/json',
  Authorization: `Basic ${Buffer.from(`${cfg.username || ''}:${cfg.password || ''}`).toString('base64')}`,
});

async function req(url, method, hdrs, body, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method, headers: hdrs, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal,
    });
    const text = await res.text();
    let parsed;
    try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = text.slice(0, 300); }
    return { status: res.status, ok: res.ok, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}

/** Find an incident we raised before for exactly this problem. */
async function findExisting(cfg, correlationId, fetchImpl = req) {
  const url = `${base(cfg, cfg.incidentTable)}`
    + `?sysparm_query=correlation_id=${encodeURIComponent(correlationId)}`
    + '&sysparm_limit=1&sysparm_display_value=false';
  const r = await fetchImpl(url, 'GET', headers(cfg));
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
    const r = await fetchImpl(`${base(cfg, cfg.incidentTable)}/${sysId}`, 'PATCH', headers(cfg), patch);
    if (!r.ok) return { ok: false, status: r.status, error: r.body };
    const row = (r.body && r.body.result) || found.incident;
    return {
      ok: true, reused: true, reopened: CLOSED_STATES.has(state),
      sysId, number: row.number || found.incident.number,
      state: STATE[Number(row.state)] || state,
      url: `${String(cfg.instanceUrl).replace(/\/+$/, '')}/nav_to.do?uri=incident.do?sys_id=${sysId}`,
    };
  }

  const r = await fetchImpl(base(cfg, cfg.incidentTable), 'POST', headers(cfg), fields);
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
  const r = await fetchImpl(url, 'GET', headers(cfg));
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
  raise, statusOf, findExisting,
  STATE, CLOSED_STATES,
  _req: req,
};
