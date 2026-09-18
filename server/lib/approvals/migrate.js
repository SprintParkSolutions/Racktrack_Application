/**
 * The JSON plans, brought into the tables. Once, and safely twice.
 *
 * Before 18 September 2026 a plan was a file: server/data/netbox/plans/<id>.json
 * with an index.json beside it. Every drift check a technician raised in the
 * field is one of those files, and none of them may be lost because the
 * storage changed underneath. So at boot this reads each file, writes it into
 * approval_plans and its sibling tables, and STOPS THERE: the files are left
 * exactly as they are, read-only from here on, so a boot that goes wrong can
 * be rolled back by deploying the old code and nothing else.
 *
 * Idempotent. Each imported plan keeps its file's number in `legacy_id`, which
 * carries a unique index, so a second boot finds the row and skips the file.
 * The plan also keeps its original id where that number is still free, so a
 * link somebody bookmarked to plan 12 is still plan 12.
 *
 * THE STATUSES. The files had four words for a workflow that now has
 * twenty-two, so each one becomes the status it would be standing in today:
 *
 *   open          draft: compared, not yet handed over
 *   submitted     triage, or - when tickets were already out - the status
 *                 those tickets add up to (assigned, accepted, in progress,
 *                 pending), or verification_pending once they had all come
 *                 back, which is exactly where settle() would have left it
 *   applied       completed: it was written, and nothing is waiting on it
 *   write_failed  write_failed, with its failures and the uids that did go
 *                 through, so a retry can still tell its own work from
 *                 somebody else's
 *
 * Nothing is invented. A field the file did not carry is left null rather
 * than guessed at, and the plan's own event log is copied across as it stands.
 */
const fs = require('fs');
const path = require('path');

const store = require('./store');
const machine = require('./machine');

const DATA_DIR = process.env.RT_DATA_DIR || path.join(__dirname, '..', 'data');
const PLANS_DIR = () => path.join(process.env.RT_DATA_DIR || DATA_DIR, 'plans');

/** The status a file's word stands for now, given what its tickets were doing. */
function statusOf(plan, tickets) {
  const word = String(plan.status || 'open');
  if (word === 'open') return 'draft';
  if (word === 'applied') return 'completed';
  if (word === 'write_failed') return 'write_failed';
  if (['rejected', 'cancelled', 'duplicate', 'known_exception'].includes(word)) return word;
  // submitted: wherever its tickets had got to, which is where the plan
  // would be standing if the workflow had existed when it was raised.
  if (!tickets.length) return 'triage';
  const at = machine.workingStatus(tickets);
  return at === 'resolved' ? 'verification_pending' : at;
}

/** The old ticket words are the new ones, except that open covered them all. */
const TICKET_STATUS = { open: 'open', resolved: 'resolved', closed: 'closed' };

/** One item of a file as an approval_items row. */
function itemOf(item) {
  const known = new Set(['uid', 'type', 'name', 'action', 'netboxId', 'diff', 'reason',
    'supporting', 'decidable', 'parentUid', 'following', 'decision', 'decidedBy', 'decidedAt',
    'note', 'ticket']);
  const extra = {};
  for (const [k, v] of Object.entries(item)) if (!known.has(k)) extra[k] = v;
  return {
    uid: item.uid,
    type: item.type ?? null,
    name: item.name ?? null,
    action: item.action ?? null,
    netboxId: item.netboxId ?? null,
    diff: item.diff ?? null,
    reason: item.reason ?? null,
    supporting: Boolean(item.supporting),
    decidable: Boolean(item.decidable),
    // The files spelled it with a space on a row nobody was asked about.
    decision: item.decision === 'not applicable' ? 'not_applicable' : (item.decision || 'pending'),
    decidedBy: item.decidedBy ?? null,
    decidedAt: item.decidedAt ?? null,
    note: item.note ?? null,
    parentUid: item.parentUid ?? null,
    following: Boolean(item.following),
    extra,
  };
}

/** The ticket a file kept nested on its item, as an approval_tickets row. */
const ticketOf = (t) => ({
  assignee: t.assignee ?? null,
  assigneeId: t.assigneeId ?? null,
  assigneeEmail: t.assigneeEmail ?? null,
  spoc: t.spoc ?? null,
  scope: t.scope ?? null,
  raisedBy: t.raisedBy ?? null,
  raisedAt: t.raisedAt ?? null,
  status: TICKET_STATUS[t.status] || 'open',
  question: t.question ?? null,
  finding: t.finding ?? null,
  outcome: t.outcome ?? null,
  resolvedBy: t.resolvedBy ?? null,
  resolvedAt: t.resolvedAt ?? null,
  closedBy: t.closedBy ?? null,
  closedAt: t.closedAt ?? null,
  closedWith: t.closedWith ?? null,
  external: t.external ?? null,
  emailedAt: t.emailedAt ?? null,
  emailNote: t.emailNote ?? null,
});

