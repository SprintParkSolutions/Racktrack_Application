/**
 * The change registry, as rows: what a write put into NetBox, from the
 * writer's own report.
 *
 * Pure. service.finishWrite() hands over the plan, its items and decisions
 * and the report push() returned, and gets back what store.addChange() takes,
 * one call per row, inside the same transaction that marks the plan written.
 * Nothing here reads a database or a clock.
 *
 *   update, rebind   one row per field of the row's diff, before and after as
 *                    the writer read and wrote them. `recordId` is not a
 *                    NetBox field and is left out. RackTrack's own link fields
 *                    (racktrack_uid, racktrack_bound) are recorded, marked
 *                    `internal`, and hidden from a list unless it asks.
 *   create           one row per object, field '*', after = what was sent,
 *                    trimmed to its plain values.
 *   fail             one row per object, field '*', result 'failed', with
 *                    NetBox's reason. What NetBox refused is part of the record.
 *   noop, skip       nothing was written, so nothing is recorded.
 *
 * Who approved is the last approval on record; a write runs as the system on
 * that person's word. A change a person made to what the scan proposed (an
 * accepted suggestion, a value typed by hand) is on the item as `modified`,
 * and the row says so in `source` and `rule`. A port that follows its device
 * is part of the same decision and inherits both.
 *
 * The check after the write is recorded too, as one more row (verdictRow):
 * appended, because nothing in this table is ever updated.
 */
const INTERNAL_FIELDS = new Set(['racktrack_uid', 'racktrack_bound']);
const NOT_A_FIELD = new Set(['recordId']);
const WRITTEN = new Set(['create', 'update', 'rebind']);
const SOURCES = new Set(['suggestion', 'manual']);

const text = (v) => (typeof v === 'string' ? v.trim() : '');

/** The last approval on record: the name a write is made in. */
function approverOf(decisions) {
  const signed = (decisions || []).filter((d) => d.decision === 'approved');
  const last = signed[signed.length - 1] || null;
  return last ? { approvedBy: last.approver ?? null, approvedById: last.approverId ?? null,
    approvedAt: last.decidedAt ?? null }
    : { approvedBy: null, approvedById: null, approvedAt: null };
}

/** Where a row's content came from: the scan, an accepted suggestion, or a person's own change. */
function sourceOf(item, byUid) {
  const own = item && item.modified;
  const parent = item && item.parentUid ? byUid.get(item.parentUid) : null;
  const m = own || (item && item.following && parent && parent.modified) || null;
  if (!m) return { source: 'scan', rule: null };
  return { source: SOURCES.has(m.source) ? m.source : 'manual', rule: m.rule ?? null };
}

/** An object's name as a person knows it: the record's own, else the scan's without the rack in it. */
function nameOf(change, item, plan) {
  const record = item && item.modified && text(item.modified.recordName);
  if (record) return record;
  const name = text((item && item.name) || change.name);
  const rack = text(plan && plan.rackName);
  if (!name || !rack || name === rack) return name || null;
  const trimmed = name.split(rack).join(' ').replace(/\s{2,}/g, ' ').replace(/^[\s\-:,]+|[\s\-:,]+$/g, '');
  return trimmed || name;
}

/** The record's page in NetBox, for a device. */
function urlOf(plan, type, netboxId) {
  const base = text(plan && plan.netboxUrl).replace(/\/+$/, '');
  if (!base || netboxId == null || type !== 'Device') return null;
  return `${base}/dcim/devices/${netboxId}/`;
}

