/**
 * Who hears about what.
 *
 * The contract names a set of people per event, and the failure that matters
 * is not "nobody was told" - it is "the wrong person was told", or "everybody
 * was told four times". So: the right people, once each, on the channels they
 * asked for, with the three events that ignore preferences still going out.
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

describe('the contract\'s table decides who hears', () => {
  it('sends a new plan to the people who triage it, and nobody else', async () => {
    const plan = planOf();
    const out = notify.send('submitted', { plan });
    await out.sent;

    assert.deepEqual(namesOf(out.rows),
      ['meera@example.test', 'owner@example.test', 'sunil@example.test']);
    assert.ok(!out.rows.some((r) => r.recipientEmail === 'other@example.test'),
      'the site manager of another Site is not asked to triage this one');
    assert.ok(!out.rows.some((r) => r.recipientEmail === 'ada@example.test'),
      'another organization never hears about this plan');
    assert.equal(out.rows.filter((r) => r.channel === 'inapp').length, 3);
    assert.equal(sent.length, 3, 'and one email each');
    assert.match(sent[0].subject, /needs triage/);
  });

  it('sends an assignment to the person it was assigned to', async () => {
    const plan = planOf({ status: 'assigned' });
    store.putTicket(plan.id, 'dev:t7:5:u12', { assignee: 'sam', assigneeEmail: 'sam@example.test',
      assigneeUserId: 6, status: 'open', raisedBy: 'meera' });
    const out = notify.send('assigned', { plan: store.getPlan(plan.id) });
    await out.sent;

    assert.deepEqual(namesOf(out.rows), ['sam@example.test']);
  });

  it('tells the creator and the admins when a plan is done, in-app only', async () => {
    const plan = planOf({ status: 'completed' });
    const out = notify.send('completed', { plan });
    await out.sent;

    assert.deepEqual(namesOf(out.rows),
      ['meera@example.test', 'owner@example.test', 'ravi@example.test']);
    assert.ok(out.rows.every((r) => r.channel === 'inapp'), 'completion is not worth an email');
    assert.equal(sent.length, 0);
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
    const first = notify.send('submitted', { plan });
    const again = notify.send('submitted', { plan });
    await Promise.all([first.sent, again.sent]);

    assert.equal(first.rows.length, 6, 'three people, two channels');
    assert.equal(again.rows.length, 0, 'the second time is the same event at the same version');
  });

  it('tells them again once the plan has moved on', async () => {
    const plan = planOf();
    const first = notify.send('submitted', { plan });
    const moved = store.updatePlan(plan.id, { status: 'triage' });
    const second = notify.send('submitted', { plan: moved });
    await Promise.all([first.sent, second.sent]);

    assert.equal(first.rows.length, 6);
    assert.equal(second.rows.length, 6, 'a new version of the plan is a new thing to say');
  });
});

describe('what happens when the mail does not go', () => {
  it('records the failure, the attempt and the reason, and keeps the in-app notice', async () => {
    notify.setTransport(async () => false);
    const plan = planOf();
    const out = notify.send('submitted', { plan });
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
    const out = notify.send('submitted', { plan });
    await out.sent;
    const row = store.notificationsFor(2, { channel: 'email' })[0];
    assert.equal(row.status, 'failed');
    assert.match(row.lastError, /smtp refused/);
  });
});

describe('preferences, and the three events that ignore them', () => {
  it('lets a person turn the email copy off', async () => {
    const plan = planOf();
    notify.setPrefs(1, 2, { email: false });
    assert.equal(notify.prefsFor(1, 2).email, false);
    assert.equal(notify.prefsFor(1, 3).email, true, 'one person\'s choice is their own');

    const out = notify.send('submitted', { plan });
    await out.sent;
    const mine = out.rows.filter((r) => r.recipientUserId === 2);
    assert.equal(mine.find((r) => r.channel === 'email').status, 'skipped');
    assert.equal(mine.find((r) => r.channel === 'inapp').status, 'sent');
    assert.ok(!sent.some((m) => m.to === 'meera@example.test'));
  });

  it('emails a failed write whatever the preference says', async () => {
    const plan = planOf({ status: 'write_failed' });
    const out = notify.send('write_failed', { plan });
    await out.sent;
    assert.ok(sent.some((m) => m.to === 'meera@example.test'),
      'an admin who turned email off still hears that NetBox refused a write');
    notify.setPrefs(1, 2, { email: true });
  });

  it('takes a switch per event, the shape the settings screen writes', async () => {
    const plan = planOf();
    notify.setPrefs(1, 3, { submitted: false });
    assert.equal(notify.prefsFor(1, 3).events.submitted, false);

    const out = notify.send('submitted', { plan });
    await out.sent;
    assert.ok(!out.rows.some((r) => r.recipientUserId === 3 && r.status !== 'skipped'),
      'the person who turned this event off hears nothing on any channel');
    assert.ok(out.rows.some((r) => r.recipientUserId === 2 && r.status !== 'skipped'),
      'and everybody else still does');

    // An admin turns the breach notice off; it goes out anyway.
    notify.setPrefs(1, 2, { sla_breach: false });
    const breach = notify.send('sla_breach', { plan, clock: 'resolution', percent: 100 });
    await breach.sent;
    assert.ok(breach.rows.some((r) => r.recipientUserId === 2 && r.channel === 'email'
      && r.status !== 'skipped'), 'a breach goes out whatever the switch says');
    notify.setPrefs(1, 3, { submitted: true });
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
    await notify.send('submitted', { plan }).sent;
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
