/**
 * A scan names its Site - /api/analyze, /api/stitch and /api/analyze-video
 * with the `siteId` the scan screen sends.
 *
 * Two layers. lib/scan_site.resolve is asked directly for every role, because
 * that is where the rule lives. Then the real app is driven end to end through
 * the fake pipeline (the harness of scan_path.test.js), because the rule is
 * worth nothing unless the handlers use what it answers: the claim, the scan
 * meta and the scope the rack id is minted under.
 *
 * What is held here:
 *   1. a technician may name their own Site and no other - another Site of
 *      their own organization is 404 like a Site of somebody else's;
 *   2. an organization admin may name any Site of the organization, and the
 *      scan is then that Site's: claimed for it, stamped with it;
 *   3. an owner with no organization, scanning at a Site, mints the rack id a
 *      technician of that Site mints for the same photo;
 *   4. a refusal happens before any work, on all three routes;
 *   5. with no `siteId` nothing changes: a technician's scan is their Site's,
 *      an admin's lands on the default tenant, and an account with no Site is
 *      still refused a walk-through video.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

after(() => { setImmediate(() => process.exit(0)); });

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.PORT = process.env.PORT || '0';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-scan-site-binding';
process.env.RATE_LIMIT_UPLOADS_PER_MIN = '500';
process.env.RACKTRACK_POOL_MODULE = path.join(__dirname, 'fixtures', 'fake_pool.js');
process.env.FAKE_POOL_MODE = 'ok';
delete process.env.RACKTRACK_SKIP_WORKER_POOL;

const { app } = require('../app');
const auth = require('../auth');
const scanSite = require('../lib/scan_site');
const Database = require('better-sqlite3');

const OUTPUTS = path.join(__dirname, '..', '..', 'outputs');
const TAG = `ssb_${process.pid}_${Date.now()}`;

// One organization with two Sites, a Site of another organization, and the
// four people who matter: a technician on the first Site, an admin of the
// organization with no Site of their own, an owner with no organization, and a
// technician of the other organization.
const db = new Database(path.join(__dirname, '..', 'data', 'auth.db'));
const made = { orgs: [], tenants: [], users: [] };
let ORG, OTHER_ORG, SITE_1, SITE_2, SITE_OTHER, DEFAULT_SITE;
let tech, admin, owner, stranger;

function makeUser(name, role, tenantId, orgId) {
  const username = `${TAG}_${name}`;
  const id = db.prepare(`
    INSERT INTO users (email, username, password_hash, email_verified, role, tenant_id, organization_id, active)
    VALUES (?, ?, 'x', 1, ?, ?, ?, 1)`)
    .run(`${username}@example.test`, username, role, tenantId, orgId).lastInsertRowid;
  made.users.push(id);
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return { row, token: auth.makeToken(row), payload: { sub: row.id, role, tenantId, organizationId: orgId } };
}

before(() => {
  const org = db.prepare("INSERT INTO organizations (slug, name, status) VALUES (?, ?, 'active')");
  ORG = org.run(`${TAG}-a`, `${TAG} A`).lastInsertRowid; made.orgs.push(ORG);
  OTHER_ORG = org.run(`${TAG}-b`, `${TAG} B`).lastInsertRowid; made.orgs.push(OTHER_ORG);
  const site = db.prepare('INSERT INTO tenants (slug, name, organization_id) VALUES (?, ?, ?)');
  SITE_1 = site.run(`${TAG}-s1`, `${TAG} One`, ORG).lastInsertRowid;
  SITE_2 = site.run(`${TAG}-s2`, `${TAG} Two`, ORG).lastInsertRowid;
  SITE_OTHER = site.run(`${TAG}-s3`, `${TAG} Other`, OTHER_ORG).lastInsertRowid;
  made.tenants.push(SITE_1, SITE_2, SITE_OTHER);
  DEFAULT_SITE = auth.getDefaultTenantId();

  tech = makeUser('tech', 'member', SITE_1, ORG);
  admin = makeUser('admin', 'org_admin', null, ORG);
  owner = makeUser('owner', 'owner', null, null);
  stranger = makeUser('stranger', 'member', SITE_OTHER, OTHER_ORG);
});

const createdRacks = new Set();
const tmpFiles = [];
after(() => {
  for (const f of tmpFiles) { try { fs.rmSync(f, { force: true }); } catch { /* best effort */ } }
  for (const id of createdRacks) {
    try { fs.rmSync(path.join(OUTPUTS, id), { recursive: true, force: true }); } catch { /* best effort */ }
  }
  try {
    // Children first: a scan writes rack_owners rows that point at the user
    // and the Site, and deleting either before them fails the foreign key.
    const inList = (ids) => ids.map(() => '?').join(',');
    db.prepare(`DELETE FROM rack_owners WHERE created_by IN (${inList(made.users)})`).run(...made.users);
    db.prepare(`DELETE FROM rack_user_claims WHERE user_id IN (${inList(made.users)})`).run(...made.users);
    // The audit trail keeps its rows and lets go of the Site, as removing an
    // organization does.
    db.prepare(`UPDATE audit_log SET tenant_id = NULL WHERE tenant_id IN (${inList(made.tenants)})`).run(...made.tenants);
    for (const table of ['racks_known', 'spaces', 'tenant_rules']) {
      try { db.prepare(`DELETE FROM ${table} WHERE tenant_id IN (${inList(made.tenants)})`).run(...made.tenants); }
      catch { /* a table estate has not made yet */ }
    }
    db.prepare(`DELETE FROM users WHERE id IN (${inList(made.users)})`).run(...made.users);
    db.prepare(`DELETE FROM tenants WHERE id IN (${inList(made.tenants)})`).run(...made.tenants);
    db.prepare(`DELETE FROM organizations WHERE id IN (${inList(made.orgs)})`).run(...made.orgs);
    db.close();
  } catch (err) {
    console.error(`[scan_site_binding] fixtures not cleaned up: ${err.message}`);
  }
});

