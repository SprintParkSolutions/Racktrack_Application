/**
 * The change registry: every field a write changed in NetBox, across checks.
 *
 * GET /changes and GET /changes.csv are the same rows behind the same
 * filters. Reading is all there is: a row is written once, inside the write
 * that made the change, and nothing here or anywhere else edits or removes it.
 *
 * Who reads what is the service's rule, not the door's: an organization admin
 * and an auditor read the whole organization; anybody else reads the Sites
 * they are the SPOC of and the checks they hold or held; with neither, a 403
 * that says who the registry is for. RackTrack's own link fields on a record
 * are recorded too and stay out of the list unless `internal=1` asks.
 */
const express = require('express');

const service = require('../../lib/approvals/service');
const gates = require('../netbox/gates');
const { refused, fail, filtersOf } = require('./http');

const router = express.Router();

const FILTERS = ['tenantId', 'rackId', 'planId', 'objectType', 'field', 'approvedById', 'incident',
  'result', 'since', 'until', 'q', 'internal', 'limit', 'cursor'];

/** One row as the screens read it: no uid of ours, and values as values. */
const rowOf = (c) => ({
  id: c.id, writtenAt: c.writtenAt, planId: c.planId, attempt: c.attempt,
  tenantId: c.tenantId, siteName: c.siteName, rackId: c.rackId, rackName: c.rackName,
  objectType: c.objectType, objectName: c.objectName, netboxId: c.netboxId, netboxUrl: c.netboxUrl,
  action: c.action, field: c.field, before: c.before, after: c.after, internal: c.internal,
  result: c.result, reason: c.reason, source: c.source, rule: c.rule,
  approvedBy: c.approvedBy, approvedById: c.approvedById, approvedAt: c.approvedAt,
  writtenBy: c.writtenBy, incidentNumber: c.incidentNumber, incidentUrl: c.incidentUrl,
  checked: c.checked,
});

router.get('/changes', gates.readers, (req, res) => {
  const out = service.listChanges(req.user, filtersOf(req.query, FILTERS));
  if (refused(out)) return fail(res, out);
  return res.json({ ok: true, changes: out.changes.map(rowOf), nextCursor: out.nextCursor });
});

// -- The same rows as a file ------------------------------------------------
const COLUMNS = [
  ['When', (c) => c.writtenAt], ['Site', (c) => c.siteName], ['Rack', (c) => c.rackName || c.rackId],
  ['Object type', (c) => c.objectType], ['Object', (c) => c.objectName], ['NetBox id', (c) => c.netboxId],
  ['Field', (c) => (c.field === '*' ? (c.action === 'create' ? 'New record' : 'Whole record') : c.field)],
  ['Before', (c) => c.before], ['After', (c) => c.after], ['Result', (c) => c.result],
  ['Reason', (c) => c.reason], ['Source', (c) => c.source], ['Approved by', (c) => c.approvedBy],
  ['Written by', (c) => c.writtenBy], ['Check', (c) => c.planId], ['Incident', (c) => c.incidentNumber],
];

const cell = (v) => {
  if (v == null) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  // A value that a spreadsheet would run as a formula is kept as text.
  if (/^[=+\-@\t\r]/.test(s) && typeof v === 'string') s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

router.get('/changes.csv', gates.readers, (req, res) => {
  const out = service.listChanges(req.user, filtersOf(req.query, FILTERS), { cap: 5000 });
  if (refused(out)) return fail(res, out);
  const lines = [COLUMNS.map(([title]) => cell(title)).join(','),
    ...out.changes.map((c) => COLUMNS.map(([, read]) => cell(read(c))).join(','))];
  res.setHeader('Content-Disposition', 'attachment; filename="change-registry.csv"');
  return res.type('text/csv').send(`${lines.join('\n')}\n`);
});

module.exports = router;
