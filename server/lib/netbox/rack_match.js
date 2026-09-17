/**
 * Recognise the rack.
 *
 * A scan is identified only by a hash of its photo (the RK- id). That hash is
 * never the name the customer's own record uses, so the SPOC lookup and the
 * NetBox write land on a fresh rack instead of the real one. This resolves the
 * scan to the rack the customer already has, so both land on the right rack.
 *
 * The honest half, phase 1. It matches only on what we already store, and it
 * refuses to guess:
 *
 *   - A scan is tied to a SPACE when it is captured. A space holds racks the
 *     admin typed in setup, each carrying a real name and, often, a facility id.
 *   - We match the scan to one of those typed racks, and only when it is
 *     unambiguous: the scan's own chosen name equals a typed rack in the space,
 *     or the space holds exactly one typed rack.
 *   - Then we look that rack up in NetBox (by facility id first, then name) to
 *     get the name NetBox actually uses.
 *
 * Anything unclear stays unresolved and the caller keeps today's behaviour. We
 * never pick between two racks on nothing, and we never write here.
 */

const estate = require('../estate');

/**
 * The write key for a typed rack: rack:t<tenant>:<racks_known.id>.
 *
 * Minted from the row's own id, which is unique across every tenant that
 * shares a NetBox, and never from anything the admin typed: two tenants each
 * typing RK-ROW1 must not merge their racks in a NetBox both of them use.
 */
const rackKeyFor = (tenantId, rowId) => `rack:t${Number(tenantId)}:${Number(rowId)}`;

/** Choose the one typed rack this scan is, or none when it cannot be told. */
function pickCandidate(candidates, scanName) {
  if (!candidates.length) return { rack: null, why: 'no rack has been set up in this space' };
  if (scanName) {
    const want = String(scanName).trim().toLowerCase();
    const byName = candidates.find((r) => r.name && r.name.trim().toLowerCase() === want);
    if (byName) return { rack: byName, source: 'name', why: 'its name matches a rack set up in this space' };
  }
  if (candidates.length === 1) {
    return { rack: candidates[0], source: 'space', why: 'the only rack set up in this space' };
  }
  return { rack: null, source: 'space',
    why: `${candidates.length} racks are set up in this space and nothing tells them apart yet` };
}

/** Find the customer's rack in NetBox: facility id first (the stronger key), then name. */
async function findInNetBox(client, known) {
  if (!client || !known) return null;
  const one = async (params) => {
    try {
      const r = await client.get('/api/dcim/racks/', { ...params, limit: 1 });
      return (r && r.results && r.results[0]) || null;
    } catch { return null; }
  };
  let nb = null;
  if (known.facility_id) nb = await one({ facility_id: known.facility_id });
  if (!nb && known.name) nb = await one({ name: known.name });
  return nb;
}

/**
 * Resolve a scanned rack to the customer's rack.
 *
 * Returns a stable shape whatever happens, so a caller can always read `.name`:
 *   { name, netboxId, knownRackId, spaceId, tenantId, rackKey, confidence, source, why }
 * `name` is the rack to use downstream: the NetBox name when confirmed, else the
 * typed name, else the fallback the caller passed. `confidence` is one of
 * 'confirmed' (found in NetBox), 'known' (a typed rack, not yet in NetBox), or
 * 'none' (unresolved — behave exactly as before).
 *
 * `rackKey` is the key NetBox uids are built on, rack:t<tenant>:<row>. It is
 * set only when the scan was identified explicitly (source 'name' or
 * 'set-up-directly') and is null under the only-rack-in-the-space rule, which
 * may name the rack and its contact but never chooses the write key.
 */
async function resolveRack(client, { tenantId, rackId, scanName = null, fallbackName = null } = {}) {
  const out = {
    name: fallbackName ?? (rackId ?? null),
    netboxId: null, knownRackId: null, spaceId: null,
    tenantId: tenantId ?? null,
    rackKey: null,
    confidence: 'none', source: 'scan',
    why: 'this scan is not tied to a rack the customer has set up',
  };
  if (tenantId == null || !rackId) return out;

  let bound = null;
  try { bound = estate.getRackByRackId(tenantId, rackId); } catch { bound = null; }
  if (!bound) return out;
  out.spaceId = bound.space_id ?? null;

  // If the scan's own row was typed (it carries a name or a facility id), it is
  // already the known rack — no need to look across the space.
  let known = (bound.name || bound.facility_id) ? bound : null;
  // How the typed rack was chosen. Kept apart from `source`, which NetBox may
  // refine to 'facility-id' below: the key depends on how the scan was tied to
  // a typed rack, not on how NetBox confirmed that rack.
  let how;
  if (known) {
    how = 'set-up-directly';
    out.source = how;
    out.why = 'this rack was set up directly';
  } else {
    if (bound.space_id == null) return out;
    let inSpace = [];
    try { inSpace = estate.listRacks(tenantId, bound.space_id) || []; } catch { inSpace = []; }
    const candidates = inSpace.filter(
      (r) => String(r.rack_id) !== String(rackId) && (r.name || r.facility_id));
    const picked = pickCandidate(candidates, scanName);
    if (!picked.rack) { out.why = picked.why; return out; }
    known = picked.rack;
    how = picked.source;
    out.source = picked.source;
    out.why = picked.why;
  }

  out.knownRackId = known.id ?? null;
  // Only an explicit identification chooses the write key: the scan's own row
  // was typed, or its chosen name matched a typed rack. "The only rack set up
  // in this space" still names the rack and its contact, but it never picks
  // the key: a room with one typed rack and twelve physical ones would merge
  // all twelve into that one record.
  if ((how === 'name' || how === 'set-up-directly') && known.id != null) {
    out.rackKey = rackKeyFor(tenantId, known.id);
  }
  if (known.name) { out.name = known.name; out.confidence = 'known'; }

  const nb = await findInNetBox(client, known);
  if (nb) {
    out.name = nb.name;
    out.netboxId = nb.id ?? null;
    out.confidence = 'confirmed';
    if (known.facility_id && nb.facility_id === known.facility_id) out.source = 'facility-id';
    out.why = 'matched a rack already in NetBox';
  } else if (known.name) {
    out.why = 'matched a rack the customer set up; not in NetBox yet';
  } else {
    // The typed rack has only a facility id and NetBox has no such rack, so
    // there is no name to use. Stay unresolved rather than invent one.
    out.name = fallbackName ?? rackId;
    out.confidence = 'none';
    out.why = 'a rack is set up here but has no name and is not in NetBox';
  }
  return out;
}

module.exports = { resolveRack, pickCandidate, findInNetBox, rackKeyFor };
