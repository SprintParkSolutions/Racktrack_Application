/**
 * The approval workflow as a table: which status follows which, who may make
 * the move, and what has to be true first.
 *
 * Pure. No database, no network, no clock. The service loads what a guard
 * needs (the items, the tickets, the earlier approvals, the organization's
 * settings) into `ctx` and asks `can()`; the routes turn a refusal into 403
 * (the wrong person) or 409 (the right person, too early). The table is the
 * contract's, docs/design/approvals-api-contract.md, row for row.
 *
 * WHO. A move names who may make it with these words:
 *
 *   system        the server itself: an automatic move, the ServiceNow sync,
 *                 the write. Never a person's request.
 *   creator       whoever ran the comparison the plan was filed from
 *   admin         owner and org_admin
 *   site_manager  the site manager of the plan's own Site, nobody else's
 *   assignee      the RackTrack user a ticket on the plan is assigned to
 *   approver      approver, org_admin and owner - and never somebody who
 *                 resolved one of the plan's tickets
 *   writer        org_admin and owner
 *   technician    a technician of the plan's Site (a member or a site manager
 *                 there), or an admin
 *
 * THE WORKING STATUSES. assigned, accepted, in_progress and pending describe
 * tickets, and a plan can have several. The plan shows the least advanced
 * ticket still open: assigned while any ticket has not been accepted, then
 * accepted, then in_progress, and pending only when every open ticket is
 * waiting on something. When no ticket is open any more the plan is resolved.
 * `workingStatus()` works that out, and the moves it causes are in the table
 * as `derived`: the person who acted on the ticket is checked by
 * `canTicket()`, and the plan follows.
 */

const STATUSES = [
  'draft', 'submitted', 'triage', 'assigned', 'accepted', 'in_progress', 'pending',
  'resolved', 'verification_pending', 'approval_pending', 'approved', 'rejected', 'rework',
  'write_in_progress', 'written', 'write_failed', 'manual_review', 'completed', 'reopened',
  'cancelled', 'duplicate', 'known_exception',
];

/** Statuses that follow the plan's tickets. */
const WORKING = ['assigned', 'accepted', 'in_progress', 'pending'];
/** Nothing moves a plan out of these. */
const TERMINAL = ['cancelled', 'duplicate', 'known_exception'];
/** A plan somebody still has to do something about. */
const OPEN = STATUSES.filter((s) => !['completed', 'rejected', ...TERMINAL].includes(s));

const PRIORITIES = ['P1', 'P2', 'P3', 'P4'];
const RISKS = ['low', 'medium', 'high', 'critical'];
const ITEM_DECISIONS = ['pending', 'ticketed', 'approved', 'rejected', 'excepted', 'not_applicable'];
const TICKET_STATUSES = ['open', 'accepted', 'in_progress', 'pending', 'resolved', 'closed'];

const REASONS = {
  reject: ['insufficient_evidence', 'incorrect_remediation', 'configuration_still_differs',
    'wrong_spoc', 'wrong_asset', 'change_not_authorized', 'duplicate', 'known_exception',
    'maintenance_window_required', 'other'],
  pending: ['awaiting_requester', 'awaiting_vendor', 'awaiting_change_window', 'awaiting_access',
    'awaiting_parts', 'awaiting_external_team'],
  reopen: ['verification_failed', 'drift_recurred', 'incorrect_closure', 'write_mismatch',
    'new_evidence', 'other'],
  disposition: ['remediate', 'accept_drift', 'update_source_of_truth', 'false_positive',
    'duplicate', 'known_exception', 'decommissioned_asset', 'requires_change_request'],
};

/**
 * What each action a comparison can report means for the workflow. One table,
 * so a new action needs a row here and no change to a route:
 *
 *   changes      it would change NetBox, so it is fingerprinted and, unless it
 *                is scaffolding, put to a person as a decision
 *   ticketable   somebody can be sent to the rack to check it
 *   assignFirst  approve and reject wait until somebody has looked and
 *                reported back (rule 2 of the frozen workflow)
 *   evenWhenSupporting  it is a decision even on a scaffolding type: a rebind
 *                of the Rack record re-keys everything under it, so it is not
 *                written on anybody else's say-so
 *   notTicketable  the refusal a person reads when they try to assign it
 *
 * A rebind moves our uid field on a record NetBox already holds. There is no
 * cabinet to open and nothing to compare, so it is never assigned and it is
 * approved or rejected as it stands. Any action not listed here changes
 * nothing: it is reported, not decided.
 */
