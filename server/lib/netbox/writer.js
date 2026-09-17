/**
 * The NetBox writer.
 *
 * Four rules decide whether this is deployable. They are implemented here, not
 * described elsewhere and hoped for:
 *
 *   1. IDEMPOTENT.  NetBox has no upsert. Every object carries our uid in the
 *      racktrack_uid custom field; we GET by it, then POST or PATCH. Push the
 *      same scan twice and NetBox holds one clean set of records. A scan
 *      later keyed on the customer's rack finds the records it wrote under
 *      its photo hash and REBINDS them (the uid field alone, and only once
 *      the admin has seen and approved it) rather than writing a second set.
 *   2. DRY-RUN FIRST.  plan() performs no writes and returns the exact diff
 *      push() would apply.
 *   3. NEVER DELETE.  There is no delete path in this module or in the client
 *      it uses. A device that has vanished from a scan is REPORTED for a human
 *      to judge; it is never removed, and not even set offline unless asked.
 *      A tool that removes production records loses all trust the first time
 *      it is wrong, and it will eventually be wrong.
 *   4. CONFIDENCE -> STATUS.  Proven becomes `connected`, camera-only becomes
 *      `planned`, and a CONFLICT is not exported at all — a disagreement is a
 *      finding for review, not a fact to write down.
 */
const { exportable, EXPORT_ORDER } = require('./model');
const { orderedSpecs, objectTypes, withUid } = require('./mapping');
const { UID_FIELD, NetBoxError } = require('./netbox');

/**
 * A reference to an object that will not exist until this push runs.
 * Kept distinct from a real id so the dry-run diff can say "this depends on a
 * create earlier in the plan" instead of inventing a change.
 */
class Pending {
  constructor(label, uid) { this.label = label; this.uid = uid; }
  toString() { return `new:${this.label}:${this.uid}`; }
}
const isPending = (v) => v instanceof Pending;

/**
 * NetBox's value for `key`, flattened to something comparable.
 * It nests foreign keys as {id, ...} and choice fields as {value, label}.
 */
function current(existing, key) {
  const v = existing[key];
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    if ('id' in v) return v.id;
    if ('value' in v) return v.value;
  }
  if (key.endsWith('_terminations') && Array.isArray(v)) {
    return v.map((t) => ({ object_type: t.object_type, object_id: t.object_id }));
  }
  // A front port's rear_ports come back with the rear port nested as {id, ...}.
  if (key === 'rear_ports' && Array.isArray(v)) {
    return v.map((m) => ({
      position: m.position,
      rear_port: m.rear_port && typeof m.rear_port === 'object' ? m.rear_port.id : m.rear_port,
      rear_port_position: m.rear_port_position,
    }));
  }
  return v;
}

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * What would change, and what cannot be judged yet.
 * A field whose new value is Pending is not a difference — it is a reference
 * to something this same plan will create. Reporting it would be noise at
 * best and a false positive at worst.
 */
function diff(payload, existing) {
  const changed = {};
  const pending = [];
  for (const [k, next] of Object.entries(payload)) {
    if (k === 'custom_fields' || next === undefined) continue;
    if (isPending(next)) { pending.push(k); continue; }
    // rear_ports nests its reference one level down.
    if (k === 'rear_ports' && Array.isArray(next) && next.some((m) => isPending(m.rear_port))) {
      pending.push(k); continue;
    }
    const old = current(existing, k);
    if ((old === null || old === undefined) && (next === '' || next === null)) continue;
    if (!sameValue(old, next)) changed[k] = { from: old ?? null, to: next };
  }
  return { changed, pending };
}

/**
 * The uid an object carried before its rack was keyed, or null.
 *
 * A keyed snapshot builds every rack-scoped uid on the customer's rack key
 * where the photo hash used to be: rack:<key>, dev:<key>:u10,
 * if:dev:<key>:u10:1. Putting the hash back into that one segment gives the
 * uid the same object was written under before it was keyed. A uid that does
 * not carry the key (a manufacturer, a device type, a site) was never
 * rack-scoped and has no alias.
 */
