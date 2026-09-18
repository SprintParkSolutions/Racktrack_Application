/**
 * The eight reports, as JSON and as a file.
 *
 * GET /reports/:name and GET /reports/:name.csv are the same report through
 * the same columns. Every row carries the filters that open the plan list
 * behind its number, so a report is a way into the work and not a dead end.
 */
const express = require('express');

const service = require('../../lib/approvals/service');
const reports = require('../../lib/approvals/reports');
const machine = require('../../lib/approvals/machine');

const router = express.Router();

/** Reading the numbers for a whole organization is a reader's job. */
const READERS = [...new Set([...machine.ROLES.reader, ...machine.ROLES.auditor])];

router.get('/reports', (req, res) => res.json({ ok: true, reports: reports.NAMES }));

router.get('/reports/:name', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (!READERS.includes(req.user.role)) {
    return res.status(403).json({ error: 'The reports are for an admin, an approver or an auditor.' });
  }
  const raw = String(req.params.name || '');
  const csv = raw.endsWith('.csv');
  const name = csv ? raw.slice(0, -4) : raw;
  if (!reports.NAMES.includes(name)) {
    return res.status(404).json({ error: `no such report; they are ${reports.NAMES.join(', ')}` });
  }
  const report = reports.run(name, { actor: service.actorOf(req.user), query: req.query || {} });
  if (csv) {
    res.setHeader('Content-Disposition', `attachment; filename="approvals-${name}.csv"`);
    return res.type('text/csv').send(reports.toCsv(report));
  }
  return res.json({ ok: true, ...report });
});

module.exports = router;
