/**
 * The assignment email must not undo what happened while it was being sent.
 *
 * Assigning a rack emails the person it went to. The send finishes whenever the
 * mail server answers - after the request has returned, and possibly after
 * somebody has already acted on the ticket. When it finished, it saved the copy
 * of the plan it had been handed at assignment time, which put everything back
 * as it was then.
 *
 * Seen on the demo, twice: on plans 115 and 126 the rack was assigned and every
 * ticket resolved straight away, and the first ticket was open again a moment
 * later, so the plan never left "assigned". It looked as if one ticket always
 * needed resolving twice. It was the email landing on top of the resolution.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-assign-email';
process.env.RACKTRACK_SKIP_WORKER_POOL = '1';
process.env.RT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-assign-email-'));

// The mail transport, held open until the test lets it answer. It has to be in
// place before the route loads, which takes sendNotice off auth at require time.
const auth = require('../../auth');
let release;
auth.sendNotice = () => new Promise((resolve) => { release = resolve; });

const plans = require('../../lib/netbox/plans');
const { notifyAssignee } = require('../../routes/netbox/plans')._internal;

const RACK = 'RK-MAILRACE1';
const UID = `dev:${RACK}:u13`;
const ADMIN = 'admin';

function planWithATicket() {
  const plan = plans.create({
    rackId: RACK, rackUid: `rack:${RACK}`, by: ADMIN,
    report: {
      rackUid: `rack:${RACK}`, counts: { update: 1 }, warnings: [], orphans: [],
      changes: [{ type: 'Device', uid: UID, name: 'Router U20', action: 'update', netboxId: 5,
        diff: { position: { from: 13, to: 20 } } }],
    },
  });
  const out = plans.decide(plan.id, [{ uid: UID, decision: 'ticketed', assignee: 'Ravi Kumar' }], { by: ADMIN });
  assert.deepEqual(out.refused, [], `the assignment went through: ${JSON.stringify(out.refused)}`);
  return out.plan;
}

const ticketOf = (id) => plans.get(id).items.find((i) => i.uid === UID).ticket;

test('a ticket resolved while the email is in flight stays resolved', async () => {
  const plan = planWithATicket();
  assert.equal(ticketOf(plan.id).status, 'open');

  // The email starts, with the plan as it is now.
  const sending = notifyAssignee(plan, {
    person: { name: 'Ravi Kumar', email: 'ravi.kumar@meridian-dc.example' },
    items: plan.items.filter((i) => i.uid === UID),
    incidents: [], rackName: RACK, siteName: 'Default', by: 'admin',
  });

  // Somebody resolves the ticket before the mail server has answered.
  const done = plans.resolveTicket(plan.id, UID, { by: ADMIN, finding: 'Checked at the rack.', outcome: 'confirmed' });
  assert.ok(!done.error, done.error);
  const resolved = ticketOf(plan.id).status;
  assert.notEqual(resolved, 'open', 'resolving it took');

  // Now the mail server answers.
  release(true);
  await sending;

  const after = ticketOf(plan.id);
  assert.equal(after.status, resolved, 'the email landing did not put the ticket back');
  assert.ok(after.emailedAt, 'and the ticket does say it was emailed');
});

test('an email that could not be sent is noted on the ticket, and still undoes nothing', async () => {
  const plan = planWithATicket();
  const sending = notifyAssignee(plan, {
    person: { name: 'Ravi Kumar', email: 'ravi.kumar@meridian-dc.example' },
    items: plan.items.filter((i) => i.uid === UID),
    incidents: [], rackName: RACK, siteName: 'Default', by: 'admin',
  });
  plans.resolveTicket(plan.id, UID, { by: ADMIN, finding: 'Checked.', outcome: 'confirmed' });
  const resolved = ticketOf(plan.id).status;
  release(false);
  await sending;
  const after = ticketOf(plan.id);
  assert.equal(after.status, resolved);
  assert.equal(after.emailNote, 'no mail transport configured');
});
