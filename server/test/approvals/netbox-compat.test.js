/**
 * The phone app's routes, after plans moved into SQLite.
 *
 * A build in the field reads /api/nb/plans, /api/nb/plans/:id and
 * /api/nb/plans/:id/decide directly. None of those shapes may move, so this
 * boots the real app, imports a real plan file, and checks the three things
 * measured on the live server on 18 September 2026:
 *
 *   1. GET /api/nb/plans/:id gives 191 items, 170 of them interfaces carrying
 *      parentUid, following true and decidable false, leaving 9 decidable -
 *      the grouping that turns 191 questions into 9, one per device;
 *   2. POST /api/nb/plans/:id/decide refuses in exactly three ways, in the
 *      same words: "assign first", "not a decidable item", and a 400 for a
 *      whole-rack decision mixed with a single item;
 *   3. reading a plan changes nothing about it.
 *
 * And the visibility rule, which the same server showed broken: as the
 * platform owner, the list showed four plans and every one of them answered
 * "no such plan" when opened. The list and the read apply the same test now,
 * and a plan raised by an account with no organisation belongs to that
 * account alone - not to everybody who happens to have no organisation.
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

after(() => { setImmediate(() => process.exit(0)); });
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.PORT = process.env.PORT || '0';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-nb-compat';
process.env.RACKTRACK_SKIP_WORKER_POOL = '1';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-nb-compat-'));
process.env.RT_DATA_DIR = path.join(tmp, 'data', 'netbox');
process.env.RT_OUTPUTS_DIR = path.join(tmp, 'outputs');
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const auth = require('../../auth');
auth.sendNotice = async () => true;
const { app } = require('../../app');
const migrate = require('../../lib/approvals/migrate');
const service = require('../../lib/approvals/service');

const db = auth.db;
const stamp = Date.now();

function listen() {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}
function call(port, token, method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port, method, path: p,
      headers: {
        authorization: `Bearer ${token}`, 'x-client-platform': 'native',
        ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(raw); } catch { /* not json */ } resolve({ status: res.statusCode, json, raw }); });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
function seedOwner(username) {
  const existing = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (existing) return existing;
  const tenantId = db.prepare(`SELECT id FROM tenants WHERE slug = 'default'`).get()?.id
                ?? db.prepare('SELECT id FROM tenants ORDER BY id LIMIT 1').get()?.id;
  db.prepare(`INSERT INTO users (email, username, password_hash, role, tenant_id, active)
              VALUES (?, ?, 'x', 'owner', ?, 1)`).run(`${username}@example.com`, username, tenantId);
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

/** The real plan file, re-pointed at this run's organisation and Site. */
function importFixture({ orgId, tenantId, createdBy, legacyId }) {
  const raw = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'fixtures', 'netbox-plans', '37.json'), 'utf8'));
  raw.id = legacyId;
  raw.orgId = orgId;
  raw.tenantId = tenantId;
  raw.createdBy = createdBy;
  const dir = path.join(tmp, `plans-${legacyId}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${legacyId}.json`), JSON.stringify(raw, null, 2));
  const out = migrate.run({ dir });
  assert.equal(out.imported, 1, JSON.stringify(out));
  return { raw, planId: require('../../lib/approvals/store').getPlanByLegacyId(legacyId).id };
}

