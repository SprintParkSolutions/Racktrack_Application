/**
 * Rack imagery must not be readable by anyone who merely knows a rack id.
 *
 * Restricting /outputs and /uploads to image extensions closed the JSON and
 * report-file leak but left the photographs open, which made a rack id a
 * permanent, non-revocable bearer credential — and rack ids travel through SPA
 * URLs, report payloads, browser history and proxy logs. A recipient of an
 * expired share link, or a departed employee, kept access forever.
 *
 * These tests pin the three legitimate ways in and the ways that must fail.
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const jwt = require('jsonwebtoken');

after(() => { setImmediate(() => process.exit(0)); });

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.PORT = process.env.PORT || '0';
process.env.JWT_SECRET = 'test-secret-for-asset-access';
process.env.RACKTRACK_SKIP_WORKER_POOL = '1';

const { app } = require('../app');
const SECRET = process.env.JWT_SECRET;

const RACK = 'RK-ASSET001';
const outputsDir = path.join(__dirname, '..', '..', 'outputs');
const rackDir = path.join(outputsDir, RACK);
const imageName = 'original_image.jpg';

test('setup: a rack directory with an image', () => {
  fs.mkdirSync(rackDir, { recursive: true });
  fs.writeFileSync(path.join(rackDir, imageName), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  fs.writeFileSync(path.join(rackDir, 'device_unit_map.json'), '{"devices":[]}');
});

after(() => { try { fs.rmSync(rackDir, { recursive: true, force: true }); } catch { /* best effort */ } });

function listen() {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function get(port, p, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: p, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
  });
}

const url = `/outputs/${RACK}/${imageName}`;

test('an anonymous request with only the rack id is refused', async (t) => {
  const { server, port } = await listen();
  t.after(() => new Promise((r) => server.close(r)));

  // This is the whole finding: knowing RK-ASSET001 used to be enough.
  assert.equal(await get(port, url), 404);
});

test('a report token opens exactly its own rack and nothing else', async (t) => {
  const { server, port } = await listen();
  t.after(() => new Promise((r) => server.close(r)));

  const good = jwt.sign({ scope: 'report', rackId: RACK }, SECRET, { expiresIn: 300 });
  const other = jwt.sign({ scope: 'report', rackId: 'RK-SOMEONEELSE' }, SECRET, { expiresIn: 300 });
  const expired = jwt.sign({ scope: 'report', rackId: RACK }, SECRET, { expiresIn: -10 });

  assert.equal(await get(port, `${url}?t=${good}`), 200);
  assert.equal(await get(port, `${url}?t=${other}`), 404, 'a token for another rack must not open this one');
  assert.equal(await get(port, `${url}?t=${expired}`), 404, 'an expired share link must stop working');
});

test('an asset token is honoured, but only for racks its holder may see', async (t) => {
  const { server, port } = await listen();
  t.after(() => new Promise((r) => server.close(r)));

  // The owner sees everything, so this proves the happy path without needing a
  // rack_owners row for the fixture rack.
  const owner = jwt.sign({ scope: 'asset', role: 'owner', tenantId: 2 }, SECRET, { expiresIn: 3600 });
  assert.equal(await get(port, `${url}?t=${owner}`), 200);

  // A member of an unrelated Site holds a perfectly valid token and still gets
  // nothing: the token carries identity, not authority over every rack.
  const stranger = jwt.sign({ scope: 'asset', role: 'member', tenantId: 9999 }, SECRET, { expiresIn: 3600 });
  assert.equal(await get(port, `${url}?t=${stranger}`), 404);
});

test('token scopes are not interchangeable', async (t) => {
  const { server, port } = await listen();
  t.after(() => new Promise((r) => server.close(r)));

  // A session JWT in the query string must not act as an asset capability —
  // otherwise a token leaked via a URL would be a full session.
  const session = jwt.sign({ role: 'owner', tenantId: 2 }, SECRET, { expiresIn: 3600 });
  assert.equal(await get(port, `${url}?t=${session}`), 404);

  // And an asset token must not be usable where a report token is required.
  const asset = jwt.sign({ scope: 'asset', role: 'owner', tenantId: 2 }, SECRET, { expiresIn: 3600 });
  assert.equal(await get(port, `/api/scan/${RACK}/report?t=${asset}`), 401);
});

test('a Bearer header still works, for non-image fetches of the same paths', async (t) => {
  const { server, port } = await listen();
  t.after(() => new Promise((r) => server.close(r)));

  const session = jwt.sign({ role: 'owner', tenantId: 2 }, SECRET, { expiresIn: 3600 });
  assert.equal(await get(port, url, { Authorization: `Bearer ${session}` }), 200);
});

test('non-image files stay unreachable regardless of credentials', async (t) => {
  const { server, port } = await listen();
  t.after(() => new Promise((r) => server.close(r)));

  // The earlier hardening that stopped serving scan JSON, topology, OCR output
  // and SSH transcripts must not have been loosened by adding the auth layer.
  const owner = jwt.sign({ scope: 'asset', role: 'owner', tenantId: 2 }, SECRET, { expiresIn: 3600 });
  assert.equal(await get(port, `/outputs/${RACK}/device_unit_map.json?t=${owner}`), 404);
});
