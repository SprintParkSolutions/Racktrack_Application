/**
 * Who hears about what.
 *
 * The contract names a set of people per event, and the failure that matters
 * is not "nobody was told" - it is "the wrong person was told", or "everybody
 * was told four times". So: the right people, once each, on the channels they
 * asked for, with the events that ignore preferences still going out.
 *
 * A sent check goes straight to its SPOC, so `submitted` tells nobody any
 * more: the holder hears `assigned`, the admins hear `reassign_needed` when
 * there is nobody to give it to, and the sender hears how it ended.
 */
process.env.NODE_ENV = 'test';
process.env.RACKTRACK_SKIP_WORKER_POOL = '1';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, beforeEach, describe, it } = require('node:test');

let tmp;
let store;
let service;
let notify;
let bus;
let sent;

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-notify-'));
  process.env.RACKTRACK_APPROVALS_DB = path.join(tmp, 'approvals.db');
  process.env.RT_DATA_DIR = tmp;
  store = require('../../lib/approvals/store');
  service = require('../../lib/approvals/service');
  notify = require('../../lib/approvals/notify');
  bus = require('../../lib/approvals/bus');

  // The people. On a throwaway database there are no users and no Sites, so
  // the two tables the notifier reads are made here, with the columns
  // store.js reads and nothing else.
  const db = store.db();
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenants (id INTEGER PRIMARY KEY, name TEXT, slug TEXT,
      organization_id INTEGER, timezone TEXT);
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT, email TEXT,
      role TEXT, tenant_id INTEGER, organization_id INTEGER, active INTEGER NOT NULL DEFAULT 1);
    INSERT INTO tenants (id, name, slug, organization_id, timezone)
      VALUES (7, 'Chennai', 'chennai', 1, 'Asia/Kolkata');
  `);
  const add = db.prepare(`INSERT INTO users (id, username, email, role, tenant_id, organization_id, active)
    VALUES (?, ?, ?, ?, ?, ?, 1)`);
  add.run(1, 'owner', 'owner@example.test', 'owner', 7, 1);
  add.run(2, 'meera', 'meera@example.test', 'org_admin', 7, 1);
  add.run(3, 'sunil', 'sunil@example.test', 'site_manager', 7, 1);
  add.run(4, 'other', 'other@example.test', 'site_manager', 8, 1);
  add.run(5, 'ravi', 'ravi@example.test', 'member', 7, 1);
  add.run(6, 'sam', 'sam@example.test', 'member', 7, 1);
  add.run(7, 'anita', 'anita@example.test', 'approver', 7, 1);
  add.run(8, 'ada', 'ada@example.test', 'org_admin', 9, 2);
});

after(() => {
  try { store._reset(); } catch { /* already closed */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  sent = [];
  notify.setTransport(async (msg) => { sent.push(msg); return true; });
});

const report = () => ({
  rackUid: 'rack:t7:5', netboxUrl: 'http://netbox.test', customField: 'present',
  counts: {}, warnings: [], orphans: [],
  changes: [{ type: 'Device', uid: 'dev:t7:5:u12', name: 'Sw1', action: 'create' }],
});

function planOf({ status = 'submitted' } = {}) {
  const filed = service.create({ scanId: 1, rackId: `RK-${Math.random().toString(36).slice(2, 8)}`,
    rackName: 'RK-1', report: report(), actor: service.trustedActor('ravi'),
    orgId: 1, tenantId: 7 });
  const plan = store.updatePlan(filed.plan.id, { status, createdById: 5, createdBy: 'ravi' });
  return plan;
}

const namesOf = (rows) => [...new Set(rows.map((r) => r.recipientEmail))].sort();

/** A check sent by ravi and now with sam, the SPOC of Chennai. */
function heldPlan({ status = 'assigned' } = {}) {
  const plan = planOf({ status });
  return store.updatePlan(plan.id, { submittedBy: 'ravi', submittedById: 5, submittedNote: 'the router is on shelf U20',
    spocUserId: 6, spoc: { userId: 6, username: 'sam', email: 'sam@example.test', source: 'site' } });
}

describe('the contract\'s table decides who hears', () => {
  it('tells nobody that a check was sent, and the admins when it has nobody to go to', async () => {
    const plan = planOf();
    const quiet = notify.send('submitted', { plan });
    await quiet.sent;
    assert.deepEqual(quiet.rows, [], 'a sent check goes to its SPOC, who hears `assigned`');
    assert.ok(!notify.EVENTS.includes('submitted'));

    const out = notify.send('reassign_needed', { plan, why: 'no_spoc', text: 'Chennai has no SPOC yet.' });
    await out.sent;
    assert.deepEqual(namesOf(out.rows), ['meera@example.test', 'owner@example.test']);
    assert.ok(!out.rows.some((r) => r.recipientEmail === 'sunil@example.test'),
      'the site manager no longer chooses who a check goes to');
    assert.ok(!out.rows.some((r) => r.recipientEmail === 'ada@example.test'),
      'another organization never hears about this plan');
    assert.equal(out.rows.filter((r) => r.channel === 'inapp').length, 2);
    assert.equal(sent.length, 2, 'and one email each');
    assert.match(sent[0].subject, /needs an admin/);
    assert.match(sent[0].text, /Chennai has no SPOC yet\./);
    assert.match(sent[0].text, /choose who it goes to/);
    assert.equal(out.rows[0].data.kind, 'needs_admin');
    assert.equal(out.rows[0].data.why, 'no_spoc');
  });

  it('sends an assignment to the person the check is with, in the app and by email', async () => {
    // A rack nobody has identified yet is known only by the hash of its photograph.
    const plan = store.updatePlan(heldPlan().id, { rackName: 'RK-2F85EE94' });
    const incident = { system: 'servicenow', number: 'INC0010042', url: 'https://sn.test/inc/42' };
    const out = notify.send('assigned', { plan, source: 'site', incident, siteName: 'Chennai',
      sender: { userId: 5, username: 'ravi' }, note: plan.submittedNote,
      targets: [{ uid: 'dev:t7:5:u12', type: 'Device', name: 'Sw1 U12', action: 'create' }] });
    await out.sent;

    assert.deepEqual(namesOf(out.rows), ['sam@example.test']);
    assert.deepEqual(out.rows.map((r) => r.channel).sort(), ['email', 'inapp']);
    assert.equal(notify.TABLE.assigned.always, true);
    assert.equal(sent.length, 1);
    // What the phone builds read: the subject's start, the marker, one address.
    assert.equal(sent[0].subject, 'Assigned to you: check a rack that has not been identified yet');
    assert.match(sent[0].text, /ravi sent a drift check on .* at Chennai\. It is yours as the SPOC of this site\./);
    assert.match(sent[0].text, /What differs:\n {2}- Sw1 on shelf U12: /);
    assert.match(sent[0].text, /ravi says: "the router is on shelf U20"/);
    assert.match(sent[0].text, /ServiceNow: INC0010042\nhttps:\/\/sn\.test\/inc\/42/);
    assert.match(sent[0].text, /What to do:/);
    assert.deepEqual(sent[0].text.match(/https?:\/\/\S+/g), ['https://sn.test/inc/42']);
    assert.doesNotMatch(sent[0].text, /\u2013|\u2014/, 'a plain hyphen only');
    assert.deepEqual(out.rows[0].data, { planId: plan.id, rackId: plan.rackId, rackName: null,
      siteName: 'Chennai', incidentNumber: 'INC0010042', incidentUrl: 'https://sn.test/inc/42',
      kind: 'assigned',
      // Which part this person plays, and who sent the check: a screen words
      // its heading from these rather than assuming the reader sent it.
      part: 'holder', sentBy: 'ravi',
    }, 'a rack known only by its photograph has no name to show');
    assert.deepEqual(store.notificationsFor(6)[0].data.kind, 'assigned', 'and the data is on the stored row');

    // An admin's hand-over says who gave it, and the old holder hears it has gone.
    const moved = store.updatePlan(plan.id, { rackName: 'SP-HYB-RM01-R01-R1' });
    const handed = notify.send('assigned', { plan: moved, source: 'admin', actor: { username: 'meera' } });
    await handed.sent;
    assert.match(sent[1].text, /meera has given you the drift check on rack SP-HYB-RM01-R01-R1 at Chennai, sent by ravi\./);
    assert.equal(handed.rows[0].data.rackName, 'SP-HYB-RM01-R01-R1');
    const gone = notify.send('reassigned', { plan: moved, actor: { username: 'meera' },
      previous: { userId: 3, username: 'sunil', email: 'sunil@example.test' }, holder: { username: 'sam' } });
    await gone.sent;
    assert.deepEqual(gone.rows.map((r) => [r.recipientUserId, r.channel]), [[3, 'inapp']]);
    assert.match(gone.rows[0].body, /meera has given the drift check on rack SP-HYB-RM01-R01-R1 to sam\./);
  });

  it('sends an assignment on a check from before the SPOC change to whoever its tickets went to', async () => {
    const plan = planOf({ status: 'assigned' });
    store.putTicket(plan.id, 'dev:t7:5:u12', { assignee: 'sam', assigneeEmail: 'sam@example.test',
      assigneeUserId: 6, status: 'open', raisedBy: 'meera' });
    const out = notify.send('assigned', { plan: store.getPlan(plan.id) });
    await out.sent;
    assert.deepEqual(namesOf(out.rows), ['sam@example.test']);
  });

  /* A decision is news to three people, not one - the owner's direction on
     23 September 2026. The employee who sent the check is waiting to hear;
     the single point of contact who decided it should see it landed; the
     admin answers for the estate. Each one gets a sentence written for them,
     and nobody gets somebody else's. */
  it('tells the sender, the SPOC who decided and the admins - each in their own words', async () => {
    const plan = heldPlan({ status: 'completed' });
    const done = store.updatePlan(plan.id, { result: { written: 1, writtenUids: ['dev:t7:5:u12'] } });
    const out = notify.send('completed', { plan: done });
    await out.sent;
    assert.deepEqual(namesOf(out.rows),
      ['meera@example.test', 'owner@example.test', 'ravi@example.test', 'sam@example.test']);
    const mine = out.rows.filter((r) => r.recipientEmail === 'ravi@example.test');
    assert.deepEqual(mine.map((r) => r.channel).sort(), ['email', 'inapp']);
    assert.match(mine[0].body, /Your drift check on .* is done\./);
    assert.match(mine[0].body, /1 change was written to NetBox and it now matches what was approved\./);
    assert.equal(mine[0].data.kind, 'written');
    assert.equal(mine[0].data.changes, 1);
    assert.equal(mine[0].data.part, 'sender');
    // The admin is told whose check it was, because it is not theirs.
    const hers = out.rows.find((r) => r.recipientEmail === 'meera@example.test');
    assert.match(hers.body, /The drift check on .*, sent by ravi, is done\./);
    assert.equal(hers.data.part, 'admin');

    const approved = notify.send('approved', { plan: heldPlan({ status: 'approved' }), actor: { username: 'sam' } });
    await approved.sent;
    const toRavi = approved.rows.find((r) => r.recipientEmail === 'ravi@example.test');
    const toSam = approved.rows.find((r) => r.recipientEmail === 'sam@example.test');
    const toMeera = approved.rows.find((r) => r.recipientEmail === 'meera@example.test');
    assert.match(toRavi.body, /sam approved your drift check/);
    assert.match(toSam.body, /You approved the drift check on .*, sent by ravi/);
    assert.match(toMeera.body, /sam approved the drift check on .*, sent by ravi/);

    const back = notify.send('rejected', { plan: heldPlan({ status: 'rework' }), to: 'rework',
      actor: { username: 'sam' }, reason: 'insufficient_evidence', comment: 'the photo is blurred' });
    await back.sent;
    const backToRavi = back.rows.find((r) => r.recipientEmail === 'ravi@example.test');
    assert.match(backToRavi.subject, /was sent back/);
    assert.match(backToRavi.body, /sam sent your drift check on .* back to be checked again: "the photo is blurred"/);
    assert.equal(backToRavi.data.kind, 'rework');
    assert.match(back.rows.find((r) => r.recipientEmail === 'sam@example.test').body,
      /You sent the drift check on .* back to ravi to be checked again/);

    const no = notify.send('rejected', { plan: heldPlan({ status: 'rejected' }), to: 'rejected',
      actor: { username: 'sam' }, reason: 'wrong_asset', comment: 'not this rack' });
    await no.sent;
    const noToRavi = no.rows.find((r) => r.recipientEmail === 'ravi@example.test');
    assert.match(noToRavi.body, /sam rejected your drift check on .* \(the wrong device\): "not this rack"/);
    assert.equal(noToRavi.data.kind, 'rejected');
  });

  it('asks for a second signature from nobody who sent it or signed first', async () => {
    const plan = store.updatePlan(heldPlan({ status: 'approval_pending' }).id, { submittedById: 7, submittedBy: 'anita' });
    const out = notify.send('approval_requested', { plan, stage: 'second', firstApproverId: 2,
      actor: { username: 'meera' } });
    await out.sent;
    assert.deepEqual(namesOf(out.rows), ['owner@example.test']);
    assert.match(out.rows[0].body, /has its first approval from meera and is waiting for a second\./);
  });

  it('escalates to the owner alone', async () => {
    const plan = planOf({ status: 'assigned' });
    const out = notify.send('sla_escalate', { plan, clock: 'resolution', percent: 120 });
    await out.sent;
    assert.deepEqual(namesOf(out.rows), ['owner@example.test']);
  });
});

describe('nobody is told the same thing twice', () => {
  it('writes one row per person per channel for one version of the plan', async () => {
    const plan = planOf();
    const first = notify.send('reassign_needed', { plan, why: 'no_spoc' });
    const again = notify.send('reassign_needed', { plan, why: 'no_spoc' });
    await Promise.all([first.sent, again.sent]);

    assert.equal(first.rows.length, 4, 'two people, two channels');
    assert.equal(again.rows.length, 0, 'the second time is the same event at the same version');
  });

  it('tells them again once the plan has moved on', async () => {
    const plan = planOf();
    const first = notify.send('reassign_needed', { plan, why: 'no_spoc' });
    const moved = store.updatePlan(plan.id, { status: 'triage' });
    const second = notify.send('reassign_needed', { plan: moved, why: 'no_spoc' });
    await Promise.all([first.sent, second.sent]);

    assert.equal(first.rows.length, 4);
    assert.equal(second.rows.length, 4, 'a new version of the plan is a new thing to say');
  });
});

describe('what happens when the mail does not go', () => {
  it('records the failure, the attempt and the reason, and keeps the in-app notice', async () => {
    notify.setTransport(async () => false);
    const plan = planOf();
    const out = notify.send('reassign_needed', { plan, why: 'no_spoc' });
    await out.sent;

    const emails = out.rows.filter((r) => r.channel === 'email')
      .map((r) => store.notificationsFor(r.recipientUserId, { channel: 'email' })[0]);
    assert.ok(emails.every((r) => r.status === 'failed'));
    assert.ok(emails.every((r) => r.attempts === 1));
    assert.match(emails[0].lastError, /no mail transport/);
    assert.ok(out.rows.filter((r) => r.channel === 'inapp').every((r) => r.status === 'sent'));
  });

  it('records what the transport threw', async () => {
    notify.setTransport(async () => { throw new Error('smtp refused the connection'); });
    const plan = planOf();
    const out = notify.send('reassign_needed', { plan, why: 'no_spoc' });
    await out.sent;
    const row = store.notificationsFor(2, { channel: 'email' })[0];
    assert.equal(row.status, 'failed');
    assert.match(row.lastError, /smtp refused/);
  });
});

describe('preferences, and the events that ignore them', () => {
  it('lets a person turn the email copy off', async () => {
    const plan = planOf();
    notify.setPrefs(1, 2, { email: false });
    assert.equal(notify.prefsFor(1, 2).email, false);
    assert.equal(notify.prefsFor(1, 3).email, true, 'one person\'s choice is their own');

    const out = notify.send('resolved', { plan });
    await out.sent;
    const mine = out.rows.filter((r) => r.recipientUserId === 2);
    assert.equal(mine.find((r) => r.channel === 'email').status, 'skipped');
    assert.equal(mine.find((r) => r.channel === 'inapp').status, 'sent');
    assert.ok(!sent.some((m) => m.to === 'meera@example.test'));
  });

  it('emails a failed write whatever the preference says, to the admins and the holder', async () => {
    const plan = heldPlan({ status: 'write_failed' });
    const out = notify.send('write_failed', { plan });
    await out.sent;
    assert.ok(sent.some((m) => m.to === 'meera@example.test'),
      'an admin who turned email off still hears that NetBox refused a write');
    assert.deepEqual(namesOf(out.rows), ['meera@example.test', 'owner@example.test', 'sam@example.test']);
    assert.match(sent[0].text, /An organization admin can try the write again/);
    assert.equal(out.rows[0].data.kind, 'write_failed');
    notify.setPrefs(1, 2, { email: true });
  });

  it('says a write that could not start did not start, and names no object NetBox refused', async () => {
    const plan = heldPlan({ status: 'approved' });
    const out = notify.send('write_failed', { plan, notStarted: true,
      error: 'No NetBox is configured for this organization, so there is nowhere to write.' });
    await out.sent;
    const mail = sent.find((m) => m.to === 'owner@example.test');
    assert.match(mail.subject, /did not start$/);
    assert.match(mail.text, /was approved, but the write to NetBox could not start: No NetBox is configured for this organization, so there is nowhere to write\.\n/);
    assert.match(mail.text, /Nothing was changed in NetBox\. The approval still stands/);
    assert.doesNotMatch(mail.text, /refused|went through/);
  });

  it('says an unassigned incident in two sentences, and never lowers a product\'s name', () => {
    const plan = heldPlan();
    const warning = 'No ServiceNow user has the email dev@x, so the incident is not assigned to anybody.';
    const said = notify.wordsFor('incident_failed', plan,
      { plan, problem: 'unassigned', incident: { number: 'INC0010134' }, assignWarning: warning }, { name: 'Aasritha' });
    assert.ok(said.body.includes(`Incident INC0010134 was raised. ${warning}`));
    assert.doesNotMatch(said.body, /, but [A-Z]/);
    const refused = notify.wordsFor('incident_failed', plan, { plan, problem: 'unassigned',
      incident: { number: 'INC0010134' },
      assignWarning: 'ServiceNow would not assign it (403), so the incident is not assigned to anybody.' },
    { name: 'Aasritha' });
    assert.ok(refused.body.includes('was raised. ServiceNow would not assign it'));
    const bare = notify.wordsFor('incident_failed', plan,
      { plan, problem: 'unassigned', incident: { number: 'INC0010134' } }, { name: 'Aasritha' });
    assert.ok(bare.body.includes('Incident INC0010134 was raised. It is not assigned to anybody.'));
  });

  it('takes a switch per event, the shape the settings screen writes', async () => {
    const plan = planOf();
    notify.setPrefs(1, 1, { resolved: false });
    assert.equal(notify.prefsFor(1, 1).events.resolved, false);

    const out = notify.send('resolved', { plan });
    await out.sent;
    assert.ok(!out.rows.some((r) => r.recipientUserId === 1 && r.status !== 'skipped'),
      'the person who turned this event off hears nothing on any channel');
    assert.ok(out.rows.some((r) => r.recipientUserId === 2 && r.status !== 'skipped'),
      'and everybody else still does');

    // The check is yours: no switch keeps that from you.
    notify.setPrefs(1, 6, { assigned: false, email: false });
    const mine = notify.send('assigned', { plan: heldPlan() });
    await mine.sent;
    assert.deepEqual(mine.rows.filter((r) => r.recipientUserId === 6).map((r) => r.status).sort(),
      ['queued', 'sent'], 'an assignment ignores the per-event switch and the email switch');
    notify.setPrefs(1, 6, { assigned: true, email: true });

    // An admin turns the breach notice off; it goes out anyway.
    notify.setPrefs(1, 2, { sla_breach: false });
    const breach = notify.send('sla_breach', { plan, clock: 'resolution', percent: 100 });
    await breach.sent;
    assert.ok(breach.rows.some((r) => r.recipientUserId === 2 && r.channel === 'email'
      && r.status !== 'skipped'), 'a breach goes out whatever the switch says');
    notify.setPrefs(1, 1, { resolved: true });
    notify.setPrefs(1, 2, { sla_breach: true });
  });

  it('will not turn the in-app record off', () => {
    const prefs = notify.setPrefs(1, 3, { inapp: false });
    assert.equal(prefs.inapp, true);
  });
});

describe('reading them', () => {
  it('lists what is unread, and marks one read', async () => {
    const plan = planOf();
    await notify.send('verification_failed', { plan, reason: 'still differs' }).sent;
    await notify.send('reassigned', { plan, previous: { userId: 3, username: 'sunil' } }).sent;
    const before = notify.listFor(3);
    assert.ok(before.unread > 0);
    assert.ok(before.notifications.every((n) => n.channel === 'inapp'));

    const row = notify.markRead(before.notifications[0].id, 3);
    assert.ok(row.readAt);
    assert.equal(notify.listFor(3).unread, before.unread - 1);
    assert.equal(notify.markRead(before.notifications[0].id, 6), null,
      'somebody else\'s notice is not theirs to read');
  });
});

describe('a listener never breaks a request', () => {
  it('swallows an event it cannot make sense of', () => {
    notify.subscribe();
    assert.doesNotThrow(() => bus.emit('submitted', { plan: null }));
    assert.doesNotThrow(() => bus.emit('submitted', {}));
  });

  it('writes the rows when the bus carries a real transition', async () => {
    const plan = planOf({ status: 'approval_pending' });
    notify.subscribe();
    bus.emit('approval_requested', { plan, from: 'verification_pending', to: 'approval_pending' });
    await new Promise((r) => setImmediate(r));
    const rows = store.notificationsFor(7, { channel: 'inapp' })
      .filter((n) => n.planId === plan.id);
    assert.equal(rows.length, 1, 'the approver was told');
  });
});
