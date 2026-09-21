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
 * PREFERENCES, WITH THREE EXCEPTIONS. A person may turn email off for
 * themselves in `notification_prefs`. Three events ignore that and always go
 * out: write_failed, sla_breach and sla_escalate. Somebody has to know that
 * NetBox refused a write, whatever their inbox rules are.
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
  submitted: { to: ['triage'], channels: ['inapp', 'email'] },
  // In the application only. The person is already sent one email when a ticket
  // is put on them - the one that lists what they were handed and carries the
  // incident - and now that this notice lists the same things, mailing it too
  // would be the same message twice.
  assigned: { to: ['assignee'], channels: ['inapp'] },
  p1_p2_created: { to: ['admin'], channels: ['email'] },
  sla_warn: { to: ['assignee', 'admin'], channels: ['inapp', 'email'] },
  sla_breach: { to: ['assignee', 'admin', 'owner'], channels: ['inapp', 'email'], always: true },
  sla_escalate: { to: ['owner'], channels: ['inapp', 'email'], always: true },
  pending: { to: ['creator'], channels: ['inapp', 'email'] },
  resolved: { to: ['creator', 'admin'], channels: ['inapp', 'email'] },
  verification_failed: { to: ['assignee', 'admin'], channels: ['inapp', 'email'] },
  approval_requested: { to: ['approver'], channels: ['inapp', 'email'] },
  approval_overdue: { to: ['approver', 'owner'], channels: ['inapp', 'email'] },
  approved: { to: ['creator', 'assignee', 'admin'], channels: ['inapp', 'email'] },
  rejected: { to: ['creator', 'assignee', 'admin'], channels: ['inapp', 'email'] },
  completed: { to: ['creator', 'admin'], channels: ['inapp'] },
  write_failed: { to: ['admin'], channels: ['inapp', 'email'], always: true },
};

const EVENTS = Object.keys(TABLE);

// -- Who ------------------------------------------------------------------
const roleIs = (u, roles) => Boolean(u && roles.includes(u.role));
const usersOf = (plan) => (plan.orgId == null ? [] : store.usersOfOrg(plan.orgId));

const person = (u) => (u && (u.id != null || u.email)
  ? { userId: u.id ?? null, email: u.email || null, name: u.username || u.name || null, role: u.role || null }
  : null);

