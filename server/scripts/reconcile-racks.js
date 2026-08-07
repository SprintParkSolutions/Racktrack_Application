#!/usr/bin/env node
/**
 * Reconcile rack ownership (auth.db) against scan artifacts (outputs/).
 *
 * RackTrack keeps a rack in TWO stores that have no transactional link:
 *   - WHO owns it:   auth.db  →  rack_owners(tenant_id, rack_id, ...)
 *   - the scan data: filesystem  →  outputs/<rackId>/ (image, JSON, report)
 *
 * Because claiming ownership and writing the folder are separate, non-atomic
 * steps, the two can drift. This report is the read-only set-difference of the
 * two, so an operator can see drift before it becomes a support ticket:
 *
 *   OWNER, NO FOLDER  — a tenant owns a rack whose folder is gone. Authorized
 *                       reads of it resolve to a missing directory (broken rack).
 *   FOLDER, NO OWNER  — a scan folder nobody owns. Unreachable dead weight and
 *                       a GC candidate (see lib/orphan_gc.js).
 *
 * READ-ONLY BY DEFAULT: opens auth.db with { readonly: true } and only lists
 * the filesystem. It never writes, deletes, migrates, or touches production
 * data — safe to run against any checkout, including on the Mac dev copy.
 *
 *   Report:  cd server && node scripts/reconcile-racks.js
 *   CI/cron: add --strict to exit 1 when any drift is found.
 *
 * OPT-IN HEAL (owner-rows with no folder only): --prune-dangling-owners removes
 * rack_owners rows whose folder is gone — the "authorized read → missing dir"
 * case. It is a DRY RUN unless you ALSO pass --apply, and only then does it open
 * the DB read-write. FOLDER, NO OWNER is left to lib/orphan_gc.js (which owns
 * folder deletion + retention). Run heal on the SERVER after reviewing a report
 * — never blindly from a dev checkout, whose drift differs from production.
 *
 *   Preview heal: node scripts/reconcile-racks.js --prune-dangling-owners
 *   Apply heal:   node scripts/reconcile-racks.js --prune-dangling-owners --apply
 */
'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { RACK_ID_RE } = require('../lib/rack_access');

const DB_PATH = path.join(__dirname, '..', 'data', 'auth.db');
const OUTPUTS_DIR = path.join(__dirname, '..', '..', 'outputs');

function ownedRackIds() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`auth.db not found at ${DB_PATH}`);
    process.exit(2);
  }
  const db = new Database(DB_PATH, { readonly: true });
  try {
    return new Set(
      db.prepare('SELECT DISTINCT rack_id FROM rack_owners').all().map(r => r.rack_id),
    );
  } finally {
    db.close();
  }
}

function folderRackIds() {
  if (!fs.existsSync(OUTPUTS_DIR)) return new Set();
  return new Set(
    fs.readdirSync(OUTPUTS_DIR).filter(name => {
      if (!RACK_ID_RE.test(name)) return false;
      try { return fs.statSync(path.join(OUTPUTS_DIR, name)).isDirectory(); }
      catch { return false; }
    }),
  );
}

function main() {
  const strict = process.argv.includes('--strict');
  const prune = process.argv.includes('--prune-dangling-owners');
  const owned = ownedRackIds();
  const folders = folderRackIds();

  const ownerNoFolder = [...owned].filter(id => !folders.has(id)).sort();
  const folderNoOwner = [...folders].filter(id => !owned.has(id)).sort();

  console.log('Rack ownership ↔ artifact reconciliation');
  console.log(`  rack_owners rows (distinct): ${owned.size}`);
  console.log(`  outputs/ folders:            ${folders.size}`);
  console.log('');

  console.log(`OWNER, NO FOLDER — owned but no scan data on disk (${ownerNoFolder.length}):`);
  if (ownerNoFolder.length === 0) console.log('  (none)');
  else ownerNoFolder.forEach(id => console.log(`  ${id}`));
  console.log('');

  console.log(`FOLDER, NO OWNER — scan data nobody owns / GC candidate (${folderNoOwner.length}):`);
  if (folderNoOwner.length === 0) console.log('  (none)');
  else folderNoOwner.forEach(id => console.log(`  ${id}`));
  if (folderNoOwner.length) console.log('  → clean up with lib/orphan_gc.js (owns folder deletion + retention).');

  const drift = ownerNoFolder.length + folderNoOwner.length;
  if (drift === 0) console.log('\nIn sync — no drift.');
  else console.log(`\n${drift} rack(s) out of sync.`);

  if (prune) healDanglingOwners(ownerNoFolder);
  if (strict && drift > 0) process.exit(1);
}

/** Remove rack_owners rows whose folder is gone. Dry-run unless --apply. */
function healDanglingOwners(ownerNoFolder) {
  const apply = process.argv.includes('--apply');
  console.log(`\n── Heal: prune ${ownerNoFolder.length} dangling owner row(s) ${apply ? '(APPLY)' : '(dry run — pass --apply to act)'} ──`);
  if (ownerNoFolder.length === 0) { console.log('  nothing to prune.'); return; }
  if (!apply) {
    ownerNoFolder.forEach(id => console.log(`  would delete rack_owners WHERE rack_id = ${id}`));
    return;
  }
  const db = new Database(DB_PATH);   // read-write, only in --apply
  try {
    const stmt = db.prepare('DELETE FROM rack_owners WHERE rack_id = ?');
    const tx = db.transaction(ids => { let n = 0; for (const id of ids) n += stmt.run(id).changes; return n; });
    const removed = tx(ownerNoFolder);
    console.log(`  deleted ${removed} owner row(s).`);
  } finally {
    db.close();
  }
}

main();
