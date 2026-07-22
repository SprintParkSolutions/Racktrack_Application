// Port-history store.
//
// Backs the "continuous polling / port drift" feature: a poller (see
// port_poller.js) SSHes into each monitored switch on a timer, parses
// the per-port state, and feeds it through writePoll() below — which
// diffs against the most-recent stored snapshot and persists both the
// new full-state snapshot AND one row per changed field in port_events.
//
// Storage strategy: we only write a snapshot when SOMETHING changed,
// so port_snapshots is event-sourced. To answer "what was the state at
// time T" the API picks MAX(ts) WHERE ts <= T for that (device, port).
//
// Tables:
//   monitored_devices(id, host, ssh_port, vendor, label, enabled, created_at,
//                     system_name, system_description, system_location,
//                     model, serial, sw_version, hw_version, mac, last_seen,
//                     consecutive_failures, backoff_until, last_error,
//                     last_polled_at)
//   port_snapshots   (id, device_id, port, ts, oper, admin, speed_mbps,
//                     duplex, flowctrl, medium, descr,
//                     lldp_chassis, lldp_port, lldp_system)
//   port_events      (id, device_id, port, field, from_val, to_val, at)

const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '..', 'data', 'auth.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS monitored_devices (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    host        TEXT NOT NULL UNIQUE,
    ssh_port    INTEGER NOT NULL DEFAULT 22,
    vendor      TEXT NOT NULL DEFAULT 'tplink',
    label       TEXT,
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    system_name        TEXT,
    system_description TEXT,
    system_location    TEXT,
    model       TEXT,
    serial      TEXT,
    sw_version  TEXT,
    hw_version  TEXT,
    mac         TEXT,
    last_seen   TEXT
  );

  CREATE TABLE IF NOT EXISTS port_snapshots (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id    INTEGER NOT NULL,
    port         TEXT NOT NULL,
    ts           TEXT NOT NULL,
    oper         TEXT,
    admin        TEXT,
    speed_mbps   INTEGER,
    duplex       TEXT,
    flowctrl     TEXT,
    medium       TEXT,
    descr        TEXT,
    lldp_chassis TEXT,
    lldp_port    TEXT,
    lldp_system  TEXT,
    FOREIGN KEY (device_id) REFERENCES monitored_devices(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_snap_dev_port_ts
    ON port_snapshots(device_id, port, ts DESC);
  CREATE INDEX IF NOT EXISTS idx_snap_ts
    ON port_snapshots(ts);

  CREATE TABLE IF NOT EXISTS port_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id   INTEGER NOT NULL,
    port        TEXT NOT NULL,
    field       TEXT NOT NULL,
    from_val    TEXT,
    to_val      TEXT,
    at          TEXT NOT NULL,
    FOREIGN KEY (device_id) REFERENCES monitored_devices(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_evt_dev_port_at
    ON port_events(device_id, port, at DESC);
  CREATE INDEX IF NOT EXISTS idx_evt_dev_at
    ON port_events(device_id, at DESC);
  CREATE INDEX IF NOT EXISTS idx_evt_at
    ON port_events(at);
`);

// Lazy column migration — tolerates DBs created by an earlier release
// that didn't have the newer columns. ALTER TABLE ADD COLUMN throws
// "duplicate column" if it already exists; that's fine.
const DEVICE_META_COLS = [
  ['system_name',        'TEXT'],
  ['system_description', 'TEXT'],
  ['system_location',    'TEXT'],
  ['model',              'TEXT'],
  ['serial',             'TEXT'],
  ['sw_version',         'TEXT'],
  ['hw_version',         'TEXT'],
  ['mac',                'TEXT'],
  ['last_seen',          'TEXT'],
  // Failure-tracking / continuous-poll robustness columns.
  ['consecutive_failures', "INTEGER NOT NULL DEFAULT 0"],
  ['backoff_until',        'TEXT'],
  ['last_error',           'TEXT'],
  ['last_polled_at',       'TEXT'],
  // Which Site owns this switch. Until this existed the table had no tenant
  // column at all, so `router.use('/api/ports', requireAuth)` was the only
  // gate — and authentication is not authorization. A member of any org could
  // list every other customer's switch fleet (name, location, model, serial,
  // chassis MAC, firmware) and walk their per-port state and LLDP topology.
  ['tenant_id',            'INTEGER'],
];
const existingDeviceCols = new Set(
  db.prepare(`PRAGMA table_info(monitored_devices)`).all().map((r) => r.name)
);
for (const [col, type] of DEVICE_META_COLS) {
  if (existingDeviceCols.has(col)) continue;
  db.exec(`ALTER TABLE monitored_devices ADD COLUMN ${col} ${type}`);
}
// Backfill: rows written before the tenant column existed have tenant_id NULL,
// and a NULL must never mean "everyone" — that is the hole this column closes.
//
// Choosing the owner's Site would be the naive answer and would silently break
// Drift for every ordinary user, since the switches that exist today are the
// shared lab and the people watching them are members of a customer Site. So:
// if the platform has exactly ONE real Site (anything other than the implicit
// "Default"), the existing switches belong to it — that keeps every current
// user's access intact while still fencing the rows off from any Site created
// later. Anything more ambiguous is left to a human via the env override,
// because guessing wrong here either breaks a shipped feature or leaks a
// customer's inventory.
const devicesNeedingTenant = db
  .prepare(`SELECT COUNT(*) AS n FROM monitored_devices WHERE tenant_id IS NULL`)
  .get().n;
if (devicesNeedingTenant > 0) {
  const override = Number(process.env.PORT_DEVICES_TENANT_ID) || null;
  const realSites = db
    .prepare(`SELECT id FROM tenants WHERE name IS NOT 'Default' ORDER BY id`)
    .all();
  const ownerSite = db
    .prepare(`SELECT tenant_id AS id FROM users WHERE role = 'owner' AND tenant_id IS NOT NULL ORDER BY id LIMIT 1`)
    .get();

  const target = override
    || (realSites.length === 1 ? realSites[0].id : null)
    || ownerSite?.id
    || null;

  if (target) {
    db.prepare(`UPDATE monitored_devices SET tenant_id = ? WHERE tenant_id IS NULL`).run(target);
    console.log(`[port_history_db] assigned ${devicesNeedingTenant} switch(es) to site ${target}`);
  } else {
    // No Site to attribute them to. Leave NULL — the read paths treat NULL as
    // owner-only, so the inventory stays reachable to the platform owner and
    // to nobody else, rather than leaking by default.
    console.warn(`[port_history_db] ${devicesNeedingTenant} switch(es) have no site; owner-only until assigned`);
  }
}
db.exec(`CREATE INDEX IF NOT EXISTS idx_devices_tenant ON monitored_devices(tenant_id)`);

const SNAPSHOT_META_COLS = ['lldp_chassis', 'lldp_port', 'lldp_system'];
const existingSnapCols = new Set(
  db.prepare(`PRAGMA table_info(port_snapshots)`).all().map((r) => r.name)
);
for (const col of SNAPSHOT_META_COLS) {
  if (existingSnapCols.has(col)) continue;
  db.exec(`ALTER TABLE port_snapshots ADD COLUMN ${col} TEXT`);
}

// Optional auto-seed — only when explicitly opted in. Earlier releases
// silently seeded a fake bench host on first boot, which meant a fresh
// production deployment immediately started SSH'ing to a non-existent
// bench switch. Now you have to ask for it.
if (process.env.RACKTRACK_AUTOSEED === '1') {
  const seedHost = process.env.TPLINK_BENCH_HOST;
  if (seedHost) {
    const seedCount = db.prepare(`SELECT COUNT(*) AS n FROM monitored_devices`).get().n;
    if (seedCount === 0) {
      db.prepare(`
        INSERT INTO monitored_devices (host, ssh_port, vendor, enabled)
        VALUES (?, 22, 'tplink', 1)
      `).run(seedHost);
    }
  }
}

// `descr` drift gets noisy when descriptions are managed by IaC (every
// redeploy emits drift events). Default ON to preserve "someone touched
// the port description" visibility; set PORT_DRIFT_TRACK_DESCR=0 to mute.
const TRACKED_FIELDS = [
  'oper', 'admin', 'speed_mbps', 'duplex', 'flowctrl', 'medium',
  ...(process.env.PORT_DRIFT_TRACK_DESCR === '0' ? [] : ['descr']),
  'lldp_chassis', 'lldp_port', 'lldp_system',
];

// ── monitored_devices ────────────────────────────────────────────────
const stmtListDevices    = db.prepare(`SELECT * FROM monitored_devices ORDER BY id`);
const stmtListEnabled    = db.prepare(`SELECT * FROM monitored_devices WHERE enabled = 1 ORDER BY id`);
// Due-for-poll: enabled AND not in active backoff window.
const stmtDueDevices     = db.prepare(`
  SELECT * FROM monitored_devices
   WHERE enabled = 1
     AND (backoff_until IS NULL OR backoff_until <= @now)
   ORDER BY id
`);
const stmtGetDevice      = db.prepare(`SELECT * FROM monitored_devices WHERE id = ?`);
const stmtGetDeviceHost  = db.prepare(`SELECT * FROM monitored_devices WHERE host = ?`);
const stmtInsertDevice   = db.prepare(`
  INSERT INTO monitored_devices (host, ssh_port, vendor, label, enabled, tenant_id)
  VALUES (@host, @ssh_port, @vendor, @label, @enabled, @tenant_id)
`);
const stmtUpdateEnabled  = db.prepare(`UPDATE monitored_devices SET enabled = ? WHERE id = ?`);
const stmtDeleteDevice   = db.prepare(`DELETE FROM monitored_devices WHERE id = ?`);
const stmtRecordPollSuccess = db.prepare(`
  UPDATE monitored_devices
     SET consecutive_failures = 0,
         backoff_until        = NULL,
         last_error           = NULL,
         last_polled_at       = @at,
         last_seen            = @at
   WHERE id = @id
`);
const stmtRecordPollFailure = db.prepare(`
  UPDATE monitored_devices
     SET consecutive_failures = consecutive_failures + 1,
         backoff_until        = @backoff_until,
         last_error           = @err,
         last_polled_at       = @at
   WHERE id = @id
`);
const stmtTouchPolled = db.prepare(`
  UPDATE monitored_devices SET last_polled_at = @at WHERE id = @id
`);

// ── Tenant scoping ───────────────────────────────────────────────────
// `scope` is null for the platform owner (everything) or an array of Site ids.
// An empty array means "no Sites", which correctly matches nothing. A row with
// tenant_id NULL is unattributed and visible only to the owner — never to a
// scoped caller, so an un-backfilled row can never leak sideways.
function inScope(device, scope) {
  if (!device) return false;
  if (scope === null) return true;
  return device.tenant_id != null && scope.includes(device.tenant_id);
}

function listDevices({ enabledOnly = false, scope = null } = {}) {
  const rows = (enabledOnly ? stmtListEnabled : stmtListDevices).all();
  return scope === null ? rows : rows.filter((d) => inScope(d, scope));
}
// Deliberately NOT scoped: this drives the background poller, which must sweep
// every switch on the platform regardless of who is signed in.
function dueDevices(now = new Date()) {
  return stmtDueDevices.all({ now: now.toISOString() });
}
function getDevice(id, scope = null) {
  const row = stmtGetDevice.get(id);
  return inScope(row, scope) ? row : undefined;
}
function getDeviceByHost(host) { return stmtGetDeviceHost.get(host); }
function addDevice({ host, ssh_port = 22, vendor = 'tplink', label = null, enabled = 1, tenant_id = null }) {
  const info = stmtInsertDevice.run({ host, ssh_port, vendor, label, enabled, tenant_id });
  return getDevice(info.lastInsertRowid);
}
function setEnabled(id, enabled) { stmtUpdateEnabled.run(enabled ? 1 : 0, id); }
function deleteDevice(id) { stmtDeleteDevice.run(id); }

// Failure-tracking knobs — exponential backoff capped at MAX_BACKOFF_MS
// so a permanently-dead switch retries on a sane cadence (default 30min)
// instead of every poll interval.
const BASE_BACKOFF_MS = Math.max(1000, Number(process.env.PORT_POLL_BACKOFF_BASE_MS) || 60_000);
const MAX_BACKOFF_MS  = Math.max(BASE_BACKOFF_MS, Number(process.env.PORT_POLL_BACKOFF_MAX_MS) || 30 * 60_000);

function backoffMsFor(failures) {
  // failures=1 → BASE, failures=2 → BASE*2, ... capped at MAX.
  const exp = BASE_BACKOFF_MS * Math.pow(2, Math.max(0, failures - 1));
  return Math.min(MAX_BACKOFF_MS, exp);
}

function recordPollSuccess(id, now = new Date()) {
  stmtRecordPollSuccess.run({ id, at: now.toISOString() });
}
function recordPollFailure(id, errMessage, now = new Date()) {
  // Read current failure count to compute the next backoff window.
  const d = getDevice(id);
  const nextFailures = (d?.consecutive_failures || 0) + 1;
  const until = new Date(now.getTime() + backoffMsFor(nextFailures)).toISOString();
  stmtRecordPollFailure.run({
    id,
    at:            now.toISOString(),
    backoff_until: until,
    err:           String(errMessage || '').slice(0, 500),
  });
  return { failures: nextFailures, backoffUntil: until };
}
function touchPolled(id, now = new Date()) {
  stmtTouchPolled.run({ id, at: now.toISOString() });
}

// Clear backoff + failure counter for one device or all devices. Used by
// (a) port_poller.start() on every server boot to wipe stale dead-state
// left by the previous process (which may have crashed mid-SSH-session),
// and (b) the /api/port-poller/reset admin endpoint when an operator
// wants to force an immediate retry without restarting the server or
// rebooting the switch.
const stmtClearBackoffAll = db.prepare(`
  UPDATE monitored_devices
     SET consecutive_failures = 0,
         backoff_until        = NULL,
         last_error           = NULL
`);
const stmtClearBackoffOne = db.prepare(`
  UPDATE monitored_devices
     SET consecutive_failures = 0,
         backoff_until        = NULL,
         last_error           = NULL
   WHERE id = ?
`);
function clearAllBackoff() {
  const info = stmtClearBackoffAll.run();
  return info?.changes || 0;
}
function clearBackoff(deviceId) {
  const info = stmtClearBackoffOne.run(deviceId);
  return info?.changes || 0;
}

// Update device metadata from `show system-info`. Only writes columns
// that were provided (non-null) so a transient parse miss doesn't blank
// out previously-recorded values.
function updateDeviceMetadata(id, meta = {}) {
  const writable = [
    'system_name', 'system_description', 'system_location',
    'model', 'serial', 'sw_version', 'hw_version', 'mac',
  ];
  const sets = [];
  const args = [];
  for (const col of writable) {
    if (meta[col] != null && meta[col] !== '') {
      sets.push(`${col} = ?`);
      args.push(String(meta[col]));
    }
  }
  if (sets.length === 0) return; // nothing to update
  sets.push(`last_seen = ?`);
  args.push(new Date().toISOString());
  args.push(id);
  db.prepare(`UPDATE monitored_devices SET ${sets.join(', ')} WHERE id = ?`).run(...args);
}

// Strip operationally-sensitive fields (host, ssh_port) from a device
// row before returning it to the client. The UI works off id + a human
// label, never the IP — that stays a server-side concern.
function toClientView(d) {
  if (!d) return null;
  const display = d.system_name || d.label || d.model || `Switch #${d.id}`;
  return {
    id:                 d.id,
    vendor:             d.vendor,
    enabled:            d.enabled,
    display_name:       display,
    system_name:        d.system_name,
    system_description: d.system_description,
    system_location:    d.system_location,
    model:              d.model,
    serial:             d.serial,
    sw_version:         d.sw_version,
    hw_version:         d.hw_version,
    mac:                d.mac,
    last_seen:          d.last_seen,
    last_polled_at:     d.last_polled_at,
    consecutive_failures: d.consecutive_failures || 0,
    backoff_until:      d.backoff_until,
    last_error:         d.last_error,
  };
}

// ── snapshots ────────────────────────────────────────────────────────
const stmtLatestSnapshot = db.prepare(`
  SELECT * FROM port_snapshots
   WHERE device_id = ? AND port = ?
   ORDER BY ts DESC, id DESC LIMIT 1
`);
const stmtSnapshotAtOrBefore = db.prepare(`
  SELECT * FROM port_snapshots
   WHERE device_id = ? AND port = ? AND ts <= ?
   ORDER BY ts DESC, id DESC LIMIT 1
`);
const stmtSnapshotsRange = db.prepare(`
  SELECT * FROM port_snapshots
   WHERE device_id = ? AND port = ? AND ts >= ? AND ts <= ?
   ORDER BY ts ASC
`);
// Window-function-based "latest snapshot per port". Ties on (ts) are
// broken by id DESC so the freshest row always wins even if two writes
// land in the same millisecond (e.g. clock granularity on Windows).
const stmtLatestAllPorts = db.prepare(`
  WITH ranked AS (
    SELECT s.*,
           ROW_NUMBER() OVER (PARTITION BY port ORDER BY ts DESC, id DESC) AS rn
      FROM port_snapshots s
     WHERE device_id = ?
  )
  SELECT id, device_id, port, ts, oper, admin, speed_mbps, duplex, flowctrl,
         medium, descr, lldp_chassis, lldp_port, lldp_system
    FROM ranked
   WHERE rn = 1
   ORDER BY port
`);
const stmtInsertSnapshot = db.prepare(`
  INSERT INTO port_snapshots
    (device_id, port, ts, oper, admin, speed_mbps, duplex, flowctrl, medium, descr,
     lldp_chassis, lldp_port, lldp_system)
  VALUES
    (@device_id, @port, @ts, @oper, @admin, @speed_mbps, @duplex, @flowctrl, @medium, @descr,
     @lldp_chassis, @lldp_port, @lldp_system)
`);

function latestSnapshot(deviceId, port) { return stmtLatestSnapshot.get(deviceId, port); }
function latestSnapshotsForDevice(deviceId) { return stmtLatestAllPorts.all(deviceId); }
function snapshotAt(deviceId, port, isoTs) { return stmtSnapshotAtOrBefore.get(deviceId, port, isoTs); }
function snapshotsBetween(deviceId, port, fromIso, toIso) {
  return stmtSnapshotsRange.all(deviceId, port, fromIso, toIso);
}

// ── events ───────────────────────────────────────────────────────────
const stmtEventsForPort = db.prepare(`
  SELECT * FROM port_events
   WHERE device_id = ? AND port = ?
   ORDER BY at DESC LIMIT ?
`);
const stmtEventsForDevice = db.prepare(`
  SELECT * FROM port_events
   WHERE device_id = ?
   ORDER BY at DESC LIMIT ?
`);
const stmtInsertEvent = db.prepare(`
  INSERT INTO port_events (device_id, port, field, from_val, to_val, at)
  VALUES (@device_id, @port, @field, @from_val, @to_val, @at)
`);

function eventsForPort(deviceId, port, limit = 200) {
  return stmtEventsForPort.all(deviceId, port, limit);
}
function eventsForDevice(deviceId, limit = 500) {
  return stmtEventsForDevice.all(deviceId, limit);
}

// ── retention ────────────────────────────────────────────────────────
// Prune anything older than `maxAgeDays` to keep the SQLite file from
// growing without bound. Snapshots retain the latest-per-port even past
// the cutoff so the diff path on the next poll has a baseline; events
// are pure history and can be hard-deleted by age.
const stmtPruneEvents = db.prepare(`
  DELETE FROM port_events WHERE at < ?
`);
// Delete only superseded snapshots: any snapshot for which a newer one
// exists for the same (device_id, port). Guarantees we never lose the
// "current state" baseline regardless of cutoff.
const stmtPruneSnapshots = db.prepare(`
  DELETE FROM port_snapshots
   WHERE ts < ?
     AND EXISTS (
       SELECT 1 FROM port_snapshots ps2
        WHERE ps2.device_id = port_snapshots.device_id
          AND ps2.port      = port_snapshots.port
          AND (ps2.ts > port_snapshots.ts
               OR (ps2.ts = port_snapshots.ts AND ps2.id > port_snapshots.id))
     )
`);

function pruneOldEvents(maxAgeDays, now = new Date()) {
  const cutoff = new Date(now.getTime() - maxAgeDays * 86_400_000).toISOString();
  const info = stmtPruneEvents.run(cutoff);
  return info.changes;
}
function pruneOldSnapshots(maxAgeDays, now = new Date()) {
  const cutoff = new Date(now.getTime() - maxAgeDays * 86_400_000).toISOString();
  const info = stmtPruneSnapshots.run(cutoff);
  return info.changes;
}

// ── core write path ──────────────────────────────────────────────────
// Called by the poller once per port per poll. `row` is the merged
// per-port state from the vendor's parser. Returns the list of detected
// changes (possibly empty). All writes happen in one transaction so
// snapshot + events are atomic.
const writePollTxn = db.transaction((deviceId, row, ts) => {
  const prev = latestSnapshot(deviceId, row.port);
  const changes = [];
  if (prev) {
    for (const f of TRACKED_FIELDS) {
      const a = normForCompare(prev[f]);
      const b = normForCompare(row[f]);
      if (a !== b) {
        changes.push({ field: f, from: prev[f] ?? null, to: row[f] ?? null });
      }
    }
    if (changes.length === 0) return changes;
  }
  // First-ever snapshot OR something changed → write a fresh snapshot
  stmtInsertSnapshot.run({
    device_id: deviceId,
    port:      row.port,
    ts,
    oper:         row.oper         ?? null,
    admin:        row.admin        ?? null,
    speed_mbps:   row.speed_mbps   ?? null,
    duplex:       row.duplex       ?? null,
    flowctrl:     row.flowctrl     ?? null,
    medium:       row.medium       ?? null,
    descr:        row.descr        ?? null,
    lldp_chassis: row.lldp_chassis ?? null,
    lldp_port:    row.lldp_port    ?? null,
    lldp_system:  row.lldp_system  ?? null,
  });
  for (const c of changes) {
    stmtInsertEvent.run({
      device_id: deviceId,
      port:      row.port,
      field:     c.field,
      from_val:  c.from == null ? null : String(c.from),
      to_val:    c.to   == null ? null : String(c.to),
      at:        ts,
    });
  }
  return changes;
});

function writePoll(deviceId, row, ts = new Date().toISOString()) {
  return writePollTxn(deviceId, row, ts);
}

function normForCompare(v) {
  if (v === null || v === undefined) return null;
  return String(v);
}

module.exports = {
  TRACKED_FIELDS,
  BASE_BACKOFF_MS, MAX_BACKOFF_MS, backoffMsFor,
  listDevices, dueDevices, getDevice, getDeviceByHost,
  addDevice, setEnabled, deleteDevice,
  updateDeviceMetadata, toClientView,
  recordPollSuccess, recordPollFailure, touchPolled,
  clearAllBackoff, clearBackoff,
  latestSnapshot, latestSnapshotsForDevice, snapshotAt, snapshotsBetween,
  eventsForPort, eventsForDevice,
  pruneOldEvents, pruneOldSnapshots,
  writePoll,
};