/** Everyone a plan's tickets are out with, as people rather than contacts. */
function assigneesOf(plan, payload) {
  const out = [];
  if (payload && payload.assignee) {
    out.push({ userId: payload.assignee.userId ?? null, email: payload.assignee.email || null,
      name: payload.assignee.name || null, role: 'assignee' });
  }
  for (const t of store.ticketsOf(plan.id)) {
    if (!['open', 'accepted', 'in_progress', 'pending', 'resolved'].includes(t.status)) continue;
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
  if (word === 'assignee') return assigneesOf(plan, payload);
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
  for (const word of rule.to) {
    for (const p of peopleFor(word, plan, payload)) {
      if (!p) continue;
      const key = p.userId != null ? `u:${p.userId}` : `e:${String(p.email || '').toLowerCase()}`;
      if (key === 'e:' || seen.has(key)) continue;
      seen.add(key);
      out.push(p);
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

const LINES = {
  submitted: (plan) => [`A drift check on ${where(plan)} is waiting for triage.`,
    `${plan.createdBy || 'A technician'} sent it over.`],
  // The one message a person acts on without having asked for it, so it says
  // everything they need before they open anything: which rack and where, each
  // thing to look at in plain words, the question the admin typed, the ServiceNow
  // incident, and the three steps. It used to say "please check rack RK-2F85EE94,
  // open the plan" - the photograph's hash and no reason.
  assigned: (plan, p) => {
    const rack = rackWords(p.rackName || plan.rackName || plan.rackId);
    const targets = Array.isArray(p.targets) ? p.targets : [];
    const incidents = (Array.isArray(p.incidents) ? p.incidents : []).filter((i) => i && i.number);
    const by = p.actor && p.actor.username ? p.actor.username : 'An admin';
    // A whole rack handed over is ten items and ten incidents. Reciting them all
    // filled a phone screen with a list nobody reads; the first few say what kind
    // of job it is, and the check itself has the rest.
    const SHOWN = 4;
    const numbers = incidents.map((i) => i.number);
    return [
      `${by} has asked you to check ${rack}${p.siteName ? ` at ${p.siteName}` : ''}`
        + `${targets.length > 1 ? `: ${targets.length} things` : ''}.`,
      '',
      targets.length ? 'What to check:' : '',
      ...targets.slice(0, SHOWN).map((t) => `  - ${plainItem(t, p.rackName || plan.rackName || '')}`),
      targets.length > SHOWN ? `  - and ${targets.length - SHOWN} more, listed in the check.` : '',
      p.question ? '' : '',
      p.question ? `${by} asks: "${p.question}"` : '',
      numbers.length ? '' : '',
      numbers.length ? `ServiceNow: ${numbers.slice(0, 3).join(', ')}${numbers.length > 3 ? ` and ${numbers.length - 3} more` : ''}` : '',
      incidents[0] && incidents[0].url ? incidents[0].url : '',
      '',
      'What to do:',
      '  1. Open the check and press Accept.',
      '  2. Go to the rack and look. Press Start work while you are there.',
      '  3. Press Resolve and write what you found. It then goes to the admin for approval.',
    ];
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
  approval_requested: (plan) => [`A drift check on ${where(plan)} is waiting for approval.`],
  approval_overdue: (plan) => [`A drift check on ${where(plan)} has been waiting for approval too long.`],
  approved: (plan, p) => [`The drift check on ${where(plan)} was approved${p.actor && p.actor.username ? ` by ${p.actor.username}` : ''}.`],
  rejected: (plan, p) => [`The drift check on ${where(plan)} was ${p.to === 'rework' ? 'sent back for rework' : 'rejected'}`
    + `${p.reason ? ` (${p.reason})` : ''}.`],
  completed: (plan) => [`The drift check on ${where(plan)} is done and NetBox now matches the rack.`],
  // Name every object NetBox refused, because "part of it" tells an admin
  // nothing they can act on. This is the only email a failed write sends.
  write_failed: (plan) => {
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
      'The plan is marked "write failed". Fix the cause and write it again; NetBox is '
        + 'compared once more before anything is written.',
    ];
  },
};

const SUBJECTS = {
  submitted: (plan) => `RackTrack: a drift check on ${where(plan)} needs triage`,
  assigned: (plan, p) => `Assigned to you: check ${rackWords(p.rackName || plan.rackName || plan.rackId)}`,
  p1_p2_created: (plan) => `RackTrack: ${plan.priority} drift on ${where(plan)}`,
  sla_warn: (plan, p) => `RackTrack: the ${p.clock} clock on ${where(plan)} is close to its target`,
  sla_breach: (plan, p) => `RackTrack: the ${p.clock} clock on ${where(plan)} has run out`,
  sla_escalate: (plan, p) => `RackTrack: ${where(plan)} needs attention now (${p.clock})`,
  pending: (plan) => `RackTrack: the check on ${where(plan)} is on hold`,
  resolved: (plan) => `RackTrack: ${where(plan)} is ready for its verification scan`,
  verification_failed: (plan) => `RackTrack: the verification scan of ${where(plan)} failed`,
  approval_requested: (plan) => `RackTrack: ${where(plan)} is waiting for approval`,
  approval_overdue: (plan) => `RackTrack: ${where(plan)} has been waiting for approval`,
  approved: (plan) => `RackTrack: ${where(plan)} was approved`,
  rejected: (plan) => `RackTrack: ${where(plan)} was sent back`,
  completed: (plan) => `RackTrack: ${where(plan)} is done`,
  write_failed: (plan) => `RackTrack: the write for ${where(plan)} did not finish`,
};

/** The subject and the body one person reads. */
function wordsFor(event, plan, payload, to) {
  const subject = (SUBJECTS[event] || ((p) => `RackTrack: ${event} on ${where(p)}`))(plan, payload || {});
  const lines = (LINES[event] || (() => [`${event} on ${where(plan)}.`]))(plan, payload || {});
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
    const prefs = prefsFor(fresh.orgId, to.userId);
    for (const channel of rule.channels) {
      if (!CHANNELS.includes(channel)) continue;
      const wanted = rule.always
        || (prefs.events[event] !== false && prefs[channel] !== false);
      if (channel === 'email' && !to.email) continue;
      const { subject, body } = wordsFor(event, fresh, payload, to);
      const row = store.addNotification({
        event, planId: fresh.id, recipientUserId: to.userId ?? null, recipientEmail: to.email || null,
        channel, subject, body, dedupeKey: keyOf(event, fresh, to, channel),
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
  recipientsFor, peopleFor, wordsFor, prefsFor, setPrefs,
  send, deliver, retryQueued, listFor, markRead, markAllRead,
  setTransport, subscribe,
};