function listen() {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/** A multipart POST with text fields and files - no test-only HTTP dependency. */
function postForm(port, urlPath, { token, fields = {}, files = [] }) {
  const boundary = '----racktracksite' + Date.now();
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  for (const f of files) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${f.field}"; `
      + `filename="${path.basename(f.path)}"\r\nContent-Type: ${f.type || 'image/jpeg'}\r\n\r\n`));
    parts.push(fs.readFileSync(f.path));
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  const body = Buffer.concat(parts);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path: urlPath, method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(out); } catch { /* non-JSON body */ }
        resolve({ status: res.statusCode, body: out, json });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

/** A real JPEG nobody has scanned before, so every test starts from a cold rack. */
let shade = 0;
async function freshImage() {
  shade += 1;
  const file = path.join(os.tmpdir(), `${TAG}-${shade}.jpg`);
  await require('sharp')({
    create: { width: 640, height: 480, channels: 3,
      background: { r: (process.pid % 200) + 20, g: shade * 9, b: Date.now() % 255 } },
  }).jpeg().toFile(file);
  tmpFiles.push(file);
  return file;
}

const scan = (port, who, image, siteId) => postForm(port, '/api/analyze', {
  token: who.token,
  fields: siteId === undefined ? {} : { siteId: String(siteId) },
  files: [{ field: 'image', path: image }],
});
function rackOf(res) {
  const id = res.json?.scanId ?? res.json?.rackId;
  if (id) createdRacks.add(id);
  return id;
}
const claimed = (siteId, rackId) => Boolean(db.prepare(
  'SELECT 1 FROM rack_owners WHERE tenant_id = ? AND rack_id = ?').get(siteId, rackId));
const metaOf = (rackId) => JSON.parse(fs.readFileSync(path.join(OUTPUTS, rackId, 'scan_meta.json'), 'utf8'));

