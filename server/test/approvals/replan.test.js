/**
 * A change before approving: suggestions, overrides and the re-plan in place.
 *
 * The service against a throwaway database, the real writer, and the demo rack
 * in a NetBox held in memory (test/fixtures/demo_rack.js). The first test is
 * the owner's demo, hop by hop, in one go:
 *
 *   file - send - the SPOC holds it - the check suggests "same device, wrong
 *   shelf" - accept - compared again IN PLACE, same check number - approve -
 *   write - ONE patch, position 22 to 20, and nothing else - completed
 *
 * The box on U20 has eight camera-counted ports on purpose. After the accept
 * the check holds exactly ONE item to decide, the approval is not refused, and
 * no port is ever made on the customer's record.
 *
 * The final approval writes at once: the server does it, as the system, on the
 * approver's word (write.runAfterApproval, which is what the approve route
 * calls). So the tests below approve as the SPOC and read what became of the
 * write off that answer, and the demo ends on the one row a person sees in
 * the change registry: position 22 to 20 on SP-R1-U20-ACT.
 */
process.env.NODE_ENV = 'test';
process.env.RACKTRACK_SKIP_WORKER_POOL = '1';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { after, afterEach, before, beforeEach, describe, it } = require('node:test');

let tmp;
let store;
let service;
let write;
let writer;
let scans;
let spoc;
let shape;
let F;

const user = (id, username, role, tenantId = 32, orgId = 1) => ({ id, username,
  email: `${username}@dc007.example`, role, organization_id: orgId, tenant_id: tenantId });
const TECH = user(39, 'dc007.tech', 'member');
const SPOC = user(41, 'dc007.spoc', 'site_manager');
const ADMIN = user(44, 'Aasritha', 'org_admin', 33);

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-replan-'));
  process.env.RACKTRACK_APPROVALS_DB = path.join(tmp, 'approvals.db');
  process.env.RT_DATA_DIR = tmp;
  store = require('../../lib/approvals/store');
  service = require('../../lib/approvals/service');
  write = require('../../lib/approvals/write');
  shape = require('../../lib/approvals/shape');
  spoc = require('../../lib/approvals/spoc');
  writer = require('../../lib/netbox/writer');
  scans = require('../../lib/netbox/store');
  F = require('../fixtures/demo_rack');
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
  for (const u of [TECH, SPOC, ADMIN]) add.run(u.id, u.username, u.email, u.role, u.tenant_id, u.organization_id);
});

