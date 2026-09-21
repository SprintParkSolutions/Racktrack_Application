/**
 * The workflow as a table: who may make each move, and what has to be true
 * first.
 *
 * Pure - no database, no network, no clock - so what is under test here is the
 * rule and not the plumbing. The table is the contract's
 * (docs/design/approvals-api-contract.md) and these tests read it back row by
 * row: every move it names is allowed for the people it names and refused for
 * everybody else, every move it does not name is refused outright, and each
 * guard says what is missing rather than simply saying no.
 */
const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const m = require('../../lib/approvals/machine');

const ORG = 3;
const SITE = 7;
const plan = (over = {}) => ({ id: 1, orgId: ORG, tenantId: SITE, status: 'draft', risk: 'medium',
  priority: 'P3', version: 1, scanId: 12, payloadHash: 'hash', createdBy: 'ravi', createdById: 10,
  ...over });

const who = (role, over = {}) => ({ id: 20, username: `a.${role}`, email: `${role}@example.test`,
  role, orgId: ORG, tenantId: SITE, ...over });
const RAVI = who('member', { id: 10, username: 'ravi' });
const ADMIN = who('org_admin', { id: 21 });
const OWNER = who('owner', { id: 22 });
const MANAGER = who('site_manager', { id: 23 });
const APPROVER = who('approver', { id: 24 });
const AUDITOR = who('auditor', { id: 25 });
const SAM = who('member', { id: 26, username: 'sam', email: 'sam@example.test' });
// The SPOC of the Site: a member like any other, until a check is with them.
const PRIYA = who('member', { id: 29, username: 'priya', email: 'priya@example.test' });
/** A check sent by ravi and now with priya. */
const held = (over = {}) => plan({ status: 'assigned', submittedBy: 'ravi', submittedById: 10,
  spocUserId: 29, ...over });

const item = (over = {}) => ({ uid: 'dev:1', type: 'Device', action: 'create', decidable: true,
  decision: 'pending', supporting: false, following: false, parentUid: null, ...over });
const ticket = (over = {}) => ({ itemUid: 'dev:1', status: 'open', assignee: 'sam',
  assigneeUserId: 26, assigneeEmail: 'sam@example.test', ...over });

const ctx = (over = {}) => ({ items: [item()], tickets: [], decisions: [], settings: {},
  payloadHash: 'hash', toWrite: 1, ...over });

describe('what each action means for the workflow', () => {
  it('reads every trait from one table, so a new action needs no new route', () => {
    assert.deepEqual(Object.keys(m.ACTION_TRAITS).sort(), ['create', 'rebind', 'update']);
    for (const action of ['create', 'update']) {
      assert.equal(m.traitsOf(action).changes, true);
      assert.equal(m.isTicketable(item({ action })), true, `${action} can be checked at the rack`);
      assert.equal(m.needsAssignFirst(item({ action })), true, `${action} waits for a finding`);
    }
    const rebind = item({ action: 'rebind' });
    assert.equal(m.traitsOf('rebind').changes, true, 'a rebind changes NetBox, so it is decided');
    assert.equal(m.isTicketable(rebind), false, 'but there is nothing to check at the rack');
    assert.equal(m.needsAssignFirst(rebind), false, 'so it is decided as it stands');
    assert.match(m.traitsOf('rebind').notTicketable, /nothing to check at the rack/);
    assert.equal(m.traitsOf('rebind').evenWhenSupporting, true,
      'a rebind of the Rack record is still a decision, scaffolding or not');

    const noop = item({ action: 'noop' });
    assert.equal(m.traitsOf('noop').changes, false, 'an action nobody declared changes nothing');
    assert.equal(m.isTicketable(noop), false);
    assert.equal(m.needsAssignFirst(noop), false);
  });
});