const ACTION_TRAITS = {
  create: { changes: true, ticketable: true, assignFirst: true },
  update: { changes: true, ticketable: true, assignFirst: true },
  rebind: {
    changes: true, ticketable: false, assignFirst: false, evenWhenSupporting: true,
    notTicketable: 'a rebind only re-labels a record already in NetBox; approve or reject it, there is nothing to check at the rack',
  },
};
const NO_TRAITS = Object.freeze({ changes: false, ticketable: false, assignFirst: false });
const traitsOf = (action) => ACTION_TRAITS[action] || NO_TRAITS;
/** Can somebody be sent to the rack for this item? */
const isTicketable = (item) => Boolean(item && traitsOf(item.action).ticketable);
/** Does this item wait for a finding before it can be approved or rejected? */
const needsAssignFirst = (item) => Boolean(item && traitsOf(item.action).assignFirst);

const ROLES = {
  admin: ['owner', 'org_admin'],
  triage: ['owner', 'org_admin', 'site_manager'],
  approver: ['owner', 'org_admin', 'approver'],
  writer: ['owner', 'org_admin'],
  technician: ['owner', 'org_admin', 'site_manager', 'member'],
  auditor: ['owner', 'org_admin', 'auditor'],
  reader: ['owner', 'org_admin', 'site_manager', 'approver', 'auditor'],
};

/** The server acting on its own: an automatic move, the sync, the write. */
const SYSTEM = Object.freeze({ id: null, username: 'system', role: 'system', system: true });

// -- Who ----------------------------------------------------------------
const same = (a, b) => a != null && b != null && String(a).toLowerCase() === String(b).toLowerCase();
const sameId = (a, b) => a != null && b != null && Number(a) === Number(b);

const isSystem = (actor) => Boolean(actor && actor.system);
const isAdmin = (actor) => Boolean(actor && ROLES.admin.includes(actor.role));
const isCreator = (plan, actor) => Boolean(actor && plan
  && (sameId(plan.createdById, actor.id) || same(plan.createdBy, actor.username)));
const managesSite = (plan, actor) => Boolean(actor && actor.role === 'site_manager'
  && sameId(plan && plan.tenantId, actor.tenantId));

/**
 * Is this person the one a ticket went to? The assignee is a NetBox contact
 * and the caller is a RackTrack user, so they are matched on what the signed-in
 * user carries and nothing a request could claim: the user the contact's email
 * resolved to when it was assigned, the contact id when the user has one, the
 * contact's email against the caller's, or the name the admin picked against
 * the caller's username.
 */
const isTicketAssignee = (ticket, actor) => Boolean(ticket && actor && (
  sameId(ticket.assigneeUserId, actor.id)
  || (actor.netboxContactId != null && sameId(ticket.assigneeId, actor.netboxContactId))
  || same(ticket.assigneeEmail, actor.email)
  || same(ticket.assignee, actor.username)
  || same(ticket.assignee, actor.email)));

const isAssignee = (tickets, actor) => (tickets || []).some((t) => isTicketAssignee(t, actor));

/** Did this person resolve any of the plan's tickets? Then they cannot approve it. */
const isResolver = (tickets, actor) => Boolean(actor) && (tickets || []).some((t) =>
  sameId(t.resolvedById, actor.id) || same(t.resolvedBy, actor.username));

const isTechnicianOf = (plan, actor) => Boolean(actor) && (isAdmin(actor)
  || (['member', 'site_manager'].includes(actor.role) && sameId(plan && plan.tenantId, actor.tenantId)));

