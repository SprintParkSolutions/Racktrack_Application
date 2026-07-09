#!/usr/bin/env node
/**
 * Remove an organization COMPLETELY — its users, sites (tenants), invites, and
 * the org row itself — plus clean up references (rack ownership, audit rows).
 *
 * ⚠️ DESTRUCTIVE. Backs up auth.db first. Refuses to touch the 'racktrack' org.
 *
 *   Run:  cd server && node scripts/remove-org.js <slug-or-name> [<slug-or-name> ...]
 *     e.g. node scripts/remove-org.js sprintpark-1de4
 */
'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const args = process.argv.slice(2);
if (!args.length) { console.error('Usage: node scripts/remove-org.js <slug-or-name> ...'); process.exit(1); }

const DB_PATH = path.join(__dirname, '..', 'data', 'auth.db');
const db = new Database(DB_PATH);
db.pragma('foreign_keys = OFF');

// Backup
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = `${DB_PATH}.pre-remove-org-${stamp}.bak`;
fs.copyFileSync(DB_PATH, backup);
console.log(`Backed up auth.db → ${path.basename(backup)}`);

const PROTECTED = new Set(['racktrack']); // never delete the live org

const remove = db.transaction((ident) => {
  const org = db.prepare(
    `SELECT id, name, slug FROM organizations WHERE slug = ? COLLATE NOCASE OR name = ? COLLATE NOCASE`
  ).get(ident, ident);
  if (!org) { console.log(`  · '${ident}': no such org — skipped`); return; }
  if (PROTECTED.has(String(org.slug).toLowerCase())) {
    console.log(`  · '${ident}' is protected (${org.slug}) — refused`); return;
  }
  const orgId = org.id;
  const tenantIds = db.prepare(`SELECT id FROM tenants WHERE organization_id = ?`).all(orgId).map(r => r.id);
  const userIds   = db.prepare(`SELECT id FROM users WHERE organization_id = ?`).all(orgId).map(r => r.id);

  // Clean up references that point at the rows we're about to delete.
  for (const tid of tenantIds) {
    if (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='rack_owners'`).get())
      db.prepare(`DELETE FROM rack_owners WHERE tenant_id = ?`).run(tid);
    if (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='rack_groups'`).get())
      db.prepare(`DELETE FROM rack_groups WHERE tenant_id = ?`).run(tid);
    try { db.prepare(`UPDATE audit_log SET tenant_id = NULL WHERE tenant_id = ?`).run(tid); } catch (_) {}
  }
  for (const uid of userIds) {
    try { db.prepare(`UPDATE rack_owners SET created_by = NULL WHERE created_by = ?`).run(uid); } catch (_) {}
    try { db.prepare(`UPDATE invites SET invited_by = NULL WHERE invited_by = ?`).run(uid); } catch (_) {}
  }

  const inv = db.prepare(`DELETE FROM invites WHERE organization_id = ?`).run(orgId).changes;
  const usr = db.prepare(`DELETE FROM users WHERE organization_id = ?`).run(orgId).changes;
  const ten = db.prepare(`DELETE FROM tenants WHERE organization_id = ?`).run(orgId).changes;
  db.prepare(`DELETE FROM organizations WHERE id = ?`).run(orgId);
  console.log(`  ✓ removed org '${org.name}' (${org.slug}, id ${orgId}): ${usr} user(s), ${ten} site(s), ${inv} invite(s)`);
});

console.log('Removing:');
for (const ident of args) remove(ident);

console.log('\n=== Remaining organizations ===');
for (const o of db.prepare(`SELECT id, name, slug, status FROM organizations ORDER BY id`).all()) {
  console.log(`  ${o.id}  ${o.name}  (${o.slug})  ${o.status}`);
}
console.log('\nDone. Restart the server if it was running.');
db.close();
