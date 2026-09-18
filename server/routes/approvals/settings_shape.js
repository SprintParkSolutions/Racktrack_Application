/**
 * The settings, in the shape the Approvals screens read and write.
 *
 * WHY THERE ARE TWO SHAPES. The SLA clocks (lib/approvals/sla.js) and the
 * notifications (lib/approvals/notify.js) read these settings, and they read
 * them in a shape of their own: an SLA target is `{ minutes, business }`
 * because some of the spec's targets are counted in business hours and some in
 * wall-clock hours; the warn, breach and escalate percentages live inside
 * `sla_targets.thresholds` where the clock code reads them; a calendar day is
 * 0 for Sunday, as JavaScript numbers weekdays; and the notification channels
 * are organisation-wide flags with a per-person override.
 *
 * The screens asked for something flatter: plain minutes, days numbered 1 for
 * Monday to 7 for Sunday, the three percentages under `escalation`, and the
 * channels per event. Both are reasonable, and changing the stored shape now
 * would quietly stop two working modules - sla.js falls back to its defaults
 * when a target is not `{ minutes }`, and notify.js reads a channel flag that
 * a per-event object does not have, so every notice would go out regardless.
 *
 * So this translates, in one place, on the way out and on the way in, and the
 * stored shape stays the one the modules read. Nothing is lost: what the
 * screens do not send (the business-hours flag on each target, who is told at
 * each escalation step) is carried through from what is already stored.
 */
const service = require('../../lib/approvals/service');

