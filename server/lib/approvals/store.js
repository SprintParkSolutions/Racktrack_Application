/**
 * RackTrack Approvals: the tables, and plain reads and writes on them.
 *
 * Everything the approval workflow remembers lives here, in auth.db, beside
 * users and tenants: the plan, its items, the tickets raised on them, the
 * plan-level approval decisions, verifications, comments, the event history,
 * SLA clocks, notifications, exceptions, change windows and the per
 * organization settings. The contract is docs/design/approvals-api-contract.md.
 *
 * No rule lives in this file. It does not know who may do what or which
 * status follows which - that is machine.js and service.js. It creates the
 * tables lazily (the estate.js pattern: _prep and _ensureColumn, additive and
 * idempotent), parses the JSON columns on read, hands rows back in camelCase,
 * and bumps a plan's version on every write to it.
 *
 * ONE DATABASE HANDLE. auth.js already holds a better-sqlite3 handle on
 * auth.db and exports it; this module uses that same handle, so a transaction
 * that touches users or tenants and an approval table is one transaction, and
 * two handles can never block each other ("database is locked"). Tests point
 * RACKTRACK_APPROVALS_DB at a throwaway file or ':memory:' and get a handle of
 * their own; `isolated()` then says so, and the service keeps the audit trail
 * (which always lives in the real auth.db) out of it.
 *
 * Naming. A column ending in _id holds a RackTrack user id or a row id. A
 * column ending in _by holds the username, as the JSON plans did, and the
 * columns a rule has to compare people on (created_by, submitted_by,
 * decided_by, raised_by, resolved_by) have a twin ending in _by_id with the
 * user id, because a username can be changed and an id cannot.
 */
const Database = require('better-sqlite3');

let _db = null;
let _isolated = false;
let _ready = false;

/** The handle: the shared auth.db one, or a throwaway for tests. */
function handle() {
  if (_db) return _db;
  const override = process.env.RACKTRACK_APPROVALS_DB;
  if (override) {
    _db = new Database(override);
    if (override !== ':memory:') _db.pragma('journal_mode = WAL');
    _isolated = true;
  } else {
    // Lazy, so requiring this file does not load the whole auth module until
    // a table is actually needed, and so auth.js may require this file too.
    _db = require('../../auth').db;
  }
  _db.pragma('foreign_keys = ON');
  // Wait for another writer rather than failing the request. better-sqlite3
  // sets this from its own `timeout` option on a handle it opened; auth.db's
  // handle is not ours, so say it here too.
  _db.pragma('busy_timeout = 5000');
  return _db;
}

/** True when the store is on a throwaway database rather than auth.db. */
const isolated = () => { handle(); return _isolated; };

const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

