#!/usr/bin/env node
/**
 * Fresh-start seed for the RackTrack organization.
 *
 *   Owner (platform)  →  Organization "RackTrack" (+ Org Admin)  →  Site  →  15 member invites
 *
 * ⚠️  DESTRUCTIVE: wipes all existing users / tenants / orgs / racks / invites and
 *     seeds a clean Owner + the RackTrack org/site + 15 member invite codes.
 *     A timestamped backup of auth.db is written first.
 *
 *   Run:  cd server && node scripts/seed-racktrack.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, '..', 'data', 'auth.db');
if (!fs.existsSync(DB_PATH)) {
  console.error(`auth.db not found at ${DB_PATH} — start the server once first.`);
  process.exit(1);
}

// ── Credentials seeded (change here if you like) ──────────────────────────
const OWNER = { username: 'owner', email: 'racktrackteam@sprintpark.com', password: 'Owner@12345' };
const ORG   = { name: 'RackTrack', slug: 'racktrack' };
const ADMIN = { username: 'racktrack-admin', email: 'admin@racktrack.com', password: 'Admin@12345' };
const SITE  = { name: 'RackTrack DC', slug: 'racktrack-dc' };
const MEMBER_COUNT = 15;
const INVITE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

const db = new Database(DB_PATH);
db.pragma('foreign_keys = OFF');

// 1. Backup
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = `${DB_PATH}.pre-racktrack-${stamp}.bak`;
fs.copyFileSync(DB_PATH, backup);
console.log(`Backed up auth.db → ${path.basename(backup)}`);

// 2. Wipe data (fresh start) — keep the tables, drop the rows.
const wipe = ['rack_group_members', 'rack_groups', 'rack_owners', 'invites',
              'pending_signups', 'password_resets', 'users', 'tenants', 'organizations'];
db.transaction(() => {
  for (const t of wipe) {
    if (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(t)) {
      db.exec(`DELETE FROM ${t}`);
    }
  }
  db.exec(`DELETE FROM sqlite_sequence WHERE name IN ('users','tenants','organizations')`);
})();
console.log('Wiped existing users / tenants / orgs / racks / invites.');

// 3. Seed owner + org + admin + site + 15 member invites
const hash = (pw) => bcrypt.hashSync(pw, 10);
const invites = [];
const seed = db.transaction(() => {
  const owner = db.prepare(
    `INSERT INTO users (email, username, password_hash, email_verified, role)
     VALUES (?, ?, ?, 1, 'owner')`
  ).run(OWNER.email, OWNER.username, hash(OWNER.password));
  const ownerId = owner.lastInsertRowid;

  const org = db.prepare(
    `INSERT INTO organizations (slug, name, created_by) VALUES (?, ?, ?)`
  ).run(ORG.slug, ORG.name, ownerId);
  const orgId = org.lastInsertRowid;

  db.prepare(
    `INSERT INTO users (email, username, password_hash, email_verified, role, organization_id)
     VALUES (?, ?, ?, 1, 'org_admin', ?)`
  ).run(ADMIN.email, ADMIN.username, hash(ADMIN.password), orgId);

  const site = db.prepare(
    `INSERT INTO tenants (slug, name, organization_id) VALUES (?, ?, ?)`
  ).run(SITE.slug, SITE.name, orgId);
  const siteId = site.lastInsertRowid;

  const expiresAt = Date.now() + INVITE_TTL_MS;
  const insInvite = db.prepare(
    `INSERT INTO invites (code, email, role, organization_id, tenant_id, invited_by, expires_at)
     VALUES (?, ?, 'member', ?, ?, ?, ?)`
  );
  for (let i = 1; i <= MEMBER_COUNT; i++) {
    const code = crypto.randomBytes(18).toString('base64url');
    const email = `member${String(i).padStart(2, '0')}@racktrack.test`;
    insInvite.run(code, email, orgId, siteId, ownerId, expiresAt);
    invites.push({ n: i, email, code, path: `/invite/${code}` });
  }
});
seed();

console.log('\n=== Seeded ===');
console.log(`Owner      →  username: ${OWNER.username}   password: ${OWNER.password}   (org field: leave blank)`);
console.log(`Org        →  ${ORG.name}  (slug: ${ORG.slug})`);
console.log(`Org Admin  →  org: ${ORG.name}   username: ${ADMIN.username}   password: ${ADMIN.password}`);
console.log(`Site       →  ${SITE.name}`);
console.log(`\n=== ${MEMBER_COUNT} member invite codes (path = /invite/<code>) ===`);
for (const inv of invites) {
  console.log(`${String(inv.n).padStart(2, '0')}  ${inv.email}  ${inv.path}`);
}
// Machine-readable dump for building the links file.
fs.writeFileSync(
  path.join(__dirname, '..', 'data', 'racktrack-invites.json'),
  JSON.stringify(invites, null, 2)
);
console.log('\nWrote server/data/racktrack-invites.json');
console.log('Done. Restart the server if it was running.');
db.close();