// ── The rule ────────────────────────────────────────────────────────
test('resolve: no siteId is the payload untouched, and the tenant app.js would have used', () => {
  const ownTenantOf = (a) => a?.tenantId || 999;
  for (const raw of [undefined, null, '', '   ']) {
    const out = scanSite.resolve(admin.payload, raw, ownTenantOf);
    assert.equal(out.ok, true);
    assert.equal(out.chosen, false);
    assert.equal(out.auth, admin.payload, 'the very same object, so nothing downstream can differ');
    assert.equal(out.tenantId, 999);
  }
  assert.equal(scanSite.resolve(tech.payload, undefined, ownTenantOf).tenantId, SITE_1);
  assert.equal(scanSite.resolve(null, undefined).auth, null, 'an anonymous stitch stays anonymous');
});

test('resolve: a technician may name their own Site and no other', () => {
  const own = scanSite.resolve(tech.payload, String(SITE_1));
  assert.equal(own.ok, true);
  assert.equal(own.chosen, true);
  assert.equal(own.tenantId, SITE_1);
  assert.equal(own.auth.tenantId, SITE_1);
  assert.equal(own.auth.organizationId, ORG);
  assert.equal(own.auth.sub, tech.row.id);

  for (const foreign of [SITE_2, SITE_OTHER, 99999999, 'abc', '-1', '0', '1.5', `${SITE_1} OR 1=1`]) {
    assert.deepEqual(scanSite.resolve(tech.payload, foreign),
      { ok: false, status: 404, error: 'Site not found' }, `siteId ${foreign}`);
  }
  assert.equal(scanSite.resolve(null, String(SITE_1)).ok, false, 'nobody signed in names no Site');
});

test('resolve: an organization admin may name any Site of the organization, and none outside it', () => {
  for (const id of [SITE_1, SITE_2]) {
    const out = scanSite.resolve(admin.payload, id);
    assert.equal(out.ok, true);
    assert.equal(out.auth.tenantId, id);
    assert.equal(out.auth.organizationId, ORG);
  }
  assert.equal(scanSite.resolve(admin.payload, SITE_OTHER).status, 404);
  assert.equal(admin.payload.tenantId, null, 'the caller\'s own payload is never edited');
});

test('resolve: the owner scanning at a Site carries that Site\'s organization, as its technician does', () => {
  const out = scanSite.resolve(owner.payload, SITE_1);
  assert.equal(out.ok, true);
  assert.equal(out.auth.tenantId, SITE_1);
  assert.equal(out.auth.organizationId, ORG);
  assert.equal(out.auth.role, 'owner');
});

// ── The handlers ────────────────────────────────────────────────────
test('a technician scanning at their own Site: the scan is that Site\'s', async (t) => {
  const { server, port } = await listen();
  t.after(() => new Promise((r) => server.close(r)));

  const res = await scan(port, tech, await freshImage(), SITE_1);
  assert.equal(res.status, 200, res.body.slice(0, 300));
  const rackId = rackOf(res);
  assert.match(rackId || '', /^RK-/);
  assert.ok(claimed(SITE_1, rackId));
  assert.equal(metaOf(rackId).tenantId, SITE_1);
});

test('a Site the caller may not read is 404 before any work, on all three routes', async (t) => {
  const { server, port } = await listen();
  t.after(() => new Promise((r) => server.close(r)));
  const image = await freshImage();
  const before = db.prepare('SELECT COUNT(*) AS n FROM rack_owners WHERE created_by = ?').get(tech.row.id).n;

  for (const foreign of [SITE_2, SITE_OTHER, 'abc']) {
    const res = await scan(port, tech, image, foreign);
    assert.equal(res.status, 404, `siteId ${foreign} -> ${res.status}`);
    assert.deepEqual(res.json, { error: 'Site not found' });
  }
  const stitched = await postForm(port, '/api/stitch', {
    token: tech.token, fields: { siteId: String(SITE_OTHER) },
    files: [{ field: 'images', path: image }, { field: 'images', path: await freshImage() }],
  });
  assert.equal(stitched.status, 404);
  assert.deepEqual(stitched.json, { error: 'Site not found' });

  const video = await postForm(port, '/api/analyze-video', {
    token: tech.token, fields: { siteId: String(SITE_OTHER) },
    files: [{ field: 'video', path: image, type: 'video/mp4' }],
  });
  assert.equal(video.status, 404);
  assert.deepEqual(video.json, { error: 'Site not found' });

  const afterwards = db.prepare('SELECT COUNT(*) AS n FROM rack_owners WHERE created_by = ?').get(tech.row.id).n;
  assert.equal(afterwards, before, 'a refused scan claims nothing');
});

