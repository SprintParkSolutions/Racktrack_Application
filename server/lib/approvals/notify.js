/**
 * Who hears about what, and how.
 *
 * Every named event on the bus lands here, and this module answers three
 * questions for it: who should know, on which channel, and what does the
 * sentence say. The answers are one table, the contract's own
 * (docs/design/approvals-api-contract.md, "Events on the bus and the
 * notifications they cause"), so adding an event is a row and not a rewrite.
 *
 * ONE ROW PER PERSON PER CHANNEL, in approval_notifications, with a dedupe key
 * of event + plan + recipient + channel + the plan's version at the time. The
 * same event heard twice for the same version of the same plan is written
 * once; the version is in the key so a plan that moves on and comes back round
 * does tell people again.
 *
 * IN-APP IS THE RECORD, EMAIL IS THE COURTESY. An in-app row is delivered the
 * moment it is written and carries a read state. An email goes through
 * auth.sendNotice, the same transports the rest of the application uses; the
 * row keeps the attempt count and the last error, so an admin can see that a
 * notice was written and why it never left.
 *
 * PREFERENCES, WITH EXCEPTIONS. A person may turn email off for themselves in
 * `notification_prefs`. The rows marked `always` ignore that and go out
 * anyway: a check given to you, a check that needs an admin, an incident that
 * needs a look, write_failed, sla_breach and sla_escalate. Somebody has to
 * know a check is theirs, or that NetBox refused a write, whatever their inbox
 * rules are.
 *
 * WHAT IT IS ABOUT, AS FIELDS. Every row carries `data`: the plan, the rack,
 * the site, the incident and a `kind`, so a screen can draw a card and its
 * buttons without parsing the words.
 *
 * A LISTENER NEVER BREAKS A REQUEST. Everything here is wrapped: a bad
 * recipient, a database that is busy, a mail server that is down. The worst
 * that happens is a row marked failed with a reason in it.
 */
const store = require('./store');
const bus = require('./bus');

const CHANNELS = ['inapp', 'email'];

/**
 * The contract's table. `to` is a role word this module knows how to resolve;
 * `always` means preferences do not apply.
 */
const TABLE = {
  // `submitted` has no row any more: a sent check goes straight to its SPOC,
  // who hears `assigned`. The bus event stays, for the clocks and the audit.
  //
  // In the application and by email, whatever the person's switches say: the
  // check is theirs now and nothing moves until they look.
  assigned: { to: ['holder'], channels: ['inapp', 'email'], always: true },
  reassigned: { to: ['previous_holder'], channels: ['inapp'] },
  reassign_needed: { to: ['admin'], channels: ['inapp', 'email'], always: true },
  // The holder too when ServiceNow closed the incident under them: it changes
  // nothing here, and they should hear that from us rather than wonder.
  incident_failed: { to: ['admin'], channels: ['inapp', 'email'], always: true,
    also: (payload) => (payload && payload.problem === 'closed_outside' ? ['holder'] : []) },
  p1_p2_created: { to: ['admin'], channels: ['email'] },
  sla_warn: { to: ['assignee', 'admin'], channels: ['inapp', 'email'] },
  sla_breach: { to: ['assignee', 'admin', 'owner'], channels: ['inapp', 'email'], always: true },
  sla_escalate: { to: ['owner'], channels: ['inapp', 'email'], always: true },
  pending: { to: ['creator'], channels: ['inapp', 'email'] },
  resolved: { to: ['creator', 'admin'], channels: ['inapp', 'email'] },
  verification_failed: { to: ['assignee', 'admin'], channels: ['inapp', 'email'] },
  approval_requested: { to: ['approver'], channels: ['inapp', 'email'] },
  approval_overdue: { to: ['approver', 'owner'], channels: ['inapp', 'email'] },
  /* A decision is news to three people, not one (the owner, 23 September 2026):
     the employee who sent the check and is waiting to hear, the single point
     of contact who took the decision and should see it landed, and the admin
     who answers for the estate. One row each, worded for whoever is reading
     it - see LINES below, which knows who it is writing to. */
  approved: { to: ['sender', 'assignee', 'admin'], channels: ['inapp', 'email'] },
  rejected: { to: ['sender', 'assignee', 'admin'], channels: ['inapp', 'email'] },
  completed: { to: ['sender', 'assignee', 'admin'], channels: ['inapp', 'email'] },
  write_failed: { to: ['admin', 'holder'], channels: ['inapp', 'email'], always: true },
};

