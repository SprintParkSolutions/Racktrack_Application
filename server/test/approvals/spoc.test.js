/**
 * Who a check goes to.
 *
 * Setup names one SPOC per Site, and a sent check goes straight to them. What
 * matters here is every way that can be wrong: the Site names nobody, the
 * account has gone, it belongs to another organization, it is an auditor, or
 * it is the very person sending the check. Each of those parks the check for
 * an admin with a sentence that says why, so each has its own word.
 *
 * A throwaway database, with the two tables the resolver reads made by hand.
 * The Site's record is estate.js's, so it comes in through the test lookup.
 */
process.env.NODE_ENV = 'test';
process.env.RACKTRACK_SKIP_WORKER_POOL = '1';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, afterEach, before, describe, it } = require('node:test');

let tmp;
let store;
let spoc;

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-spoc-'));
  process.env.RACKTRACK_APPROVALS_DB = path.join(tmp, 'approvals.db');
  store = require('../../lib/approvals/store');
  spoc = require('../../lib/approvals/spoc');
  const db = store.db();
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenants (id INTEGER PRIMARY KEY, name TEXT, slug TEXT,
      organization_id INTEGER, timezone TEXT);
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT, email TEXT,
      role TEXT, tenant_id INTEGER, organization_id INTEGER, active INTEGER NOT NULL DEFAULT 1);
    INSERT INTO tenants (id, name, slug, organization_id) VALUES (32, 'Office-Sprintpark', 'office', 1);
    INSERT INTO tenants (id, name, slug, organization_id) VALUES (33, 'Annex', 'annex', 1);
  `);
  const add = db.prepare(`INSERT INTO users (id, username, email, role, tenant_id, organization_id, active)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  add.run(39, 'dc007.tech', 'tech@dc007.example', 'member', 32, 1, 1);
  add.run(40, 'old.spoc', 'old@dc007.example', 'site_manager', 32, 1, 0);
  add.run(41, 'dc007.spoc', 'spoc@dc007.example', 'site_manager', 32, 1, 1);
  add.run(42, 'dc007.member', 'member@dc007.example', 'member', 32, 1, 1);
  add.run(43, 'dc007.auditor', 'auditor@dc007.example', 'auditor', 32, 1, 1);
  add.run(44, 'Aasritha', 'admin@dc007.example', 'org_admin', 33, 1, 1);
  add.run(45, 'annex.member', 'annex@dc007.example', 'member', 33, 1, 1);
  add.run(50, 'stranger', 'spoc@elsewhere.example', 'site_manager', 90, 2, 1);
});

