/**
 * The snapshot every comparison of a check uses.
 *
 * A check is compared with NetBox more than once: when a person changes
 * something on it, before its write, and after its write. Each of those has to
 * read the same scan the same way, or the second one sees a NetBox that seems
 * to have moved. This is that one way: the scan's snapshot (reconciled, when
 * Review has produced one), a copy of it and never the stored object, the
 * switches and values a person declared by hand, and then what a person
 * changed on this check (overrides.js).
 *
 * It never requires service.js: write.js and verify.js require that, and this
 * sits under both.
 */
const store = require('./store');
const overrides = require('./overrides');

/**
 * sync. -> { snap, scan } | { error, code }
 *
 *   scanId    another scan of the same rack (a verification re-scan); the
 *             check's own scan by default
 *   snapshot  a snapshot already in hand (a test, or the write handing the
 *             check after it what it wrote from); copied, the overrides laid
 *             over it, and nothing read from disk
 *   extra     overrides not stored yet, laid over last: a change is tried on
 *             the comparison before it is kept
 */
function forPlan(plan, { scanId = null, snapshot = null, extra = [] } = {}) {
  let snap = snapshot;
  let scan = null;
  if (!snap) {
    const id = scanId != null ? scanId : plan && plan.scanId;
    if (id == null) return { error: 'this plan has no scan to write from' };
    scan = require('../netbox/store').getScan(id);
    if (!scan) return { error: 'the scan this plan was compared from is gone', code: 'not_found' };
    snap = (scan.payload && scan.payload.reconciled) || (scan.payload && scan.payload.snapshot);
    if (!snap) return { error: 'that scan has no detection result yet' };
    snap = structuredClone(snap);
    try {
      require('../netbox/unmanaged').applyTo(snap, scan.rackId);
      require('../netbox/entered').applyTo(snap, scan.rackId);
    } catch { /* a scan with no hand-declared extras compares just the same */ }
  }
  const live = [...(plan && plan.id != null ? store.overridesOf(plan.id) : []), ...(extra || [])];
  // A snapshot somebody handed over is theirs: it is copied before anything is
  // laid over it, and left alone when there is nothing to lay.
  if (snapshot && live.length) snap = structuredClone(snap);
  overrides.applyTo(snap, live);
  return { snap, scan };
}

module.exports = { forPlan };