const EVENTS = Object.keys(TABLE);

// -- Who ------------------------------------------------------------------
const roleIs = (u, roles) => Boolean(u && roles.includes(u.role));
const usersOf = (plan) => (plan.orgId == null ? [] : store.usersOfOrg(plan.orgId));

const person = (u) => (u && (u.id != null || u.email)
  ? { userId: u.id ?? null, email: u.email || null, name: u.username || u.name || null, role: u.role || null }
  : null);

/**
 * Everyone a plan's tickets went to, as people rather than contacts. A ticket
 * of any status counts: a clock that runs out after the tickets have closed
 * still has to reach somebody.
 */
function assigneesOf(plan, payload) {
  const out = [];
  if (payload && payload.assignee) {
    out.push({ userId: payload.assignee.userId ?? null, email: payload.assignee.email || null,
      name: payload.assignee.name || null, role: 'assignee' });
  }
  for (const t of store.ticketsOf(plan.id)) {
    if (t.assigneeUserId == null && !t.assigneeEmail) continue;
    out.push({ userId: t.assigneeUserId ?? null, email: t.assigneeEmail || null,
      name: t.assignee || null, role: 'assignee' });
  }
  return out;
}

/** The person who ran the comparison. */
function creatorOf(plan) {
  const u = (plan.createdById != null ? store.userById(plan.createdById) : null)
    || (plan.createdBy ? store.userByUsername(plan.createdBy) : null);
  return u ? [person(u)] : [];
}

/** The person the check is with; for a check from before the SPOC change, whoever its tickets went to. */
function holderOf(plan, payload) {
  const h = plan.spocUserId != null ? plan.spoc : null;
  if (!h) return assigneesOf(plan, payload);
  return [{ userId: h.userId ?? null, email: h.email || null, name: h.username || null, role: 'holder' }];
}

/** The person who sent the check, or failing that whoever ran the comparison. */
function senderOf(plan) {
  const u = (plan.submittedById != null ? store.userById(plan.submittedById) : null)
    || (plan.submittedBy ? store.userByUsername(plan.submittedBy) : null);
  return u ? [person(u)] : creatorOf(plan);
}

/** The people one role word stands for, on this plan. */
function peopleFor(word, plan, payload) {
  const all = usersOf(plan);
  if (word === 'admin') return all.filter((u) => roleIs(u, ['owner', 'org_admin'])).map(person);
  if (word === 'triage') {
    return all.filter((u) => roleIs(u, ['owner', 'org_admin'])
      || (u.role === 'site_manager' && Number(u.tenantId) === Number(plan.tenantId))).map(person);
  }
  if (word === 'approver') return all.filter((u) => roleIs(u, ['owner', 'org_admin', 'approver'])).map(person);
  if (word === 'owner') {
    const owners = all.filter((u) => u.role === 'owner').map(person);
    // A small organization may have no owner account of its own. The people
    // who run it are then its admins, and an escalation that reaches nobody
    // is worse than one that reaches them.
    return owners.length ? owners : all.filter((u) => u.role === 'org_admin').map(person);
  }
  if (word === 'creator') return creatorOf(plan);
  if (word === 'sender') return senderOf(plan);
  if (word === 'holder' || word === 'assignee') return holderOf(plan, payload);
  if (word === 'previous_holder') {
    const was = payload && payload.previous;
    return was ? [{ userId: was.userId ?? null, email: was.email || null, name: was.username || null,
      role: 'previous_holder' }] : [];
  }
  if (word === 'site_manager') {
    return all.filter((u) => u.role === 'site_manager'
      && Number(u.tenantId) === Number(plan.tenantId)).map(person);
  }
  return [];
}