describe('the moves the table names, and the ones it does not', () => {
  const ANYBODY = [RAVI, ADMIN, OWNER, MANAGER, APPROVER, AUDITOR, SAM, PRIYA];

  it('refuses a move the table does not have, and says so in words', () => {
    const out = m.can(plan({ status: 'draft' }), 'approved', ADMIN, ctx());
    assert.equal(out.ok, false);
    assert.equal(out.code, 'transition');
    assert.equal(out.why, 'a plan that is draft cannot become approved');
    assert.equal(m.can(null, 'submitted', ADMIN, ctx()).code, 'transition');
    assert.equal(m.can(plan({ status: 'cancelled' }), 'assigned', ADMIN, ctx()).code, 'transition');
    assert.equal(m.can(plan({ status: 'completed' }), 'approved', OWNER, ctx()).code, 'transition');
  });

  it('every status in the contract is in the table', () => {
    assert.equal(m.STATUSES.length, 22);
    for (const s of m.STATUSES) assert.ok(m.TRANSITIONS[s], `${s} has a row`);
    for (const s of m.TERMINAL) assert.deepEqual(m.TRANSITIONS[s], {}, `${s} is a dead end`);
    assert.ok(!m.OPEN.includes('completed') && !m.OPEN.includes('rejected'),
      'a finished plan is not somebody\'s open work');
  });

  /** Who is allowed, and everybody else refused with code 'role'. */
  const only = (from, to, allowed, c = ctx(), over = {}) => {
    const p = plan({ status: from, ...over });
    for (const actor of allowed) {
      const out = m.can(p, to, actor, c);
      assert.notEqual(out.code, 'role', `${actor.role} may move ${from} to ${to}: ${out.why || ''}`);
    }
    for (const actor of ANYBODY.filter((a) => !allowed.includes(a))) {
      const out = m.can(p, to, actor, c);
      assert.equal(out.ok, false, `${actor.role} must not move ${from} to ${to}`);
      assert.equal(out.code, 'role', `${actor.role} on ${from} to ${to}: ${out.why}`);
      assert.match(out.why, /\.$/, 'a role refusal is a sentence a person reads');
    }
  };

  it('draft: the person who compared it, or an admin', () => {
    only('draft', 'submitted', [RAVI, ADMIN, OWNER]);
    only('draft', 'cancelled', [RAVI, ADMIN, OWNER]);
  });

  it('submitted and resolved move themselves', () => {
    only('submitted', 'triage', []);
    only('submitted', 'assigned', [], ctx({ holderUserId: 29 }));
    assert.equal(m.can(plan({ status: 'submitted' }), 'triage', m.SYSTEM, ctx()).ok, true);
    // Straight to the SPOC, when the Site has one to give it to.
    assert.equal(m.can(plan({ status: 'submitted' }), 'assigned', m.SYSTEM, ctx({ holderUserId: 29 })).ok, true);
    const nobody = m.can(plan({ status: 'submitted' }), 'assigned', m.SYSTEM, ctx());
    assert.equal(nobody.code, 'guard');
    assert.equal(nobody.why, 'this site has no SPOC');
    assert.equal(m.can(plan({ status: 'resolved' }), 'verification_pending', m.SYSTEM, ctx()).ok, true);
    assert.match(m.can(plan({ status: 'submitted' }), 'triage', ADMIN, ctx()).why,
      /The server makes this move itself/);
  });

  it('triage: an organization admin, and no longer the site manager', () => {
    const settled = ctx({ items: [item({ decision: 'approved' })], holderUserId: 29 });
    only('triage', 'assigned', [ADMIN, OWNER], settled);
    only('triage', 'rejected', [ADMIN, OWNER], settled);
    only('triage', 'duplicate', [ADMIN, OWNER], settled);
    only('triage', 'cancelled', [ADMIN, OWNER], settled);
    // The site manager of this very Site reads it, and moves nothing.
    const out = m.can(plan({ status: 'triage' }), 'assigned', MANAGER, settled);
    assert.equal(out.code, 'role');
    assert.equal(out.why, 'This is for an organization admin.');
  });

  it('the working statuses: the assignee, or an admin', () => {
    const out = ctx({ tickets: [ticket()] });
    only('assigned', 'accepted', [SAM, ADMIN, OWNER], out);
    only('accepted', 'in_progress', [SAM, ADMIN, OWNER], out);
    only('in_progress', 'resolved', [SAM, ADMIN, OWNER],
      ctx({ tickets: [ticket({ status: 'resolved', finding: 'looked' })] }));
    // A site manager who is not the assignee does not close somebody else's work.
    assert.equal(m.can(plan({ status: 'assigned' }), 'accepted', MANAGER, out).code, 'role');
  });

  it('approval: the SPOC or an admin, and never the person who sent it', () => {
    const decided = ctx({ items: [item({ decision: 'approved' })] });
    // A check from before the SPOC change, waiting in approval_pending.
    only('approval_pending', 'approved', [ADMIN, OWNER, APPROVER], decided);
    only('approval_pending', 'rejected', [ADMIN, OWNER, APPROVER], decided);
    only('approval_pending', 'rework', [ADMIN, OWNER, APPROVER], decided);

    // A check with a holder is approved straight from assigned, by the holder
    // whatever their role, or by an admin in their place.
    const sent = { submittedBy: 'ravi', submittedById: 10, spocUserId: 29 };
    for (const from of m.WORKING) {
      only(from, 'approved', [PRIYA, ADMIN, OWNER], decided, sent);
      only(from, 'rejected', [PRIYA, ADMIN, OWNER], decided, sent);
      only(from, 'rework', [PRIYA, ADMIN, OWNER], decided, sent);
      only(from, 'duplicate', [PRIYA, ADMIN, OWNER], decided, sent);
    }
    assert.equal(m.can(held(), 'approved', PRIYA, decided).ok, true, 'a member who holds it may approve');
    const manager = who('site_manager', { id: 31, username: 'dev' });
    assert.equal(m.can(held({ spocUserId: 31 }), 'approved', manager, decided).ok, true,
      'and so may a site manager who holds it');
    assert.equal(m.can(held(), 'approved', MANAGER, decided).code, 'role',
      'a site manager who does not hold it may not');
    assert.equal(m.can(held(), 'approved', APPROVER, decided).code, 'role',
      'an approver signs second, never in place of the SPOC');

    // Resolving a ticket bars nobody any more: the SPOC looks, and then decides.
    const theyLooked = ctx({ items: [item({ decision: 'approved' })],
      tickets: [ticket({ status: 'closed', resolvedBy: 'priya', resolvedById: 29 })] });
    assert.equal(m.can(held(), 'approved', PRIYA, theyLooked).ok, true,
      'a resolver who is not the sender may approve');
    assert.equal(m.isResolver(theyLooked.tickets, PRIYA), true, 'the reports still read who resolved it');
  });

  it('the sender decides nothing, matched by id and else by username', () => {
    const decided = ctx({ items: [item({ decision: 'approved' })] });
    // The SPOC sent it themselves, and an admin reassigned nothing: refused.
    const byId = held({ submittedBy: 'someone.renamed', submittedById: 29 });
    for (const to of ['approved', 'approval_pending', 'rejected', 'rework', 'duplicate']) {
      const out = m.can(byId, to, PRIYA, { ...decided, reasonCode: 'other', comment: 'x', duplicateOf: 9 });
      assert.equal(out.ok, false, `the sender must not move it to ${to}`);
      assert.equal(out.code, 'role');
      assert.equal(out.why, m.SENDER_WHY);
    }
    assert.equal(m.SENDER_WHY, 'You sent this check, so somebody else has to decide it.');
    // A check sent from an older phone build carries a name and no id.
    const byName = held({ submittedBy: 'Priya', submittedById: null });
    assert.equal(m.can(byName, 'approved', PRIYA, decided).why, m.SENDER_WHY);
    assert.equal(m.isSender(byName, PRIYA), true);
    assert.equal(m.isSender(held(), PRIYA), false);
    // An admin who sent it is refused as well, and another admin is not.
    const adminSent = held({ submittedBy: ADMIN.username, submittedById: ADMIN.id });
    assert.equal(m.can(adminSent, 'approved', ADMIN, decided).why, m.SENDER_WHY);
    assert.equal(m.can(adminSent, 'approved', OWNER, decided).ok, true, 'an admin in place of the SPOC');
    // And the second signature of an old check is closed to its sender too.
    const waiting = plan({ status: 'approval_pending', submittedBy: 'a.approver', submittedById: 24 });
    assert.equal(m.can(waiting, 'approved', APPROVER, decided).why, m.SENDER_WHY);
    // The creator who did not send it is nobody special.
    assert.equal(m.isSender(held({ createdById: 29 }), PRIYA), false);
  });

  it('reassigning and cancelling after send are for an organization admin', () => {
    const sent = { submittedBy: 'ravi', submittedById: 10, spocUserId: 29 };
    const c = ctx({ reason: 'on leave', holderUserId: 26 });
    for (const from of m.WORKING) only(from, 'cancelled', [ADMIN, OWNER], c, sent);
    only('approval_pending', 'cancelled', [ADMIN, OWNER], c, sent);
    only('assigned', 'assigned', [ADMIN, OWNER], c, sent);
    only('reopened', 'assigned', [ADMIN, OWNER], c, sent);
    only('rework', 'assigned', [ADMIN, OWNER], c, sent);
    assert.match(m.can(held(), 'cancelled', ADMIN, ctx()).why, /a reason is needed/);
    // The holder has gone: back to "needs an admin", by an admin or the server.
    for (const from of m.WORKING) only(from, 'triage', [ADMIN, OWNER], c, sent);
    assert.equal(m.can(held(), 'triage', m.SYSTEM, ctx()).ok, true);
    // A sender may still cancel their own draft.
    assert.equal(m.can(plan({ status: 'draft' }), 'cancelled', RAVI, ctx()).ok, true);
  });

  it('the write: an organization admin, never a site manager', () => {
    const ready = ctx({ items: [item({ decision: 'approved' })],
      decisions: [{ stage: 'first', decision: 'approved', payloadHash: 'hash', approverId: 24 }],
      payloadHash: 'hash', toWrite: 1 });
    only('approved', 'write_in_progress', [ADMIN, OWNER], ready);
    only('write_failed', 'manual_review', [ADMIN, OWNER], ready);
    only('manual_review', 'rejected', [ADMIN, OWNER], ready);
    // An approval that went stale puts a held check back with its holder, and
    // only the server makes that move.
    for (const from of ['approved', 'write_failed', 'manual_review']) {
      only(from, 'assigned', [], ready);
      assert.equal(m.can(plan({ status: from, spocUserId: 29 }), 'assigned', m.SYSTEM, ready).ok, true);
    }
  });

  it('verification: a technician of the Site', () => {
    const passed = ctx({ verification: { kind: 'post_fix', result: 'pass' } });
    only('verification_pending', 'approval_pending', [RAVI, ADMIN, OWNER, MANAGER, SAM, PRIYA], passed);
    const elsewhere = who('member', { id: 28, tenantId: 99 });
    assert.equal(m.can(plan({ status: 'verification_pending' }), 'approval_pending', elsewhere, passed).code,
      'role', 'a technician of another Site is not a technician of this rack');
  });

  it('a finished plan is opened again only by an admin, with a reason from the list', () => {
    only('completed', 'reopened', [ADMIN, OWNER], ctx({ reasonCode: 'drift_recurred' }));
  });
});

