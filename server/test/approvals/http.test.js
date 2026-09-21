/**
 * /api/approvals, driven over HTTP against the real app.
 *
 * Booted the way test/org_remove.test.js boots it, with NetBox, ServiceNow and
 * the mail transport stubbed at the module boundary, so what is under test is
 * the workflow and nothing else. These are the rules the sub-application is
 * not allowed to bend, checked where a browser would meet them:
 *
 *   - each role reaches its own routes and is refused the rest; a site manager
 *     no longer triages, assigns or cancels
 *   - another organization's plan is a 404, not a 403
 *   - the demo path: submit lands the check with the SPOC of its site, who
 *     decides each difference and approves it, whatever their role; then the
 *     write
 *   - the person who sent a check is refused at every deciding door
 *   - only an organization admin reassigns, by RackTrack user, with a reason
 *   - a reject needs a reason code and a comment, and carries an incident state
 *   - two names only when the organization has asked for two
 *   - a rebind is approved with nobody sent to the rack
 *   - a check from before the SPOC change keeps its path: tickets, the
 *     verification skip, the approver's decision, assign first
 *   - nothing is written when nothing was approved, and a plan with an open
 *     ticket is not settled
 *   - a written plan takes no more ticket work
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
const estate = require('../../lib/estate');
const spocOfSite = require('../../lib/approvals/spoc');

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
  // The SPOC of the Site: a plain member, named by setup. Her email is also
  // the NetBox contact's, so a contact picked by name resolves to this account.
  const meera = seedUser({ username: `apa.meera.${stamp}`, email: MEERA.email,
                           role: 'member', tenantId: a.siteId, orgId: a.orgId });
  estate.setApprover(a.siteId, { user_id: meera.id }, a.admin.id);
  const tok = Object.fromEntries(Object.entries({
    admin: a.admin, tech, manager, approver, approver2, auditor, meera, bAdmin: b.admin,
  }).map(([k, u]) => [k, auth.makeToken(u)]));

  /** File a comparison as a plan, the way the preview route does. */
  const file = (changes, who = tech, org = a) => service.create({
    scanId: 1, rackId: RACK, rackName: 'RACK-01', report: report(changes),
    actor: who, orgId: org.orgId, tenantId: org.siteId,
  }).plan.id;
  const post = (who, id, what, body = {}) => call(port, tok[who], 'POST', `/api/approvals/plans/${id}/${what}`, body);
  const BOTH = (decision, extra = {}) => ({ decisions: [DEV, DEV2].map((uid) => ({ uid, decision, ...extra })) });

  /**
   * A check as it stood before the SPOC change: sent when no Site named a
   * SPOC, then handed out item by item. It has no holder, so it follows its
   * tickets and keeps every move it had.
   */
  const fileOld = (changes) => {
    const id = file(changes);
    const by = service.trustedActor(tech.username);
    spocOfSite._setLookup(() => null);
    try { service.submit(id, { actor: by }); } finally { spocOfSite._setLookup(null); }
    const rows = service.assignableUids(id).map((uid) => ({ uid, assignee: MEERA.name,
      assigneeEmail: MEERA.email, assigneeUserId: meera.id }));
    service.assignLocal(id, rows, { actor: service.trustedActor(a.admin.username) });
    return id;
  };

  // ================= 1. The doors =================
  const plan = file();
  assert.equal((await post('tech', plan, 'submit')).status, 200, 'a technician sends their own comparison');
  const nope = (r, why) => assert.equal(r.status, 403, `${why}: ${r.status} ${r.raw}`);

  assert.equal((await call(port, tok.tech, 'GET', '/api/approvals/me')).status, 200);
  assert.equal((await call(port, tok.auditor, 'GET', '/api/approvals/queue')).status, 200);
  assert.equal((await call(port, tok.approver, 'GET', '/api/approvals/dashboard')).status, 200);
  assert.equal((await call(port, tok.tech, 'GET', '/api/approvals/plans')).status, 200);

  nope(await post('tech', plan, 'triage', { priority: 'P2' }), 'a technician does not triage');
  nope(await post('manager', plan, 'triage', { priority: 'P3' }), 'a site manager no longer triages');
  for (const who of ['approver', 'auditor', 'manager', 'meera']) {
    nope(await post(who, plan, 'assign', { userId: meera.id, reason: 'x' }), `${who} does not reassign`);
  }
  nope(await post('manager', plan, 'approve'), 'a site manager the check is not with does not approve');
  nope(await post('approver', plan, 'approve'), 'an approver signs second, never in place of the SPOC');
  nope(await post('tech', plan, 'decide', { decisions: [{ uid: DEV, decision: 'approved' }] }),
    'a technician decides nothing');
  nope(await post('manager', plan, 'cancel', { reason: 'x' }), 'a site manager does not cancel a sent check');
  nope(await post('meera', plan, 'cancel', { reason: 'x' }), 'nor does its SPOC');
  nope(await call(port, tok.manager, 'PUT', '/api/approvals/settings/dual_approval_risks',
    { value: ['high'] }), 'a site manager does not change settings');
  const auditComment = await post('auditor', plan, 'comments', { body: 'reading only' });
  assert.equal(auditComment.status, 403, auditComment.raw);
  assert.match(auditComment.json.error, /auditor reads/i);
  // The site manager still reads their Site's checks.
  assert.equal((await call(port, tok.manager, 'GET', `/api/approvals/plans/${plan}`)).status, 200);
  // And still sets change windows: triage went to the admins, this did not, so
  // the Desk reads it from a key of its own and never from `triage`.
  const mgrCan = (await call(port, tok.manager, 'GET', '/api/approvals/me')).json.can;
  assert.deepEqual([mgrCan.triage, mgrCan.assign, mgrCan.manage, mgrCan.verify], [false, false, true, true]);
  assert.equal((await call(port, tok.tech, 'GET', '/api/approvals/me')).json.can.manage, false);
  assert.equal((await call(port, tok.admin, 'GET', '/api/approvals/me')).json.can.manage, true);
  const window = await call(port, tok.manager, 'POST', '/api/approvals/windows', { tenantId: a.siteId,
    startsAt: new Date(Date.now() + 86400000).toISOString(), endsAt: new Date(Date.now() + 90000000).toISOString(),
    note: 'Saturday patching' });
  assert.equal(window.status, 201, window.raw);
  nope(await post('manager', plan, 'triage', { priority: 'P3' }), 'while triage stays refused at the door');
  // The check names its Site, for a SPOC of any role: the Desk's list of Sites is an admin's.
  const held = await call(port, tok.meera, 'GET', `/api/approvals/plans/${plan}`);
  assert.equal(held.status, 200, held.raw);
  assert.equal(held.json.plan.siteName, 'Approvals A Site');
  // The queues a site manager and a technician saw before the SPOC change are still answered.
  const mgrQueue = (await call(port, tok.manager, 'GET', '/api/approvals/queue')).json.sections.map((x) => x.key);
  for (const key of ['triage', 'approval_pending', 'write_failed', 'manual_review', 'sla_breached']) {
    assert.ok(mgrQueue.includes(key), `a site manager's queue still has ${key}`);
  }
  const techQueue = (await call(port, tok.tech, 'GET', '/api/approvals/queue')).json.sections.map((x) => x.key);
  assert.ok(techQueue.includes('verification_pending'));
  // Preferences are the switches themselves. Wrapped inside another key nothing
  // matches, so the answer is a refusal and never a "saved" that saved nothing.
  const wrapped = await call(port, tok.meera, 'PUT', '/api/approvals/notifications/prefs',
    { prefs: { approved: { inapp: true, email: false } } });
  assert.equal(wrapped.status, 400, wrapped.raw);
  assert.equal(wrapped.json.error, 'No preference was sent, so nothing was changed.');
  const flat = await call(port, tok.meera, 'PUT', '/api/approvals/notifications/prefs', { approved: false });
  assert.equal(flat.status, 200, flat.raw);
  assert.equal(flat.json.prefs.events.approved, false);
  const read = await call(port, tok.meera, 'GET', '/api/approvals/notifications/prefs');
  assert.equal(read.json.prefs.events.approved, false);
  assert.equal((await call(port, tok.meera, 'PUT', '/api/approvals/notifications/prefs', { approved: true })).status, 200);
  // Sizing a check up is an organization admin's.
  assert.equal((await post('admin', plan, 'triage', { priority: 'P3' })).status, 200);

  // ================= 2. Another organization's plan is not there =================
  const theirs = file(undefined, b.admin, b);
  const peek = await call(port, tok.admin, 'GET', `/api/approvals/plans/${theirs}`);
  assert.equal(peek.status, 404, `another org's plan: ${peek.raw}`);
  const poke = await post('admin', theirs, 'triage', { priority: 'P1' });
  assert.equal(poke.status, 404, 'and it cannot be triaged either');
  const listed = await call(port, tok.admin, 'GET', '/api/approvals/plans');
  assert.ok(!listed.json.plans.some((p) => p.id === theirs), 'nor listed');

  // ================= 3. The demo path =================
  mails.length = 0;
  const p1 = file();
  const who = await call(port, tok.tech, 'GET', `/api/approvals/plans/${p1}/contacts`);
  assert.equal(who.json.goesTo, 'spoc');
  assert.equal(who.json.spoc.name, meera.username);
  const submitted = await post('tech', p1, 'submit', { note: 'U15 looks wrong to me' });
  assert.equal(submitted.status, 200, submitted.raw);
  assert.equal(submitted.json.plan.status, 'assigned', 'submit hands it straight to the SPOC of the Site');
  assert.equal(submitted.json.plan.submittedNote, 'U15 looks wrong to me');
  assert.equal(submitted.json.plan.submittedById, tech.id);
  assert.equal(submitted.json.already, false);
  assert.equal(submitted.json.holder.userId, meera.id);
  assert.equal(submitted.json.holder.source, 'site');
  assert.equal(submitted.json.needsAdmin, null);
  assert.ok(submitted.json.incident == null || submitted.json.incident.system === 'none');
  await new Promise((r) => setTimeout(r, 50));
  const asked = mails.filter((m) => /^Assigned to you:/.test(m.subject));
  assert.equal(asked.length, 1, `one assignment email: ${JSON.stringify(mails.map((m) => m.subject))}`);
  assert.equal(asked[0].to, MEERA.email, 'sent to the SPOC');
  assert.match(asked[0].text, /SW-12/);
  assert.match(asked[0].text, /What to do:/);

  // The SPOC finds it, opens it, and is offered what is theirs to do.
  const queue = await call(port, tok.meera, 'GET', '/api/approvals/queue');
  assert.equal(queue.json.sections[0].key, 'spoc');
  assert.ok(queue.json.sections[0].plans.some((pl) => pl.id === p1));
  const mineHeld = await call(port, tok.meera, 'GET', '/api/approvals/plans?holder=me');
  assert.ok(mineHeld.json.plans.some((pl) => pl.id === p1 && pl.holder === meera.username));
  assert.equal((await call(port, tok.meera, 'GET', '/api/approvals/me')).json.can.spoc, true);
  const withTickets = await call(port, tok.meera, 'GET', `/api/approvals/plans/${p1}`);
  assert.equal(withTickets.status, 200, 'a member who holds the check opens it');
  assert.equal(withTickets.json.holder.username, meera.username);
  assert.equal(withTickets.json.sender.username, tech.username);
  assert.equal(withTickets.json.siteSpoc.userId, meera.id);
  assert.deepEqual([withTickets.json.can.decide, withTickets.json.can.approve, withTickets.json.can.reassign,
    withTickets.json.can.cancel], [true, true, false, false]);
  assert.equal(withTickets.json.plan.settled, false, 'a plan with an open ticket is not settled');
  assert.equal(withTickets.json.plan.summary.openTickets, 2);
  assert.ok(withTickets.json.tickets.every((x) => x.assigneeUserId === meera.id && x.scope === 'check'));
  const port1 = withTickets.json.items.find((i) => i.uid === PORT1);
  assert.equal(port1.following, true, 'the port follows its switch');
  assert.equal(port1.decision, 'ticketed');
  assert.ok(!withTickets.json.tickets.some((x) => x.itemUid === PORT1),
    'and has no ticket of its own');

  // The sender reads their own check, with every decision refused.
  const asSender = await call(port, tok.tech, 'GET', `/api/approvals/plans/${p1}`);
  assert.deepEqual(asSender.json.can.blocked, { why: 'You sent this check, so somebody else has to decide it.' });
  assert.equal(asSender.json.can.decide, false);

  // The ticket moves still work for the person they went to, and the check
  // stays with its holder whatever they do.
  const sharedResolve = await call(port, tok.meera, 'POST',
    `/api/approvals/plans/${p1}/tickets/${encodeURIComponent(PORT1)}/resolve`, { finding: 'port is fine' });
  assert.equal(sharedResolve.status, 409, sharedResolve.raw);
  assert.match(sharedResolve.json.error, /follows its device/);
  const accepted = await call(port, tok.meera, 'POST',
    `/api/approvals/plans/${p1}/tickets/${encodeURIComponent(DEV)}/accept`, {});
  assert.equal(accepted.status, 200, accepted.raw);
  assert.equal(accepted.json.ticket.status, 'accepted');
  assert.equal(accepted.json.plan.status, 'assigned', 'a check with a holder does not follow its tickets');
  const noFinding = await call(port, tok.meera, 'POST',
    `/api/approvals/plans/${p1}/tickets/${encodeURIComponent(DEV)}/resolve`, {});
  assert.equal(noFinding.status, 409, 'resolving says what was found, or it is not a resolve');
  assert.match(noFinding.json.error, /say what you found/);

  // Nothing is decided yet, so a plan-level approval has nothing to sign.
  const tooEarly = await post('meera', p1, 'approve');
  assert.equal(tooEarly.status, 409, tooEarly.raw);
  assert.equal(tooEarly.json.code, 'guard');
  assert.match(tooEarly.json.why, /still undecided/);

  const whole = await post('meera', p1, 'decide', { decisions: [{ uid: '*', decision: 'approved' }] });
  assert.equal(whole.status, 400, 'each device is decided on its own');
  const decided = await post('meera', p1, 'decide', { decisions: [{ uid: DEV, decision: 'approved' },
    { uid: DEV2, decision: 'rejected', reasonCode: 'wrong_asset', note: 'leave it at 14' }] });
  assert.equal(decided.status, 200, decided.raw);
  assert.equal(decided.json.refused.length, 0, 'the SPOC decides with the ticket still open');
  assert.equal(decided.json.replanned, false);
  const afterDecide = await call(port, tok.meera, 'GET', `/api/approvals/plans/${p1}`);
  assert.equal(afterDecide.json.tickets.find((x) => x.itemUid === DEV2).finding, 'leave it at 14',
    'and the decision is the finding');
  assert.equal(afterDecide.json.plan.summary.openTickets, 0);

  assert.equal((await post('meera', p1, 'approve', { incidentState: 'finished' })).status, 400,
    'an incident state comes from the list');
  const approved = await post('meera', p1, 'approve',
    { comment: 'checked against the photos', incidentState: 'resolved' });
  assert.equal(approved.status, 200, approved.raw);
  assert.equal(approved.json.plan.status, 'approved', 'straight from assigned, by a member who is the SPOC');
  assert.equal(approved.json.final, true);
  assert.equal(approved.json.needsSecond, false, 'one name, unless the organization asks for two');
  assert.equal(approved.json.decision.stage, 'first');
  assert.ok(approved.json.decision.payloadHash, 'the approval signs one specific list');
  assert.ok('write' in approved.json && 'incident' in approved.json, 'the answer has room for the write');

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
  await post('tech', p2, 'submit');
  const bare = await post('meera', p2, 'reject');
  assert.equal(bare.status, 409, bare.raw);
  assert.equal(bare.json.code, 'guard');
  assert.match(bare.json.why, /reason code is needed/);
  const noWords = await post('meera', p2, 'reject', { reasonCode: 'insufficient_evidence' });
  assert.equal(noWords.status, 409, noWords.raw);
  assert.match(noWords.json.why, /comment is needed/);
  assert.equal((await post('meera', p2, 'reject', { reasonCode: 'insufficient_evidence', comment: 'x',
    incidentState: 'gone' })).status, 400);
  nope(await post('tech', p2, 'reject', { reasonCode: 'other', comment: 'x' }), 'the sender rejects nothing');
  const rejected = await post('meera', p2, 'reject', { reasonCode: 'insufficient_evidence',
    comment: 'the photo does not show the label', incidentState: 'cancelled' });
  assert.equal(rejected.status, 200, rejected.raw);
  assert.equal(rejected.json.plan.status, 'rejected');
  assert.equal(rejected.json.decision.decision, 'rejected', 'a held check records who rejected it');
  assert.ok('incident' in rejected.json);
  const thread = await call(port, tok.tech, 'GET', `/api/approvals/plans/${p2}/comments`);
  assert.equal(thread.status, 200, thread.raw);
  assert.ok(thread.json.comments.some((c) => /does not show the label/.test(c.body)),
    'the person who raised it can read why');

  // Rework is the same door with a softer word.
  const p3 = file();
  await post('tech', p3, 'submit');
  const rework = await post('meera', p3, 'rework',
    { reasonCode: 'incorrect_remediation', comment: 'the switch was moved, not replaced' });
  assert.equal(rework.status, 200, rework.raw);
  assert.equal(rework.json.plan.status, 'rework');

  // ================= 5. The sender cannot decide, and only an admin reassigns =================
  // An admin files and sends a check. Admin or not, it is not theirs to decide.
  const p4 = file(undefined, a.admin);
  const sentByAdmin = await post('admin', p4, 'submit');
  assert.equal(sentByAdmin.json.holder.userId, meera.id);
  const ownDecide = await post('admin', p4, 'decide', BOTH('approved'));
  assert.equal(ownDecide.status, 403, ownDecide.raw);
  assert.equal(ownDecide.json.error, 'You sent this check, so somebody else has to decide it.');
  // The SPOC looks at the rack, resolves her own tickets, and may still approve.
  for (const uid of [DEV, DEV2]) {
    const r = await call(port, tok.meera, 'POST',
      `/api/approvals/plans/${p4}/tickets/${encodeURIComponent(uid)}/resolve`, { finding: 'I looked myself' });
    assert.equal(r.status, 200, r.raw);
  }
  assert.equal((await post('meera', p4, 'decide', BOTH('approved'))).json.refused.length, 0);
  const selfApprove = await post('admin', p4, 'approve');
  assert.equal(selfApprove.status, 403, selfApprove.raw);
  assert.equal(selfApprove.json.error, 'You sent this check, so somebody else has to decide it.');
  const byResolver = await post('meera', p4, 'approve');
  assert.equal(byResolver.status, 200, `resolving a ticket bars nobody: ${byResolver.raw}`);

  // Reassigning: an organization admin, by RackTrack user, with a reason.
  const pR = file();
  await post('tech', pR, 'submit');
  const oldForm = await post('admin', pR, 'assign', { items: '*', assignee: MEERA.name });
  assert.equal(oldForm.status, 400, oldForm.raw);
  assert.equal(oldForm.json.error, 'Send { userId, reason }. A check goes to one person as a whole.');
  assert.equal((await post('admin', pR, 'assign', { userId: manager.id })).status, 400, 'a reason is needed');
  const toSender = await post('admin', pR, 'assign', { userId: tech.id, reason: 'x' });
  assert.equal(toSender.status, 400);
  assert.match(toSender.json.error, /sent this check, so it cannot go to them/);
  assert.equal((await post('admin', pR, 'assign', { userId: auditor.id, reason: 'x' })).status, 400);
  assert.equal((await post('admin', pR, 'assign', { userId: b.admin.id, reason: 'x' })).status, 400,
    'nobody from another organization');
  const choices = await call(port, tok.admin, 'GET', `/api/approvals/plans/${pR}/contacts`);
  assert.ok(choices.json.assignable.some((u) => u.id === manager.id));
  assert.ok(!choices.json.assignable.some((u) => [tech.id, auditor.id, b.admin.id].includes(u.id)));
  mails.length = 0;
  const moved = await post('admin', pR, 'assign', { userId: manager.id, reason: 'Meera is on leave' });
  assert.equal(moved.status, 200, moved.raw);
  assert.equal(moved.json.plan.status, 'assigned');
  assert.equal(moved.json.holder.userId, manager.id);
  assert.equal(moved.json.holder.source, 'admin');
  assert.equal(moved.json.previous.userId, meera.id);
  assert.deepEqual(moved.json.applied.map((d) => d.uid), [DEV, DEV2]);
  assert.ok(!('raised' in moved.json) && !('wholeRack' in moved.json), 'the old keys are gone');
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(mails.some((m) => m.to === manager.email && /^Assigned to you:/.test(m.subject)));
  assert.equal((await post('meera', pR, 'decide', BOTH('approved'))).status, 404,
    'the old holder, a member, no longer has any part in it');
  assert.equal((await post('manager', pR, 'decide', BOTH('approved'))).json.applied.length, 2);
  assert.equal((await post('manager', pR, 'approve')).json.plan.status, 'approved',
    'a site manager who holds the check approves it');
  // A NetBox contact is still a way to name somebody, when they have an account.
  const pC = file();
  await post('tech', pC, 'submit');
  const noAccount = await post('admin', pC, 'assign', { assignee: SAM.name, reason: 'x' });
  assert.equal(noAccount.status, 400, noAccount.raw);
  assert.match(noAccount.json.error, /has no RackTrack account/);
  // And only an admin cancels a sent check, with a reason.
  assert.equal((await post('admin', pC, 'cancel')).status, 409);
  const gone = await post('admin', pC, 'cancel', { reason: 'scanned the wrong rack' });
  assert.equal(gone.json.plan.status, 'cancelled');

  // A Site that names nobody: the check waits for an admin, who chooses.
  const bPlan = file(undefined, b.admin, b);
  const parked = await post('bAdmin', bPlan, 'submit');
  assert.equal(parked.json.plan.status, 'triage');
  assert.equal(parked.json.holder, null);
  assert.equal(parked.json.needsAdmin.why, 'no_spoc');
  assert.match(parked.json.needsAdmin.text, /has no SPOC yet\.$/);

  // ================= 6. Two names, when the organization asks for two =================
  assert.equal((await call(port, tok.admin, 'PUT', '/api/approvals/settings/dual_approval_risks',
    { value: ['critical'] })).status, 200);
  const p5 = file();
  await post('tech', p5, 'submit');
  const critical = await post('admin', p5, 'triage', { risk: 'critical' });
  assert.equal(critical.json.plan.risk, 'critical');
  await post('meera', p5, 'decide', BOTH('approved'));
  const first = await post('meera', p5, 'approve', { comment: 'one' });
  assert.equal(first.status, 200, first.raw);
  assert.equal(first.json.needsSecond, true, 'critical asks for two names here');
  assert.equal(first.json.plan.status, 'approval_pending', 'and waits there after the first');
  assert.equal(first.json.write, null);
  const sameAgain = await post('meera', p5, 'approve', { comment: 'me again' });
  assert.equal(sameAgain.status, 409, sameAgain.raw);
  assert.match(sameAgain.json.why, /different person/);
  nope(await post('tech', p5, 'approve'), 'never the sender');
  const second = await post('approver2', p5, 'approve', { comment: 'two' });
  assert.equal(second.status, 200, second.raw);
  assert.equal(second.json.stage, 'second');
  assert.equal(second.json.plan.status, 'approved');
  assert.equal((await call(port, tok.admin, 'PUT', '/api/approvals/settings/dual_approval_risks',
    { value: [] })).status, 200);

  // ================= 7. Rebinds, and what follows one =================
  const REBINDS = [
    { type: 'Device', uid: DEV, name: 'SW-12', action: 'create' },
    { type: 'Device', uid: REBIND, name: 'SW-20', action: 'rebind', netboxId: 7,
      fromUid: `dev:RK-OLD:u20`, diff: { racktrack_uid: { from: 'dev:RK-OLD:u20', to: REBIND } } },
    { type: 'Interface', uid: REBIND_PORT, name: 'Gi1/0/1', action: 'create' },
  ];
  const p6 = file(REBINDS);
  await post('tech', p6, 'submit');
  const detail = await call(port, tok.admin, 'GET', `/api/approvals/plans/${p6}`);
  const child = detail.json.items.find((i) => i.uid === REBIND_PORT);
  assert.equal(child.following, false, 'a created port under a rebind is not waved through with it');
  assert.equal(child.decidable, true, 'it is a question of its own');
  assert.deepEqual(detail.json.tickets.map((x) => x.itemUid).sort(), [DEV, REBIND_PORT].sort(),
    'the check goes to the SPOC with a ticket for the create and the port, and none for the rebind');
  // It is decided as it stands, with nobody having been asked.
  const rebindDecision = await post('meera', p6, 'decide', { decisions: [{ uid: REBIND, decision: 'approved' }] });
  assert.deepEqual(rebindDecision.json.applied, [{ uid: REBIND, decision: 'approved' }]);

  // ================= 7b. A check from before the SPOC change keeps its path =================
  const old = fileOld(REBINDS);
  const oldView = await call(port, tok.admin, 'GET', `/api/approvals/plans/${old}`);
  assert.equal(oldView.json.plan.status, 'assigned');
  assert.equal(oldView.json.holder, null, 'nobody holds it: it follows its tickets');
  assert.equal(oldView.json.plan.needsAdmin, null);
  const by = service.trustedActor(a.admin.username);
  const rebindTicket = service.assignLocal(old, [{ uid: REBIND, assignee: MEERA.name }], { actor: by });
  assert.equal(rebindTicket.applied.length, 0, 'a rebind is never sent to the rack');
  assert.match(rebindTicket.refused[0].why, /nothing to check at the rack/);
  assert.deepEqual(service.decideItems(old, [{ uid: REBIND_PORT, decision: 'approved' }], { actor: by }).refused,
    [{ uid: REBIND_PORT, why: 'assign first' }], 'the old library still waits for somebody to have looked');

  const o1 = fileOld();
  const started = await call(port, tok.meera, 'POST',
    `/api/approvals/plans/${o1}/tickets/${encodeURIComponent(DEV)}/start`, {});
  assert.equal(started.status, 200, started.raw);
  assert.equal(started.json.plan.status, 'assigned', 'the plan shows the least advanced ticket');
  for (const uid of [DEV, DEV2]) {
    const done = await call(port, tok.meera, 'POST',
      `/api/approvals/plans/${o1}/tickets/${encodeURIComponent(uid)}/resolve`,
      { finding: `checked ${uid} at the rack`, disposition: 'remediate' });
    assert.equal(done.status, 200, done.raw);
    assert.equal(done.json.item.decision, 'pending', 'a resolved ticket is not an approval');
  }
  const backWithAdmin = await call(port, tok.admin, 'GET', `/api/approvals/plans/${o1}`);
  assert.equal(backWithAdmin.json.plan.status, 'verification_pending',
    'every ticket back means the plan waits for the verification scan');
  assert.deepEqual(backWithAdmin.json.assignable, [],
    'an item that has come back waits on the admin, not on an assignment');
  // The admin may step past the verification scan, but only with a reason.
  const noReason = await post('admin', o1, 'verify/skip');
  assert.equal(noReason.status, 409, noReason.raw);
  assert.equal(noReason.json.code, 'guard');
  assert.equal(noReason.json.from, 'verification_pending');
  assert.equal(noReason.json.to, 'approval_pending');
  assert.match(noReason.json.why, /needs a reason/);
  const skipped = await post('admin', o1, 'verify/skip',
    { reason: 'the rack is 300 miles away and the finding is photographic' });
  assert.equal(skipped.status, 200, skipped.raw);
  assert.equal(skipped.json.plan.status, 'approval_pending');
  assert.equal(skipped.json.plan.verification.result, 'skipped');
  // Waiting for its approval, it is the approver's to decide and sign, as it was.
  nope(await post('manager', o1, 'decide', BOTH('approved')), 'not a site manager');
  assert.equal((await post('approver', o1, 'decide', BOTH('approved'))).json.refused.length, 0);
  const oldApproved = await post('approver', o1, 'approve');
  assert.equal(oldApproved.status, 200, oldApproved.raw);
  assert.equal(oldApproved.json.plan.status, 'approved');
  assert.match(backWithAdmin.json.tickets.find((x) => x.itemUid === DEV).finding, /checked/);

  // ================= 8. Nothing approved, nothing written =================
  const p7 = file();
  await post('tech', p7, 'submit');
  await post('meera', p7, 'decide', BOTH('rejected', { reasonCode: 'wrong_asset', note: 'no' }));
  await post('meera', p7, 'approve');
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
  assert.equal(approvedRow.actor.username, meera.username, 'with the name against it');
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
  await post('tech', p8, 'submit');
  await post('meera', p8, 'decide', BOTH('approved'));
  await post('meera', p8, 'approve');
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
  assert.deepEqual(st.dual_approval_risks, [], 'one approval writes, until the organization asks for two');
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