const WHO = {
  system: (plan, actor) => isSystem(actor),
  creator: (plan, actor) => isCreator(plan, actor),
  admin: (plan, actor) => isAdmin(actor),
  site_manager: (plan, actor) => managesSite(plan, actor),
  assignee: (plan, actor, ctx) => isAssignee(ctx.tickets, actor),
  approver: (plan, actor) => Boolean(actor && ROLES.approver.includes(actor.role)),
  writer: (plan, actor) => Boolean(actor && ROLES.writer.includes(actor.role)),
  technician: (plan, actor) => isTechnicianOf(plan, actor),
};

const WHO_SENTENCE = {
  system: 'the server makes this move itself',
  creator: 'the person who ran the comparison',
  admin: 'an organization admin',
  site_manager: 'the site manager of this Site',
  assignee: 'the person the ticket is assigned to',
  approver: 'an approver',
  writer: 'an organization admin',
  technician: 'a technician of this Site',
};

// -- Guards -------------------------------------------------------------
// A guard answers null when the move may go ahead, or a plain sentence saying
// what is missing.
const text = (v) => (typeof v === 'string' ? v.trim() : '');
const ticketFor = (ctx, uid) => (ctx.tickets || []).find((t) => t.itemUid === uid) || null;
const openTickets = (ctx) => (ctx.tickets || []).filter((t) => ['open', 'accepted', 'in_progress', 'pending'].includes(t.status));

/**
 * Items still waiting to be handed to somebody: undecided, of a kind that can
 * be checked at the rack, and never assigned. An item whose ticket has come
 * back is pending too, but it is waiting on the admin, not on an assignment.
 */
const unassigned = (ctx) => (ctx.items || []).filter((i) => i.decidable && i.decision === 'pending'
  && isTicketable(i) && !ticketFor(ctx, i.uid));

const needsReason = (plan, ctx) => (text(ctx.reason) ? null : 'a reason is needed');
const needsCodeAndComment = (kind) => (plan, ctx) => {
  if (!REASONS[kind].includes(ctx.reasonCode)) return `a reason code is needed, one of: ${REASONS[kind].join(', ')}`;
  if (!text(ctx.comment)) return 'a comment is needed';
  return null;
};
const needsOpenTicket = (plan, ctx) => (openTickets(ctx).length ? null
  : 'assign at least one item to somebody first');

