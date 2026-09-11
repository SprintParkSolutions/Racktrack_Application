/**
 * The push workflow: compare, identify, pass to the admin.
 *
 * Everything a rack scan would change goes to one person, who approves it,
 * rejects it, or sends it to somebody to go and look. A resolved ticket comes
 * back here rather than writing anything itself, so however many people are
 * involved there is one name against every change that reaches the customer's
 * record.
 *
 * The write itself lives in netbox.js, gated on a plan from here.
 */
const express = require('express');

const cfg = require('../../lib/netbox/config');
const plans = require('../../lib/netbox/plans');
const profiles = require('../../lib/connection_profiles');
const spoc = require('../../lib/netbox/spoc');
const store = require('../../lib/netbox/store');
const tickets = require('../../lib/netbox/tickets');
const { NetBox } = require('../../lib/netbox/netbox');

const router = express.Router();

/** The organisation's NetBox, then the caller's own. Same order as export. */
function netboxFor(req) {
  const orgId = req.user?.organization_id;
  const creds = (orgId ? profiles.resolveCredsForOrg(orgId, 'netbox') : null)
    || (req.user?.id ? profiles.resolveCredsForType(req.user.id, 'netbox') : null);
  const url = creds?.secret?.base_url || cfg.NETBOX_URL;
  const token = creds?.secret?.token || cfg.NETBOX_TOKEN;
  return url ? new NetBox(url, token) : null;
}

/**
 * The ServiceNow the admin configured, in the shape tickets.js wants.
 *
 * Null when nothing is set up, and that is not an error: the ticket still
 * exists here, it simply has no external number. Ours first, theirs mirrored.
 */
function serviceNowFor(req) {
  const orgId = req.user?.organization_id;
  const creds = (orgId ? profiles.resolveCredsForOrg(orgId, 'servicenow') : null)
    || (req.user?.id ? profiles.resolveCredsForType(req.user.id, 'servicenow') : null);
  const s = creds?.secret;
  if (!s || !(s.instance || s.instanceUrl)) return null;
  const instance = s.instanceUrl || s.instance;
  return {
    instanceUrl: /^https?:\/\//i.test(instance) ? instance : `https://${instance}`,
    username: s.user || s.username || '',
    password: s.password || '',
    incidentTable: s.incidentTable || 'incident',
  };
}

const who = (req) => (req.user && (req.user.username || req.user.email)) || null;
const isAdmin = (req) => ['owner', 'org_admin', 'site_manager'].includes(req.user?.role);

/**
 * Everything in one place.
 *
 * `?status=submitted` is the admin's inbox: comparisons a technician has
 * handed over and nobody has acted on. Without it an admin would have to know
 * a scan happened and go looking for it.
 */
router.get('/', (req, res) => {
  res.json({
    plans: plans.list({
      scanId: req.query.scanId ?? null,
      rackId: req.query.rackId ?? null,
      status: req.query.status ?? null,
      limit: Math.min(Number(req.query.limit) || 50, 200),
    }),
    youAre: req.user?.role || null,
  });
});

/**
 * A technician hands the comparison over.
 *
 * They cannot write to NetBox and this does not try to. It marks the plan as
 * waiting on an admin and carries their note across.
 */
router.post('/:planId/submit', (req, res) => {
  const out = plans.submit(req.params.planId, {
    by: who(req), note: (req.body || {}).note,
  });
  if (out.error) return res.status(out.error === 'no such plan' ? 404 : 409).json(out);
  res.json({
    planId: out.plan.id,
    status: out.plan.status,
    already: Boolean(out.already),
    submittedBy: out.plan.submittedBy,
    summary: plans.summarise(out.plan.items),
  });
});

/**
 * Who this rack's ticket should go to.
 *
 * Read from NetBox at the moment it is asked for, so the SPOC is whoever the
 * customer's own record currently says it is — not a copy of it that drifts.
 */
router.get('/:planId/contacts', async (req, res) => {
  const plan = plans.get(req.params.planId);
  if (!plan) return res.status(404).json({ error: 'no such plan' });
  const client = netboxFor(req);
  if (!client) {
    return res.json({ spoc: null, others: [], everyone: [],
                      why: 'no NetBox is configured for this account' });
  }
  const scan = plan.scanId ? store.getScan(plan.scanId) : null;
  const rackName = (scan && (scan.rackName || scan.rackId)) || plan.rackId;
  const found = await spoc.forRack(client, rackName);
  res.json({ ...found, everyone: await spoc.everyone(client),
             serviceNow: Boolean(serviceNowFor(req)) });
});

/**
 * One plan, with its tickets brought up to date first.
 *
 * ServiceNow owns whether an incident is open or closed, so opening a plan
 * asks it rather than trusting what we last wrote down. An incident somebody
 * resolved over there returns its item here as UNDECIDED — having looked is
 * not the same as having approved.
 */
router.get('/:planId', async (req, res) => {
  let plan = plans.get(req.params.planId);
  if (!plan) return res.status(404).json({ error: 'no such plan' });

  let heardBack = [];
  const sn = serviceNowFor(req);
  const waiting = plans.openSysIds(plan);
  if (sn && waiting.length) {
    try {
      const r = await tickets.statusOf(sn, waiting);
      if (r.ok) {
        const applied = plans.applyTicketStates(plan.id, r.states);
        plan = applied.plan;
        heardBack = applied.changed;
      }
    } catch { /* ServiceNow being unreachable must not hide the plan */ }
  }

  res.json({
    ...plan,
    settled: plans.isSettled(plan),
    summary: plans.summarise(plan.items),
    heardBack,
    serviceNowConfigured: Boolean(sn),
  });
});

