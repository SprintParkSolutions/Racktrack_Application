#!/usr/bin/env node
/**
 * Delete port history that the poller recorded from SEEDED data, not from a switch.
 *
 *   node scripts/purge-poller-history.js                 # dry run — prints what it would do
 *   node scripts/purge-poller-history.js --yes           # do it (all devices)
 *   node scripts/purge-poller-history.js --host 10.0.0.5 # scope to one switch
 *
 * WHY THIS EXISTS
 *
 * RACKTRACK_DEMO_DATA used to intercept runSwitchCommandsSequential — the very
 * runner the port poller is handed. So while it was on, every poll cycle parsed
 * a fixture transcript and wrote the result to disk as though a switch had said
 * it: per-port snapshots, drift events, and the device's own identity (model,
 * serial, firmware, MAC) plus a last_seen stamp that made it read "Live".
 *
 * Removing that seam stopped new fabricated rows. It could not remove the ones
 * already written, and server/data is a persisted volume on the demo VPS, so
 * they survive every redeploy. Drift and the Ports/Port History views read
 * straight from these tables — which is why invented data can still show up on
 * a build that no longer has any way to invent it.
 *
 * WHAT IT CANNOT DO
 *
 * There is no marker on a row saying which runner produced it. Fabricated and
 * genuine snapshots are byte-for-byte the same shape. So this deletes ALL
 * history for the devices you name — it cannot surgically remove only the fake
 * ones. That is the right trade on a box that never had a reachable switch (the
 * demo VPS: 100% of its history is fixture-derived). On a deployment that has
 * polled real hardware, scope it with --host, or do not run it at all.
 *
 * WHAT IT KEEPS
 *
 *   - the monitored_devices ROWS themselves (host, ssh_port, vendor, label,
 *     enabled, tenant_id) — you registered those by hand; re-adding them means
 *     re-deciding tenancy, and deleting them would cascade anyway
 *   - every other table. This touches only the three the poller writes.
 *
 * A timestamped backup is taken before anything changes. Stop the server first:
 * a running poller holds cached backoff state that would outlive the reset.
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const args    = process.argv.slice(2);
const apply   = args.includes('--yes');
const hostArg = (() => {
  const i = args.indexOf('--host');
  return i >= 0 ? args[i + 1] : null;
})();

if (args.includes('--help') || args.includes('-h')) {
  console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*\*?/, ''));
  process.exit(0);
}

// Same resolution port_history_db uses, including the test override, so this
// script and the app can never disagree about which file they mean.
const dbPath = process.env.RACKTRACK_AUTH_DB
  || path.join(__dirname, '..', 'data', 'auth.db');

if (!fs.existsSync(dbPath)) {
  console.error(`No database at ${dbPath} — nothing to purge.`);
  process.exit(1);
}

const db = new Database(dbPath);

// --- Scope -----------------------------------------------------------------

const devices = hostArg
  ? db.prepare(`SELECT * FROM monitored_devices WHERE host = ?`).all(hostArg)
  : db.prepare(`SELECT * FROM monitored_devices ORDER BY id`).all();

if (hostArg && devices.length === 0) {
  console.error(`No device registered with host ${hostArg}.`);
  console.error('Registered hosts:');
  for (const d of db.prepare(`SELECT host FROM monitored_devices ORDER BY id`).all()) {
    console.error(`  ${d.host}`);
  }
  process.exit(1);
}
if (devices.length === 0) {
  console.log('No devices registered — no poller history can exist. Nothing to do.');
  process.exit(0);
}

const ids = devices.map((d) => d.id);
const ph  = ids.map(() => '?').join(',');

const snapCount = db.prepare(`SELECT COUNT(*) n FROM port_snapshots WHERE device_id IN (${ph})`).get(...ids).n;
const evtCount  = db.prepare(`SELECT COUNT(*) n FROM port_events    WHERE device_id IN (${ph})`).get(...ids).n;

console.log(`Database: ${dbPath}`);
console.log(`Scope:    ${hostArg ? `host ${hostArg}` : `all ${devices.length} registered device(s)`}`);
console.log('');
console.log('Would delete:');
console.log(`  port_snapshots   ${snapCount} row(s)`);
console.log(`  port_events      ${evtCount} row(s)`);
console.log('');
console.log('Would clear these poller-written fields (the device rows stay):');
for (const d of devices) {
  const identity = [d.model, d.serial, d.sw_version, d.mac].filter(Boolean).join(' · ') || '(none recorded)';
  console.log(`  ${String(d.host).padEnd(16)} ${identity}`);
  console.log(`  ${''.padEnd(16)} last_seen=${d.last_seen || 'never'} last_error=${d.last_error ? JSON.stringify(d.last_error).slice(0, 60) : 'none'}`);
}

if (snapCount === 0 && evtCount === 0 && !devices.some((d) => d.last_seen || d.model || d.serial)) {
  console.log('');
  console.log('Nothing recorded — this store is already clean.');
  process.exit(0);
}

if (!apply) {
  console.log('');
  console.log('Dry run. Re-run with --yes to apply.');
  process.exit(0);
}

// --- Backup, then purge ----------------------------------------------------

// A plain file copy is safe here only because the caller was told to stop the
// server; with WAL active and a writer attached, the -wal file holds committed
// pages this copy would miss. Use the backup API so it is correct either way.
const stamp  = new Date().toISOString().replace(/[:.]/g, '-');
const backup = `${dbPath}.${stamp}.bak`;
db.backup(backup)
  .then(() => {
    console.log('');
    console.log(`Backup written: ${backup}`);
    purge();
  })
  .catch((err) => {
    console.error(`Backup FAILED (${err.message}) — refusing to delete anything.`);
    process.exit(1);
  });

function purge() {
  const clearMeta = db.prepare(`
    UPDATE monitored_devices SET
      system_name = NULL, system_description = NULL, system_location = NULL,
      model = NULL, serial = NULL, sw_version = NULL, hw_version = NULL,
      mac = NULL, last_seen = NULL,
      consecutive_failures = 0, backoff_until = NULL,
      last_error = NULL, last_polled_at = NULL
     WHERE id IN (${ph})
  `);

  const run = db.transaction(() => {
    const s = db.prepare(`DELETE FROM port_snapshots WHERE device_id IN (${ph})`).run(...ids);
    const e = db.prepare(`DELETE FROM port_events    WHERE device_id IN (${ph})`).run(...ids);
    const m = clearMeta.run(...ids);
    return { snaps: s.changes, events: e.changes, devices: m.changes };
  });

  const out = run();
  console.log('');
  console.log('Purged:');
  console.log(`  port_snapshots   ${out.snaps} row(s) deleted`);
  console.log(`  port_events      ${out.events} row(s) deleted`);
  console.log(`  monitored_devices ${out.devices} row(s) reset to un-polled`);
  console.log('');
  console.log('Each device now reads "No data" until a real poll succeeds.');
  console.log('Start the server; the poller will re-read from the actual switches.');
}
