/**
 * The four clocks on a plan, and what they do when they run out.
 *
 *   acceptance      handed out -> somebody has taken it
 *   investigation   taken -> somebody has actually started on it
 *   resolution      handed out -> every ticket answered
 *   approval        put up for approval -> approved, rejected or sent back
 *
 * Every clock is started and stopped by a status change on the bus, so there
 * is nothing for a route to remember to call. The targets come from the
 * organization's `sla_targets` setting, and from spec table 7 where it has
 * none: P1 15 minutes to accept, P2 30, P3 four hours, P4 eight. Warn at 80
 * percent of the target, breach at 100, escalate at 120.
 *
 * BUSINESS HOURS. Some targets count only working time (P3's two days, P4's
 * five). Working time is Monday to Friday, 09:00 to 18:00, in the datacentre's
 * own time zone - tenants.timezone, which is the whole point of storing it -
 * unless the organization's `calendar` setting says otherwise. A P4 raised at
 * 17:00 on Friday is not late at 09:05 on Monday.
 *
 * PAUSES. A plan that is `pending` is waiting on somebody outside RackTrack,
 * so its resolution clock pauses (decision 4 of the contract: the resolution
 * clock only). A plan inside a maintenance window pauses every clock: nobody
 * is late for a change everyone agreed to. A pause moves the target out by
 * exactly what it cost, measured in the clock's own units - so `paused_ms` on
 * a business clock holds working milliseconds, not wall-clock ones, and a
 * pause over a weekend hands nobody an extra weekend.
 *
 * THE ARITHMETIC IS PURE. addBusinessMinutes, businessMinutesBetween, marksFor
 * and progressOf take a time and answer a time. They touch no database and
 * read no wall clock, so a test can drive a week of SLA in a millisecond.
 * `tick()` is the only part that looks at the clock, and a timer calls it once
 * a minute (never under NODE_ENV=test or RACKTRACK_SKIP_WORKER_POOL=1).
 */
const store = require('./store');
const bus = require('./bus');
const exceptions = require('./exceptions');

const CLOCKS = ['acceptance', 'investigation', 'resolution', 'approval'];
const MINUTE = 60000;
const DAY_MS = 86400000;

/**
 * Which status starts a clock, and which statuses stop it, met.
 *
 * A check that is with its SPOC is decided straight from assigned, so the
 * SPOC's outcome - approved, rejected, sent back, or the first of two
 * signatures - is what meets acceptance, investigation and resolution there.
 * The approval clock runs only while a check waits for a second signature.
 */
const OUTCOMES = ['approval_pending', 'approved', 'rejected', 'rework'];
const STARTS = {
  acceptance: ['assigned'],
  investigation: ['accepted'],
  resolution: ['assigned'],
  approval: ['approval_pending'],
};
const MEETS = {
  acceptance: ['accepted', 'in_progress', 'pending', 'resolved', 'verification_pending', ...OUTCOMES],
  investigation: ['in_progress', 'resolved', 'verification_pending', ...OUTCOMES],
  resolution: ['resolved', 'verification_pending', ...OUTCOMES],
  approval: ['approved', 'rejected', 'rework'],
};
/** Nothing is owed on a plan that is over: whatever is still running is dropped. */
const CLOSED = ['completed', 'cancelled', 'duplicate', 'known_exception', 'rejected'];

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');
const at = (v) => (typeof v === 'number' ? v : Date.parse(v));
const pad = (n) => String(n).padStart(2, '0');

// -- Time in a place ------------------------------------------------------
const FORMATTERS = new Map();
function formatter(tz) {
  let f = FORMATTERS.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      // An unknown zone is a setting somebody typed. UTC is wrong by hours,
      // never by days, and it never throws inside a clock tick.
      f = formatter('UTC');
    }
    FORMATTERS.set(tz, f);
  }
  return f;
}