test('an admin scanning at a Site mints the technician\'s rack id, and the scan is that Site\'s', async (t) => {
  const { server, port } = await listen();
  t.after(() => new Promise((r) => server.close(r)));
  const image = await freshImage();

  const byAdmin = await scan(port, admin, image, SITE_1);
  assert.equal(byAdmin.status, 200, byAdmin.body.slice(0, 300));
  const rackId = rackOf(byAdmin);
  assert.ok(claimed(SITE_1, rackId), 'claimed for the Site that was chosen');
  assert.ok(!claimed(DEFAULT_SITE, rackId), 'and not for the default tenant');
  assert.equal(metaOf(rackId).tenantId, SITE_1);

  const byTech = await scan(port, tech, image, SITE_1);
  assert.equal(rackOf(byTech), rackId);

  // The owner belongs to no organization, and the rack id is scoped by
  // organization first: without the Site's organization this would be another id.
  const byOwner = await scan(port, owner, image, SITE_1);
  assert.equal(byOwner.status, 200, byOwner.body.slice(0, 300));
  assert.equal(rackOf(byOwner), rackId);

  // The other organization's technician, same photo, is a different rack.
  const elsewhere = await scan(port, stranger, image, SITE_OTHER);
  assert.equal(elsewhere.status, 200);
  assert.notEqual(rackOf(elsewhere), rackId);
});

test('a rack scanned before anybody chose a Site becomes the chosen Site\'s on the next scan', async (t) => {
  const { server, port } = await listen();
  t.after(() => new Promise((r) => server.close(r)));
  const image = await freshImage();

  // Today's behaviour, held: no siteId, so the admin's scan lands on the
  // default tenant and its meta carries no Site.
  const first = await scan(port, admin, image);
  assert.equal(first.status, 200, first.body.slice(0, 300));
  const rackId = rackOf(first);
  assert.ok(claimed(DEFAULT_SITE, rackId));
  assert.ok(!claimed(SITE_2, rackId));
  assert.equal(metaOf(rackId).tenantId ?? null, null);

  // The same photo with a Site named is a cache hit, and still that Site's.
  const second = await scan(port, admin, image, SITE_2);
  assert.equal(second.status, 200);
  assert.equal(rackOf(second), rackId);
  assert.ok(claimed(SITE_2, rackId));
  assert.equal(metaOf(rackId).tenantId, SITE_2);
});

test('no siteId: a technician\'s scan is their own Site\'s, exactly as before', async (t) => {
  const { server, port } = await listen();
  t.after(() => new Promise((r) => server.close(r)));
  const image = await freshImage();

  const plain = await scan(port, tech, image);
  assert.equal(plain.status, 200, plain.body.slice(0, 300));
  const rackId = rackOf(plain);
  assert.ok(claimed(SITE_1, rackId));
  assert.equal(metaOf(rackId).tenantId, SITE_1);
  // And naming the Site they already sit in changes nothing about the id.
  assert.equal(rackOf(await scan(port, tech, image, SITE_1)), rackId);
});

test('a walk-through video: no Site of your own is still refused, a chosen Site lets an admin in', async (t) => {
  const { server, port } = await listen();
  t.after(() => new Promise((r) => server.close(r)));
  const clip = await freshImage();
  const send = (fields) => postForm(port, '/api/analyze-video', {
    token: admin.token, fields, files: [{ field: 'video', path: clip, type: 'video/mp4' }],
  });

  const without = await send({});
  assert.equal(without.status, 401, 'today\'s answer for an account with no Site');

  // Past the Site gate the fake pipeline finds no racks in the clip, which is
  // the answer that proves the gate was passed.
  const withSite = await send({ siteId: String(SITE_2) });
  assert.equal(withSite.status, 400, withSite.body.slice(0, 300));
  assert.match(withSite.json.error, /No racks detected/);
});