const GUARDS = {
  submit(plan, ctx) {
    if (plan.scanId == null) return 'a plan needs the scan it came from before it can be submitted';
    if (!(ctx.items || []).some((i) => i.decidable)) {
      return 'nothing on this plan needs a decision; cancel it instead';
    }
    return null;
  },
  everyItemTicketed(plan, ctx) {
    const left = unassigned(ctx).length;
    return left ? `${left} item${left === 1 ? ' is' : 's are'} still waiting to be assigned` : null;
  },
  duplicate(plan, ctx) {
    if (ctx.duplicateOf == null || ctx.duplicateOf === '') return 'say which plan this one duplicates';
    if (Number(ctx.duplicateOf) === Number(plan.id)) return 'a plan cannot be a duplicate of itself';
    return null;
  },
  knownException: (plan, ctx) => (ctx.exceptionId == null || ctx.exceptionId === ''
    ? 'say which exception covers this plan' : null),
  pendingReason: (plan, ctx) => (REASONS.pending.includes(ctx.pendingReason) ? null
    : `a pending reason is needed, one of: ${REASONS.pending.join(', ')}`),
  everyTicketHasFinding(plan, ctx) {
    if (openTickets(ctx).length) return 'a ticket on this plan is still open';
    const blank = (ctx.tickets || []).filter((t) => t.status === 'resolved' && !text(t.finding)).length;
    return blank ? 'every resolved ticket needs a finding' : null;
  },
  verified(plan, ctx, actor) {
    if (ctx.skip) {
      if (!isAdmin(actor)) return 'only an organization admin may skip the verification scan';
      return text(ctx.reason) ? null : 'skipping the verification scan needs a reason';
    }
    const v = ctx.verification;
    return v && v.kind === 'post_fix' && v.result === 'pass' ? null
      : 'a passing verification scan is needed first';
  },
  verificationFailed(plan, ctx) {
    const v = ctx.verification;
    return v && v.result === 'fail' ? null : 'only a failed verification reopens a plan from here';
  },
  approve(plan, ctx, actor) {
    const waiting = (ctx.items || []).filter((i) => i.decidable
      && (i.decision === 'pending' || i.decision === 'ticketed')).length;
    if (waiting) return `${waiting} item${waiting === 1 ? ' is' : 's are'} still undecided`;
    if (!ctx.payloadHash) return 'the approval has nothing to sign: no payload hash';
    const first = firstApproval(ctx);
    if (needsSecondApproval(plan, ctx) && first && sameId(first.approverId, actor && actor.id)) {
      return 'this plan needs a second approval, and it has to come from a different person';
    }
    return null;
  },
  hashStillStands(plan, ctx) {
    // The service compares NetBox again just before a write and hands the
    // answer over: the fingerprint still matches, or (on a retry) everything
    // that no longer shows up is something this plan itself wrote.
    if (ctx.recheck && !ctx.recheck.ok) {
      return ctx.recheck.why || 'NetBox has changed since this plan was compared';
    }
    if (!ctx.payloadHash || ctx.payloadHash !== plan.payloadHash) {
      return 'the items have changed since this plan was approved';
    }
    const signed = lastApproval(ctx);
    if (!signed || signed.payloadHash !== plan.payloadHash) {
      return 'no approval on record matches what would be written';
    }
    return null;
  },
  somethingToWrite: (plan, ctx) => (ctx.toWrite > 0 ? null : 'nothing on this plan was approved for writing'),
  nothingToWrite: (plan, ctx) => (ctx.toWrite > 0 ? 'this plan has approved items; write it instead' : null),
  postWritePassed(plan, ctx) {
    const v = ctx.verification;
    return v && v.kind === 'post_write' && v.result === 'pass' ? null
      : 'a passing check of NetBox after the write is needed first';
  },
  postWriteFailed(plan, ctx) {
    const v = ctx.verification;
    return v && v.kind === 'post_write' && v.result === 'fail' ? null
      : 'only a failed check after the write reopens a plan from here';
  },
  reopen: (plan, ctx) => (REASONS.reopen.includes(ctx.reasonCode) ? null
    : `a reopen reason is needed, one of: ${REASONS.reopen.join(', ')}`),
};

const all = (...guards) => (plan, ctx, actor) => {
  for (const g of guards) { const why = g(plan, ctx, actor); if (why) return why; }
  return null;
};

// -- Dual approval ------------------------------------------------------
/** Does this plan need two people? Its risk is in the organization's dual_approval_risks. */
function needsSecondApproval(plan, ctx) {
  const risks = (ctx.settings && ctx.settings.dualApprovalRisks) || ['critical'];
  return risks.includes(plan.risk);
}

/** The approvals of this round: the ones made since the plan last asked for approval. */
function roundOf(ctx) {
  const rows = ctx.decisions || [];
  let start = 0;
  rows.forEach((d, i) => { if (d.decision !== 'approved') start = i + 1; });
  return rows.slice(start).filter((d) => d.payloadHash === ctx.payloadHash);
}
/** A first approval that still stands: same round, and it signed today's payload. */
const firstApproval = (ctx) => roundOf(ctx).find((d) => d.stage === 'first') || null;
/** The most recent approval of any stage, whatever it signed. */
const lastApproval = (ctx) => [...(ctx.decisions || [])].reverse().find((d) => d.decision === 'approved') || null;

/**
 * What an approve call would be: the first signature or the second, and
 * whether it settles the plan. With dual approval the first signature leaves
 * the plan in approval_pending and the second, from somebody else, approves it.
 */
function approvalStage(plan, ctx) {
  if (!needsSecondApproval(plan, ctx)) return { stage: 'first', final: true, dual: false };
  return firstApproval(ctx)
    ? { stage: 'second', final: true, dual: true }
    : { stage: 'first', final: false, dual: true };
}

// -- The table ----------------------------------------------------------
const APPROVERS = ['approver'];
const TRIAGERS = ['admin', 'site_manager'];
const WORKERS = ['assignee', 'admin', 'system'];