/** The wall-clock fields of an instant, in one time zone. */
function wallOf(when, tz) {
  const out = {};
  for (const p of formatter(tz).formatToParts(new Date(when))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  if (out.hour === 24) out.hour = 0;
  return out;
}

/** How far that zone is ahead of UTC at that instant, in ms. */
function offsetOf(when, tz) {
  const w = wallOf(when, tz);
  const whole = Math.floor(when / 1000) * 1000;
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - whole;
}

/** The instant a wall-clock time in that zone stands for. */
function instantOf({ year, month, day, hour = 0, minute = 0 }, tz) {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  let guess = naive;
  for (let i = 0; i < 2; i += 1) guess = naive - offsetOf(guess, tz);
  return guess;
}

const dateOf = (when, tz) => { const w = wallOf(when, tz); return { year: w.year, month: w.month, day: w.day }; };
const addDays = (d, n) => {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + n));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
};
const weekdayOf = (d) => new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
const stampOf = (d) => `${d.year}-${pad(d.month)}-${pad(d.day)}`;

/** The calendar in force: the organization's setting, over the contract's default. */
function calendarFor(orgId, tenantId = null) {
  const defaults = require('./service').DEFAULT_SETTINGS.calendar;
  const saved = orgId != null ? store.getSetting(orgId, 'calendar') : undefined;
  const cal = saved && typeof saved === 'object' ? { ...defaults, ...saved } : { ...defaults };
  if (!cal.timezone && tenantId != null) {
    const tenant = store.tenantById(tenantId);
    if (tenant && tenant.timezone) cal.timezone = tenant.timezone;
  }
  // Weekdays arrive either as JavaScript numbers (0 is Sunday) or as the ISO
  // ones the settings screen uses (1 is Monday, 7 is Sunday). Monday to Friday
  // is [1, 2, 3, 4, 5] in both, and 7 is the only number that has to move.
  const days = (Array.isArray(cal.days) && cal.days.length ? cal.days : [1, 2, 3, 4, 5])
    .map((d) => (Number(d) === 7 ? 0 : Number(d)));
  return { days, start: cal.start || '09:00', end: cal.end || '18:00',
    timezone: cal.timezone || 'UTC', holidays: cal.holidays || [] };
}

/** The working window of one calendar day, or null when it is not a working day. */
function windowOfDay(d, cal) {
  if (!cal.days.includes(weekdayOf(d))) return null;
  if ((cal.holidays || []).includes(stampOf(d))) return null;
  const [sh, sm] = String(cal.start).split(':').map(Number);
  const [eh, em] = String(cal.end).split(':').map(Number);
  const from = instantOf({ ...d, hour: sh, minute: sm }, cal.timezone);
  const to = instantOf({ ...d, hour: eh, minute: em }, cal.timezone);
  return to > from ? { from, to } : null;
}

/**
 * `minutes` of working time after `start`. Pure.
 *
 * A start outside working hours counts from the next time the door opens, so
 * thirty business minutes from 22:00 on Friday is 09:30 on Monday.
 */
function addBusinessMinutes(start, minutes, cal) {
  const from = at(start);
  let left = Math.max(0, Number(minutes) || 0) * MINUTE;
  let cursor = from;
  let day = dateOf(from, cal.timezone);
  for (let guard = 0; guard < 1500; guard += 1) {
    const w = windowOfDay(day, cal);
    if (w) {
      const begin = Math.max(cursor, w.from);
      if (begin < w.to) {
        const available = w.to - begin;
        if (left <= available) return iso(begin + left);
        left -= available;
      }
    }
    day = addDays(day, 1);
    cursor = 0;
  }
  // Four years of calendar with nothing left to give: the calendar is empty.
  return iso(from + Math.max(0, Number(minutes) || 0) * MINUTE);
}

/** How many working minutes lie between two instants. Pure. */
function businessMinutesBetween(from, to, cal) {
  const a = at(from);
  const b = at(to);
  if (!(b > a)) return 0;
  let total = 0;
  let day = dateOf(a, cal.timezone);
  for (let guard = 0; guard < 1500; guard += 1) {
    const w = windowOfDay(day, cal);
    if (w) {
      const begin = Math.max(a, w.from);
      const end = Math.min(b, w.to);
      if (end > begin) total += end - begin;
    }
    const next = addDays(day, 1);
    if (instantOf(next, cal.timezone) > b + DAY_MS) break;
    day = next;
  }
  return total / MINUTE;
}

// -- Targets --------------------------------------------------------------
/** The organization's SLA targets, over the contract's defaults. */
function targetsFor(orgId) {
  const defaults = require('./service').DEFAULT_SETTINGS.sla_targets;
  const saved = orgId != null ? store.getSetting(orgId, 'sla_targets') : undefined;
  return saved && typeof saved === 'object' ? { ...defaults, ...saved } : defaults;
}

