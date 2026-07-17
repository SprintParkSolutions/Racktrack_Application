// Owner-only device administration for monitored_devices.
//
// The port_history router (/api/ports/*) deliberately never exposes a
// device's host or ssh_port — the UI works off display_name alone. That's
// the right call for every normal user, but SOMEONE has to be able to add
// a switch, and until now nothing could: addDevice/setEnabled/deleteDevice
// existed in port_history_db but no route reached them, so rows only ever
// arrived via direct SQL or the RACKTRACK_AUTOSEED env seed.
//
// This router fills that gap and is gated to role=owner, for two reasons:
//   1. monitored_devices has no tenant_id. Exposing it to org_admins would
//      leak every tenant's switches to every tenant. Until the table grows
//      an org scope, owner is the only role that can safely see the whole
//      list.
//   2. These routes DO return host/ssh_port (an admin who can't see the IP
//      can't debug why a poll fails), which is exactly the field the
//      /api/ports view strips. Keep the audiences separate.
//
// Routes (all require role=owner):
//   GET    /api/lab/devices      — list, including host/ssh_port
//   POST   /api/lab/devices      — add { host, ssh_port?, vendor?, label? }
//   PATCH  /api/lab/devices/:id  — { enabled }
//   DELETE /api/lab/devices/:id

const express = require('express');
const router  = express.Router();

const auth    = require('./auth');
const portsDb = require('./lib/port_history_db');
const poller  = require('./lib/port_poller');
const { logger } = require('./lib/observability');

const ownerOnly = auth.requireRole('owner');

function safeAsync(handler) {
  return async (req, res) => {
    try { await handler(req, res); }
    catch (err) {
      const status = err.statusCode || 500;
      logger?.error?.(`[lab_devices] ${req.method} ${req.originalUrl} — ${err.message}`);
      res.status(status).json({ error: err.message });
    }
  };
}

// Vendors we have a working poll recipe for. Rejecting unknown vendors at
// write time beats accepting a typo'd row that then fails silently on every
// poll for the next 30 days (the poller just logs "no recipe" and skips).
const SUPPORTED_VENDORS = Object.keys(poller.VENDOR_RECIPES || {});

// Hosts are SSH targets we connect to on a timer, so keep this tight: an
// IPv4 literal or a plain hostname, nothing that could carry a scheme,
// credentials, port, or shell metacharacters into the SSH layer.
const HOST_RE = /^[A-Za-z0-9]([A-Za-z0-9._-]{0,252}[A-Za-z0-9])?$/;

// The admin view — same shape as toClientView plus the operational fields
// the owner needs to diagnose a failing device.
function toOwnerView(d) {
  if (!d) return null;
  return {
    ...portsDb.toClientView(d),
    host:     d.host,
    ssh_port: d.ssh_port,
    label:    d.label,
  };
}

router.get('/api/lab/devices', ownerOnly, safeAsync(async (_req, res) => {
  res.json({
    devices:   portsDb.listDevices().map(toOwnerView),
    vendors:   SUPPORTED_VENDORS,
  });
}));

router.post('/api/lab/devices', ownerOnly, safeAsync(async (req, res) => {
  const host     = String(req.body?.host || '').trim();
  const vendor   = String(req.body?.vendor || 'tplink').trim();
  const label    = req.body?.label ? String(req.body.label).trim() : null;
  const ssh_port = req.body?.ssh_port === undefined ? 22 : Number(req.body.ssh_port);

  if (!HOST_RE.test(host)) {
    return res.status(400).json({ error: 'host must be a bare IP or hostname' });
  }
  if (!Number.isInteger(ssh_port) || ssh_port < 1 || ssh_port > 65535) {
    return res.status(400).json({ error: 'ssh_port must be 1-65535' });
  }
  if (!SUPPORTED_VENDORS.includes(vendor)) {
    return res.status(400).json({
      error: `vendor must be one of: ${SUPPORTED_VENDORS.join(', ')}`,
    });
  }
  // host is UNIQUE in the schema — check first so the caller gets a 409
  // with a useful message rather than a raw SQLITE_CONSTRAINT 500.
  if (portsDb.getDeviceByHost(host)) {
    return res.status(409).json({ error: `device already exists for host ${host}` });
  }

  const device = portsDb.addDevice({ host, ssh_port, vendor, label });
  logger?.info?.({ event: 'lab_device.added', host, vendor, by: req.user?.id },
    'lab device added');
  res.status(201).json({ device: toOwnerView(device) });
}));

router.patch('/api/lab/devices/:id', ownerOnly, safeAsync(async (req, res) => {
  const id = Number(req.params.id);
  const device = portsDb.getDevice(id);
  if (!device) return res.status(404).json({ error: 'device not found' });

  if (req.body?.enabled === undefined) {
    return res.status(400).json({ error: 'nothing to update (expected: enabled)' });
  }
  portsDb.setEnabled(id, req.body.enabled ? 1 : 0);
  res.json({ device: toOwnerView(portsDb.getDevice(id)) });
}));

router.delete('/api/lab/devices/:id', ownerOnly, safeAsync(async (req, res) => {
  const id = Number(req.params.id);
  const device = portsDb.getDevice(id);
  if (!device) return res.status(404).json({ error: 'device not found' });

  portsDb.deleteDevice(id);
  logger?.info?.({ event: 'lab_device.deleted', host: device.host, by: req.user?.id },
    'lab device deleted');
  res.json({ ok: true, deleted: id });
}));

module.exports = router;
