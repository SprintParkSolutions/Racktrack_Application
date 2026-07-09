#!/usr/bin/env node
/**
 * Fresh-start seed for the Organization → Site → Users model.
 *
 *   Owner (platform)  →  Organization (+ Org Admin)  →  Site  →  Members
 *
 * ⚠️  DESTRUCTIVE: wipes all existing users / tenants / racks / invites and
 *     seeds a clean Owner account + one demo Organization/Site. A timestamped
 *     backup of auth.db is written first.
 *
 *   Run:  cd server && node scripts/seed-orgs.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, '..', 'data', 'auth.db');
if (!fs.existsSync(DB_PATH)) {
  console.error(`auth.db not found at ${DB_PATH} — start the server once first.`);
  process.exit(1);
}

// ── Credentials seeded (change here if you like) ──────────────────────────
const OWNER = { username: 'owner', email: 'racktrackteam@sprintpark.com', password: 'Owner@12345' };
const ORG   = { name: 'Sprintpark', slug: 'sprintpark' };
const ADMIN = { username: 'sprintpark-admin', email: 'admin@sprintpark.com', password: 'Admin@12345' };
const SITE  = { name: 'HQ Datacenter', slug: 'hq-datacenter' };

const db = new Database(DB_PATH);
db.pragma('foreign_keys = OFF');

// 1. Backup
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = `${DB_PATH}.pre-org-${stamp}.bak`;
fs.copyFileSync(DB_PATH, backup);
console.log(`Backed up auth.db → ${path.basename(backup)}`);

// 2. Ensure the org schema exists (idempotent — in case the server hasn't
//    restarted with the new migration yet).
db.exec(`
  CREATE TABLE IF NOT EXISTS organizations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL, created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));
`);
const addCol = (t, c, ddl) => {
  const has = db.prepare(`PRAGMA table_info(${t})`).all().some(x => x.name === c);
  if (!has) db.exec(`ALTER TABLE ${t} ADD COLUMN ${ddl}`);
};
addCol('tenants', 'organization_id', 'organization_id INTEGER');
addCol('users', 'role', "role TEXT NOT NULL DEFAULT 'member'");
addCol('users', 'organization_id', 'organization_id INTEGER');

// 3. Wipe data (fresh start) — keep the tables, drop the rows.
const wipe = ['rack_group_members', 'rack_groups', 'rack_owners', 'invites',
              'pending_signups', 'password_resets', 'users', 'tenants', 'organizations'];
db.transaction(() => {
  for (const t of wipe) {
    if (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(t)) {
      db.exec(`DELETE FROM ${t}`);
    }
  }
  // reset autoincrement counters
  db.exec(`DELETE FROM sqlite_sequence WHERE name IN ('users','tenants','organizations')`);
})();
console.log('Wiped existing users / tenants / racks / invites.');

// 4. Seed
const hash = (pw) => bcrypt.hashSync(pw, 10);
const seed = db.transaction(() => {
  // Owner — platform-level, no org/site. Logs in with just username+password.
  const owner = db.prepare(
    `INSERT INTO users (email, username, password_hash, email_verified, role)
     VALUES (?, ?, ?, 1, 'owner')`
  ).run(OWNER.email, OWNER.username, hash(OWNER.password));

  // Demo Organization (created by the owner).
  const org = db.prepare(
    `INSERT INTO organizations (slug, name, created_by) VALUES (?, ?, ?)`
  ).run(ORG.slug, ORG.name, owner.lastInsertRowid);
  const orgId = org.lastInsertRowid;

  // Org Admin — belongs to the org, no specific site.
  db.prepare(
    `INSERT INTO users (email, username, password_hash, email_verified, role, organization_id)
     VALUES (?, ?, ?, 1, 'org_admin', ?)`
  ).run(ADMIN.email, ADMIN.username, hash(ADMIN.password), orgId);

  // A Site (a tenant row) under the org.
  db.prepare(
    `INSERT INTO tenants (slug, name, organization_id) VALUES (?, ?, ?)`
  ).run(SITE.slug, SITE.name, orgId);
});
seed();

console.log('\n=== Seeded ===');
console.log(`Owner      →  username: ${OWNER.username}   password: ${OWNER.password}   (org field: leave blank)`);
console.log(`Org        →  ${ORG.name}`);
console.log(`Org Admin  →  org: ${ORG.name}   username: ${ADMIN.username}   password: ${ADMIN.password}`);
console.log(`Site       →  ${SITE.name}`);
console.log('\nDone. Restart the server if it was running.');
db.close();
