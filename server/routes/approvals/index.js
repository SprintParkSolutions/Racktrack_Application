/**
 * /api/approvals - the server behind the Approvals sub-application.
 *
 * The sub-application is a front end and nothing more: it draws what these
 * routes answer and sends back what a person pressed. Every rule - who may
 * act, which status follows which, what has to be true first - lives in
 * lib/approvals and is applied here whether the request came from that screen,
 * from curl, or from a future client nobody has written yet.
 *
 * The mount in app.js authenticates (auth.requireAuth). Each route then names
 * the roles it is for, from routes/netbox/gates.js, so a refusal is a plain
 * sentence about the role rather than a rule failing somewhere deeper. Org
 * scoping is strict and lives in the service: another organization's plan is a
 * 404, the same answer as a plan that does not exist.
 *
 * GROWING ROOM. The specification's later halves - the verification re-scan,
 * the write, the SLA clocks, notifications, reports, exceptions and change
 * windows - are separate routers in this same folder, written alongside this
 * one. Each is mounted here if and only if its file exists, so a half-built
 * folder still boots and each one lights up the moment it lands. They are
 * mounted before the plan routes so a sibling that owns a path under /plans
 * (the verification scan, the write) is the one that answers it.
 */
const fs = require('fs');
const path = require('path');
const express = require('express');

const service = require('../../lib/approvals/service');
const store = require('../../lib/approvals/store');
const gates = require('../netbox/gates');
const shapeOfSettings = require('./settings_shape');
const { answer, wrap, filtersOf } = require('./http');

const router = express.Router();

const SETTINGS_GATE = gates.only(gates.WRITERS, 'Settings are for an organization admin.');

/**
 * Who you are and what you may do, in one call.
 *
 * The screen asks this once and decides which tabs and buttons exist from it,
 * so no client has to carry its own copy of the role table.
 */
router.get('/me', gates.readers, (req, res) => res.json({ ok: true, ...service.me(req.user) }));

/** What is waiting on you, in sections, in the order your role reads them. */
router.get('/queue', gates.readers, (req, res) => res.json({ ok: true, ...service.queue(req.user) }));

/**
 * Counts by status, priority and SLA state, each with the filters that open
 * exactly that list, so a tile on a board and the list it leads to can never
 * disagree about what they are counting.
 */
router.get('/dashboard', gates.readers, (req, res) => res.json({
  ok: true, ...service.dashboard(req.user, filtersOf(req.query, ['orgId', 'tenantId'])),
}));

/**
 * The tickets waiting for the person signed in, for the phone.
 *
 * Not the Desk's ticket list, which is every ticket of the organisation with
 * its clocks. This is one question: what has somebody asked ME to go and do?
 * It is the front of the second workflow the owner described on 23 September
 * 2026 - a ticket is raised, the person it went to is told which rack it is
 * about and where that rack is, and they photograph it.
 *
 * Only the tickets an admin raised by hand (uid `task:`) and only the open
 * ones: the per-item tickets of a drift check are worked in the check itself.
 */
router.get('/my-tasks', wrap(async (req, res) => {
  const who = service.actorOf(req.user);
  if (who.id == null) return res.json({ ok: true, tasks: [] });
  const rows = store.listTickets({
    ticketAssigneeUserId: who.id,
    ticketStatus: 'open,accepted,in_progress,pending',
    limit: 100,
  }).filter((t) => String(t.itemUid || t.uid || '').startsWith('task:'));

  const tasks = rows.map((t) => {
    const plan = store.getPlan(t.planId, { heavy: false }) || {};
    const site = plan.tenantId != null ? store.tenantById(plan.tenantId) : null;
    const ext = t.external || {};
    return {
      planId: t.planId,
      uid: t.itemUid || t.uid,
      summary: t.summary || t.question || null,
      note: t.note || null,
      raisedBy: t.raisedBy || null,
      raisedAt: t.raisedAt || null,
      status: t.status || 'open',
      number: ext.number || t.number || null,
      url: ext.url || t.url || null,
      rackId: plan.rackId ?? null,
      rackName: plan.rackName ?? null,
      siteName: (site && site.name) || null,
      tenantId: plan.tenantId ?? null,
    };
  });

  /* And the ones raised in ServiceNow itself and given to this person. Those
     are read from the instance, not from our own tables (lib/approvals/
     intake.js), because that is where they live and where they are worked.
     A ticket that names no rack we know is left out: it is still their
     ticket, and ServiceNow is still where they work it. */
  let fromTool = [];
  try {
    fromTool = await require('../../lib/approvals/intake').fromServiceNow(req.user);
  } catch { fromTool = []; }
  // A ticket RackTrack raised is already in the list above under its own
  // number; the instance's copy of it must not appear twice.
  const seen = new Set(tasks.map((t) => String(t.number || '')).filter(Boolean));

  const all = [...tasks, ...fromTool.filter((t) => !seen.has(String(t.number || '')))]
    .sort((a, b) => String(b.raisedAt || '').localeCompare(String(a.raisedAt || '')));

  return res.json({ ok: true, tasks: all });
}));

