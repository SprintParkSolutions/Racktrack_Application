/**
 * The eight reports, and the rule that keeps them honest.
 *
 * EVERY NUMBER OPENS THE LIST IT COUNTS. A report that says "7 waiting for
 * approval" and a plan list that then shows six is worse than no report at
 * all, because somebody will spend an afternoon looking for the seventh. So
 * every row carries the exact filters that produce it, `filtersFor` collects
 * them by row key, and the counts are taken through the same store functions
 * the plan list itself uses - not a second query that means the same thing.
 * test/approvals/reports.test.js asserts the two agree.
 *
 * THE EIGHT:
 *
 *   backlog    open plans by status, oldest first, with what is ageing
 *   sla        plans by clock state, and which clock is breaching
 *   quality    how often work comes back: rejected, reworked, reopened,
 *              verifications that failed, writes that failed, first pass
 *   trends     plans raised and finished per day
 *   resolvers  who is asked, who answers, and how long they take
 *   approvals  who approves, who rejects, and how long a plan waits
 *   writes     what was written, what NetBox refused, how many attempts
 *   exceptions what is accepted drift today, and what it is hiding
 *
 * Each answers { name, title, rows, columns, filtersFor, window }. `.csv` is
 * the same rows through the same columns - one report, two shapes.
 */
const store = require('./store');
const machine = require('./machine');

const NAMES = ['backlog', 'sla', 'quality', 'trends', 'resolvers', 'approvals', 'writes', 'exceptions'];
const OPEN = machine.OPEN.filter((s) => s !== 'written');
const words = (s) => String(s).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

// -- Scope ----------------------------------------------------------------
/**
 * What this person may count, as the plan list scopes it. The same shape
 * service.list() builds, so a count here and a list there cannot disagree.
 */
function scopeFor(actor) {
  if (!actor || actor.trusted || actor.system) return {};
  if (actor.role === 'owner') return {};
  const scope = { orgId: actor.orgId ?? null };
  if (['member', 'site_manager'].includes(actor.role)) {
    scope.visibleTo = { role: actor.role, username: actor.username, userId: actor.id,
      tenantId: actor.tenantId };
  }
  return scope;
}

const stamp = (d) => new Date(d).toISOString().replace(/\.\d+Z$/, 'Z');

/** The window a report covers: 30 days back by default. */
function windowOf(query = {}) {
  const until = query.until ? String(query.until) : null;
  const since = query.since ? String(query.since)
    : stamp(Date.now() - (Math.max(1, Number(query.days) || 30) * 86400000));
  return { since, ...(until ? { until } : {}) };
}

/** The filters a row hands back, so a number opens the list behind it. */
const filtersOf = (rows) => Object.fromEntries(rows
  .filter((r) => r.filters).map((r) => [r.key, r.filters]));