/** One entry per person, the first mention of them winning. */
function recipientsFor(event, plan, payload) {
  const rule = TABLE[event];
  if (!rule) return [];
  const seen = new Set();
  const out = [];
  // A second signature is never asked of the person who sent the check, nor of
  // the one who has just signed first.
  const notThem = event === 'approval_requested'
    ? [plan.submittedById, payload && payload.firstApproverId].filter((id) => id != null).map(Number) : [];
  const words = [...rule.to, ...(rule.also ? rule.also(payload) : [])];
  for (const word of words) {
    for (const p of peopleFor(word, plan, payload)) {
      if (!p) continue;
      if (p.userId != null && notThem.includes(Number(p.userId))) continue;
      const key = p.userId != null ? `u:${p.userId}` : `e:${String(p.email || '').toLowerCase()}`;
      if (key === 'e:' || seen.has(key)) continue;
      seen.add(key);
      // Which word put them here - sender, assignee, admin. A decision says a
      // different true thing to each of them, and without this the sentence
      // written for the person who sent the check went to the admin too.
      out.push({ ...p, as: word });
    }
  }
  return out;
}

// -- What it says ---------------------------------------------------------
const where = (plan) => `rack ${plan.rackName || plan.rackId || plan.id}`;

/**
 * A rack, as a person would name it. A scan nobody has identified is known only
 * by the hash of its photograph, which means nothing to the person reading: it
 * is "a rack that has not been identified yet", and the site says where.
 */
const rackWords = (name) => (!name || /^RK-[0-9A-F]{6,}$/i.test(String(name))
  ? 'a rack that has not been identified yet' : `rack ${name}`);

/** One item to check, as somebody at the rack would say it. */
const ITEM_MEANS = {
  create: 'it is in the rack, but the record does not list it on that shelf',
  update: 'the record lists it, but some details are different',
  rebind: 'the record lists it under an older id',
};
function plainItem(item, rackName) {
  let name = String((item && item.name) || (item && item.uid) || 'an item');
  if (rackName && name.endsWith(rackName)) name = name.slice(0, -rackName.length).trim();
  const m = name.match(/^(.+?)\s+U(\d{1,2})$/);
  if (m) name = `${m[1]} on shelf U${Number(m[2])}`;
  const means = ITEM_MEANS[item && item.action];
  return means ? `${name}: ${means}.` : `${name}.`;
}

/** A reject reason code, as a person would say it. */
const REASON_WORDS = {
  insufficient_evidence: 'not enough evidence', incorrect_remediation: 'the wrong fix',
  configuration_still_differs: 'it still differs', wrong_spoc: 'not the right person',
  wrong_asset: 'the wrong device', change_not_authorized: 'not authorised', duplicate: 'a duplicate',
  known_exception: 'a known exception', maintenance_window_required: 'needs a maintenance window',
  other: 'another reason',
};
const INCIDENT_STATE_WORDS = { new: 'New', in_progress: 'In Progress', on_hold: 'On Hold',
  resolved: 'Resolved', closed: 'Closed', cancelled: 'Cancelled' };

const rackOf = (plan, p) => rackWords((p && p.rackName) || plan.rackName || plan.rackId);
const siteOf = (plan, p) => (p && p.siteName)
  || (plan.tenantId != null ? (store.tenantById(plan.tenantId) || {}).name : null) || null;
const senderName = (plan, p) => (p && p.sender && p.sender.username) || plan.submittedBy || 'A technician';
const actorName = (p, fallback) => (p && p.actor && !p.actor.system && p.actor.username) || fallback;
const holderName = (plan, p) => (p && p.holder && p.holder.username) || (plan.spoc && plan.spoc.username)
  || 'its SPOC';
const incidentIn = (plan, p) => (p && p.incident) || plan.incident || null;