/** Just the tickets, for whoever has to work them. */
router.get('/:planId/tickets', (req, res) => {
  const plan = plans.get(req.params.planId);
  if (!plan) return res.status(404).json({ error: 'no such plan' });
  const rows = plan.items
    .filter((i) => i.ticket)
    .filter((i) => !req.query.assignee || i.ticket.assignee === req.query.assignee)
    .filter((i) => !req.query.status || i.ticket.status === req.query.status)
    .map((i) => ({ ...i.ticket, uid: i.uid, type: i.type, name: i.name,
                   action: i.action, diff: i.diff }));
  res.json({ planId: plan.id, tickets: rows });
});

/**
 * The admin decides. Three ways per item, and nothing is all-or-nothing.
 *
 *   { decisions: [ { uid, decision: 'approved'|'rejected'|'ticketed',
 *                    note, assignee } ] }
 */
router.post('/:planId/decide', async (req, res) => {
  if (!isAdmin(req)) {
    return res.status(403).json({
      error: 'Only an admin decides what gets written. Ask yours to review this plan.',
    });
  }
  const { decisions } = req.body || {};
  if (!Array.isArray(decisions) || !decisions.length) {
    return res.status(400).json({ error: 'send { decisions: [ { uid, decision } ] }' });
  }
  const out = plans.decide(req.params.planId, decisions, { by: who(req) });
  if (out.error) return res.status(out.error === 'no such plan' ? 404 : 409).json(out);

  // Mirror every new ticket into ServiceNow, if one is configured. The row
  // here is the record either way — a failure to reach ServiceNow leaves the
  // ticket in place with no external number, and says so.
  const sn = serviceNowFor(req);
  const raised = [];
  const ticketed = out.applied.filter((d) => d.decision === 'ticketed');
  let plan = plans.get(req.params.planId);
  if (ticketed.length) {
    const scan = plan.scanId ? store.getScan(plan.scanId) : null;
    const rackName = (scan && (scan.rackName || scan.rackId)) || plan.rackId;
    let people = null;
    const client = netboxFor(req);
    if (client) { try { people = await spoc.forRack(client, rackName); } catch { people = null; } }

    for (const d of ticketed) {
      const item = plan.items.find((i) => i.uid === d.uid);
      if (!item || !item.ticket) continue;
      const person = (people && people.spoc) || null;
      item.ticket.spoc = person;
      if (person && person.email && !item.ticket.assignee) item.ticket.assignee = person.name;

      if (!sn) {
        item.ticket.external = { system: 'none',
          why: 'No ServiceNow is configured, so this ticket lives only in RackTrack.' };
        continue;
      }
      const r = await tickets.raise(sn, {
        item, rackId: plan.rackId, rackName, siteName: people?.site?.name || null,
        spoc: person, question: item.ticket.question, planId: plan.id,
      });
      item.ticket.external = r.ok
        ? { system: 'servicenow', number: r.number, sysId: r.sysId, url: r.url,
            state: r.state, reused: r.reused, reopened: r.reopened,
            raisedAt: new Date().toISOString() }
        : { system: 'servicenow', error: `ServiceNow replied ${r.status || 'nothing'}`,
            detail: typeof r.error === 'string' ? r.error.slice(0, 200) : r.error };
      raised.push({ uid: d.uid, ...item.ticket.external });
    }
    plans.save(plan);
    plan = plans.get(req.params.planId);
  }

  res.json({
    planId: plan.id,
    applied: out.applied,
    refused: out.refused,
    raised,
    serviceNowConfigured: Boolean(sn),
    summary: plans.summarise(plan.items),
    settled: plans.isSettled(plan),
  });
});

/**
 * Whoever the ticket went to has been and looked.
 *
 * Their answer returns the item to the admin as undecided. A finished ticket
 * is not an approval, and this route deliberately cannot approve anything.
 */
router.post('/:planId/tickets/:uid/resolve', (req, res) => {
  const { finding, outcome } = req.body || {};
  const plan = plans.get(req.params.planId);
  if (!plan) return res.status(404).json({ error: 'no such plan' });

  const item = plan.items.find((i) => i.uid === req.params.uid);
  if (!item || !item.ticket) return res.status(404).json({ error: 'no ticket on that item' });

  // The person it was assigned to can resolve it; so can an admin.
  const me = who(req);
  if (item.ticket.assignee !== me && !isAdmin(req)) {
    return res.status(403).json({
      error: `this ticket is assigned to ${item.ticket.assignee}`,
    });
  }

  const out = plans.resolveTicket(req.params.planId, req.params.uid,
                                  { by: me, finding, outcome });
  if (out.error) return res.status(409).json(out);
  res.json({
    planId: out.plan.id,
    uid: out.item.uid,
    ticket: out.item.ticket,
    decision: out.item.decision,
    note: 'Back with the admin. A resolved ticket writes nothing on its own.',
  });
});

module.exports = router;