describe('the guards say what is missing', () => {
  const why = (from, to, actor, c) => m.can(plan({ status: from }), to, actor, c).why;
  const refusal = (from, to, actor, c) => m.can(plan({ status: from }), to, actor, c);

  it('submit needs a scan and something to decide', () => {
    assert.match(m.can(plan({ status: 'draft', scanId: null }), 'submitted', RAVI, ctx()).why,
      /needs the scan it came from/);
    const nothing = ctx({ items: [item({ decidable: false, decision: 'not_applicable' })] });
    assert.match(why('draft', 'submitted', RAVI, nothing), /nothing on this plan needs a decision/);
    assert.equal(m.can(plan({ status: 'draft' }), 'submitted', RAVI, ctx()).ok, true);
  });

  it('assigned needs somebody to hold the check', () => {
    const out = refusal('triage', 'assigned', ADMIN, ctx());
    assert.equal(out.code, 'guard');
    assert.equal(out.why, 'choose who this check goes to first');
    // The request names a holder, the check already has one, or (a check from
    // before the SPOC change) a ticket on it is still open.
    assert.equal(refusal('triage', 'assigned', ADMIN, ctx({ holderUserId: 29 })).ok, true);
    assert.equal(m.can(plan({ status: 'triage', spocUserId: 29 }), 'assigned', ADMIN, ctx()).ok, true);
    assert.equal(refusal('triage', 'assigned', ADMIN, ctx({ tickets: [ticket()] })).ok, true);
    assert.equal(refusal('triage', 'assigned', ADMIN,
      ctx({ tickets: [ticket({ status: 'closed' })] })).ok, false, 'a closed ticket holds nothing');
  });

  it('counts what is still waiting to be handed out', () => {
    const left = (c) => m.GUARDS.everyItemTicketed(plan({ status: 'triage' }), c);
    assert.equal(left(ctx({ items: [item(), item({ uid: 'dev:2' })] })),
      '2 items are still waiting to be assigned');
    assert.equal(left(ctx({ items: [item(), item({ uid: 'dev:2', decision: 'approved' })] })),
      '1 item is still waiting to be assigned');
    // A rebind cannot be assigned, so it is never counted.
    assert.equal(left(ctx({ items: [item({ uid: 'dev:3', action: 'rebind' })] })), null);
    // Neither is an item that is already out with somebody.
    assert.equal(left(ctx({ items: [item()], tickets: [ticket()] })), null);
  });

  it('a duplicate names the plan it duplicates, and an exception names the exception', () => {
    assert.match(why('triage', 'duplicate', ADMIN, ctx()), /say which plan this one duplicates/);
    assert.match(why('triage', 'duplicate', ADMIN, ctx({ duplicateOf: 1 })), /cannot be a duplicate of itself/);
    assert.equal(refusal('triage', 'duplicate', ADMIN, ctx({ duplicateOf: 9 })).ok, true);
    assert.match(why('triage', 'known_exception', ADMIN, ctx()), /say which exception covers this plan/);
    assert.equal(refusal('triage', 'known_exception', ADMIN, ctx({ exceptionId: 4 })).ok, true);
  });

  it('a rejection needs a reason code from the list and a comment', () => {
    assert.match(why('triage', 'rejected', ADMIN, ctx()), /a reason code is needed, one of: /);
    assert.match(why('triage', 'rejected', ADMIN, ctx({ reasonCode: 'made_up' })), /a reason code is needed/);
    assert.match(why('triage', 'rejected', ADMIN, ctx({ reasonCode: 'wrong_asset' })), /a comment is needed/);
    assert.equal(refusal('triage', 'rejected', ADMIN,
      ctx({ reasonCode: 'wrong_asset', comment: 'not that rack' })).ok, true);
  });

  it('on hold needs one of the pending reasons', () => {
    const t = ctx({ tickets: [ticket()] });
    assert.match(why('accepted', 'pending', SAM, t), /a pending reason is needed, one of: awaiting_requester/);
    assert.equal(refusal('accepted', 'pending', SAM,
      ctx({ tickets: [ticket()], pendingReason: 'awaiting_parts' })).ok, true);
  });

  it('resolved needs every ticket back, each with a finding', () => {
    const open = ctx({ tickets: [ticket()] });
    assert.equal(why('in_progress', 'resolved', SAM, open), 'a ticket on this plan is still open');
    const silent = ctx({ tickets: [ticket({ status: 'resolved', finding: '  ' })] });
    assert.equal(why('in_progress', 'resolved', SAM, silent), 'every resolved ticket needs a finding');
    const said = ctx({ tickets: [ticket({ status: 'resolved', finding: 'it is at U12' })] });
    assert.equal(refusal('in_progress', 'resolved', SAM, said).ok, true);
  });

  it('approval needs a passing scan, or an admin saying why there is none', () => {
    assert.equal(why('verification_pending', 'approval_pending', RAVI, ctx()),
      'a passing verification scan is needed first');
    const failed = ctx({ verification: { kind: 'post_fix', result: 'fail' } });
    assert.match(why('verification_pending', 'approval_pending', RAVI, failed), /passing verification/);
    // The skip: an admin, with a reason, and nobody else at all.
    assert.match(why('verification_pending', 'approval_pending', RAVI, ctx({ skip: true })),
      /only an organization admin may skip/);
    assert.match(why('verification_pending', 'approval_pending', ADMIN, ctx({ skip: true })),
      /skipping the verification scan needs a reason/);
    assert.equal(refusal('verification_pending', 'approval_pending', ADMIN,
      ctx({ skip: true, reason: '300 miles away' })).ok, true);
    // Back to the beginning only on a failure.
    assert.match(why('verification_pending', 'reopened', ADMIN, ctx()), /only a failed verification/);
    assert.equal(refusal('verification_pending', 'reopened', ADMIN, failed).ok, true);
  });

  it('approve needs every item decided, and something to sign', () => {
    const waiting = ctx({ items: [item(), item({ uid: 'dev:2', decision: 'ticketed' })] });
    assert.equal(why('approval_pending', 'approved', APPROVER, waiting), '2 items are still undecided');
    const one = ctx({ items: [item(), item({ uid: 'dev:2', decision: 'rejected' })] });
    assert.equal(why('approval_pending', 'approved', APPROVER, one), '1 item is still undecided');
    const decided = ctx({ items: [item({ decision: 'approved' })] });
    assert.equal(refusal('approval_pending', 'approved', APPROVER, decided).ok, true);
    assert.match(why('approval_pending', 'approved', APPROVER, { ...decided, payloadHash: null }),
      /nothing to sign/);
  });

  it('the write stops when NetBox moved, or the approval no longer covers it', () => {
    const signed = (over = {}) => ctx({ items: [item({ decision: 'approved' })],
      decisions: [{ stage: 'first', decision: 'approved', payloadHash: 'hash' }], ...over });
    assert.equal(refusal('approved', 'write_in_progress', ADMIN, signed()).ok, true);
    assert.match(why('approved', 'write_in_progress', ADMIN,
      signed({ recheck: { ok: false, why: 'NetBox has changed since this plan was compared' } })),
    /NetBox has changed/);
    assert.match(why('approved', 'write_in_progress', ADMIN, signed({ payloadHash: 'different' })),
      /items have changed since this plan was approved/);
    assert.match(why('approved', 'write_in_progress', ADMIN,
      signed({ decisions: [{ stage: 'first', decision: 'approved', payloadHash: 'older' }] })),
    /no approval on record matches/);
    assert.match(why('approved', 'write_in_progress', ADMIN, signed({ toWrite: 0 })),
      /nothing on this plan was approved for writing/);
    // Nothing approved, so it completes instead of writing.
    assert.equal(refusal('approved', 'completed', ADMIN, signed({ toWrite: 0 })).ok, true);
    assert.match(why('approved', 'completed', ADMIN, signed()), /has approved items; write it instead/);
  });

  it('after the write, the second check decides which way the plan goes', () => {
    const passed = ctx({ verification: { kind: 'post_write', result: 'pass' } });
    assert.equal(m.can(plan({ status: 'written' }), 'completed', m.SYSTEM, passed).ok, true);
    assert.match(m.can(plan({ status: 'written' }), 'completed', m.SYSTEM, ctx()).why,
      /passing check of NetBox after the write/);
    const failed = ctx({ verification: { kind: 'post_write', result: 'fail' } });
    assert.equal(m.can(plan({ status: 'written' }), 'reopened', m.SYSTEM, failed).ok, true);
    assert.match(m.can(plan({ status: 'written' }), 'reopened', m.SYSTEM, passed).why,
      /only a failed check after the write/);
  });

  it('reopening needs a reason from the list', () => {
    assert.match(why('completed', 'reopened', ADMIN, ctx()), /a reopen reason is needed, one of: /);
    assert.equal(refusal('completed', 'reopened', ADMIN, ctx({ reasonCode: 'write_mismatch' })).ok, true);
    assert.match(why('completed', 'reopened', ADMIN, ctx({ reasonCode: 'because' })), /reopen reason/);
  });

  it('a plan sent back needs a reason, and somebody to send it to', () => {
    assert.match(why('rejected', 'assigned', ADMIN, ctx()), /a reason is needed/);
    assert.match(why('rejected', 'assigned', ADMIN, ctx({ reason: 'try again' })),
      /choose who this check goes to first/);
    assert.equal(refusal('rejected', 'assigned', ADMIN,
      ctx({ reason: 'try again', tickets: [ticket()] })).ok, true);
    assert.equal(refusal('rework', 'in_progress', ADMIN, ctx({ reason: 'have another look' })).ok, true);
  });
});

