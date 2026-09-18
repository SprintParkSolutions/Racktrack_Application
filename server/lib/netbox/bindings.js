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
 * scope is a tenant plus the scan's rack id - the one handle on a rack that
 * nothing recomputes. A second photo of the same rack lands in the same scope and
 * finds the same bindings by alias, without anybody confirming anything twice.
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
 * Keyed on the scan's rackId, which is a hash of the photograph and never
 * changes for the life of the rack's record, and NOT on the customer's rack key.
 * The key was the obvious choice and it was wrong: recogniseRack fails soft to
 * null whenever NetBox is unreachable for a second, so the same rack moved
 * between `t7|t7:5` and `t7|RK-ABCD` on an ordinary re-adopt and every
 * confirmation for it became invisible. The rackKey is recorded INSIDE each
 * binding instead, where losing the lookup cannot lose the record.
 *
 * The tenant is in front because racktrack_uid is one namespace for a whole
 * NetBox instance: two tenants that both type RK-ROW1 must not share bindings.
 */
function scopeOf({ tenantId = null, rackId = null } = {}) {
  const t = tenantId === null || tenantId === undefined || tenantId === ''
    ? '0' : str(tenantId, 40);
  return `t${t}|${str(rackId, 200) || 'unknown'}`;
}

/**
 * The scopes this rack's bindings may already sit in, from before the scope was
 * keyed on the rackId alone, and from a scan whose tenant was not yet known.
 *
 * Read so nobody's confirmation is lost, and migrated forward the first time the
 * rack is opened. Never written to.
 */
function legacyScopesOf({ tenantId = null, rackKey = null, rackId = null } = {}) {
  const t = tenantId === null || tenantId === undefined || tenantId === ''
    ? '0' : str(tenantId, 40);
  const key = str(rackKey, 200);
  const id = str(rackId, 200);
  const out = [];
  if (key) { out.push(`t${t}|${key}`); out.push(`t0|${key}`); }
  if (id && t !== '0') out.push(`t0|${id}`);
  return [...new Set(out)].filter((s) => s !== scopeOf({ tenantId, rackId }));
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
 * edited file is not - the record confirmed against THIS switch record wins
 * first, then the strongest shared alias, then the oldest binding, so the answer
 * never depends on file order and two records sharing one alias cannot hand each
 * other's box over on a coin toss.
 *
 * `opts.switchId` is the record being matched, used only as that tie-breaker.
 * `opts.weak` also reports a binding that shares nothing but a name or a
 * management address. It is NEVER returned as a match (4.3, 4.4); it comes back
 * as { weak: true } so the reason can say the confirmation exists and name what
 * to re-read.
 */
function find(scope, aliases, { switchId = null, weak = false } = {}) {
  const wanted = Array.isArray(aliases) ? aliases : [];
  if (!wanted.length) return null;
  const want = switchId === null || switchId === undefined ? null : String(switchId);
  let best = null;
  let nearest = null;
  for (const b of read(scope).items) {
    const hit = identity.sameDevice(b.aliases, wanted);
    if (!hit.same) {
      if (!weak || nearest) continue;
      const shared = identity.weakOverlap(b.aliases, wanted);
      if (shared.length) {
        nearest = { binding: view(b), by: identity.kindOf(shared[0]), rank: null,
                    alias: shared[0], weak: true, refutedBy: hit.refutedBy || null };
      }
      continue;
    }
    const mine = want !== null && String(b.switchId ?? '') === want;
    const better = best === null
      || (mine && !best.mine)
      || (mine === best.mine && (hit.rank < best.rank
        || (hit.rank === best.rank && b.id < best.binding.id)));
    if (better) {
      best = { binding: view(b), by: hit.by, rank: hit.rank, alias: hit.alias, weak: false, mine };
    }
  }
  if (best) { delete best.mine; return best; }
  return nearest;
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
  scanId = null, snapshotStamp = null, boxPrint = null, rackKey = null,
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
    // The photograph this was observed against. Standard 10.1: a position is
    // observed fresh in each scan, and an earlier one is retained as a rank 4
    // source, never presented as current. These three fields are how the matcher
    // tells the two apart - same scan and same detection result means the
    // person's act is about the picture on the screen now; anything else is a
    // recollection, and a recollection is 'probable' at best.
    scanId: scanId === null || scanId === undefined ? null : str(scanId, 60),
    snapshotStamp: str(snapshotStamp, 80) || null,
    // What the box looked like when the person confirmed it, so a later
    // photograph showing a different box at the same shelf is a contradiction
    // (a replacement, 10.3) rather than something bound silently.
    boxPrint: boxPrint && typeof boxPrint === 'object' ? view(boxPrint) : null,
    // The customer's rack this scan was recognised as, when it was. Recorded
    // here rather than in the file name, because a NetBox lookup that fails for
    // one second must not move the record.
    rackKey: str(rackKey, 200) || null,
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

/**
 * Move every binding held under an older scope spelling into this one.
 *
 * Called when a rack is opened, so a confirmation made when the scope was keyed
 * on the customer's rack key is found under the scope keyed on the rack id.
 * Idempotent, and it only writes when it actually moved something: a record
 * whose box is already bound here, or whose identity is, is left behind rather
 * than fighting with the newer answer.
 */
function migrate(scope, legacyScopes = []) {
  const moved = [];
  for (const from of Array.isArray(legacyScopes) ? legacyScopes : []) {
    if (!from || from === scope) continue;
    const old = read(from);
    if (!old.items.length) continue;
    const db = read(scope);
    let changed = false;
    for (const b of old.items) {
      const clash = db.items.some((held) => held.deviceUid === b.deviceUid
        || identity.sameDevice(held.aliases, b.aliases).same);
      if (clash) continue;
      db.items.push({ ...view(b), id: db.nextId++, scope: String(scope || ''), movedFrom: from });
      moved.push(b.deviceUid);
      changed = true;
    }
    if (changed) write(scope, db);
  }
  return moved;
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

module.exports = {
  scopeOf, legacyScopesOf, fileFor, list, find, confirm, forget, migrate, DIR,
};
