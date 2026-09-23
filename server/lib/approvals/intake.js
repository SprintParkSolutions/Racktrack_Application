/**
 * Tickets that were raised in ServiceNow, not in RackTrack.
 *
 * The workflow the owner described on 23 September 2026 has two doors. One is
 * RackTrack's own: an admin reads a check and raises a ticket from it. The
 * other is the one every data centre already uses - somebody raises an
 * incident in ServiceNow and gives it to a technician - and until this module
 * existed RackTrack knew nothing about those.
 *
 * So: ask ServiceNow what is open against this person, read each one for a
 * rack (lib/approvals/claim.js), and hand back the ones RackTrack can act on.
 * A ticket that names no rack we know is left alone rather than guessed at -
 * it is still their ticket, and ServiceNow is still where they work it.
 *
 * Nothing is written down. These are ServiceNow's rows, read each time and
 * cached for a minute so a phone that polls does not hammer the instance.
 */
const claim = require('./claim');

const CACHE_MS = 60_000;
const cache = new Map();   // userId -> { at, tasks }

const norm = (v) => String(v == null ? '' : v).trim();

/** The rack this ticket is about, as RackTrack knows racks. */
function rackFor(read, tenantIds) {
  if (!read) return null;
  const estate = require('../estate');

  // The scan's own id, which is what a RackTrack-raised ticket carries.
  if (read.rackId) {
    for (const tenantId of tenantIds) {
      try {
        const rack = estate.getRackByRackId(tenantId, read.rackId);
        if (rack) return { rackId: read.rackId, rackName: rack.name || rack.facility_id || null, tenantId };
      } catch { /* try the next site */ }
    }
    // A rack id nobody has bound yet is still a rack id: a photograph of it
    // can be compared, and the technician knows the sticker.
    return { rackId: read.rackId, rackName: null, tenantId: tenantIds[0] ?? null };
  }

  // The name a data centre calls it, which is what a person types.
  if (read.rackName) {
    const want = read.rackName.toUpperCase();
    for (const tenantId of tenantIds) {
      let racks = [];
      try { racks = estate.listRacks(tenantId) || []; } catch { racks = []; }
      const hit = racks.find((r) => [r.name, r.facility_id]
        .filter(Boolean).some((n) => String(n).toUpperCase() === want));
      if (hit) return { rackId: hit.rack_id || null, rackName: hit.name || hit.facility_id, tenantId };
    }
  }
  return null;
}

/**
 * What ServiceNow is holding for this person, as tasks the phone understands.
 *
 * `user` is the signed-in account. Returns [] whenever anything is missing -
 * no ServiceNow for the organisation, no matching user on the instance, the
 * instance unreachable - because this is one section of a screen, and a
 * screen that cannot draw one section still draws the rest.
 */
async function fromServiceNow(user, { fetchImpl, now = Date.now() } = {}) {
  const id = user && user.id;
  if (id == null) return [];
  const hit = cache.get(id);
  if (hit && now - hit.at < CACHE_MS) return hit.tasks;

  let tasks = [];
  try {
    const cfg = require('./connections').serviceNowFor({
      orgId: user.organizationId ?? user.orgId ?? null, userId: id,
    });
    if (!cfg) { cache.set(id, { at: now, tasks: [] }); return []; }

    const tickets = require('../netbox/tickets');
    const r = await tickets.assignedTo(cfg, { email: user.email || null }, fetchImpl);
    if (!r.ok || !r.incidents.length) { cache.set(id, { at: now, tasks: [] }); return []; }

    /* The sites this person can be sent to. Their own comes first, and the
       rest of the organisation's follow - a technician is often sent to a
       neighbouring site, and the ticket names the rack either way. */
    const estate = require('../estate');
    const store = require('./store');
    const tenantIds = [];
    if (user.tenantId != null) tenantIds.push(Number(user.tenantId));
    try {
      for (const u of store.usersOfOrg(user.organizationId ?? user.orgId ?? null) || []) {
        if (u && u.tenantId != null && !tenantIds.includes(Number(u.tenantId))) {
          tenantIds.push(Number(u.tenantId));
        }
      }
    } catch { /* their own site is enough */ }

    tasks = tickets && r.incidents.map((inc) => {
      const read = claim.decode([inc.summary, inc.description].filter(Boolean).join(' '));
      const rack = rackFor(read, tenantIds.length ? tenantIds : [null]);
      if (!rack || !rack.rackId) return null;
      let siteName = null;
      try {
        const site = rack.tenantId != null ? estate.getTenant(rack.tenantId) : null;
        siteName = (site && site.name) || null;
      } catch { siteName = null; }
      return {
        // ServiceNow's row, not a plan of ours: it has no check behind it yet.
        planId: null,
        uid: `sn:${inc.number}`,
        from: 'servicenow',
        summary: inc.summary || 'Look at this rack',
        note: inc.description && inc.description !== inc.summary ? inc.description : null,
        raisedBy: null,
        raisedAt: inc.openedAt,
        status: 'open',
        number: inc.number,
        url: inc.url,
        rackId: rack.rackId,
        rackName: rack.rackName,
        siteName,
        tenantId: rack.tenantId,
        claim: read,
      };
    }).filter(Boolean);
  } catch {
    tasks = [];
  }
  cache.set(id, { at: now, tasks });
  return tasks;
}

/** Forget what was read, for a test or a sign-out. */
function forget() { cache.clear(); }

module.exports = { fromServiceNow, rackFor, forget, CACHE_MS };