const LINES = {
  // The one message a person acts on without having asked for it, so it says
  // everything they need before they open anything: which rack and where, each
  // difference in plain words, what the sender said, the ServiceNow incident,
  // and the three steps. The phone reads this body: the `What to do:` marker
  // stays, and the only address in it is the incident's.
  assigned: (plan, p) => {
    const rack = rackOf(plan, p);
    const site = siteOf(plan, p);
    const at = site ? ` at ${site}` : '';
    const sender = senderName(plan, p);
    const targets = Array.isArray(p.targets) ? p.targets : [];
    const inc = incidentIn(plan, p);
    // A whole rack is ten differences. Reciting them all filled a phone screen
    // with a list nobody reads; the first few say what kind of job it is, and
    // the check itself has the rest.
    const SHOWN = 4;
    const note = p.note || plan.submittedNote || null;
    return [
      p.source === 'admin'
        ? `${actorName(p, 'An admin')} has given you the drift check on ${rack}${at}, sent by ${sender}.`
        : `${sender} sent a drift check on ${rack}${at}. It is yours as the SPOC of this site.`,
      '',
      targets.length ? 'What differs:' : '',
      ...targets.slice(0, SHOWN).map((t) => `  - ${plainItem(t, p.rackName || plan.rackName || '')}`),
      targets.length > SHOWN ? `  - and ${targets.length - SHOWN} more, listed in the check.` : '',
      '',
      note ? `${sender} says: "${note}"` : '',
      '',
      inc && inc.number ? `ServiceNow: ${inc.number}` : '',
      inc && inc.number && inc.url ? inc.url : '',
      inc && !inc.number && inc.error ? 'ServiceNow: no incident could be raised. An admin has been told.' : '',
      '',
      'What to do:',
      '  1. Open the check. The drift report is beside it.',
      '  2. Approve, reject or change each difference.',
      '  3. Approve the check. What you approved is written to NetBox at once.',
    ];
  },
  reassigned: (plan, p) => [`${actorName(p, 'An admin')} has given the drift check on ${rackOf(plan, p)} `
    + `to ${holderName(plan, p)}. There is nothing more for you to do on it.`],
  reassign_needed: (plan, p) => {
    const site = siteOf(plan, p);
    return [
      `${senderName(plan, p)} sent a drift check on ${rackOf(plan, p)}${site ? ` at ${site}` : ''}.`,
      p.why === 'wrong_spoc'
        ? `${holderName(plan, p)} says this check is not theirs: "${p.text || ''}".`
        : (p.text || ''),
      'Open the check in Drift Desk and choose who it goes to.',
    ];
  },
  incident_failed: (plan, p) => {
    const inc = incidentIn(plan, p) || {};
    const number = inc.number || 'The incident';
    const holder = holderName(plan, p);
    // The warning is a sentence of its own, and may start with a product's
    // name, so it is never folded into this one or put in lower case.
    if (p.problem === 'unassigned') {
      return [`Incident ${number} was raised. ${p.assignWarning || inc.assignWarning || 'It is not assigned to anybody.'}`];
    }
    if (p.problem === 'attachment_failed') {
      return [`Incident ${number} was raised, but ${p.what || 'the drift report'} could not be attached: `
        + `${p.error || 'no reason given'}. RackTrack will try again.`];
    }
    // The call RackTrack has stopped trying: a raise, a new assignee, or a state.
    if (p.problem === 'push_failed' && p.op === 'raise') {
      return [`ServiceNow has still not taken the incident for check ${plan.id}: ${p.error || 'no reason given'}. `
        + `RackTrack has stopped trying. The check is with ${holder} all the same.`];
    }
    if (p.problem === 'push_failed' && p.op === 'reassign') {
      return [`Incident ${number} could not be given to ${p.to || holder} in ServiceNow: ${p.error || 'no reason given'}. `
        + 'In RackTrack the check is theirs all the same.'];
    }
    if (p.problem === 'push_failed' && !p.state) {
      return [`RackTrack could not add its note to incident ${number}: ${p.error || 'no reason given'}. `
        + 'Nothing else about the check has changed.'];
    }
    if (p.problem === 'push_failed') {
      return [`Incident ${number} could not be set to ${INCIDENT_STATE_WORDS[p.state] || p.state || 'its new state'}: `
        + `${p.error || 'no reason given'}. It is still open in ServiceNow.`];
    }
    if (p.problem === 'closed_outside') {
      return [`Incident ${number} was set to ${INCIDENT_STATE_WORDS[p.state] || p.state || 'closed'} in ServiceNow. `
        + `That does not approve or write anything: check ${plan.id} is still with ${holder}.`];
    }
    return [`ServiceNow did not take the incident for check ${plan.id}: ${p.error || inc.error || 'no reason given'}. `
      + `The check is with ${holder} all the same, and RackTrack will keep trying.`];
  },
  p1_p2_created: (plan) => [`A ${plan.priority} drift check was raised on ${where(plan)}.`],
  sla_warn: (plan, p) => [`The ${p.clock} clock on ${where(plan)} is ${p.percent || 80} percent through.`,
    p.targetAt ? `It is due at ${p.targetAt}.` : ''],
  sla_breach: (plan, p) => [`The ${p.clock} clock on ${where(plan)} has run out.`,
    p.targetAt ? `It was due at ${p.targetAt}.` : ''],
  sla_escalate: (plan, p) => [`The ${p.clock} clock on ${where(plan)} is well past its target.`,
    'It needs somebody to pick it up now.'],
  pending: (plan, p) => [`The check on ${where(plan)} is on hold: ${p.reason || 'waiting on somebody'}.`],
  resolved: (plan) => [`Everything asked about ${where(plan)} has been answered.`,
    'It is waiting for a verification scan.'],
  verification_failed: (plan, p) => [`The verification scan of ${where(plan)} did not confirm the fix.`,
    p.reason ? String(p.reason) : ''],
  approval_requested: (plan, p) => [p.stage === 'second'
    ? `A drift check on ${rackOf(plan, p)} has its first approval from ${actorName(p, 'its SPOC')} and is waiting for a second.`
    : `A drift check on ${where(plan)} is waiting for approval.`],
  approval_overdue: (plan) => [`A drift check on ${where(plan)} has been waiting for approval too long.`],
  approved: (plan, p, to) => {
    const who = actorName(p, 'The SPOC');
    const rack = rackOf(plan, p);
    const sentBy = plan.submittedBy || plan.createdBy || 'a technician';
    if (!to || to.as === 'sender') {
      return [`${who} approved your drift check on ${rack}. It is being written to NetBox now.`];
    }
    if (to.as === 'assignee') {
      return [`You approved the drift check on ${rack}, sent by ${sentBy}. `
        + 'It is being written to NetBox now.'];
    }
    return [`${who} approved the drift check on ${rack}, sent by ${sentBy}. `
      + 'It is being written to NetBox now.'];
  },
  rejected: (plan, p, to) => {
    const who = actorName(p, 'The SPOC');
    const rack = rackOf(plan, p);
    const said = p.comment ? `: "${p.comment}"` : '.';
    const why = p.reason ? ` (${REASON_WORDS[p.reason] || String(p.reason).replace(/_/g, ' ')})` : '';
    const sentBy = plan.submittedBy || plan.createdBy || 'a technician';
    const back = p.to === 'rework';
    if (!to || to.as === 'sender') {
      return [back
        ? `${who} sent your drift check on ${rack} back to be checked again${said}`
        : `${who} rejected your drift check on ${rack}${why}${said}`];
    }
    if (to.as === 'assignee') {
      return [back
        ? `You sent the drift check on ${rack} back to ${sentBy} to be checked again${said}`
        : `You rejected the drift check on ${rack}, sent by ${sentBy}${why}${said}`];
    }
    return [back
      ? `${who} sent the drift check on ${rack} back to ${sentBy} to be checked again${said}`
      : `${who} rejected the drift check on ${rack}, sent by ${sentBy}${why}${said}`];
  },
  completed: (plan, p, to) => {
    const n = writtenCount(plan);
    const rack = rackOf(plan, p);
    const sentBy = plan.submittedBy || plan.createdBy || 'a technician';
    const what = n
      ? `${n} change${n === 1 ? ' was' : 's were'} written to NetBox and it now matches what was approved.`
      : 'Nothing needed to be written.';
    if (!to || to.as === 'sender') return [`Your drift check on ${rack} is done. ${what}`];
    return [`The drift check on ${rack}, sent by ${sentBy}, is done. ${what}`];
  },
  // Name every object NetBox refused, because "part of it" tells an admin
  // nothing they can act on. This is the only email a failed write sends.
  write_failed: (plan, p) => {
    // An approval whose write could not begin has no result to read: NetBox
    // refused nothing, and nothing went through.
    if (p.notStarted) {
      return [
        `The check on ${where(plan)} was approved, but the write to NetBox could not start: `
          + `${String(p.error || 'no reason given').replace(/[.\s]+$/, '')}.`,
        'Nothing was changed in NetBox. The approval still stands, and an organization admin can start the write again.',
      ];
    }
    const r = plan.result || {};
    const failures = Array.isArray(r.failures) ? r.failures : [];
    const named = failures.map((f) => `  ${f.type || 'object'} "${f.name || f.uid}"${f.reason ? ` - ${f.reason}` : ''}`);
    const failed = failures.length || r.failed || 0;
    const written = Array.isArray(r.writtenUids) ? r.writtenUids.length : (r.written || 0);
    return [
      `The write of plan ${plan.id} for ${where(plan)} did not finish. NetBox refused `
        + `${failed} object${failed === 1 ? '' : 's'}:`,
      ...named,
      `${written} object${written === 1 ? '' : 's'} went through before that and `
        + `${written === 1 ? 'is' : 'are'} in NetBox now. Nothing else was changed.`,
      'The check is marked "write failed". An organization admin can try the write again; '
        + 'NetBox is compared once more before anything is written.',
    ];
  },
};

