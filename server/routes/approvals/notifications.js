/**
 * What is waiting for the signed-in person to read, and what they want emailed.
 *
 * A notification belongs to one person. There is no route here that reads
 * somebody else's: the recipient is always the caller, taken from the session
 * and never from the request.
 */
const express = require('express');

const service = require('../../lib/approvals/service');
const notify = require('../../lib/approvals/notify');

// Requiring this file is what puts the notifier on the bus for this process.
notify.subscribe();
require('../../lib/approvals/sla').start();

const router = express.Router();

/** GET /notifications - mine, newest first. `unread=1` for only the new ones. */
router.get('/notifications', (req, res) => {
  const who = service.actorOf(req.user);
  if (who.id == null) return res.json({ ok: true, notifications: [], unread: 0 });
  const unreadOnly = ['1', 'true'].includes(String(req.query.unread || ''));
  const limit = Math.min(Math.max(1, Number(req.query.limit) || 100), 500);
  return res.json({ ok: true, ...notify.listFor(who.id, { unreadOnly, limit }) });
});

/** GET /notifications/prefs - the channels this person gets notices on. */
router.get('/notifications/prefs', (req, res) => {
  const who = service.actorOf(req.user);
  return res.json({ ok: true, prefs: notify.prefsFor(who.orgId, who.id),
    events: notify.EVENTS, always: ['write_failed', 'sla_breach', 'sla_escalate'],
    why: 'In-app notices are the record and cannot be turned off. A failed write and a '
      + 'breached SLA are sent whatever else is set.' });
});

/** PUT /notifications/prefs { email } - turn the email copy off, or on again. */
router.put('/notifications/prefs', (req, res) => {
  const who = service.actorOf(req.user);
  if (who.orgId == null || who.id == null) {
    return res.status(400).json({ error: 'your account belongs to no organization, so it has no preferences' });
  }
  const body = req.body || {};
  for (const key of ['inapp', 'email', 'teams', ...notify.EVENTS]) {
    if (body[key] !== undefined && typeof body[key] !== 'boolean') {
      return res.status(400).json({ error: `${key} is true or false` });
    }
  }
  if (body.teams === true) {
    return res.status(400).json({ error: 'Teams notices are off until the tokens for them exist.' });
  }
  return res.json({ ok: true, prefs: notify.setPrefs(who.orgId, who.id, body) });
});

/** POST /notifications/:id/read */
router.post('/notifications/:id/read', (req, res) => {
  const who = service.actorOf(req.user);
  if (who.id == null) return res.status(404).json({ error: 'no such notification' });
  const row = notify.markRead(req.params.id, who.id);
  if (!row) return res.status(404).json({ error: 'no such notification' });
  return res.json({ ok: true, notification: row });
});

/** POST /notifications/read-all */
router.post('/notifications/read-all', (req, res) => {
  const who = service.actorOf(req.user);
  if (who.id == null) return res.json({ ok: true, read: 0 });
  return res.json({ ok: true, ...notify.markAllRead(who.id) });
});

module.exports = router;
