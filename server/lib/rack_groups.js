/**
 * Rack-group helpers — used by /api/analyze-video to record that N racks
 * were captured together in one video pan.
 *
 * Schema (created in auth.js migration):
 *   rack_groups(id PK, video_hash, tenant_id FK, created_by FK, created_at)
 *   rack_group_members(group_id FK, rack_id, position, label,
 *                      device_count, score, PK(group_id, rack_id))
 *
 * Public API:
 *   create({tenantId, userId, videoHash}) → groupId
 *   addMember({groupId, rackId, position, label, deviceCount, score})
 *   get(groupId)                          → { group, members[] }
 *   listForTenant(tenantId, limit)        → [{ id, created_at, count }]
 *   findGroupForRack(rackId)              → groupId | null
 */

const { randomUUID } = require('crypto');
const path = require('path');
const Database = require('better-sqlite3');
const { logger } = require('./observability');

const dbPath = path.join(__dirname, '..', 'data', 'auth.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

let _stmtInsertGroup, _stmtInsertMember, _stmtGetGroup, _stmtListMembers,
    _stmtListGroupsForTenant, _stmtFindGroupForRack, _stmtIsMember;
function _prep() {
  if (_stmtInsertGroup) return;
  _stmtInsertGroup = db.prepare(
    `INSERT INTO rack_groups (id, video_hash, tenant_id, created_by)
     VALUES (?, ?, ?, ?)`);
  _stmtInsertMember = db.prepare(
    `INSERT OR REPLACE INTO rack_group_members
       (group_id, rack_id, position, label, device_count, score)
     VALUES (?, ?, ?, ?, ?, ?)`);
  _stmtGetGroup = db.prepare(
    `SELECT id, video_hash, tenant_id, created_by, created_at
       FROM rack_groups WHERE id = ?`);
  _stmtListMembers = db.prepare(
    `SELECT rack_id, position, label, device_count, score
       FROM rack_group_members WHERE group_id = ?
       ORDER BY position ASC`);
  _stmtListGroupsForTenant = db.prepare(
    `SELECT g.id, g.created_at, COUNT(m.rack_id) AS count
       FROM rack_groups g
       LEFT JOIN rack_group_members m ON m.group_id = g.id
      WHERE g.tenant_id = ?
      GROUP BY g.id
      ORDER BY g.created_at DESC
      LIMIT ?`);
  // A rack can belong to SEVERAL groups — the rack id is a fingerprint of the
  // photo, so re-using the same photo in multiple two-rack scans adds a member
  // row per group. Always resolve to the MOST RECENT group, otherwise an old
  // group wins and the caller's freshly-created group is never found.
  _stmtFindGroupForRack = db.prepare(
    `SELECT m.group_id
       FROM rack_group_members m
       JOIN rack_groups g ON g.id = m.group_id
      WHERE m.rack_id = ?
      ORDER BY g.created_at DESC
      LIMIT 1`);
  _stmtIsMember = db.prepare(
    `SELECT 1 FROM rack_group_members WHERE group_id = ? AND rack_id = ? LIMIT 1`);
}

function create({ tenantId, userId = null, videoHash }) {
  _prep();
  const id = 'GRP-' + randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase();
  _stmtInsertGroup.run(id, String(videoHash), Number(tenantId), userId);
  logger.info({
    event: 'rack_group.created',
    groupId: id, tenantId, userId, videoHash,
  }, `created rack group ${id}`);
  return id;
}

function addMember({ groupId, rackId, position, label,
                     deviceCount = null, score = null }) {
  _prep();
  _stmtInsertMember.run(
    String(groupId), String(rackId), Number(position), String(label),
    deviceCount == null ? null : Number(deviceCount),
    score == null ? null : Number(score),
  );
}

function get(groupId) {
  _prep();
  const group = _stmtGetGroup.get(String(groupId));
  if (!group) return null;
  const members = _stmtListMembers.all(String(groupId));
  return { group, members };
}

function listForTenant(tenantId, limit = 100) {
  _prep();
  return _stmtListGroupsForTenant.all(
    Number(tenantId), Math.min(Math.max(1, limit), 1000));
}

function findGroupForRack(rackId) {
  _prep();
  const r = _stmtFindGroupForRack.get(String(rackId));
  return r ? r.group_id : null;
}

// Is this rack a member of this specific group? Lets callers ask for the exact
// group they just created rather than whichever one findGroupForRack picks.
function isMember(groupId, rackId) {
  _prep();
  return !!_stmtIsMember.get(String(groupId), String(rackId));
}

module.exports = { create, addMember, get, listForTenant, findGroupForRack, isMember };
