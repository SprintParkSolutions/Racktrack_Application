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
const rackMatch = require('../../lib/netbox/rack_match');
const spoc = require('../../lib/netbox/spoc');
const store = require('../../lib/netbox/store');
const tickets = require('../../lib/netbox/tickets');
const { NetBox } = require('../../lib/netbox/netbox');
const { sendNotice } = require('../../auth');

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

  // The connection form stores just the instance name ("dev322173"), or a full
  // URL. Build a real base URL either way: a bare name needs the domain
  // appended, or every call resolves the wrong host.
  const raw = String(s.instanceUrl || s.instance).trim();
  let instanceUrl;
  if (/^https?:\/\//i.test(raw)) {
    instanceUrl = raw.replace(/\/+$/, '');
  } else if (raw.includes('.')) {
    instanceUrl = `https://${raw.replace(/\/+$/, '')}`;
  } else {
    instanceUrl = `https://${raw}.service-now.com`;
  }
  return {
    instanceUrl,
    username: s.user || s.username || '',
    password: s.password || '',
    incidentTable: s.incidentTable || 'incident',
  };
}

const who = (req) => (req.user && (req.user.username || req.user.email)) || null;
const orgOf = (req) => req.user?.organization_id ?? null;
// A plan the caller's organisation does not own is, to them, 404 — the same
// answer they get for a plan that does not exist. No cross-org leak, no owner
// bypass.
const mine = (req, plan) => plan && plans.canSee(plan.orgId ?? null, orgOf(req));
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
      orgId: orgOf(req),
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
  if (!mine(req, plans.get(req.params.planId))) return res.status(404).json({ error: 'no such plan' });
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
  if (!mine(req, plan)) return res.status(404).json({ error: 'no such plan' });
  const client = netboxFor(req);
  if (!client) {
    return res.json({ spoc: null, others: [], everyone: [],
                      why: 'no NetBox is configured for this account' });
  }
  const scan = plan.scanId ? store.getScan(plan.scanId) : null;
  const fallbackName = (scan && (scan.rackName || scan.rackId)) || plan.rackId;
  const resolved = await rackMatch.resolveRack(client, {
    tenantId: plan.tenantId ?? null, rackId: plan.rackId,
    scanName: scan && scan.rackName, fallbackName,
  });
  const found = await spoc.forRack(client, resolved.name);
  res.json({ ...found, everyone: await spoc.everyone(client),
             serviceNow: Boolean(serviceNowFor(req)),
             matchedRack: { name: resolved.name, confidence: resolved.confidence, why: resolved.why } });
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
  if (!mine(req, plan)) return res.status(404).json({ error: 'no such plan' });

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

/**
 * Every drift ticket this account has raised, across all plans.
 *
 * The Incidents view reads this: one row per ticket, with its ServiceNow
 * number and link, who it went to, its state, and what the rack it came from
 * is — so an admin sees the whole picture in one place, before and after each
 * one is resolved.
 */
router.get('/tickets/all', (req, res) => {
  const status = req.query.status || null;
  const rows = [];
  for (const idx of plans.list({ orgId: orgOf(req), limit: 200 })) {
    const plan = plans.get(idx.id);
    if (!plan) continue;
    for (const it of plan.items) {
      if (!it.ticket) continue;
      if (status && it.ticket.status !== status) continue;
      const ext = it.ticket.external || {};
      rows.push({
        planId: plan.id,
        rackId: plan.rackId,
        uid: it.uid,
        type: it.type,
        name: it.name,
        action: it.action,
        assignee: it.ticket.assignee,
        status: it.ticket.status,               // open | resolved | closed
        question: it.ticket.question,
        finding: it.ticket.finding,
        raisedAt: it.ticket.raisedAt,
        resolvedAt: it.ticket.resolvedAt,
        number: ext.number || null,
        state: ext.state || null,               // ServiceNow state
        url: ext.url || null,
        system: ext.system || 'none',
        error: ext.error || null,
      });
    }
  }
  rows.sort((a, b) => String(b.raisedAt || '').localeCompare(String(a.raisedAt || '')));
  res.json({ tickets: rows });
});

