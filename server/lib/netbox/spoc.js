/**
 * Who a ticket for this rack goes to.
 *
 * NetBox already models people: contacts, roles, and assignments onto a rack
 * or a site. So the single point of contact is not another thing for us to
 * store and get out of step — it is read from the customer's own record at the
 * moment a ticket is raised.
 *
 * Falls back up the hierarchy, because a rack often has no contact of its own
 * and the site's applies. Returns null rather than guessing: a ticket assigned
 * to nobody is honest; a ticket assigned to the wrong person is not.
 */

const SPOC_ROLE = 'spoc';

/** One assignment row -> the bit we need. */
function toPerson(row, via) {
  const c = row.contact || {};
  if (!c.name) return null;
  return {
    name: c.name,
    email: c.email || null,
    phone: c.phone || null,
    title: c.title || null,
    role: (row.role && (row.role.name || row.role.slug)) || null,
    priority: (row.priority && (row.priority.value || row.priority)) || null,
    via,
    netboxId: c.id ?? null,
  };
}

/** Assignments on one object, best first. NetBox sorts by priority already. */
async function assignmentsFor(client, objectType, objectId, roleSlug) {
  if (!objectId) return [];
  const params = {
    object_type: objectType,
    object_id: objectId,
    ...(roleSlug ? { role: roleSlug } : {}),
  };
  try {
    const res = await client.get('/api/tenancy/contact-assignments/', params);
    return res.results || [];
  } catch {
    return [];
  }
}

/**
 * The SPOC for a rack, by name, falling back to its site.
 *
 * `rackName` rather than an id, because that is what a scan carries. One
 * lookup resolves it, and the rack row also gives us the site to fall back to.
 */
async function forRack(client, rackName) {
  const out = { spoc: null, others: [], rack: null, site: null, why: null };
  if (!rackName) { out.why = 'no rack name'; return out; }

  let rack;
  try {
    const res = await client.get('/api/dcim/racks/', { name: rackName, limit: 1 });
    rack = (res.results || [])[0];
  } catch (err) {
    out.why = `could not reach NetBox: ${err.message}`;
    return out;
  }
  if (!rack) { out.why = `no rack named ${rackName} in NetBox`; return out; }

  out.rack = { id: rack.id, name: rack.name };
  out.site = rack.site ? { id: rack.site.id, name: rack.site.name } : null;

  const onRack = await assignmentsFor(client, 'dcim.rack', rack.id, SPOC_ROLE);
  const first = onRack.map((r) => toPerson(r, 'rack')).filter(Boolean)[0];
  if (first) {
    out.spoc = first;
  } else if (out.site) {
    const onSite = await assignmentsFor(client, 'dcim.site', out.site.id, SPOC_ROLE);
    out.spoc = onSite.map((r) => toPerson(r, 'site')).filter(Boolean)[0] || null;
    if (!out.spoc) out.why = 'no contact with the SPOC role on this rack or its site';
  } else {
    out.why = 'the rack has no site, and no SPOC of its own';
  }

  // Everyone else attached to the rack, so a person can pick somebody different.
  const all = await assignmentsFor(client, 'dcim.rack', rack.id, null);
  out.others = all.map((r) => toPerson(r, 'rack'))
    .filter(Boolean)
    .filter((p) => !out.spoc || p.name !== out.spoc.name);

  return out;
}

/** Everybody NetBox knows about, for an assignee dropdown. */
async function everyone(client) {
  try {
    const res = await client.get('/api/tenancy/contacts/', { limit: 100 });
    return (res.results || [])
      .filter((c) => c.name)
      .map((c) => ({
        name: c.name, email: c.email || null, title: c.title || null,
        phone: c.phone || null, netboxId: c.id,
      }));
  } catch {
    return [];
  }
}

module.exports = { forRack, everyone, SPOC_ROLE };