test('the phone app reads the same plan it always did', async (t) => {
  const { server, port } = await listen();
  let cleanup = async () => {};
  t.after(async () => {
    try { await cleanup(); } catch { /* best effort */ }
    await new Promise((r) => server.close(r));
  });

  const ownerTok = auth.makeToken(seedOwner('nb-compat-owner'));
  const created = await call(port, ownerTok, 'POST', '/api/orgs', {
    name: `NB Compat ${stamp}`, adminUsername: `nbc.admin.${stamp}`,
    adminEmail: `nbc.admin.${stamp}@example.test`, adminPassword: 'Compat@2026!',
  });
  assert.equal(created.status, 200, created.raw);
  const orgId = created.json.organization.id;
  const site = await call(port, ownerTok, 'POST', `/api/orgs/${orgId}/sites`, { name: 'NB Compat Site' });
  const tenantId = site.json.site.id;
  cleanup = async () => {
    const gone = await call(port, ownerTok, 'DELETE', `/api/orgs/${orgId}`);
    if (gone.status !== 200) throw new Error(`cleanup: ${gone.status} ${gone.raw}`);
  };
  const admin = db.prepare('SELECT * FROM users WHERE username = ?').get(`nbc.admin.${stamp}`);
  const adminTok = auth.makeToken(admin);

  const { raw, planId } = importFixture({ orgId, tenantId, createdBy: admin.username,
    legacyId: 900000 + (stamp % 90000) });

  // ---- 1. The grouping survives the import and the read.
  const read = await call(port, adminTok, 'GET', `/api/nb/plans/${planId}`);
  assert.equal(read.status, 200, read.raw);
  const items = read.json.items;
  assert.equal(items.length, 191, '191 rows, exactly as the file had');
  assert.equal(items.length, raw.items.length);

  const ports = items.filter((i) => i.type === 'Interface');
  assert.equal(ports.length, 170, '170 of them are interfaces');
  assert.ok(ports.every((i) => typeof i.parentUid === 'string' && i.parentUid.startsWith('dev:')),
    'every port names its device');
  assert.ok(ports.every((i) => i.following === true), 'every port follows it');
  assert.ok(ports.every((i) => i.decidable === false), 'and is not a question of its own');
  assert.equal(items.filter((i) => i.decidable).length, 9, 'nine things to decide: one per device');
  assert.equal(read.json.summary.decidable, 9, 'and the summary agrees');
  assert.equal(read.json.summary.following, 170);
  assert.equal(read.json.status, 'submitted', 'the status word the app knows');
  assert.equal(read.json.settled, false);

  // Nothing else on a row was dropped, the fields no version of the file
  // format ever declared included.
  const before = Object.fromEntries(raw.items.map((i) => [i.uid, i]));
  for (const row of items) {
    const was = before[row.uid];
    assert.ok(was, `${row.uid} came from the file`);
    for (const field of ['type', 'name', 'action', 'decision']) {
      assert.equal(row[field], was[field], `${row.uid}: ${field}`);
    }
    assert.equal(row.netboxId ?? null, was.netboxId ?? null, `${row.uid}: netboxId`);
    assert.deepEqual(row.diff ?? null, was.diff ?? null, `${row.uid}: diff`);
    assert.equal(row.parentUid ?? null, was.parentUid ?? null, `${row.uid}: parentUid`);
  }
  const DEV = raw.items.find((i) => i.type === 'Device' && i.action === 'create').uid;
  assert.deepEqual(items.find((i) => i.uid === `if:${DEV}:1`).binding,
    { via: 'lldp', neighbour: 'core-a' }, 'a field the format never knew about is still there');

  // ---- 2. The refusals, in the same words - less one. An organization admin
  // who did not send the check now decides an item with the report beside them,
  // so "assign first" is no longer said at this door; the answer keeps its shape.
  const undecided = items.find((i) => i.decidable && i.decision === 'pending' && !i.ticket);
  assert.ok(undecided, 'there is something nobody has been asked about');
  const fromADesk = await call(port, adminTok, 'POST', `/api/nb/plans/${planId}/decide`,
    { decisions: [{ uid: undecided.uid, decision: 'approved' }] });
  assert.equal(fromADesk.status, 200, fromADesk.raw);
  assert.deepEqual(fromADesk.json.refused, []);
  assert.deepEqual(fromADesk.json.applied, [{ uid: undecided.uid, decision: 'approved' }]);
  assert.deepEqual(Object.keys(fromADesk.json).sort(), ['applied', 'planId', 'refused', 'settled', 'summary']);

  const aPort = await call(port, adminTok, 'POST', `/api/nb/plans/${planId}/decide`,
    { decisions: [{ uid: `if:${DEV}:1`, decision: 'approved' }] });
  assert.equal(aPort.status, 200, aPort.raw);
  assert.deepEqual(aPort.json.refused, [{ uid: `if:${DEV}:1`, why: 'not a decidable item' }]);

  const mixed = await call(port, adminTok, 'POST', `/api/nb/plans/${planId}/decide`, {
    decisions: [{ uid: '*', decision: 'ticketed', assignee: 'Meera Raghavan' },
      { uid: undecided.uid, decision: 'approved' }],
  });
  assert.equal(mixed.status, 400, mixed.raw);
  assert.equal(mixed.json.error,
    'send the whole-rack decision on its own, not mixed with single items');

  // ---- 3. Reading it, and being refused, changed nothing else.
  const again = await call(port, adminTok, 'GET', `/api/nb/plans/${planId}`);
  assert.equal(again.json.items.length, 191);
  assert.equal(again.json.summary.decidable, 9);
  assert.equal(again.json.summary.pending, 9 - 2, 'seven waiting, one decided, one still out with somebody');
  assert.equal(again.json.summary.ticketed, 1, 'nothing was assigned by reading');
  assert.equal(again.json.summary.approved, 1, 'the one decision, and no other');
  assert.equal(again.json.summary.written, 0, 'and nothing was written');
  assert.equal(again.json.status, 'submitted');
  const moved = new Set([undecided.uid, ...items.filter((i) => i.parentUid === undecided.uid && i.following)
    .map((i) => i.uid)]);
  assert.deepEqual(again.json.items.filter((i) => !moved.has(i.uid)).map((i) => i.decision),
    items.filter((i) => !moved.has(i.uid)).map((i) => i.decision), 'every other decision is where it was');
});