/** Just the tickets, for whoever has to work them. */
router.get('/:planId/tickets', (req, res) => {
  const plan = plans.get(req.params.planId);
  if (!mine(req, plan)) return res.status(404).json({ error: 'no such plan' });
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
  if (!mine(req, plans.get(req.params.planId))) return res.status(404).json({ error: 'no such plan' });
  const { decisions } = req.body || {};
  if (!Array.isArray(decisions) || !decisions.length) {
    return res.status(400).json({ error: 'send { decisions: [ { uid, decision } ] }' });
  }
  const by = who(req);
  const out = plans.decide(req.params.planId, decisions, { by });
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
    const fallbackName = (scan && (scan.rackName || scan.rackId)) || plan.rackId;
    let people = null;
    let roster = [];
    const client = netboxFor(req);
    // Recognise the rack: use the customer's real rack name, not the scan hash,
    // so the SPOC, the incident and the email all name the right rack.
    const resolved = await rackMatch.resolveRack(client, {
      tenantId: plan.tenantId ?? null, rackId: plan.rackId,
      scanName: scan && scan.rackName, fallbackName,
    });
    const rackName = resolved.name;
    if (client) {
      try { people = await spoc.forRack(client, rackName); } catch { people = null; }
      // Everyone NetBox knows, so an assignee the admin picked by hand — not the
      // SPOC — still resolves to a real contact with an email to write to.
      let all = [];
      try { all = await spoc.everyone(client); } catch { all = []; }
      roster = [people && people.spoc, ...((people && people.others) || []), ...all].filter(Boolean);
    }
    const spocPerson = (people && people.spoc) || null;

    for (const d of ticketed) {
      const item = plan.items.find((i) => i.uid === d.uid);
      if (!item || !item.ticket) continue;

      // Who it actually goes to. NetBox names the single point of contact and
      // that is the default the admin was shown; but the admin may assign to
      // someone else, and when NetBox names no SPOC at all the admin has picked
      // the person by hand. The chosen name is already on the ticket — resolve
      // it to a full contact so the incident and the email reach that person,
      // not whoever NetBox happens to call the SPOC.
      const chosen = item.ticket.assignee || (spocPerson && spocPerson.name) || null;
      const person = (chosen && roster.find((p) => p.name === chosen)) || spocPerson || null;
      item.ticket.spoc = spocPerson;
      if (person && !item.ticket.assignee) item.ticket.assignee = person.name;

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

      // Tell the person it went to. The email is a courtesy on top of the
      // ServiceNow incident, not the record — a failure here never blocks the
      // decision. Sent to the SPOC's own address, read from NetBox.
      if (person && person.email) {
        const where = [rackName, people?.site?.name].filter(Boolean).join(', ');
        const inc = item.ticket.external && item.ticket.external.number;
        sendNotice({
          to: person.email,
          subject: `RackTrack: please check ${item.type} "${item.name}" in ${rackName}`,
          text: [
            `Hello ${person.name},`,
            '',
            `A rack scan of ${where} found something that does not match NetBox, and `
              + `${by || 'an admin'} has asked you to check it at the rack.`,
            '',
            `  ${item.type} "${item.name}" — ${item.action === 'create'
              ? 'found in the rack, not in NetBox' : 'does not match NetBox'}`,
            item.ticket.question ? `\nThey ask: ${item.ticket.question}` : '',
            inc ? `\nServiceNow incident: ${inc}` : '',
            item.ticket.external && item.ticket.external.url ? item.ticket.external.url : '',
            '',
            'Nothing has been written to NetBox. Please check the rack and resolve the '
              + 'incident with what you find; it then comes back for approval.',
            '',
            '— RackTrack',
          ].filter((l) => l !== undefined).join('\n'),
        }).then((ok) => {
          if (ok) item.ticket.emailedAt = new Date().toISOString();
          else item.ticket.emailNote = 'no mail transport configured';
          plans.save(plan);
        }).catch(() => {});
      } else if (person) {
        item.ticket.emailNote = `no email in NetBox for ${person.name}, so no notice was sent`;
      }
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
  if (!mine(req, plan)) return res.status(404).json({ error: 'no such plan' });

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
