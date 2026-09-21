/**
 * Preview and Export: the NetBox end of the chain.
 *
 * Preview reads NetBox and writes nothing. Export writes, and is safe to run
 * twice. Neither ever deletes.
 */
const archiver = require('archiver');
const express = require('express');

const cfg = require('../../lib/netbox/config');
const store = require('../../lib/netbox/store');
const plans = require('../../lib/netbox/plans');
const unmanaged = require('../../lib/netbox/unmanaged');
const entered = require('../../lib/netbox/entered');
const { NetBox } = require('../../lib/netbox/netbox');
const { plan, push } = require('../../lib/netbox/writer');
const { toCsv, toJson, toMarkdown } = require('../../lib/netbox/files');

const profiles = require('../../lib/connection_profiles');
const tenant = require('../../lib/tenant');
const { canAccessRack } = require('../../lib/rack_access');

// Who may use each route. The mount only authenticates; a member (the
// technician at the rack) reaches preview and nothing else on this router.
const gates = require('./gates');
const trail = require('./trail');

const router = express.Router();

/**
 * Which NetBox, for this caller.
 *
 * The standalone build read one NetBox from its .env. Inside RackTrack the
 * NetBox login belongs to the organisation and lives where every other
 * data source does — Data Sources (/connections), encrypted, set once by an
 * admin — so nobody standing at a rack is ever asked for a token. The server
 * env is kept only as a fallback for a single-tenant install.
 */
function target(req) {
  // The organisation's NetBox first. Then the caller's own — an owner account
  // belongs to no organisation, and a Data Source it saved was stored and
  // then never consulted, which read as "export is broken" for exactly the
  // people running the demo. Same order the ServiceNow paths already use.
  const orgId = req.user?.organization_id;
  const creds = (orgId ? profiles.resolveCredsForOrg(orgId, 'netbox') : null)
    || (req.user?.id ? profiles.resolveCredsForType(req.user.id, 'netbox') : null);
  if (creds?.secret?.base_url) {
    return { url: creds.secret.base_url, token: creds.secret.token || '', source: 'data-sources' };
  }
  if (cfg.NETBOX_URL && cfg.NETBOX_TOKEN) {
    return { url: cfg.NETBOX_URL, token: cfg.NETBOX_TOKEN, source: 'server-env' };
  }
  return { url: '', token: '', source: 'none' };
}

const NOT_CONFIGURED = {
  configured: false, reachable: false, authenticated: false,
  error: 'No NetBox connection for this organisation yet.',
  hint: 'An admin adds one under Data Sources (type: NetBox, with its URL and an API token).',
};

const client = (req) => { const t = target(req); return new NetBox(t.url, t.token); };

/**
 * The snapshot one scan exports, with everything a person declared by hand
 * applied to it. No request, no response: `{ scan, snap, reconciled }`, or
 * `{ error, status }` saying why there is none.
 *
 * The Approvals "Compare again" reads it too, so it lives in one place rather
 * than being written a second time slightly differently.
 */
function snapshotFor(scanId) {
  const scan = store.getScan(scanId);
  if (!scan) return { error: 'no such scan', status: 404 };
  // Prefer the reconciled snapshot once Review has produced one: it carries the
  // switch model/serial and the LLDP cabling merged onto the camera's layout.
  // Fall back to the raw camera snapshot when reconcile has not been run.
  const snap = (scan.payload && scan.payload.reconciled) || (scan.payload && scan.payload.snapshot);
  if (!snap) return { error: 'this scan has no detection result yet', status: 409 };
  // Apply hand-declared unmanaged switches so their brand and model export too.
  unmanaged.applyTo(snap, scan.rackId);
  entered.applyTo(snap, scan.rackId);
  return { scan, snap, reconciled: Boolean(scan.payload.reconciled) };
}

function snapshotOf(req, res) {
  const got = snapshotFor(req.params.id);
  if (got.error) { res.status(got.status).json({ error: got.error }); return null; }
  return got;
}