/**
 * { minutes, business } for one clock at one priority.
 *
 * A target is written either as whole minutes - which is what the settings
 * screen sends - or as { minutes, business }. A bare number keeps whichever
 * calendar spec table 7 gives that clock, so "two business days" stays two
 * business days when somebody edits the number of minutes in it.
 */
function targetFor(priority, clock, targets) {
  const defaults = require('./service').DEFAULT_SETTINGS.sla_targets;
  const fallback = (defaults[priority] || defaults.P3)[clock];
  const t = ((targets && targets[priority]) || {})[clock];
  if (Number.isFinite(Number(t)) && t !== null && typeof t !== 'object') {
    return { minutes: Number(t), business: Boolean(fallback && fallback.business) };
  }
  if (t && Number.isFinite(t.minutes)) return { minutes: t.minutes, business: Boolean(t.business) };
  return { minutes: fallback.minutes, business: Boolean(fallback.business) };
}

/**
 * Warn, breach and escalate, as percentages of the target.
 *
 * The `escalation` setting names them warnAt, breachAt and escalateAt; older
 * rows carry them inside sla_targets as thresholds. Both are read, the
 * escalation setting first, and the contract's 80, 100 and 120 underneath.
 */
const thresholdsOf = (targets, escalation) => {
  const e = escalation || {};
  const th = (targets && targets.thresholds) || {};
  const pick = (...candidates) => {
    for (const v of candidates) if (Number.isFinite(Number(v)) && Number(v) > 0) return Number(v);
    return null;
  };
  return {
    warn: pick(e.warnAt, e.warn, th.warn) || 80,
    breach: pick(e.breachAt, e.breach, th.breach) || 100,
    escalate: pick(e.escalateAt, e.escalate, th.escalate) || 120,
  };
};

/** The thresholds in force for one organization. */
function thresholdsFor(orgId) {
  const saved = orgId != null ? store.getSetting(orgId, 'escalation') : undefined;
  // The escalation setting also carries who is told at each step, which is
  // notify.js's business; only the three percentages are read here.
  return thresholdsOf(targetsFor(orgId), saved && typeof saved === 'object' ? saved : null);
}

/**
 * The five words a screen uses for a clock, and for a plan.
 *
 *   on_track   running, and not near its target yet
 *   at_risk    running, and past the warn mark
 *   breached   past its target
 *   paused     on hold, or inside a change window
 *   none       (a plan) nothing is being timed
 *
 * `met` and `cancelled` are clocks that have stopped: they are not one of the
 * five, because a plan is not "on track" because of a clock that is over.
 */
const STATES = ['on_track', 'at_risk', 'breached', 'paused', 'none'];
const LIVE_STATES = ['breached', 'at_risk', 'paused', 'on_track'];

function stateOf(row) {
  if (!row) return null;
  if (row.status === 'breached') return 'breached';
  if (row.status === 'paused') return 'paused';
  if (row.status === 'running') return row.warnedAt ? 'at_risk' : 'on_track';
  return row.status;
}

/** One word for a whole plan: the worst of its live clocks, or `none`. */
function planStateOf(planId, rows = null) {
  const live = (rows || store.slaOf(planId)).map(stateOf).filter((s) => LIVE_STATES.includes(s));
  if (!live.length) return 'none';
  return LIVE_STATES.find((word) => live.includes(word));
}

/** The pause allowance a row carries, in the clock's own minutes. */
const allowanceOf = (row) => (Number(row.pausedMs) || 0) / MINUTE;

/** Where a target lands: `minutes` of the clock's own time after the start. */
const dueAt = (start, minutes, target, cal) => (target.business
  ? addBusinessMinutes(start, minutes, cal)
  : iso(at(start) + minutes * MINUTE));

/**
 * When a clock is due, 80 percent through, and 120 percent through. Pure.
 *
 * The pause allowance moves all three out together, so a clock held for an
 * hour is warned an hour later and breached an hour later, never one without
 * the other.
 */
function marksFor(row, target, cal, thresholds) {
  const th = thresholds || { warn: 80, breach: 100, escalate: 120 };
  const held = allowanceOf(row);
  const mark = (percent) => dueAt(row.startedAt, (target.minutes * percent) / 100 + held, target, cal);
  return { warn: mark(th.warn), breach: row.targetAt || mark(th.breach), escalate: mark(th.escalate) };
}