after(() => {
  try { store._reset(); } catch { /* already closed */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => { spoc._setLookup((tenantId) => (Number(tenantId) === 32 ? { user_id: 41 } : null)); });
afterEach(() => { spoc._setLookup(null); service._setCompare(null); });

let racks = 0;
/**
 * A rack scanned, compared and filed as the phone does it: the scan is kept,
 * the comparison is the real writer's against `nb`, and the check is filed by
 * the technician. Each call is a rack of its own, so checks do not meet.
 */
async function filed(nb, { boxes = [], send = true, items = null, tweak = null } = {}) {
  racks += 1;
  const rackId = `RK-REPLAN${racks}`;
  const snapshot = () => { const snap = F.demoSnapshot({ boxes }); if (tweak) tweak(snap); return snap; };
  const scan = scans.addScan({ rackId, source: 'adopted', rackName: 'SP-HYB-RM01-R01-R1',
    payload: { snapshot: snapshot(), tenantId: 32, rackName: 'SP-HYB-RM01-R01-R1' } });
  service._setCompare({ client: () => nb.client() });
  const preview = async () => service.createFromPreview({ scan: scans.getScan(scan.id), snap: snapshot(),
    report: await writer.plan(snapshot(), nb.client()), actor: TECH, tenantId: 32, reuse: true });
  const first = await preview();
  if (send) {
    const out = await service.submitAndDispatch(first.plan.id, { note: 'the router is on shelf U20', items, actor: TECH });
    assert.equal(out.plan.status, 'assigned', out.why);
  }
  return { id: first.plan.id, rackId, preview, scanId: scan.id };
}
/** The write a final approval starts, as the approve route runs it: by the system, in the approver's name. */
const writeFor = (check, nb, approver = SPOC) => write.runAfterApproval(check.id, { approver, client: nb.client() });
const sidOf = (got, rule) => got.suggestions.find((s) => s.rule === rule && s.state === 'open');
const decidable = (got) => got.items.filter((i) => i.decidable);
const SERVER = () => F.cameraBox('Server', 0, ['u05']);
const U05 = () => `dev:${F.RACK_KEY}:u5`;

describe('the demo, end to end', () => {
  it('files, sends, suggests the wrong shelf, accepts, re-plans in place, approves, and writes one patch', async () => {
    const nb = F.seedDemoRack(F.fakeNetBox());
    const check = await filed(nb);

    // With the SPOC, who is shown one suggestion with its five sentences.
    const opened = service.get(check.id, SPOC);
    assert.equal(opened.plan.status, 'assigned');
    assert.equal(opened.holder.username, 'dc007.spoc');
    assert.equal(opened.can.modify, true);
    assert.equal(opened.suggestionsNote, null);
    assert.deepEqual(opened.suggestions.map((s) => [s.rule, s.state]), [['wrong_shelf', 'open']]);
    const [s] = opened.suggestions;
    assert.equal(s.title, 'Same device, wrong shelf: move record SP-R1-U20-ACT from U22 to U20');
    assert.equal(s.word, 'likely');
    assert.deepEqual(s.evidence, [
      'The record\'s own name says U20.',
      'Same class: the record is a Router and the photo shows a Router.',
      'It is the only network record in this rack that the photo did not show.',
      'U20 is empty in NetBox.',
      'U22 is empty in the photo.',
    ]);
    assert.equal(opened.items.filter((i) => i.type === 'Interface' && i.following).length, 8,
      'the box brings its eight ports, which follow it');
    assert.deepEqual(decidable(opened).map((i) => [i.uid, i.action, i.decision]), [[F.U20, 'create', 'ticketed']]);
    assert.deepEqual(opened.plan.orphans.map((o) => o.netboxId), [F.RECORD_ID]);

    // The person who sent it changes nothing.
    const barred = await service.acceptSuggestion(check.id, s.id, { actor: TECH });
    assert.equal(barred.code, 'role');

    // Accept. The same check, compared again in place.
    const accepted = await service.acceptSuggestion(check.id, s.id, { actor: SPOC });
    assert.equal(accepted.error, undefined, accepted.why);
    assert.equal(accepted.plan.id, check.id, 'the same check number');
    assert.equal(accepted.replanned, true);
    assert.notEqual(accepted.plan.fingerprint, opened.plan.fingerprint);
    assert.equal(accepted.plan.baseFingerprint, opened.plan.fingerprint, 'what it was filed as is kept');
    assert.equal(accepted.plan.payloadHash, null);
    assert.deepEqual(decidable(accepted).map((i) => [i.uid, i.action, i.decision]), [[F.U20, 'rebind', 'approved']],
      'exactly one item to decide, and it is decided');
    assert.equal(accepted.items.filter((i) => i.type === 'Interface').length, 0, 'no port rows were added');
    assert.equal(accepted.plan.summary.pending + accepted.plan.summary.ticketed, 0);
    assert.equal(accepted.plan.summary.supporting, 0, 'and nothing is made for a box that is the customer\'s record');
    assert.deepEqual(accepted.plan.orphans, [], 'the record is no longer one the scan did not see');

    const item = accepted.items.find((i) => i.uid === F.U20);
    assert.deepEqual(item.diff.position, { from: 22, to: 20 });
    assert.equal(item.netboxId, F.RECORD_ID);
    assert.equal(item.decidedBy, 'dc007.spoc');
    const { at, ...modified } = item.modified;
    assert.ok(at);
    assert.deepEqual(modified, { overrideId: accepted.overrides[0].id, kind: 'move', source: 'suggestion',
      rule: 'wrong_shelf', by: 'dc007.spoc', byId: 41, note: null, recordName: 'SP-R1-U20-ACT',
      original: { action: 'create', diff: null, name: 'Router U20 SP-HYB-RM01-R01-R1' } });
    assert.deepEqual(accepted.overrides.map((o) => [o.kind, o.itemUid, o.netboxId, o.recordName, o.fields, o.source, o.rule, o.createdBy]),
      [['move', F.U20, F.RECORD_ID, 'SP-R1-U20-ACT', { position: { from: 22, to: 20 } }, 'suggestion', 'wrong_shelf', 'dc007.spoc']]);
    assert.deepEqual(accepted.suggestions.map((x) => [x.id, x.state, x.stateBy, x.overrideId]),
      [[s.id, 'accepted', 'dc007.spoc', accepted.overrides[0].id]], 'the card stays, as it was accepted');
    assert.deepEqual(accepted.suggestions[0].evidence, s.evidence);
    assert.equal(store.ticketsOf(check.id).filter(shape.isOpenTicket).length, 0, 'the ticket closed with the decision');
    const said = store.eventsOf(check.id).find((e) => e.action === 'suggestion.accept');
    assert.deepEqual(said.payload.evidence, s.evidence, 'why it was accepted is kept in the history');
    assert.ok(store.eventsOf(check.id).some((e) => e.action === 'replan'
      && e.payload.before.fingerprint === opened.plan.fingerprint && e.payload.after.fingerprint === accepted.plan.fingerprint));
    assert.equal(nb.writes().length, 0, 'nothing is in NetBox yet');
    assert.equal(nb.record().position, 22);

    // The technician looks at the rack's drift check again: the SAME check, not a second draft.
    const again = await check.preview();
    assert.equal(again.reused, true);
    assert.equal(again.plan.id, check.id);
    assert.equal(store.listPlans({ rackId: check.rackId }).length, 1);

    // Approve. It is not refused: nothing is left undecided.
    const approved = service.approve(check.id, { actor: SPOC });
    assert.equal(approved.error, undefined, approved.why);
    assert.equal(approved.plan.status, 'approved');
    assert.equal(approved.final, true);

    // The approval writes: the system does it, on the SPOC's word.
    const from = nb.calls.length;
    const before = structuredClone(nb.record());
    const out = await writeFor(check, nb);
    assert.deepEqual([out.write.state, out.write.status, out.write.written, out.write.failed, out.write.changes, out.write.why],
      ['written', 'completed', 1, 0, 1, null]);
    assert.equal(out.plan.status, 'completed');
    const writes = nb.writes(from);
    assert.equal(writes.length, 1, JSON.stringify(writes));
    assert.equal(writes[0].method, 'PATCH');
    assert.equal(writes[0].path, `${F.DEVICES}${F.RECORD_ID}/`);
    assert.deepEqual(Object.keys(writes[0].body).sort(), ['custom_fields', 'position']);
    assert.equal(writes[0].body.position, 20);
    assert.deepEqual(Object.keys(writes[0].body.custom_fields).sort(), ['racktrack_bound', 'racktrack_uid']);
    assert.equal(nb.calls.slice(from).filter((c) => c.method === 'POST' && c.path === F.INTERFACES).length, 0,
      'zero ports made on the customer\'s record');
    assert.equal(nb.calls.slice(from).filter((c) => c.method === 'POST').length, 0);
    const after = nb.record();
    assert.equal(after.position, 20);
    for (const field of ['name', 'rack', 'site', 'role', 'device_type', 'tenant', 'face', 'status', 'serial']) {
      assert.deepEqual(after[field], before[field], `${field} is as the customer had it`);
    }
    assert.equal(nb.rows(F.INTERFACES).length, 5);
    assert.equal(service.get(check.id, SPOC).plan.status, 'completed');
    // The change registry: one row a person sees, and RackTrack's own link fields kept out of sight.
    const rows = store.changesOf(check.id);
    const seen = rows.filter((c) => !c.internal);
    assert.deepEqual(seen.map((c) => [c.objectName, c.action, c.field, c.before, c.after, c.result, c.source, c.rule,
      c.approvedBy, c.writtenBy]),
    [['SP-R1-U20-ACT', 'rebind', 'position', 22, 20, 'written', 'suggestion', 'wrong_shelf', 'dc007.spoc', 'system']]);
    assert.ok(rows.length > 1 && rows.every((c) => c.internal || c === seen[0]));
    assert.equal(store.getPlan(check.id, { heavy: false }).writtenBy, 'system');
  });
});

describe('a re-plan keeps what still stands and asks again about what changed', () => {
  it('keeps the decision on an item that is the same to the byte, and one a technician did not send', async () => {
    const nb = F.seedDemoRack(F.fakeNetBox());
    const check = await filed(nb, { boxes: [SERVER(), F.cameraBox('Firewall', 0, ['u07'])],
      items: [F.U20, U05()] });
    const rejected = service.decideItems(check.id, [{ uid: U05(), decision: 'rejected', reasonCode: 'wrong_asset',
      note: 'not ours' }], { actor: SPOC });
    assert.deepEqual(rejected.applied, [{ uid: U05(), decision: 'rejected' }]);
    const s = sidOf(service.get(check.id, SPOC), 'wrong_shelf');
    assert.ok(s, 'two boxes of other kinds beside it do not stop the suggestion');

    const got = await service.acceptSuggestion(check.id, s.id, { note: 'checked with the rack', actor: SPOC });
    assert.equal(got.error, undefined, got.why);
    const byUid = new Map(got.items.map((i) => [i.uid, i]));
    assert.deepEqual([byUid.get(U05()).decision, byUid.get(U05()).note, byUid.get(U05()).reasonCode, byUid.get(U05()).decidedBy],
      ['rejected', 'not ours', 'wrong_asset', 'dc007.spoc']);
    const left = byUid.get(`dev:${F.RACK_KEY}:u7`);
    assert.equal(left.decision, 'not_applicable');
    assert.match(left.note, /^Not sent by dc007\.tech/);
    assert.equal(byUid.get(F.U20).decision, 'approved');
    assert.equal(byUid.get(F.U20).modified.note, 'checked with the rack');
    assert.ok(got.plan.summary.supporting > 0, 'the other boxes still bring what they need');
  });

  it('takes a change back: the items the scan proposed return, undecided, and the suggestion is open again', async () => {
    const nb = F.seedDemoRack(F.fakeNetBox());
    const check = await filed(nb);
    const before = service.get(check.id, SPOC);
    const accepted = await service.acceptSuggestion(check.id, sidOf(before, 'wrong_shelf').id, { actor: SPOC });
    const back = await service.revokeOverride(check.id, accepted.overrides[0].id, { actor: SPOC });
    assert.equal(back.error, undefined, back.why);
    assert.equal(back.plan.fingerprint, before.plan.fingerprint);
    assert.deepEqual(back.overrides, []);
    assert.deepEqual(store.overridesOf(check.id, { active: false }).map((o) => Boolean(o.revokedAt)), [true],
      'the change is still on the record, taken back');
    assert.deepEqual(decidable(back).map((i) => [i.uid, i.action, i.decision, i.modified]), [[F.U20, 'create', 'pending', undefined]]);
    assert.equal(back.items.filter((i) => i.following).length, 8);
    assert.deepEqual(back.suggestions.map((x) => [x.rule, x.state]), [['wrong_shelf', 'open']]);
    assert.deepEqual(back.plan.orphans.map((o) => o.netboxId), [F.RECORD_ID]);
    assert.equal((await service.revokeOverride(check.id, accepted.overrides[0].id, { actor: SPOC })).code, 'not_found');
    assert.equal((await service.revokeOverride(check.id, 99999, { actor: SPOC })).code, 'not_found');
  });

  it('stores nothing when NetBox cannot be compared, or when the comparison does not show the change', async () => {
    const nb = F.seedDemoRack(F.fakeNetBox());
    const check = await filed(nb);
    const before = service.get(check.id, SPOC);
    const s = sidOf(before, 'wrong_shelf');
    const untouched = () => {
      const now = service.get(check.id, SPOC);
      assert.equal(now.plan.fingerprint, before.plan.fingerprint);
      assert.equal(now.plan.version, before.plan.version);
      assert.deepEqual(now.overrides, []);
      assert.deepEqual(store.overridesOf(check.id, { active: false }), []);
      assert.deepEqual(now.suggestions.map((x) => x.state), ['open']);
    };

    service._setCompare({ client: () => nb.client(), writer: { plan: async () => { throw new Error('ECONNREFUSED'); } } });
    const down = await service.acceptSuggestion(check.id, s.id, { actor: SPOC });
    assert.equal(down.code, 'guard');
    assert.equal(down.why, 'NetBox could not be compared, so the change was not applied.');
    untouched();

    // Somebody moved the record in NetBox after the check was filed.
    service._setCompare({ client: () => nb.client() });
    nb.record().position = 23;
    const moved = await service.acceptSuggestion(check.id, s.id, { actor: SPOC });
    assert.equal(moved.code, 'guard');
    assert.match(moved.why, /the shelf was 22 and is now 23/);
    untouched();
  });

  it('compared again by the system, a change NetBox no longer takes is taken back and nothing is decided for anybody', async () => {
    const nb = F.seedDemoRack(F.fakeNetBox());
    const check = await filed(nb, { boxes: [SERVER()] });
    await service.decide(check.id, [{ uid: U05(), decision: 'approved' }], { actor: SPOC });
    const accepted = await service.acceptSuggestion(check.id, sidOf(service.get(check.id, SPOC), 'wrong_shelf').id, { actor: SPOC });
    nb.record().position = 24;   // somebody moved the record in NetBox

    const machine = require('../../lib/approvals/machine');
    const out = await service.replan(check.id, { actor: { ...machine.SYSTEM, orgId: 1 }, why: 'netbox_changed' });
    assert.equal(out.error, undefined, out.why);
    const now = service.get(check.id, SPOC);
    assert.deepEqual(now.overrides, []);
    assert.deepEqual(store.overridesOf(check.id, { active: false }).map((o) => [o.id, o.revokedBy]),
      [[accepted.overrides[0].id, 'system']]);
    const byUid = new Map(now.items.map((i) => [i.uid, i]));
    assert.deepEqual([byUid.get(F.U20).action, byUid.get(F.U20).decision], ['create', 'pending'], 'asked of a person again');
    assert.equal(byUid.get(U05()).decision, 'approved', 'what did not change stays decided');
    const open = sidOf(now, 'wrong_shelf');
    assert.equal(open.title, 'Same device, wrong shelf: move record SP-R1-U20-ACT from U24 to U20',
      'and the suggestion is worked out again from NetBox as it is now');
  });

  it('is only for a check that is with the person deciding it', async () => {
    const nb = F.seedDemoRack(F.fakeNetBox());
    const draft = await filed(nb, { send: false });
    assert.equal((await service.replan(draft.id, { actor: ADMIN })).code, 'transition');
    const check = await filed(nb);
    assert.equal((await service.replan(check.id, { actor: TECH })).code, 'role');
    service.approve(check.id, { actor: ADMIN });   // nothing approved yet, so this is refused and the check stays put
    const s = sidOf(service.get(check.id, SPOC), 'wrong_shelf');
    await service.acceptSuggestion(check.id, s.id, { actor: SPOC });
    assert.equal(service.approve(check.id, { actor: SPOC }).plan.status, 'approved');
    const late = await service.revokeOverride(check.id, service.get(check.id, SPOC).overrides[0].id, { actor: SPOC });
    assert.equal(late.code, 'transition', 'an approved check is not changed under its approval');
  });
});

describe('a rejected move', () => {
  it('takes the move back, so the write goes through and the check does not reopen', async () => {
    const nb = F.seedDemoRack(F.fakeNetBox());
    const check = await filed(nb, { boxes: [SERVER()] });
    const accepted = await service.acceptSuggestion(check.id, sidOf(service.get(check.id, SPOC), 'wrong_shelf').id, { actor: SPOC });
    assert.equal(accepted.items.find((i) => i.uid === F.U20).action, 'rebind');

    const out = await service.decide(check.id, [
      { uid: F.U20, decision: 'rejected', reasonCode: 'wrong_asset', note: 'a different router' },
      { uid: U05(), decision: 'approved' },
    ], { actor: SPOC });
    assert.equal(out.error, undefined, out.why);
    assert.equal(out.replanned, true);
    assert.deepEqual(out.applied.map((a) => [a.uid, a.decision]).sort(), [[F.U20, 'rejected'], [U05(), 'approved']].sort());
    const now = service.get(check.id, SPOC);
    assert.deepEqual(now.overrides, [], 'no rejected move is left laid over the scan');
    assert.deepEqual(now.items.filter((i) => i.uid === F.U20).map((i) => [i.action, i.decision]), [['create', 'rejected']]);

    assert.equal(service.approve(check.id, { actor: SPOC }).plan.status, 'approved');
    const from = nb.calls.length;
    const written = await writeFor(check, nb);
    assert.deepEqual([written.write.state, written.write.status], ['written', 'completed'], JSON.stringify(written.write));
    const posted = nb.calls.slice(from).filter((c) => c.method === 'POST' && c.path === F.DEVICES);
    assert.deepEqual(posted.map((c) => c.body.position), [5], 'the approved server was made');
    assert.deepEqual(nb.writes(from).filter((c) => c.path === `${F.DEVICES}${F.RECORD_ID}/`), []);
    assert.equal(nb.record().position, 22);
  });
});

describe('Mark Offline', () => {
  it('writes status offline on a record the scan did not see, and never deletes', async () => {
    const nb = F.seedDemoRack(F.fakeNetBox(), { position: 11, role: { id: 8, name: 'Switch', slug: 'switch' } });
    nb.record().name = 'SP-R1-CORE-SW';
    const check = await filed(nb);
    const opened = service.get(check.id, SPOC);
    assert.deepEqual(opened.suggestions.map((s) => s.rule), ['mark_offline']);
    const s = opened.suggestions[0];
    assert.equal(s.title, 'Record not seen: mark SP-R1-CORE-SW offline');
    assert.equal(s.acceptLabel, 'Mark offline');

    const accepted = await service.acceptSuggestion(check.id, s.id, { actor: SPOC });
    assert.equal(accepted.error, undefined, accepted.why);
    const made = accepted.items.find((i) => i.synthetic === 'offline');
    assert.deepEqual([made.type, made.action, made.name, made.netboxId, made.decision, made.decidable],
      ['Device', 'update', 'SP-R1-CORE-SW', F.RECORD_ID, 'approved', true]);
    assert.deepEqual(made.diff, { status: { from: 'active', to: 'offline' } });
    assert.deepEqual([made.modified.kind, made.modified.rule, made.modified.original], ['offline', 'mark_offline', null]);
    assert.doesNotMatch(made.name, /nb:device/);
    assert.deepEqual(accepted.overrides.map((o) => [o.kind, o.itemUid, o.netboxId]), [['offline', null, F.RECORD_ID]]);

    // The new box on U20 is somebody else's question; here it is turned down.
    await service.decide(check.id, [{ uid: F.U20, decision: 'rejected', reasonCode: 'wrong_asset', note: 'a loan unit' }], { actor: SPOC });
    assert.equal(service.approve(check.id, { actor: SPOC }).plan.status, 'approved');
    const from = nb.calls.length;
    const out = await writeFor(check, nb);
    assert.deepEqual([out.write.state, out.write.status], ['written', 'completed'], JSON.stringify(out.write));
    assert.deepEqual(nb.writes(from).map((c) => [c.method, c.path, c.body]),
      [['PATCH', `${F.DEVICES}${F.RECORD_ID}/`, { status: 'offline' }]],
      'one patch, and nothing made for the box that was turned down');
    assert.equal(nb.calls.filter((c) => c.method === 'DELETE').length, 0);
    assert.deepEqual(nb.record().status, { value: 'offline' });
    assert.equal(nb.record().name, 'SP-R1-CORE-SW');
    assert.equal(nb.record().position, 11, 'it keeps its shelf, and everything else');
    // The registry names the record, and the record was read before and after by its own id.
    assert.deepEqual(store.changesOf(check.id).filter((c) => !c.internal)
      .map((c) => [c.objectName, c.field, c.before, c.after, c.result, c.source, c.rule]),
    [['SP-R1-CORE-SW', 'status', 'active', 'offline', 'written', 'suggestion', 'mark_offline']]);
    const kept = store.getPlan(check.id);
    assert.deepEqual([kept.preSnapshot, kept.postSnapshot].map((snap) => snap.objects
      .filter((o) => o.netboxId === F.RECORD_ID).map((o) => [o.present, o.fields.status])),
    [[[true, 'active']], [[true, 'offline']]]);
  });

  it('rejecting the mark takes it back and writes nothing on the record', async () => {
    const nb = F.seedDemoRack(F.fakeNetBox(), { position: 11, role: { id: 8, name: 'Switch', slug: 'switch' } });
    nb.record().name = 'SP-R1-CORE-SW';
    const check = await filed(nb);
    const accepted = await service.acceptSuggestion(check.id, service.get(check.id, SPOC).suggestions[0].id, { actor: SPOC });
    const uid = accepted.items.find((i) => i.synthetic === 'offline').uid;
    const out = await service.decide(check.id, [{ uid, decision: 'rejected', reasonCode: 'wrong_asset', note: 'it is in the lab' }],
      { actor: SPOC });
    assert.deepEqual(out.applied, [{ uid, decision: 'rejected' }]);
    const now = service.get(check.id, SPOC);
    assert.deepEqual(now.overrides, []);
    assert.equal(now.items.some((i) => i.synthetic === 'offline'), false);
    assert.deepEqual(now.suggestions.map((s) => [s.rule, s.state]), [['mark_offline', 'open']]);
  });
});

describe('a value changed by hand', () => {
  /** After the demo write: 199 on U20 carrying our uid and the mark. The box is found, and only its serial is a gap. */
  const afterTheDemo = () => {
    const nb = F.seedDemoRack(F.fakeNetBox(), { position: 20 });
    nb.record().custom_fields = { racktrack_uid: F.U20, racktrack_bound: 'bound by dc007.spoc' };
    return nb;
  };

  it('changes a serial, an asset tag or a description, and is approved with the change on it', async () => {
    const nb = F.seedDemoRack(F.fakeNetBox());
    const check = await filed(nb, { boxes: [SERVER()] });
    const out = await service.decide(check.id, [{ uid: U05(), decision: 'modified', note: 'read off the label',
      modified: { serial: ' FOC1234A1BC ', asset_tag: 'A-100', description: 'build server' } }], { actor: SPOC });
    assert.equal(out.error, undefined, out.why);
    assert.deepEqual(out.applied, [{ uid: U05(), decision: 'approved', modified: true }]);
    assert.equal(out.replanned, true);
    const got = service.get(check.id, SPOC);
    const item = got.items.find((i) => i.uid === U05());
    assert.deepEqual([item.decision, item.decidedBy, item.modified.source, item.modified.kind, item.modified.rule, item.modified.note],
      ['approved', 'dc007.spoc', 'manual', 'value', null, 'read off the label']);
    assert.deepEqual(got.overrides.map((o) => [o.kind, o.source, o.fields]), [['value', 'manual', {
      serial: { from: null, to: 'FOC1234A1BC' }, asset_tag: { from: null, to: 'A-100' },
      description: { from: null, to: 'build server' } }]]);

    // The write carries the typed values: they are in the scan every comparison of this check reads.
    await service.decide(check.id, [{ uid: F.U20, decision: 'rejected', reasonCode: 'wrong_asset', note: 'not now' }], { actor: SPOC });
    assert.equal(service.approve(check.id, { actor: SPOC }).plan.status, 'approved');
    const from = nb.calls.length;
    const written = await writeFor(check, nb);
    assert.deepEqual([written.write.state, written.write.status], ['written', 'completed'], JSON.stringify(written.write));
    const [posted] = nb.calls.slice(from).filter((c) => c.method === 'POST' && c.path === F.DEVICES);
    assert.deepEqual([posted.body.serial, posted.body.asset_tag, posted.body.description], ['FOC1234A1BC', 'A-100', 'build server']);
    const made = store.changesOf(check.id).filter((c) => !c.internal && c.itemUid === U05());
    assert.deepEqual(made.map((c) => [c.action, c.field, c.result, c.source, c.rule]), [['create', '*', 'written', 'manual', null]]);
  });

  it('on a record already there it is an update, signed afresh, and the write carries the typed value alone', async () => {
    // The switch published a serial for the box, the record has none, and the SPOC reads the right one off the label.
    const nb = afterTheDemo();
    const check = await filed(nb, { tweak: (snap) => { snap.devices[0].serial = 'SNMP-0001'; } });
    const before = service.get(check.id, SPOC);
    assert.deepEqual(before.items.find((i) => i.uid === F.U20).diff, { serial: { from: '', to: 'SNMP-0001' } });

    const out = await service.decide(check.id, [{ uid: F.U20, decision: 'modified', modified: { serial: 'FOC1234A1BC' } }],
      { actor: SPOC });
    assert.deepEqual(out.applied, [{ uid: F.U20, decision: 'approved', modified: true }], JSON.stringify(out.refused));
    const got = service.get(check.id, SPOC);
    const item = got.items.find((i) => i.uid === F.U20);
    assert.deepEqual(item.diff, { serial: { from: '', to: 'FOC1234A1BC' } });
    assert.deepEqual(item.modified.original, { action: 'update', diff: { serial: { from: '', to: 'SNMP-0001' } },
      name: item.name }, 'what the scan proposed is kept beside the change');
    assert.notEqual(got.plan.fingerprint, before.plan.fingerprint, 'a different value is a different signature');
    assert.equal(got.plan.baseFingerprint, before.plan.fingerprint);

    // The camera-counted ports of a box that is already the customer's record are questions of their own; not now.
    const ports = got.items.filter((i) => i.decidable && i.type === 'Interface');
    await service.decide(check.id, ports.map((i) => ({ uid: i.uid, decision: 'rejected', reasonCode: 'wrong_asset',
      note: 'ports are compared on a later check' })), { actor: SPOC });
    assert.equal(service.approve(check.id, { actor: SPOC }).plan.status, 'approved');
    const from = nb.calls.length;
    const written = await writeFor(check, nb);
    assert.deepEqual([written.write.state, written.write.status], ['written', 'completed'], JSON.stringify(written.write));
    const onRecord = nb.writes(from).filter((c) => c.path === `${F.DEVICES}${F.RECORD_ID}/`);
    assert.equal(onRecord.length, 1);
    assert.deepEqual(Object.keys(onRecord[0].body).sort(), ['custom_fields', 'serial']);
    assert.equal(nb.record().serial, 'FOC1234A1BC');
    assert.equal(nb.record().position, 20);
  });

  it('is refused, with the reason, when the record already states another serial, or when nothing is asked about the box', async () => {
    const stated = afterTheDemo();
    stated.record().serial = 'OLD-0001';
    const check = await filed(stated, { tweak: (snap) => { snap.devices[0].assetTag = 'A-7'; } });
    const before = service.get(check.id, SPOC);
    const held = await service.decide(check.id, [{ uid: F.U20, decision: 'modified', modified: { serial: 'FOC1234A1BC' } }],
      { actor: SPOC });
    assert.deepEqual(held.applied, []);
    assert.match(held.refused[0].why, /do not agree on which box it is/);
    assert.deepEqual(service.get(check.id, SPOC).overrides, []);
    assert.equal(service.get(check.id, SPOC).plan.fingerprint, before.plan.fingerprint);

    const settled = await filed(afterTheDemo());
    assert.equal(service.get(settled.id, SPOC).items.find((i) => i.uid === F.U20).action, 'noop');
    const none = await service.decide(settled.id, [{ uid: F.U20, decision: 'modified', modified: { serial: 'FOC1' } }],
      { actor: SPOC });
    assert.deepEqual(none.refused, [{ uid: F.U20, why: 'not a decidable item' }]);
  });

  it('never the shelf, and nothing outside the three fields', async () => {
    const nb = F.seedDemoRack(F.fakeNetBox());
    const check = await filed(nb);
    const before = service.get(check.id, SPOC);
    const tries = [
      [{ position: 21 }, /The shelf is changed only by accepting the suggestion/],
      [{ face: 'rear' }, /The shelf is changed only by accepting the suggestion/],
      [{ serial: 'FOC1', position: 21 }, /The shelf is changed only by accepting the suggestion/],
      [{ name: 'core-router' }, /a serial number, an asset tag or a description/i],
      [{ role: 'router' }, /a serial number, an asset tag or a description/i],
      [{ status: 'offline' }, /a serial number, an asset tag or a description/i],
      [{ serial: '   ' }, /An empty value is never written/],
      [{}, /a serial number, an asset tag or a description/i],
    ];
    for (const [modified, why] of tries) {
      const out = await service.decide(check.id, [{ uid: F.U20, decision: 'modified', modified }], { actor: SPOC });
      assert.deepEqual(out.applied, [], JSON.stringify(modified));
      assert.match(out.refused[0].why, why);
    }
    const sent = await service.decide(check.id, [{ uid: F.U20, decision: 'modified', modified: { serial: 'FOC1' } }], { actor: TECH });
    assert.equal(sent.code, 'role', 'and never by the person who sent the check');
    const now = service.get(check.id, SPOC);
    assert.equal(now.plan.version, before.plan.version, 'nothing was stored');
    assert.deepEqual(now.overrides, []);
  });

  it('a newer value replaces the older one, and taking it back asks again', async () => {
    const nb = F.seedDemoRack(F.fakeNetBox());
    const check = await filed(nb, { boxes: [SERVER()] });
    await service.decide(check.id, [{ uid: U05(), decision: 'modified', modified: { serial: 'FOC1' } }], { actor: SPOC });
    await service.decide(check.id, [{ uid: U05(), decision: 'modified', modified: { serial: 'FOC2' } }], { actor: SPOC });
    const got = service.get(check.id, SPOC);
    assert.deepEqual(got.overrides.map((o) => o.fields.serial.to), ['FOC2']);
    assert.equal(got.items.find((i) => i.uid === U05()).modified.overrideId, got.overrides[0].id);

    const back = await service.revokeOverride(check.id, got.overrides[0].id, { actor: SPOC });
    const item = back.items.find((i) => i.uid === U05());
    assert.deepEqual([item.decision, item.modified], ['pending', undefined],
      'an approval that came with the change goes with it');
  });
});

describe('the suggestions that change nothing in the scan', () => {
  it('fills a blank: accepting approves the item as it stands, with no change stored', async () => {
    const nb = F.seedDemoRack(F.fakeNetBox(), { position: 20 });
    nb.record().custom_fields = { racktrack_uid: F.U20, racktrack_bound: 'bound by dc007.spoc' };
    const check = await filed(nb, { tweak: (snap) => { Object.assign(snap.devices[0], { serial: 'FOC1234A1BC', evidence: 'snmp' }); } });
    const before = service.get(check.id, SPOC);
    const s = sidOf(before, 'fills_blank');
    assert.equal(s.title, 'The switch fills a blank: approve as it stands');
    const out = await service.acceptSuggestion(check.id, s.id, { actor: SPOC });
    assert.equal(out.error, undefined, out.why);
    assert.equal(out.replanned, false);
    assert.equal(out.plan.fingerprint, before.plan.fingerprint);
    assert.deepEqual(out.overrides, []);
    const item = out.items.find((i) => i.uid === F.U20);
    assert.deepEqual([item.decision, item.decidedBy, item.modified], ['approved', 'dc007.spoc', undefined]);
    assert.equal(store.ticketsOf(check.id).find((t) => t.itemUid === F.U20).status, 'closed');
    assert.deepEqual(out.suggestions.filter((x) => x.id === s.id).map((x) => [x.state, x.stateBy]), [['accepted', 'dc007.spoc']]);
  });

  it('leave as it is: only the word is kept, and nothing is written or stored about the record', async () => {
    const nb = F.seedDemoRack(F.fakeNetBox());
    nb.rows(F.DEVICES).push({ id: 230, name: 'SP-R1-PDU-A', rack: { id: F.RACK_ID }, site: { id: 7 }, position: null,
      face: null, status: { value: 'active' }, role: { id: 12, name: 'PDU', slug: 'pdu' }, custom_fields: {} });
    const check = await filed(nb);
    const before = service.get(check.id, SPOC);
    const s = sidOf(before, 'leave_as_is');
    assert.equal(s.recordName, 'SP-R1-PDU-A');
    const out = await service.acceptSuggestion(check.id, s.id, { actor: SPOC });
    assert.equal(out.error, undefined, out.why);
    assert.deepEqual(out.overrides, []);
    assert.deepEqual(out.items.map((i) => [i.uid, i.decision]), before.items.map((i) => [i.uid, i.decision]));
    assert.equal(out.suggestions.find((x) => x.id === s.id).state, 'accepted');
    assert.ok(sidOf(out, 'wrong_shelf'), 'and the move is still offered beside it');
    assert.equal(nb.writes().length, 0);
  });

  it('an exception made after the check was filed sets its item aside', async () => {
    const nb = F.seedDemoRack(F.fakeNetBox());
    const check = await filed(nb, { boxes: [SERVER()] });
    const ex = store.addException({ orgId: 1, tenantId: 32, rackId: check.rackId, itemType: 'Device',
      itemName: 'Server U5*', kind: 'accepted_drift', justification: 'A loan unit for the migration',
      expiresAt: '2099-01-01T00:00:00Z', approvedBy: 'Aasritha' });
    const s = sidOf(service.get(check.id, SPOC), 'exception');
    assert.equal(s.title, `Covered by exception ${ex.id}`);
    const out = await service.acceptSuggestion(check.id, s.id, { actor: SPOC });
    assert.equal(out.error, undefined, out.why);
    const item = out.items.find((i) => i.uid === U05());
    assert.deepEqual([item.decision, item.exceptionId, item.reasonCode], ['excepted', ex.id, 'known_exception']);
    assert.equal(store.ticketsOf(check.id).find((t) => t.itemUid === U05()).status, 'closed');
    store.revokeException(ex.id);
  });

  it('the same drift sent twice: the newer check closes as a duplicate, and the older one is not touched', async () => {
    const nb = F.seedDemoRack(F.fakeNetBox());
    const first = await filed(nb);
    const report = await writer.plan(F.demoSnapshot(), nb.client());
    const other = user(42, 'dc007.member', 'member');
    const second = service.create({ scanId: first.scanId, rackId: first.rackId, rackName: 'SP-HYB-RM01-R01-R1', report,
      actor: other, orgId: 1, tenantId: 32, reuse: false }).plan.id;
    await service.submitAndDispatch(second, { actor: other });
    const s = service.get(second, SPOC).suggestions.find((x) => x.rule === 'duplicate' && !x.itemUid);
    assert.match(s.title, new RegExp(`^Same as check ${first.id}, which is with dc007\\.spoc`));
    const untouched = service.get(first.id, SPOC).plan.version;
    const out = await service.acceptSuggestion(second, s.id, { actor: SPOC });
    assert.equal(out.error, undefined, out.why);
    assert.deepEqual([out.plan.status, out.plan.duplicateOf], ['duplicate', first.id]);
    assert.equal(store.ticketsOf(second).filter(shape.isOpenTicket).length, 0);
    assert.deepEqual([service.get(first.id, SPOC).plan.status, service.get(first.id, SPOC).plan.version], ['assigned', untouched]);
  });
});

describe('dismissing, and a check from before suggestions', () => {
  it('puts a suggestion away with who and when, and an answered suggestion cannot be pressed again', async () => {
    const nb = F.seedDemoRack(F.fakeNetBox());
    const check = await filed(nb);
    const s = sidOf(service.get(check.id, SPOC), 'wrong_shelf');
    assert.equal(service.dismissSuggestion(check.id, s.id, { actor: TECH }).code, 'role');
    const out = service.dismissSuggestion(check.id, s.id, { note: 'a different router', actor: SPOC });
    assert.deepEqual(out.suggestions.filter((x) => x.id === s.id).map((x) => [x.state, x.stateBy]), [['dismissed', 'dc007.spoc']]);
    assert.equal(out.plan.suggestionState[s.id].note, 'a different router');
    assert.deepEqual(decidable(out).map((i) => [i.action, i.decision]), [['create', 'ticketed']], 'nothing else changed');
    assert.ok(store.eventsOf(check.id).some((e) => e.action === 'suggestion.dismiss' && e.payload.id === s.id));
    const again = await service.acceptSuggestion(check.id, s.id, { actor: SPOC });
    assert.deepEqual([again.code, again.why], ['guard', 'That suggestion no longer applies.']);
    assert.equal(service.dismissSuggestion(check.id, 'wrong_shelf|nothing|1', { actor: SPOC }).why,
      'That suggestion no longer applies.');
  });

  it('a check filed before this returns no suggestions and the one note', () => {
    const old = service.create({ scanId: 9001, rackId: 'RK-OLDCHECK', rackName: 'R1', actor: TECH, orgId: 1, tenantId: 32,
      report: { rackUid: 'rack:old', counts: {}, warnings: [], orphans: [],
        changes: [{ type: 'Device', uid: 'dev:old:u1', name: 'SW', action: 'create' }] } });
    const got = service.get(old.plan.id, TECH);
    assert.deepEqual(got.suggestions, []);
    assert.equal(got.suggestionsNote, 'This check was filed before suggestions existed. Compare the rack again to get them.');
    assert.deepEqual(got.overrides, []);
    assert.equal(store.getPlan(old.plan.id).evidence, null);
  });

  it('keeps the findings and the evidence of a comparison on the check, and off the phone\'s shape', async () => {
    const nb = F.seedDemoRack(F.fakeNetBox());
    const check = await filed(nb, { send: false });
    const heavy = store.getPlan(check.id);
    assert.deepEqual(heavy.evidence.records.map((r) => [r.netboxId, r.position]), [[F.RECORD_ID, 22]]);
    assert.deepEqual(heavy.evidence.boxes.map((b) => [b.uid, b.position, b.cvClass]), [[F.U20, 20, 'Router']]);
    assert.ok(Array.isArray(heavy.findings));
    const legacy = shape.legacyPlan(service.get(check.id, TECH));
    assert.equal(legacy.evidence, undefined);
    assert.equal(legacy.findings, undefined);
    assert.equal(legacy.suggestions, undefined);
  });
});

describe('over HTTP', () => {
  it('accepts, dismisses, changes and takes back through the routes, with the refusals as statuses', async () => {
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.user = { tech: TECH, spoc: SPOC, admin: ADMIN }[req.get('x-as')] || null;
      next();
    });
    app.use('/api/approvals/plans', require('../../routes/approvals/plans'));
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const call = (as, method, p, body) => new Promise((resolve, reject) => {
      const data = body ? JSON.stringify(body) : null;
      const req = http.request({ host: '127.0.0.1', port: server.address().port, path: `/api/approvals/plans${p}`, method,
        headers: { 'x-as': as, ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) } },
      (res) => { let raw = ''; res.on('data', (c) => { raw += c; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw || '{}') })); });
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
    try {
      const nb = F.seedDemoRack(F.fakeNetBox());
      const check = await filed(nb, { boxes: [SERVER()] });
      const opened = await call('spoc', 'GET', `/${check.id}`);
      const s = opened.body.suggestions.find((x) => x.rule === 'wrong_shelf');
      const sid = encodeURIComponent(s.id);

      assert.equal((await call('tech', 'POST', `/${check.id}/suggestions/${sid}/accept`, {})).status, 403);
      assert.equal((await call('spoc', 'POST', `/${check.id}/suggestions/${encodeURIComponent('wrong_shelf|x|1')}/accept`, {})).status, 409);

      const accepted = await call('spoc', 'POST', `/${check.id}/suggestions/${sid}/accept`, { note: 'agreed' });
      assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
      assert.equal(accepted.body.ok, true);
      assert.equal(accepted.body.plan.id, check.id);
      assert.equal(accepted.body.items.find((i) => i.uid === F.U20).action, 'rebind', 'the whole check comes back, items replaced');
      assert.equal(accepted.body.overrides.length, 1);
      assert.equal((await call('spoc', 'POST', `/${check.id}/suggestions/${sid}/accept`, {})).status, 409);

      const changed = await call('spoc', 'POST', `/${check.id}/decide`, { decisions: [
        { uid: U05(), decision: 'modified', modified: { serial: 'FOC1234A1BC' } }] });
      assert.equal(changed.status, 200, JSON.stringify(changed.body));
      assert.deepEqual([changed.body.applied, changed.body.replanned],
        [[{ uid: U05(), decision: 'approved', modified: true }], true]);
      const plain = await call('spoc', 'POST', `/${check.id}/decide`, { decisions: [{ uid: U05(), decision: 'approved' }] });
      assert.equal(plain.body.replanned, false);
      assert.equal((await call('spoc', 'POST', `/${check.id}/decide`, { decisions: [{ uid: '*', decision: 'approved' }] })).status, 400);

      const moveId = accepted.body.overrides[0].id;
      assert.equal((await call('tech', 'DELETE', `/${check.id}/overrides/${moveId}`)).status, 403);
      const back = await call('admin', 'DELETE', `/${check.id}/overrides/${moveId}`);
      assert.equal(back.status, 200, JSON.stringify(back.body));
      assert.equal(back.body.items.find((i) => i.uid === F.U20).action, 'create');
      assert.equal(back.body.overrides.length, 1, 'the value typed by hand stays');
      assert.equal((await call('admin', 'DELETE', `/${check.id}/overrides/${moveId}`)).status, 404);

      const open = back.body.suggestions.find((x) => x.rule === 'wrong_shelf');
      const dismissed = await call('spoc', 'POST', `/${check.id}/suggestions/${encodeURIComponent(open.id)}/dismiss`, { note: 'no' });
      assert.equal(dismissed.status, 200);
      assert.equal(dismissed.body.suggestions.find((x) => x.id === open.id).state, 'dismissed');
    } finally {
      await new Promise((resolve) => { server.close(resolve); });
    }
  });
});
