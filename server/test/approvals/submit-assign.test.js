/**
 * A sent check goes straight to the SPOC of its site.
 *
 * The service against a throwaway database, with the people and the Sites
 * made by hand and the Site's SPOC handed in through spoc._setLookup. What is
 * pinned here is the new path end to end without a network:
 *
 *   - submit lands the check in `assigned`, with a holder and a ticket for
 *     each item sent, all to that one person, in one transaction
 *   - with nobody valid to give it to it waits in `triage`, says why, and the
 *     admins are told
 *   - the check then stays with its holder: it does not follow its tickets
 *   - the holder decides and approves whatever their role; their decision is
 *     the finding, and closes the ticket
 *   - the person who sent it is refused everywhere
 *   - only an organization admin reassigns (by RackTrack user id) or cancels
 *   - a check from before all this keeps the moves it had
 *   - a parked check leaves triage only when an admin names its holder
 *   - a check sent back for rework takes its tickets with it, reaches an
 *     admin's queue, and the sender's next comparison is a fresh draft
 *   - an account with no organization files under the Site's, and still sees
 *     its own check
 *   - nobody's queue lost a section it had before the SPOC change
 */
process.env.NODE_ENV = 'test';
process.env.RACKTRACK_SKIP_WORKER_POOL = '1';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, afterEach, before, beforeEach, describe, it } = require('node:test');

let tmp;
let store;
let service;
let spoc;
let bus;
let machine;

const user = (id, username, role, tenantId = 32, orgId = 1) => ({ id, username,
  email: `${username}@dc007.example`, role, organization_id: orgId, tenant_id: tenantId });