function aliasUid(uid, key, hash) {
  if (!uid || !key || !hash) return null;
  const at = String(uid).indexOf(`:${key}`);
  if (at < 0) return null;
  const end = at + 1 + key.length;
  // The key has to be the whole segment: rack:t7:5 is not rack:t7:51.
  if (end < uid.length && uid[end] !== ':') return null;
  return `${uid.slice(0, at + 1)}${hash}${uid.slice(end)}`;
}

async function walk(snapshot, client, apply, report) {
  const resolved = new Map();   // our uid -> NetBox id (or Pending)
  const skipped = new Set();    // uids excluded, so dependents can say why
  const failed = new Set();
  const counts = {};
  let rackNetboxId = null;

  const bump = (k) => { counts[k] = (counts[k] || 0) + 1; };

  // Ask NetBox for this rack's objects once per type, up front, instead of
  // once per object inside the loop below. Every uid this snapshot writes
  // carries the rack id (rack:RK-…, dev:RK-…:u16, if:dev:RK-…), so a single
  // "contains RK-…" filter on the custom field brings back everything of ours
  // on that endpoint. Shared objects — manufacturers, device types, roles —
  // carry no rack id and still resolve one at a time; there are a handful.
  const rackKey = String(snapshot.rackUid || '').replace(/^rack:/, '');
  // A snapshot keyed on the customer's rack remembers the hash-based rack uid
  // it carried before (aliasOf). Objects written under that hash are the same
  // objects: the plan REBINDS each one (our custom field moves to the new uid,
  // nothing else is touched, and the admin sees it as a row like any other)
  // instead of creating a twin beside it.
  const aliasHash = String(snapshot.aliasOf || '').replace(/^rack:/, '');
  const alias = rackKey && aliasHash && aliasHash !== rackKey ? { key: rackKey, hash: aliasHash } : null;
  if (rackKey && typeof client.preloadByUid === 'function') {
    const endpoints = [...new Set(orderedSpecs().map((s) => s.endpoint))];
    for (const ep of endpoints) {
      await client.preloadByUid(ep, { [`cf_${UID_FIELD}__ic`]: rackKey });
      // What a rebind looks for carries the hash, not the key, so it needs its
      // own preload or every rebound object costs a round trip.
      if (alias) await client.preloadByUid(ep, { [`cf_${UID_FIELD}__ic`]: alias.hash });
    }
  }

  for (const spec of orderedSpecs()) {
    for (const obj of snapshot[spec.field] || []) {
      const misses = [];
      const ref = (uid) => {
        if (!uid) return null;
        if (resolved.has(uid)) return resolved.get(uid);
        misses.push(uid);
        return null;
      };

      const name = obj.name || obj.model || obj.label || obj.uid;

      // Rule 4 — a conflict is a finding, not a fact.
      if (!exportable(obj.evidence)) {
        skipped.add(obj.uid);
        report.changes.push({
          type: spec.label, uid: obj.uid, name: String(name), action: 'skip',
          reason: `evidence=${obj.evidence}, so it goes to review and never to NetBox`,
        });
        bump('skip');
        continue;
      }

      const payload = withUid(spec.payload(obj, ref), obj.uid, obj.customFields || {});

      if (misses.length) {
        const blockedBy = misses.filter((u) => skipped.has(u) || failed.has(u));
        skipped.add(obj.uid);
        report.changes.push({
          type: spec.label, uid: obj.uid, name: String(name), action: 'skip',
          reason: blockedBy.length
            ? `depends on excluded/failed object(s): ${blockedBy.join(', ')}`
            : `unresolved reference(s): ${misses.join(', ')}`,
        });
        bump('skip');
        continue;
      }

      let existing;
      try {
        existing = await client.findByUid(spec.endpoint, obj.uid);
      } catch (err) {
        failed.add(obj.uid);
        report.changes.push({
          type: spec.label, uid: obj.uid, name: String(name), action: 'fail',
          reason: `lookup failed: ${JSON.stringify(err.detail ?? err.message)}`,
        });
        bump('fail');
        continue;
      }

      if (existing) {
        const { changed, pending } = diff(payload, existing);
        resolved.set(obj.uid, existing.id);
        if (spec.field === 'racks') rackNetboxId = existing.id;

        if (!Object.keys(changed).length) {
          report.changes.push({
            type: spec.label, uid: obj.uid, name: String(name), action: 'noop',
            netboxId: existing.id, pendingRefs: pending,
          });
          bump('noop');
          continue;
        }
        if (apply) {
          try {
            await client.patch(spec.endpoint, existing.id, payload);
          } catch (err) {
            failed.add(obj.uid);
            report.changes.push({
              type: spec.label, uid: obj.uid, name: String(name), action: 'fail',
              netboxId: existing.id, reason: JSON.stringify(err.detail ?? err.message),
            });
            bump('fail');
            continue;
          }
        }
        report.changes.push({
          type: spec.label, uid: obj.uid, name: String(name), action: 'update',
          netboxId: existing.id, diff: changed, pendingRefs: pending,
        });
        bump('update');
        continue;
      }

      // Nothing carries this uid. Before calling it a create: was this same
      // object written under the scan's old hash uid? Then it is not new, it
      // is ours to rebind. Only the custom field moves; the object's name,
      // site, height and position are left exactly as they are.
      const oldUid = alias ? aliasUid(obj.uid, alias.key, alias.hash) : null;
      let previous = null;
      if (oldUid) {
        try {
          previous = await client.findByUid(spec.endpoint, oldUid);
        } catch (err) {
          failed.add(obj.uid);
          report.changes.push({
            type: spec.label, uid: obj.uid, fromUid: oldUid, name: String(name), action: 'fail',
            reason: `lookup of ${oldUid} failed: ${JSON.stringify(err.detail ?? err.message)}`,
          });
          bump('fail');
          continue;
        }
      }
      if (previous) {
        if (apply) {
          // Look once more, right before the patch. The plan found the new uid
          // absent, but another writer may have minted it since, and two
          // objects with one uid is the failure the uid exists to prevent.
          let taken;
          try {
            taken = await client.findByUid(spec.endpoint, obj.uid);
          } catch (err) {
            failed.add(obj.uid);
            report.changes.push({
              type: spec.label, uid: obj.uid, fromUid: oldUid, name: String(name), action: 'fail',
              netboxId: previous.id, reason: `lookup failed: ${JSON.stringify(err.detail ?? err.message)}`,
            });
            bump('fail');
            continue;
          }
          if (taken) {
            failed.add(obj.uid);
            report.changes.push({
              type: spec.label, uid: obj.uid, fromUid: oldUid, name: String(name), action: 'fail',
              netboxId: previous.id, reason: 'target uid already exists',
            });
            bump('fail');
            continue;
          }
          try {
            await client.patch(spec.endpoint, previous.id, { custom_fields: { [UID_FIELD]: obj.uid } });
          } catch (err) {
            failed.add(obj.uid);
            report.changes.push({
              type: spec.label, uid: obj.uid, fromUid: oldUid, name: String(name), action: 'fail',
              netboxId: previous.id, reason: JSON.stringify(err.detail ?? err.message),
            });
            bump('fail');
            continue;
          }
        }
        resolved.set(obj.uid, previous.id);
        if (spec.field === 'racks') rackNetboxId = previous.id;
        report.changes.push({
          type: spec.label, uid: obj.uid, fromUid: oldUid, name: String(name), action: 'rebind',
          netboxId: previous.id, diff: { [UID_FIELD]: { from: oldUid, to: obj.uid } },
        });
        bump('rebind');
        continue;
      }

      // Nothing in NetBox carries this uid — it is a create.
      if (apply) {
        let created;
        try {
          created = await client.post(spec.endpoint, payload);
        } catch (err) {
          failed.add(obj.uid);
          report.changes.push({
            type: spec.label, uid: obj.uid, name: String(name), action: 'fail',
            reason: JSON.stringify(err.detail ?? err.message),
          });
          bump('fail');
          continue;
        }
        resolved.set(obj.uid, created.id);
        if (spec.field === 'racks') rackNetboxId = created.id;
        report.changes.push({
          type: spec.label, uid: obj.uid, name: String(name), action: 'create',
          netboxId: created.id,
        });
      } else {
        resolved.set(obj.uid, new Pending(spec.label, obj.uid));
        report.changes.push({
          type: spec.label, uid: obj.uid, name: String(name), action: 'create',
        });
      }
      bump('create');
    }
  }

  report.counts = counts;
  report.orphans = await orphans(snapshot, client, rackNetboxId, report, alias);
  return report;
}