/** -> rows for store.addChange */
function rowsFor({ plan, items = [], decisions = [], changes = [], attempt = 1, writtenAt, writtenBy = null } = {}) {
  const byUid = new Map((items || []).map((i) => [i.uid, i]));
  const incident = (plan && plan.incident) || {};
  const who = writtenBy || {};
  const shared = {
    orgId: plan.orgId ?? null, tenantId: plan.tenantId ?? null, planId: plan.id, attempt,
    rackId: plan.rackId ?? null, rackName: plan.rackName ?? null,
    ...approverOf(decisions),
    writtenBy: who.username ?? null, writtenById: who.id ?? null, writtenAt,
    incidentNumber: incident.number ?? null, incidentSysId: incident.sysId ?? null,
  };
  const rows = [];
  for (const c of changes || []) {
    if (!c || !c.uid) continue;
    const failed = c.action === 'fail';
    if (!failed && !WRITTEN.has(c.action)) continue;
    const item = byUid.get(c.uid) || null;
    const type = c.type ?? (item && item.type) ?? null;
    const netboxId = c.netboxId ?? (item && item.netboxId) ?? null;
    const base = { ...shared, itemUid: c.uid, objectType: type, objectName: nameOf(c, item, plan),
      netboxId, netboxUrl: urlOf(plan, type, netboxId), ...sourceOf(item, byUid) };
    if (failed) {
      rows.push({ ...base, action: item && WRITTEN.has(item.action) ? item.action : 'update', field: '*',
        before: null, after: null, internal: false, result: 'failed', reason: c.reason ?? null });
      continue;
    }
    if (c.action === 'create') {
      rows.push({ ...base, action: 'create', field: '*', before: null, after: c.created ?? null,
        internal: false, result: 'written', reason: null });
      continue;
    }
    const fields = Object.keys(c.diff || {}).filter((k) => !NOT_A_FIELD.has(k));
    for (const field of fields) {
      const d = c.diff[field] || {};
      rows.push({ ...base, action: c.action, field, before: d.from ?? null, after: d.to ?? null,
        internal: INTERNAL_FIELDS.has(field), result: 'written', reason: null });
    }
    // The mark a first bind leaves on the customer's record is written beside
    // the uid and is never in the diff (the diff is what an approval signed).
    if (c.action === 'rebind' && c.boundMark && !fields.includes('racktrack_bound')) {
      rows.push({ ...base, action: 'rebind', field: 'racktrack_bound', before: null, after: c.boundMark,
        internal: true, result: 'written', reason: null });
    }
    // An update that carried no diff still changed the object: say so once.
    if (!fields.length && !(c.action === 'rebind' && c.boundMark)) {
      rows.push({ ...base, action: c.action, field: '*', before: null, after: null,
        internal: false, result: 'written', reason: c.reason ?? null });
    }
  }
  return rows;
}

/**
 * What the check after a write found, as a row of its own. It is RackTrack's
 * bookkeeping about an attempt, not a field of an object, so it is `internal`
 * and a list reads it back as `checked` on the rows of that attempt.
 */
function verdictRow({ plan, attempt = 1, result, checked = null, failed = null, at, by = 'system' } = {}) {
  const incident = (plan && plan.incident) || {};
  const passed = result === 'pass';
  return { orgId: plan.orgId ?? null, tenantId: plan.tenantId ?? null, planId: plan.id, attempt,
    rackId: plan.rackId ?? null, rackName: plan.rackName ?? null, itemUid: '*', objectType: null,
    objectName: null, netboxId: null, netboxUrl: null, action: 'check', field: '*', before: null,
    after: { checked, failed }, internal: true, result: passed ? 'verified' : 'mismatch',
    reason: passed ? null : 'NetBox did not hold what was written.', source: 'scan', rule: null,
    writtenBy: by, writtenById: null, writtenAt: at,
    incidentNumber: incident.number ?? null, incidentSysId: incident.sysId ?? null };
}

const say = (v) => (v === null || v === undefined || v === '' ? 'nothing'
  : (typeof v === 'object' ? JSON.stringify(v) : String(v)));

/**
 * The rows a person is shown, as short lines: `<object>: <field> <before> ->
 * <after>`. RackTrack's own link fields and the check rows are left out.
 */
function summaryOf(rows, { limit = 10 } = {}) {
  const visible = (rows || []).filter((r) => !r.internal && r.action !== 'check');
  const lines = visible.slice(0, limit).map((r) => {
    const object = r.objectName || r.objectType || 'object';
    if (r.result === 'failed') return `${object}: not written${r.reason ? ` - ${r.reason}` : ''}`;
    if (r.field === '*') return `${object}: ${r.action === 'create' ? 'created' : 'updated'}`;
    return `${object}: ${r.field} ${say(r.before)} -> ${say(r.after)}`;
  });
  return { written: visible.filter((r) => r.result === 'written').length,
    failed: visible.filter((r) => r.result === 'failed').length, lines,
    more: Math.max(0, visible.length - lines.length) };
}

module.exports = { rowsFor, verdictRow, summaryOf, approverOf, INTERNAL_FIELDS };