/**
 * The tenant a plan belongs to: the scan's own, stored with it when the rack
 * was recognised, so the key its uids were built on and the rack its contact
 * is looked up for come from one tenant. The caller's tenant only for a scan
 * that predates that (an owner or an org admin may sit in a different one).
 */
const tenantOf = (scan, req) => scan.payload?.tenantId ?? req.user?.tenant_id ?? null;
const tenantOfScan = (scan, user) => scan.payload?.tenantId ?? user?.tenant_id ?? null;

/** Can we reach NetBox, and are we authenticated? */
router.get('/health', gates.admin, async (req, res) => {
  const t = target(req);
  if (t.source === 'none') return res.json({ ...NOT_CONFIGURED, source: t.source });
  const out = { configured: true, source: t.source, url: t.url, tokenSet: Boolean(t.token),
    publicUrl: cfg.NETBOX_PUBLIC_URL || null };
  try {
    const body = await client(req).status();
    res.json({ ...out, reachable: true, authenticated: true,
               netboxVersion: body['netbox-version'] });
  } catch (err) {
    // A 401/403 still proves NetBox is there — it is the token that is wrong.
    const authIssue = err.status === 401 || err.status === 403;
    res.json({
      ...out,
      reachable: err.status !== 0,
      authenticated: false,
      error: authIssue
        ? `NetBox answered HTTP ${err.status}: the token was refused.`
        : String(err.message),
      hint: authIssue
        ? 'Check the NetBox connection under Data Sources — the token may have expired or lack permissions.'
        : 'Check the URL under Data Sources and that this server can reach it.',
    });
  }
});

router.post('/:id/preview', gates.technician, async (req, res) => {
  const got = snapshotOf(req, res);
  if (!got) return;
  // A technician compares only the racks their Site owns. The admin roles
  // are scoped by their organisation as before; this check is the member's,
  // added with the route they were given, so the route cannot show them a
  // scan of somebody else's rack by its number.
  if (!gates.isAdmin(req) && !canAccessRack(req.user, got.scan.rackId, tenant)) {
    return res.status(404).json({ error: 'no such scan' });
  }
  const t = target(req);
  if (t.source === 'none') return res.status(428).json({ stage: 'preview', ...NOT_CONFIGURED });
  try {
    const report = await plan(got.snap, client(req),
      { ensureField: req.query.ensureField === 'true' });
    store.recordStage(got.scan.id, 'preview', 'ok', countLine(report.counts));

    // File the diff rather than throw it away. Everything downstream — the
    // approval, the tickets, the write and the history — points at this.
    // The rack's own name goes on the check. It is what the adopt step wrote
    // on the scan after the ladder decided which rack this is; left off, every
    // drift in RackTrack Changes was headed by the hash of the photograph.
    const payload = got.scan.payload || {};
    const filed = plans.create({
      scanId: got.scan.id, rackId: got.scan.rackId, rackUid: got.snap.rackUid,
      rackName: got.scan.rackName || payload.rackName || null,
      // The same comparison of the same rack BY THE SAME PERSON is the same check.
      // Filing a new one on every open of the Drift screen buried the check a
      // person had already sent under a fresh draft each time they looked, so
      // they never saw it move - and left the admin a queue of identical drafts.
      // Somebody else comparing the same rack still gets a plan of their own.
      reuse: true,
      report, by: (req.user && (req.user.username || req.user.email)) || null,
      orgId: req.user?.organization_id ?? null, tenantId: tenantOf(got.scan, req),
    });
    res.json({
      ...report,
      planId: filed.id,
      fingerprint: filed.fingerprint,
      summary: plans.summarise(filed.items),
    });
  } catch (err) {
    store.recordStage(got.scan.id, 'preview', 'failed', String(err.message).slice(0, 400));
    res.status(502).json({ stage: 'preview', url: t.url,
                           error: err.detail ?? String(err.message) });
  }
});