/** How far through a clock is, 0 to over 100. Pure. */
function progressOf(row, target, cal, now = Date.now()) {
  if (!target.minutes) return 0;
  const start = at(row.startedAt);
  const until = row.pausedSince ? at(row.pausedSince) : at(now);
  const spent = target.business
    ? businessMinutesBetween(start, Math.max(start, until), cal)
    : Math.max(0, until - start) / MINUTE;
  return Math.round(((spent - allowanceOf(row)) / target.minutes) * 100);
}

// -- The rows -------------------------------------------------------------
/** The clock of this kind that is live on this plan, or null. */
const currentOf = (planId, clock) => store.slaOf(planId)
  .filter((c) => c.clock === clock).reverse()
  .find((c) => ['running', 'paused', 'breached'].includes(c.status)) || null;

const targetPair = (plan, clock) => ({
  target: targetFor(plan.priority, clock, targetsFor(plan.orgId)),
  cal: calendarFor(plan.orgId, plan.tenantId),
});

/** What a pause that is still open has cost so far, in the clock's own ms. */
function heldSoFar(row, plan, when) {
  if (!row.pausedSince) return Number(row.pausedMs) || 0;
  const { target, cal } = targetPair(plan, row.clock);
  const cost = target.business
    ? businessMinutesBetween(row.pausedSince, when, cal) * MINUTE
    : Math.max(0, at(when) - at(row.pausedSince));
  return (Number(row.pausedMs) || 0) + cost;
}

/** Start a clock, unless one of that kind is already live on the plan. */
function startClock(plan, clock, { when = store.nowIso() } = {}) {
  if (currentOf(plan.id, clock)) return null;
  const { target, cal } = targetPair(plan, clock);
  const targetAt = dueAt(when, target.minutes, target, cal);
  const row = store.addSla(plan.id, { clock, startedAt: when, targetAt, status: 'running' });
  store.addEvent(plan.id, { action: 'sla.start', actorName: 'system',
    fromStatus: plan.status, toStatus: plan.status,
    payload: { what: 'clock started', detail: { clock, targetAt, minutes: target.minutes,
      business: target.business, priority: plan.priority } } });
  return row;
}

/** Stop a clock because the thing it measures has happened. */
function meetClock(plan, clock, { when = store.nowIso() } = {}) {
  const row = currentOf(plan.id, clock);
  if (!row) return null;
  const out = store.updateSla(row.id, { status: 'met', metAt: when,
    pausedSince: null, pausedMs: heldSoFar(row, plan, when) });
  store.addEvent(plan.id, { action: 'sla.met', actorName: 'system',
    fromStatus: plan.status, toStatus: plan.status,
    payload: { what: 'clock met', detail: { clock, at: when, targetAt: row.targetAt,
      late: Boolean(row.targetAt && when > row.targetAt) } } });
  return out;
}

/** Drop every clock still live: the plan is over. */
function cancelClocks(plan, { when = store.nowIso(), except = [] } = {}) {
  const out = [];
  for (const row of store.slaOf(plan.id)) {
    if (!['running', 'paused', 'breached'].includes(row.status) || except.includes(row.clock)) continue;
    out.push(store.updateSla(row.id, { status: 'cancelled', pausedSince: null,
      pausedMs: heldSoFar(row, plan, when) }));
  }
  return out;
}

/** Hold a clock. Its target moves out when it starts again, not now. */
function pauseClock(plan, row, { when = store.nowIso(), why = null } = {}) {
  if (!row || row.status !== 'running') return row;
  const out = store.updateSla(row.id, { status: 'paused', pausedSince: when });
  store.addEvent(plan.id, { action: 'sla.pause', actorName: 'system',
    fromStatus: plan.status, toStatus: plan.status, reason: why,
    payload: { what: 'clock paused', detail: { clock: row.clock, at: when, why } } });
  return out;
}

/** Start a held clock again, and move its target out by what the pause cost. */
function resumeClock(plan, row, { when = store.nowIso() } = {}) {
  if (!row || row.status !== 'paused' || !row.pausedSince) return row;
  const { target, cal } = targetPair(plan, row.clock);
  const held = heldSoFar(row, plan, when);
  const cost = (held - (Number(row.pausedMs) || 0)) / MINUTE;
  const targetAt = row.targetAt ? dueAt(row.targetAt, cost, target, cal) : row.targetAt;
  const out = store.updateSla(row.id, { status: 'running', pausedSince: null,
    pausedMs: held, targetAt });
  store.addEvent(plan.id, { action: 'sla.resume', actorName: 'system',
    fromStatus: plan.status, toStatus: plan.status,
    payload: { what: 'clock started again', detail: { clock: row.clock, at: when, targetAt,
      heldMinutes: Math.round(cost) } } });
  return out;
}