/** Import one file's plan. Returns true when a row was written. */
function importPlan(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!raw || raw.id == null) return false;
  const legacyId = Number(raw.id);
  if (store.getPlanByLegacyId(legacyId)) return false;

  const items = (raw.items || []).map(itemOf);
  // A port shared its device's ticket; only the device's is a real ticket.
  const tickets = (raw.items || [])
    .filter((i) => i.ticket && !i.ticket.sharedWith)
    .map((i) => ({ uid: i.uid, fields: ticketOf(i.ticket) }));
  const status = statusOf(raw, tickets.map((t) => t.fields));
  const written = raw.status === 'applied' || raw.status === 'write_failed';

  return store.tx(() => {
    const free = store.getPlan(legacyId) == null;
    const plan = store.insertPlan({
      ...(free ? { id: legacyId } : {}),
      legacyId,
      orgId: raw.orgId ?? null,
      tenantId: raw.tenantId ?? null,
      scanId: raw.scanId ?? null,
      rackId: raw.rackId ?? null,
      rackUid: raw.rackUid ?? null,
      rackName: raw.rackName ?? null,
      netboxUrl: raw.netboxUrl ?? null,
      status,
      fingerprint: raw.fingerprint ?? null,
      counts: raw.counts || {},
      warnings: raw.warnings || [],
      orphans: raw.orphans || [],
      customField: raw.customField ?? null,
      createdBy: raw.createdBy ?? null,
      createdAt: raw.createdAt || store.nowIso(),
      submittedAt: raw.submittedAt ?? null,
      submittedBy: raw.submittedBy ?? null,
      submittedNote: raw.submittedNote ?? null,
      result: raw.result ?? null,
      writtenAt: written ? (raw.appliedAt || raw.lastWriteAt || null) : null,
      writtenBy: written ? (raw.appliedBy || raw.lastWriteBy || null) : null,
      completedAt: raw.status === 'applied' ? (raw.appliedAt || raw.lastWriteAt || null) : null,
      updatedAt: raw.lastWriteAt || raw.submittedAt || raw.createdAt || store.nowIso(),
    }, items);
    for (const t of tickets) store.putTicket(plan.id, t.uid, t.fields, { touch: false });
    for (const e of raw.events || []) {
      store.addEvent(plan.id, {
        action: e.what || 'event',
        actorName: e.by ?? null,
        toStatus: status,
        payload: { what: e.what ?? null, detail: e.detail ?? null },
        ts: e.at || raw.createdAt || store.nowIso(),
      });
    }
    store.addEvent(plan.id, {
      action: 'migrate',
      actorName: 'system',
      toStatus: status,
      reason: `imported from ${path.basename(file)}`,
      payload: { legacyId, from: raw.status ?? null, to: status },
    });
    return true;
  });
}

/**
 * Import every JSON plan that is not in the tables yet. Safe to call on every
 * boot: a broken file is logged and stepped over rather than stopping the
 * rest, because one unreadable plan must not keep the other forty out.
 */
function run({ dir = PLANS_DIR() } = {}) {
  const out = { dir, files: 0, imported: 0, skipped: 0, failed: 0 };
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => /^\d+\.json$/.test(n));
  } catch {
    // No directory means no JSON plans were ever written here. Nothing to do.
    log(out);
    return out;
  }
  out.files = names.length;
  out.unreadable = [];
  for (const name of names.sort((a, b) => parseInt(a, 10) - parseInt(b, 10))) {
    try {
      if (importPlan(path.join(dir, name))) out.imported += 1;
      else out.skipped += 1;
    } catch (err) {
      // A half-written file - the server was restarted mid-write, or a disk
      // filled - is one plan, not forty. Name it in the log so somebody can go
      // and look at it, and carry on with the rest.
      out.failed += 1;
      out.unreadable.push({ file: name, why: String(err && err.message).slice(0, 200) });
      warn(name, err);
    }
  }
  log(out);
  return out;
}

function warn(name, err) {
  const line = `approvals: ${name} could not be imported and was left alone: ${err && err.message}`;
  try {
    require('../observability').logger.warn(
      { event: 'approvals.migrate.file_failed', file: name, err: err && err.message }, line);
  } catch {
    console.warn(`[approvals] ${line}`);
  }
}

function log(out) {
  const line = `approvals: ${out.imported} JSON plan${out.imported === 1 ? '' : 's'} imported, `
    + `${out.skipped} already in the tables`
    + (out.failed ? `, ${out.failed} left alone: ${out.unreadable.map((u) => u.file).join(', ')}` : '');
  try {
    require('../observability').logger.info({ event: 'approvals.migrate', ...out }, line);
  } catch {
    console.log(`[approvals] ${line}`);
  }
}

module.exports = { run, importPlan, statusOf, PLANS_DIR };
