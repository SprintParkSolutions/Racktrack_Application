/**
 * The push workflow: compare, identify, pass to the admin.
 *
 * Everything a rack scan would change goes to one person, who assigns it to
 * whoever looks after the rack, and only once that person has looked and
 * reported back approves it or rejects it. A resolved ticket comes back here
 * rather than writing anything itself, so however many people are involved
 * there is one name against every change that reaches the customer's record.
 *
 * The rules are frozen in docs/design/drift-approval-workflow.md and held
 * here and in lib/netbox/plans.js, not in a screen.
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
const gates = require('./gates');
const trail = require('./trail');

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
const isAdmin = gates.isAdmin;
// A plan the caller's organisation does not own is, to them, 404 - the same
// answer they get for a plan that does not exist. No cross-org leak, no owner
// bypass; a plan raised by an account with no organisation belongs to that
// account alone (plans.visibleTo, the one rule the list uses too). A
// technician sees only the plans they raised themselves; an admin sees every
// plan in the organisation.
const mine = (req, plan) => plan && plans.visibleTo(plan, req.user)
  && (isAdmin(req) || plan.createdBy === who(req));

/** A plan with the counts a screen shows, the write result included. */
const summaryOf = (plan) => plans.summarise(plan.items, plan.result);

/**
 * Everything in one place.
 *
 * `?status=submitted` is the admin's inbox: comparisons a technician has
 * handed over and nobody has acted on. Without it an admin would have to know
 * a scan happened and go looking for it.
 *
 * `?mine=1` narrows the list to the plans the caller raised. For a technician
 * the filter is always on: they see their own comparisons and nobody else's.
 */
router.get('/', gates.technician, (req, res) => {
  const onlyMine = req.query.mine === '1' || req.query.mine === 'true' || !isAdmin(req);
  res.json({
    plans: plans.list({
      scanId: req.query.scanId ?? null,
      rackId: req.query.rackId ?? null,
      status: req.query.status ?? null,
      // The same test the read applies, so nothing is listed that answers
      // "no such plan" when it is opened.
      seenBy: plans.seenBy(req.user),
      createdBy: onlyMine ? who(req) : null,
      limit: Math.min(Number(req.query.limit) || 50, 200),
    }),
    youAre: req.user?.role || null,
    mine: onlyMine,
  });
});

/**
 * A technician hands the comparison over.
 *
 * They cannot write to NetBox and this does not try to. It marks the plan as
 * waiting on an admin and carries their note across.
 */
router.post('/:planId/submit', gates.technician, (req, res) => {
  if (!mine(req, plans.get(req.params.planId))) return res.status(404).json({ error: 'no such plan' });
  const out = plans.submit(req.params.planId, {
    by: who(req), note: (req.body || {}).note,
  });
  if (out.error) return res.status(out.error === 'no such plan' ? 404 : 409).json(out);
  if (!out.already) {
    trail.record(req, out.plan, 'drift.submit', {
      payload: { note: out.plan.submittedNote, ...summaryOf(out.plan) },
    });
  }
  res.json({
    planId: out.plan.id,
    status: out.plan.status,
    already: Boolean(out.already),
    submittedBy: out.plan.submittedBy,
    summary: summaryOf(out.plan),
  });
});

/**
 * Who this rack's ticket should go to.
 *
 * Read from NetBox at the moment it is asked for, so the SPOC is whoever the
 * customer's own record currently says it is - not a copy of it that drifts.
 */
router.get('/:planId/contacts', gates.technician, async (req, res) => {
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
 * resolved over there returns its item here as UNDECIDED - having looked is
 * not the same as having approved.
 */
router.get('/:planId', gates.technician, async (req, res) => {
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
    summary: summaryOf(plan),
    heardBack,
    serviceNowConfigured: Boolean(sn),
  });
});

/**
 * Every drift ticket this account has raised, across all plans.
 *
 * The Incidents view reads this: one row per ticket, with its ServiceNow
 * number and link, who it went to, its state, and what the rack it came from
 * is - so an admin sees the whole picture in one place, before and after each
 * one is resolved. Admin only: a technician has no tickets to track.
 */
