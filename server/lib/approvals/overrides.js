/**
 * What a person changed on a check before approving it, applied to the scan.
 *
 * The write is driven by the scan snapshot: the comparison reads it, the push
 * walks it, the check after the write reads it again. So a change a person
 * makes cannot live on the item alone - the next comparison would not know
 * about it, NetBox would seem to have moved, and the write would be refused.
 * A change is an OVERRIDE: a row in approval_overrides, and this one function
 * that lays every live override of a check over its snapshot. snapshot.forPlan
 * calls it for the compare a change is checked with, for the write and for the
 * check after the write, which is the whole of "applied identically".
 *
 * Three kinds, and the lists are closed:
 *
 *   move     the record a box really is sits on another shelf in NetBox. The
 *            box is bound to that record (the same answer a person gives on
 *            the phone), and the shelf - position, and face only when it
 *            differs - may be written on it. Reachable only through the
 *            wrong_shelf suggestion, never by hand.
 *   offline  a record the scan did not see is marked offline. Never deleted.
 *            Reachable only through the mark_offline suggestion.
 *   value    a serial number, an asset tag or a description typed by hand.
 *
 * No database, no network, no clock: the rows come in, the snapshot changes.
 */

const MOVE_FIELDS = ['position', 'face'];
const VALUE_FIELDS = { serial: 'serial', asset_tag: 'assetTag', description: 'description' };
const KINDS = ['move', 'offline', 'value'];
/** How long a typed value may be: NetBox holds a serial and an asset tag in 50 characters, a description in 200. */
const VALUE_LIMIT = { serial: 50, asset_tag: 50, description: 200 };

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const pairOf = (v) => (isObject(v) && 'to' in v ? v : null);
const shelf = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);

/**
 * Is this a change a person may make? Throws with a sentence when it is not.
 * Anything outside the three closed lists is refused here, so nothing else can
 * ever reach the snapshot: not a name, not a role, not a rack, not a site.
 */
function validate(kind, fields) {
  if (!KINDS.includes(kind)) throw new Error(`'${kind}' is not a change a person can make`);
  if (!isObject(fields) || !Object.keys(fields).length) throw new Error('a change has to say what it changes');
  for (const [key, value] of Object.entries(fields)) {
    if (!pairOf(value)) throw new Error(`${key} has to say what it was and what it becomes`);
  }
  const keys = Object.keys(fields);
  if (kind === 'move') {
    const extra = keys.filter((k) => !MOVE_FIELDS.includes(k));
    if (extra.length) throw new Error(`a shelf move changes the shelf and nothing else, not ${extra.join(', ')}`);
    if (!fields.position) throw new Error('a shelf move has to name the shelf');
    if (shelf(fields.position.from) === null || shelf(fields.position.to) === null) {
      throw new Error('a shelf is a whole number of units');
    }
    if (fields.face && !['front', 'rear'].includes(String(fields.face.to))) {
      throw new Error('a face is front or rear');
    }
  }
  if (kind === 'offline') {
    if (keys.length !== 1 || keys[0] !== 'status' || fields.status.to !== 'offline') {
      throw new Error('a record not seen can be marked offline and nothing else');
    }
  }
  if (kind === 'value') {
    const extra = keys.filter((k) => !Object.prototype.hasOwnProperty.call(VALUE_FIELDS, k));
    if (extra.length) {
      throw new Error(`only a serial number, an asset tag or a description can be changed by hand, not ${extra.join(', ')}`);
    }
    for (const k of keys) {
      const to = fields[k].to;
      if (to !== null && typeof to !== 'string') throw new Error(`${k} has to be text`);
      if (typeof to === 'string' && to.length > VALUE_LIMIT[k]) {
        throw new Error(`${k} can be ${VALUE_LIMIT[k]} characters at most`);
      }
    }
  }
  return true;
}

/**
 * The catalogue entries only the moved boxes used.
 *
 * A box the camera minted brings a device type, a role and perhaps a
 * manufacturer with it. Once the box is the customer's own record its type and
 * role are theirs and are never written, so those entries would be made in
 * NetBox for nothing. They are not taken out of the snapshot - the box still
 * refers to them, and the walk skips a box whose references are missing - they
 * are named here, and the writer leaves a named entry unmade.
 */