/**
 * Write to NetBox - but only what an admin approved, and only if NetBox has
 * not moved since they approved it.
 *
 * Body: { planId }. Without one this refuses, because a push nobody signed is
 * the thing the whole workflow exists to prevent. Pass force:true only to
 * accept a plan whose items are not all decided; it can never bypass the
 * fingerprint check.
 *
 * A plan NetBox refused part of (status write_failed) may be exported again:
 * the retry goes through every check here, the fingerprint included, so a
 * NetBox that moved since the first attempt still stops it.
 */
router.post('/:id/export', gates.admin, async (req, res) => {
  const got = snapshotOf(req, res);
  if (!got) return;
  if (target(req).source === 'none') return res.status(428).json({ stage: 'export', ...NOT_CONFIGURED });

  // An engineer scans and compares. Only an admin writes.
  if (!['owner', 'org_admin'].includes(req.user?.role)) {
    return res.status(403).json({
      stage: 'export',
      error: 'An admin approves and writes. Send this plan to yours to review.',
    });
  }

  const by = (req.user && (req.user.username || req.user.email)) || null;
  const { planId, force } = req.body || {};
  if (!planId) {
    return res.status(428).json({
      stage: 'export',
      error: 'Compare first, then have an admin approve it. Send { planId }.',
    });
  }
  const approvedPlan = plans.get(planId);
  if (!approvedPlan) return res.status(404).json({ stage: 'export', error: 'no such plan' });
  // Only a plan written in full is closed. write_failed is the retry case.
  if (approvedPlan.status === 'applied') {
    return res.status(409).json({ stage: 'export', error: 'that plan has already been written' });
  }
  if (String(approvedPlan.scanId) !== String(got.scan.id)) {
    return res.status(409).json({ stage: 'export', error: 'that plan belongs to a different scan' });
  }
  if (!plans.visibleTo(approvedPlan, req.user)) {
    return res.status(404).json({ stage: 'export', error: 'no such plan' });
  }
  if (!plans.isSettled(approvedPlan) && !force) {
    const s = plans.summarise(approvedPlan.items);
    return res.status(409).json({
      stage: 'export', error: 'some items are still waiting on somebody',
      summary: s,
    });
  }

  try {
    // Look again, right before writing. If anything moved since the plan was
    // frozen, stop: somebody edited NetBox between the approval and now, and
    // writing would erase their work without anyone noticing.
    const fresh = await plan(got.snap, client(req));
    const now = plans.fingerprint(fresh.changes);
    if (now !== approvedPlan.fingerprint) {
      const replan = plans.create({
        scanId: got.scan.id, rackId: got.scan.rackId, rackUid: got.snap.rackUid,
        report: fresh, by,
        orgId: req.user?.organization_id ?? null, tenantId: tenantOf(got.scan, req),
      });
      store.recordStage(got.scan.id, 'export', 'failed', 'NetBox changed since approval');
      trail.record(req, approvedPlan, 'drift.write', {
        status: 'fail', error: 'NetBox changed since approval',
        payload: { counts: {}, written: 0, failed: 0, newPlanId: replan.id },
      });
      return res.status(409).json({
        stage: 'export',
        error: 'NetBox has changed since this plan was approved, so nothing was written.',
        approvedFingerprint: approvedPlan.fingerprint,
        currentFingerprint: now,
        newPlanId: replan.id,
        next: 'Review the new plan and approve it if it is still what you want.',
      });
    }

    const excluded = plans.excludedUids(approvedPlan);
    const toWrite = plans.filterSnapshot(got.snap, excluded);
    const report = await push(toWrite, client(req));
    report.planId = approvedPlan.id;
    report.withheld = excluded.size;
    const status = report.counts.fail ? 'failed' : 'ok';
    store.recordStage(got.scan.id, 'export', status, countLine(report.counts));
    // Every object through: applied. Any refused: write_failed, the failures
    // listed on the plan, the admin who ran it told by email, and the plan
    // left open to a second export.
    const written = plans.markApplied(approvedPlan.id, { by, result: report });
    report.planStatus = written ? written.status : null;
    report.failures = written ? written.result.failures : [];
    trail.record(req, approvedPlan, 'drift.write', {
      status: report.counts.fail ? 'fail' : 'ok',
      payload: { counts: report.counts, written: written?.result.written ?? 0,
                 failed: written?.result.failed ?? 0 },
    });
    if (written && written.status === 'write_failed') {
      // One email, from the approvals notifier, which names every object
      // NetBox refused. This route used to send its own beside it and the
      // admin got the same news twice.
      report.emailed = true;
    }
    res.json(report);
  } catch (err) {
    store.recordStage(got.scan.id, 'export', 'failed', String(err.message).slice(0, 400));
    trail.record(req, approvedPlan, 'drift.write', {
      status: 'fail', error: err.detail ?? String(err.message),
      payload: { counts: {}, written: 0, failed: 0 },
    });
    res.status(502).json({ stage: 'export', url: cfg.NETBOX_URL,
                           error: err.detail ?? String(err.message) });
  }
});

