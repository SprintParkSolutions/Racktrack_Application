/**
 * Asking ServiceNow what happened, every five minutes.
 *
 * ServiceNow owns whether an incident is open or closed. A plan that waits
 * for somebody to open it before it notices would have an SLA clock that
 * lies, and an admin's inbox that is a day behind the people doing the work.
 * So the server asks on its own: every open incident we raised, grouped by
 * the organization whose ServiceNow it lives in, read through
 * lib/netbox/tickets.statusOf, and every closed one applied through
 * service.applyTicketStates - which returns its item to the admin as
 * UNDECIDED, exactly as a person resolving it by hand would.
 *
 * A check that went to its SPOC has one incident of its own, and the same pass
 * covers it through lib/approvals/incidents.js: what ServiceNow says about it
 * is written on the check, an incident somebody closed over there is flagged
 * and never counted as an approval, and whatever RackTrack still owes
 * ServiceNow - a raise, an outcome, an attachment that failed - is tried again.
 *
 * It decides nothing. It never writes to NetBox and never approves anything,
 * and the only state it sets on an incident is one RackTrack's own check
 * already reached and could not push at the time.
 *
 * NOT IN TESTS. A test that boots the app must not reach out to the network
 * five minutes in, and a run that finishes in four seconds would never see
 * it anyway; NODE_ENV=test and RACKTRACK_SKIP_WORKER_POOL=1 (the flag every
 * test file already sets) both turn it off. The timer is unref'd, so it
 * never holds the process open by itself.
 */
const EVERY_MS = 5 * 60 * 1000;

let timer = null;
let running = false;
let last = null;

const off = () => process.env.NODE_ENV === 'test'
  || process.env.RACKTRACK_SKIP_WORKER_POOL === '1'
  || process.env.RACKTRACK_SKIP_SERVICENOW_POLL === '1';

/** One pass. Never throws: a ServiceNow that is down is not our outage. */
async function tick() {
  if (running) return last;                 // a slow pass is not overlapped
  running = true;
  try {
    const service = require('./service');
    last = { at: new Date().toISOString(), ...(await service.syncServiceNow()) };
    if (last.changed || last.retried) {
      try {
        require('../observability').logger.info(
          { event: 'approvals.servicenow.sync', ...last },
          `approvals: ${last.changed} drift ticket${last.changed === 1 ? '' : 's'} heard back from ServiceNow, `
            + `${last.retried || 0} call${last.retried === 1 ? '' : 's'} to it tried again`);
      } catch { /* the log is not the point of the pass */ }
    }
    return last;
  } catch (err) {
    last = { at: new Date().toISOString(), error: String(err && err.message) };
    return last;
  } finally {
    running = false;
  }
}

/** Start the timer. Returns it, or null when this process does not poll. */
function start({ everyMs = EVERY_MS } = {}) {
  if (timer || off()) return null;
  timer = setInterval(() => { tick(); }, everyMs);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, tick, EVERY_MS, isRunning: () => Boolean(timer), lastPass: () => last };