const KEYS = ['sla_targets', 'calendar', 'dual_approval_risks', 'escalation', 'notification_prefs'];
const PRIORITIES = ['P1', 'P2', 'P3', 'P4'];
const CLOCKS = ['acceptance', 'investigation', 'resolution', 'approval'];
const RISKS = ['low', 'medium', 'high', 'critical'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The events a person may turn a channel off for: the ones the server emits. */
function eventsOf() {
  try {
    const bus = require('../../lib/approvals/bus');
    return (bus.EVENTS || []).filter((e) => e !== 'transition');
  } catch { return []; }
}
/** Three notices go out whatever anybody set: somebody has to know. */
const ALWAYS = ['write_failed', 'sla_breach', 'sla_escalate'];

// -- Out ----------------------------------------------------------------
/** Monday is 1 and Sunday is 7 on the wire; Sunday is 0 in the stored value. */
const dayOut = (d) => (Number(d) === 0 ? 7 : Number(d));
const dayIn = (d) => Number(d) % 7;

const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** Every key, in the screens' shape, filled from what is stored or the defaults. */
function toApi(settings) {
  const s = settings || {};
  const targets = s.sla_targets || {};
  const cal = s.calendar || {};
  const prefs = s.notification_prefs || {};
  const th = targets.thresholds || {};
  const out = {};

  out.sla_targets = Object.fromEntries(PRIORITIES.map((p) => [p,
    Object.fromEntries(CLOCKS.map((c) => {
      const t = (targets[p] || {})[c];
      return [c, Number.isFinite(t) ? t : Number((t && t.minutes) || 0)];
    }))]));

  out.calendar = {
    days: (cal.days || []).map(dayOut).sort((a, b) => a - b),
    start: cal.start || '09:00',
    end: cal.end || '18:00',
    holidays: cal.holidays || [],
  };

  out.dual_approval_risks = Array.isArray(s.dual_approval_risks) ? s.dual_approval_risks : ['critical'];

  out.escalation = {
    warnAt: Number.isFinite(th.warn) ? th.warn : 80,
    breachAt: Number.isFinite(th.breach) ? th.breach : 100,
    escalateAt: Number.isFinite(th.escalate) ? th.escalate : 120,
    // Who each step reaches. The screens do not set this yet; it is shown so
    // nothing about the stored settings is hidden from the person reading them.
    recipients: { warn: s.escalation?.warn || [], breach: s.escalation?.breach || [],
                  escalate: s.escalation?.escalate || [] },
  };

  const byEvent = isObj(prefs.events) ? prefs.events : {};
  out.notification_prefs = Object.fromEntries(eventsOf().map((e) => {
    const own = isObj(byEvent[e]) ? byEvent[e] : {};
    const always = ALWAYS.includes(e);
    return [e, {
      inapp: always || own.inapp !== false && prefs.inapp !== false,
      email: always || own.email !== false && prefs.email !== false,
      // Said plainly, so a screen can grey the switch rather than let somebody
      // turn off a notice that will go out anyway.
      always,
    }];
  }));
  return out;
}

// -- In -----------------------------------------------------------------
/**
 * One key, from the screens' shape to the stored one. Answers
 * `{ writes: [{ key, value }] }` or `{ error }` with a plain sentence, and
 * never a half-translated value.
 */
function fromApi(key, value, current = {}) {
  const stored = current || {};
  if (key === 'sla_targets') {
    if (!isObj(value)) return { error: 'sla_targets is an object of P1 to P4' };
    const was = stored.sla_targets || {};
    const next = { thresholds: was.thresholds || { warn: 80, breach: 100, escalate: 120 } };
    for (const p of PRIORITIES) {
      const row = value[p];
      if (!isObj(row)) return { error: `sla_targets.${p} needs ${CLOCKS.join(', ')}` };
      next[p] = {};
      for (const c of CLOCKS) {
        const minutes = row[c];
        if (!Number.isInteger(minutes) || minutes <= 0) {
          return { error: `sla_targets.${p}.${c} is a whole number of minutes, above zero` };
        }
        // The business-hours flag is the clock code's, not the screen's: a
        // target counted in working hours keeps being counted that way.
        next[p][c] = { minutes, business: Boolean(((was[p] || {})[c] || {}).business) };
      }
    }
    return { writes: [{ key: 'sla_targets', value: next }] };
  }

  if (key === 'calendar') {
    if (!isObj(value)) return { error: 'calendar is an object' };
    const days = value.days;
    if (!Array.isArray(days) || !days.length
        || days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
      return { error: 'calendar.days is a list of weekdays, 1 for Monday to 7 for Sunday' };
    }
    if (!HHMM.test(value.start || '') || !HHMM.test(value.end || '')) {
      return { error: 'calendar.start and calendar.end are times as HH:MM' };
    }
    if (value.start >= value.end) return { error: 'calendar.start comes before calendar.end' };
    const holidays = value.holidays == null ? [] : value.holidays;
    if (!Array.isArray(holidays) || holidays.some((d) => !DATE.test(String(d)))) {
      return { error: 'calendar.holidays is a list of dates as YYYY-MM-DD' };
    }
    return { writes: [{ key: 'calendar', value: {
      days: [...new Set(days.map(dayIn))].sort((a, b) => a - b),
      start: value.start, end: value.end, holidays,
      // The datacentre's own time zone, read from the Site. Never set here.
      timezone: null,
    } }] };
  }

  if (key === 'dual_approval_risks') {
    if (!Array.isArray(value) || value.some((r) => !RISKS.includes(r))) {
      return { error: `dual_approval_risks is a list from ${RISKS.join(', ')}` };
    }
    return { writes: [{ key: 'dual_approval_risks', value }] };
  }

  if (key === 'escalation') {
    if (!isObj(value)) return { error: 'escalation is an object' };
    const { warnAt, breachAt, escalateAt } = value;
    if (![warnAt, breachAt, escalateAt].every((n) => Number.isInteger(n) && n > 0)) {
      return { error: 'escalation.warnAt, breachAt and escalateAt are whole percentages above zero' };
    }
    if (!(warnAt < breachAt && breachAt < escalateAt)) {
      return { error: 'escalation percentages rise: warnAt below breachAt below escalateAt' };
    }
    const targets = { ...(stored.sla_targets || {}),
      thresholds: { warn: warnAt, breach: breachAt, escalate: escalateAt } };
    const writes = [{ key: 'sla_targets', value: targets }];
    // Who each step reaches, when the screen sends it; otherwise what is set stays.
    if (isObj(value.recipients)) {
      writes.push({ key: 'escalation', value: {
        ...(stored.escalation || {}),
        ...Object.fromEntries(['warn', 'breach', 'escalate']
          .filter((step) => Array.isArray(value.recipients[step]))
          .map((step) => [step, value.recipients[step]])),
      } });
    }
    return { writes };
  }

  if (key === 'notification_prefs') {
    if (!isObj(value)) return { error: 'notification_prefs is an object of event to { inapp, email }' };
    const known = new Set(eventsOf());
    const events = {};
    for (const [event, channels] of Object.entries(value)) {
      if (!known.has(event)) return { error: `there is no notification called '${event}'` };
      if (!isObj(channels) || ['inapp', 'email'].some((c) => channels[c] !== undefined && typeof channels[c] !== 'boolean')) {
        return { error: `notification_prefs.${event} is { inapp, email } as true or false` };
      }
      events[event] = { inapp: channels.inapp !== false, email: channels.email !== false };
    }
    // The organisation-wide flags stay on: in-app and email are mandatory
    // channels, and the per-event choices sit under them.
    return { writes: [{ key: 'notification_prefs', value: {
      ...(stored.notification_prefs || {}), inapp: true, email: true,
      teams: Boolean((stored.notification_prefs || {}).teams), events,
    } }] };
  }
  return { error: `unknown setting; the keys are ${KEYS.join(', ')}` };
}

/** Read every key, in the screens' shape. */
const read = (orgId) => {
  const { settings, meta } = service.getSettings(orgId);
  return { settings: toApi(settings), meta, keys: KEYS };
};

module.exports = { KEYS, PRIORITIES, CLOCKS, RISKS, ALWAYS, eventsOf, toApi, fromApi, read };