describe('two names on a critical change', () => {
  const critical = plan({ status: 'approval_pending', risk: 'critical' });
  const DUAL = { dualApprovalRisks: ['critical'] };
  const decided = (over = {}) => ctx({ items: [item({ decision: 'approved' })], settings: DUAL, ...over });

  it('is off until an organization turns it on', () => {
    const plain = ctx({ items: [item({ decision: 'approved' })] });
    assert.equal(m.needsSecondApproval(plan({ risk: 'critical' }), plain), false);
    assert.deepEqual(m.approvalStage(critical, plain), { stage: 'first', final: true, dual: false });
    assert.match(m.can(held({ risk: 'critical' }), 'approval_pending', PRIYA, plain).why,
      /does not need a second approval/);
  });

  it('asks for a second approval only when the risk says so', () => {
    assert.equal(m.needsSecondApproval(plan({ risk: 'critical' }), decided()), true);
    assert.equal(m.needsSecondApproval(plan({ risk: 'high' }), decided()), false);
    assert.equal(m.needsSecondApproval(plan({ risk: 'high' }),
      decided({ settings: { dualApprovalRisks: ['high', 'critical'] } })), true,
    'and whatever else the organization set');
  });

  it('the first signature from assigned parks it in approval_pending', () => {
    const p = held({ risk: 'critical' });
    assert.equal(m.can(p, 'approval_pending', PRIYA, decided()).ok, true);
    assert.equal(m.can(p, 'approval_pending', RAVI, decided()).code, 'role', 'never by the sender');
    const waiting = decided({ items: [item()] });
    assert.equal(m.can(p, 'approval_pending', PRIYA, waiting).why, '1 item is still undecided');
    // Once signed, the second name comes from somebody else, in approval_pending.
    const signed = decided({ decisions: [{ stage: 'first', decision: 'approved',
      payloadHash: 'hash', approverId: PRIYA.id }] });
    const parked = held({ status: 'approval_pending', risk: 'critical' });
    assert.match(m.can(parked, 'approved', PRIYA, signed).why, /has to come from a different person/);
    assert.equal(m.can(parked, 'approved', APPROVER, signed).ok, true);
    assert.equal(m.can(parked, 'approved', ADMIN, signed).ok, true);
  });

  it('the first signature leaves it waiting, and the second has to be somebody else', () => {
    const first = m.approvalStage(critical, decided());
    assert.deepEqual(first, { stage: 'first', final: false, dual: true });
    assert.equal(m.can(critical, 'approved', APPROVER, decided()).ok, true);

    const signed = decided({ decisions: [{ stage: 'first', decision: 'approved',
      payloadHash: 'hash', approverId: APPROVER.id }] });
    const again = m.can(critical, 'approved', APPROVER, signed);
    assert.equal(again.ok, false);
    assert.equal(again.code, 'guard');
    assert.match(again.why, /has to come from a different person/);
    assert.deepEqual(m.approvalStage(critical, signed), { stage: 'second', final: true, dual: true });
    assert.equal(m.can(critical, 'approved', ADMIN, signed).ok, true, 'a different person may');
    assert.equal(m.firstApproval(signed).approverId, APPROVER.id);
  });

  it('an approval of an older list does not count as the first', () => {
    const stale = decided({ decisions: [{ stage: 'first', decision: 'approved',
      payloadHash: 'an older list', approverId: APPROVER.id }] });
    assert.equal(m.firstApproval(stale), null, 'it signed something else');
    assert.equal(m.can(critical, 'approved', APPROVER, stale).ok, true, 'so they sign again');
  });

  it('a rejection ends the round: the next approval is a first one again', () => {
    const afterReject = decided({ decisions: [
      { stage: 'first', decision: 'approved', payloadHash: 'hash', approverId: APPROVER.id },
      { stage: 'first', decision: 'rejected', payloadHash: 'hash', approverId: ADMIN.id },
    ] });
    assert.equal(m.firstApproval(afterReject), null);
    assert.equal(m.can(critical, 'approved', APPROVER, afterReject).ok, true);
  });

  it('a plan that needs one name is approved by the first', () => {
    assert.deepEqual(m.approvalStage(plan({ status: 'approval_pending' }), decided()),
      { stage: 'first', final: true, dual: false });
  });
});