// -- SQL for the rows a plan filter cannot express -------------------------
/** The WHERE this person's scope and window add to a query over approval_plans. */
function sqlWhere(actor, win, { alias = 'p', column = 'created_at' } = {}) {
  const where = [];
  const params = {};
  const scope = scopeFor(actor);
  if (scope.orgId !== undefined) {
    if (scope.orgId === null) where.push(`${alias}.org_id IS NULL`);
    else { where.push(`${alias}.org_id = @orgId`); params.orgId = Number(scope.orgId); }
  }
  if (scope.visibleTo) {
    where.push(`${alias}.tenant_id = @tenantId`);
    params.tenantId = Number(scope.visibleTo.tenantId ?? -1);
  }
  if (win.since) { where.push(`${alias}.${column} >= @since`); params.since = win.since; }
  if (win.until) { where.push(`${alias}.${column} <= @until`); params.until = win.until; }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

const all = (sql, params) => store.db().prepare(sql).all(params);

// -- The reports ----------------------------------------------------------
function backlog(actor, query) {
  const win = windowOf({ ...query, days: query.days || 365 });
  const scope = scopeFor(actor);
  const base = { ...scope, ...win };
  const counted = Object.fromEntries(store.countPlansBy('status', { ...base, status: OPEN })
    .map((r) => [r.key, r.count]));
  const { sql, params } = sqlWhere(actor, win);
  const ages = Object.fromEntries(all(`
    SELECT p.status AS status, MIN(p.created_at) AS oldest, COUNT(*) AS n
    FROM approval_plans p ${sql} GROUP BY p.status`, params).map((r) => [r.status, r]));
  const rows = OPEN.filter((s) => counted[s]).map((status) => ({
    key: status, status, label: words(status), count: counted[status] || 0,
    oldest: (ages[status] || {}).oldest || null,
    filters: { status, since: win.since, ...(win.until ? { until: win.until } : {}) },
  }));
  rows.sort((a, b) => b.count - a.count);
  return {
    name: 'backlog', title: 'Open plans by status', window: win, rows,
    columns: [{ key: 'label', title: 'Status' }, { key: 'count', title: 'Plans' },
      { key: 'oldest', title: 'Oldest' }],
    total: rows.reduce((n, r) => n + r.count, 0),
    filtersFor: filtersOf(rows),
  };
}

/**
 * Plans by SLA state, in the five words the screens use: on_track, at_risk,
 * breached, paused and none. A plan is counted once, under the worst state any
 * of its live clocks is in, so the five rows add up to the open backlog and
 * nobody has to wonder whether a plan appears twice.
 */
function sla(actor, query) {
  const win = windowOf({ ...query, days: query.days || 365 });
  const clocks = require('./sla');
  const { sql, params } = sqlWhere(actor, win);
  const open = OPEN.map((s, i) => { params[`op${i}`] = s; return `@op${i}`; }).join(', ');
  const where = `${sql ? `${sql} AND` : 'WHERE'} p.status IN (${open})`;
  const plans = all(`SELECT p.id AS id FROM approval_plans p ${where}`, params).map((r) => r.id);
  const rowsOf = all(`
    SELECT s.plan_id AS planId, s.clock AS clock, s.status AS status, s.warned_at AS warnedAt
    FROM approval_sla s JOIN approval_plans p ON p.id = s.plan_id ${where}`, params);
  const byPlan = new Map();
  for (const r of rowsOf) byPlan.set(r.planId, [...(byPlan.get(r.planId) || []), r]);
  const counted = Object.fromEntries(clocks.STATES.map((s) => [s, 0]));
  for (const id of plans) counted[clocks.planStateOf(id, byPlan.get(id) || [])] += 1;
  const rows = clocks.STATES.map((state) => ({
    key: state, state, label: words(state), count: counted[state] || 0,
    filters: { sla: state, status: OPEN.join(','), since: win.since,
      ...(win.until ? { until: win.until } : {}) },
  }));
  const byClock = new Map();
  for (const r of rowsOf) {
    const key = `${r.clock}|${clocks.stateOf(r)}`;
    byClock.set(key, (byClock.get(key) || 0) + 1);
  }
  return {
    name: 'sla', title: 'Plans by SLA state', window: win, rows,
    columns: [{ key: 'label', title: 'State' }, { key: 'count', title: 'Plans' }],
    clocks: [...byClock.entries()].map(([key, count]) => ({ clock: key.split('|')[0],
      state: key.split('|')[1], count })),
    filtersFor: filtersOf(rows),
  };
}

function quality(actor, query) {
  const win = windowOf(query);
  const { sql, params } = sqlWhere(actor, win);
  const one = (expr) => Number(all(`SELECT ${expr} AS n FROM approval_plans p ${sql}`, params)[0].n) || 0;
  const joined = (table, alias, expr, extra = '') => Number(all(
    `SELECT ${expr} AS n FROM ${table} ${alias} JOIN approval_plans p ON p.id = ${alias}.plan_id ${sql}${extra}`,
    params)[0].n) || 0;
  const scope = scopeFor(actor);
  const byStatus = Object.fromEntries(store.countPlansBy('status', { ...scope, ...win })
    .map((r) => [r.key, r.count]));
  const filed = one('COUNT(*)');
  const rows = [
    { key: 'filed', label: 'Plans raised', count: filed, filters: { ...win } },
    { key: 'completed', label: 'Completed', count: byStatus.completed || 0,
      filters: { status: 'completed', ...win } },
    { key: 'first_pass', label: 'Completed first time',
      count: one("SUM(CASE WHEN p.status = 'completed' AND p.reopen_count = 0 THEN 1 ELSE 0 END)"),
      filters: null },
    { key: 'rejected', label: 'Rejected', count: byStatus.rejected || 0,
      filters: { status: 'rejected', ...win } },
    { key: 'rework', label: 'Sent back for rework',
      count: joined('approval_decisions', 'd', 'COUNT(*)', " AND d.decision = 'rework'"),
      filters: { status: 'rework', ...win } },
    { key: 'reopened', label: 'Reopened at least once',
      count: one('SUM(CASE WHEN p.reopen_count > 0 THEN 1 ELSE 0 END)'), filters: null },
    { key: 'verification_failed', label: 'Verification scans that failed',
      count: joined('approval_verifications', 'v', 'COUNT(*)',
        " AND v.kind = 'post_fix' AND v.result = 'fail'"), filters: null },
    { key: 'write_mismatch', label: 'Writes NetBox did not match afterwards',
      count: joined('approval_verifications', 'v', 'COUNT(*)',
        " AND v.kind = 'post_write' AND v.result = 'fail'"), filters: null },
    { key: 'write_failed', label: 'Writes NetBox refused', count: byStatus.write_failed || 0,
      filters: { status: 'write_failed', ...win } },
  ];
  const completed = byStatus.completed || 0;
  const firstPass = rows.find((r) => r.key === 'first_pass').count;
  return {
    name: 'quality', title: 'How often work comes back', window: win, rows,
    columns: [{ key: 'label', title: 'Measure' }, { key: 'count', title: 'Count' }],
    firstPassRate: completed ? Math.round((firstPass / completed) * 100) : null,
    filtersFor: filtersOf(rows),
  };
}

function trends(actor, query) {
  const win = windowOf(query);
  const { sql, params } = sqlWhere(actor, win);
  const raised = all(`
    SELECT substr(p.created_at, 1, 10) AS day, COUNT(*) AS n
    FROM approval_plans p ${sql} GROUP BY day ORDER BY day`, params);
  const done = all(`
    SELECT substr(p.completed_at, 1, 10) AS day, COUNT(*) AS n
    FROM approval_plans p ${sql} ${sql ? 'AND' : 'WHERE'} p.completed_at IS NOT NULL
    GROUP BY day ORDER BY day`, params);
  const byDay = new Map();
  const put = (day, key, n) => {
    if (!day) return;
    const row = byDay.get(day) || { key: day, day, raised: 0, completed: 0 };
    row[key] = n;
    byDay.set(day, row);
  };
  for (const r of raised) put(r.day, 'raised', r.n);
  for (const r of done) put(r.day, 'completed', r.n);
  const rows = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day))
    .map((r) => ({ ...r, filters: { since: `${r.day}T00:00:00Z`, until: `${r.day}T23:59:59Z` } }));
  return {
    name: 'trends', title: 'Plans raised and finished, by day', window: win, rows,
    columns: [{ key: 'day', title: 'Day' }, { key: 'raised', title: 'Raised' },
      { key: 'completed', title: 'Completed' }],
    filtersFor: filtersOf(rows),
  };
}