/**
 * Devices NetBox holds for this rack that this scan did not see.
 *
 * Rule 3. These are REPORTED, never deleted. Scoped two ways on purpose: only
 * inside this snapshot's rack, and only objects carrying our own uid — so a
 * device someone else created, or one in another rack, is invisible to this
 * check and can never be touched by it.
 */
async function orphans(snapshot, client, rackNetboxId, report, alias = null) {
  if (rackNetboxId === null || isPending(rackNetboxId)) return [];
  let present;
  try {
    present = await client.paginate('/api/dcim/devices/', { rack_id: rackNetboxId });
  } catch (err) {
    report.warnings.push(`could not check for orphaned devices: ${err.message}`);
    return [];
  }
  const seen = new Set();
  for (const d of snapshot.devices || []) {
    seen.add(d.uid);
    // A device this plan rebinds still carries its old uid until the push
    // runs. It was seen; it simply has not been renamed yet.
    const old = alias ? aliasUid(d.uid, alias.key, alias.hash) : null;
    if (old) seen.add(old);
  }
  return present.flatMap((d) => {
    const uid = (d.custom_fields || {})[UID_FIELD];
    if (!uid || seen.has(uid)) return [];
    return [{
      netboxId: d.id, name: d.name, uid, status: (d.status || {}).value,
      recommendation: 'Review. It was in a previous scan and is absent from this one. '
                    + 'Not deleted. Set status=offline only after a human checks.',
    }];
  });
}