/**
 * The plan's priority changed, so every live clock is measured again.
 *
 * Both targets stay in the history: the event row names the one that was in
 * force and the one that replaces it, so a plan raised to P1 halfway through
 * can still be read honestly afterwards. The pause allowance is kept, so a
 * clock that was held for an hour is still an hour longer.
 */
function recalculate(planId, { actor = null } = {}) {
  const plan = store.getPlan(planId, { heavy: false });
  if (!plan) return { plan: null, changed: [] };
  const changed = [];
  for (const row of store.slaOf(plan.id)) {
    if (!['running', 'paused', 'breached'].includes(row.status)) continue;
    const { target, cal } = targetPair(plan, row.clock);
    const targetAt = dueAt(row.startedAt, target.minutes + allowanceOf(row), target, cal);
    if (targetAt === row.targetAt) continue;
    // Sent out again: a target that has moved has not been warned about yet.
    store.updateSla(row.id, { targetAt, warnedAt: null, breachedAt: null, escalatedAt: null,
      status: row.status === 'breached' ? 'running' : row.status });
    store.addEvent(plan.id, { action: 'sla.retarget',
      actorId: (actor && actor.id) ?? null, actorName: (actor && actor.username) || 'system',
      fromStatus: plan.status, toStatus: plan.status,
      payload: { what: 'clock measured again', detail: { clock: row.clock, priority: plan.priority,
        was: row.targetAt, now: targetAt, minutes: target.minutes, business: target.business } } });
    changed.push({ clock: row.clock, was: row.targetAt, now: targetAt });
  }
  return { plan, changed };
}

// -- What a status change does --------------------------------------------
/**
 * One status change, applied to the plan's clocks. Called from the bus, and
 * safe to call again: starting a clock that runs, or meeting one that is
 * already met, does nothing.
 */
function onTransition({ plan, to }, { when = store.nowIso() } = {}) {
  if (!plan || !to) return;
  store.tx(() => {
    for (const clock of CLOCKS) {
      if ((MEETS[clock] || []).includes(to)) meetClock(plan, clock, { when });
    }
    for (const clock of CLOCKS) {
      if ((STARTS[clock] || []).includes(to)) startClock(plan, clock, { when });
    }
    // Decision 4 of the contract: `pending` pauses the resolution clock only.
    const resolution = currentOf(plan.id, 'resolution');
    if (resolution) {
      if (to === 'pending') pauseClock(plan, resolution, { when, why: 'the plan is on hold' });
      else if (resolution.status === 'paused' && !exceptions.inWindow(plan, when)) {
        resumeClock(plan, resolution, { when });
      }
    }
    if (CLOSED.includes(to)) cancelClocks(plan, { when });
  });
}

// -- The tick -------------------------------------------------------------
/**
 * Every live clock, looked at once.
 *
 * Pauses and resumes for a maintenance window (which is a span of time, not an
 * event, so only a tick can notice it), re-measures a clock whose plan has
 * changed priority, and emits sla_warn at 80 percent, sla_breach at 100 and
 * sla_escalate at 120 - each one once, recorded on the row, so a restart of
 * the server does not send them all again.
 */