function resolvers(actor, query) {
  const win = windowOf(query);
  const { sql, params } = sqlWhere(actor, win);
  const rows = all(`
    SELECT t.assignee AS person, t.assignee_user_id AS userId,
           COUNT(*) AS asked,
           SUM(CASE WHEN t.status IN ('resolved', 'closed') THEN 1 ELSE 0 END) AS answered,
           SUM(CASE WHEN t.status IN ('open', 'accepted', 'in_progress', 'pending') THEN 1 ELSE 0 END) AS openNow,
           AVG(CASE WHEN t.resolved_at IS NOT NULL AND t.raised_at IS NOT NULL
                    THEN (julianday(t.resolved_at) - julianday(t.raised_at)) * 24 END) AS avgHours
    FROM approval_tickets t JOIN approval_plans p ON p.id = t.plan_id
    ${sql} GROUP BY t.assignee, t.assignee_user_id ORDER BY asked DESC`, params)
    .map((r) => ({
      key: r.person || `user:${r.userId}`, person: r.person || 'unnamed', userId: r.userId ?? null,
      asked: r.asked, answered: r.answered, openNow: r.openNow,
      avgHours: r.avgHours == null ? null : Math.round(r.avgHours * 10) / 10,
      filters: r.person ? { assignee: r.person, ...win } : null,
    }));
  return {
    name: 'resolvers', title: 'Who is asked, and who answers', window: win, rows,
    columns: [{ key: 'person', title: 'Person' }, { key: 'asked', title: 'Asked' },
      { key: 'answered', title: 'Answered' }, { key: 'openNow', title: 'Still open' },
      { key: 'avgHours', title: 'Average hours' }],
    filtersFor: filtersOf(rows),
  };
}