const SUBJECTS = {
  // The phone looks for a subject that starts "Assigned to you:".
  assigned: (plan, p) => `Assigned to you: check ${rackOf(plan, p)}`,
  reassigned: (plan, p) => `RackTrack: ${rackOf(plan, p)} has gone to somebody else`,
  reassign_needed: (plan, p) => `RackTrack: a drift check on ${rackOf(plan, p)} needs an admin`,
  incident_failed: (plan, p) => `RackTrack: the ServiceNow incident for ${rackOf(plan, p)} needs a look`,
  p1_p2_created: (plan) => `RackTrack: ${plan.priority} drift on ${where(plan)}`,
  sla_warn: (plan, p) => `RackTrack: the ${p.clock} clock on ${where(plan)} is close to its target`,
  sla_breach: (plan, p) => `RackTrack: the ${p.clock} clock on ${where(plan)} has run out`,
  sla_escalate: (plan, p) => `RackTrack: ${where(plan)} needs attention now (${p.clock})`,
  pending: (plan) => `RackTrack: the check on ${where(plan)} is on hold`,
  resolved: (plan) => `RackTrack: ${where(plan)} is ready for its verification scan`,
  verification_failed: (plan) => `RackTrack: the verification scan of ${where(plan)} failed`,
  approval_requested: (plan) => `RackTrack: ${where(plan)} is waiting for approval`,
  approval_overdue: (plan) => `RackTrack: ${where(plan)} has been waiting for approval`,
  approved: (plan, p) => `RackTrack: your check on ${rackOf(plan, p)} was approved`,
  rejected: (plan, p) => `RackTrack: your check on ${rackOf(plan, p)} was ${p.to === 'rework' ? 'sent back' : 'rejected'}`,
  completed: (plan, p) => `RackTrack: your check on ${rackOf(plan, p)} is written`,
  write_failed: (plan, p) => `RackTrack: the write for ${where(plan)} did not ${p && p.notStarted ? 'start' : 'finish'}`,
};