function unneededScaffolding(snap, movedUids) {
  const devices = Array.isArray(snap.devices) ? snap.devices : [];
  const kept = devices.filter((d) => !movedUids.has(d.uid));
  const moved = devices.filter((d) => movedUids.has(d.uid));
  const usedTypes = new Set(kept.map((d) => d.deviceTypeUid).filter(Boolean));
  const usedRoles = new Set(kept.map((d) => d.roleUid).filter(Boolean));
  const types = new Set(moved.map((d) => d.deviceTypeUid).filter((u) => u && !usedTypes.has(u)));
  const roles = new Set(moved.map((d) => d.roleUid).filter((u) => u && !usedRoles.has(u)));
  const allTypes = Array.isArray(snap.deviceTypes) ? snap.deviceTypes : [];
  const usedMakers = new Set(allTypes.filter((t) => !types.has(t.uid)).map((t) => t.manufacturerUid).filter(Boolean));
  const makers = new Set(allTypes.filter((t) => types.has(t.uid)).map((t) => t.manufacturerUid)
    .filter((u) => u && !usedMakers.has(u)));
  return [...types, ...roles, ...makers].sort();
}

/**
 * Lay the overrides over the snapshot. Mutates `snap` (the caller hands in a
 * copy) and returns it. Applying the same overrides twice changes nothing more.
 */
function applyTo(snap, overrides) {
  if (!snap || typeof snap !== 'object') return snap;
  const live = (overrides || []).filter((o) => o && !o.revokedAt && KINDS.includes(o.kind));
  if (!live.length) return snap;
  const movedUids = new Set();

  for (const o of live) {
    const fields = isObject(o.fields) ? o.fields : {};
    if (o.kind === 'move') {
      const uid = o.itemUid;
      const netboxId = Number(o.netboxId);
      if (!uid || !Number.isInteger(netboxId) || !pairOf(fields.position)) continue;
      const binding = isObject(snap.recordBinding) ? snap.recordBinding : {};
      const shown = isObject(binding.shown) ? binding.shown : {};
      snap.recordBinding = {
        ...binding,
        deviceNetboxIds: { ...(isObject(binding.deviceNetboxIds) ? binding.deviceNetboxIds : {}), [uid]: netboxId },
        shown: { ...shown, devices: { ...(isObject(shown.devices) ? shown.devices : {}), [uid]: o.shown || null } },
        by: o.createdBy ?? binding.by ?? null,
        at: o.createdAt ?? binding.at ?? null,
      };
      // The shelf, and the face only where it differs. Nothing else is ever in here.
      const allowed = { position: { from: fields.position.from, to: fields.position.to } };
      if (pairOf(fields.face) && fields.face.from !== fields.face.to) {
        allowed.face = { from: fields.face.from, to: fields.face.to };
      }
      snap.approvedMoves = { ...(isObject(snap.approvedMoves) ? snap.approvedMoves : {}),
        [uid]: { netboxId, fields: allowed } };
      // The record being moved is the customer's and keeps the ports the
      // customer gave it. A port the camera counted on the box is never
      // proposed on their record, so the box's own children leave the
      // comparison: every array whose rows hang off a device by deviceUid.
      for (const [key, rows] of Object.entries(snap)) {
        if (Array.isArray(rows) && rows.some((r) => r && typeof r === 'object' && 'deviceUid' in r)) {
          snap[key] = rows.filter((r) => !(r && r.deviceUid === uid));
        }
      }
      movedUids.add(uid);
    }
    if (o.kind === 'offline') {
      const netboxId = Number(o.netboxId);
      if (!Number.isInteger(netboxId) || !pairOf(fields.status)) continue;
      snap.approvedOffline = { ...(isObject(snap.approvedOffline) ? snap.approvedOffline : {}),
        [netboxId]: { uid: `nb:device:${netboxId}`, name: o.recordName ?? (o.shown && o.shown.name) ?? null,
          from: fields.status.from ?? 'active', to: 'offline' } };
    }
    if (o.kind === 'value') {
      const device = (Array.isArray(snap.devices) ? snap.devices : []).find((d) => d.uid === o.itemUid);
      if (!device) continue;
      for (const [key, prop] of Object.entries(VALUE_FIELDS)) {
        if (pairOf(fields[key])) device[prop] = fields[key].to;
      }
    }
  }

  if (movedUids.size) {
    const unneeded = unneededScaffolding(snap, movedUids);
    if (unneeded.length) {
      snap.deferScaffolding = [...new Set([...(Array.isArray(snap.deferScaffolding) ? snap.deferScaffolding : []),
        ...unneeded])].sort();
    }
  }
  return snap;
}

module.exports = { applyTo, validate, MOVE_FIELDS, VALUE_FIELDS: Object.keys(VALUE_FIELDS), KINDS };