const TECH = user(39, 'dc007.tech', 'member');
const SPOC = user(41, 'dc007.spoc', 'site_manager');
const MEMBER = user(42, 'dc007.member', 'member');
const MANAGER = user(46, 'dc007.manager', 'site_manager');
const ADMIN = user(44, 'Aasritha', 'org_admin', 33);
const OWNER = user(47, 'dc007.owner', 'owner', 33);
const APPROVER = user(48, 'dc007.approver', 'approver');
const AUDITOR = user(43, 'dc007.auditor', 'auditor');
const ELSEWHERE = user(45, 'annex.member', 'member', 33);
// Two accounts that belong to no organization, and an admin of another one.
const PLATFORM = user(60, 'platform.owner', 'owner', null, null);
const LONER = user(61, 'platform.second', 'owner', null, null);
const OTHER_ORG = user(62, 'elsewhere.admin', 'org_admin', 90, 2);

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-submit-assign-'));
  process.env.RACKTRACK_APPROVALS_DB = path.join(tmp, 'approvals.db');
  process.env.RT_DATA_DIR = tmp;
  store = require('../../lib/approvals/store');
  service = require('../../lib/approvals/service');
  spoc = require('../../lib/approvals/spoc');
  bus = require('../../lib/approvals/bus');
  machine = require('../../lib/approvals/machine');
  const db = store.db();
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenants (id INTEGER PRIMARY KEY, name TEXT, slug TEXT,
      organization_id INTEGER, timezone TEXT, approver_user_id INTEGER, approver_email TEXT);
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT, email TEXT,
      role TEXT, tenant_id INTEGER, organization_id INTEGER, active INTEGER NOT NULL DEFAULT 1);
    INSERT INTO tenants (id, name, slug, organization_id, approver_user_id)
      VALUES (32, 'Office-Sprintpark', 'office', 1, 41);
    INSERT INTO tenants (id, name, slug, organization_id) VALUES (33, 'Annex', 'annex', 1);
  `);
  const add = db.prepare(`INSERT INTO users (id, username, email, role, tenant_id, organization_id, active)
    VALUES (?, ?, ?, ?, ?, ?, 1)`);
  for (const u of [TECH, SPOC, MEMBER, MANAGER, ADMIN, OWNER, APPROVER, AUDITOR, ELSEWHERE,
    PLATFORM, LONER, OTHER_ORG]) {
    add.run(u.id, u.username, u.email, u.role, u.tenant_id, u.organization_id);
  }
});

after(() => {
  try { store._reset(); } catch { /* already closed */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

let heard;
const listen = (event) => { const fn = (p) => heard.push({ event, ...p }); bus.on(event, fn); return () => bus.off(event, fn); };
let stop = [];
beforeEach(() => {
  heard = [];
  stop = ['assigned', 'reassign_needed', 'reassigned', 'submitted', 'approved', 'rejected',
    'approval_requested'].map(listen);
  spoc._setLookup((tenantId) => (Number(tenantId) === 32 ? { user_id: 41 } : null));
});
afterEach(() => { stop.forEach((off) => off()); spoc._setLookup(null); });

let n = 0;
const DEV = 'dev:SPHYB:u20';
const DEV2 = 'dev:SPHYB:u21';
const PORT = `if:${DEV}:1`;
const REBIND = 'dev:SPHYB:u30';
const changes = () => [
  { type: 'Manufacturer', uid: 'mfr:cisco', name: 'Cisco', action: 'create' },
  { type: 'Device', uid: DEV, name: 'Router U20', action: 'create' },
  { type: 'Interface', uid: PORT, name: 'Gi0/1', action: 'create' },
  { type: 'Device', uid: DEV2, name: 'FW U21', action: 'update', netboxId: 44,
    diff: { serial: { from: 'A', to: 'B' } } },
  { type: 'Device', uid: REBIND, name: 'SW U30', action: 'rebind', netboxId: 45, fromUid: 'dev:old:u30' },
];
function draft({ by = TECH, tenantId = 32, rows = changes() } = {}) {
  n += 1;
  return service.create({ scanId: 100 + n, rackId: `RK-SUBMIT${n}`, rackName: 'SP-HYB-RM01-R01-R1',
    report: { rackUid: `rack:${n}`, netboxUrl: 'http://netbox.test', counts: {}, warnings: [], orphans: [],
      changes: rows },
    actor: by, orgId: 1, tenantId }).plan.id;
}
const sent = (opts) => { const id = draft(opts); service.submit(id, { note: 'the router is on shelf U20', actor: (opts && opts.by) || TECH }); return id; };

describe('submit gives the check to the SPOC of its site', () => {
  it('lands in assigned with a holder and a ticket for each item sent, all to that one person', async () => {
    const id = draft();
    const out = await service.submitAndDispatch(id, { note: 'the router is on shelf U20', actor: TECH });
    assert.equal(out.plan.status, 'assigned');
    assert.equal(out.plan.spocUserId, 41);
    assert.equal(out.plan.submittedById, 39, 'the real sender is on the check, by id');
    assert.equal(out.plan.needsAdmin, null);
    assert.equal(out.holder.username, 'dc007.spoc');
    assert.equal(out.holder.source, 'site');
    assert.equal(out.holder.assignedBy, 'system');
    assert.deepEqual(out.holder.previous, []);
    assert.equal(out.needsAdmin, null);
    assert.equal(out.incident.system, 'none', 'with no ServiceNow the check lives in RackTrack alone');
    assert.ok(store.ticketsOf(id).every((t) => t.external.system === 'none' && t.external.planLevel),
      'and every ticket says the same');

    const tickets = store.ticketsOf(id);
    assert.deepEqual(tickets.map((t) => t.itemUid).sort(), [DEV, DEV2], 'a rebind has nothing to look at');
    for (const t of tickets) {
      assert.equal(t.assigneeUserId, 41);
      assert.equal(t.assignee, 'dc007.spoc');
      assert.equal(t.scope, 'check');
      assert.equal(t.status, 'open');
      assert.equal(t.question, 'the router is on shelf U20');
    }
    assert.equal(store.getItem(id, PORT).decision, 'ticketed', 'a port goes with its device');
    assert.equal(store.getItem(id, REBIND).decision, 'pending');

    const events = store.eventsOf(id).map((e) => [e.action, e.toStatus, e.reason]);
    assert.ok(events.some(([a, to, why]) => a === 'auto.assigned' && to === 'assigned'
      && why === 'goes to the site SPOC'));
    assert.ok(!events.some(([a]) => a === 'auto.triage'), 'it never passed through triage');
    assert.equal(store.eventsOf(id).find((e) => e.action === 'submit').payload.what, 'sent');

    const told = heard.filter((h) => h.event === 'assigned');
    assert.equal(told.length, 1);
    assert.equal(told[0].holder.userId, 41);
    assert.equal(told[0].source, 'site');
    assert.deepEqual(told[0].sender, { userId: 39, username: 'dc007.tech' });
    assert.equal(told[0].siteName, 'Office-Sprintpark');
    assert.deepEqual(told[0].targets.map((t) => t.uid).sort(), [DEV, DEV2, REBIND].sort());
    assert.ok(!heard.some((h) => h.event === 'reassign_needed'));

    // Sending it again changes nothing and tells nobody twice.
    const again = await service.submitAndDispatch(id, { actor: TECH });
    assert.equal(again.already, true);
    assert.equal(again.holder.username, 'dc007.spoc');
    assert.equal(heard.filter((h) => h.event === 'assigned').length, 1);
  });

  it('sends only what the technician ticked, and tickets only that', () => {
    const id = draft();
    const out = service.submit(id, { items: [DEV], actor: TECH });
    assert.equal(out.plan.status, 'assigned');
    assert.deepEqual(store.ticketsOf(id).map((t) => t.itemUid), [DEV]);
    assert.equal(store.getItem(id, DEV2).decision, 'not_applicable');
    assert.equal(store.ticketsOf(id)[0].question, 'Review this against the drift report.');
  });

  it('parks the check for an admin when there is nobody valid to give it to, and says why', () => {
    const cases = [
      ['no_spoc', () => spoc._setLookup(() => null), {}],
      ['spoc_is_sender', () => {}, { by: SPOC }],
      ['spoc_invalid', () => spoc._setLookup(() => ({ user_id: 43 })), {}],
      ['no_site', () => {}, { tenantId: null }],
    ];
    for (const [why, arrange, opts] of cases) {
      heard.length = 0;
      arrange();
      const id = draft(opts);
      const out = service.submit(id, { actor: opts.by || TECH });
      assert.equal(out.plan.status, 'triage', why);
      assert.equal(out.plan.spocUserId, null, why);
      assert.equal(out.plan.needsAdmin.why, why);
      assert.ok(out.plan.needsAdmin.text.endsWith('.'), 'a sentence an admin reads');
      assert.ok(out.plan.needsAdmin.at);
      assert.deepEqual(store.ticketsOf(id), [], 'nothing is ticketed to nobody');
      const event = store.eventsOf(id).find((e) => e.action === 'auto.triage');
      assert.equal(event.reason, why, 'the reason is on the move as well');
      const told = heard.filter((h) => h.event === 'reassign_needed');
      assert.equal(told.length, 1, why);
      assert.equal(told[0].why, why);
      assert.equal(told[0].text, out.plan.needsAdmin.text);
      assert.equal(told[0].rackId, out.plan.rackId);
      assert.ok(!heard.some((h) => h.event === 'assigned'));
      spoc._setLookup((tenantId) => (Number(tenantId) === 32 ? { user_id: 41 } : null));
    }
  });

  it('gives a trusted caller the same behaviour, minus the network', async () => {
    spoc._setLookup(null);
    const id = draft({ by: service.trustedActor('meera') });
    const out = service.submit(id, { actor: service.trustedActor('meera') });
    assert.equal(out.plan.status, 'triage', 'a throwaway database has no estate to ask');
    assert.equal(out.plan.needsAdmin.why, 'no_spoc');
    const nothing = await service.dispatch(id, { actor: service.trustedActor('meera') });
    assert.deepEqual(nothing, { holder: null, needsAdmin: out.plan.needsAdmin, incident: null });
  });
});

describe('a check stays with its holder', () => {
  it('does not follow its tickets, and the holder decides with the ticket still open', () => {
    const id = sent();
    // The old ticket moves still work, and the check does not move with them.
    const accepted = service.acceptTicket(id, DEV, { actor: SPOC });
    assert.equal(accepted.ticket.status, 'accepted');
    assert.equal(accepted.plan.status, 'assigned');
    service.startTicket(id, DEV, { actor: SPOC });
    assert.equal(store.getPlan(id).status, 'assigned');

    const out = service.decideItems(id, [
      { uid: DEV, decision: 'approved', note: 'it is the same router, one shelf down' },
      { uid: DEV2, decision: 'rejected', reasonCode: 'wrong_asset' },
      { uid: REBIND, decision: 'approved' },
    ], { actor: SPOC });
    assert.deepEqual(out.refused, []);
    assert.equal(out.applied.length, 3);
    assert.equal(out.plan.status, 'assigned', 'deciding items moves nothing');

    const t = store.getTicket(id, DEV);
    assert.equal(t.status, 'closed');
    assert.equal(t.closedWith, 'approved');
    assert.equal(t.finding, 'it is the same router, one shelf down', 'the decision is the finding');
    assert.equal(t.resolvedById, 41);
    assert.equal(store.getTicket(id, DEV2).finding, 'Decided at the desk with the drift report.');
    assert.equal(store.getItem(id, PORT).decision, 'approved', 'the port follows its device');

    // Every ticket is closed now, and the check is still with its holder.
    assert.equal(service.acceptTicket(id, DEV, { actor: SPOC }).code, 'transition');
    assert.equal(store.getPlan(id).status, 'assigned');
  });

  it('is decided and approved by its holder whatever their role, and by an admin in their place', () => {
    spoc._setLookup(() => ({ user_id: 42 }));
    const id = sent();
    assert.equal(store.getPlan(id).spocUserId, 42, 'a member is the SPOC here');
    for (const who of [MANAGER, APPROVER, ELSEWHERE]) {
      const no = service.decideItems(id, [{ uid: DEV, decision: 'approved' }], { actor: who });
      assert.ok(['role', 'not_found'].includes(no.code), `${who.username}: ${no.code}`);
    }
    const no = service.decideItems(id, [{ uid: DEV, decision: 'approved' }], { actor: MANAGER });
    assert.equal(no.why, 'Deciding this check is for its SPOC or an organization admin.');

    const rows = [DEV, DEV2, REBIND].map((uid) => ({ uid, decision: 'approved' }));
    assert.equal(service.decideItems(id, rows, { actor: MEMBER }).applied.length, 3);
    const out = service.approve(id, { comment: 'as the report shows', actor: MEMBER });
    assert.equal(out.plan.status, 'approved', 'straight from assigned');
    assert.equal(out.final, true);
    assert.equal(out.needsSecond, false, 'dual approval is off unless the organization turns it on');
    assert.equal(out.decision.approverId, 42);
    assert.equal(out.plan.payloadHash, out.decision.payloadHash);
    assert.ok(heard.some((h) => h.event === 'approved'));

    const byAdmin = sent();
    service.decideItems(byAdmin, [DEV, DEV2, REBIND].map((uid) => ({ uid, decision: 'rejected' })), { actor: ADMIN });
    assert.equal(service.approve(byAdmin, { actor: ADMIN }).plan.status, 'approved');
  });

  it('refuses the person who sent it everywhere, by id and else by username', () => {
    // An admin sends a check: even as an admin, it is not theirs to decide.
    const id = sent({ by: ADMIN });
    assert.equal(store.getPlan(id).status, 'assigned');
    const decide = service.decideItems(id, [{ uid: DEV, decision: 'approved' }], { actor: ADMIN });
    assert.equal(decide.code, 'role');
    assert.equal(decide.why, machine.SENDER_WHY);
    service.decideItems(id, [DEV, DEV2, REBIND].map((uid) => ({ uid, decision: 'approved' })), { actor: SPOC });
    for (const out of [service.approve(id, { actor: ADMIN }),
      service.reject(id, { reasonCode: 'other', comment: 'no', actor: ADMIN }),
      service.rework(id, { reasonCode: 'other', comment: 'no', actor: ADMIN })]) {
      assert.equal(out.code, 'role');
      assert.equal(out.why, machine.SENDER_WHY);
    }
    const view = service.get(id, ADMIN);
    assert.equal(view.can.decide, false);
    assert.deepEqual(view.can.blocked, { why: machine.SENDER_WHY });
    assert.equal(view.can.next.find((m) => m.to === 'approved').blockedByRole, true);
    assert.equal(view.can.cancel, true, 'an admin who sent it may still cancel it');
    assert.equal(service.approve(id, { actor: OWNER }).plan.status, 'approved', 'another admin may');

    // A check sent before the phone carried the user: a name and no id.
    const old = sent();
    store.updatePlan(old, { submittedById: null, submittedBy: 'dc007.SPOC', spocUserId: 41 });
    assert.equal(service.decideItems(old, [{ uid: DEV, decision: 'approved' }], { actor: SPOC }).why,
      machine.SENDER_WHY);
  });

  it('takes an incident state only from the list, and rejects with a record', () => {
    const id = sent();
    assert.equal(service.approve(id, { incidentState: 'done', actor: SPOC }).code, 'bad_request');
    assert.equal(service.reject(id, { reasonCode: 'other', comment: 'x', incidentState: 'nope', actor: SPOC }).code,
      'bad_request');
    store.updatePlan(id, { incident: { system: 'servicenow', number: 'INC1', sysId: 'abc', state: 'new' } });
    const back = service.rework(id, { reasonCode: 'insufficient_evidence', comment: 'the photo is blurred', actor: SPOC });
    assert.equal(back.plan.status, 'rework');
    assert.equal(back.decision.decision, 'rework', 'a held check records the decision, from assigned too');
    assert.equal(back.plan.incident.chosenState.state, 'on_hold');
    assert.equal(back.plan.incident.chosenState.byId, 41);
    const heardBack = heard.find((h) => h.event === 'rejected');
    assert.equal(heardBack.comment, 'the photo is blurred');

    // "Not mine" tells the admins, who give it to somebody else.
    const other = sent();
    const no = service.reject(other, { reasonCode: 'wrong_spoc', comment: 'I left that site', actor: SPOC });
    assert.equal(no.plan.status, 'rejected');
    const told = heard.filter((h) => h.event === 'reassign_needed');
    assert.equal(told.length, 1);
    assert.equal(told[0].why, 'wrong_spoc');
    assert.equal(told[0].text, 'I left that site');
  });

  it('parks the first of two signatures in approval_pending when the organization asks for two', () => {
    store.setSetting(1, 'dual_approval_risks', ['critical'], 44);
    try {
      const id = sent();
      store.updatePlan(id, { risk: 'critical' });
      service.decideItems(id, [DEV, DEV2, REBIND].map((uid) => ({ uid, decision: 'approved' })), { actor: SPOC });
      const first = service.approve(id, { actor: SPOC });
      assert.equal(first.final, false);
      assert.equal(first.needsSecond, true);
      assert.equal(first.plan.status, 'approval_pending');
      const asked = heard.find((h) => h.event === 'approval_requested');
      assert.equal(asked.stage, 'second');
      assert.equal(asked.firstApproverId, 41);
      assert.match(service.approve(id, { actor: SPOC }).why, /has to come from a different person/);
      assert.equal(service.approve(id, { actor: TECH }).code, 'role');
      const second = service.approve(id, { actor: APPROVER });
      assert.equal(second.plan.status, 'approved');
      assert.equal(second.stage, 'second');
    } finally {
      store.setSetting(1, 'dual_approval_risks', [], 44);
    }
    assert.deepEqual(service.DEFAULT_SETTINGS.dual_approval_risks, []);
  });
});

describe('only an organization admin reassigns or cancels', () => {
  it('gives a parked check to a RackTrack user, and a held one to somebody else with a reason', async () => {
    spoc._setLookup(() => null);
    const id = sent();
    assert.equal(store.getPlan(id).status, 'triage');

    const byManager = await service.assign(id, { userId: 42 }, { actor: MANAGER });
    assert.equal(byManager.code, 'role');
    assert.equal(byManager.why, 'Reassigning is for an organization admin.');
    assert.equal((await service.assign(id, { items: '*', assignee: 'Meera' }, { actor: ADMIN })).why,
      'Send { userId, reason }. A check goes to one person as a whole.');
    assert.equal((await service.assign(id, { userId: 39 }, { actor: ADMIN })).why,
      'dc007.tech sent this check, so it cannot go to them.');
    for (const notThem of [43, 45, 9999]) {
      const no = await service.assign(id, { userId: notThem }, { actor: ADMIN });
      assert.equal(no.code, 'bad_request', `user ${notThem}`);
      assert.match(no.why, /cannot be given this check/);
    }
    assert.equal(store.getPlan(id).status, 'triage', 'a refusal changes nothing');
    assert.deepEqual(store.ticketsOf(id), []);

    heard.length = 0;
    const out = await service.assign(id, { userId: 42 }, { actor: ADMIN });
    assert.equal(out.plan.status, 'assigned', 'no reason is needed out of triage');
    assert.equal(out.plan.spocUserId, 42);
    assert.equal(out.plan.needsAdmin, null);
    assert.equal(out.holder.source, 'admin');
    assert.equal(out.holder.assignedBy, 'Aasritha');
    assert.equal(out.previous, null);
    assert.equal(out.incident.system, 'none');
    assert.deepEqual(out.applied.map((a) => a.uid).sort(), [DEV, DEV2]);
    assert.ok(store.ticketsOf(id).every((t) => t.assigneeUserId === 42 && t.scope === 'check'));
    assert.equal(heard.filter((h) => h.event === 'assigned').length, 1);
    assert.equal(heard.find((h) => h.event === 'assigned').source, 'admin');
    assert.ok(!heard.some((h) => h.event === 'reassigned'), 'there was nobody to take it from');

    // A decided item stays decided when the check moves on.
    service.decideItems(id, [{ uid: DEV, decision: 'approved', note: 'seen' }], { actor: MEMBER });
    assert.equal((await service.assign(id, { userId: 41 }, { actor: ADMIN })).why,
      'Say why this check is going to somebody else.');
    assert.equal((await service.assign(id, { userId: 42, reason: 'again' }, { actor: ADMIN })).why,
      'This check is already with dc007.member.');
    heard.length = 0;
    const moved = await service.assign(id, { userId: 41, reason: 'on leave' }, { actor: OWNER });
    assert.equal(moved.plan.status, 'assigned');
    assert.equal(moved.plan.spocUserId, 41);
    assert.equal(moved.previous.username, 'dc007.member');
    assert.deepEqual(moved.holder.previous.map((p) => [p.userId, p.by, p.reason]), [[42, 'dc007.owner', 'on leave']]);
    assert.deepEqual(moved.applied.map((a) => a.uid), [DEV2], 'only what was still waiting');
    assert.equal(store.getItem(id, DEV).decision, 'approved');
    assert.equal(store.getTicket(id, DEV2).assigneeUserId, 41);
    assert.equal(store.getTicket(id, DEV2).history.length, 1, 'the old ticket is kept in its history');
    const event = store.eventsOf(id).find((e) => e.action === 'reassign');
    assert.deepEqual(event.payload, { from: 'dc007.member', to: 'dc007.spoc', reason: 'on leave' });
    assert.equal(heard.find((h) => h.event === 'reassigned').previous.userId, 42);
    assert.equal(heard.find((h) => h.event === 'assigned').holder.userId, 41);

    // The old holder no longer decides it; the new one does.
    assert.equal(service.decideItems(id, [{ uid: DEV2, decision: 'approved' }], { actor: MEMBER }).code, 'role');
    assert.equal(service.decideItems(id, [{ uid: DEV2, decision: 'approved' }], { actor: SPOC }).applied.length, 1);
  });

  it('lets nobody but an admin cancel a sent check, and the sender still cancels a draft', () => {
    const id = sent();
    for (const who of [SPOC, MANAGER]) {
      const no = service.cancel(id, { reason: 'not needed', actor: who });
      assert.equal(no.code, 'role', who.username);
    }
    assert.match(service.cancel(id, { actor: ADMIN }).why, /a reason is needed/);
    assert.equal(service.cancel(id, { reason: 'scanned the wrong rack', actor: ADMIN }).plan.status, 'cancelled');
    assert.ok(store.ticketsOf(id).every((t) => t.status === 'closed'));
    assert.equal(service.cancel(draft(), { actor: TECH }).plan.status, 'cancelled');
    // Triage is an admin's as well.
    assert.equal(service.triage(sent(), { priority: 'P2' }, { actor: MANAGER }).why,
      'Triage is for an organization admin.');
  });
});

describe('what each person is shown', () => {
  it('lists, opens and queues a check for a member who holds it, a rebind-only one included', () => {
    spoc._setLookup(() => ({ user_id: 42 }));
    const id = sent({ rows: [{ type: 'Device', uid: REBIND, name: 'SW U30', action: 'rebind', netboxId: 45 }] });
    assert.equal(store.getPlan(id).status, 'assigned');
    assert.deepEqual(store.ticketsOf(id), [], 'a rebind raises no ticket, so nothing but the holder ties them to it');

    const view = service.get(id, MEMBER);
    assert.ok(view, 'the holder opens it');
    assert.equal(view.holder.username, 'dc007.member');
    assert.deepEqual(view.sender, { userId: 39, username: 'dc007.tech', note: 'the router is on shelf U20' });
    assert.equal(view.siteSpoc.userId, 42);
    assert.equal(view.siteSpoc.siteLabel, 'Site 32');
    assert.equal(view.plan.siteName, 'Office-Sprintpark', 'the Site by name, for a holder who has no list of Sites');
    assert.equal(view.incident, null);
    assert.equal(view.incidentStates, null);
    assert.deepEqual([view.suggestions, view.overrides, view.changes], [[], [], []]);
    assert.equal(view.can.decide, true);
    assert.equal(view.can.modify, true);
    assert.equal(view.can.approve, true);
    assert.equal(view.can.reassign, false);
    assert.equal(view.can.assign, false);
    assert.equal(view.can.cancel, false);
    assert.equal(view.can.blocked, null);
    assert.equal(service.get(id, ELSEWHERE), null, 'a member of another Site does not');

    const mine = service.list(MEMBER, { holder: 'me' }).plans;
    assert.ok(mine.some((p) => p.id === id));
    assert.ok(mine.every((p) => p.holder === 'dc007.member'));
    assert.equal(mine.find((p) => p.id === id).sender, 'dc007.tech');
    assert.equal(mine.find((p) => p.id === id).siteName, 'Office-Sprintpark');
    assert.ok(mine.find((p) => p.id === id).receivedAt, 'when it reached them');
    assert.ok(service.list(MEMBER, {}).plans.some((p) => p.id === id), 'and it is in their plain list');
    assert.ok(!service.list(SPOC, { holder: 'me' }).plans.some((p) => p.id === id));
    // Somebody else's checks, by user id, are an admin's or an auditor's to list.
    assert.ok(service.list(ADMIN, { holder: 42 }).plans.some((p) => p.id === id));
    assert.ok(!service.list(MANAGER, { holder: 42 }).plans.some((p) => p.id === id),
      'for anybody else the filter means "mine"');

    const q = service.queue(MEMBER);
    assert.equal(q.sections[0].key, 'spoc');
    assert.equal(q.sections[0].title, 'Assigned to me');
    assert.ok(q.sections[0].plans.some((p) => p.id === id));

    // The sender reads their own check, with every decision greyed.
    const theirs = service.get(id, TECH);
    assert.equal(theirs.can.decide, false);
    assert.deepEqual(theirs.can.blocked, { why: machine.SENDER_WHY });
  });

  it('says who is a SPOC, and keeps triage and reassigning for the admins', () => {
    assert.equal(service.me(SPOC).can.spoc, true, 'the SPOC of Site 32, by setup');
    assert.equal(service.me(SPOC).can.approve, true);
    assert.equal(service.me(SPOC).can.registry, true);
    assert.equal(service.me(SPOC).can.triage, false);
    assert.equal(service.me(SPOC).can.assign, false);
    assert.equal(service.me(MANAGER).can.spoc, false);
    // The same address typed into another organization's setup makes nobody a SPOC there.
    store.db().prepare(`INSERT OR REPLACE INTO tenants (id, name, slug, organization_id, approver_email)
      VALUES (90, 'Elsewhere', 'elsewhere', 2, ?)`).run(MANAGER.email);
    assert.deepEqual(store.sitesWhereSpoc(MANAGER.id, MANAGER.email), [90]);
    assert.deepEqual(store.sitesWhereSpoc(MANAGER.id, MANAGER.email, 1), []);
    assert.equal(service.me(MANAGER).can.spoc, false);
    assert.equal(service.me(MANAGER).can.triage, false, 'a site manager no longer triages');
    assert.equal(service.me(MANAGER).can.reassign, false);
    assert.deepEqual([service.me(ADMIN).can.triage, service.me(ADMIN).can.assign, service.me(ADMIN).can.reassign,
      service.me(ADMIN).can.registry], [true, true, true, true]);
    assert.equal(service.me(AUDITOR).can.spoc, false);
    assert.equal(service.me(AUDITOR).can.registry, true);
    assert.equal(service.me(TECH).can.registry, false);

    const admins = service.queue(ADMIN).sections;
    assert.equal(admins.find((s) => s.key === 'triage').title, 'Needs an admin');
    assert.equal(admins.find((s) => s.key === 'approval_pending').title, 'Waiting for a second approval');
    // A site manager may not triage, but still reads the queues of their Site.
    const managers = service.queue(MANAGER).sections.map((s) => s.key);
    assert.ok(managers.includes('triage'), 'to read: can.triage above is what says who may act');
    assert.ok(!managers.includes('rework'), 'what was sent back is an admin\'s to give to somebody');
    assert.ok(managers.includes('mine'));
  });

  it('shows everybody the queues they saw before the SPOC change', () => {
    // A technician: their own checks and the verification queue of their Site, empty or not.
    const tech = service.queue(user(70, 'new.tech', 'member')).sections;
    assert.deepEqual(tech.map((s) => s.key), ['mine', 'verification_pending']);
    assert.equal(tech[1].title, 'Waiting for a verification scan');

    // A site manager: the five sections of their own Site, then the rest of it.
    spoc._setLookup(() => null);
    const parked = sent();
    const held = (spoc._setLookup(() => ({ user_id: 41 })), sent());
    const annex = (spoc._setLookup(() => null), sent({ by: ELSEWHERE, tenantId: 33 }));
    const q = service.queue(MANAGER).sections;
    assert.deepEqual(q.map((s) => s.key).filter((k) => k !== 'spoc'),
      ['triage', 'approval_pending', 'write_failed', 'manual_review', 'sla_breached', 'mine']);
    const idsOf = (key) => q.find((s) => s.key === key).plans.map((p) => p.id);
    assert.ok(idsOf('triage').includes(parked));
    assert.ok(!idsOf('triage').includes(annex), 'their own Site only');
    assert.ok(idsOf('mine').includes(held), 'a check that is with its SPOC');
    assert.ok(!idsOf('mine').includes(parked), 'no row is listed twice');

    // An admin: every Site of the organization, and what was sent back.
    const admin = service.queue(ADMIN).sections;
    assert.deepEqual(admin.map((s) => s.key).filter((k) => k !== 'spoc'),
      ['triage', 'rework', 'approval_pending', 'write_failed', 'manual_review', 'sla_breached']);
    assert.ok(admin.find((s) => s.key === 'triage').plans.some((p) => p.id === annex));
    assert.deepEqual(service.queue(APPROVER).sections.map((s) => s.key), ['approval_pending']);

    // And the lists behind the two queue pages answer the same people as before.
    const old = service.trustedActor('meera');
    const waiting = draft({ by: old });
    service.submit(waiting, { actor: old });
    service.assignLocal(waiting, [{ uid: DEV, assignee: 'sam' }, { uid: DEV2, assignee: 'sam' }], { actor: old });
    service.resolveTicket(waiting, DEV, { finding: 'it is there' }, { actor: old });
    service.resolveTicket(waiting, DEV2, { finding: 'it is there' }, { actor: old });
    assert.equal(store.getPlan(waiting).status, 'verification_pending');
    for (const who of [MEMBER, MANAGER, ADMIN, APPROVER, AUDITOR]) {
      assert.ok(service.list(who, { status: 'verification_pending' }).plans.some((p) => p.id === waiting),
        `${who.username} still finds it in the verification queue`);
    }
    assert.ok(!service.list(ELSEWHERE, { status: 'verification_pending' }).plans.some((p) => p.id === waiting));
    // What each menu row is gated on.
    assert.deepEqual([service.me(MEMBER).can.verify, service.me(MANAGER).can.verify, service.me(ADMIN).can.verify],
      [true, true, true]);
    assert.deepEqual([service.me(APPROVER).can.approve, service.me(ADMIN).can.approve, service.me(AUDITOR).can.audit],
      [true, true, true]);
    // Windows, exceptions and reports stay a site manager's, under a key of their own.
    assert.deepEqual([service.me(MANAGER).can.manage, service.me(ADMIN).can.manage, service.me(MEMBER).can.manage,
      service.me(APPROVER).can.manage], [true, true, false, false]);
  });

  it('tells the phone who the check goes to, or why it goes to an admin', async () => {
    const id = draft();
    const to = await service.contacts(id, { actor: TECH });
    assert.equal(to.goesTo, 'spoc');
    assert.deepEqual(to.spoc, { name: 'dc007.spoc', email: 'dc007.spoc@dc007.example',
      title: 'SPOC of Site 32 - Office-Sprintpark', userId: 41, source: 'site' });
    assert.equal(to.siteSpoc.siteName, 'Office-Sprintpark');
    assert.deepEqual([to.why, to.whyText, to.others, to.everyone], [null, null, [], []]);
    assert.ok('rack' in to && to.site === null, 'the keys the older phone builds read are still there');
    assert.ok(to.rack === null || typeof to.rack.name === 'string');
    assert.equal(to.assignable, undefined, 'who else it could go to is an admin\'s question');

    const own = await service.contacts(draft({ by: SPOC }), { actor: SPOC });
    assert.equal(own.goesTo, 'admin');
    assert.equal(own.spoc, null);
    assert.equal(own.siteSpoc, null);
    assert.equal(own.why, 'spoc_is_sender');
    assert.match(own.whyText, /also sent this check/);

    const forAdmin = await service.contacts(sent(), { actor: ADMIN });
    assert.deepEqual(forAdmin.assignable.map((u) => u.username).sort(),
      ['Aasritha', 'dc007.approver', 'dc007.manager', 'dc007.member', 'dc007.owner', 'dc007.spoc'].sort(),
      'the admins and everybody on the check\'s own site, less the auditor and the sender');
  });
});

describe('a parked check leaves triage only when an admin names its holder', () => {
  it('stays in triage while an admin decides its items and saves its priority', async () => {
    spoc._setLookup(() => null);
    const id = sent();
    assert.equal(store.getPlan(id).needsAdmin.why, 'no_spoc');
    const rows = [DEV, DEV2, REBIND].map((uid) => ({ uid, decision: 'approved' }));
    assert.equal(service.decideItems(id, rows, { actor: ADMIN }).applied.length, 3);
    const saved = service.triage(id, { priority: 'P2' }, { actor: ADMIN });
    assert.equal(saved.plan.status, 'triage');
    assert.equal(saved.plan.needsAdmin.why, 'no_spoc');
    assert.equal(saved.plan.spocUserId, null);
    assert.ok(saved.plan.triagedAt);

    const given = await service.assign(id, { userId: OWNER.id }, { actor: ADMIN });
    assert.equal(given.plan.status, 'assigned');
    assert.equal(given.plan.spocUserId, OWNER.id);
    assert.equal(given.plan.needsAdmin, null);
    assert.equal(service.approve(id, { actor: OWNER }).plan.status, 'approved');
  });

  it('a check with nothing to look at at the rack does the same', async () => {
    spoc._setLookup(() => null);
    const id = sent({ rows: [{ type: 'Device', uid: REBIND, name: 'SW U30', action: 'rebind', netboxId: 45 }] });
    assert.equal(store.getPlan(id).status, 'triage');
    const saved = service.triage(id, { priority: 'P3', risk: 'low' }, { actor: ADMIN });
    assert.equal(saved.plan.status, 'triage', 'not on to verification, where nobody can be given it');
    assert.equal(saved.plan.needsAdmin.why, 'no_spoc');
    const given = await service.assign(id, { userId: 42 }, { actor: ADMIN });
    assert.equal(given.plan.status, 'assigned');
    assert.equal(given.plan.needsAdmin, null);
  });

  it('a check from before the SPOC change, parked by nobody, still moves on once it is triaged', () => {
    spoc._setLookup(() => null);
    const id = sent();
    store.updatePlan(id, { needsAdmin: null });
    const rows = [DEV, DEV2, REBIND].map((uid) => ({ uid, decision: 'approved' }));
    assert.equal(service.decideItems(id, rows, { actor: ADMIN }).applied.length, 3);
    const saved = service.triage(id, { priority: 'P2' }, { actor: ADMIN });
    assert.notEqual(saved.plan.status, 'triage');
    assert.ok(store.eventsOf(id).some((e) => e.action === 'auto.assigned'));
  });
});

describe('a check sent back for rework', () => {
  const WHY = { reasonCode: 'insufficient_evidence', comment: 'The photo is blurry.' };

  it('takes its tickets with it, reaches an admin, and the next comparison is a fresh draft', () => {
    const id = sent();
    const before = store.getPlan(id);
    assert.ok(store.ticketsOf(id).length > 0);
    const back = service.rework(id, { ...WHY, actor: SPOC });
    assert.equal(back.plan.status, 'rework');
    for (const t of store.ticketsOf(id)) {
      assert.equal(t.status, 'closed');
      assert.equal(t.closedWith, 'rework');
    }
    const listed = (who) => service.queue(who).sections.filter((s) => s.plans.some((p) => p.id === id)).map((s) => s.key);
    assert.deepEqual(listed(SPOC).filter((k) => k !== 'mine'), [], 'nothing of it is left with the holder to work');
    assert.deepEqual(listed(ADMIN), ['rework']);
    assert.equal(service.queue(ADMIN).sections.find((s) => s.key === 'rework').title, 'Sent back for rework');

    // The technician compares the same rack again: the same differences.
    const again = service.create({ scanId: before.scanId, rackId: before.rackId, rackName: before.rackName,
      report: { rackUid: before.rackUid, netboxUrl: 'http://netbox.test', counts: {}, warnings: [], orphans: [],
        changes: changes() },
      actor: TECH, orgId: 1, tenantId: 32, reuse: true, ownOnly: true });
    assert.equal(again.reused, false);
    assert.notEqual(again.plan.id, id);
    assert.equal(again.plan.status, 'draft');
    const resent = service.submit(again.plan.id, { actor: TECH });
    assert.equal(resent.plan.status, 'assigned');
    assert.equal(resent.plan.spocUserId, 41);
  });

  it('an open check is still handed back, so a look at the screen files nothing new', () => {
    const id = sent();
    const before = store.getPlan(id);
    const again = service.create({ scanId: before.scanId, rackId: before.rackId, rackName: before.rackName,
      report: { rackUid: before.rackUid, netboxUrl: 'http://netbox.test', counts: {}, warnings: [], orphans: [],
        changes: changes() },
      actor: TECH, orgId: 1, tenantId: 32, reuse: true, ownOnly: true });
    assert.equal(again.reused, true);
    assert.equal(again.plan.id, id);
  });

  it('from approval_pending, on a check with no holder, closes nothing and still moves by hand', () => {
    const old = service.trustedActor('meera');
    spoc._setLookup(null);
    const id = draft({ by: old });
    service.submit(id, { actor: old });
    service.assignLocal(id, [{ uid: DEV, assignee: 'sam' }, { uid: DEV2, assignee: 'sam' }], { actor: old });
    service.resolveTicket(id, DEV, { finding: 'it is there' }, { actor: old });
    service.resolveTicket(id, DEV2, { finding: 'it is there' }, { actor: old });
    const skipped = service.skipVerification(id, { reason: 'the rack is sealed until Monday', actor: ADMIN });
    assert.equal(skipped.plan.status, 'approval_pending');
    const tickets = store.ticketsOf(id).map((t) => [t.itemUid, t.status, t.closedWith ?? null]);
    const back = service.rework(id, { ...WHY, actor: APPROVER });
    assert.equal(back.plan.status, 'rework');
    assert.deepEqual(store.ticketsOf(id).map((t) => [t.itemUid, t.status, t.closedWith ?? null]), tickets);
    const moved = service.moveByHand(id, { to: 'in_progress', reason: 'the technician is going back', actor: ADMIN });
    assert.equal(moved.plan.status, 'in_progress');
  });
});

describe('an account that belongs to no organization', () => {
  const file = (by) => { n += 1; return service.create({ scanId: 100 + n, rackId: `RK-SUBMIT${n}`,
    rackName: 'SP-HYB-RM01-R01-R1',
    report: { rackUid: `rack:${n}`, netboxUrl: 'http://netbox.test', counts: {}, warnings: [], orphans: [],
      changes: changes() },
    actor: by, orgId: by.organization_id ?? null, tenantId: 32 }); };

  it('files its check under the Site\'s organization, so it reaches the SPOC, and still sees it', async () => {
    const filed = file(PLATFORM);
    const id = filed.plan.id;
    assert.equal(filed.plan.orgId, 1);
    const out = await service.submitAndDispatch(id, { actor: PLATFORM });
    assert.equal(out.plan.status, 'assigned');
    assert.equal(out.plan.spocUserId, 41);
    assert.equal(out.plan.needsAdmin, null);
    assert.ok(heard.some((h) => h.event === 'assigned' && h.holder.userId === 41));

    assert.ok(service.get(id, PLATFORM), 'the account that sent it opens it');
    assert.ok(service.list(PLATFORM, {}).plans.some((p) => p.id === id), 'and finds it in its list');
    assert.ok(service.get(id, ADMIN), 'so does an admin of the Site\'s organization');
    assert.ok(service.list(ADMIN, {}).plans.some((p) => p.id === id));
    assert.equal(service.get(id, LONER), null, 'another account with no organization does not');
    assert.ok(!service.list(LONER, {}).plans.some((p) => p.id === id));
    assert.equal(service.get(id, OTHER_ORG), null, 'nor does another organization');
    assert.ok(!service.list(OTHER_ORG, {}).plans.some((p) => p.id === id));
    // The sender decides nothing on it, as anywhere else.
    assert.deepEqual(service.get(id, PLATFORM).can.blocked, { why: machine.SENDER_WHY });
  });

  it('is never handed somebody else\'s check of that organization', () => {
    const theirs = sent();
    const before = store.getPlan(theirs);
    const mine = service.create({ scanId: before.scanId, rackId: before.rackId, rackName: before.rackName,
      report: { rackUid: before.rackUid, netboxUrl: 'http://netbox.test', counts: {}, warnings: [], orphans: [],
        changes: changes() },
      actor: PLATFORM, orgId: null, tenantId: 32, reuse: true });
    assert.equal(mine.reused, false);
    assert.notEqual(mine.plan.id, theirs);
  });

  it('a Site that belongs to no organization leaves the check the account\'s own', () => {
    store.db().prepare("INSERT OR REPLACE INTO tenants (id, name, slug) VALUES (1, 'Default', 'default')").run();
    n += 1;
    const filed = service.create({ scanId: 100 + n, rackId: `RK-SUBMIT${n}`,
      report: { rackUid: `rack:${n}`, counts: {}, warnings: [], orphans: [], changes: changes() },
      actor: PLATFORM, orgId: null, tenantId: 1 });
    assert.equal(filed.plan.orgId, null);
    const out = service.submit(filed.plan.id, { actor: PLATFORM });
    assert.equal(out.plan.needsAdmin.why, 'no_site');
    assert.equal(out.plan.needsAdmin.text,
      'This check was sent from an account that belongs to no organization, so it has no SPOC.');
    assert.ok(service.get(filed.plan.id, PLATFORM));
    assert.equal(service.get(filed.plan.id, LONER), null);
  });
});

describe('the holder\'s own notes', () => {
  it('a member who holds the check may keep a note internal, and reads the internal thread', () => {
    spoc._setLookup(() => ({ user_id: 42 }));
    const id = sent();
    const kept = service.addComment(id, { body: 'Ask facilities about U21.', visibility: 'internal', actor: MEMBER });
    assert.equal(kept.comment.visibility, 'internal');
    assert.equal(service.addComment(id, { body: 'Looking at it now.', actor: MEMBER }).comment.visibility, 'shared',
      'said nothing, so shared, as a technician\'s always was');
    service.addComment(id, { body: 'Admin note.', visibility: 'internal', actor: ADMIN });

    const bodies = (who) => service.listComments(id, { actor: who }).comments.map((c) => c.body);
    assert.ok(bodies(MEMBER).includes('Ask facilities about U21.'));
    assert.ok(bodies(MEMBER).includes('Admin note.'));
    assert.ok(service.get(id, MEMBER).comments.some((c) => c.body === 'Admin note.'));
    assert.ok(!bodies(TECH).includes('Ask facilities about U21.'), 'the sender never reads the internal thread');
    assert.ok(bodies(TECH).includes('Looking at it now.'));
    assert.ok(!service.get(id, TECH).comments.some((c) => c.visibility === 'internal'));

    // A member who does not hold it is a technician like any other.
    const asked = service.addComment(id, { body: 'Mine, kept quiet?', visibility: 'internal', actor: TECH });
    assert.equal(asked.comment.visibility, 'shared');
  });
});

describe('a check from before the SPOC change', () => {
  it('keeps the moves it had: it follows its tickets to verification', () => {
    const by = service.trustedActor('meera');
    spoc._setLookup(null);
    const id = draft({ by });
    service.submit(id, { actor: by });
    service.assignLocal(id, [{ uid: DEV, assignee: 'sam' }, { uid: DEV2, assignee: 'sam' }], { actor: by });
    assert.equal(store.getPlan(id).status, 'assigned');
    assert.equal(store.getPlan(id).spocUserId, null);
    assert.equal(service.decideItems(id, [{ uid: DEV, decision: 'approved' }], { actor: by }).refused[0].why,
      'assign first', 'the old library still assigns before it decides');
    service.resolveTicket(id, DEV, { finding: 'it is there' }, { actor: by });
    service.resolveTicket(id, DEV2, { finding: 'it is there' }, { actor: by });
    assert.equal(store.getPlan(id).status, 'verification_pending', 'it still follows its tickets');
  });
});

describe('the phone routes hand over the signed-in user', () => {
  it('no longer submits or decides through the old library with a name', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'netbox', 'plans.js'), 'utf8');
    assert.doesNotMatch(src, /plans\.submit\(/);
    assert.doesNotMatch(src, /plans\.decide\(/);
    assert.match(src, /service\.submitAndDispatch\(/);
    assert.match(src, /service\.decideItems\([^)]*actor: req\.user/);
    assert.doesNotMatch(src, /req\.query\.assigneeId/, 'nobody claims a ticket from the query string');
  });
});