const TRANSITIONS = {
  draft: {
    submitted: { who: ['creator', 'admin'], guard: GUARDS.submit },
    cancelled: { who: ['creator', 'admin'] },
  },
  submitted: {
    triage: { who: ['system'] },
  },
  triage: {
    assigned: { who: [...TRIAGERS, 'system'], guard: GUARDS.everyItemTicketed },
    rejected: { who: TRIAGERS, guard: needsCodeAndComment('reject'), needs: ['reasonCode', 'comment'] },
    duplicate: { who: TRIAGERS, guard: GUARDS.duplicate, needs: ['duplicateOf'] },
    known_exception: { who: TRIAGERS, guard: GUARDS.knownException, needs: ['exceptionId'] },
    cancelled: { who: TRIAGERS },
  },
  assigned: {
    accepted: { who: WORKERS },
    assigned: { who: TRIAGERS, guard: needsOpenTicket },
  },
  accepted: {
    in_progress: { who: WORKERS },
    pending: { who: WORKERS, guard: GUARDS.pendingReason, needs: ['pendingReason'] },
  },
  in_progress: {
    pending: { who: WORKERS, guard: GUARDS.pendingReason, needs: ['pendingReason'] },
    resolved: { who: WORKERS, guard: GUARDS.everyTicketHasFinding },
  },
  pending: {
    in_progress: { who: WORKERS },
    resolved: { who: WORKERS, guard: GUARDS.everyTicketHasFinding },
    cancelled: { who: ['assignee', 'admin'] },
  },
  resolved: {
    verification_pending: { who: ['system'] },
  },
  verification_pending: {
    approval_pending: { who: ['technician'], guard: GUARDS.verified },
    reopened: { who: ['technician', 'system'], guard: GUARDS.verificationFailed },
  },
  approval_pending: {
    approved: { who: APPROVERS, notResolver: true, guard: GUARDS.approve },
    rejected: { who: APPROVERS, notResolver: true, guard: needsCodeAndComment('reject'), needs: ['reasonCode', 'comment'] },
    rework: { who: APPROVERS, notResolver: true, guard: needsCodeAndComment('reject'), needs: ['reasonCode', 'comment'] },
  },
  rejected: {
    assigned: { who: ['admin'], guard: all(needsReason, needsOpenTicket), needs: ['reason'] },
    in_progress: { who: ['admin'], guard: needsReason, needs: ['reason'] },
    verification_pending: { who: ['admin'], guard: needsReason, needs: ['reason'] },
  },
  rework: {
    assigned: { who: ['admin'], guard: all(needsReason, needsOpenTicket), needs: ['reason'] },
    in_progress: { who: ['admin'], guard: needsReason, needs: ['reason'] },
    verification_pending: { who: ['admin'], guard: needsReason, needs: ['reason'] },
  },
  approved: {
    write_in_progress: { who: ['writer', 'system'], guard: all(GUARDS.hashStillStands, GUARDS.somethingToWrite) },
    completed: { who: ['writer', 'system'], guard: all(GUARDS.hashStillStands, GUARDS.nothingToWrite) },
    // The guard's own "else": the hash no longer stands, so the approval does
    // not either, and the plan goes back to be approved again.
    approval_pending: { who: ['system'] },
  },
  write_in_progress: {
    written: { who: ['system'] },
    write_failed: { who: ['system'] },
  },
  write_failed: {
    write_in_progress: { who: ['writer'], guard: all(GUARDS.hashStillStands, GUARDS.somethingToWrite) },
    manual_review: { who: ['writer'], guard: needsReason, needs: ['reason'] },
    rejected: { who: ['writer'], guard: needsCodeAndComment('reject'), needs: ['reasonCode', 'comment'] },
    approval_pending: { who: ['system'] },
  },
  manual_review: {
    write_in_progress: { who: ['writer'], guard: all(needsReason, GUARDS.hashStillStands, GUARDS.somethingToWrite), needs: ['reason'] },
    rejected: { who: ['writer'], guard: needsCodeAndComment('reject'), needs: ['reasonCode', 'comment'] },
    cancelled: { who: ['writer'], guard: needsReason, needs: ['reason'] },
    approval_pending: { who: ['system'] },
  },
  written: {
    completed: { who: ['system'], guard: GUARDS.postWritePassed },
    reopened: { who: ['system'], guard: GUARDS.postWriteFailed },
  },
  completed: {
    reopened: { who: ['admin'], guard: GUARDS.reopen, needs: ['reasonCode'] },
  },
  reopened: {
    assigned: { who: TRIAGERS, guard: needsOpenTicket },
  },
  cancelled: {},
  duplicate: {},
  known_exception: {},
};

