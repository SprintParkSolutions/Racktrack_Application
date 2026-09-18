/**
 * One event bus for the approval workflow.
 *
 * service.js emits here AFTER a change has been committed, never before, so a
 * listener never hears about something that was rolled back:
 *
 *   transition   every status change: { plan, from, to, actor, reason, item }
 *
 * and the named events the contract lists, where they happen, each with the
 * same payload plus whatever the event is about:
 *
 *   submitted, assigned, pending, resolved, approval_requested, approved,
 *   rejected, completed, p1_p2_created, write_failed
 *
 * The SLA clocks, the notifications and the reports are listeners. A listener
 * must never break a request: emit() here calls each one on its own, catches
 * what it throws, catches the promise it returns, and logs. The bus has no
 * 'error' event to crash the process with.
 */
const { EventEmitter } = require('events');

function log(event, err) {
  try {
    const { logger } = require('../observability');
    logger.warn({ event: 'approvals.bus.listener_failed', on: event, err: err && err.message },
      'an approvals listener failed');
  } catch {
    console.warn(`[approvals] a listener on '${event}' failed: ${err && err.message}`);
  }
}

class ApprovalBus extends EventEmitter {
  emit(event, ...args) {
    const listeners = this.rawListeners(event);
    for (const fn of listeners) {
      try {
        const out = fn.apply(this, args);
        if (out && typeof out.then === 'function') out.then(null, (err) => log(event, err));
      } catch (err) {
        log(event, err);
      }
    }
    return listeners.length > 0;
  }
}

const bus = new ApprovalBus();
bus.setMaxListeners(50);

/** The named events, so a listener can subscribe without a typo. */
bus.EVENTS = Object.freeze(['transition', 'submitted', 'assigned', 'pending', 'resolved',
  'approval_requested', 'approved', 'rejected', 'completed', 'p1_p2_created', 'write_failed',
  // Emitted by the builders that follow: verification, SLA and notifications.
  'verification_failed', 'sla_warn', 'sla_breach', 'sla_escalate', 'approval_overdue']);

module.exports = bus;