/** How many changes the write put into NetBox. */
const writtenCount = (plan) => {
  const r = plan.result || {};
  return Array.isArray(r.writtenUids) ? r.writtenUids.length : Number(r.written) || 0;
};

/** What a row is about, as the one word a screen switches on. */
const KINDS = { assigned: 'assigned', reassigned: 'reassigned', reassign_needed: 'needs_admin',
  incident_failed: 'incident', approved: 'approved', completed: 'written', write_failed: 'write_failed' };

/**
 * What a notice is about, as fields: always the plan, the rack, the site, the
 * incident and a `kind`, null where unknown, plus the few extras an event has.
 * The rack's name is left null while it is only the hash of a photograph.
 */
function dataFor(event, plan, payload = {}, to = null) {
  const inc = incidentIn(plan, payload) || {};
  const name = payload.rackName || plan.rackName || null;
  const data = {
    planId: plan.id, rackId: plan.rackId ?? null,
    rackName: name && !/^RK-[0-9A-F]{6,}$/i.test(String(name)) ? name : null,
    siteName: siteOf(plan, payload), incidentNumber: inc.number || null, incidentUrl: inc.url || null,
    kind: event === 'rejected' ? (payload.to === 'rework' ? 'rework' : 'rejected') : (KINDS[event] || event),
    // Which part the person reading this played: they sent the check, they
    // decided it, or they answer for the estate. A heading that says "your
    // check" is only true for the first of the three.
    part: to ? (to.as || null) : null,
    sentBy: plan.submittedBy || plan.createdBy || null,
  };
  if (event === 'reassign_needed') data.why = payload.why || null;
  if (event === 'incident_failed') data.problem = payload.problem || 'raise_failed';
  if (event === 'completed') data.changes = writtenCount(plan);
  return data;
}

