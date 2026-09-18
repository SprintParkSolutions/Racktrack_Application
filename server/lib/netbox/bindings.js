/**
 * Bindings: which device a person said sits in which box, kept outside the scan.
 *
 * A binding is a dated, sourced statement that one device identity occupies one
 * box in one rack (standard section 2). It is a record in its own right, and the
 * reason it lives here rather than in the scan payload is a bug we had:
 * store.setPayload rewrites a scan's payload wholesale, so re-adopting a rack, or
 * re-running detection on it, silently dropped every match anybody had confirmed.
 * A person's answer must outlive the photograph they gave it about.
 *
 * So the file is keyed on the rack, not the scan: one file per scope, where a
 * scope is a tenant plus the key the scan's uids were built on. A second photo of
 * the same identified rack lands in the same scope and finds the same bindings by
 * alias, without anybody confirming anything twice.
 *
 * Written in the same shape as unmanaged.js: plain JSON on disk, read and written
 * whole. There is no query load here - a rack holds a handful of boxes - and a
 * database would be one more thing to fail on a fresh machine. When that stops
 * being true, this module is the only thing that changes.
 *
 * What it will not do:
 *   - store a binding whose identity is only a name or a management address
 *     (standard 4.3, 4.4). Nothing weaker than a serial, chassis, bridge or
 *     management address gets to be an identity;
 *   - keep two bindings for one box, or two for one identity. A confirm replaces
 *     whatever it contradicts, and says so in the record it returns.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const identity = require('./identity');

const DATA_DIR = process.env.RT_DATA_DIR || path.join(__dirname, '..', 'data');
const DIR = path.join(DATA_DIR, 'bindings');

const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const asInt = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : null; };

/**
 * The scope a binding belongs to: this tenant, this rack.
 *
 * `rackKey` is the customer's own rack (t7:5) when the scan was identified
 * explicitly, and the scan's rack id (RK-XYZ) when it was not - exactly what
 * cv.toSnapshot keys every uid on. Using the same value here is what makes a
 * second photo of an identified rack find the first photo's bindings, and what
 * keeps two unidentified photos honestly separate.
 *
 * The tenant is in front because racktrack_uid is one namespace for a whole
 * NetBox instance: two tenants that both type RK-ROW1 must not share bindings.
 */
function scopeOf({ tenantId = null, rackKey = null, rackId = null } = {}) {
  const t = tenantId === null || tenantId === undefined || tenantId === ''
    ? '0' : str(tenantId, 40);
  const where = str(rackKey, 200) || str(rackId, 200) || 'unknown';
  return `t${t}|${where}`;
}

/**
 * The file a scope lives in.
 *
 * A readable slug so a person can find it, plus a hash of the exact scope so two
 * scopes can never land in one file however they are spelled.
 */
function fileFor(scope) {
  const s = String(scope || '');
  const slug = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'scope';
  const hash = crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
  return path.join(DIR, `${slug}-${hash}.json`);
}

function read(scope) {
  const file = fileFor(scope);
  if (!fs.existsSync(file)) return { scope: String(scope || ''), nextId: 1, items: [] };
  try {
    const db = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      scope: String(scope || ''),
      nextId: asInt(db.nextId) || 1,
      items: Array.isArray(db.items) ? db.items : [],
    };
  } catch {
    // A corrupt file is not a reason to fail a scan. It is a reason to behave as
    // though nobody has confirmed anything yet, which is the honest answer.
    return { scope: String(scope || ''), nextId: 1, items: [] };
  }
}

function write(scope, db) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(fileFor(scope), JSON.stringify(db, null, 2));
}

const view = (r) => JSON.parse(JSON.stringify(r));

/** Every binding in this scope, oldest first. */
function list(scope) {
  return read(scope).items.map(view);
}

/**
 * The binding for this identity, found by a shared strong alias.
 *
 * Returns { binding, by, rank } or null. When several bindings share an alias
 * with the identity - which a confirm is supposed to make impossible, but a hand
 * edited file is not - the strongest shared alias wins, and the oldest binding
 * breaks a tie, so the answer never depends on file order.
 */
function find(scope, aliases) {
  const wanted = Array.isArray(aliases) ? aliases : [];
  if (!wanted.length) return null;
  let best = null;
  for (const b of read(scope).items) {
    const hit = identity.sameDevice(b.aliases, wanted);
    if (!hit.same) continue;
    if (best === null || hit.rank < best.rank || (hit.rank === best.rank && b.id < best.binding.id)) {
      best = { binding: view(b), by: hit.by, rank: hit.rank, alias: hit.alias };
    }
  }
  return best;
}

/**
 * Record that a person put this device in this box.
 *
 * Replaces anything it contradicts: the box's previous binding, and any binding
 * that shares a strong alias with this identity. One box has at most one
 * binding, and one identity is bound in at most one box per rack, so a device
 * that moved down two shelves does not end up bound twice (standard 10.2).
 *
 * Refuses an identity with no strong alias. A binding keyed on a name is what
 * 4.4 exists to forbid, and it would be worse than no binding at all, because it
 * would be believed.
 */
function confirm(scope, {
  aliases, deviceUid, position = null, switchId = null,
  evidence = null, by = null, at = null, why = '',
} = {}) {
  const strong = (Array.isArray(aliases) ? aliases : []).filter((a) => identity.isStrong(a));
  if (!strong.length) {
    return { error: 'This switch published nothing that identifies it, so the match cannot be confirmed. '
      + 'A serial number, a chassis address, a bridge address or a management MAC is needed.' };
  }
  const uid = str(deviceUid, 200);
  if (!uid) return { error: 'Say which box is being confirmed.' };

  const ev = Array.isArray(evidence) && evidence.length
    ? evidence
    : [identity.evidence('confirmed', why || 'a person on site confirmed this box')];
  const confidence = identity.confidenceOf(ev);

  const db = read(scope);
  const keep = [];
  const replaced = [];
  for (const b of db.items) {
    const sameBox = b.deviceUid === uid;
    const sameThing = identity.sameDevice(b.aliases, aliases).same;
    if (sameBox || sameThing) replaced.push(view(b));
    else keep.push(b);
  }

  const rec = {
    id: db.nextId++,
    scope: String(scope || ''),
    deviceUid: uid,
    position: asInt(position),
    switchId: switchId === null || switchId === undefined ? null : str(switchId, 40),
    // The whole set, not only the strong ones: a later reading that publishes
    // only the name still reads as the same record, and the strong aliases are
    // what identity.sameDevice will actually match on.
    aliases: [...new Set((Array.isArray(aliases) ? aliases : []).map((a) => str(a, 200)))].sort(),
    evidence: ev,
    confidence,
    by: by === null || by === undefined ? null : str(by, 120),
    at: str(at, 40) || nowIso(),
    why: str(why, 500),
  };
  db.items = [...keep, rec];
  write(scope, db);
  return { binding: view(rec), replaced };
}

/** Drop the binding for a box. Used when a person says it is not that one. */
function forget(scope, deviceUid) {
  const uid = str(deviceUid, 200);
  const db = read(scope);
  const before = db.items.length;
  db.items = db.items.filter((b) => b.deviceUid !== uid);
  if (db.items.length === before) return { error: 'Nothing is bound to that box.' };
  write(scope, db);
  return { ok: true, forgot: uid };
}

module.exports = { scopeOf, fileFor, list, find, confirm, forget, DIR };
