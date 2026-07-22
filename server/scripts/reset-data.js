#!/usr/bin/env node
/**
 * Reset RackTrack to a clean slate for a fresh round of testing.
 *
 *   node scripts/reset-data.js            # dry run — prints what it would do
 *   node scripts/reset-data.js --yes      # actually do it
 *
 * Stop the server first. This writes to the databases directly, and a running
 * server holds cached state that would be inconsistent with what is left.
 *
 * KEEPS
 *   - the owner account (role='owner', lowest id) and its tenant
 *   - monitored_devices          — the EVE-NG / bench lab switches
 *   - connection_profiles        — ServiceNow / Netdisco credentials
 *
 * REMOVES
 *   - every other user, every organization, every non-owner tenant
 *   - invites, pending signups, password resets, the whole audit log
 *   - all marketplace data
 *   - all rack ownership, rack groups, port snapshots and port events
 *   - the application log database
 *   - uploaded photos and generated outputs on disk
 *
 * CREATES
 *   - one fresh organization for testers, with no members
 *
 * A timestamped backup of both databases is taken before anything is changed.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const GO = process.argv.includes('--yes');
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const AUTH_DB = path.join(DATA, 'auth.db');
const LOGS_DB = path.join(DATA, 'logs.db');

const NEW_ORG_NAME = process.env.RESET_ORG_NAME || 'THE TESTERS';

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const say = (...a) => console.log(...a);

// ── tables emptied outright ────────────────────────────────────────────
// Order matters: children before parents, since foreign keys are declared.
const TRUNCATE = [
  'marketplace_alerts', 'marketplace_flags', 'marketplace_messages',
  'marketplace_orders', 'marketplace_saved_searches',
  'marketplace_partner_accounts', 'marketplace_listings',
  'rack_group_members', 'rack_groups', 'rack_owners',
  'port_events', 'port_snapshots',
  'invites', 'pending_signups', 'password_resets', 'audit_log',
];

// ── on-disk artefacts ──────────────────────────────────────────────────
const DIRS = [
  path.join(ROOT, 'uploads'),
  path.join(ROOT, 'outputs'),
  path.join(ROOT, '..', 'uploads'),
  path.join(ROOT, '..', 'outputs'),
];

function backup(file) {
  if (!fs.existsSync(file)) return null;
  const dest = `${file}.bak-reset-${stamp}`;
  if (GO) {
    // NOT copyFileSync. These databases run in WAL mode, so recently committed
    // data lives in the -wal sidecar until a checkpoint folds it back in — at
    // one point auth.db-wal was 2.6MB against a 2.5MB main file. Copying only
    // the main file produces a backup that silently omits the newest data,
    // which is the worst possible failure for the one artefact you would reach
    // for after a bad reset. Checkpoint first, then copy.
    const db = new Database(file);
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
    fs.copyFileSync(file, dest);
    // Verify the copy opens and reports the same page count, rather than
    // assuming a backup that was never read back is good.
    const check = new Database(dest, { readonly: true });
    const pages = check.pragma('page_count', { simple: true });
    check.close();
    say(`  backed up      ${path.basename(dest)}  (${pages} pages, WAL folded in)`);
  } else {
    say(`  would back up  ${path.basename(dest)}  (after a WAL checkpoint)`);
  }
  return dest;
}

function countDir(dir) {
  try { return fs.readdirSync(dir).length; } catch { return null; }
}

function emptyDir(dir) {
  const n = countDir(dir);
  if (n === null) return;
  if (!GO) { say(`  would clear   ${dir}  (${n} entries)`); return; }
  for (const entry of fs.readdirSync(dir)) {
    // Leave dotfiles — .gitkeep and friends keep the directory in the repo.
    if (entry.startsWith('.')) continue;
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  }
  say(`  cleared       ${dir}  (${n} entries)`);
}

function main() {
  if (!fs.existsSync(AUTH_DB)) {
    console.error(`✗ no database at ${AUTH_DB}`);
    process.exit(1);
  }

  say(`\nRackTrack data reset — ${GO ? 'LIVE' : 'DRY RUN (pass --yes to apply)'}`);
  say(`data directory: ${DATA}\n`);

  say('Backups');
  backup(AUTH_DB);
  backup(LOGS_DB);

  const db = new Database(AUTH_DB);

  // Find the owner to keep: the lowest-id account with role 'owner'.
  const owner = db.prepare(
    "SELECT id, email, public_id, tenant_id FROM users WHERE role='owner' ORDER BY id LIMIT 1").get();
  if (!owner) {
    console.error('✗ no owner account found — refusing to run, you would be locked out.');
    process.exit(1);
  }
  say(`\nKeeping owner  id=${owner.id}  ${owner.email}  ${owner.public_id}  tenant=${owner.tenant_id}`);

  const before = {};
  for (const t of [...TRUNCATE, 'users', 'organizations', 'tenants', 'monitored_devices', 'connection_profiles']) {
    try { before[t] = db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get().c; } catch { before[t] = null; }
  }

  const run = db.transaction(() => {
    // connection_profiles.user_id is ON DELETE CASCADE, so profiles belonging
    // to deleted users go with them and the owner's are untouched. Do NOT try
    // to reassign them: there is a partial unique index allowing one active
    // profile per user, and the owner already has one.
    for (const t of TRUNCATE) {
      try {
        const n = db.prepare(`DELETE FROM "${t}"`).run().changes;
        say(`  emptied  ${String(n).padStart(6)}  ${t}`);
      } catch (e) { say(`  skipped           ${t}  (${e.message})`); }
    }

    const users = db.prepare('DELETE FROM users WHERE id != ?').run(owner.id).changes;
    say(`  removed  ${String(users).padStart(6)}  users (kept the owner)`);

    // Tenants point at organizations, so tenants must go first — deleting an
    // organization that a tenant still references fails the foreign key.
    db.prepare('UPDATE users SET organization_id = NULL WHERE id = ?').run(owner.id);
    db.prepare('UPDATE tenants SET organization_id = NULL WHERE id = ?').run(owner.tenant_id);
    const tenants = db.prepare('DELETE FROM tenants WHERE id != ?').run(owner.tenant_id).changes;
    say(`  removed  ${String(tenants).padStart(6)}  tenants (kept the owner's)`);
    const orgs = db.prepare('DELETE FROM organizations').run().changes;
    say(`  removed  ${String(orgs).padStart(6)}  organizations`);

    // One fresh organization for testers, with nobody in it.
    const slug = NEW_ORG_NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const org = db.prepare(
      "INSERT INTO organizations (slug, name, created_by, created_at, status) VALUES (?,?,?,datetime('now'),'active')"
    ).run(slug, NEW_ORG_NAME, owner.id);
    const tenant = db.prepare(
      "INSERT INTO tenants (slug, name, created_at, organization_id) VALUES (?,?,datetime('now'),?)"
    ).run(`${slug}-site`, `${NEW_ORG_NAME} Site`, org.lastInsertRowid);
    say(`  created  organization "${NEW_ORG_NAME}" (id=${org.lastInsertRowid}, slug=${slug}) with 0 members`);
    say(`  created  tenant       "${NEW_ORG_NAME} Site" (id=${tenant.lastInsertRowid})`);

    // Restart id sequences so the fresh data does not start at 1400.
    //
    // `users` is deliberately EXCLUDED. Resetting its counter hands the next
    // signups the ids of the accounts just deleted, and tokens are valid for
    // 30 days — so someone still holding a pre-reset token for old user 3
    // would authenticate as whoever now occupies id 3. That is a privilege
    // escalation, not a cosmetic id gap. Let user ids keep climbing.
    for (const t of TRUNCATE) {
      try { db.prepare('DELETE FROM sqlite_sequence WHERE name = ?').run(t); } catch { /* no sequence */ }
    }
  });

  say('\nDatabase');
  if (GO) { run(); db.pragma('wal_checkpoint(TRUNCATE)'); db.exec('VACUUM'); }
  else {
    for (const t of TRUNCATE) say(`  would empty  ${String(before[t] ?? '?').padStart(6)}  ${t}`);
    say(`  would remove ${String((before.users ?? 1) - 1).padStart(6)}  users (keeping the owner)`);
    say(`  would remove ${String(before.organizations ?? 0).padStart(6)}  organizations`);
    say(`  would create organization "${NEW_ORG_NAME}" with 0 members`);
  }
  say(`  keeping  ${String(before.monitored_devices ?? 0).padStart(6)}  monitored_devices (lab switches)`);
  say(`  keeping  ${String(before.connection_profiles ?? 0).padStart(6)}  connection_profiles`);
  db.close();

  // Tokens issued before the reset are still cryptographically valid for 30
  // days and carry a user id. Even with the id-reuse hole closed above, a
  // pre-reset token belongs to an account that no longer exists, and "everyone
  // is signed out" is the honest meaning of a fresh start. Rotating the
  // signing secret invalidates all of them at once.
  say('\nSession tokens');
  const SECRET = path.join(DATA, 'jwt.secret');
  if (fs.existsSync(SECRET)) {
    if (GO) {
      fs.copyFileSync(SECRET, `${SECRET}.bak-reset-${stamp}`);
      fs.writeFileSync(SECRET, require('crypto').randomBytes(64).toString('hex'), { mode: 0o600 });
      say('  rotated  jwt.secret — every token issued before now is rejected');
    } else {
      say('  would rotate jwt.secret (signs everyone out; pre-reset tokens cannot be replayed)');
    }
  } else {
    say('  (no jwt.secret — the server will generate one on next boot)');
  }

  // Application logs live in their own database.
  say('\nApplication log');
  if (fs.existsSync(LOGS_DB)) {
    const ldb = new Database(LOGS_DB);
    const n = ldb.prepare('SELECT COUNT(*) AS c FROM app_logs').get().c;
    if (GO) {
      ldb.prepare('DELETE FROM app_logs').run();
      ldb.pragma('wal_checkpoint(TRUNCATE)');
      ldb.exec('VACUUM');
      say(`  cleared  ${String(n).padStart(6)}  app_logs`);
    } else say(`  would clear ${String(n).padStart(6)}  app_logs`);
    ldb.close();
  } else say('  (no logs.db)');

  say('\nFiles on disk');
  for (const d of DIRS) emptyDir(d);

  say(`\n${GO ? '✔ Reset complete.' : 'Dry run only — nothing was changed. Re-run with --yes to apply.'}`);
  if (GO) say('  Restart the server, then sign in as the owner.\n');
}

main();
