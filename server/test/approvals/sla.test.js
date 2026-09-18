/**
 * The clocks.
 *
 * Two things are being held to account here. The arithmetic: business hours
 * are Monday to Friday in the datacentre's own time zone, so an hour of work
 * left at 17:30 on Friday is due at 09:30 on Monday and not at 18:30 on
 * Friday. And the wiring: a clock starts and stops because the plan moved, a
 * plan on hold does not burn its resolution target, a change window stops
 * every clock, and warn, breach and escalate each fire once.
 *
 * Nothing here waits for time to pass: every function that does arithmetic
 * takes the instant it is reasoning about.
 */
process.env.NODE_ENV = 'test';
process.env.RACKTRACK_SKIP_WORKER_POOL = '1';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, describe, it } = require('node:test');

let tmp;
let store;
let service;
let sla;
let bus;

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-sla-'));
  process.env.RACKTRACK_APPROVALS_DB = path.join(tmp, 'approvals.db');
  process.env.RT_DATA_DIR = tmp;
  store = require('../../lib/approvals/store');
  service = require('../../lib/approvals/service');
  sla = require('../../lib/approvals/sla');
  bus = require('../../lib/approvals/bus');
});

after(() => {
  sla.stop();
  try { store._reset(); } catch { /* already closed */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

const CAL = { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00', timezone: 'UTC', holidays: [] };
// 2026-09-18 is a Friday; 2026-09-21 is the Monday after it.
const FRIDAY = '2026-09-18';
const MONDAY = '2026-09-21';

const report = () => ({
  rackUid: 'rack:t7:5', netboxUrl: 'http://netbox.test', customField: 'present',
  counts: {}, warnings: [], orphans: [],
  changes: [{ type: 'Device', uid: 'dev:t7:5:u12', name: 'Sw1', action: 'create' }],
});

/** A plan of one priority, in one status, with no clocks yet. */
function planOf({ priority = 'P1', status = 'triage' } = {}) {
  const filed = service.create({ scanId: 1, rackId: `RK-${Math.random().toString(36).slice(2, 8)}`,
    report: report(), actor: service.trustedActor('ravi'), orgId: 1, tenantId: 7 });
  return store.updatePlan(filed.plan.id, { priority, status });
}

const minutes = (iso, n) => new Date(Date.parse(iso) + n * 60000).toISOString().replace(/\.\d+Z$/, 'Z');
const clockOf = (planId, clock) => store.slaOf(planId).filter((c) => c.clock === clock).pop();

describe('business hours are the datacentre\'s own', () => {
  it('carries the rest of an hour over the weekend', () => {
    const out = sla.addBusinessMinutes(`${FRIDAY}T17:30:00Z`, 60, CAL);
    assert.equal(out, `${MONDAY}T09:30:00Z`);
  });

  it('starts at the next open door when the clock starts out of hours', () => {
    const out = sla.addBusinessMinutes(`${FRIDAY}T22:00:00Z`, 30, CAL);
    assert.equal(out, `${MONDAY}T09:30:00Z`);
  });

  it('counts only working time between two instants', () => {
    const out = sla.businessMinutesBetween(`${FRIDAY}T17:00:00Z`, `${MONDAY}T10:00:00Z`, CAL);
    assert.equal(out, 120, 'an hour on Friday and an hour on Monday');
  });

  it('reads 09:00 in the time zone the datacentre is in', () => {
    const india = { ...CAL, timezone: 'Asia/Kolkata' };
    // 09:00 in Kolkata is 03:30 UTC, so half an hour of work from 02:00 UTC
    // is not done until 04:00 UTC.
    assert.equal(sla.addBusinessMinutes(`${FRIDAY}T02:00:00Z`, 30, india), `${FRIDAY}T04:00:00Z`);
  });

  it('skips a holiday the organization declared', () => {
    const closed = { ...CAL, holidays: [MONDAY] };
    assert.equal(sla.addBusinessMinutes(`${FRIDAY}T17:30:00Z`, 60, closed), '2026-09-22T09:30:00Z');
  });
});

describe('a status change starts and stops the right clocks', () => {
  it('starts acceptance and resolution when the work is handed out', () => {
    const plan = planOf({ status: 'assigned' });
    sla.onTransition({ plan, to: 'assigned' }, { when: `${FRIDAY}T10:00:00Z` });

    const rows = store.slaOf(plan.id);
    assert.deepEqual(rows.map((r) => r.clock).sort(), ['acceptance', 'resolution']);
    // P1: fifteen minutes to accept, two hours to resolve, both plain time.
    assert.equal(clockOf(plan.id, 'acceptance').targetAt, `${FRIDAY}T10:15:00Z`);
    assert.equal(clockOf(plan.id, 'resolution').targetAt, `${FRIDAY}T12:00:00Z`);
  });

  it('meets acceptance and starts investigation when somebody takes it', () => {
    const plan = planOf({ status: 'assigned' });
    sla.onTransition({ plan, to: 'assigned' }, { when: `${FRIDAY}T10:00:00Z` });
    const taken = store.updatePlan(plan.id, { status: 'accepted' });
    sla.onTransition({ plan: taken, to: 'accepted' }, { when: `${FRIDAY}T10:05:00Z` });

    assert.equal(clockOf(plan.id, 'acceptance').status, 'met');
    assert.equal(clockOf(plan.id, 'acceptance').metAt, `${FRIDAY}T10:05:00Z`);
    assert.equal(clockOf(plan.id, 'investigation').status, 'running');
    assert.equal(clockOf(plan.id, 'resolution').status, 'running', 'resolution runs on');
  });

  it('meets resolution when the work is answered, and drops the rest when the plan closes', () => {
    const plan = planOf({ status: 'assigned' });
    sla.onTransition({ plan, to: 'assigned' }, { when: `${FRIDAY}T10:00:00Z` });
    const done = store.updatePlan(plan.id, { status: 'resolved' });
    sla.onTransition({ plan: done, to: 'resolved' }, { when: `${FRIDAY}T11:00:00Z` });
    assert.equal(clockOf(plan.id, 'resolution').status, 'met');

    const up = store.updatePlan(plan.id, { status: 'approval_pending' });
    sla.onTransition({ plan: up, to: 'approval_pending' }, { when: `${FRIDAY}T11:05:00Z` });
    assert.equal(clockOf(plan.id, 'approval').status, 'running');

    const over = store.updatePlan(plan.id, { status: 'completed' });
    sla.onTransition({ plan: over, to: 'completed' }, { when: `${FRIDAY}T12:00:00Z` });
    assert.equal(clockOf(plan.id, 'approval').status, 'cancelled');
  });
});

describe('a plan on hold does not burn its target', () => {
  it('pauses the resolution clock, and only that one', () => {
    const plan = planOf({ status: 'assigned' });
    sla.onTransition({ plan, to: 'assigned' }, { when: `${FRIDAY}T10:00:00Z` });
    const taken = store.updatePlan(plan.id, { status: 'accepted' });
    sla.onTransition({ plan: taken, to: 'accepted' }, { when: `${FRIDAY}T10:05:00Z` });
    const held = store.updatePlan(plan.id, { status: 'pending' });
    sla.onTransition({ plan: held, to: 'pending' }, { when: `${FRIDAY}T10:30:00Z` });

    assert.equal(clockOf(plan.id, 'resolution').status, 'paused');
    assert.equal(clockOf(plan.id, 'investigation').status, 'running',
      'the contract pauses the resolution clock only');

    const back = store.updatePlan(plan.id, { status: 'in_progress' });
    sla.onTransition({ plan: back, to: 'in_progress' }, { when: `${FRIDAY}T11:30:00Z` });
    const row = clockOf(plan.id, 'resolution');
    assert.equal(row.status, 'running');
    assert.equal(row.targetAt, `${FRIDAY}T13:00:00Z`, 'the hour on hold moved the target out by an hour');
    assert.equal(row.pausedMs, 3600000);
  });
});

describe('warn, breach and escalate', () => {
  it('fires each one once, in order', () => {
    const plan = planOf({ status: 'assigned' });
    const heard = [];
    // Other plans of this test run have clocks of their own; only this one's
    // are being counted.
    const on = (event) => {
      const fn = (p) => { if (p.plan.id === plan.id) heard.push({ event, clock: p.clock }); };
      bus.on(event, fn);
      return fn;
    };
    const fns = { sla_warn: on('sla_warn'), sla_breach: on('sla_breach'), sla_escalate: on('sla_escalate') };
    const start = `${FRIDAY}T10:00:00Z`;
    sla.onTransition({ plan, to: 'assigned' }, { when: start });

    sla.tick({ now: minutes(start, 10) });
    assert.equal(heard.length, 0, 'ten minutes into fifteen is not a warning yet');

    sla.tick({ now: minutes(start, 12) });          // 80 percent of fifteen minutes
    sla.tick({ now: minutes(start, 13) });          // again: nothing new
    assert.deepEqual(heard.map((h) => h.event), ['sla_warn']);
    assert.equal(heard[0].clock, 'acceptance');

    sla.tick({ now: minutes(start, 16) });
    assert.deepEqual(heard.map((h) => h.event), ['sla_warn', 'sla_breach']);
    assert.equal(clockOf(plan.id, 'acceptance').status, 'breached');

    sla.tick({ now: minutes(start, 19) });          // 120 percent
    assert.deepEqual(heard.map((h) => h.event), ['sla_warn', 'sla_breach', 'sla_escalate']);

    for (const [event, fn] of Object.entries(fns)) bus.off(event, fn);
  });

  it('tells the owner an approval is overdue', () => {
    const plan = planOf({ status: 'approval_pending' });
    const heard = [];
    const fn = (p) => { if (p.plan.id === plan.id) heard.push(p.clock); };
    bus.on('approval_overdue', fn);
    const start = `${FRIDAY}T10:00:00Z`;
    sla.onTransition({ plan, to: 'approval_pending' }, { when: start });
    sla.tick({ now: minutes(start, 31) });          // P1 approval is thirty minutes

    bus.off('approval_overdue', fn);
    assert.deepEqual(heard, ['approval']);
  });
});

describe('a change window stops the clocks', () => {
  it('pauses while the window is open and starts again after it', () => {
    const plan = planOf({ status: 'assigned' });
    const start = `${FRIDAY}T10:00:00Z`;
    sla.onTransition({ plan, to: 'assigned' }, { when: start });
    const window = store.addWindow({ orgId: 1, tenantId: 7,
      startsAt: `${FRIDAY}T10:00:00Z`, endsAt: `${FRIDAY}T11:00:00Z`, note: 'planned move' });

    sla.tick({ now: minutes(start, 5) });
    assert.equal(clockOf(plan.id, 'acceptance').status, 'paused');
    assert.equal(clockOf(plan.id, 'resolution').status, 'paused', 'a window stops every clock');

    store.deleteWindow(window.id);
    sla.tick({ now: minutes(start, 65) });
    const row = clockOf(plan.id, 'acceptance');
    assert.equal(row.status, 'running');
    assert.equal(row.targetAt, `${FRIDAY}T11:15:00Z`, 'the hour in the window was not counted');
  });
});

describe('a priority change measures the clocks again', () => {
  it('keeps both targets in the plan\'s history', () => {
    const plan = planOf({ status: 'assigned', priority: 'P1' });
    sla.onTransition({ plan, to: 'assigned' }, { when: `${FRIDAY}T10:00:00Z` });
    assert.equal(clockOf(plan.id, 'acceptance').targetAt, `${FRIDAY}T10:15:00Z`);

    store.updatePlan(plan.id, { priority: 'P2' });
    const out = sla.recalculate(plan.id, { actor: { id: 5, username: 'meera' } });

    assert.equal(clockOf(plan.id, 'acceptance').targetAt, `${FRIDAY}T10:30:00Z`, 'P2 has thirty minutes');
    const row = out.changed.find((c) => c.clock === 'acceptance');
    assert.equal(row.was, `${FRIDAY}T10:15:00Z`);
    assert.equal(row.now, `${FRIDAY}T10:30:00Z`);

    const events = store.eventsOf(plan.id).filter((e) => e.action === 'sla.retarget');
    assert.equal(events.length, 2, 'both clocks were measured again');
    assert.equal(events[0].payload.detail.was, `${FRIDAY}T10:15:00Z`);
    assert.equal(events[0].payload.detail.now, `${FRIDAY}T10:30:00Z`);
  });
});

describe('the shapes the settings screen writes', () => {
  it('reads a target written as whole minutes, keeping the calendar of that clock', () => {
    store.setSetting(1, 'sla_targets', { P1: { acceptance: 45, investigation: 60,
      resolution: 180, approval: 45 } });
    const plan = planOf({ status: 'assigned', priority: 'P1' });
    sla.onTransition({ plan, to: 'assigned' }, { when: `${FRIDAY}T10:00:00Z` });
    assert.equal(clockOf(plan.id, 'acceptance').targetAt, `${FRIDAY}T10:45:00Z`);
    store.setSetting(1, 'sla_targets', null);
  });

  it('reads warn, breach and escalate from the escalation setting', () => {
    store.setSetting(1, 'escalation', { warnAt: 50, breachAt: 100, escalateAt: 200 });
    const th = sla.thresholdsFor(1);
    assert.deepEqual(th, { warn: 50, breach: 100, escalate: 200 });
    store.setSetting(1, 'escalation', null);
    assert.deepEqual(sla.thresholdsFor(1), { warn: 80, breach: 100, escalate: 120 });
  });

  it('takes Sunday as 7 as well as 0', () => {
    store.setSetting(1, 'calendar', { days: [1, 2, 3, 4, 5, 6, 7], start: '09:00', end: '18:00',
      timezone: 'UTC', holidays: [] });
    const cal = sla.calendarFor(1, 7);
    assert.deepEqual(cal.days.sort(), [0, 1, 2, 3, 4, 5, 6]);
    // With Saturday open, an hour left at 17:30 on Friday is done on Saturday.
    assert.equal(sla.addBusinessMinutes(`${FRIDAY}T17:30:00Z`, 60, cal), '2026-09-19T09:30:00Z');
    store.setSetting(1, 'calendar', null);
  });

  it('says which of the five words each clock and each plan is in', () => {
    const plan = planOf({ status: 'assigned' });
    const start = `${FRIDAY}T10:00:00Z`;
    sla.onTransition({ plan, to: 'assigned' }, { when: start });
    assert.equal(sla.of(plan.id).state, 'on_track');

    sla.tick({ now: minutes(start, 13) });
    assert.equal(sla.of(plan.id).state, 'at_risk');
    assert.equal(sla.stateOf(clockOf(plan.id, 'acceptance')), 'at_risk');
    assert.equal(sla.stateOf(clockOf(plan.id, 'resolution')), 'on_track');

    sla.tick({ now: minutes(start, 16) });
    assert.equal(sla.of(plan.id).state, 'breached', 'the worst clock names the plan');
    assert.equal(sla.planStateOf(planOf({ status: 'triage' }).id), 'none');
  });
});

describe('what a screen reads', () => {
  it('says how far through each clock is', () => {
    const plan = planOf({ status: 'assigned' });
    const start = `${FRIDAY}T10:00:00Z`;
    sla.onTransition({ plan, to: 'assigned' }, { when: start });
    const out = sla.of(plan.id);
    assert.equal(out.priority, 'P1');
    assert.equal(out.thresholds.warn, 80);
    const acceptance = out.clocks.find((c) => c.clock === 'acceptance');
    assert.equal(acceptance.minutes, 15);
    assert.equal(acceptance.business, false);
    assert.equal(acceptance.marks.warn, `${FRIDAY}T10:12:00Z`);
    assert.equal(acceptance.marks.escalate, `${FRIDAY}T10:18:00Z`);
  });
});