// -- Schema -----------------------------------------------------------
function _hasColumn(table, col) {
  return handle().prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
}
function _ensureColumn(table, col, ddl) {
  if (!_hasColumn(table, col)) handle().exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

function _prep() {
  if (_ready) return;
  const db = handle();
  db.exec(`
    CREATE TABLE IF NOT EXISTS approval_plans (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id          INTEGER,
      tenant_id       INTEGER,
      scan_id         INTEGER,
      rack_id         TEXT,
      rack_uid        TEXT,
      rack_name       TEXT,
      netbox_url      TEXT,
      status          TEXT    NOT NULL DEFAULT 'draft',
      disposition     TEXT,
      category        TEXT,
      priority        TEXT    NOT NULL DEFAULT 'P3',
      risk            TEXT    NOT NULL DEFAULT 'medium',
      fingerprint     TEXT,
      payload_hash    TEXT,
      version         INTEGER NOT NULL DEFAULT 1,
      counts          TEXT,
      warnings        TEXT,
      orphans         TEXT,
      custom_field    TEXT,
      created_by      TEXT,
      created_by_id   INTEGER,
      created_at      TEXT    NOT NULL,
      submitted_at    TEXT,
      submitted_by    TEXT,
      submitted_by_id INTEGER,
      submitted_note  TEXT,
      triaged_at      TEXT,
      triaged_by      TEXT,
      triage_note     TEXT,
      pending_reason  TEXT,
      reopen_count    INTEGER NOT NULL DEFAULT 0,
      reopen_reason   TEXT,
      parent_plan_id  INTEGER,
      duplicate_of    INTEGER,
      exception_id    INTEGER,
      window_id       INTEGER,
      verification    TEXT,
      result          TEXT,
      pre_snapshot    TEXT,
      post_snapshot   TEXT,
      written_at      TEXT,
      written_by      TEXT,
      completed_at    TEXT,
      cancelled_at    TEXT,
      cancel_reason   TEXT,
      updated_at      TEXT    NOT NULL,
      legacy_id       INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_approval_plans_org_status ON approval_plans(org_id, status);
    CREATE INDEX IF NOT EXISTS idx_approval_plans_rack ON approval_plans(rack_id);
    CREATE INDEX IF NOT EXISTS idx_approval_plans_scan ON approval_plans(scan_id);
    CREATE INDEX IF NOT EXISTS idx_approval_plans_creator ON approval_plans(created_by);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_approval_plans_legacy
      ON approval_plans(legacy_id) WHERE legacy_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS approval_items (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id       INTEGER NOT NULL REFERENCES approval_plans(id) ON DELETE CASCADE,
      uid           TEXT    NOT NULL,
      type          TEXT,
      name          TEXT,
      action        TEXT,
      netbox_id     INTEGER,
      diff          TEXT,
      reason        TEXT,
      supporting    INTEGER NOT NULL DEFAULT 0,
      decidable     INTEGER NOT NULL DEFAULT 0,
      decision      TEXT    NOT NULL DEFAULT 'pending',
      decided_by    TEXT,
      decided_by_id INTEGER,
      decided_at    TEXT,
      note          TEXT,
      reason_code   TEXT,
      parent_uid    TEXT,
      following     INTEGER NOT NULL DEFAULT 0,
      exception_id  INTEGER,
      extra         TEXT,
      UNIQUE (plan_id, uid)
    );

    CREATE TABLE IF NOT EXISTS approval_tickets (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id          INTEGER NOT NULL REFERENCES approval_plans(id) ON DELETE CASCADE,
      item_uid         TEXT    NOT NULL,
      assignee         TEXT,
      assignee_id      INTEGER,
      assignee_email   TEXT,
      assignee_user_id INTEGER,
      spoc             TEXT,
      raised_by        TEXT,
      raised_by_id     INTEGER,
      raised_at        TEXT,
      status           TEXT    NOT NULL DEFAULT 'open',
      pending_reason   TEXT,
      pending_since    TEXT,
      accepted_at      TEXT,
      question         TEXT,
      finding          TEXT,
      disposition      TEXT,
      outcome          TEXT,
      scope            TEXT,
      resolved_by      TEXT,
      resolved_by_id   INTEGER,
      resolved_at      TEXT,
      closed_by        TEXT,
      closed_at        TEXT,
      closed_with      TEXT,
      external         TEXT,
      emailed_at       TEXT,
      email_note       TEXT,
      history          TEXT,
      UNIQUE (plan_id, item_uid)
    );
    CREATE INDEX IF NOT EXISTS idx_approval_tickets_status ON approval_tickets(status);
    CREATE INDEX IF NOT EXISTS idx_approval_tickets_user ON approval_tickets(assignee_user_id);

    CREATE TABLE IF NOT EXISTS approval_decisions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id      INTEGER NOT NULL REFERENCES approval_plans(id) ON DELETE CASCADE,
      stage        TEXT    NOT NULL DEFAULT 'first',
      approver_id  INTEGER,
      approver     TEXT,
      decision     TEXT    NOT NULL,
      reason_code  TEXT,
      comment      TEXT,
      payload_hash TEXT,
      plan_version INTEGER,
      decided_at   TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_approval_decisions_plan ON approval_decisions(plan_id);

    CREATE TABLE IF NOT EXISTS approval_verifications (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id      INTEGER NOT NULL REFERENCES approval_plans(id) ON DELETE CASCADE,
      kind         TEXT    NOT NULL,
      scan_id      INTEGER,
      result       TEXT    NOT NULL,
      performed_by TEXT,
      performed_at TEXT    NOT NULL,
      detail       TEXT,
      evidence     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_approval_verifications_plan ON approval_verifications(plan_id);

    CREATE TABLE IF NOT EXISTS approval_comments (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id    INTEGER NOT NULL REFERENCES approval_plans(id) ON DELETE CASCADE,
      item_uid   TEXT,
      visibility TEXT    NOT NULL DEFAULT 'internal',
      body       TEXT    NOT NULL,
      author_id  INTEGER,
      author     TEXT,
      created_at TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_approval_comments_plan ON approval_comments(plan_id);

    CREATE TABLE IF NOT EXISTS approval_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id     INTEGER NOT NULL REFERENCES approval_plans(id) ON DELETE CASCADE,
      item_uid    TEXT,
      action      TEXT    NOT NULL,
      actor_id    INTEGER,
      actor_name  TEXT,
      from_status TEXT,
      to_status   TEXT,
      reason      TEXT,
      payload     TEXT,
      ts          TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_approval_events_plan ON approval_events(plan_id, id);
    -- Append only. Nothing updates a row, and a row goes only when its whole
    -- plan goes (an organization being removed): by then the plan row is
    -- already gone, which is the one case the delete trigger lets through.
    CREATE TRIGGER IF NOT EXISTS approval_events_no_update
      BEFORE UPDATE ON approval_events
      BEGIN SELECT RAISE(ABORT, 'approval_events is append only'); END;
    CREATE TRIGGER IF NOT EXISTS approval_events_no_delete
      BEFORE DELETE ON approval_events
      WHEN EXISTS (SELECT 1 FROM approval_plans WHERE id = OLD.plan_id)
      BEGIN SELECT RAISE(ABORT, 'approval_events is append only'); END;

    CREATE TABLE IF NOT EXISTS approval_sla (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id      INTEGER NOT NULL REFERENCES approval_plans(id) ON DELETE CASCADE,
      clock        TEXT    NOT NULL,
      started_at   TEXT    NOT NULL,
      target_at    TEXT,
      paused_since TEXT,
      paused_ms    INTEGER NOT NULL DEFAULT 0,
      warned_at    TEXT,
      breached_at  TEXT,
      escalated_at TEXT,
      status       TEXT    NOT NULL DEFAULT 'running',
      met_at       TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_approval_sla_plan ON approval_sla(plan_id, clock);
    CREATE INDEX IF NOT EXISTS idx_approval_sla_status ON approval_sla(status);

    CREATE TABLE IF NOT EXISTS approval_notifications (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      event             TEXT    NOT NULL,
      plan_id           INTEGER REFERENCES approval_plans(id) ON DELETE CASCADE,
      recipient_user_id INTEGER,
      recipient_email   TEXT,
      channel           TEXT    NOT NULL DEFAULT 'inapp',
      subject           TEXT,
      body              TEXT,
      status            TEXT    NOT NULL DEFAULT 'queued',
      attempts          INTEGER NOT NULL DEFAULT 0,
      last_error        TEXT,
      dedupe_key        TEXT    UNIQUE,
      created_at        TEXT    NOT NULL,
      sent_at           TEXT,
      read_at           TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_approval_notifications_user
      ON approval_notifications(recipient_user_id, read_at);
    CREATE INDEX IF NOT EXISTS idx_approval_notifications_status ON approval_notifications(status);

    CREATE TABLE IF NOT EXISTS approval_exceptions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id        INTEGER,
      tenant_id     INTEGER,
      rack_id       TEXT,
      item_type     TEXT,
      item_name     TEXT,
      attribute     TEXT,
      kind          TEXT    NOT NULL DEFAULT 'known_exception',
      justification TEXT,
      owner_id      INTEGER,
      starts_at     TEXT,
      expires_at    TEXT,
      review_at     TEXT,
      approved_by   INTEGER,
      created_at    TEXT    NOT NULL,
      revoked_at    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_approval_exceptions_org ON approval_exceptions(org_id, revoked_at);

    CREATE TABLE IF NOT EXISTS approval_windows (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id     INTEGER,
      tenant_id  INTEGER,
      starts_at  TEXT    NOT NULL,
      ends_at    TEXT    NOT NULL,
      note       TEXT,
      created_by INTEGER,
      created_at TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_approval_windows_tenant ON approval_windows(tenant_id, starts_at);

    CREATE TABLE IF NOT EXISTS approval_settings (
      org_id     INTEGER NOT NULL,
      key        TEXT    NOT NULL,
      value      TEXT,
      updated_by INTEGER,
      updated_at TEXT    NOT NULL,
      PRIMARY KEY (org_id, key)
    );

    CREATE TABLE IF NOT EXISTS approval_overrides (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id       INTEGER NOT NULL REFERENCES approval_plans(id) ON DELETE CASCADE,
      item_uid      TEXT,
      kind          TEXT    NOT NULL,
      netbox_id     INTEGER,
      record_name   TEXT,
      fields        TEXT    NOT NULL,
      shown         TEXT,
      source        TEXT    NOT NULL,
      suggestion_id TEXT,
      rule          TEXT,
      note          TEXT,
      created_by    TEXT,
      created_by_id INTEGER,
      created_at    TEXT    NOT NULL,
      revoked_at    TEXT,
      revoked_by    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_approval_overrides_plan ON approval_overrides(plan_id, revoked_at);
  `);
  // Columns added after a table first shipped go here, one line each, so an
  // older database catches up on the next boot.
  _ensureColumn('approval_plans', 'legacy_id', 'legacy_id INTEGER');
  _ensureColumn('approval_items', 'extra', 'extra TEXT');
  _ensureColumn('approval_tickets', 'history', 'history TEXT');
  // A check goes to one person as a whole. spoc_user_id is who it is with, and
  // a plan that has one is on the SPOC flow; `spoc` is the same person in
  // full, with who held it before. needs_admin says why a sent check is
  // waiting for an admin instead, and `incident` is its one ServiceNow incident.
  _ensureColumn('approval_plans', 'spoc_user_id', 'spoc_user_id INTEGER');
  _ensureColumn('approval_plans', 'spoc', 'spoc TEXT');
  _ensureColumn('approval_plans', 'needs_admin', 'needs_admin TEXT');
  _ensureColumn('approval_plans', 'incident', 'incident TEXT');
  _ensureColumn('approval_plans', 'written_by_id', 'written_by_id INTEGER');
  _ensureColumn('approval_plans', 'findings', 'findings TEXT');
  _ensureColumn('approval_plans', 'evidence', 'evidence TEXT');
  _ensureColumn('approval_plans', 'suggestion_state', 'suggestion_state TEXT');
  // The fingerprint a check was FILED with. A change a person makes re-plans
  // the check and signs a new one, and this is what still says "the same drift"
  // to the phone that compares the rack again without that change.
  _ensureColumn('approval_plans', 'base_fingerprint', 'base_fingerprint TEXT');
  // What a notice is about, as fields a screen can read without parsing words.
  _ensureColumn('approval_notifications', 'data', 'data TEXT');
  handle().exec('CREATE INDEX IF NOT EXISTS idx_approval_plans_spoc ON approval_plans(spoc_user_id, status)');
  _ready = true;
}

function db() { _prep(); return handle(); }

/**
 * Run `fn` in one transaction on the shared handle. Nested calls join it.
 *
 * IMMEDIATE, not the default deferred. A deferred transaction takes the write
 * lock only when it first writes, and almost every transaction here reads
 * before it writes - load the items, then decide, then update. SQLite answers
 * SQLITE_BUSY straight away when a deferred transaction tries to upgrade while
 * somebody else holds the write lock, and it does NOT wait for the busy
 * timeout, because waiting could deadlock two transactions that each hold a
 * read. So the request fails with "database is locked" the moment two writes
 * overlap - which is exactly what happened the first time two of these ran at
 * once. Taking the write lock up front makes the busy timeout apply, so the
 * second one waits its turn and then goes through.
 */
function tx(fn) {
  const d = db();
  if (d.inTransaction) return fn();
  return d.transaction(fn).immediate();
}

// -- Row mapping ------------------------------------------------------
const parse = (v, fallback = null) => {
  if (v == null || v === '') return fallback;
  try { return JSON.parse(v); } catch { return fallback; }
};
const json = (v) => (v === undefined || v === null ? null : JSON.stringify(v));
const bool = (v) => Boolean(v);
const flag = (v) => (v ? 1 : 0);

function planOf(r, { heavy = true } = {}) {
  if (!r) return null;
  const out = {
    id: r.id, orgId: r.org_id, tenantId: r.tenant_id, scanId: r.scan_id,
    rackId: r.rack_id, rackUid: r.rack_uid, rackName: r.rack_name, netboxUrl: r.netbox_url,
    status: r.status, disposition: r.disposition, category: r.category,
    priority: r.priority, risk: r.risk,
    fingerprint: r.fingerprint, payloadHash: r.payload_hash, version: r.version,
    counts: parse(r.counts, {}), warnings: parse(r.warnings, []), orphans: parse(r.orphans, []),
    customField: r.custom_field,
    createdBy: r.created_by, createdById: r.created_by_id, createdAt: r.created_at,
    submittedAt: r.submitted_at, submittedBy: r.submitted_by, submittedById: r.submitted_by_id,
    submittedNote: r.submitted_note,
    triagedAt: r.triaged_at, triagedBy: r.triaged_by, triageNote: r.triage_note,
    pendingReason: r.pending_reason,
    reopenCount: r.reopen_count, reopenReason: r.reopen_reason,
    parentPlanId: r.parent_plan_id, duplicateOf: r.duplicate_of,
    exceptionId: r.exception_id, windowId: r.window_id,
    verification: parse(r.verification), result: parse(r.result),
    writtenAt: r.written_at, writtenBy: r.written_by, writtenById: r.written_by_id ?? null,
    completedAt: r.completed_at, cancelledAt: r.cancelled_at, cancelReason: r.cancel_reason,
    updatedAt: r.updated_at, legacyId: r.legacy_id,
    spocUserId: r.spoc_user_id ?? null, spoc: parse(r.spoc), needsAdmin: parse(r.needs_admin),
    incident: parse(r.incident), suggestionState: parse(r.suggestion_state, {}),
    baseFingerprint: r.base_fingerprint ?? null,
    findings: [], evidence: null,
  };
  if (heavy) {
    out.preSnapshot = parse(r.pre_snapshot);
    out.postSnapshot = parse(r.post_snapshot);
    out.findings = parse(r.findings, []);
    out.evidence = parse(r.evidence);
  }
  return out;
}

// Whatever the comparison put on a row that the table has no column for
// (fromUid on a rebind, a future `binding` object) is kept in `extra` and
// merged back here, under the known fields, so it passes through unchanged.
const itemOf = (r) => r && ({
  ...parse(r.extra, {}),
  id: r.id, planId: r.plan_id, uid: r.uid, type: r.type, name: r.name, action: r.action,
  netboxId: r.netbox_id, diff: parse(r.diff), reason: r.reason,
  supporting: bool(r.supporting), decidable: bool(r.decidable),
  decision: r.decision, decidedBy: r.decided_by, decidedById: r.decided_by_id,
  decidedAt: r.decided_at, note: r.note, reasonCode: r.reason_code,
  parentUid: r.parent_uid, following: bool(r.following), exceptionId: r.exception_id,
});

const ticketOf = (r) => r && ({
  id: r.id, planId: r.plan_id, itemUid: r.item_uid,
  assignee: r.assignee, assigneeId: r.assignee_id, assigneeEmail: r.assignee_email,
  assigneeUserId: r.assignee_user_id, spoc: parse(r.spoc),
  raisedBy: r.raised_by, raisedById: r.raised_by_id, raisedAt: r.raised_at,
  status: r.status, pendingReason: r.pending_reason, pendingSince: r.pending_since,
  acceptedAt: r.accepted_at, question: r.question, finding: r.finding,
  disposition: r.disposition, outcome: r.outcome, scope: r.scope,
  resolvedBy: r.resolved_by, resolvedById: r.resolved_by_id, resolvedAt: r.resolved_at,
  closedBy: r.closed_by, closedAt: r.closed_at, closedWith: r.closed_with,
  external: parse(r.external), emailedAt: r.emailed_at, emailNote: r.email_note,
  // Earlier rounds on the same item, oldest first: assigning an item again
  // starts a fresh ticket, and what the last person found is kept here.
  history: parse(r.history, []),
});

const decisionOf = (r) => r && ({
  id: r.id, planId: r.plan_id, stage: r.stage, approverId: r.approver_id, approver: r.approver,
  decision: r.decision, reasonCode: r.reason_code, comment: r.comment,
  payloadHash: r.payload_hash, planVersion: r.plan_version, decidedAt: r.decided_at,
});

const verificationOf = (r) => r && ({
  id: r.id, planId: r.plan_id, kind: r.kind, scanId: r.scan_id, result: r.result,
  performedBy: r.performed_by, performedAt: r.performed_at,
  detail: parse(r.detail), evidence: parse(r.evidence),
});

const commentOf = (r) => r && ({
  id: r.id, planId: r.plan_id, itemUid: r.item_uid, visibility: r.visibility, body: r.body,
  authorId: r.author_id, author: r.author, createdAt: r.created_at,
});

const eventOf = (r) => r && ({
  id: r.id, planId: r.plan_id, itemUid: r.item_uid, action: r.action,
  actorId: r.actor_id, actorName: r.actor_name,
  fromStatus: r.from_status, toStatus: r.to_status, reason: r.reason,
  payload: parse(r.payload), ts: r.ts,
});

const slaOfRow = (r) => r && ({
  id: r.id, planId: r.plan_id, clock: r.clock, startedAt: r.started_at, targetAt: r.target_at,
  pausedSince: r.paused_since, pausedMs: r.paused_ms, warnedAt: r.warned_at,
  breachedAt: r.breached_at, escalatedAt: r.escalated_at, status: r.status, metAt: r.met_at,
});

const notificationOf = (r) => r && ({
  id: r.id, event: r.event, planId: r.plan_id, recipientUserId: r.recipient_user_id,
  recipientEmail: r.recipient_email, channel: r.channel, subject: r.subject, body: r.body,
  status: r.status, attempts: r.attempts, lastError: r.last_error, dedupeKey: r.dedupe_key,
  createdAt: r.created_at, sentAt: r.sent_at, readAt: r.read_at, data: parse(r.data),
});

const exceptionOf = (r) => r && ({
  id: r.id, orgId: r.org_id, tenantId: r.tenant_id, rackId: r.rack_id,
  itemType: r.item_type, itemName: r.item_name, attribute: r.attribute, kind: r.kind,
  justification: r.justification, ownerId: r.owner_id, startsAt: r.starts_at,
  expiresAt: r.expires_at, reviewAt: r.review_at, approvedBy: r.approved_by,
  createdAt: r.created_at, revokedAt: r.revoked_at,
});

const windowOf = (r) => r && ({
  id: r.id, orgId: r.org_id, tenantId: r.tenant_id, startsAt: r.starts_at, endsAt: r.ends_at,
  note: r.note, createdBy: r.created_by, createdAt: r.created_at,
});

const overrideOf = (r) => r && ({
  id: r.id, planId: r.plan_id, itemUid: r.item_uid, kind: r.kind, netboxId: r.netbox_id,
  recordName: r.record_name, fields: parse(r.fields, {}), shown: parse(r.shown),
  source: r.source, suggestionId: r.suggestion_id, rule: r.rule, note: r.note,
  createdBy: r.created_by, createdById: r.created_by_id, createdAt: r.created_at,
  revokedAt: r.revoked_at, revokedBy: r.revoked_by,
});

// camelCase field -> column, and which columns hold JSON or a 0/1 flag. One
// table each, so an update can take the same names a read hands back.
const PLAN_COLS = {
  orgId: 'org_id', tenantId: 'tenant_id', scanId: 'scan_id', rackId: 'rack_id',
  rackUid: 'rack_uid', rackName: 'rack_name', netboxUrl: 'netbox_url', status: 'status',
  disposition: 'disposition', category: 'category', priority: 'priority', risk: 'risk',
  fingerprint: 'fingerprint', payloadHash: 'payload_hash', counts: 'counts',
  warnings: 'warnings', orphans: 'orphans', customField: 'custom_field',
  createdBy: 'created_by', createdById: 'created_by_id', createdAt: 'created_at',
  submittedAt: 'submitted_at', submittedBy: 'submitted_by', submittedById: 'submitted_by_id',
  submittedNote: 'submitted_note', triagedAt: 'triaged_at', triagedBy: 'triaged_by',
  triageNote: 'triage_note', pendingReason: 'pending_reason', reopenCount: 'reopen_count',
  reopenReason: 'reopen_reason', parentPlanId: 'parent_plan_id', duplicateOf: 'duplicate_of',
  exceptionId: 'exception_id', windowId: 'window_id', verification: 'verification',
  result: 'result', preSnapshot: 'pre_snapshot', postSnapshot: 'post_snapshot',
  writtenAt: 'written_at', writtenBy: 'written_by', completedAt: 'completed_at',
  cancelledAt: 'cancelled_at', cancelReason: 'cancel_reason', legacyId: 'legacy_id',
  spocUserId: 'spoc_user_id', spoc: 'spoc', needsAdmin: 'needs_admin', incident: 'incident',
  writtenById: 'written_by_id', findings: 'findings', evidence: 'evidence',
  suggestionState: 'suggestion_state',
  baseFingerprint: 'base_fingerprint',
};
const PLAN_JSON = new Set(['counts', 'warnings', 'orphans', 'verification', 'result',
  'preSnapshot', 'postSnapshot', 'spoc', 'needsAdmin', 'incident', 'findings', 'evidence',
  'suggestionState']);

const ITEM_COLS = {
  type: 'type', name: 'name', action: 'action', netboxId: 'netbox_id', diff: 'diff',
  reason: 'reason', supporting: 'supporting', decidable: 'decidable', decision: 'decision',
  decidedBy: 'decided_by', decidedById: 'decided_by_id', decidedAt: 'decided_at', note: 'note',
  reasonCode: 'reason_code', parentUid: 'parent_uid', following: 'following',
  exceptionId: 'exception_id', extra: 'extra',
};
const ITEM_JSON = new Set(['diff', 'extra']);
const ITEM_FLAGS = new Set(['supporting', 'decidable', 'following']);

const TICKET_COLS = {
  assignee: 'assignee', assigneeId: 'assignee_id', assigneeEmail: 'assignee_email',
  assigneeUserId: 'assignee_user_id', spoc: 'spoc', raisedBy: 'raised_by',
  raisedById: 'raised_by_id', raisedAt: 'raised_at', status: 'status',
  pendingReason: 'pending_reason', pendingSince: 'pending_since', acceptedAt: 'accepted_at',
  question: 'question', finding: 'finding', disposition: 'disposition', outcome: 'outcome',
  scope: 'scope', resolvedBy: 'resolved_by', resolvedById: 'resolved_by_id',
  resolvedAt: 'resolved_at', closedBy: 'closed_by', closedAt: 'closed_at',
  closedWith: 'closed_with', external: 'external', emailedAt: 'emailed_at',
  emailNote: 'email_note', history: 'history',
};
const TICKET_JSON = new Set(['spoc', 'external', 'history']);

const SLA_COLS = {
  clock: 'clock', startedAt: 'started_at', targetAt: 'target_at', pausedSince: 'paused_since',
  pausedMs: 'paused_ms', warnedAt: 'warned_at', breachedAt: 'breached_at',
  escalatedAt: 'escalated_at', status: 'status', metAt: 'met_at',
};

const NOTIFICATION_COLS = {
  status: 'status', attempts: 'attempts', lastError: 'last_error', sentAt: 'sent_at',
  readAt: 'read_at', subject: 'subject', body: 'body',
};

/** { sets: 'a = @a, b = @b', params } for the known fields of `patch`. */
function setsFor(patch, cols, jsonCols = new Set(), flagCols = new Set()) {
  const sets = [];
  const params = {};
  for (const [key, value] of Object.entries(patch || {})) {
    const col = cols[key];
    if (!col || value === undefined) continue;
    sets.push(`${col} = @${col}`);
    params[col] = jsonCols.has(key) ? json(value) : flagCols.has(key) ? flag(value) : value;
  }
  return { sets, params };
}

// -- Plans ------------------------------------------------------------
/** Version + 1 and updated_at = now. Every write to a plan ends here. */
function touchPlan(id) {
  db().prepare('UPDATE approval_plans SET version = version + 1, updated_at = ? WHERE id = ?')
    .run(nowIso(), Number(id));
}

/**
 * File a plan with its items, in one transaction. `fields` takes the names a
 * read hands back; `items` are rows shaped by shape.toItem(). `id` may be
 * given (the migration keeps a JSON plan's number when it is free).
 */
function insertPlan(fields, items = []) {
  return tx(() => {
    const now = nowIso();
    const row = { createdAt: now, status: 'draft', ...fields };
    const cols = ['updated_at'];
    const params = { updated_at: row.updatedAt || row.createdAt || now };
    if (row.id != null) { cols.push('id'); params.id = Number(row.id); }
    if (row.version != null) { cols.push('version'); params.version = Number(row.version); }
    for (const [key, col] of Object.entries(PLAN_COLS)) {
      if (row[key] === undefined) continue;
      cols.push(col);
      params[col] = PLAN_JSON.has(key) ? json(row[key]) : row[key];
    }
    const info = db().prepare(
      `INSERT INTO approval_plans (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`,
    ).run(params);
    const planId = Number(params.id ?? info.lastInsertRowid);
    for (const item of items) insertItem(planId, item);
    return getPlan(planId);
  });
}

function getPlan(id, opts) {
  const n = Number(id);
  if (!Number.isInteger(n)) return null;
  return planOf(db().prepare('SELECT * FROM approval_plans WHERE id = ?').get(n), opts);
}

const getPlanByLegacyId = (legacyId) => planOf(
  db().prepare('SELECT * FROM approval_plans WHERE legacy_id = ?').get(Number(legacyId)));

/** Change fields on a plan. Bumps version and updated_at, always. */
function updatePlan(id, patch) {
  const { sets, params } = setsFor(patch, PLAN_COLS, PLAN_JSON);
  sets.push('version = version + 1', 'updated_at = @updated_at');
  params.updated_at = nowIso();
  params.id = Number(id);
  db().prepare(`UPDATE approval_plans SET ${sets.join(', ')} WHERE id = @id`).run(params);
  return getPlan(id);
}

/**
 * The WHERE clause every list shares. Filters, all optional:
 *   seenBy ({ orgId, userId, username }: the visibility rule, below),
 *   orgId (undefined = no scoping, null = the unowned rows), tenantId, scanId,
 *   rackId, status (one, a comma list or an array), priority, risk, createdBy,
 *   assignee (a name, an email, or a user id), assigneeUserId, spocUserId (who
 *   the check is with), since, until (on created_at), sla (a clock state), q
 *   (free text), ids, and visibleTo ({ role, username, userId, tenantId }:
 *   what that person may read).
 */
function planWhere(f = {}) {
  const where = [];
  const params = {};
  const list = (v) => (Array.isArray(v) ? v : String(v).split(',')).map((s) => String(s).trim()).filter(Boolean);
  const inList = (col, name, values) => {
    const keys = values.map((v, i) => { params[`${name}${i}`] = v; return `@${name}${i}`; });
    where.push(`${col} IN (${keys.join(', ')})`);
  };
  if (f.orgId !== undefined) {
    if (f.orgId === null) where.push('p.org_id IS NULL');
    else { where.push('p.org_id = @orgId'); params.orgId = Number(f.orgId); }
  }
  // THE VISIBILITY RULE, as SQL. `seenBy` is { orgId, userId, username }, the
  // caller. A plan belongs to the organisation that raised it and only that
  // organisation sees it - no owner bypass. A plan raised by an account that
  // has no organisation belongs to that ACCOUNT, and only that account sees
  // it: two people who both happen to have no organisation are still two
  // people. The absence of an organisation is never itself a key.
  //
  // This is the same test the read applies (service.canSee), written once for
  // the SQL side, so a row that cannot be opened is never listed. A list that
  // said more than the read was exactly the defect this closes: the owner was
  // shown four plans and could open none of them.
  if (f.seenBy) {
    const v = f.seenBy;
    where.push(`((p.org_id IS NOT NULL AND p.org_id = @seenOrgId)
      OR (p.org_id IS NULL AND (p.created_by_id = @seenUserId
                                OR (p.created_by IS NOT NULL AND p.created_by = @seenUsername))))`);
    params.seenOrgId = v.orgId == null ? -1 : Number(v.orgId);
    params.seenUserId = v.userId == null ? -1 : Number(v.userId);
    params.seenUsername = v.username == null ? '\u0000' : String(v.username);
  }
  if (f.tenantId != null && f.tenantId !== '') { where.push('p.tenant_id = @tenantId'); params.tenantId = Number(f.tenantId); }
  if (f.scanId != null && f.scanId !== '') { where.push('p.scan_id = @scanId'); params.scanId = Number(f.scanId); }
  if (f.rackId != null && f.rackId !== '') { where.push('p.rack_id = @rackId'); params.rackId = String(f.rackId); }
  if (f.status != null && f.status !== '') { const v = list(f.status); if (v.length) inList('p.status', 'st', v); }
  if (f.priority != null && f.priority !== '') { const v = list(f.priority); if (v.length) inList('p.priority', 'pr', v); }
  if (f.risk != null && f.risk !== '') { const v = list(f.risk); if (v.length) inList('p.risk', 'rk', v); }
  if (f.ids) { const v = f.ids.map(Number); if (v.length) inList('p.id', 'id', v); else where.push('0'); }
  if (f.createdBy != null && f.createdBy !== '') { where.push('p.created_by = @createdBy'); params.createdBy = String(f.createdBy); }
  if (f.assigneeUserId != null && f.assigneeUserId !== '') {
    where.push('EXISTS (SELECT 1 FROM approval_tickets t WHERE t.plan_id = p.id AND t.assignee_user_id = @assigneeUserId)');
    params.assigneeUserId = Number(f.assigneeUserId);
  }
  if (f.spocUserId != null && f.spocUserId !== '') {
    where.push('p.spoc_user_id = @spocUserId');
    params.spocUserId = Number(f.spocUserId);
  }
  if (f.assignee != null && f.assignee !== '') {
    where.push(`EXISTS (SELECT 1 FROM approval_tickets t WHERE t.plan_id = p.id
      AND (t.assignee = @assignee OR lower(t.assignee_email) = lower(@assignee)
           OR CAST(t.assignee_user_id AS TEXT) = @assignee))`);
    params.assignee = String(f.assignee);
  }
  // What a technician or a site manager may read: what they raised, what is
  // with them as its SPOC, what is assigned to them, and for their own Site -
  // everything (a site manager) or what is waiting for a verification scan (a
  // technician).
  if (f.visibleTo) {
    const v = f.visibleTo;
    const mine = ['p.created_by = @vUsername', 'p.spoc_user_id = @vUserId',
      'EXISTS (SELECT 1 FROM approval_tickets t WHERE t.plan_id = p.id AND t.assignee_user_id = @vUserId)'];
    if (v.role === 'site_manager') mine.push('p.tenant_id = @vTenantId');
    else mine.push("(p.tenant_id = @vTenantId AND p.status = 'verification_pending')");
    where.push(`(${mine.join(' OR ')})`);
    params.vUsername = String(v.username ?? '');
    params.vUserId = Number(v.userId ?? -1);
    params.vTenantId = Number(v.tenantId ?? -1);
  }
  if (f.since) { where.push('p.created_at >= @since'); params.since = String(f.since); }
  if (f.until) { where.push('p.created_at <= @until'); params.until = String(f.until); }
  if (f.sla) {
    // One of the five words a screen shows, or - for a caller that knows the
    // rows - a raw clock status. The tile and the list it opens agree because
    // they are the same expression.
    const word = String(f.sla);
    if (SLA_SQL[word]) where.push(`(${SLA_SQL[word]})`);
    else {
      where.push('EXISTS (SELECT 1 FROM approval_sla s WHERE s.plan_id = p.id AND s.status = @sla)');
      params.sla = word;
    }
  }
  if (f.q != null && String(f.q).trim() !== '') {
    where.push(`(p.rack_id LIKE @q OR p.rack_name LIKE @q OR p.created_by LIKE @q
      OR p.submitted_note LIKE @q OR CAST(p.id AS TEXT) = @qExact
      OR EXISTS (SELECT 1 FROM approval_items i WHERE i.plan_id = p.id AND i.name LIKE @q))`);
    params.q = `%${String(f.q).trim()}%`;
    params.qExact = String(f.q).trim();
  }
  return { where, params };
}

/**
 * The SLA state of a plan, as the five words a screen shows, in the order one
 * beats another: a plan is in exactly one of them, so a row of tiles adds up
 * to the list it filters.
 *
 *   breached   a clock has run out
 *   at_risk    a clock has passed its warning mark and has not run out
 *   paused     a clock is on hold (the plan is waiting on somebody else)
 *   on_track   a clock is running and has not been warned about
 *   none       no clock is running: not started, finished, or cancelled
 *
 * The rows themselves are sla.js's; this only reads them.
 */
const SLA_STATES = ['breached', 'at_risk', 'paused', 'on_track', 'none'];
const HAS = (cond) => `EXISTS (SELECT 1 FROM approval_sla s WHERE s.plan_id = p.id AND ${cond})`;
const SLA_SQL = {
  breached: HAS("s.status = 'breached'"),
  at_risk: `${HAS("s.status = 'running' AND s.warned_at IS NOT NULL")} AND NOT ${SLA_BREACHED()}`,
  paused: `${HAS("s.status = 'paused'")} AND NOT ${SLA_BREACHED()} AND NOT ${SLA_AT_RISK()}`,
  on_track: `${HAS("s.status = 'running' AND s.warned_at IS NULL")} AND NOT ${SLA_BREACHED()}`
    + ` AND NOT ${SLA_AT_RISK()} AND NOT ${HAS("s.status = 'paused'")}`,
  none: `NOT ${HAS("s.status IN ('running', 'paused', 'breached')")}`,
};
function SLA_BREACHED() { return HAS("s.status = 'breached'"); }
function SLA_AT_RISK() { return HAS("s.status = 'running' AND s.warned_at IS NOT NULL"); }

/** The CASE that names each plan's one SLA state, for a grouped count. */
const SLA_CASE = `CASE
  WHEN ${SLA_SQL.breached} THEN 'breached'
  WHEN ${SLA_SQL.at_risk} THEN 'at_risk'
  WHEN ${SLA_SQL.paused} THEN 'paused'
  WHEN ${SLA_SQL.on_track} THEN 'on_track'
  ELSE 'none' END`;

/** The same five words from clock rows already in hand, for one plan. */
function slaStateOf(clocks) {
  const rows = clocks || [];
  if (rows.some((c) => c.status === 'breached')) return 'breached';
  if (rows.some((c) => c.status === 'running' && c.warnedAt)) return 'at_risk';
  if (rows.some((c) => c.status === 'paused')) return 'paused';
  if (rows.some((c) => c.status === 'running')) return 'on_track';
  return 'none';
}

/** Plans, newest first. `cursor` is the id the last page ended on. */
function listPlans(filters = {}) {
  const { where, params } = planWhere(filters);
  if (filters.cursor != null && filters.cursor !== '') {
    where.push('p.id < @cursor');
    params.cursor = Number(filters.cursor);
  }
  params.limit = Math.min(Math.max(1, Number(filters.limit) || 50), 500);
  const rows = db().prepare(`
    SELECT p.* FROM approval_plans p
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY p.id DESC LIMIT @limit
  `).all(params);
  return rows.map((r) => planOf(r, { heavy: false }));
}

/** How many plans per value of one column (status, priority or risk). */
function countPlansBy(column, filters = {}) {
  const col = { status: 'p.status', priority: 'p.priority', risk: 'p.risk' }[column];
  if (!col) throw new Error(`cannot count plans by ${column}`);
  const { where, params } = planWhere(filters);
  return db().prepare(`
    SELECT ${col} AS key, COUNT(*) AS count FROM approval_plans p
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    GROUP BY ${col}
  `).all(params);
}

/** How many plans have a clock in each SLA state. */
function countPlansBySla(filters = {}) {
  const { where, params } = planWhere(filters);
  return db().prepare(`
    SELECT s.status AS key, COUNT(DISTINCT p.id) AS count
    FROM approval_sla s JOIN approval_plans p ON p.id = s.plan_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    GROUP BY s.status
  `).all(params);
}

/** How many plans are in each of the five SLA states. */
function countPlansBySlaState(filters = {}) {
  const { where, params } = planWhere(filters);
  const rows = db().prepare(`
    SELECT ${SLA_CASE} AS key, COUNT(*) AS count FROM approval_plans p
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    GROUP BY key
  `).all(params);
  return rows;
}

/**
 * The transitions across plans, newest first: the auditor's view.
 *
 * Scoped by the same plan filters as every list, so a person reads the history
 * of exactly the plans they could open, and no others. Filters of its own:
 * planId, action, actorId, since, until, plus limit and cursor.
 */
function listEvents(filters = {}) {
  const { where, params } = planWhere(filters);
  const eq = (key, col, cast = String) => {
    if (filters[key] == null || filters[key] === '') return;
    where.push(`e.${col} = @${key}`);
    params[key] = cast(filters[key]);
  };
  eq('planId', 'plan_id', Number);
  eq('action', 'action');
  eq('actorId', 'actor_id', Number);
  eq('itemUid', 'item_uid');
  if (filters.since) { where.push('e.ts >= @since'); params.since = String(filters.since); }
  if (filters.until) { where.push('e.ts <= @until'); params.until = String(filters.until); }
  if (filters.cursor != null && filters.cursor !== '') {
    where.push('e.id < @cursor');
    params.cursor = Number(filters.cursor);
  }
  params.limit = Math.min(Math.max(1, Number(filters.limit) || 100), 500);
  return db().prepare(`
    SELECT e.*, p.rack_id AS p_rack_id, p.rack_name AS p_rack_name
    FROM approval_events e JOIN approval_plans p ON p.id = e.plan_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY e.id DESC LIMIT @limit
  `).all(params).map((r) => ({
    ...eventOf(r), rackId: r.p_rack_id, rackName: r.p_rack_name,
    actor: { id: r.actor_id, username: r.actor_name },
  }));
}

// -- Items ------------------------------------------------------------
function insertItem(planId, item) {
  db().prepare(`
    INSERT INTO approval_items (plan_id, uid, type, name, action, netbox_id, diff, reason,
      supporting, decidable, decision, decided_by, decided_by_id, decided_at, note,
      reason_code, parent_uid, following, exception_id, extra)
    VALUES (@plan_id, @uid, @type, @name, @action, @netbox_id, @diff, @reason,
      @supporting, @decidable, @decision, @decided_by, @decided_by_id, @decided_at, @note,
      @reason_code, @parent_uid, @following, @exception_id, @extra)
  `).run({
    plan_id: Number(planId), uid: String(item.uid), type: item.type ?? null,
    name: item.name ?? null, action: item.action ?? null, netbox_id: item.netboxId ?? null,
    diff: json(item.diff), reason: item.reason ?? null,
    supporting: flag(item.supporting), decidable: flag(item.decidable),
    decision: item.decision || 'pending', decided_by: item.decidedBy ?? null,
    decided_by_id: item.decidedById ?? null, decided_at: item.decidedAt ?? null,
    note: item.note ?? null, reason_code: item.reasonCode ?? null,
    parent_uid: item.parentUid ?? null, following: flag(item.following),
    exception_id: item.exceptionId ?? null,
    extra: item.extra && Object.keys(item.extra).length ? json(item.extra) : null,
  });
}

const itemsOf = (planId) => db()
  .prepare('SELECT * FROM approval_items WHERE plan_id = ? ORDER BY id').all(Number(planId)).map(itemOf);

const getItem = (planId, uid) => itemOf(db()
  .prepare('SELECT * FROM approval_items WHERE plan_id = ? AND uid = ?').get(Number(planId), String(uid)));

/** Change fields on one item. `touch: false` when the caller bumps the plan once itself. */
function updateItem(planId, uid, patch, { touch = true } = {}) {
  const { sets, params } = setsFor(patch, ITEM_COLS, ITEM_JSON, ITEM_FLAGS);
  if (!sets.length) return getItem(planId, uid);
  params.plan_id = Number(planId);
  params.uid = String(uid);
  db().prepare(`UPDATE approval_items SET ${sets.join(', ')} WHERE plan_id = @plan_id AND uid = @uid`).run(params);
  if (touch) touchPlan(planId);
  return getItem(planId, uid);
}

/** What a suggestion is worked out from, without the rest of the heavy columns. */
function evidenceOf(planId) {
  const r = db().prepare('SELECT findings, evidence FROM approval_plans WHERE id = ?').get(Number(planId));
  return { findings: parse(r && r.findings, []), evidence: parse(r && r.evidence) };
}

/**
 * Swap a plan's items for a fresh comparison's, and patch the plan, in one
 * transaction. The caller has already carried over every decision that still
 * stands. Tickets, comments and events name an item by its uid and hold no
 * foreign key to it, so nothing else goes with the old rows.
 */
function replaceItems(planId, items, planPatch = {}) {
  return tx(() => {
    db().prepare('DELETE FROM approval_items WHERE plan_id = ?').run(Number(planId));
    for (const item of items || []) insertItem(planId, item);
    return updatePlan(planId, planPatch);
  });
}

// -- Overrides ----------------------------------------------------------
// What a person changed on a check before approving it: a record moved to the
// shelf the photo shows, a record marked offline, a value typed by hand. A row
// is never edited and never deleted; taking a change back stamps revoked_at.
function addOverride(planId, o, { touch = true } = {}) {
  const info = db().prepare(`
    INSERT INTO approval_overrides (plan_id, item_uid, kind, netbox_id, record_name, fields, shown,
      source, suggestion_id, rule, note, created_by, created_by_id, created_at)
    VALUES (@plan_id, @item_uid, @kind, @netbox_id, @record_name, @fields, @shown,
      @source, @suggestion_id, @rule, @note, @created_by, @created_by_id, @created_at)
  `).run({
    plan_id: Number(planId), item_uid: o.itemUid ?? null, kind: String(o.kind),
    netbox_id: o.netboxId ?? null, record_name: o.recordName ?? null,
    fields: json(o.fields || {}), shown: json(o.shown), source: o.source || 'manual',
    suggestion_id: o.suggestionId ?? null, rule: o.rule ?? null, note: o.note ?? null,
    created_by: o.createdBy ?? null, created_by_id: o.createdById ?? null,
    created_at: o.createdAt || nowIso(),
  });
  if (touch) touchPlan(planId);
  return getOverride(info.lastInsertRowid);
}

const getOverride = (id) => overrideOf(db()
  .prepare('SELECT * FROM approval_overrides WHERE id = ?').get(Number(id)));

/** A plan's overrides, oldest first. `active: false` includes the ones taken back. */
const overridesOf = (planId, { active = true } = {}) => db()
  .prepare(`SELECT * FROM approval_overrides WHERE plan_id = ?
    ${active ? 'AND revoked_at IS NULL' : ''} ORDER BY id`).all(Number(planId)).map(overrideOf);

function revokeOverride(id, by, { touch = true } = {}) {
  const row = getOverride(id);
  if (!row || row.revokedAt) return row;
  db().prepare('UPDATE approval_overrides SET revoked_at = ?, revoked_by = ? WHERE id = ?')
    .run(nowIso(), by ?? null, Number(id));
  if (touch) touchPlan(row.planId);
  return getOverride(id);
}

// -- Tickets ----------------------------------------------------------
const ticketsOf = (planId) => db()
  .prepare('SELECT * FROM approval_tickets WHERE plan_id = ? ORDER BY id').all(Number(planId)).map(ticketOf);

const getTicket = (planId, uid) => ticketOf(db()
  .prepare('SELECT * FROM approval_tickets WHERE plan_id = ? AND item_uid = ?').get(Number(planId), String(uid)));

/**
 * The ticket on one item: a fresh row, replacing any earlier one. An item has
 * one ticket at a time (unique on plan and item); assigning it again starts
 * over, and the earlier round stays in approval_events.
 */
function putTicket(planId, uid, fields, { touch = true } = {}) {
  return tx(() => {
    db().prepare('DELETE FROM approval_tickets WHERE plan_id = ? AND item_uid = ?').run(Number(planId), String(uid));
    const cols = ['plan_id', 'item_uid'];
    const params = { plan_id: Number(planId), item_uid: String(uid) };
    for (const [key, col] of Object.entries(TICKET_COLS)) {
      if (fields[key] === undefined) continue;
      cols.push(col);
      params[col] = TICKET_JSON.has(key) ? json(fields[key]) : fields[key];
    }
    db().prepare(
      `INSERT INTO approval_tickets (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`,
    ).run(params);
    if (touch) touchPlan(planId);
    return getTicket(planId, uid);
  });
}

function updateTicket(planId, uid, patch, { touch = true } = {}) {
  const { sets, params } = setsFor(patch, TICKET_COLS, TICKET_JSON);
  if (!sets.length) return getTicket(planId, uid);
  params.plan_id = Number(planId);
  params.item_uid = String(uid);
  db().prepare(`UPDATE approval_tickets SET ${sets.join(', ')} WHERE plan_id = @plan_id AND item_uid = @item_uid`).run(params);
  if (touch) touchPlan(planId);
  return getTicket(planId, uid);
}

/**
 * Tickets across plans, newest first, each with a little of its plan and its
 * item. Takes the plan filters plus ticketStatus (one, a list or an array).
 */
function listTickets(filters = {}) {
  const { where, params } = planWhere(filters);
  if (filters.ticketStatus != null && filters.ticketStatus !== '') {
    const values = (Array.isArray(filters.ticketStatus) ? filters.ticketStatus
      : String(filters.ticketStatus).split(',')).map((s) => String(s).trim()).filter(Boolean);
    if (values.length) {
      const keys = values.map((v, i) => { params[`ts${i}`] = v; return `@ts${i}`; });
      where.push(`t.status IN (${keys.join(', ')})`);
    }
  }
  if (filters.ticketAssigneeUserId != null) {
    where.push('t.assignee_user_id = @ticketAssigneeUserId');
    params.ticketAssigneeUserId = Number(filters.ticketAssigneeUserId);
  }
  if (filters.cursor != null && filters.cursor !== '') {
    where.push('t.id < @cursor');
    params.cursor = Number(filters.cursor);
  }
  params.limit = Math.min(Math.max(1, Number(filters.limit) || 100), 500);
  const rows = db().prepare(`
    SELECT t.*, p.org_id AS p_org_id, p.tenant_id AS p_tenant_id, p.rack_id AS p_rack_id,
           p.rack_name AS p_rack_name, p.status AS p_status, p.priority AS p_priority,
           p.risk AS p_risk, p.created_by AS p_created_by,
           i.type AS i_type, i.name AS i_name, i.action AS i_action
    FROM approval_tickets t
    JOIN approval_plans p ON p.id = t.plan_id
    LEFT JOIN approval_items i ON i.plan_id = t.plan_id AND i.uid = t.item_uid
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY t.id DESC LIMIT @limit
  `).all(params);
  return rows.map((r) => ({
    ...ticketOf(r),
    plan: { id: r.plan_id, orgId: r.p_org_id, tenantId: r.p_tenant_id, rackId: r.p_rack_id,
            rackName: r.p_rack_name, status: r.p_status, priority: r.p_priority, risk: r.p_risk,
            createdBy: r.p_created_by },
    item: { uid: r.item_uid, type: r.i_type, name: r.i_name, action: r.i_action },
  }));
}

/**
 * Every ticket still waiting on ServiceNow: not resolved here, and mirrored
 * there. A ticket that only carries a copy of its check's one incident
 * (planLevel) is left out: that incident is asked about once, for the check.
 */
function ticketsWaitingOnServiceNow() {
  return db().prepare(`
    SELECT t.*, p.org_id AS p_org_id FROM approval_tickets t
    JOIN approval_plans p ON p.id = t.plan_id
    WHERE t.status IN ('open', 'accepted', 'in_progress', 'pending')
      AND t.external IS NOT NULL AND json_extract(t.external, '$.sysId') IS NOT NULL
      AND json_extract(t.external, '$.planLevel') IS NOT 1
  `).all().map((r) => ({ ...ticketOf(r), orgId: r.p_org_id }));
}

// -- Decisions, verifications, comments, events -----------------------
function addDecision(planId, d, { touch = true } = {}) {
  const info = db().prepare(`
    INSERT INTO approval_decisions (plan_id, stage, approver_id, approver, decision, reason_code,
      comment, payload_hash, plan_version, decided_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(Number(planId), d.stage || 'first', d.approverId ?? null, d.approver ?? null, d.decision,
    d.reasonCode ?? null, d.comment ?? null, d.payloadHash ?? null, d.planVersion ?? null,
    d.decidedAt || nowIso());
  if (touch) touchPlan(planId);
  return decisionOf(db().prepare('SELECT * FROM approval_decisions WHERE id = ?').get(info.lastInsertRowid));
}
const decisionsOf = (planId) => db()
  .prepare('SELECT * FROM approval_decisions WHERE plan_id = ? ORDER BY id').all(Number(planId)).map(decisionOf);

function addVerification(planId, v) {
  const info = db().prepare(`
    INSERT INTO approval_verifications (plan_id, kind, scan_id, result, performed_by, performed_at, detail, evidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(Number(planId), v.kind, v.scanId ?? null, v.result, v.performedBy ?? null,
    v.performedAt || nowIso(), json(v.detail), json(v.evidence));
  return verificationOf(db().prepare('SELECT * FROM approval_verifications WHERE id = ?').get(info.lastInsertRowid));
}
const verificationsOf = (planId) => db()
  .prepare('SELECT * FROM approval_verifications WHERE plan_id = ? ORDER BY id').all(Number(planId)).map(verificationOf);

function addComment(planId, c) {
  const info = db().prepare(`
    INSERT INTO approval_comments (plan_id, item_uid, visibility, body, author_id, author, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(Number(planId), c.itemUid ?? null, c.visibility || 'internal', String(c.body),
    c.authorId ?? null, c.author ?? null, c.createdAt || nowIso());
  return commentOf(db().prepare('SELECT * FROM approval_comments WHERE id = ?').get(info.lastInsertRowid));
}
function commentsOf(planId, { visibility = null } = {}) {
  const rows = visibility
    ? db().prepare('SELECT * FROM approval_comments WHERE plan_id = ? AND visibility = ? ORDER BY id').all(Number(planId), visibility)
    : db().prepare('SELECT * FROM approval_comments WHERE plan_id = ? ORDER BY id').all(Number(planId));
  return rows.map(commentOf);
}

/** Append one event. There is no update and no delete; see the triggers. */
function addEvent(planId, e) {
  const info = db().prepare(`
    INSERT INTO approval_events (plan_id, item_uid, action, actor_id, actor_name, from_status,
      to_status, reason, payload, ts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(Number(planId), e.itemUid ?? null, String(e.action), e.actorId ?? null, e.actorName ?? null,
    e.fromStatus ?? null, e.toStatus ?? null, e.reason ?? null, json(e.payload), e.ts || nowIso());
  return Number(info.lastInsertRowid);
}
const eventsOf = (planId) => db()
  .prepare('SELECT * FROM approval_events WHERE plan_id = ? ORDER BY id').all(Number(planId)).map(eventOf);

// -- SLA clocks (the rules are sla.js; these are the rows) ----------------
function addSla(planId, c) {
  const info = db().prepare(`
    INSERT INTO approval_sla (plan_id, clock, started_at, target_at, paused_since, paused_ms, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(Number(planId), c.clock, c.startedAt || nowIso(), c.targetAt ?? null,
    c.pausedSince ?? null, c.pausedMs ?? 0, c.status || 'running');
  return slaOfRow(db().prepare('SELECT * FROM approval_sla WHERE id = ?').get(info.lastInsertRowid));
}
function updateSla(id, patch) {
  const { sets, params } = setsFor(patch, SLA_COLS);
  if (sets.length) {
    params.id = Number(id);
    db().prepare(`UPDATE approval_sla SET ${sets.join(', ')} WHERE id = @id`).run(params);
  }
  return slaOfRow(db().prepare('SELECT * FROM approval_sla WHERE id = ?').get(Number(id)));
}
const slaOf = (planId) => db()
  .prepare('SELECT * FROM approval_sla WHERE plan_id = ? ORDER BY id').all(Number(planId)).map(slaOfRow);
const slaByStatus = (status) => db()
  .prepare('SELECT * FROM approval_sla WHERE status = ? ORDER BY id').all(String(status)).map(slaOfRow);

// -- Notifications (the rules are notify.js) --------------------------
/** Queue one notification. A dedupe key seen before is skipped: null comes back. */
function addNotification(n) {
  const info = db().prepare(`
    INSERT OR IGNORE INTO approval_notifications (event, plan_id, recipient_user_id, recipient_email,
      channel, subject, body, status, dedupe_key, created_at, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(String(n.event), n.planId ?? null, n.recipientUserId ?? null, n.recipientEmail ?? null,
    n.channel || 'inapp', n.subject ?? null, n.body ?? null, n.status || 'queued',
    n.dedupeKey ?? null, n.createdAt || nowIso(), json(n.data));
  if (!info.changes) return null;
  return notificationOf(db().prepare('SELECT * FROM approval_notifications WHERE id = ?').get(info.lastInsertRowid));
}
function updateNotification(id, patch) {
  const { sets, params } = setsFor(patch, NOTIFICATION_COLS);
  if (sets.length) {
    params.id = Number(id);
    db().prepare(`UPDATE approval_notifications SET ${sets.join(', ')} WHERE id = @id`).run(params);
  }
  return notificationOf(db().prepare('SELECT * FROM approval_notifications WHERE id = ?').get(Number(id)));
}
function notificationsFor(userId, { channel = 'inapp', unreadOnly = false, limit = 100 } = {}) {
  return db().prepare(`
    SELECT * FROM approval_notifications
    WHERE recipient_user_id = ? AND channel = ? ${unreadOnly ? 'AND read_at IS NULL' : ''}
    ORDER BY id DESC LIMIT ?
  `).all(Number(userId), channel, Math.min(Math.max(1, Number(limit) || 100), 500)).map(notificationOf);
}
const notificationsByStatus = (status, limit = 100) => db()
  .prepare('SELECT * FROM approval_notifications WHERE status = ? ORDER BY id LIMIT ?')
  .all(String(status), Number(limit)).map(notificationOf);

// -- Exceptions and change windows (the rules are exceptions.js) ------
function addException(e) {
  const info = db().prepare(`
    INSERT INTO approval_exceptions (org_id, tenant_id, rack_id, item_type, item_name, attribute, kind,
      justification, owner_id, starts_at, expires_at, review_at, approved_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(e.orgId ?? null, e.tenantId ?? null, e.rackId ?? null, e.itemType ?? null, e.itemName ?? null,
    e.attribute ?? null, e.kind || 'known_exception', e.justification ?? null, e.ownerId ?? null,
    e.startsAt ?? null, e.expiresAt ?? null, e.reviewAt ?? null, e.approvedBy ?? null,
    e.createdAt || nowIso());
  return getException(info.lastInsertRowid);
}
const getException = (id) => exceptionOf(db()
  .prepare('SELECT * FROM approval_exceptions WHERE id = ?').get(Number(id)));
function listExceptions({ orgId, tenantId = null, includeRevoked = false } = {}) {
  return db().prepare(`
    SELECT * FROM approval_exceptions
    WHERE org_id IS @orgId ${tenantId != null ? 'AND tenant_id = @tenantId' : ''}
      ${includeRevoked ? '' : 'AND revoked_at IS NULL'}
    ORDER BY id DESC
  `).all({ orgId: orgId ?? null, ...(tenantId != null ? { tenantId: Number(tenantId) } : {}) }).map(exceptionOf);
}
function revokeException(id) {
  db().prepare('UPDATE approval_exceptions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
    .run(nowIso(), Number(id));
  return getException(id);
}

function addWindow(w) {
  const info = db().prepare(`
    INSERT INTO approval_windows (org_id, tenant_id, starts_at, ends_at, note, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(w.orgId ?? null, w.tenantId ?? null, w.startsAt, w.endsAt, w.note ?? null,
    w.createdBy ?? null, w.createdAt || nowIso());
  return getWindow(info.lastInsertRowid);
}
const getWindow = (id) => windowOf(db().prepare('SELECT * FROM approval_windows WHERE id = ?').get(Number(id)));
function listWindows({ orgId, tenantId = null } = {}) {
  return db().prepare(`
    SELECT * FROM approval_windows
    WHERE org_id IS @orgId ${tenantId != null ? 'AND tenant_id = @tenantId' : ''}
    ORDER BY starts_at DESC
  `).all({ orgId: orgId ?? null, ...(tenantId != null ? { tenantId: Number(tenantId) } : {}) }).map(windowOf);
}
const deleteWindow = (id) => db().prepare('DELETE FROM approval_windows WHERE id = ?').run(Number(id)).changes > 0;

// -- Settings ---------------------------------------------------------
function getSetting(orgId, key) {
  const row = db().prepare('SELECT value FROM approval_settings WHERE org_id = ? AND key = ?')
    .get(Number(orgId), String(key));
  return row ? parse(row.value) : undefined;
}
function setSetting(orgId, key, value, updatedBy = null) {
  db().prepare(`
    INSERT INTO approval_settings (org_id, key, value, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (org_id, key) DO UPDATE SET value = excluded.value,
      updated_by = excluded.updated_by, updated_at = excluded.updated_at
  `).run(Number(orgId), String(key), json(value), updatedBy ?? null, nowIso());
  return getSetting(orgId, key);
}
function allSettings(orgId) {
  const out = {};
  for (const r of db().prepare('SELECT key, value, updated_by, updated_at FROM approval_settings WHERE org_id = ?').all(Number(orgId))) {
    out[r.key] = { value: parse(r.value), updatedBy: r.updated_by, updatedAt: r.updated_at };
  }
  return out;
}

// -- People and Sites (read only; the tables are auth.js's) -----------
// On a throwaway test database there is no users table. These answer "nobody"
// there rather than throw, so a rule that only fills a field in when somebody
// matches still runs.
function safely(fn, fallback) {
  try { return fn(); } catch (err) {
    if (/no such table/i.test(String(err && err.message))) return fallback;
    throw err;
  }
}
const USER_COLS = 'id, username, email, role, tenant_id, organization_id, active';
const userOf = (r) => r && ({
  id: r.id, username: r.username, email: r.email, role: r.role,
  tenantId: r.tenant_id, orgId: r.organization_id, active: Boolean(r.active),
});
const userById = (id) => safely(() => userOf(db()
  .prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(Number(id))), null);
const userByUsername = (username) => safely(() => userOf(db()
  .prepare(`SELECT ${USER_COLS} FROM users WHERE username = ?`).get(String(username))), null);
/** The RackTrack user of this organization with that email, if there is one. */
const userByEmail = (orgId, email) => safely(() => (email ? userOf(db()
  .prepare(`SELECT ${USER_COLS} FROM users WHERE organization_id IS ? AND lower(email) = lower(?) AND active = 1`)
  .get(orgId ?? null, String(email))) : null), null);
function usersOfOrg(orgId, { roles = null } = {}) {
  return safely(() => db().prepare(`
    SELECT u.id, u.username, u.email, u.role, u.tenant_id, u.organization_id, u.active, t.name AS tenant_name
    FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id
    WHERE u.organization_id = ? AND u.active = 1 ORDER BY u.username
  `).all(Number(orgId))
    .filter((r) => !roles || roles.includes(r.role))
    .map((r) => ({ ...userOf(r), tenantName: r.tenant_name || null })), []);
}
const tenantById = (id) => safely(() => {
  const r = db().prepare('SELECT * FROM tenants WHERE id = ?').get(Number(id));
  return r ? { id: r.id, name: r.name, slug: r.slug, orgId: r.organization_id ?? null,
               timezone: r.timezone ?? null } : null;
}, null);
/**
 * The Sites this person is the SPOC of, as ids: named by user id, or by an
 * email that setup stored before the person had an account. With `orgId`, only
 * Sites of that organization: the same address typed into another
 * organization's setup makes nobody a SPOC there. A database that has no such
 * columns yet (setup adds them) answers none.
 */
const sitesWhereSpoc = (userId, email, orgId = undefined) => {
  try {
    return db().prepare(`SELECT id, organization_id FROM tenants WHERE approver_user_id = ?
      OR (approver_email IS NOT NULL AND lower(approver_email) = lower(?))`)
      .all(userId == null ? -1 : Number(userId), email == null ? '\u0000' : String(email))
      .filter((r) => orgId === undefined || Number(r.organization_id ?? -1) === Number(orgId ?? -1))
      .map((r) => r.id);
  } catch (err) {
    if (/no such (table|column)/i.test(String(err && err.message))) return [];
    throw err;
  }
};

// -- Removing an organization ------------------------------------------
/**
 * Everything the workflow holds for one organization, gone. Called from the
 * organization delete in auth.js, inside its transaction and on the same
 * handle. The plan rows go first; their items, tickets, decisions,
 * verifications, comments, events, clocks and notifications follow by cascade.
 */
function purgeOrg(orgId) {
  return tx(() => {
    const n = Number(orgId);
    const plans = db().prepare('DELETE FROM approval_plans WHERE org_id = ?').run(n).changes;
    db().prepare('DELETE FROM approval_exceptions WHERE org_id = ?').run(n);
    db().prepare('DELETE FROM approval_windows WHERE org_id = ?').run(n);
    db().prepare('DELETE FROM approval_settings WHERE org_id = ?').run(n);
    return { plans };
  });
}

/** Tests only: forget the handle so the next call opens RACKTRACK_APPROVALS_DB afresh. */
function _reset() {
  if (_db && _isolated) { try { _db.close(); } catch { /* already closed */ } }
  _db = null; _isolated = false; _ready = false;
}

const TABLES = ['approval_plans', 'approval_items', 'approval_tickets', 'approval_decisions',
  'approval_verifications', 'approval_comments', 'approval_events', 'approval_sla',
  'approval_notifications', 'approval_exceptions', 'approval_windows', 'approval_settings'];
TABLES.push('approval_overrides');

module.exports = {
  // the handle
  db, tx, isolated, nowIso, TABLES, _reset,
  // plans
  insertPlan, getPlan, getPlanByLegacyId, updatePlan, touchPlan, listPlans,
  countPlansBy, countPlansBySla, countPlansBySlaState, listEvents,
  SLA_STATES, slaStateOf,
  // items and tickets
  insertItem, itemsOf, getItem, updateItem,
  replaceItems, addOverride, getOverride, overridesOf, revokeOverride, evidenceOf,
  ticketsOf, getTicket, putTicket, updateTicket, listTickets, ticketsWaitingOnServiceNow,
  // the history of a plan
  addDecision, decisionsOf, addVerification, verificationsOf,
  addComment, commentsOf, addEvent, eventsOf,
  // clocks, notifications, exceptions, windows, settings
  addSla, updateSla, slaOf, slaByStatus,
  addNotification, updateNotification, notificationsFor, notificationsByStatus,
  addException, getException, listExceptions, revokeException,
  addWindow, getWindow, listWindows, deleteWindow,
  getSetting, setSetting, allSettings,
  // people and Sites
  userById, userByUsername, userByEmail, usersOfOrg, tenantById, sitesWhereSpoc,
  purgeOrg,
};