test('the list shows exactly what the read will open', async (t) => {
  const { server, port } = await listen();
  t.after(async () => new Promise((r) => server.close(r)));

  // Two accounts with no organisation at all: the platform owner, and a
  // second owner. Neither has an organisation, and they are not each other.
  const one = seedOwner('nb-compat-owner');
  const two = seedOwner(`nb-compat-owner2-${stamp}`);
  t.after(() => { db.prepare('DELETE FROM approval_plans WHERE created_by_id IN (?, ?)').run(one.id, two.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(two.id); });
  const tokOne = auth.makeToken(one);
  const tokTwo = auth.makeToken(two);

  const report = (rack) => ({ rackUid: `rack:${rack}`, counts: {}, warnings: [], orphans: [],
    changes: [{ type: 'Device', uid: `dev:${rack}:u1`, name: 'SW', action: 'create' }] });
  const RACK1 = `RK-ORPHAN1${String(stamp).slice(-4)}`;
  const RACK2 = `RK-ORPHAN2${String(stamp).slice(-4)}`;
  const mine = service.create({ scanId: 1, rackId: RACK1, report: report(RACK1),
    actor: one, orgId: one.organization_id ?? null, tenantId: one.tenant_id }).plan.id;
  const theirs = service.create({ scanId: 2, rackId: RACK2, report: report(RACK2),
    actor: two, orgId: two.organization_id ?? null, tenantId: two.tenant_id }).plan.id;

  // The defect: the list said four and the read said none of them existed.
  const listed = await call(port, tokOne, 'GET', `/api/nb/plans?rackId=${RACK1}`);
  assert.equal(listed.status, 200, listed.raw);
  assert.deepEqual(listed.json.plans.map((p) => p.id), [mine], 'their own plan is listed');
  for (const row of listed.json.plans) {
    const opened = await call(port, tokOne, 'GET', `/api/nb/plans/${row.id}`);
    assert.equal(opened.status, 200,
      `a plan the list showed must open: ${row.id} answered ${opened.status}`);
  }

  // And the other way: nothing that cannot be opened is ever listed.
  const otherRack = await call(port, tokOne, 'GET', `/api/nb/plans?rackId=${RACK2}`);
  assert.deepEqual(otherRack.json.plans.map((p) => p.id), [],
    "another account's plan is not listed, even to an owner with no organisation");
  const peek = await call(port, tokOne, 'GET', `/api/nb/plans/${theirs}`);
  assert.equal(peek.status, 404, "and it is not there when asked for by number");
  const back = await call(port, tokTwo, 'GET', `/api/nb/plans/${mine}`);
  assert.equal(back.status, 404, 'the absence of an organisation is not itself a key');

  // The same rule through the Approvals routes.
  const approvals = await call(port, tokOne, 'GET', '/api/approvals/plans');
  const ids = approvals.json.plans.map((p) => p.id);
  assert.ok(ids.includes(mine), 'their own plan is there');
  assert.ok(!ids.includes(theirs), "and the other account's is not");
  assert.equal((await call(port, tokOne, 'GET', `/api/approvals/plans/${theirs}`)).status, 404);
});