// The plan follows its tickets. Any move between two working statuses, or from
// one to resolved, that the contract's table does not spell out is the plan
// catching up with a ticket: a second ticket raised while the first is being
// worked on, an incident resolved in ServiceNow before anybody pressed Accept.
for (const from of WORKING) {
  for (const to of [...WORKING, 'resolved']) {
    if (TRANSITIONS[from][to]) continue;
    TRANSITIONS[from][to] = {
      who: WORKERS, derived: true,
      guard: to === 'pending' ? GUARDS.pendingReason
        : to === 'resolved' ? GUARDS.everyTicketHasFinding : undefined,
    };
  }
}

/**
 * Does the approval on record still cover what a write would do? Null when it
 * does, else why not. The write asks this on its own, before anything else,
 * because the answer to "no" is not a refusal but a move: back to be approved.
 */
const approvalStands = (plan, ctx) => GUARDS.hashStillStands(plan, ctx);

/** The rule for one move, or null when the table has no such move. */
const rule = (from, to) => (TRANSITIONS[from] && TRANSITIONS[from][to]) || null;

/**
 * May `actor` move `plan` to `to`?
 *
 * { ok: true } or { ok: false, code, why }. `code` is 'transition' when the
 * table has no such move, 'role' when it is not this person's move to make,
 * and 'guard' when it is theirs but something is missing.
 */
function can(plan, to, actor, ctx = {}) {
  if (!plan) return { ok: false, code: 'transition', why: 'no such plan' };
  const r = rule(plan.status, to);
  if (!r) {
    return { ok: false, code: 'transition',
      why: `a plan that is ${words(plan.status)} cannot become ${words(to)}` };
  }
  const allowed = r.who.some((w) => WHO[w](plan, actor, ctx));
  if (!allowed) {
    const people = r.who.filter((w) => w !== 'system').map((w) => WHO_SENTENCE[w]);
    return { ok: false, code: 'role',
      why: people.length ? `This is for ${people.join(' or ')}.` : 'The server makes this move itself.' };
  }
  if (r.notResolver && isResolver(ctx.tickets, actor)) {
    return { ok: false, code: 'role',
      why: 'You resolved a ticket on this plan, so somebody else has to make this decision.' };
  }
  const why = r.guard ? r.guard(plan, ctx, actor) : null;
  if (why) return { ok: false, code: 'guard', why };
  return { ok: true };
}

/**
 * The moves `actor` may make on `plan` now. One entry per move the table
 * gives their role: { to, ready, why, needs }. `ready` is false when a guard
 * is not met yet, with the reason, so a screen can show the button and say
 * what is missing. The server's own moves are left out.
 */
function next(plan, actor, ctx = {}) {
  if (!plan || !TRANSITIONS[plan.status]) return [];
  const out = [];
  for (const [to, r] of Object.entries(TRANSITIONS[plan.status])) {
    if (r.derived) continue;
    const people = r.who.filter((w) => w !== 'system');
    if (!people.some((w) => WHO[w](plan, actor, ctx))) continue;
    // Separation of duties does not remove the move, it names who it is for.
    // Dropping it here left the approval screen saying "No move is open to you
    // on this drift." to the one person most likely to be looking at it - the
    // admin who resolved the tickets - with no button and no reason, which
    // reads as the workflow having broken rather than having worked. `ready:
    // false` with a why is what the rest of this function already does for a
    // guard that is not met, and it is what the screen knows how to render.
    // The bar itself is unchanged: can() still refuses with code 'role'.
    const blocked = r.notResolver && isResolver(ctx.tickets, actor)
      ? 'You resolved a ticket on this plan, so somebody else has to make this decision.'
      : null;
    const why = blocked || (r.guard ? r.guard(plan, ctx, actor) : null);
    out.push({ to, ready: !why, why: why || null, needs: r.needs || [], blockedByRole: Boolean(blocked) });
  }
  return out;
}