function approvals(actor, query) {
  const win = windowOf(query);
  const { sql, params } = sqlWhere(actor, win);
  const rows = all(`
    SELECT d.approver AS person, d.approver_id AS userId,
           SUM(CASE WHEN d.decision = 'approved' THEN 1 ELSE 0 END) AS approved,
           SUM(CASE WHEN d.decision = 'rejected' THEN 1 ELSE 0 END) AS rejected,
           SUM(CASE WHEN d.decision = 'rework' THEN 1 ELSE 0 END) AS rework,
           AVG((julianday(d.decided_at) - julianday(s.started_at)) * 24) AS avgHours
    FROM approval_decisions d
    JOIN approval_plans p ON p.id = d.plan_id
    LEFT JOIN approval_sla s ON s.plan_id = d.plan_id AND s.clock = 'approval'
    ${sql} GROUP BY d.approver, d.approver_id ORDER BY approved DESC`, params)
    .map((r) => ({
      key: r.person || `user:${r.userId}`, person: r.person || 'unnamed', userId: r.userId ?? null,
      approved: r.approved, rejected: r.rejected, rework: r.rework,
      avgHours: r.avgHours == null ? null : Math.round(r.avgHours * 10) / 10,
      filters: null,
    }));
  return {
    name: 'approvals', title: 'Who decides, and how long a plan waits', window: win, rows,
    columns: [{ key: 'person', title: 'Approver' }, { key: 'approved', title: 'Approved' },
      { key: 'rejected', title: 'Rejected' }, { key: 'rework', title: 'Rework' },
      { key: 'avgHours', title: 'Average hours waiting' }],
    filtersFor: filtersOf(rows),
  };
}