/** The subject and the body one person reads. */
function wordsFor(event, plan, payload, to) {
  const subject = (SUBJECTS[event] || ((p) => `RackTrack: ${event} on ${where(p)}`))(plan, payload || {});
  const lines = (LINES[event] || (() => [`${event} on ${where(plan)}.`]))(plan, payload || {}, to);
  const body = [
    `Hello ${to.name || 'there'},`,
    '',
    // Empty strings are paragraph breaks a message asked for; runs of them, and
    // one at either end, are not.
    ...lines.filter((l, i, all) => l != null && !(l === '' && (i === 0 || i === all.length - 1 || all[i - 1] === ''))),
    '',
    `Plan ${plan.id} - ${plan.priority} - ${String(plan.status).replace(/_/g, ' ')}`,
    '',
    '- RackTrack',
  ].join('\n');
  return { subject, body };
}

// -- Preferences ----------------------------------------------------------
/**
 * What this person wants to hear about, and where.
 *
 * `notification_prefs` is written two ways and both are read: by channel
 * (`{ inapp, email, teams }`) and by event name (`{ submitted: false }`, the
 * shape the settings screen sends). A person's own row under `users` wins over
 * the organization's. Turning an event off turns off every channel for it -
 * except the three that always go out.
 */
function prefsFor(orgId, userId = null) {
  const defaults = require('./service').DEFAULT_SETTINGS.notification_prefs;
  const saved = orgId != null ? store.getSetting(orgId, 'notification_prefs') : undefined;
  const org = saved && typeof saved === 'object' ? { ...defaults, ...saved } : { ...defaults };
  const mine = userId != null && org.users && typeof org.users === 'object'
    ? org.users[String(userId)] : null;
  const out = { inapp: org.inapp !== false, email: org.email !== false, teams: Boolean(org.teams) };
  const events = {};
  const collect = (src) => {
    if (!src || typeof src !== 'object') return;
    for (const [key, value] of Object.entries(src)) {
      if (typeof value === 'boolean' && EVENTS.includes(key)) events[key] = value;
    }
  };
  collect(org);
  if (mine && typeof mine === 'object') {
    if (typeof mine.inapp === 'boolean') out.inapp = mine.inapp;
    if (typeof mine.email === 'boolean') out.email = mine.email;
    if (typeof mine.teams === 'boolean') out.teams = mine.teams;
    collect(mine);
  }
  out.events = events;
  return out;
}

/** One person's own preferences, written into the organization's setting. */
function setPrefs(orgId, userId, patch = {}) {
  const defaults = require('./service').DEFAULT_SETTINGS.notification_prefs;
  const saved = store.getSetting(orgId, 'notification_prefs');
  const org = saved && typeof saved === 'object' ? { ...defaults, ...saved } : { ...defaults };
  const users = { ...(org.users || {}) };
  const mine = { ...(users[String(userId)] || {}) };
  for (const c of CHANNELS) if (typeof patch[c] === 'boolean') mine[c] = patch[c];
  // And one switch per event, for somebody who wants the writes and not the
  // triage queue. The three that always go out are stored and then ignored.
  for (const event of EVENTS) if (typeof patch[event] === 'boolean') mine[event] = patch[event];
  // In-app is the record of what happened, so it cannot be turned off. Teams
  // is off everywhere until there are tokens for it.
  mine.inapp = true;
  users[String(userId)] = mine;
  store.setSetting(orgId, 'notification_prefs', { ...org, users }, userId);
  return prefsFor(orgId, userId);
}

// -- Sending --------------------------------------------------------------
let _transport = null;

/** Tests and scripts hand in their own sender; everything else uses auth. */
const setTransport = (fn) => { _transport = fn; };
const transport = () => _transport || ((msg) => require('../../auth').sendNotice(msg));

const keyOf = (event, plan, to, channel) => [event, plan.id, plan.version,
  to.userId != null ? `u${to.userId}` : `e${String(to.email || '').toLowerCase()}`, channel].join('|');

/**
 * Write the rows for one event and start whatever has to be sent.
 *
 * Returns the rows written and a promise that settles when every email has
 * been tried, so a test can await it. The bus listener ignores the promise:
 * a request never waits on a mail server.
 */