/** Every drift ticket the caller may see, across plans, with its plan and clocks. */
router.get('/tickets', gates.readers, (req, res) => answer(res,
  service.listTickets(req.user, filtersOf(req.query,
    ['status', 'tenantId', 'rackId', 'priority', 'risk', 'assignee', 'createdBy',
      'since', 'until', 'q', 'limit', 'cursor']))));

/**
 * Every transition across the plans the caller may read, newest first: what
 * happened, to which plan, who did it and when.
 *
 * The auditor's view, and the answer to "who approved this, and when" without
 * opening one plan at a time. Filters: planId, action, actorId, itemUid,
 * since, until, with limit and cursor.
 */
router.get('/events', gates.only([...gates.AUDITORS, 'site_manager'],
  'The history across plans is for an auditor, a site manager or an organization admin.'),
(req, res) => answer(res, service.listEvents(req.user, filtersOf(req.query,
  ['planId', 'action', 'actorId', 'itemUid', 'since', 'until', 'limit', 'cursor']))));

/**
 * The organization's settings: all five keys, every time, filled with the
 * contract's defaults where nothing has been set, in the shape the screens
 * read. `meta` says which of them are still defaults and who last changed the
 * rest. settings_shape.js explains why the stored shape is not this one.
 */
router.get('/settings', gates.readers, (req, res) => res.json({
  ok: true, ...shapeOfSettings.read(req.user?.organization_id ?? null),
}));

/**
 * Change one setting. `PUT /settings/:key` with { value }, or `PUT /settings`
 * with { key, value } - the same call either way, because a screen with one
 * form for all of them should not have to build a path per key.
 *
 * The body is in the screens' shape and is checked in that shape, so the
 * message names the field a person filled in. One key can touch more than one
 * stored key (the escalation percentages live where the clock code reads
 * them), and they are written together or not at all.
 */
const putSetting = (req, res) => {
  const body = req.body || {};
  const key = req.params.key || body.key;
  const value = Object.prototype.hasOwnProperty.call(body, 'value') ? body.value : body[key];
  if (!key) {
    return res.status(400).json({ code: 'bad_request', error: 'send { key, value }' });
  }
  const orgId = req.user?.organization_id ?? null;
  const translated = shapeOfSettings.fromApi(key, value, service.getSettings(orgId).settings);
  if (translated.error) {
    return res.status(400).json({ code: 'bad_request', error: translated.error });
  }
  for (const write of translated.writes) {
    const out = service.putSetting(write.key, write.value, { actor: req.user, req });
    if (out && out.code && out.error) return answer(res, out);
  }
  return res.json({ ok: true, ...shapeOfSettings.read(orgId) });
};
router.put('/settings/:key', SETTINGS_GATE, putSetting);
router.put('/settings', SETTINGS_GATE, putSetting);

/** The RackTrack users of the organization, for the assignee and approver pickers. */
router.get('/users', gates.readers, (req, res) => res.json({ ok: true, ...service.users(req.user) }));

/**
 * The routers of the rest of the specification, each mounted only if it is
 * there. A file that throws on require is logged and skipped rather than
 * taking the whole sub-application down with it.
 */
const OPTIONAL = ['verify', 'write', 'sla', 'notifications', 'reports', 'exceptions', 'windows',
  'changes'];
const mounted = [];
for (const name of OPTIONAL) {
  const file = path.join(__dirname, `${name}.js`);
  if (!fs.existsSync(file)) continue;
  try {
    router.use(require(file));
    mounted.push(name);
  } catch (err) {
    try {
      require('../../lib/observability').logger.warn(
        { event: 'approvals.router.load_failed', router: name, err: err.message },
        `the approvals ${name} router did not load`);
    } catch {
      console.warn(`[approvals] the ${name} router did not load: ${err.message}`);
    }
  }
}

router.use('/plans', require('./plans'));

// A write the server was stopped in the middle of would sit in
// write_in_progress for good: nothing but the write itself moves a check out
// of it. Once, as the routes load, what has sat there longer than any write
// runs is marked write_failed, where an organization admin can run it again.
// Not in tests, by the same two flags that keep the ServiceNow poller out.
if (process.env.NODE_ENV !== 'test' && process.env.RACKTRACK_SKIP_WORKER_POOL !== '1') {
  try { require('../../lib/approvals/write').recoverStranded(); } catch { /* the routes load all the same */ }
}

/** Which of the optional routers are in, for the boot log and for a health check. */
router.mountedRouters = mounted;

module.exports = router;
// `wrap` is re-exported for the sibling routers, so each one does not need
// its own copy of the async-error guard.
module.exports.wrap = wrap;