/** The snapshot as a reviewable file — every value with its evidence. */
router.get('/:id/export.md', gates.admin, (req, res) => {
  const got = snapshotOf(req, res);
  if (!got) return;
  const name = (got.scan.rackId || `scan-${got.scan.id}`).replace(/[^A-Za-z0-9_-]/g, '_');
  res.setHeader('Content-Disposition', `attachment; filename="${name}.md"`);
  res.type('text/markdown').send(toMarkdown(got.snap));
});

/**
 * Push the JSON to any HTTP endpoint the operator names. This is the "webhook"
 * path: it lets the scan feed an automation, a CMDB, or a chat channel without
 * RackTrack needing a connector for each. Writes nothing to NetBox.
 */
router.post('/:id/webhook', gates.admin, async (req, res) => {
  const got = snapshotOf(req, res);
  if (!got) return;
  const url = String((req.body || {}).url || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'Enter a full http:// or https:// URL to post the scan to.' });
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: toJson(got.snap),
      signal: ctrl.signal,
    });
    res.json({ ok: r.ok, status: r.status, statusText: r.statusText });
  } catch (err) {
    res.status(502).json({ error: `Could not reach ${url}: ${err.message}` });
  } finally {
    clearTimeout(timer);
  }
});

router.get('/:id/export.json', gates.admin, (req, res) => {
  const got = snapshotOf(req, res);
  if (!got) return;
  const name = got.snap.rackUid.replace(/:/g, '-');
  res.setHeader('Content-Disposition', `attachment; filename="${name}.json"`);
  res.type('application/json').send(toJson(got.snap));
});

/** NetBox bulk-import CSVs, zipped. The path that needs no API token. */
router.get('/:id/export.csv', gates.admin, (req, res) => {
  const got = snapshotOf(req, res);
  if (!got) return;
  const files = toCsv(got.snap);
  const name = got.snap.rackUid.replace(/:/g, '-');
  res.setHeader('Content-Disposition', `attachment; filename="${name}-netbox-csv.zip"`);
  res.type('application/zip');
  const zip = archiver('zip', { zlib: { level: 9 } });
  zip.on('error', (err) => res.status(500).end(String(err.message)));
  zip.pipe(res);
  for (const [file, body] of Object.entries(files)) zip.append(body, { name: file });
  zip.append(
    'NetBox bulk-import CSVs, in dependency order:\n  '
    + Object.keys(files).join('\n  ')
    + '\n\nImport each under its own object type in NetBox (Import > CSV).\n'
    + 'Order matters: a device cannot be created before its device type exists.\n',
    { name: 'README.txt' });
  zip.finalize();
});

const countLine = (counts) =>
  Object.entries(counts).sort().map(([k, v]) => `${k}=${v}`).join(' · ');

module.exports = router;
// Read by routes/approvals/plans.js for "Compare again", which runs the same
// comparison from a rack id instead of a scan id.
module.exports.snapshotFor = snapshotFor;
module.exports.tenantOfScan = tenantOfScan;
