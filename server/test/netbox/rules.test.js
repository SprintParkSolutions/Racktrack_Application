/**
 * The frozen drift workflow, held by the server.
 *
 * docs/design/drift-approval-workflow.md says who does what and what nobody
 * can do. These tests drive the real routes, booted the way org_remove does,
 * with NetBox, ServiceNow and the mail transport stubbed at the module
 * boundary, and check the rules hold at the HTTP layer:
 *
 *   - a technician (member) reaches exactly eight routes and is refused the rest
 *   - a technician sees only the plans they raised
 *   - a sent check goes straight to the SPOC of its site, who is told
 *   - nothing is assigned from the phone's decide route any more: `ticketed`,
 *     the whole rack and scope 'rack' are refused with a sentence
 *   - the SPOC, or an organization admin, decides without a ticket finding;
 *     the person who sent the check, and a site manager it is not with, do not
 *   - the person a ticket went to resolves it; nobody else's site manager does
 *   - the approval is what writes; the old export door cannot write a check
 *     nobody approved, and is only the way to try a failed write again
 *   - a write NetBox refused part of is write_failed, emailed, and retried
 *   - every step leaves an audit row
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
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-drift-rules';
process.env.RACKTRACK_SKIP_WORKER_POOL = '1';

// Its own data and outputs, away from the real ones. app.js honours both.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-rules-'));
process.env.RT_DATA_DIR = path.join(tmp, 'data', 'netbox');
process.env.RT_OUTPUTS_DIR = path.join(tmp, 'outputs');
// A NetBox "exists" for the env fallback; every call to it is stubbed below.
process.env.NETBOX_URL = 'http://netbox.test';
process.env.NETBOX_TOKEN = 'test-token';
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const RACK = 'RK-RULES0001';
const DEV = `dev:${RACK}:u12`;
const DEV2 = `dev:${RACK}:u15`;
const CHANGES = [
  { type: 'Manufacturer', uid: 'mfr:cisco', name: 'Cisco', action: 'create' },
  { type: 'Device', uid: DEV, name: 'SW-12', action: 'create' },
  { type: 'Interface', uid: `if:${DEV}:1`, name: 'Gi1/0/1', action: 'create' },
  { type: 'Interface', uid: `if:${DEV}:2`, name: 'Gi1/0/2', action: 'create' },
  { type: 'Device', uid: DEV2, name: 'FW-15', action: 'update', netboxId: 44,
    diff: { position: { from: 14, to: 15 } } },
];

// The comparison and the write, stubbed BEFORE the routes load: netbox.js
// takes { plan, push } off the module at require time.
const writer = require('../../lib/netbox/writer');
let pushResult = () => { throw new Error('push was not expected'); };
// What NetBox holds once a write has gone through: a comparison afterwards no
// longer wants it, which is what the check after a write looks for.
const inNetBox = new Set();
writer.plan = async (snap) => ({
  rackUid: snap.rackUid, netboxUrl: 'http://netbox.test', customField: 'present',
  counts: { create: 4, update: 1 }, warnings: [], orphans: [],
  changes: CHANGES.filter((c) => !inNetBox.has(c.uid)),
});
writer.push = async () => {
  const report = pushResult();
  for (const c of report.changes) if (c.action !== 'fail') inNetBox.add(c.uid);
  return report;
};
// The write reads the objects it touches before and after; here it reads a
// NetBox that holds nothing, instead of reaching for one over the network.
require('../../lib/approvals/write')._setDeps({
  client: { url: 'http://netbox.test', findByUid: async () => null } });

// The mail transport: every notice lands here instead of going anywhere.
const auth = require('../../auth');
const mails = [];
auth.sendNotice = async (m) => { mails.push(m); return true; };

// The contacts NetBox knows. The check no longer goes to one of them - it goes
// to the SPOC setup named for the site, a RackTrack user below - but the rack
// is still recognised through NetBox. Emails are stamped so a run never
// collides with a row an earlier run, or a person, left in the shared auth.db.
const stamp = Date.now();
const MEERA = { name: 'Meera Raghavan', email: `drift.meera.${stamp}@sprintpark.test`, title: 'DC lead',
                phone: null, netboxId: 7 };
const SAM_A = { name: 'Sam Patel', email: 'sam.a@sprintpark.com', title: null, phone: null, netboxId: 8 };
const SAM_B = { name: 'Sam Patel', email: 'sam.b@sprintpark.com', title: null, phone: null, netboxId: 9 };
const spoc = require('../../lib/netbox/spoc');
const rackMatch = require('../../lib/netbox/rack_match');
rackMatch.resolveRack = async () => ({ name: 'RACK-01', rackKey: null, source: 'scan',
                                       confidence: 'none', why: 'stubbed for the test' });
spoc.forRack = async () => ({ spoc: { ...MEERA, via: 'rack', role: 'spoc' }, others: [],
                              rack: { id: 1, name: 'RACK-01' }, site: { id: 1, name: 'HQ' }, why: null });
spoc.everyone = async () => [MEERA, SAM_A, SAM_B];

const { app } = require('../../app');
const audit = require('../../audit');
const estate = require('../../lib/estate');
const tenant = require('../../lib/tenant');

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

const db = auth.db;
function seedOwner() {
  const existing = db.prepare('SELECT * FROM users WHERE username = ?').get('drift-rules-owner');
  if (existing) return existing;
  const tenantId = db.prepare(`SELECT id FROM tenants WHERE slug = 'default'`).get()?.id
                ?? db.prepare('SELECT id FROM tenants ORDER BY id LIMIT 1').get()?.id;
  db.prepare(`INSERT INTO users (email, username, password_hash, role, tenant_id, active)
              VALUES (?, ?, ?, 'owner', ?, 1)`)
    .run('drift-rules-owner@example.com', 'drift-rules-owner', 'x', tenantId);
  return db.prepare('SELECT * FROM users WHERE username = ?').get('drift-rules-owner');
}
function seedUser({ username, email, role, tenantId, orgId }) {
  db.prepare(`INSERT INTO users (email, username, password_hash, role, tenant_id, organization_id, active)
              VALUES (?, ?, 'x', ?, ?, ?, 1)`).run(email, username, role, tenantId, orgId);
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

// Plan ids start at 1 in this run's own data dir, while audit_log is the
// shared auth.db, so only rows written since this run began are this run's.
const since = db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM audit_log').get().n;
const rows = (action, planId) => audit
  .query({ action, targetType: 'drift_plan', targetId: planId })
  .filter((r) => r.id > since);

test('the drift workflow holds its rules at every route', async (t) => {
  const { server, port } = await listen();
  // Leave the shared auth.db as it was found: the org delete takes its Site,
  // its members and their rack claims with it. It has to run while the
  // server is still up, so one hook does both, in that order.
  let cleanup = async () => {};
  t.after(async () => {
    try { await cleanup(); } catch { /* best effort */ }
    await new Promise((r) => server.close(r));
  });

  // An organisation with a Site, an org admin, a member (the technician) and
  // two site managers: one who is the SPOC of the Site, one who is nobody's.
  const ownerTok = auth.makeToken(seedOwner());
  const created = await call(port, ownerTok, 'POST', '/api/orgs', {
    name: `Drift Rules ${stamp}`, adminUsername: `drift.admin.${stamp}`,
    adminEmail: `drift.admin.${stamp}@example.test`, adminPassword: 'Drift@2026!',
  });
  assert.equal(created.status, 200, created.raw);
  const orgId = created.json.organization.id;
  const site = await call(port, ownerTok, 'POST', `/api/orgs/${orgId}/sites`, { name: 'Drift Site' });
  assert.equal(site.status, 200, site.raw);
  const siteId = site.json.site.id;
  cleanup = async () => {
    const gone = await call(port, ownerTok, 'DELETE', `/api/orgs/${orgId}`);
    if (gone.status !== 200) throw new Error(`cleanup: ${gone.status} ${gone.raw}`);
  };

  const admin = db.prepare('SELECT * FROM users WHERE username = ?').get(`drift.admin.${stamp}`);
  const member = seedUser({ username: `drift.tech.${stamp}`, email: `drift.tech.${stamp}@example.test`,
                            role: 'member', tenantId: siteId, orgId });
  const meera = seedUser({ username: `drift.meera.${stamp}`, email: MEERA.email,
                           role: 'site_manager', tenantId: siteId, orgId });
  const other = seedUser({ username: `drift.other.${stamp}`, email: `drift.other.${stamp}@example.test`,
                           role: 'site_manager', tenantId: siteId, orgId });
  const adminTok = auth.makeToken(admin);
  const memberTok = auth.makeToken(member);
  const meeraTok = auth.makeToken(meera);
  const otherTok = auth.makeToken(other);

  // The rack: scanned under the member's Site, with a detection result on disk.
  tenant.claimRack(siteId, RACK, member.id);
  const dir = path.join(process.env.RT_OUTPUTS_DIR, RACK);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'device_unit_map.json'), JSON.stringify({
    devices: [
      { class_name: 'Switch', units: ['u12'], port_count: 24 },
      { class_name: 'Firewall', units: ['u15'], port_count: 8 },
    ],
  }));
  fs.writeFileSync(path.join(dir, 'scan_meta.json'), JSON.stringify({
    tenantId: siteId, timestamp: new Date().toISOString(),
  }));

  // ---- 1. The technician: adopt, compare, read their own plan, hand it over.
  const adopted = await call(port, memberTok, 'POST', `/api/nb/scans/adopt/${RACK}`, {});
  assert.ok([200, 201].includes(adopted.status), `adopt as a member: ${adopted.status} ${adopted.raw}`);
  const scanId = adopted.json.id;

  const preview = await call(port, memberTok, 'POST', `/api/nb/netbox/${scanId}/preview`, {});
  assert.equal(preview.status, 200, `preview as a member: ${preview.raw}`);
  const planId = preview.json.planId;
  assert.ok(planId, 'the comparison was filed as a plan');
  assert.equal(preview.json.summary.decidable, 2);
  assert.equal(preview.json.summary.following, 2, 'the two ports follow their switch');

  // The admin compares the same scan: a second plan, theirs.
  const adminPreview = await call(port, adminTok, 'POST', `/api/nb/netbox/${scanId}/preview`, {});
  assert.equal(adminPreview.status, 200, adminPreview.raw);
  const adminPlanId = adminPreview.json.planId;

  const memberList = await call(port, memberTok, 'GET', '/api/nb/plans');
  assert.equal(memberList.status, 200, memberList.raw);
  assert.deepEqual(memberList.json.plans.map((p) => p.id), [planId],
    'a technician lists only the plans they raised');
  assert.equal(memberList.json.mine, true);
  const adminList = await call(port, adminTok, 'GET', `/api/nb/plans?rackId=${RACK}`);
  assert.deepEqual(new Set(adminList.json.plans.map((p) => p.id)), new Set([planId, adminPlanId]),
    'an admin sees every plan in the organisation');
  const adminMine = await call(port, adminTok, 'GET', `/api/nb/plans?rackId=${RACK}&mine=1`);
  assert.deepEqual(adminMine.json.plans.map((p) => p.id), [adminPlanId], '?mine=1 narrows to theirs');

  const own = await call(port, memberTok, 'GET', `/api/nb/plans/${planId}`);
  assert.equal(own.status, 200, own.raw);
  assert.equal(own.json.createdBy, member.username);
  const items = Object.fromEntries(own.json.items.map((i) => [i.uid, i]));
  assert.equal(items[`if:${DEV}:1`].parentUid, DEV, 'a port names its device');
  assert.equal(items[`if:${DEV}:1`].following, true);
  assert.equal(own.json.summary.following, 2);
  const notOwn = await call(port, memberTok, 'GET', `/api/nb/plans/${adminPlanId}`);
  assert.equal(notOwn.status, 404, 'somebody else\'s plan is, to a technician, not there');

  // Setup names the SPOC of the Site, the way the product does it.
  estate.setApprover(siteId, { user_id: meera.id }, admin.id);
  const contacts = await call(port, memberTok, 'GET', `/api/nb/plans/${planId}/contacts`);
  assert.equal(contacts.status, 200, contacts.raw);
  assert.equal(contacts.json.goesTo, 'spoc');
  assert.equal(contacts.json.spoc.name, meera.username, 'the SPOC of the site, not a NetBox contact');
  assert.equal(contacts.json.spoc.email, MEERA.email);
  assert.equal(contacts.json.siteSpoc.userId, meera.id);
  assert.equal(contacts.json.siteSpoc.siteName, 'Drift Site');
  assert.equal(contacts.json.matchedRack.name, 'RACK-01', 'the rack is still recognised through NetBox');
  assert.deepEqual(contacts.json.rack, { name: 'RACK-01' }, 'and named under the key the phone falls back on');
  assert.equal(contacts.json.assignable, undefined);

  mails.length = 0;
  const submitted = await call(port, memberTok, 'POST', `/api/nb/plans/${planId}/submit`,
    { note: 'U15 looks wrong to me' });
  assert.equal(submitted.status, 200, submitted.raw);
  assert.equal(submitted.json.status, 'submitted', 'the word the older phone builds read');
  assert.equal(submitted.json.state, 'assigned', 'and it is with the SPOC already');
  assert.equal(submitted.json.goesTo, 'spoc');
  assert.deepEqual(submitted.json.assignee, { userId: meera.id, name: meera.username, email: MEERA.email });
  assert.equal(submitted.json.needsAdmin, null);
  assert.ok(submitted.json.incident == null || submitted.json.incident.system === 'none',
    'no ServiceNow is configured for this org');
  assert.equal(rows('drift.submit', planId).length, 1, 'the hand-over is on the audit trail');
  await new Promise((r) => setTimeout(r, 50));
  const told = mails.filter((m) => m.to === MEERA.email);
  assert.equal(told.length, 1, 'the SPOC is told once, by email as well');
  assert.match(told[0].subject, /^Assigned to you: check /);
  assert.match(told[0].text, /U15 looks wrong to me/);
  assert.match(told[0].text, /What to do:/);
  const again = await call(port, memberTok, 'POST', `/api/nb/plans/${planId}/submit`, {});
  assert.equal(again.json.already, true);
  assert.equal(again.json.state, 'assigned');
  const submitOther = await call(port, memberTok, 'POST', `/api/nb/plans/${adminPlanId}/submit`, {});
  assert.equal(submitOther.status, 404, 'a technician cannot submit a plan that is not theirs');

  // The Report screen is the technician's - it is what they hand to whoever
  // was not at the rack - so the report of their own scan, and the matching
  // view the screen asks for beside it, both answer. Gated to admins they
  // answered 403 and the screen said the report "is for an admin".
  const rep = await call(port, memberTok, 'GET', `/api/nb/scans/${scanId}/report`);
  assert.equal(rep.status, 200, `a technician reads the report of their scan: ${rep.status} ${rep.raw}`);
  const view = await call(port, memberTok, 'GET', `/api/nb/scans/${scanId}/reconcile`);
  assert.equal(view.status, 200, `a technician reads the matching view of their scan: ${view.status} ${view.raw}`);

  // ---- 2. The technician is refused everything else.
  const refused = [
    ['POST', `/api/nb/plans/${planId}/decide`, { decisions: [{ uid: DEV, decision: 'approved' }] }],
    ['POST', `/api/nb/netbox/${scanId}/export`, { planId }],
    ['GET', '/api/nb/plans/tickets/all'],
    ['POST', `/api/nb/plans/${planId}/tickets/${DEV}/resolve`, { finding: 'x' }],
    ['GET', `/api/nb/plans/${planId}/tickets`],
    ['GET', '/api/nb/connectors/types'],
    ['GET', '/api/nb/scans'],
    ['GET', `/api/nb/scans/${scanId}`],
    ['GET', '/api/nb/switches'],
    ['GET', '/api/nb/unmanaged'],
    ['GET', '/api/nb/netbox/health'],
    ['GET', `/api/nb/netbox/${scanId}/export.json`],
  ];
  for (const [method, p, body] of refused) {
    const r = await call(port, memberTok, method, p, body);
    assert.equal(r.status, 403, `${method} ${p} as a member: ${r.status} ${r.raw}`);
  }

  // ---- 2b. The phone reads a switch at the rack and files the reading, so a
  // technician lists, adds and files for THEIR rack - and nothing more.
  const SW = { label: 'Core', host: '10.9.9.9', port: 161, version: 'v2c', community: 'public' };
  const mine = await call(port, memberTok, 'POST', '/api/nb/switches', { rackId: RACK, ...SW });
  assert.equal(mine.status, 201, `a technician adds a switch to their rack: ${mine.raw}`);
  const listed = await call(port, memberTok, 'GET', `/api/nb/switches?rackId=${RACK}`);
  assert.equal(listed.status, 200, listed.raw);
  assert.deepEqual(listed.json.map((s) => s.id), [mine.json.id]);
  assert.equal(listed.json[0].community, undefined, 'no secret comes back');
  const reading = { system: { sysName: 'core-sw' }, interfaces: [{ ifIndex: 1, name: 'Gi1/0/1' }] };
  const filed = await call(port, memberTok, 'POST', `/api/nb/switches/${mine.json.id}/reading`, reading);
  assert.equal(filed.status, 200, `a technician files a phone reading: ${filed.raw}`);

  const ELSEWHERE = 'RK-RULES0002';
  const theirs = await call(port, adminTok, 'POST', '/api/nb/switches', { rackId: ELSEWHERE, ...SW });
  assert.equal(theirs.status, 201, theirs.raw);
  for (const [method, p, body] of [
    ['GET', `/api/nb/switches?rackId=${ELSEWHERE}`],
    ['POST', '/api/nb/switches', { rackId: ELSEWHERE, ...SW }],
    ['POST', `/api/nb/switches/${theirs.json.id}/reading`, reading],
    ['POST', '/api/nb/switches/99999/reading', reading],
  ]) {
    const r = await call(port, memberTok, method, p, body);
    assert.equal(r.status, 404, `${method} ${p} for a rack not theirs: ${r.status} ${r.raw}`);
  }
  for (const [method, p, body] of [
    ['PATCH', `/api/nb/switches/${mine.json.id}`, { label: 'x' }],
    ['DELETE', `/api/nb/switches/${mine.json.id}`],
    ['POST', `/api/nb/switches/${mine.json.id}/test`, {}],
    ['POST', `/api/nb/switches/${mine.json.id}/collect`, {}],
    ['GET', `/api/nb/switches/${mine.json.id}/credentials`],
    ['GET', `/api/nb/switches/${mine.json.id}/data`],
    ['POST', '/api/nb/switches/collect-all', { rackId: RACK }],
  ]) {
    const r = await call(port, memberTok, method, p, body);
    assert.equal(r.status, 403, `${method} ${p} as a member: ${r.status} ${r.raw}`);
    assert.match(r.json.error, /for an admin/);
  }

  // ---- 3. The check is with the SPOC: a ticket for each item, all to them.
  const held = await call(port, adminTok, 'GET', `/api/nb/plans/${planId}`);
  const after = Object.fromEntries(held.json.items.map((i) => [i.uid, i]));
  for (const uid of [DEV, DEV2]) {
    assert.equal(after[uid].decision, 'ticketed');
    assert.equal(after[uid].ticket.assignee, meera.username);
    assert.equal(after[uid].ticket.assigneeEmail, MEERA.email);
    assert.equal(after[uid].ticket.status, 'open');
    assert.equal(after[uid].ticket.scope, 'check');
  }
  assert.equal(after[`if:${DEV}:1`].ticket.sharedWith, DEV, 'the ports share the switch ticket');
  assert.equal(held.json.summary.ticketed, 2);
  const all = await call(port, adminTok, 'GET', '/api/nb/plans/tickets/all');
  assert.equal(all.status, 200, all.raw);
  const mineTickets = all.json.tickets.filter((r) => r.planId === planId);
  assert.equal(mineTickets.length, 2);
  assert.ok(mineTickets.every((r) => r.assignee === meera.username && r.assigneeEmail === MEERA.email));

  // ---- 4. Nothing is assigned from this door any more.
  const GOES_TO_THE_SPOC = 'A check goes to the site SPOC when it is sent. '
    + 'An organization admin reassigns it in Drift Desk.';
  for (const body of [
    { decisions: [{ uid: DEV, decision: 'ticketed', assignee: 'Sam Patel', assigneeId: 9 }] },
    { decisions: [{ uid: '*', decision: 'ticketed', assignee: MEERA.name, note: 'please check all of it' }] },
    { scope: 'rack', assignee: MEERA.name },
  ]) {
    const r = await call(port, adminTok, 'POST', `/api/nb/plans/${planId}/decide`, body);
    assert.equal(r.status, 409, r.raw);
    assert.deepEqual(r.json, { error: GOES_TO_THE_SPOC });
  }
  const mixed = await call(port, adminTok, 'POST', `/api/nb/plans/${planId}/decide`,
    { decisions: [{ uid: '*', decision: 'ticketed', assignee: MEERA.name }, { uid: DEV, decision: 'approved' }] });
  assert.equal(mixed.status, 400, 'a mixed body is still a malformed one');
  const untouched = await call(port, adminTok, 'GET', `/api/nb/plans/${planId}`);
  assert.ok(untouched.json.items.filter((i) => i.ticket && !i.ticket.sharedWith)
    .every((i) => i.ticket.assignee === meera.username), 'a refused assign wrote nothing');

  // ---- 5. The person who sent a check decides nothing on it, whoever they are.
  const adminSent = await call(port, adminTok, 'POST', `/api/nb/plans/${adminPlanId}/submit`, {});
  assert.equal(adminSent.status, 200, adminSent.raw);
  assert.equal(adminSent.json.state, 'assigned');
  const ownCheck = await call(port, adminTok, 'POST', `/api/nb/plans/${adminPlanId}/decide`,
    { decisions: [{ uid: DEV, decision: 'approved' }] });
  assert.equal(ownCheck.status, 403, ownCheck.raw);
  assert.equal(ownCheck.json.error, 'You sent this check, so somebody else has to decide it.');
  const notTheirs = await call(port, otherTok, 'POST', `/api/nb/plans/${planId}/decide`,
    { decisions: [{ uid: DEV, decision: 'approved' }] });
  assert.equal(notTheirs.status, 403, 'a site manager the check is not with');
  assert.equal(notTheirs.json.error, 'Deciding this check is for its SPOC or an organization admin.');
  const bySpoc = await call(port, meeraTok, 'POST', `/api/nb/plans/${adminPlanId}/decide`,
    { decisions: [{ uid: DEV, decision: 'approved', note: 'seen on the report' }] });
  assert.equal(bySpoc.status, 200, `the SPOC decides a check an admin sent: ${bySpoc.raw}`);
  assert.deepEqual(bySpoc.json.applied, [{ uid: DEV, decision: 'approved' }]);
  assert.equal(rows('drift.decide', planId).length, 0, 'nothing decided on the technician\'s check yet');

  // ---- 6. A ticket is still resolved by the person it went to, and nobody else.
  const wrongPerson = await call(port, otherTok, 'POST', `/api/nb/plans/${planId}/tickets/${DEV}/resolve`,
    { finding: 'not mine to close' });
  assert.equal(wrongPerson.status, 403, `a site manager who is not the assignee: ${wrongPerson.raw}`);
  const claimed = await call(port, otherTok, 'POST',
    `/api/nb/plans/${planId}/tickets/${DEV}/resolve?assigneeId=${encodeURIComponent(meera.username)}`,
    { finding: 'not mine to close' });
  assert.equal(claimed.status, 403, 'and nothing in the request makes them the assignee');
  const byHolder = await call(port, meeraTok, 'POST', `/api/nb/plans/${planId}/tickets/${DEV}/resolve`,
    { finding: 'It is at U12. NetBox was wrong.', outcome: 'confirmed' });
  assert.equal(byHolder.status, 200, byHolder.raw);
  assert.equal(byHolder.json.decision, 'pending', 'a resolved ticket is not an approval');
  assert.equal(byHolder.json.ticket.status, 'resolved');
  assert.equal(rows('drift.resolve', planId).length, 1);
  const back = await call(port, adminTok, 'GET', `/api/nb/plans/${planId}`);
  assert.equal(back.json.state, 'assigned', 'the check stays with its holder; it does not follow its tickets');
  assert.equal(back.json.settled, false);

  // ---- 7. An admin who did not send it decides, with or without a finding.
  const decided = await call(port, adminTok, 'POST', `/api/nb/plans/${planId}/decide`,
    { decisions: [{ uid: DEV, decision: 'approved' }, { uid: DEV2, decision: 'rejected', note: 'leave it at 14' }] });
  assert.equal(decided.status, 200, decided.raw);
  assert.equal(decided.json.refused.length, 0, 'nobody is told to assign first any more');
  assert.equal(decided.json.settled, true);
  const decideRows = rows('drift.decide', planId);
  assert.equal(decideRows.length, 2);
  assert.deepEqual(decideRows.find((r) => r.payload.uid === DEV2).payload,
    { uid: DEV2, decision: 'rejected', note: 'leave it at 14' });
  const done = await call(port, adminTok, 'GET', `/api/nb/plans/${planId}`);
  const closed = done.json.items.find((i) => i.uid === DEV).ticket;
  assert.equal(closed.status, 'closed', 'the decision closes the resolved ticket');
  assert.equal(closed.closedWith, 'approved');
  assert.equal(closed.finding, 'It is at U12. NetBox was wrong.', 'the finding survives');
  const open = done.json.items.find((i) => i.uid === DEV2).ticket;
  assert.equal(open.status, 'closed', 'and a ticket still open closes with the decision as its finding');
  assert.equal(open.finding, 'leave it at 14');

  // ---- 8. The write. The old export door cannot write a check nobody has
  // approved; the approval is what writes. NetBox refuses one object, the plan
  // is write_failed and the admins and the SPOC are told; the door is then the
  // retry, and it goes through the fingerprint again.
  const unapproved = await call(port, adminTok, 'POST', `/api/nb/netbox/${scanId}/export`, { planId });
  assert.equal(unapproved.status, 409, `decided is not approved: ${unapproved.raw}`);
  assert.match(unapproved.json.error, /has not been approved yet/);
  assert.equal(inNetBox.size, 0, 'and nothing was written');

  mails.length = 0;
  pushResult = () => ({
    counts: { create: 3, fail: 1 },
    changes: [
      { type: 'Manufacturer', uid: 'mfr:cisco', name: 'Cisco', action: 'create' },
      { type: 'Device', uid: DEV, name: 'SW-12', action: 'create' },
      { type: 'Interface', uid: `if:${DEV}:1`, name: 'Gi1/0/1', action: 'create' },
      { type: 'Interface', uid: `if:${DEV}:2`, name: 'Gi1/0/2', action: 'fail',
        reason: 'lookup failed: "interface name already exists"' },
    ],
  });
  const bySender = await call(port, memberTok, 'POST', `/api/approvals/plans/${planId}/approve`, {});
  assert.equal(bySender.status, 403, `the sender approves nothing: ${bySender.raw}`);
  const failedWrite = await call(port, adminTok, 'POST', `/api/approvals/plans/${planId}/approve`, {});
  assert.equal(failedWrite.status, 200, failedWrite.raw);
  assert.equal(failedWrite.json.final, true);
  assert.equal(failedWrite.json.write.state, 'failed', 'the approval wrote, and NetBox refused part of it');
  assert.equal(failedWrite.json.write.status, 'write_failed');
  assert.equal(failedWrite.json.write.written, 3);
  assert.deepEqual(failedWrite.json.write.failures.map((f) => f.uid), [`if:${DEV}:2`]);
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(mails.filter((m) => /did not finish/.test(m.subject)).map((m) => m.to).sort(),
    [admin.email, MEERA.email].sort(),
    'one email each, to the organization admin and to the SPOC the check is with');
  for (const mail of mails.filter((m) => /did not finish/.test(m.subject))) {
    assert.match(mail.text, /Gi1\/0\/2/);
    assert.match(mail.text, /Nothing else was changed/);
  }
  const halfWritten = await call(port, adminTok, 'GET', `/api/nb/plans/${planId}`);
  assert.equal(halfWritten.json.status, 'write_failed');
  assert.equal(halfWritten.json.summary.failed, 1);
  assert.equal(halfWritten.json.summary.written, 3);
  const inIndex = await call(port, adminTok, 'GET', `/api/nb/plans?rackId=${RACK}&status=write_failed`);
  assert.deepEqual(inIndex.json.plans.map((p) => p.id), [planId], 'the inbox can list a failed write');
  const registry = await call(port, adminTok, 'GET', `/api/approvals/changes?planId=${planId}`);
  assert.equal(registry.status, 200, registry.raw);
  assert.deepEqual(registry.json.changes.map((c) => c.result).sort(), ['failed', 'written', 'written', 'written'],
    'what went in and what was refused are both in the registry');
  assert.equal(registry.json.changes[0].approvedBy, admin.username);
  assert.equal(registry.json.changes[0].writtenBy, 'system');

  // The door is the retry, run by the admin who asks for it.
  pushResult = () => ({
    counts: { create: 1 },
    changes: [{ type: 'Interface', uid: `if:${DEV}:2`, name: 'Gi1/0/2', action: 'create' }],
  });
  const byMember = await call(port, memberTok, 'POST', `/api/nb/netbox/${scanId}/export`, { planId });
  assert.equal(byMember.status, 403, 'never a technician');
  const retried = await call(port, adminTok, 'POST', `/api/nb/netbox/${scanId}/export`, { planId });
  assert.equal(retried.status, 200, `the retry is allowed on a write_failed plan: ${retried.raw}`);
  assert.equal(retried.json.planStatus, 'applied');
  assert.equal(retried.json.planId, planId);
  assert.equal(retried.json.counts.create, 1);
  assert.deepEqual(retried.json.failures, []);
  assert.equal(retried.json.withheld, 1, 'the rejected device is still held back');
  assert.equal(inNetBox.has(DEV2), false);
  assert.equal(mails.filter((m) => /did not finish/.test(m.subject)).length, 2,
    'a clean write sends no failure email');
  const written = await call(port, adminTok, 'GET', `/api/nb/plans/${planId}`);
  assert.equal(written.json.status, 'applied');
  assert.equal(written.json.appliedBy, admin.username);
  const writeRowsAfter = rows('drift.write', planId);
  assert.equal(writeRowsAfter.length, 2, 'the refusal and the retry, both through the door');
  assert.equal(writeRowsAfter[0].status, 'ok', 'newest first: the retry succeeded');
  assert.equal(writeRowsAfter[1].status, 'fail');
  const registryAfter = await call(port, adminTok, 'GET', `/api/approvals/changes?planId=${planId}`);
  assert.equal(registryAfter.json.changes.length, 5, 'the retry added its row to the registry and rewrote none');
  assert.equal(registryAfter.json.changes[0].writtenBy, admin.username);

  const third = await call(port, adminTok, 'POST', `/api/nb/netbox/${scanId}/export`, { planId });
  assert.equal(third.status, 409, 'an applied plan is closed');

  // ---- 9. The door when NetBox has moved since the approval. Nothing is
  // written either way. A check from before checks went to a SPOC has nobody
  // to compare it again, so the comparison as it stands is filed as a new plan;
  // a check that is with a SPOC goes back to them and no second check appears.
  const approvals = require('../../lib/approvals/store');
  const shapeOf = require('../../lib/approvals/shape');
  const sign = (id, patch = {}) => {
    for (const item of approvals.itemsOf(id).filter((i) => i.decidable)) {
      approvals.updateItem(id, item.uid, { decision: 'approved', decidedBy: admin.username,
        decidedById: admin.id, decidedAt: approvals.nowIso() }, { touch: false });
    }
    const hash = shapeOf.payloadHash(approvals.itemsOf(id));
    approvals.updatePlan(id, { status: 'approved', payloadHash: hash, ...patch });
    approvals.addDecision(id, { stage: 'first', approverId: admin.id, approver: admin.username,
      decision: 'approved', payloadHash: hash, planVersion: approvals.getPlan(id).version }, { touch: false });
  };
  pushResult = () => { throw new Error('push was not expected'); };
  // The admin's own check was compared before anything was written, and is
  // with the SPOC: NetBox has moved under it.
  sign(adminPlanId);
  const before = approvals.listPlans({ rackId: RACK, limit: 50 }).length;
  const movedHeld = await call(port, adminTok, 'POST', `/api/nb/netbox/${scanId}/export`, { planId: adminPlanId });
  assert.equal(movedHeld.status, 409, movedHeld.raw);
  assert.match(movedHeld.json.error, /NetBox has changed since this plan was approved, so nothing was written/);
  assert.equal(movedHeld.json.newPlanId, undefined);
  assert.match(movedHeld.json.next, /back with its SPOC/);
  assert.equal(approvals.getPlan(adminPlanId).status, 'assigned');
  assert.equal(approvals.getPlan(adminPlanId).spocUserId, meera.id);
  assert.equal(approvals.listPlans({ rackId: RACK, limit: 50 }).length, before, 'no second check was filed');
  assert.equal(approvals.changesOf(adminPlanId).length, 0);

  // The same check as it would be had it been filed before checks went to a SPOC.
  sign(adminPlanId, { spocUserId: null, spoc: null });
  const movedOld = await call(port, adminTok, 'POST', `/api/nb/netbox/${scanId}/export`, { planId: adminPlanId });
  assert.equal(movedOld.status, 409, movedOld.raw);
  assert.match(movedOld.json.error, /NetBox has changed since this plan was approved, so nothing was written/);
  assert.ok(movedOld.json.newPlanId && movedOld.json.newPlanId !== adminPlanId,
    'the comparison as it stands is filed to review');
  assert.equal(approvals.getPlan(adminPlanId).status, 'approval_pending', 'and the old plan waits to be approved again');
  assert.equal(approvals.getPlan(movedOld.json.newPlanId).status, 'draft', 'a draft: it goes to the SPOC like any check');

  // The audit rows carry the plan's own tenant, the Site the rack was scanned under.
  const anyRow = rows('drift.decide', planId)[0];
  assert.ok(anyRow, 'a decide row exists');
  const tenantOfRow = db.prepare('SELECT tenant_id FROM audit_log WHERE id = ?').get(anyRow.id);
  assert.equal(tenantOfRow.tenant_id, siteId);
});
