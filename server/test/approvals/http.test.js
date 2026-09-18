/**
 * /api/approvals, driven over HTTP against the real app.
 *
 * Booted the way test/org_remove.test.js boots it, with NetBox, ServiceNow and
 * the mail transport stubbed at the module boundary, so what is under test is
 * the workflow and nothing else. These are the rules the sub-application is
 * not allowed to bend, checked where a browser would meet them:
 *
 *   - each role reaches its own routes and is refused the rest
 *   - another organization's plan is a 404, not a 403
 *   - the demo path: submit, triage, assign the whole rack, accept, resolve,
 *     skip the verification scan with a reason, approve, write
 *   - a reject needs a reason code and a comment
 *   - whoever resolved a ticket cannot approve the plan
 *   - a critical plan needs two different approvers
 *   - a rebind is approved with nobody sent to the rack; a port created under
 *     one is a question of its own and waits for a ticket
 *   - nothing is written when nothing was approved, and a plan with an open
 *     ticket is not settled
 *   - a written plan takes no more ticket work
 *   - a whole-rack assign takes only what is waiting, and refuses a mixed body
 *   - a port's shared ticket is resolved through its device, not on its own
 *   - the fingerprint of a known input is a known hash
 *
 * The shared auth.db is left as it was found: both organizations are removed
 * at the end, which takes their members and every approval row with them.
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
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-approvals-http';
process.env.RACKTRACK_SKIP_WORKER_POOL = '1';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-approvals-'));
process.env.RT_DATA_DIR = path.join(tmp, 'data', 'netbox');
process.env.RT_OUTPUTS_DIR = path.join(tmp, 'outputs');
// A NetBox "exists" for the env fallback; every call to it is stubbed below.
process.env.NETBOX_URL = 'http://netbox.test';
process.env.NETBOX_TOKEN = 'test-token';
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const stamp = Date.now();
const MEERA = { name: 'Meera Raghavan', email: `appr.meera.${stamp}@sprintpark.test`,
                title: 'DC lead', phone: null, netboxId: 7 };
const SAM = { name: 'Sam Patel', email: `appr.sam.${stamp}@sprintpark.test`,
              title: null, phone: null, netboxId: 8 };

// The contacts NetBox knows, and the rack it recognises - stubbed before the
// app loads, because the routers take these off the module at require time.
const spoc = require('../../lib/netbox/spoc');
const rackMatch = require('../../lib/netbox/rack_match');
rackMatch.resolveRack = async () => ({ name: 'RACK-01', rackKey: null, source: 'scan',
                                       confidence: 'none', why: 'stubbed for the test' });
spoc.forRack = async () => ({ spoc: { ...MEERA, via: 'rack', role: 'spoc' }, others: [],
                              rack: { id: 1, name: 'RACK-01' }, site: { id: 1, name: 'HQ' }, why: null });
spoc.everyone = async () => [MEERA, SAM];

const auth = require('../../auth');
const mails = [];
auth.sendNotice = async (m) => { mails.push(m); return true; };

const { app } = require('../../app');
const service = require('../../lib/approvals/service');
const shape = require('../../lib/approvals/shape');

const db = auth.db;

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
function seedOwner() {
  const existing = db.prepare('SELECT * FROM users WHERE username = ?').get('approvals-http-owner');
  if (existing) return existing;
  const tenantId = db.prepare(`SELECT id FROM tenants WHERE slug = 'default'`).get()?.id
                ?? db.prepare('SELECT id FROM tenants ORDER BY id LIMIT 1').get()?.id;
  db.prepare(`INSERT INTO users (email, username, password_hash, role, tenant_id, active)
              VALUES (?, ?, 'x', 'owner', ?, 1)`)
    .run('approvals-http-owner@example.com', 'approvals-http-owner', tenantId);
  return db.prepare('SELECT * FROM users WHERE username = ?').get('approvals-http-owner');
}
function seedUser({ username, email, role, tenantId, orgId }) {
  db.prepare(`INSERT INTO users (email, username, password_hash, role, tenant_id, organization_id, active)
              VALUES (?, ?, 'x', ?, ?, ?, 1)`).run(email, username, role, tenantId, orgId);
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

const RACK = `RK-APPROVE${String(stamp).slice(-4)}`;
const DEV = `dev:${RACK}:u12`;
const DEV2 = `dev:${RACK}:u15`;
const PORT1 = `if:${DEV}:1`;
const REBIND = `dev:${RACK}:u20`;
const REBIND_PORT = `if:${REBIND}:1`;

/** A comparison result shaped exactly as writer.plan() returns one. */
const report = (changes) => ({
  rackUid: `rack:${RACK}`, netboxUrl: 'http://netbox.test', customField: 'present',
  counts: { create: 3, update: 1 }, warnings: [], orphans: [],
  changes: changes || [
    { type: 'Manufacturer', uid: 'mfr:cisco', name: 'Cisco', action: 'create' },
    { type: 'Device', uid: DEV, name: 'SW-12', action: 'create' },
    { type: 'Interface', uid: PORT1, name: 'Gi1/0/1', action: 'create' },
    { type: 'Device', uid: DEV2, name: 'FW-15', action: 'update', netboxId: 44,
      diff: { position: { from: 14, to: 15 } } },
  ],
});