function writes(actor, query) {
  const win = windowOf(query);
  const scope = scopeFor(actor);
  const byStatus = Object.fromEntries(store.countPlansBy('status', { ...scope, ...win })
    .map((r) => [r.key, r.count]));
  const { sql, params } = sqlWhere(actor, win);
  const totals = all(`
    SELECT COALESCE(SUM(json_extract(p.result, '$.written')), 0) AS written,
           COALESCE(SUM(json_extract(p.result, '$.failed')), 0) AS failed,
           COALESCE(SUM(json_extract(p.result, '$.attempts')), 0) AS attempts,
           COUNT(*) AS plans
    FROM approval_plans p ${sql} ${sql ? 'AND' : 'WHERE'} p.result IS NOT NULL`, params)[0];
  const rows = ['written', 'completed', 'write_failed', 'manual_review'].map((status) => ({
    key: status, status, label: words(status), count: byStatus[status] || 0,
    filters: { status, ...win },
  }));
  const failures = all(`
    SELECT p.id AS planId, p.rack_name AS rackName, p.written_at AS at, p.written_by AS by,
           json_extract(p.result, '$.written') AS written,
           json_extract(p.result, '$.failed') AS failed,
           json_extract(p.result, '$.attempts') AS attempts
    FROM approval_plans p ${sql} ${sql ? 'AND' : 'WHERE'} json_extract(p.result, '$.failed') > 0
    ORDER BY p.id DESC LIMIT 50`, params);
  return {
    name: 'writes', title: 'What was written, and what NetBox refused', window: win, rows,
    columns: [{ key: 'label', title: 'Outcome' }, { key: 'count', title: 'Plans' }],
    objects: { written: totals.written, failed: totals.failed, attempts: totals.attempts,
      plans: totals.plans },
    failures,
    filtersFor: filtersOf(rows),
  };
}

function exceptions(actor, query) {
  const win = windowOf({ ...query, days: query.days || 365 });
  const orgId = actor && actor.role === 'owner' && (query.orgId != null && query.orgId !== '')
    ? Number(query.orgId) : (actor ? actor.orgId ?? null : null);
  const now = store.nowIso();
  const rows = all(`
    SELECT e.*,
      (SELECT COUNT(*) FROM approval_items i WHERE i.exception_id = e.id) AS items,
      (SELECT COUNT(DISTINCT i.plan_id) FROM approval_items i WHERE i.exception_id = e.id) AS plans
    FROM approval_exceptions e
    WHERE e.org_id IS @orgId ${query.includeRevoked ? '' : 'AND e.revoked_at IS NULL'}
    ORDER BY e.id DESC`, { orgId })
    .map((e) => ({
      key: String(e.id), id: e.id, kind: e.kind,
      scope: [e.rack_id ? `rack ${e.rack_id}` : null, e.tenant_id ? `site ${e.tenant_id}` : null,
        e.item_type || null, e.item_name || null, e.attribute || null]
        .filter(Boolean).join(' / ') || 'the whole organization',
      justification: e.justification, ownerId: e.owner_id,
      startsAt: e.starts_at, expiresAt: e.expires_at, reviewAt: e.review_at,
      revokedAt: e.revoked_at,
      active: !e.revoked_at && (!e.starts_at || e.starts_at <= now)
        && (!e.expires_at || e.expires_at > now),
      items: e.items, plans: e.plans,
      filters: null,
    }));
  return {
    name: 'exceptions', title: 'What is accepted drift today', window: win, rows,
    columns: [{ key: 'id', title: 'Id' }, { key: 'kind', title: 'Kind' },
      { key: 'scope', title: 'Scope' }, { key: 'items', title: 'Items hidden' },
      { key: 'plans', title: 'Plans' }, { key: 'expiresAt', title: 'Expires' },
      { key: 'reviewAt', title: 'Review' }],
    hiding: rows.filter((r) => r.active).reduce((n, r) => n + r.items, 0),
    filtersFor: filtersOf(rows),
  };
}

const REPORTS = { backlog, sla, quality, trends, resolvers, approvals, writes, exceptions };

/** One report by name, or null when there is no such report. */
function run(name, { actor, query = {} } = {}) {
  const fn = REPORTS[name];
  if (!fn) return null;
  return fn(actor, query || {});
}

// -- The same rows as a file ----------------------------------------------
const cell = (v) => {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The report as CSV: the columns it declares, in the order it declares them. */
function toCsv(report) {
  if (!report) return '';
  const cols = report.columns || [];
  const head = cols.map((c) => cell(c.title)).join(',');
  const body = (report.rows || []).map((r) => cols.map((c) => cell(r[c.key])).join(','));
  return [head, ...body].join('\n') + '\n';
}

module.exports = { NAMES, REPORTS, run, toCsv, scopeFor, windowOf };