describe('the four moves on a ticket', () => {
  it('the assignee may, an admin may, a stranger may not', () => {
    const t = ticket();
    for (const actor of [SAM, ADMIN, OWNER]) {
      assert.equal(m.canTicket(t, 'accept', actor).ok, true, `${actor.username} may accept`);
    }
    const out = m.canTicket(t, 'accept', MANAGER);
    assert.equal(out.ok, false);
    assert.equal(out.code, 'role');
    assert.match(out.why, /assigned to sam/);
  });

  it('matches the assignee on what the signed-in account carries, three ways', () => {
    assert.equal(m.isTicketAssignee(ticket({ assigneeUserId: 26 }), SAM), true, 'the resolved user');
    assert.equal(m.isTicketAssignee(ticket({ assigneeUserId: null, assigneeEmail: 'sam@example.test' }),
      SAM), true, 'the contact email against theirs');
    assert.equal(m.isTicketAssignee(ticket({ assigneeUserId: null, assigneeEmail: null, assignee: 'sam' }),
      SAM), true, 'or the name the admin picked');
    assert.equal(m.isTicketAssignee(ticket({ assigneeUserId: null, assigneeEmail: null, assignee: 'Sam Patel' }),
      SAM), false, 'and nothing a request could simply claim');
  });

  it('refuses a move a ticket cannot make from where it is', () => {
    assert.match(m.canTicket(ticket({ status: 'resolved', finding: 'said' }), 'accept', SAM).why,
      /a ticket that is resolved cannot be accepted/);
    assert.equal(m.canTicket(null, 'accept', SAM).code, 'transition');
    assert.match(m.canTicket(ticket(), 'invent', SAM).why, /unknown ticket action 'invent'/);
  });

  it('resolving says what was found, and on hold says why', () => {
    assert.match(m.canTicket(ticket(), 'resolve', SAM, {}).why, /say what you found/);
    assert.equal(m.canTicket(ticket(), 'resolve', SAM, { finding: 'it is at U12' }).ok, true);
    assert.match(m.canTicket(ticket(), 'resolve', SAM, { finding: 'x', disposition: 'made_up' }).why,
      /disposition has to be one of/);
    assert.match(m.canTicket(ticket(), 'pending', SAM, {}).why, /a pending reason is needed/);
    assert.equal(m.canTicket(ticket(), 'pending', SAM, { pendingReason: 'awaiting_access' }).ok, true);
    // ServiceNow closing an incident is the one resolve with nothing said.
    assert.equal(m.canTicket(ticket(), 'resolve', m.SYSTEM, {}).ok, true);
    // And a person may then record the finding on the already-resolved ticket.
    assert.equal(m.canTicket(ticket({ status: 'resolved', finding: null }), 'resolve', SAM,
      { finding: 'here is what I saw' }).ok, true);
  });

  it('the plan shows the least advanced ticket still open', () => {
    assert.equal(m.workingStatus([]), null, 'a plan with no tickets is not following any');
    assert.equal(m.workingStatus([ticket(), ticket({ itemUid: 'dev:2', status: 'in_progress' })]), 'assigned');
    assert.equal(m.workingStatus([ticket({ status: 'accepted' }),
      ticket({ itemUid: 'dev:2', status: 'in_progress' })]), 'accepted');
    assert.equal(m.workingStatus([ticket({ status: 'in_progress' }),
      ticket({ itemUid: 'dev:2', status: 'pending' })]), 'in_progress');
    assert.equal(m.workingStatus([ticket({ status: 'pending' })]), 'pending');
    assert.equal(m.workingStatus([ticket({ status: 'resolved' }),
      ticket({ itemUid: 'dev:2', status: 'closed' })]), 'resolved', 'nothing open means it is back');
  });
});