test('the approvals routes hold the workflow at every door', async (t) => {
  const { server, port } = await listen();
  let cleanup = async () => {};
  t.after(async () => {
    try { await cleanup(); } catch { /* best effort */ }
    await new Promise((r) => server.close(r));
  });

  // ---- The cast: one organization with every role, and a second organization
  // that must never see any of it.
  const ownerTok = auth.makeToken(seedOwner());
  const makeOrg = async (name, who) => {
    const created = await call(port, ownerTok, 'POST', '/api/orgs', {
      name: `${name} ${stamp}`, adminUsername: `${who}.admin.${stamp}`,
      adminEmail: `${who}.admin.${stamp}@example.test`, adminPassword: 'Approve@2026!',
    });
    assert.equal(created.status, 200, created.raw);
    const orgId = created.json.organization.id;
    const site = await call(port, ownerTok, 'POST', `/api/orgs/${orgId}/sites`, { name: `${name} Site` });
    assert.equal(site.status, 200, site.raw);
    return { orgId, siteId: site.json.site.id,
             admin: db.prepare('SELECT * FROM users WHERE username = ?').get(`${who}.admin.${stamp}`) };
  };
  const a = await makeOrg('Approvals A', 'apa');
  const b = await makeOrg('Approvals B', 'apb');
  cleanup = async () => {
    for (const orgId of [a.orgId, b.orgId]) {
      const gone = await call(port, ownerTok, 'DELETE', `/api/orgs/${orgId}`);
      if (gone.status !== 200) throw new Error(`cleanup ${orgId}: ${gone.status} ${gone.raw}`);
    }
  };

  const tech = seedUser({ username: `apa.tech.${stamp}`, email: `apa.tech.${stamp}@example.test`,
                          role: 'member', tenantId: a.siteId, orgId: a.orgId });
  const manager = seedUser({ username: `apa.mgr.${stamp}`, email: `apa.mgr.${stamp}@example.test`,
                             role: 'site_manager', tenantId: a.siteId, orgId: a.orgId });
  const approver = seedUser({ username: `apa.appr.${stamp}`, email: `apa.appr.${stamp}@example.test`,
                              role: 'approver', tenantId: a.siteId, orgId: a.orgId });
  const approver2 = seedUser({ username: `apa.appr2.${stamp}`, email: `apa.appr2.${stamp}@example.test`,
                               role: 'approver', tenantId: a.siteId, orgId: a.orgId });
  const auditor = seedUser({ username: `apa.audit.${stamp}`, email: `apa.audit.${stamp}@example.test`,
                             role: 'auditor', tenantId: a.siteId, orgId: a.orgId });
  // The assignee: a RackTrack user whose email is the NetBox contact's, so a
  // ticket raised on that contact resolves to this account.
  const meera = seedUser({ username: `apa.meera.${stamp}`, email: MEERA.email,
                           role: 'member', tenantId: a.siteId, orgId: a.orgId });
  const tok = Object.fromEntries(Object.entries({
    admin: a.admin, tech, manager, approver, approver2, auditor, meera, bAdmin: b.admin,
  }).map(([k, u]) => [k, auth.makeToken(u)]));

  /** File a comparison as a plan, the way the preview route does. */
  const file = (changes, who = tech, org = a) => service.create({
    scanId: 1, rackId: RACK, rackName: 'RACK-01', report: report(changes),
    actor: who, orgId: org.orgId, tenantId: org.siteId,
  }).plan.id;

  // ================= 1. The doors =================
  const plan = file();
  assert.equal((await call(port, tok.tech, 'POST', `/api/approvals/plans/${plan}/submit`, {})).status, 200,
    'a technician hands over their own comparison');
  const nope = (r, why) => assert.equal(r.status, 403, `${why}: ${r.status} ${r.raw}`);

  assert.equal((await call(port, tok.tech, 'GET', '/api/approvals/me')).status, 200);
  assert.equal((await call(port, tok.auditor, 'GET', '/api/approvals/queue')).status, 200);
  assert.equal((await call(port, tok.approver, 'GET', '/api/approvals/dashboard')).status, 200);
  assert.equal((await call(port, tok.tech, 'GET', '/api/approvals/plans')).status, 200);

  nope(await call(port, tok.tech, 'POST', `/api/approvals/plans/${plan}/triage`, { priority: 'P2' }),
    'a technician does not triage');
  nope(await call(port, tok.approver, 'POST', `/api/approvals/plans/${plan}/assign`,
    { items: '*', assignee: MEERA.name }), 'an approver does not assign');
  nope(await call(port, tok.auditor, 'POST', `/api/approvals/plans/${plan}/assign`,
    { items: '*', assignee: MEERA.name }), 'an auditor does not assign');
  nope(await call(port, tok.manager, 'POST', `/api/approvals/plans/${plan}/approve`, {}),
    'a site manager does not approve');
  nope(await call(port, tok.tech, 'POST', `/api/approvals/plans/${plan}/decide`,
    { decisions: [{ uid: DEV, decision: 'approved' }] }), 'a technician decides nothing');
  nope(await call(port, tok.manager, 'PUT', '/api/approvals/settings/dual_approval_risks',
    { value: ['high'] }), 'a site manager does not change settings');
  const auditComment = await call(port, tok.auditor, 'POST', `/api/approvals/plans/${plan}/comments`,
    { body: 'reading only' });
  assert.equal(auditComment.status, 403, auditComment.raw);
  assert.match(auditComment.json.error, /auditor reads/i);

  // A site manager of the Site triages and assigns; that is their whole job here.
  assert.equal((await call(port, tok.manager, 'POST', `/api/approvals/plans/${plan}/triage`,
    { priority: 'P3' })).status, 200);

  // ================= 2. Another organization's plan is not there =================
  const theirs = file(undefined, b.admin, b);
  const peek = await call(port, tok.admin, 'GET', `/api/approvals/plans/${theirs}`);
  assert.equal(peek.status, 404, `another org's plan: ${peek.raw}`);
  const poke = await call(port, tok.admin, 'POST', `/api/approvals/plans/${theirs}/triage`, { priority: 'P1' });
  assert.equal(poke.status, 404, 'and it cannot be triaged either');
  const listed = await call(port, tok.admin, 'GET', '/api/approvals/plans');
  assert.ok(!listed.json.plans.some((p) => p.id === theirs), 'nor listed');

  // ================= 3. The demo path =================
  mails.length = 0;
  const p1 = file();
  const submitted = await call(port, tok.tech, 'POST', `/api/approvals/plans/${p1}/submit`,
    { note: 'U15 looks wrong to me' });
  assert.equal(submitted.status, 200, submitted.raw);
  assert.equal(submitted.json.plan.status, 'triage', 'submit hands it straight to triage');
  assert.equal(submitted.json.plan.submittedNote, 'U15 looks wrong to me');

  const triaged = await call(port, tok.admin, 'POST', `/api/approvals/plans/${p1}/triage`,
    { priority: 'P2', risk: 'medium', category: 'drift', note: 'a rack we care about' });
  assert.equal(triaged.status, 200, triaged.raw);
  assert.equal(triaged.json.plan.priority, 'P2');
  assert.equal(triaged.json.plan.risk, 'medium');

  // A mixed body is refused before anything is written.
  const mixed = await call(port, tok.admin, `POST`, `/api/approvals/plans/${p1}/assign`,
    { items: ['*', DEV], assignee: MEERA.name });
  assert.equal(mixed.status, 400, mixed.raw);
  assert.match(mixed.json.error, /whole-rack assign on its own/);

  const rack = await call(port, tok.admin, 'POST', `/api/approvals/plans/${p1}/assign`,
    { items: '*', assignee: MEERA.name, question: 'please check the whole rack' });
  assert.equal(rack.status, 200, rack.raw);
  assert.equal(rack.json.wholeRack, true);
  assert.deepEqual(rack.json.applied, [{ uid: DEV, decision: 'ticketed' }, { uid: DEV2, decision: 'ticketed' }]);
  assert.deepEqual(rack.json.waiting, [], 'the server says what is left, so a count cannot disagree');
  assert.equal(rack.json.plan.status, 'assigned');
  // One courtesy email per person, whatever they were handed. The approval
  // workflow's own notifications go out beside it, so this looks for the
  // assignment email rather than counting every message on the wire.
  // The courtesy email is the one that LISTS what the person was handed; the
  // workflow's own notification says a rack needs checking and no more.
  const asked = mails.filter((m) => /SW-12/.test(m.text) && /FW-15/.test(m.text));
  assert.equal(asked.length, 1, `one assignment email: ${JSON.stringify(mails.map((m) => m.subject))}`);
  assert.equal(asked[0].to, MEERA.email, 'sent to the person, at the address NetBox holds');
  assert.match(asked[0].subject, /please check rack RACK-01 \(2 items\)/);

  const withTickets = await call(port, tok.admin, 'GET', `/api/approvals/plans/${p1}`);
  assert.equal(withTickets.json.plan.settled, false, 'a plan with an open ticket is not settled');
  assert.equal(withTickets.json.plan.summary.openTickets, 2);
  const port1 = withTickets.json.items.find((i) => i.uid === PORT1);
  assert.equal(port1.following, true, 'the port follows its switch');
  assert.equal(port1.decision, 'ticketed');
  assert.ok(!withTickets.json.tickets.some((x) => x.itemUid === PORT1),
    'and has no ticket of its own: one incident per device');

  // The port's ticket is the device's, so it is resolved through the device.
  const sharedResolve = await call(port, tok.meera, 'POST',
    `/api/approvals/plans/${p1}/tickets/${encodeURIComponent(PORT1)}/resolve`, { finding: 'port is fine' });
  assert.equal(sharedResolve.status, 409, sharedResolve.raw);
  assert.match(sharedResolve.json.error, /follows its device/);

  const accepted = await call(port, tok.meera, 'POST',
    `/api/approvals/plans/${p1}/tickets/${encodeURIComponent(DEV)}/accept`, {});
  assert.equal(accepted.status, 200, accepted.raw);
  assert.equal(accepted.json.ticket.status, 'accepted');
  const started = await call(port, tok.meera, 'POST',
    `/api/approvals/plans/${p1}/tickets/${encodeURIComponent(DEV)}/start`, {});
  assert.equal(started.status, 200, started.raw);
  assert.equal(started.json.plan.status, 'assigned', 'the plan shows the least advanced ticket');

  const noFinding = await call(port, tok.meera, 'POST',
    `/api/approvals/plans/${p1}/tickets/${encodeURIComponent(DEV)}/resolve`, {});
  assert.equal(noFinding.status, 409, 'resolving says what was found, or it is not a resolve');
  assert.match(noFinding.json.error, /say what you found/);

  for (const uid of [DEV, DEV2]) {
    const done = await call(port, tok.meera, 'POST',
      `/api/approvals/plans/${p1}/tickets/${encodeURIComponent(uid)}/resolve`,
      { finding: `checked ${uid} at the rack`, disposition: 'remediate' });
    assert.equal(done.status, 200, done.raw);
    assert.equal(done.json.item.decision, 'pending', 'a resolved ticket is not an approval');
  }
  const backWithAdmin = await call(port, tok.admin, 'GET', `/api/approvals/plans/${p1}`);
  assert.equal(backWithAdmin.json.plan.status, 'verification_pending',
    'every ticket back means the plan waits for the verification scan');
  assert.deepEqual(backWithAdmin.json.assignable, [],
    'an item that has come back waits on the admin, not on an assignment');
  // An item that has come back is undecided again, but it is NOT waiting to be
  // handed out: a whole-rack assign here would raise a second incident over
  // the top of a finding somebody walked to the rack for.
  const wouldWipe = await call(port, tok.admin, 'POST', `/api/approvals/plans/${p1}/assign`,
    { items: '*', assignee: SAM.name });
  assert.equal(wouldWipe.status, 409, wouldWipe.raw);
  const keptFinding = await call(port, tok.admin, 'GET', `/api/approvals/plans/${p1}`);
  assert.match(keptFinding.json.tickets.find((x) => x.itemUid === DEV).finding, /checked/,
    'and the finding is still there');

  // The admin may step past the verification scan, but only with a reason.
  const noReason = await call(port, tok.admin, 'POST', `/api/approvals/plans/${p1}/verify/skip`, {});
  assert.equal(noReason.status, 409, noReason.raw);
  assert.equal(noReason.json.code, 'guard');
  assert.equal(noReason.json.from, 'verification_pending');
  assert.equal(noReason.json.to, 'approval_pending');
  assert.match(noReason.json.why, /needs a reason/);
  const skipped = await call(port, tok.admin, 'POST', `/api/approvals/plans/${p1}/verify/skip`,
    { reason: 'the rack is 300 miles away and the finding is photographic' });
  assert.equal(skipped.status, 200, skipped.raw);
  assert.equal(skipped.json.plan.status, 'approval_pending');
  assert.equal(skipped.json.plan.verification.result, 'skipped');

  // Nothing is approved yet, so a plan-level approval has nothing to sign.
  const tooEarly = await call(port, tok.approver, 'POST', `/api/approvals/plans/${p1}/approve`, {});
  assert.equal(tooEarly.status, 409, tooEarly.raw);
  assert.equal(tooEarly.json.code, 'guard');
  assert.match(tooEarly.json.why, /still undecided/);

  const decided = await call(port, tok.approver, 'POST', `/api/approvals/plans/${p1}/decide`,
    { decisions: [{ uid: DEV, decision: 'approved' }, { uid: DEV2, decision: 'rejected', reasonCode: 'wrong_asset', note: 'leave it at 14' }] });
  assert.equal(decided.status, 200, decided.raw);
  assert.equal(decided.json.refused.length, 0, decided.raw);

  const approved = await call(port, tok.approver, 'POST', `/api/approvals/plans/${p1}/approve`,
    { comment: 'checked against the photos' });
  assert.equal(approved.status, 200, approved.raw);
  assert.equal(approved.json.plan.status, 'approved');
  assert.equal(approved.json.final, true);
  assert.equal(approved.json.needsSecond, false);
  assert.equal(approved.json.decision.stage, 'first');
  assert.ok(approved.json.decision.payloadHash, 'the approval signs one specific list');

  // The write. Its route belongs to the write builder, so the last step is
  // driven through the service the route will call, with a fresh comparison
  // that still matches: the plan is written, its ports with it.
  const items = service.get(p1, a.admin).items;
  const fresh = report().changes.filter((c) => !shape.excludedUids(items).has(c.uid));
  const begun = service.beginWrite(p1, { actor: a.admin, freshChanges: report().changes });
  assert.ok(!begun.error, `the write opens: ${begun.error || ''}`);
  assert.equal(begun.plan.status, 'write_in_progress');
  assert.ok(begun.excluded.has(DEV2), 'the rejected device is held back');
  const written = service.finishWrite(p1, { actor: a.admin,
    result: { counts: { create: 3 }, changes: fresh } });
  assert.equal(written.status, 'written');
  assert.equal(written.result.failed, 0);
  assert.ok(written.result.written >= 3);

  // A written plan takes no more work at the rack.
  const late = await call(port, tok.meera, 'POST',
    `/api/approvals/plans/${p1}/tickets/${encodeURIComponent(DEV)}/resolve`, { finding: 'too late' });
  assert.equal(late.status, 409, late.raw);
  assert.match(late.json.error, /already been written/);

  // ================= 4. A reject needs a reason code and a comment =================
  const p2 = file();
  await call(port, tok.tech, 'POST', `/api/approvals/plans/${p2}/submit`, {});
  await call(port, tok.admin, 'POST', `/api/approvals/plans/${p2}/assign`,
    { items: '*', assignee: MEERA.name });
  for (const uid of [DEV, DEV2]) {
    await call(port, tok.meera, 'POST',
      `/api/approvals/plans/${p2}/tickets/${encodeURIComponent(uid)}/resolve`, { finding: 'looked' });
  }
  await call(port, tok.admin, 'POST', `/api/approvals/plans/${p2}/verify/skip`, { reason: 'checked by photo' });
  const bare = await call(port, tok.approver, 'POST', `/api/approvals/plans/${p2}/reject`, {});
  assert.equal(bare.status, 409, bare.raw);
  assert.equal(bare.json.code, 'guard');
  assert.match(bare.json.why, /reason code is needed/);
  const noWords = await call(port, tok.approver, 'POST', `/api/approvals/plans/${p2}/reject`,
    { reasonCode: 'insufficient_evidence' });
  assert.equal(noWords.status, 409, noWords.raw);
  assert.match(noWords.json.why, /comment is needed/);
  const rejected = await call(port, tok.approver, 'POST', `/api/approvals/plans/${p2}/reject`,
    { reasonCode: 'insufficient_evidence', comment: 'the photo does not show the label' });
  assert.equal(rejected.status, 200, rejected.raw);
  assert.equal(rejected.json.plan.status, 'rejected');
  const thread = await call(port, tok.tech, 'GET', `/api/approvals/plans/${p2}/comments`);
  assert.equal(thread.status, 200, thread.raw);
  assert.ok(thread.json.comments.some((c) => /does not show the label/.test(c.body)),
    'the person who raised it can read why');

  // Rework is the same door with a softer word.
  const p3 = file();
  await call(port, tok.tech, 'POST', `/api/approvals/plans/${p3}/submit`, {});
  await call(port, tok.admin, 'POST', `/api/approvals/plans/${p3}/assign`, { items: '*', assignee: MEERA.name });
  for (const uid of [DEV, DEV2]) {
    await call(port, tok.meera, 'POST',
      `/api/approvals/plans/${p3}/tickets/${encodeURIComponent(uid)}/resolve`, { finding: 'looked' });
  }
  await call(port, tok.admin, 'POST', `/api/approvals/plans/${p3}/verify/skip`, { reason: 'checked by photo' });
  const rework = await call(port, tok.approver, 'POST', `/api/approvals/plans/${p3}/rework`,
    { reasonCode: 'incorrect_remediation', comment: 'the switch was moved, not replaced' });
  assert.equal(rework.status, 200, rework.raw);
  assert.equal(rework.json.plan.status, 'rework');

  // ================= 5. The resolver cannot approve =================
  const p4 = file();
  await call(port, tok.tech, 'POST', `/api/approvals/plans/${p4}/submit`, {});
  await call(port, tok.admin, 'POST', `/api/approvals/plans/${p4}/assign`, { items: '*', assignee: MEERA.name });
  for (const uid of [DEV, DEV2]) {
    // The admin resolves them: that is allowed, and it costs them the approval.
    const r = await call(port, tok.admin, 'POST',
      `/api/approvals/plans/${p4}/tickets/${encodeURIComponent(uid)}/resolve`, { finding: 'I looked myself' });
    assert.equal(r.status, 200, r.raw);
  }
  await call(port, tok.admin, 'POST', `/api/approvals/plans/${p4}/verify/skip`, { reason: 'I was at the rack' });
  await call(port, tok.approver, 'POST', `/api/approvals/plans/${p4}/decide`,
    { decisions: [{ uid: DEV, decision: 'approved' }, { uid: DEV2, decision: 'approved' }] });
  const selfApprove = await call(port, tok.admin, 'POST', `/api/approvals/plans/${p4}/approve`, {});
  assert.equal(selfApprove.status, 403, selfApprove.raw);
  assert.match(selfApprove.json.error, /somebody else has to make this decision/);
  const byApprover = await call(port, tok.approver, 'POST', `/api/approvals/plans/${p4}/approve`, {});
  assert.equal(byApprover.status, 200, byApprover.raw);

  // ================= 6. Dual approval on a critical plan =================
  const p5 = file();
  await call(port, tok.tech, 'POST', `/api/approvals/plans/${p5}/submit`, {});
  const critical = await call(port, tok.admin, 'POST', `/api/approvals/plans/${p5}/triage`, { risk: 'critical' });
  assert.equal(critical.json.plan.risk, 'critical');
  await call(port, tok.admin, 'POST', `/api/approvals/plans/${p5}/assign`, { items: '*', assignee: MEERA.name });
  for (const uid of [DEV, DEV2]) {
    await call(port, tok.meera, 'POST',
      `/api/approvals/plans/${p5}/tickets/${encodeURIComponent(uid)}/resolve`, { finding: 'looked' });
  }
  await call(port, tok.admin, 'POST', `/api/approvals/plans/${p5}/verify/skip`, { reason: 'photo evidence' });
  await call(port, tok.approver, 'POST', `/api/approvals/plans/${p5}/decide`,
    { decisions: [{ uid: DEV, decision: 'approved' }, { uid: DEV2, decision: 'approved' }] });
  const first = await call(port, tok.approver, 'POST', `/api/approvals/plans/${p5}/approve`, { comment: 'one' });
  assert.equal(first.status, 200, first.raw);
  assert.equal(first.json.needsSecond, true, 'critical asks for two names');
  assert.equal(first.json.plan.status, 'approval_pending', 'and stays waiting after the first');
  const sameAgain = await call(port, tok.approver, 'POST', `/api/approvals/plans/${p5}/approve`, { comment: 'me again' });
  assert.equal(sameAgain.status, 409, sameAgain.raw);
  assert.match(sameAgain.json.why, /different person/);
  const second = await call(port, tok.approver2, 'POST', `/api/approvals/plans/${p5}/approve`, { comment: 'two' });
  assert.equal(second.status, 200, second.raw);
  assert.equal(second.json.stage, 'second');
  assert.equal(second.json.plan.status, 'approved');

  // ================= 7. Rebinds, and what follows one =================
  const p6 = file([
    { type: 'Device', uid: DEV, name: 'SW-12', action: 'create' },
    { type: 'Device', uid: REBIND, name: 'SW-20', action: 'rebind', netboxId: 7,
      fromUid: `dev:RK-OLD:u20`, diff: { racktrack_uid: { from: 'dev:RK-OLD:u20', to: REBIND } } },
    { type: 'Interface', uid: REBIND_PORT, name: 'Gi1/0/1', action: 'create' },
  ]);
  await call(port, tok.tech, 'POST', `/api/approvals/plans/${p6}/submit`, {});
  const detail = await call(port, tok.admin, 'GET', `/api/approvals/plans/${p6}`);
  const child = detail.json.items.find((i) => i.uid === REBIND_PORT);
  assert.equal(child.following, false, 'a created port under a rebind is not waved through with it');
  assert.equal(child.decidable, true, 'it is a question of its own');
  assert.deepEqual(detail.json.assignable.sort(), [DEV, REBIND_PORT].sort(),
    'a whole-rack assign takes the create and the port, and steps over the rebind');

  const rackAssign = await call(port, tok.admin, 'POST', `/api/approvals/plans/${p6}/assign`,
    { items: '*', assignee: MEERA.name });
  assert.equal(rackAssign.status, 200, rackAssign.raw);
  assert.deepEqual(rackAssign.json.applied.map((d) => d.uid).sort(), [DEV, REBIND_PORT].sort());
  const rebindTicket = await call(port, tok.admin, 'POST', `/api/approvals/plans/${p6}/assign`,
    { items: [REBIND], assignee: MEERA.name });
  assert.equal(rebindTicket.json.applied.length, 0, 'a rebind is never sent to the rack');
  assert.match(rebindTicket.json.refused[0].why, /nothing to check at the rack/);
  // And it is decided as it stands, with nobody having been asked.
  const rebindDecision = await call(port, tok.approver, 'POST', `/api/approvals/plans/${p6}/decide`,
    { decisions: [{ uid: REBIND, decision: 'approved' }] });
  assert.deepEqual(rebindDecision.json.applied, [{ uid: REBIND, decision: 'approved' }]);
  const childDecision = await call(port, tok.approver, 'POST', `/api/approvals/plans/${p6}/decide`,
    { decisions: [{ uid: REBIND_PORT, decision: 'approved' }] });
  assert.deepEqual(childDecision.json.refused, [{ uid: REBIND_PORT, why: 'assign first' }],
    'the port under it waits for somebody to have looked');

  // A second whole-rack assign takes nothing: one is out with somebody and
  // the other two are decided. It never wipes a finding.
  const nothingLeft = await call(port, tok.admin, 'POST', `/api/approvals/plans/${p6}/assign`,
    { items: '*', assignee: MEERA.name });
  assert.equal(nothingLeft.status, 409, nothingLeft.raw);
  assert.match(nothingLeft.json.error, /nothing on this plan is waiting/);

  // ================= 8. Nothing approved, nothing written =================
  const p7 = file();
  await call(port, tok.tech, 'POST', `/api/approvals/plans/${p7}/submit`, {});
  await call(port, tok.admin, 'POST', `/api/approvals/plans/${p7}/assign`, { items: '*', assignee: MEERA.name });
  for (const uid of [DEV, DEV2]) {
    await call(port, tok.meera, 'POST',
      `/api/approvals/plans/${p7}/tickets/${encodeURIComponent(uid)}/resolve`, { finding: 'not there' });
  }
  await call(port, tok.admin, 'POST', `/api/approvals/plans/${p7}/verify/skip`, { reason: 'photo evidence' });
  await call(port, tok.approver, 'POST', `/api/approvals/plans/${p7}/decide`, { decisions: [
    { uid: DEV, decision: 'rejected', reasonCode: 'wrong_asset', note: 'no' },
    { uid: DEV2, decision: 'rejected', reasonCode: 'wrong_asset', note: 'no' }] });
  await call(port, tok.approver, 'POST', `/api/approvals/plans/${p7}/approve`, {});
  const empty = service.beginWrite(p7, { actor: a.admin, freshChanges: report().changes });
  assert.equal(empty.done, true, 'an approved plan with nothing approved on it completes, it does not write');
  assert.equal(empty.plan.status, 'completed');

  // ================= 9. The desk's own screens =================
  // The auditor's history: the transitions across the plans they may read.
  const history = await call(port, tok.auditor, 'GET', '/api/approvals/events?limit=200');
  assert.equal(history.status, 200, history.raw);
  const rows = history.json.events;
  assert.ok(rows.length > 0, 'there is a history to read');
  assert.ok(rows.every((e) => typeof e.id === 'number' && e.planId && e.action && e.ts),
    'every row names the plan, what happened and when');
  const approvedRow = rows.find((e) => e.action === 'approve' && e.planId === p4);
  assert.ok(approvedRow, 'the approval is in it');
  assert.equal(approvedRow.actor.username, approver.username, 'with the name against it');
  assert.equal(approvedRow.toStatus, 'approved');
  assert.ok(approvedRow.rackId, 'and the rack it was about');
  assert.ok(!rows.some((e) => e.planId === theirs), "and nothing from another organization");
  const one = await call(port, tok.auditor, 'GET', `/api/approvals/events?planId=${p4}&action=approve`);
  assert.ok(one.json.events.length >= 1 && one.json.events.every((e) => e.planId === p4
    && e.action === 'approve'), 'and it filters');
  assert.equal((await call(port, tok.tech, 'GET', '/api/approvals/events')).status, 403,
    'a technician does not read across plans');

  // A failed write handed to a person, with a reason.
  const p8 = file();
  await call(port, tok.tech, 'POST', `/api/approvals/plans/${p8}/submit`, {});
  await call(port, tok.admin, 'POST', `/api/approvals/plans/${p8}/assign`, { items: '*', assignee: MEERA.name });
  for (const uid of [DEV, DEV2]) {
    await call(port, tok.meera, 'POST',
      `/api/approvals/plans/${p8}/tickets/${encodeURIComponent(uid)}/resolve`, { finding: 'looked' });
  }
  await call(port, tok.admin, 'POST', `/api/approvals/plans/${p8}/verify/skip`, { reason: 'photo evidence' });
  await call(port, tok.approver, 'POST', `/api/approvals/plans/${p8}/decide`,
    { decisions: [{ uid: DEV, decision: 'approved' }, { uid: DEV2, decision: 'approved' }] });
  await call(port, tok.approver, 'POST', `/api/approvals/plans/${p8}/approve`, {});
  service.beginWrite(p8, { actor: a.admin, freshChanges: report().changes });
  service.finishWrite(p8, { actor: a.admin, result: { counts: { create: 1, fail: 1 }, changes: [
    { type: 'Device', uid: DEV, name: 'SW-12', action: 'create' },
    { type: 'Device', uid: DEV2, name: 'FW-15', action: 'fail', reason: 'position 15 is taken' }] } });
  const noReasonGiven = await call(port, tok.admin, 'POST', `/api/approvals/plans/${p8}/manual-review`, {});
  assert.equal(noReasonGiven.status, 409, noReasonGiven.raw);
  assert.match(noReasonGiven.json.why, /a reason is needed/);
  assert.equal((await call(port, tok.manager, 'POST', `/api/approvals/plans/${p8}/manual-review`,
    { reason: 'x' })).status, 403, 'a site manager does not take a write out of the loop');
  const handed = await call(port, tok.admin, 'POST', `/api/approvals/plans/${p8}/manual-review`,
    { reason: 'U15 is occupied in NetBox; somebody has to look' });
  assert.equal(handed.status, 200, handed.raw);
  assert.equal(handed.json.plan.status, 'manual_review');

  // Compare again, from a rack id rather than a scan id.
  assert.equal((await call(port, tok.approver, 'POST', '/api/approvals/plans/compare',
    { rackId: RACK })).status, 403, 'an approver does not compare');
  const noRack = await call(port, tok.admin, 'POST', '/api/approvals/plans/compare', {});
  assert.equal(noRack.status, 400, noRack.raw);
  assert.match(noRack.json.error, /send \{ rackId \}/);
  const notOurs = await call(port, tok.admin, 'POST', '/api/approvals/plans/compare',
    { rackId: 'RK-SOMEBODYELSE' });
  assert.equal(notOurs.status, 404, "a rack the caller cannot reach is not there");

  // The dashboard's SLA tiles and the list filter use the same five words.
  const board = await call(port, tok.admin, 'GET', '/api/approvals/dashboard');
  assert.deepEqual(board.json.sla.map((t) => t.key),
    ['breached', 'at_risk', 'paused', 'on_track', 'none']);
  for (const tile of board.json.sla) {
    const opened = await call(port, tok.admin, 'GET',
      `/api/approvals/plans?sla=${tile.filters.sla}&open=1&limit=200`);
    assert.equal(opened.status, 200, opened.raw);
    assert.equal(opened.json.plans.length, tile.count,
      `the ${tile.key} tile counts ${tile.count} and its list shows ${opened.json.plans.length}`);
    assert.ok(opened.json.plans.every((pl) => pl.slaState === tile.key),
      `every plan in the ${tile.key} list says so itself`);
  }

  // The settings, in the shape the screens read, all five keys, always.
  const settings = await call(port, tok.admin, 'GET', '/api/approvals/settings');
  assert.equal(settings.status, 200, settings.raw);
  const st = settings.json.settings;
  assert.deepEqual(Object.keys(st).sort(),
    ['calendar', 'dual_approval_risks', 'escalation', 'notification_prefs', 'sla_targets']);
  assert.equal(st.sla_targets.P1.acceptance, 15, 'a target is a whole number of minutes');
  assert.equal(st.sla_targets.P2.resolution, 240);
  assert.deepEqual(st.calendar.days, [1, 2, 3, 4, 5], 'Monday is 1');
  assert.equal(st.calendar.start, '09:00');
  assert.deepEqual(st.dual_approval_risks, ['critical']);
  assert.deepEqual([st.escalation.warnAt, st.escalation.breachAt, st.escalation.escalateAt],
    [80, 100, 120]);
  assert.equal(st.notification_prefs.write_failed.always, true,
    'three notices go out whatever anybody set');
  assert.equal(st.notification_prefs.submitted.email, true);

  const badDay = await call(port, tok.admin, 'PUT', '/api/approvals/settings/calendar',
    { value: { days: [0, 1], start: '09:00', end: '18:00' } });
  assert.equal(badDay.status, 400, badDay.raw);
  assert.match(badDay.json.error, /1 for Monday to 7 for Sunday/);
  const badTarget = await call(port, tok.admin, 'PUT', '/api/approvals/settings/sla_targets',
    { value: { P1: { acceptance: 0, investigation: 30, resolution: 120, approval: 30 } } });
  assert.equal(badTarget.status, 400, badTarget.raw);
  assert.match(badTarget.json.error, /whole number of minutes/);
  const saved = await call(port, tok.admin, 'PUT', '/api/approvals/settings/escalation',
    { value: { warnAt: 70, breachAt: 100, escalateAt: 130 } });
  assert.equal(saved.status, 200, saved.raw);
  assert.deepEqual([saved.json.settings.escalation.warnAt, saved.json.settings.escalation.escalateAt],
    [70, 130], 'and it reads back in the same shape it was sent');
  const rising = await call(port, tok.admin, 'PUT', '/api/approvals/settings/escalation',
    { value: { warnAt: 120, breachAt: 100, escalateAt: 130 } });
  assert.equal(rising.status, 400, rising.raw);
  assert.match(rising.json.error, /rise/);
  const weekend = await call(port, tok.admin, 'PUT', '/api/approvals/settings',
    { key: 'calendar', value: { days: [1, 2, 3, 4, 5, 6, 7], start: '00:00', end: '23:59', holidays: ['2026-12-25'] } });
  assert.equal(weekend.status, 200, weekend.raw);
  assert.deepEqual(weekend.json.settings.calendar.days, [1, 2, 3, 4, 5, 6, 7],
    'seven days out is seven days back, whatever is stored underneath');

  // ================= 10. The fingerprint is a known hash =================
  // Byte for byte what the JSON plans were hashed with: uid NUL action NUL
  // stable JSON of the diff, rows sorted, sha256, first 32 characters. If this
  // ever changes, every approval signed before the change stops matching and
  // no plan can be written - so it is pinned to a value, not to a formula.
  assert.equal(shape.fingerprint([
    { type: 'Manufacturer', uid: 'mfr:tp-link', name: 'TP-Link', action: 'create' },
    { type: 'Device', uid: 'dev:t7:5:u12', name: 'Sw1', action: 'create' },
    { type: 'Device', uid: 'dev:t7:5:u15', name: 'SW2', action: 'update', netboxId: 44,
      diff: { position: { from: 14, to: 15 } } },
    { type: 'Device', uid: 'dev:t7:5:u10', name: 'Core', action: 'noop', netboxId: 45 },
  ]), '0e7ec7c8c8fe6c9b9e945be5700cf874');
});