const newReport = (snapshot, dryRun, client) => ({
  rackUid: snapshot.rackUid, dryRun, netboxUrl: client.url,
  customField: '', changes: [], orphans: [], counts: {}, warnings: [],
});

/**
 * Dry run. Performs no writes and returns exactly what push() would do.
 *
 * ensureField is off by default so a plan really is read-only. The cost is
 * that if the racktrack_uid custom field does not exist yet, nothing can be
 * matched and every object reads as a create — so we say so out loud rather
 * than let the number mislead.
 */
async function plan(snapshot, client, { ensureField = false } = {}) {
  const report = newReport(snapshot, true, client);
  const cf = await client.customField();
  if (!cf) {
    if (ensureField) {
      await client.ensureCustomField(objectTypes());
      report.customField = 'created (schema change made so this diff is accurate)';
    } else {
      report.customField = 'ABSENT';
      report.warnings.push(
        `'${UID_FIELD}' custom field does not exist yet, so nothing can be matched `
        + 'and every object below reads as a create. Export creates it automatically; '
        + 'pass ensureField for an accurate pre-flight diff.');
    }
  } else {
    report.customField = 'present';
  }
  return walk(snapshot, client, false, report);
}

/** Write to NetBox. Idempotent: safe to run on the same scan repeatedly. */
async function push(snapshot, client) {
  const report = newReport(snapshot, false, client);
  const cf = await client.ensureCustomField(objectTypes());
  report.customField = cf.action;
  return walk(snapshot, client, true, report);
}

module.exports = { plan, push, Pending, isPending, diff, current, aliasUid, EXPORT_ORDER, NetBoxError };