router.get('/tickets/all', gates.admin, (req, res) => {
  const status = req.query.status || null;
  const rows = [];
  for (const idx of plans.list({ seenBy: plans.seenBy(req.user), limit: 200 })) {
    const plan = plans.get(idx.id);
    if (!plan) continue;
    for (const it of plan.items) {
      if (!it.ticket) continue;
      // An interface shares its device's ticket; the device row is the ticket.
      if (it.ticket.sharedWith) continue;
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
        assigneeId: it.ticket.assigneeId ?? null,
        assigneeEmail: it.ticket.assigneeEmail ?? null,
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
router.get('/:planId/tickets', gates.admin, (req, res) => {
  const plan = plans.get(req.params.planId);
  if (!mine(req, plan)) return res.status(404).json({ error: 'no such plan' });
  const rows = plan.items
    .filter((i) => i.ticket && !i.ticket.sharedWith)
    .filter((i) => !req.query.assignee || i.ticket.assignee === req.query.assignee)
    .filter((i) => !req.query.status || i.ticket.status === req.query.status)
    .map((i) => ({ ...i.ticket, uid: i.uid, type: i.type, name: i.name,
                   action: i.action, diff: i.diff }));
  res.json({ planId: plan.id, tickets: rows });
});

/** What an incident description says an item is. */
const whatDiffers = (item) => (item.action === 'create'
  ? 'found in the rack, not in NetBox' : 'does not match NetBox');

/** "Device "Sw1" - found in the rack, not in NetBox (48 ports follow it)" */
function itemLine(plan, item) {
  const ports = plans.childrenOf(plan, item.uid).length;
  return `${item.type} "${item.name}" - ${whatDiffers(item)}`
    + (ports ? ` (${ports} port${ports === 1 ? '' : 's'} follow it)` : '');
}

/** tickets.raise()'s answer as the external record kept on the ticket. */
const externalOf = (r) => (r.ok
  ? { system: 'servicenow', number: r.number, sysId: r.sysId, url: r.url,
      state: r.state, reused: r.reused, reopened: r.reopened,
      raisedAt: new Date().toISOString() }
  : { system: 'servicenow', error: `ServiceNow replied ${r.status || 'nothing'}`,
      detail: typeof r.error === 'string' ? r.error.slice(0, 200) : r.error });

const NO_SERVICENOW = { system: 'none',
  why: 'No ServiceNow is configured, so this ticket lives only in RackTrack.' };

/** Put the external record on a device's ticket and on every port that follows it. */
function stampExternal(plan, item, external) {
  item.ticket.external = external;
  for (const child of plans.childrenOf(plan, item.uid)) {
    if (child.ticket) child.ticket.external = external;
  }
}

/**
 * One email to one person about everything just assigned to them. The email
 * is a courtesy on top of the ServiceNow incident, not the record - a failure
 * here never blocks the decision. Sent to their own address, read from NetBox.
 */
function notifyAssignee(plan, { person, items, incidents, rackName, siteName, by, question, wholeRack }) {
  const where = [rackName, siteName].filter(Boolean).join(', ');
  const n = items.length;
  const subject = wholeRack
    ? `RackTrack: please check rack ${rackName} (${n} item${n === 1 ? '' : 's'})`
    : n === 1
      ? `RackTrack: please check ${items[0].type} "${items[0].name}" in ${rackName}`
      : `RackTrack: please check ${n} items in ${rackName}`;
  const incLines = incidents.flatMap((ext) => [
    ext.number ? `ServiceNow incident: ${ext.number}` : null,
    ext.url || null,
  ]).filter(Boolean);
  const text = [
    `Hello ${person.name},`,
    '',
    `A rack scan of ${where} found ${n === 1 ? 'something' : `${n} things`} that `
      + `${n === 1 ? 'does' : 'do'} not match NetBox, and ${by || 'an admin'} has asked you `
      + `to check ${n === 1 ? 'it' : 'them'} at the rack.`,
    '',
    ...items.map((i) => `  ${itemLine(plan, i)}`),
    question ? `\nThey ask: ${question}` : '',
    incLines.length ? `\n${incLines.join('\n')}` : '',
    '',
    'Nothing has been written to NetBox. Please check the rack and resolve the '
      + `incident${incidents.length === 1 ? '' : 's'} with what you find; it then comes back for approval.`,
    '',
    '- RackTrack',
  ].filter((l) => l !== undefined).join('\n');

  // The send finishes whenever the mail server answers, which is after this
  // request has returned and possibly after somebody has already acted on the
  // ticket. So the plan is read again here and only the two email fields are
  // written. It used to save the copy of the plan it was handed at assignment
  // time, which put back everything as it was then: resolve the first ticket
  // straight after assigning the rack and the email landing a moment later
  // reopened it. That happened on the demo, on plans 115 and 126, and is why
  // one ticket always seemed to need resolving twice.
  const stamp = (patch) => {
    try {
      const fresh = plans.get(plan.id);
      if (!fresh) return;
      const uids = new Set(items.map((i) => i.uid));
      let touched = false;
      for (const item of fresh.items || []) {
        if (!uids.has(item.uid) || !item.ticket) continue;
        Object.assign(item.ticket, patch);
        touched = true;
      }
      if (touched) plans.save(fresh);
    } catch { /* a courtesy note on the ticket; never worth failing over */ }
  };
  return sendNotice({ to: person.email, subject, text })
    .then((ok) => stamp(ok ? { emailedAt: new Date().toISOString() }
      : { emailNote: 'no mail transport configured' }))
    .catch(() => stamp({ emailNote: 'the notice could not be sent' }));
}

/**
 * Everyone NetBox knows for this rack, once, with the SPOC first.
 *
 * The rack is recognised by its real name (rack_match), so the SPOC, the
 * incident and the email all name the customer's rack, not the photo hash.
 * The roster is de-duplicated on the contact id: the SPOC is in the
 * assignment list and in the contact list, and is one person.
 */
async function rosterFor(req, plan) {
  const scan = plan.scanId ? store.getScan(plan.scanId) : null;
  const fallbackName = (scan && (scan.rackName || scan.rackId)) || plan.rackId;
  const client = netboxFor(req);
  const resolved = await rackMatch.resolveRack(client, {
    tenantId: plan.tenantId ?? null, rackId: plan.rackId,
    scanName: scan && scan.rackName, fallbackName,
  });
  const rackName = resolved.name;
  let people = null;
  let all = [];
  if (client) {
    try { people = await spoc.forRack(client, rackName); } catch { people = null; }
    try { all = await spoc.everyone(client); } catch { all = []; }
  }
  const seen = new Set();
  const roster = [people && people.spoc, ...((people && people.others) || []), ...all]
    .filter(Boolean)
    .filter((p) => {
      const key = p.netboxId != null ? `id:${p.netboxId}` : `name:${p.name}|${p.email || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return {
    client, rackName, roster,
    spoc: (people && people.spoc) || null,
    siteName: people?.site?.name || null,
  };
}

/**
 * The one contact the admin meant.
 *
 * By NetBox contact id when the screen sent one, otherwise by the exact name
 * picked from the roster. No match, or two contacts with that name, is a
 * refusal: a ticket assigned to the wrong person is worse than no ticket.
 */
function contactFor(roster, d) {
  if (d.assigneeId != null && d.assigneeId !== '') {
    const byId = roster.filter((p) => String(p.netboxId) === String(d.assigneeId));
    if (byId.length === 1) return { person: byId[0] };
    return { error: byId.length
      ? `more than one NetBox contact has id ${d.assigneeId}`
      : `no NetBox contact has id ${d.assigneeId}` };
  }
  const name = String(d.assignee || '').trim();
  const byName = roster.filter((p) => p.name === name);
  if (byName.length === 1) return { person: byName[0] };
  if (byName.length > 1) {
    return { error: `more than one NetBox contact is named "${name}"; choose by contact id` };
  }
  return { error: `no NetBox contact is named "${name}"` };
}

/**
 * The admin decides. Three ways per item, and nothing is all-or-nothing.
 *
 *   { decisions: [ { uid, decision: 'approved'|'rejected'|'ticketed',
 *                    note, assignee, assigneeId } ] }
 *
 * The first move on any item is to assign it (ticketed). Approve and reject
 * are refused by plans.decide() until the assignee has resolved the ticket
 * with a finding - the refusal comes back as { uid, why: 'assign first' }.
 *
 * A device's interfaces follow it (plans.toItem), so a decision names the
 * device and ONE ServiceNow incident is raised per device, not per port.
 *
 * The whole rack at once: { decisions: [ { uid: '*', decision: 'ticketed',
 * assignee, note } ] } assigns every item still waiting to that person. It
 * expands to one decision per item, so each item gets its own incident and
 * its own ticket, exactly as if the admin had assigned them one by one; the
 * assignee gets one email listing them all. The answer's raised[] then leads
 * with one entry for the rack:
 *
 *   { scope: 'rack', uid: '*', items: [uid, ...], count, ticket: { system,
 *     raised, failed, incidents: [{ uid, number, url, error }] },
 *     number, error }
 *
 * followed by the per-item entries { uid, ports, ...external } as before.
 * Only assigning works rack-wide; approve and reject stay per device.
 */
router.post('/:planId/decide', gates.only(gates.ADMINS,
  'Only an admin decides what gets written. Ask yours to review this plan.'), async (req, res) => {
  let plan = plans.get(req.params.planId);
  if (!mine(req, plan)) return res.status(404).json({ error: 'no such plan' });
  const body = req.body || {};
  let decisions = Array.isArray(body.decisions) ? body.decisions : [];

  const star = decisions.find((d) => d && d.uid === '*');
  // A whole-rack request replaces the decision list with every waiting item.
  // Anything else sent beside it would be dropped without a word, so a mixed
  // body is refused before anything is applied.
  if (star && decisions.some((d) => !d || d.uid !== '*')) {
    return res.status(400).json({
      error: 'send the whole-rack decision on its own, not mixed with single items',
    });
  }
  // The scope form is the same request in another shape, so it refuses a
  // mixed body the same way.
  if (!star && body.scope === 'rack' && Array.isArray(decisions) && decisions.length) {
    return res.status(400).json({
      error: 'send the whole-rack decision on its own, not mixed with single items',
    });
  }
  const rackAsk = star || (body.scope === 'rack'
    ? { decision: 'ticketed', assignee: body.assignee, assigneeId: body.assigneeId, note: body.note } : null);
  const wholeRack = Boolean(rackAsk);
  let rackUids = [];
  if (wholeRack) {
    if (rackAsk.decision !== 'ticketed') {
      return res.status(400).json({
        error: 'The whole rack can only be assigned to somebody. Approve or reject each device on its own.',
      });
    }
    if (!rackAsk.assignee && rackAsk.assigneeId == null) {
      return res.status(400).json({ error: 'a ticket has to be assigned to somebody' });
    }
    // A rebind only re-labels a record NetBox already has, so there is nothing
    // to check at the rack; a whole-rack ask leaves rebinds for approve or reject.
    const waiting = plan.items.filter(
      (i) => i.decidable && i.decision === 'pending' && i.action !== 'rebind');
    if (!waiting.length) {
      return res.status(409).json({ error: 'nothing on this plan is waiting to be assigned' });
    }
    rackUids = waiting.map((i) => i.uid);
    decisions = waiting.map((i) => ({
      uid: i.uid, decision: 'ticketed', assignee: rackAsk.assignee,
      assigneeId: rackAsk.assigneeId, note: rackAsk.note,
    }));
  }
  if (!decisions.length) {
    return res.status(400).json({ error: 'send { decisions: [ { uid, decision } ] }' });
  }
  const by = who(req);

  // Who each ticket goes to, settled BEFORE anything is written on the plan.
  // The name the admin picked is resolved to one NetBox contact - its id and
  // its email travel with the decision onto the ticket - and a name that
  // matches nobody, or two people, refuses the whole request with nothing
  // changed. The roster is read once for all of them.
  const assigning = decisions.filter((d) => d && d.decision === 'ticketed'
    && (d.assignee || d.assigneeId != null));
  let people = null;
  if (assigning.length) {
    people = await rosterFor(req, plan);
    if (!people.client) {
      return res.status(400).json({
        error: 'No NetBox is configured for this account, so nobody can be looked up to assign to.',
      });
    }
    for (const d of assigning) {
      const found = contactFor(people.roster, d);
      if (found.error) return res.status(400).json({ error: found.error, uid: d.uid });
      d.assignee = found.person.name;
      d.assigneeId = found.person.netboxId ?? null;
      d.assigneeEmail = found.person.email ?? null;
    }
  }

  const out = plans.decide(req.params.planId, decisions, { by });
  if (out.error) return res.status(out.error === 'no such plan' ? 404 : 409).json(out);
  plan = plans.get(req.params.planId);

  // The trail: one row per approve or reject that went through.
  for (const d of out.applied) {
    if (d.decision === 'ticketed') continue;
    const sent = decisions.find((x) => x && x.uid === d.uid) || {};
    trail.record(req, plan, 'drift.decide', {
      payload: { uid: d.uid, decision: d.decision, note: sent.note || null },
    });
  }

  // Mirror every new ticket into ServiceNow, if one is configured. The row
  // here is the record either way - a failure to reach ServiceNow leaves the
  // ticket in place with no external number, and says so.
  const sn = serviceNowFor(req);
  const raised = [];
  const ticketed = out.applied.filter((d) => d.decision === 'ticketed');
  if (ticketed.length) {
    const { rackName, siteName, spoc: spocPerson, roster } = people;

    // The top-level items just assigned. decide() only accepts a device (or
    // another top-level item), so the ports are reached through childrenOf.
    const targets = ticketed
      .map((d) => plan.items.find((i) => i.uid === d.uid))
      .filter((i) => i && i.ticket);

    // The contact the ticket was resolved to, by id, so the incident and the
    // email reach the person actually assigned, not whoever NetBox happens
    // to call the SPOC. The SPOC is kept on the ticket for the record.
    const personFor = (item) => {
      item.ticket.spoc = spocPerson;
      return roster.find((p) => String(p.netboxId) === String(item.ticket.assigneeId))
        || roster.find((p) => p.name === item.ticket.assignee)
        || null;
    };

    // One email per person, whatever they were handed: person name -> notice.
    const notices = new Map();
    const noteFor = (person, item, external) => {
      if (!person) return;
      if (!person.email) {
        item.ticket.emailNote = `no email in NetBox for ${person.name}, so no notice was sent`;
        return;
      }
      const n = notices.get(person.name) || { person, items: [], incidents: [] };
      n.items.push(item);
      if (external && external.system === 'servicenow' && !n.incidents.includes(external)) {
        n.incidents.push(external);
      }
      notices.set(person.name, n);
    };

    // One incident per device; its ports carry the same external record.
    const perItem = [];
    for (const item of targets) {
      const person = personFor(item);
      if (wholeRack) item.ticket.scope = 'rack';
      const external = sn
        ? externalOf(await tickets.raise(sn, {
          item, rackId: plan.rackId, rackName, siteName,
          spoc: person, question: item.ticket.question, planId: plan.id,
        }))
        : NO_SERVICENOW;
      stampExternal(plan, item, external);
      perItem.push({ uid: item.uid, ports: plans.childrenOf(plan, item.uid).length, ...external });
      noteFor(person, item, external);
      trail.record(req, plan, 'drift.assign', {
        payload: {
          uid: item.uid, assignee: item.ticket.assignee,
          assigneeId: item.ticket.assigneeId ?? null, incident: external.number || null,
        },
      });
    }

    if (wholeRack) {
      // The rack entry first: what was handed over as one move, and how the
      // incidents behind it went. `number` joins them so a screen that shows
      // one number still shows something true; `error` is the first failure.
      const incidents = perItem.map((r) => ({
        uid: r.uid, number: r.number || null, url: r.url || null, error: r.error || null,
      }));
      const numbers = incidents.map((i) => i.number).filter(Boolean);
      const failed = incidents.filter((i) => i.error);
      raised.push({
        scope: 'rack', uid: '*', items: rackUids, count: rackUids.length,
        ticket: { system: sn ? 'servicenow' : 'none', raised: numbers.length,
                  failed: failed.length, incidents },
        number: numbers.length ? numbers.join(', ') : null,
        error: failed.length ? failed[0].error : null,
      });
    }
    raised.push(...perItem);

    for (const n of notices.values()) {
      notifyAssignee(plan, {
        ...n, rackName, siteName, by, wholeRack,
        question: wholeRack ? (rackAsk.note || null)
          : (n.items.length === 1 ? n.items[0].ticket.question : null),
      });
    }
    plans.save(plan);
    plan = plans.get(req.params.planId);
  }

  res.json({
    planId: plan.id,
    applied: out.applied,
    refused: out.refused,
    raised,
    wholeRack,
    serviceNowConfigured: Boolean(sn),
    summary: summaryOf(plan),
    settled: plans.isSettled(plan),
  });
});

/**
 * Is the caller the person this ticket was assigned to?
 *
 * Matched three ways, because the assignee is a NetBox contact and the caller
 * is a RackTrack user: by the name the admin picked, by the contact's email
 * against the caller's, or by the contact id when the caller carries one.
 */
function isAssignee(req, ticket) {
  const u = req.user || {};
  const theirs = [ticket.assignee, ticket.assigneeEmail,
    ticket.assigneeId != null ? String(ticket.assigneeId) : null]
    .filter(Boolean).map((v) => String(v).toLowerCase());
  const ours = [u.username, u.email, u.netbox_contact_id != null ? String(u.netbox_contact_id) : null,
    req.query.assigneeId != null ? String(req.query.assigneeId) : null]
    .filter(Boolean).map((v) => String(v).toLowerCase());
  return ours.some((v) => theirs.includes(v));
}

/**
 * Whoever the ticket went to has been and looked.
 *
 * Their answer returns the item to the admin as undecided. A finished ticket
 * is not an approval, and this route deliberately cannot approve anything.
 */
router.post('/:planId/tickets/:uid/resolve', gates.admin, (req, res) => {
  const { finding, outcome } = req.body || {};
  const plan = plans.get(req.params.planId);
  if (!mine(req, plan)) return res.status(404).json({ error: 'no such plan' });

  const item = plan.items.find((i) => i.uid === req.params.uid);
  if (!item || !item.ticket) return res.status(404).json({ error: 'no ticket on that item' });
  // A port shares its device's ticket; the device row is the one to resolve.
  if (item.ticket.sharedWith) {
    return res.status(409).json({ error: 'this port follows its device; resolve the device ticket instead' });
  }

  // The person it was assigned to can resolve it; so can an org admin or the
  // owner. A site manager who is not the assignee cannot close somebody
  // else's ticket.
  const me = who(req);
  const orgAdmin = ['owner', 'org_admin'].includes(req.user?.role);
  if (!isAssignee(req, item.ticket) && !orgAdmin) {
    return res.status(403).json({
      error: `this ticket is assigned to ${item.ticket.assignee}`,
    });
  }

  const out = plans.resolveTicket(req.params.planId, req.params.uid,
                                  { by: me, finding, outcome });
  if (out.error) return res.status(409).json(out);
  trail.record(req, out.plan, 'drift.resolve', {
    payload: { uid: out.item.uid, outcome: out.item.ticket.outcome,
               finding: out.item.ticket.finding, assignee: out.item.ticket.assignee },
  });
  res.json({
    planId: out.plan.id,
    uid: out.item.uid,
    ticket: out.item.ticket,
    decision: out.item.decision,
    note: 'Back with the admin. A resolved ticket writes nothing on its own.',
  });
});

module.exports = router;
// For the test that holds the assignment email to what it may change.
module.exports._internal = { notifyAssignee };