function tick({ now = store.nowIso() } = {}) {
  const when = typeof now === 'number' ? iso(now) : now;
  // A breached clock is looked at too: 120 percent has still to be reached,
  // and the status is what the dashboard counts, so it cannot be left running.
  const rows = [...store.slaByStatus('running'), ...store.slaByStatus('paused'),
    ...store.slaByStatus('breached')];
  const plans = new Map();
  const fired = [];
  for (const row of rows) {
    if (!plans.has(row.planId)) plans.set(row.planId, store.getPlan(row.planId, { heavy: false }));
    const plan = plans.get(row.planId);
    if (!plan) continue;
    const { target, cal } = targetPair(plan, row.clock);

    // A change window opened or closed under this clock.
    const inside = exceptions.inWindow(plan, when);
    const onHold = row.clock === 'resolution' && plan.status === 'pending';
    if ((inside || onHold) && row.status === 'running') {
      pauseClock(plan, row, { when, why: inside ? 'inside a change window' : 'the plan is on hold' });
      continue;
    }
    let live = row;
    if (!inside && !onHold && row.status === 'paused') live = resumeClock(plan, row, { when });
    if (!['running', 'breached'].includes(live.status)) continue;

    const marks = marksFor(live, target, cal, thresholdsFor(plan.orgId));
    const percent = progressOf(live, target, cal, Date.parse(when));
    const heard = { plan, clock: live.clock, targetAt: live.targetAt, percent, at: when };
    if (!live.escalatedAt && when >= marks.escalate) {
      store.updateSla(live.id, { escalatedAt: when, status: 'breached',
        breachedAt: live.breachedAt || when });
      bus.emit('sla_escalate', heard);
      if (live.clock === 'approval') bus.emit('approval_overdue', heard);
      fired.push({ event: 'sla_escalate', planId: plan.id, clock: live.clock });
    } else if (!live.breachedAt && when >= marks.breach) {
      store.updateSla(live.id, { breachedAt: when, status: 'breached' });
      bus.emit('sla_breach', heard);
      if (live.clock === 'approval') bus.emit('approval_overdue', heard);
      fired.push({ event: 'sla_breach', planId: plan.id, clock: live.clock });
    } else if (!live.warnedAt && when >= marks.warn) {
      store.updateSla(live.id, { warnedAt: when });
      bus.emit('sla_warn', heard);
      fired.push({ event: 'sla_warn', planId: plan.id, clock: live.clock });
    }
  }
  return { looked: rows.length, fired };
}

/** What a screen reads: every clock of a plan with where it stands now. */
function of(planId) {
  const plan = store.getPlan(planId, { heavy: false });
  if (!plan) return { planId: null, clocks: [] };
  const cal = calendarFor(plan.orgId, plan.tenantId);
  const targets = targetsFor(plan.orgId);
  const th = thresholdsFor(plan.orgId);
  const rows = store.slaOf(plan.id);
  return {
    planId: plan.id, priority: plan.priority, calendar: cal, thresholds: th,
    // The one word a screen puts on the plan: the worst of its live clocks.
    state: planStateOf(plan.id, rows),
    clocks: rows.map((row) => {
      const target = targetFor(plan.priority, row.clock, targets);
      return { ...row, minutes: target.minutes, business: target.business,
        state: stateOf(row),
        percent: ['running', 'paused', 'breached'].includes(row.status)
          ? progressOf(row, target, cal) : null,
        marks: marksFor(row, target, cal, th) };
    }),
  };
}

// -- The timer ------------------------------------------------------------
let _timer = null;
let _listening = false;

/** Subscribe to the bus. Idempotent, and safe to call from any route file. */
function listen() {
  if (_listening) return;
  _listening = true;
  bus.on('transition', (payload) => {
    try { onTransition(payload); } catch { /* a listener never breaks a request */ }
  });
}

const skipped = () => process.env.NODE_ENV === 'test' || process.env.RACKTRACK_SKIP_WORKER_POOL === '1';

/** Look at the clocks once a minute. Does nothing under a test run. */
function start({ everyMs = 60000 } = {}) {
  listen();
  if (_timer || skipped()) return _timer;
  _timer = setInterval(() => {
    try { tick(); } catch (err) {
      try {
        require('../observability').logger.warn({ event: 'approvals.sla.tick_failed',
          err: err && err.message }, 'an SLA tick failed');
      } catch { /* logging is not worth a crash either */ }
    }
  }, everyMs);
  if (typeof _timer.unref === 'function') _timer.unref();
  return _timer;
}

function stop() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

module.exports = {
  CLOCKS, STARTS, MEETS, CLOSED, STATES, LIVE_STATES,
  // pure arithmetic
  wallOf, instantOf, windowOfDay, addBusinessMinutes, businessMinutesBetween, dueAt,
  marksFor, progressOf, calendarFor, targetsFor, targetFor, thresholdsOf, thresholdsFor,
  // the five words a screen uses
  stateOf, planStateOf,
  // the rows
  currentOf, startClock, meetClock, pauseClock, resumeClock, cancelClocks, recalculate,
  // the workflow
  onTransition, tick, of, listen, start, stop,
};
