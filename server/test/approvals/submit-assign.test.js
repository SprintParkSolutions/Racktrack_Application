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
  for (const u of [TECH, SPOC, MEMBER, MANAGER, ADMIN, OWNER, APPROVER, AUDITOR, ELSEWHERE]) {
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
    assert.equal(out.incident, null, 'no incident is raised from here yet');

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
    assert.equal(out.incident, null);
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
    assert.ok(service.list(MEMBER, {}).plans.some((p) => p.id === id), 'and it is in their plain list');
    assert.ok(!service.list(SPOC, { holder: 'me' }).plans.some((p) => p.id === id));

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
    const managers = service.queue(MANAGER).sections.map((s) => s.key);
    assert.ok(!managers.includes('triage'), 'a site manager has no triage section');
    assert.ok(managers.includes('mine'));
  });

  it('tells the phone who the check goes to, or why it goes to an admin', async () => {
    const id = draft();
    const to = await service.contacts(id, { actor: TECH });
    assert.equal(to.goesTo, 'spoc');
    assert.deepEqual(to.spoc, { name: 'dc007.spoc', email: 'dc007.spoc@dc007.example',
      title: 'SPOC of Site 32 - Office-Sprintpark', userId: 41, source: 'site' });
    assert.equal(to.siteSpoc.siteName, 'Office-Sprintpark');
    assert.deepEqual([to.why, to.whyText, to.others, to.everyone], [null, null, [], []]);
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