after(() => {
  try { store._reset(); } catch { /* already closed */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});
afterEach(() => spoc._setLookup(null));

const plan = (over = {}) => ({ id: 140, orgId: 1, tenantId: 32, status: 'draft', ...over });
const TECH = { id: 39, username: 'dc007.tech' };
const named = (row) => spoc._setLookup((tenantId) => (Number(tenantId) === 32 ? row : null));

describe('the SPOC of the site', () => {
  it('is the account setup named by user id, whatever its role', () => {
    named({ user_id: 41, email: 'spoc@dc007.example', username: 'dc007.spoc' });
    const out = spoc.resolve(plan(), { sender: TECH });
    assert.deepEqual(out, { ok: true, site: { id: 32, name: 'Office-Sprintpark' },
      holder: { userId: 41, username: 'dc007.spoc', email: 'spoc@dc007.example',
                role: 'site_manager', tenantId: 32 } });
    named({ user_id: 42 });
    assert.equal(spoc.resolve(plan(), { sender: TECH }).holder.role, 'member', 'a member may be the SPOC');
  });

  it('is found by email when setup stored only an email, inside this organization', () => {
    named({ user_id: null, email: 'SPOC@dc007.example', username: null });
    assert.equal(spoc.resolve(plan(), { sender: TECH }).holder.userId, 41);
    // The same address in another organization is not this Site's SPOC.
    named({ user_id: null, email: 'spoc@elsewhere.example', username: null });
    const out = spoc.resolve(plan(), { sender: TECH });
    assert.equal(out.ok, false);
    assert.equal(out.why, 'spoc_invalid');
  });

  it('writes nothing and leaves the plan as it was handed over', () => {
    named({ user_id: 41 });
    const p = Object.freeze(plan());
    assert.doesNotThrow(() => spoc.resolve(p, { sender: TECH }));
    assert.equal(store.db().prepare('SELECT COUNT(*) AS n FROM approval_plans').get().n, 0);
  });
});

describe('every way there is nobody to give it to', () => {
  it('no site', () => {
    const out = spoc.resolve(plan({ tenantId: null }), { sender: TECH });
    assert.equal(out.why, 'no_site');
    assert.equal(out.text, 'This check is not tied to a site, so it has no SPOC.');
  });

  it('a site that names nobody, and a throwaway database that has no estate to ask', () => {
    assert.equal(spoc.resolve(plan(), { sender: TECH }).why, 'no_spoc', 'no lookup, so no SPOC');
    named(null);
    const out = spoc.resolve(plan(), { sender: TECH });
    assert.equal(out.why, 'no_spoc');
    assert.equal(out.text, 'Office-Sprintpark has no SPOC yet.');
    assert.deepEqual(out.site, { id: 32, name: 'Office-Sprintpark' });
    assert.equal(spoc.resolve(plan({ tenantId: 77 }), { sender: TECH }).text, 'Site 77 has no SPOC yet.',
      'a Site with no name on record is still named somehow');
  });

  it('a lookup that throws is no SPOC, never an error', () => {
    spoc._setLookup(() => { throw new Error('no such table: tenants'); });
    assert.equal(spoc.resolve(plan(), { sender: TECH }).why, 'no_spoc');
  });

  it('an account that is gone, switched off, in another organization, or an auditor', () => {
    const SENTENCE = 'The SPOC of Office-Sprintpark is no longer an active account.';
    for (const [row, what] of [[{ user_id: 999 }, 'no such account'], [{ user_id: 40 }, 'inactive'],
      [{ user_id: 50 }, 'another organization'], [{ user_id: 43 }, 'an auditor writes nothing']]) {
      named(row);
      const out = spoc.resolve(plan(), { sender: TECH });
      assert.equal(out.why, 'spoc_invalid', what);
      assert.equal(out.text, SENTENCE);
    }
  });

  it('the person sending it, by id and else by username', () => {
    named({ user_id: 39 });
    const out = spoc.resolve(plan(), { sender: TECH });
    assert.equal(out.why, 'spoc_is_sender');
    assert.equal(out.text, 'dc007.tech is the SPOC of Office-Sprintpark and also sent this check, '
      + 'so somebody else has to decide it.');
    // An older phone build sends a name and no id.
    assert.equal(spoc.resolve(plan(), { sender: { id: null, username: 'DC007.tech' } }).why, 'spoc_is_sender');
    // Once stamped, the plan's own sender is what counts, not whoever asks.
    assert.equal(spoc.resolve(plan({ submittedById: 39, submittedBy: 'dc007.tech' }),
      { sender: { id: 44, username: 'Aasritha' } }).why, 'spoc_is_sender');
    assert.equal(spoc.resolve(plan({ submittedById: 42, submittedBy: 'dc007.member' }),
      { sender: TECH }).ok, true);
  });
});

describe('what a screen is shown, and who an admin may choose', () => {
  it('shows the SPOC setup named, valid or not', () => {
    named({ user_id: 41 });
    assert.deepEqual(spoc.ofSite(plan()), { userId: 41, username: 'dc007.spoc', email: 'spoc@dc007.example',
      siteId: 32, siteLabel: 'Site 32', siteName: 'Office-Sprintpark', valid: true });
    named({ user_id: 40 });
    assert.equal(spoc.ofSite(plan()).valid, false);
    named(null);
    assert.equal(spoc.ofSite(plan()), null);
    assert.equal(spoc.ofSite(plan({ tenantId: null })), null);
  });

  it('offers the admins and the people on the check\'s own site, never an auditor or the sender', () => {
    const sent = plan({ status: 'triage', submittedById: 39, submittedBy: 'dc007.tech' });
    assert.deepEqual(spoc.assignableUsers(sent).map((u) => u.username).sort(),
      ['Aasritha', 'dc007.member', 'dc007.spoc']);
    const one = spoc.assignableUsers(sent).find((u) => u.id === 41);
    assert.deepEqual(one, { id: 41, username: 'dc007.spoc', email: 'spoc@dc007.example',
      role: 'site_manager', tenantId: 32, tenantName: 'Office-Sprintpark' });
    // An admin who sent it cannot be given it either.
    assert.ok(!spoc.assignableUsers(plan({ submittedById: 44 })).some((u) => u.id === 44));
    assert.deepEqual(spoc.assignableUsers(plan({ orgId: null })), []);
  });
});