describe('what a screen may offer', () => {
  it('lists the moves this person could make, and what each one still needs', () => {
    const offered = m.next(plan({ status: 'triage' }), ADMIN, ctx());
    const by = Object.fromEntries(offered.map((o) => [o.to, o]));
    assert.deepEqual(Object.keys(by).sort(),
      ['assigned', 'cancelled', 'duplicate', 'known_exception', 'rejected']);
    assert.equal(by.assigned.ready, false);
    assert.equal(by.assigned.why, 'choose who this check goes to first');
    assert.deepEqual(by.rejected.needs, ['reasonCode', 'comment']);
    assert.equal(by.cancelled.ready, true);
    assert.equal(by.cancelled.why, null);
  });

  it('offers the approval to the sender, marked not ready and saying why', () => {
    // Found on the demo, when the bar was on whoever resolved the tickets: the
    // move was left out of the list entirely, so the screen had nothing to
    // draw and said only "No move is open to you on this drift.". That reads
    // as the workflow having broken, when what it is doing is waiting for
    // somebody else. The move is offered, and refused in words.
    const decided = ctx({ items: [item({ decision: 'approved' })] });
    const sentByAdmin = held({ submittedBy: ADMIN.username, submittedById: ADMIN.id });
    const offered = m.next(sentByAdmin, ADMIN, decided);
    const by = Object.fromEntries(offered.map((o) => [o.to, o]));
    assert.ok(by.approved, 'the approval is still offered, not hidden');
    assert.equal(by.approved.ready, false);
    assert.equal(by.approved.why, m.SENDER_WHY);
    assert.equal(by.approved.blockedByRole, true);
    assert.equal(by.rejected.blockedByRole, true);
    assert.equal(by.rework.blockedByRole, true);
    assert.equal(by.cancelled.blockedByRole, false, 'an admin who sent it may still cancel it');

    // And the bar itself has not moved: the move is still refused.
    const verdict = m.can(sentByAdmin, 'approved', ADMIN, decided);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.code, 'role');

    // The holder, who sent nothing, is offered it ready - and offered no
    // reassign and no cancel, which are an admin's.
    const theirs = Object.fromEntries(m.next(held(), PRIYA, decided).map((o) => [o.to, o]));
    assert.equal(theirs.approved.ready, true);
    assert.notEqual(theirs.approved.blockedByRole, true);
    assert.deepEqual(Object.keys(theirs).sort(),
      ['approval_pending', 'approved', 'duplicate', 'rejected', 'rework']);
    // A technician who sent it holds nothing and is no admin, and is still
    // shown the decisions - every one of them greyed, with the sentence.
    const senders = m.next(held(), RAVI, decided);
    assert.deepEqual(senders.map((o) => o.to).sort(),
      ['approval_pending', 'approved', 'duplicate', 'rejected', 'rework']);
    assert.ok(senders.every((o) => o.ready === false && o.blockedByRole === true && o.why === m.SENDER_WHY));
    assert.equal(m.can(held(), 'approved', RAVI, decided).code, 'role', 'and refused all the same');
    // Somebody who neither sent it nor holds it is offered nothing at all.
    assert.deepEqual(m.next(held(), SAM, decided), []);
  });

  it('offers a technician nothing on somebody else\'s triage, and the server\'s moves to nobody', () => {
    assert.deepEqual(m.next(plan({ status: 'triage' }), SAM, ctx()), []);
    assert.deepEqual(m.next(plan({ status: 'submitted' }), ADMIN, ctx()), [],
      'the automatic move is not a button');
    assert.deepEqual(m.next(plan({ status: 'cancelled' }), OWNER, ctx()), []);
  });
});