function send(event, payload = {}) {
  const rule = TABLE[event];
  const plan = payload && payload.plan;
  if (!rule || !plan || !plan.id) return { rows: [], sent: Promise.resolve([]) };
  const fresh = store.getPlan(plan.id, { heavy: false }) || plan;
  const people = recipientsFor(event, fresh, payload);
  const rows = [];
  const emails = [];
  for (const to of people) {
    const data = dataFor(event, fresh, payload, to);
    const prefs = prefsFor(fresh.orgId, to.userId);
    for (const channel of rule.channels) {
      if (!CHANNELS.includes(channel)) continue;
      const wanted = rule.always
        || (prefs.events[event] !== false && prefs[channel] !== false);
      if (channel === 'email' && !to.email) continue;
      const { subject, body } = wordsFor(event, fresh, payload, to);
      const row = store.addNotification({
        event, planId: fresh.id, recipientUserId: to.userId ?? null, recipientEmail: to.email || null,
        channel, subject, body, data, dedupeKey: keyOf(event, fresh, to, channel),
        status: !wanted ? 'skipped' : channel === 'inapp' ? 'sent' : 'queued',
      });
      if (!row) continue;   // heard before, at this version, for this person
      if (row.status === 'sent') store.updateNotification(row.id, { sentAt: store.nowIso() });
      rows.push(row);
      if (row.status === 'queued') emails.push(row);
    }
  }
  return { rows, sent: deliver(emails) };
}

/** Try each queued email once, and write down how it went. */
function deliver(rows) {
  const send1 = transport();
  return Promise.all((rows || []).map((row) => Promise.resolve()
    .then(() => send1({ to: row.recipientEmail, subject: row.subject, text: row.body }))
    .then((ok) => store.updateNotification(row.id, ok
      ? { status: 'sent', attempts: (row.attempts || 0) + 1, sentAt: store.nowIso(), lastError: null }
      : { status: 'failed', attempts: (row.attempts || 0) + 1,
        lastError: 'no mail transport is configured' }))
    .catch((err) => store.updateNotification(row.id, { status: 'failed',
      attempts: (row.attempts || 0) + 1,
      lastError: String((err && err.message) || err).slice(0, 300) }))));
}

/** Try the ones that never left again. */
function retryQueued({ limit = 50 } = {}) {
  const rows = [...store.notificationsByStatus('queued', limit),
    ...store.notificationsByStatus('failed', limit)]
    .filter((r) => r.channel === 'email' && (r.attempts || 0) < 5);
  return deliver(rows);
}

// -- Reading them ---------------------------------------------------------
function listFor(userId, { unreadOnly = false, limit = 100 } = {}) {
  const rows = store.notificationsFor(userId, { channel: 'inapp', unreadOnly, limit })
    .filter((n) => n.status !== 'skipped');
  return { notifications: rows, unread: rows.filter((n) => !n.readAt).length };
}

/** Mark one as read. Only the person it was written for may. */
function markRead(id, userId) {
  const rows = store.notificationsFor(userId, { channel: 'inapp', limit: 500 });
  const row = rows.find((n) => Number(n.id) === Number(id));
  if (!row) return null;
  return row.readAt ? row : store.updateNotification(row.id, { readAt: store.nowIso() });
}

function markAllRead(userId) {
  const rows = store.notificationsFor(userId, { channel: 'inapp', unreadOnly: true, limit: 500 });
  for (const row of rows) store.updateNotification(row.id, { readAt: store.nowIso() });
  return { read: rows.length };
}

// -- The bus --------------------------------------------------------------
let _listening = false;

/** Subscribe to every event in the table. Idempotent. */
function subscribe() {
  if (_listening) return;
  _listening = true;
  for (const event of EVENTS) {
    bus.on(event, (payload) => {
      try {
        const out = send(event, payload);
        if (out.sent && typeof out.sent.then === 'function') out.sent.then(null, () => {});
      } catch { /* a listener never breaks a request */ }
    });
  }
}

module.exports = {
  TABLE, EVENTS, CHANNELS,
  recipientsFor, peopleFor, wordsFor, dataFor, prefsFor, setPrefs,
  send, deliver, retryQueued, listFor, markRead, markAllRead,
  setTransport, subscribe,
};