const words = (status) => String(status).replace(/_/g, ' ');

// -- Tickets ------------------------------------------------------------
const TICKET_MOVES = {
  accept: { from: ['open'], to: 'accepted', done: 'accepted' },
  start: { from: ['open', 'accepted', 'pending'], to: 'in_progress', done: 'started' },
  pending: { from: ['open', 'accepted', 'in_progress'], to: 'pending', done: 'put on hold' },
  resolve: { from: ['open', 'accepted', 'in_progress', 'pending'], to: 'resolved', done: 'resolved' },
};

/**
 * May `actor` do `action` (accept, start, pending, resolve) on `ticket`?
 *
 * The assignee may, an organization admin may, and the ServiceNow sync may
 * resolve. A site manager who is not the assignee may not: they assign for
 * their Site, they do not close somebody else's ticket. Pending needs a
 * reason from the list; a person resolving needs to say what they found.
 */
function canTicket(ticket, action, actor, ctx = {}) {
  const move = TICKET_MOVES[action];
  if (!move) return { ok: false, code: 'transition', why: `unknown ticket action '${action}'` };
  if (!ticket) return { ok: false, code: 'transition', why: 'no ticket on that item' };
  // A ticket ServiceNow closed with no notes is resolved but says nothing, and
  // approve and reject stay shut until it does. Resolving it again is how a
  // person records what was found.
  const recordingFinding = action === 'resolve' && ticket.status === 'resolved' && !text(ticket.finding);
  if (!move.from.includes(ticket.status) && !recordingFinding) {
    return { ok: false, code: 'transition',
      why: `a ticket that is ${words(ticket.status)} cannot be ${move.done}` };
  }
  const allowed = isAdmin(actor) || isTicketAssignee(ticket, actor)
    || (isSystem(actor) && action === 'resolve');
  if (!allowed) {
    return { ok: false, code: 'role', why: `this ticket is assigned to ${ticket.assignee || 'somebody else'}` };
  }
  if (action === 'pending' && !REASONS.pending.includes(ctx.pendingReason)) {
    return { ok: false, code: 'guard',
      why: `a pending reason is needed, one of: ${REASONS.pending.join(', ')}` };
  }
  if (action === 'resolve') {
    if (!isSystem(actor) && !text(ctx.finding)) {
      return { ok: false, code: 'guard', why: 'say what you found before resolving the ticket' };
    }
    if (ctx.disposition != null && ctx.disposition !== '' && !REASONS.disposition.includes(ctx.disposition)) {
      return { ok: false, code: 'guard',
        why: `the disposition has to be one of: ${REASONS.disposition.join(', ')}` };
    }
  }
  return { ok: true, to: move.to };
}

/**
 * The working status a plan's tickets put it in: the least advanced ticket
 * still open, or resolved when none is. Null when the plan has no tickets.
 */
function workingStatus(tickets) {
  const rows = tickets || [];
  if (!rows.length) return null;
  const open = rows.filter((t) => ['open', 'accepted', 'in_progress', 'pending'].includes(t.status));
  if (!open.length) return 'resolved';
  if (open.some((t) => t.status === 'open')) return 'assigned';
  if (open.some((t) => t.status === 'accepted')) return 'accepted';
  if (open.some((t) => t.status === 'in_progress')) return 'in_progress';
  return 'pending';
}

module.exports = {
  STATUSES, WORKING, TERMINAL, OPEN, PRIORITIES, RISKS, ITEM_DECISIONS, TICKET_STATUSES,
  REASONS, ROLES, SYSTEM, TRANSITIONS, TICKET_MOVES,
  ACTION_TRAITS, traitsOf, isTicketable, needsAssignFirst,
  can, next, rule, canTicket, workingStatus,
  approvalStage, needsSecondApproval, firstApproval, lastApproval, approvalStands,
  isSystem, isAdmin, isCreator, managesSite, isAssignee, isTicketAssignee, isResolver,
  isTechnicianOf, unassigned,
};
