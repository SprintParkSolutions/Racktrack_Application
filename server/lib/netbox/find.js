/**
 * Find the customer's own record, not only our own.
 *
 * Until this file existed, the only way anything in this system found an object
 * in NetBox was client.findByUid, which filters on OUR custom field
 * racktrack_uid. Nothing looked a device up by its serial, its asset tag, its
 * name or its shelf. So a rack the customer filled in by hand was invisible:
 * every box in it was planned as a create, NetBox refused the ones that
 * collided, and the devices already in the record could not be reported either.
 *
 * This module answers one question and writes nothing: "which NetBox object is
 * this, if any". It is a resolver. It never patches, never creates, never
 * stamps a uid, and it has no side effects at all, so it can be called from a
 * preview as freely as from a write.
 *
 * The owner's sentence is "connect a rack to the database rack exactly the one,
 * I need 100 percent guarantee on that". The guarantee is not that this always
 * answers. It is that it NEVER names the wrong one. So:
 *
 *   1. Every lookup is SCOPED. A rack is looked up inside one site and never
 *      across the whole instance; a device by name inside one site, by position
 *      inside one rack. An unscoped lookup is refused with a sentence saying
 *      what would settle it, because "Rack 1" exists at every site there is.
 *   2. Every lookup asks for TWO rows and refuses when two answer, naming both.
 *      It never takes the first hit. A tie is never broken by sort order.
 *   3. Every hit is VERIFIED against the value that was asked for, in the same
 *      normalised form identity.js compares hardware values in, because NetBox's
 *      own text filters are looser than they look.
 *   4. An object already carrying a racktrack_uid that is not the one being
 *      asked about is NEVER returned. It belongs to another identity, and
 *      claiming it is the "one uid on two objects" trap.
 *   5. Every answer carries a plain English sentence a person reads.
 *
 * Three shapes come back, and only three:
 *
 *   { id, by, rank, evidence, confidence, row, why }   exactly one object
 *   { none: true, why }                                nothing answered
 *   { ambiguous: [ {id, name, ...}, ... ], why }       more than one answered
 *
 * `by` says which identifier did it: 'facility-id', 'serial', 'asset-tag',
 * 'rack-position' or 'name'. `rank` and `evidence` are minted through
 * identity.evidence so a rank this version cannot honestly produce cannot be
 * claimed here either. A record key - a facility id, a serial, an asset tag, a
 * rack and a shelf - is 'modelled' (rank 3): the system of record states it. A
 * NAME is 'inferred' (rank 8) with one candidate, which reads as 'possible' and
 * is never written, because standard 4.4 forbids a name as an identity: a name
 * finds the record, and proves nothing about the hardware in it.
 *
 * Nothing here binds anything. A bind is evidence plus a person, and the person
 * half arrives separately.
 */
const identity = require('./identity');
const { UID_FIELD } = require('./netbox');

/** The two endpoints this module looks in. */
const RACKS = '/api/dcim/racks/';
const DEVICES = '/api/dcim/devices/';

/** Ask for two. One is an answer; two is a refusal that names both. */
const LIMIT = 2;

const text = (v) => String(v ?? '').trim();

/** The uid an object carries, or ''. */
const uidOn = (row) => String(((row || {}).custom_fields || {})[UID_FIELD] ?? '');

/** A short, readable handle for a row in a refusal sentence. */
const label = (row) => {
  const r = row || {};
  const name = text(r.name) || text(r.display) || `id ${r.id}`;
  return `${name} (id ${r.id})`;
};

/**
 * Nothing is claimed.
 *
 * `blocked` separates the two reasons, and the difference decides whether a
 * weaker identifier may still be tried. Nothing in the record has this value,
 * so ask the next question: blocked false. Something DID answer and was refused
 * - it belongs to another identity - or the record would not answer at all:
 * blocked true, and the ladder stops there. A stronger key that has spoken is
 * never overruled by a weaker one.
 */
const none = (why, blocked = false) => ({ none: true, blocked, why });
const ambiguous = (rows, why) => ({
  ambiguous: rows.map((r) => ({ id: r.id, name: text(r.name) || null, uid: uidOn(r) || null })),
  why,
});

/**
 * Which evidence rank each identifier honestly earns.
 *
 *   record-binding  a person said so. Standard rank 1.
 *   facility-id, serial, asset-tag, rack-position
 *                   the system of record states it. Rank 3, 'modelled'.
 *   name            rank 8 with one candidate, which reads as 'possible' and is
 *                   never written: standard 4.4 forbids a name as an identity.
 */
const SOURCE_FOR = Object.freeze({
  'record-binding': 'confirmed',
  'facility-id': 'modelled',
  serial: 'modelled',
  'asset-tag': 'modelled',
  'rack-position': 'modelled',
  name: 'inferred',
});

/** The one answer, with its evidence minted honestly through identity.js. */
function found(row, by, why) {
  const source = SOURCE_FOR[by] || 'inferred';
  const evidence = source === 'inferred'
    ? identity.evidence('inferred', why, { candidateCount: 1 })
    : identity.evidence(source, why);
  return {
    id: row.id,
    by,
    rank: evidence.rank,
    evidence,
    confidence: identity.confidenceOf([evidence]),
    row,
    why,
  };
}

/**
 * One page of rows from an endpoint, or null when NetBox would not answer.
 *
 * null and [] are kept apart on purpose. [] means NetBox answered and there is
 * nothing there, which is a fact. null means we do not know, and a caller must
 * not read that as "nothing there" and go on to create a second copy.
 */
async function ask(client, endpoint, params) {
  try {
    const res = await client.get(endpoint, { ...params, limit: LIMIT });
    return Array.isArray(res && res.results) ? res.results : [];
  } catch {
    return null;
  }
}

/**
 * Judge one lookup's rows: one answer, no answer, or a refusal naming both.
 *
 * `keep` is the verification: NetBox's text filters match more loosely than
 * they read, so a row only counts when its own field really is the value that
 * was asked for. The count that decides ambiguity is the count of rows that
 * passed verification, so a loose filter's extra rows do not turn a clean
 * single answer into a refusal.
 */
function judge(rows, { by, uid, asked, keep }) {
  if (rows === null) {
    return none(`the record could not be asked about ${asked} just now, so nothing is claimed about it`, true);
  }
  const real = rows.filter(keep);
  if (!real.length) return none(`nothing in the record has ${asked}`);
  if (real.length > 1) {
    return ambiguous(real,
      `${real.length} records have ${asked}: ${real.map(label).join(' and ')}. `
      + 'Nothing here can tell them apart, so none of them is claimed.');
  }
  const row = real[0];
  const carried = uidOn(row);
  if (carried && carried !== text(uid)) {
    return none(
      `${label(row)} has ${asked}, but it is already recorded as ${carried}, `
      + 'so it belongs to another RackTrack record and is not claimed here', true);
  }
  return found(row, by, `the record holds ${label(row)} with ${asked}`);
}

/** Has this lookup settled the question, one way or the other? */
const settled = (out) => !out.none || out.blocked;

// ── the rack ────────────────────────────────────────────────────────────────

/**
 * Which NetBox rack is this, inside one site.
 *
 * Facility id first, because that is the customer's own key for the rack and
 * rack ladder rung 2 asks for it by name. Then the rack's name, which finds the
 * record and proves nothing on its own.
 *
 * `siteId` is REQUIRED and there is no unscoped form. An earlier design looked
 * a rack up by name across the whole instance and took the first hit, and three
 * reviewers refuted it for exactly the reason you would expect: "Rack 1" at
 * another site was adopted and then moved.
 */
async function findRack(client, { siteId = null, facilityId = null, name = null, uid = null } = {}) {
  const site = siteId === null || siteId === undefined || siteId === '' ? null : Number(siteId);
  if (!Number.isFinite(site)) {
    return none('a site is needed before a rack can be looked up: the same rack name and the '
      + 'same rack id are used at more than one site, so an unscoped lookup could name the wrong '
      + 'building. Say which site this rack is in.');
  }
  if (!client) return none('there is no connection to the record, so nothing is claimed about this rack');

  const facility = text(facilityId);
  if (facility) {
    const rows = await ask(client, RACKS, { site_id: site, facility_id: facility });
    const out = judge(rows, {
      by: 'facility-id', uid,
      asked: `rack id ${facility} at this site`,
      keep: (r) => text(r.facility_id).toLowerCase() === facility.toLowerCase(),
    });
    // A facility id that answered nothing falls through to the name. A facility
    // id that answered two racks, or one that belongs to somebody else, does
    // not: the stronger key has spoken and the weaker one must not overrule it.
    if (settled(out)) return out;
  }

  const want = text(name);
  if (!want) {
    return none('this rack has no rack id and no name to look up, so nothing is claimed about it');
  }
  const rows = await ask(client, RACKS, { site_id: site, name: want });
  return judge(rows, {
    by: 'name', uid,
    asked: `the name ${want} at this site`,
    keep: (r) => text(r.name).toLowerCase() === want.toLowerCase(),
  });
}

// ── the device ──────────────────────────────────────────────────────────────

/**
 * Which NetBox device is this box, strongest identifier first.
 *
 *   serial         the factory's own number. Normalised through identity.js, so
 *                  FDO-2117-A0X9, fdo 2117 a0x9 and FDO2117a0x9 are one serial.
 *   asset tag      the customer's own sticker. Unique across a NetBox install.
 *   rack and shelf what the record says is on this shelf. The plan calls this
 *                  provisional and so does this: it is 'modelled', never a
 *                  statement about the hardware in the slot.
 *   name           finds the record and proves nothing. Inside the rack first,
 *                  then inside the site. Exact only - no nearest-name guess,
 *                  ever.
 *
 * Every step refuses on two hits and names both. A serial search is deliberately
 * NOT narrowed to the rack: a device that moved rack is found where it actually
 * is, which is the plan's rack case 04, rather than read as new here and missing
 * there.
 */
async function findDevice(client, {
  rackId = null, position = null, serial = null, assetTag = null,
  name = null, siteId = null, face = null, uid = null,
} = {}) {
  if (!client) return none('there is no connection to the record, so nothing is claimed about this box');
  const site = siteId === null || siteId === undefined || siteId === '' ? null : Number(siteId);
  const rack = rackId === null || rackId === undefined || rackId === '' ? null : Number(rackId);
  const scope = Number.isFinite(site) ? { site_id: site } : {};
  const tried = [];

  // ── serial ────────────────────────────────────────────────────────────────
  const wantSerial = identity.normalise(serial);
  if (text(serial) && !identity.isJunkValue(serial)) {
    // The customer may have typed the serial with dashes or spaces where the
    // switch published it bare, so both spellings are asked for. Whatever comes
    // back is verified on the normalised form, which is the only comparison
    // that means anything.
    const spellings = [...new Set([text(serial), wantSerial].filter(Boolean))];
    let rows = [];
    for (const spelling of spellings) {
      const page = await ask(client, DEVICES, { ...scope, serial: spelling });
      if (page === null) { rows = null; break; }
      for (const r of page) if (!rows.some((held) => held.id === r.id)) rows.push(r);
    }
    const out = judge(rows, {
      by: 'serial', uid,
      asked: `the serial number ${text(serial)}`,
      keep: (r) => identity.normalise(r.serial) === wantSerial,
    });
    if (settled(out)) return out;
    tried.push('serial number');
  } else if (text(serial)) {
    tried.push(`serial number (${text(serial)} does not identify anything)`);
  }

  // ── asset tag ─────────────────────────────────────────────────────────────
  const wantTag = identity.normalise(assetTag);
  if (text(assetTag) && !identity.isJunkValue(assetTag)) {
    const rows = await ask(client, DEVICES, { ...scope, asset_tag: text(assetTag) });
    const out = judge(rows, {
      by: 'asset-tag', uid,
      asked: `the asset tag ${text(assetTag)}`,
      keep: (r) => identity.normalise(r.asset_tag) === wantTag,
    });
    if (settled(out)) return out;
    tried.push('asset tag');
  }

  // ── rack and shelf ────────────────────────────────────────────────────────
  const shelf = position === null || position === undefined || position === '' ? null : Number(position);
  if (Number.isFinite(rack) && Number.isFinite(shelf)) {
    const params = { rack_id: rack, position: shelf };
    if (text(face)) params.face = text(face);
    const rows = await ask(client, DEVICES, params);
    const out = judge(rows, {
      by: 'rack-position', uid,
      asked: `shelf U${shelf} of this rack`,
      keep: (r) => Number(r.position) === shelf
        && (!text(face) || !r.face || text((r.face || {}).value ?? r.face).toLowerCase() === text(face).toLowerCase()),
    });
    if (settled(out)) return out;
    tried.push('rack and shelf');
  }

  // ── name ──────────────────────────────────────────────────────────────────
  const want = text(name);
  if (want) {
    // Inside the rack first, then inside the site, and never wider. "SW1"
    // exists in every rack there is.
    const scopes = [];
    if (Number.isFinite(rack)) scopes.push([{ rack_id: rack }, 'in this rack']);
    if (Number.isFinite(site)) scopes.push([{ site_id: site }, 'at this site']);
    if (!scopes.length) {
      tried.push('name (there is no rack and no site to look inside, and a name on its own '
        + 'is not looked up across the whole record)');
    }
    for (const [params, where] of scopes) {
      const rows = await ask(client, DEVICES, { ...params, name: want });
      const out = judge(rows, {
        by: 'name', uid,
        asked: `the name ${want} ${where}`,
        keep: (r) => text(r.name).toLowerCase() === want.toLowerCase(),
      });
      if (settled(out)) return out;
    }
    if (scopes.length) tried.push('name');
  }

  const looked = tried.length ? `Looked by ${tried.join(', then ')}.` : 'There was nothing to look it up by.';
  return none(`nothing in the record matches this box. ${looked}`);
}

// ── an object a person already named ────────────────────────────────────────

/**
 * The object at this NetBox id, when it is safe to treat it as ours to bind.
 *
 * This is the other half of the resolver: a person has already said which
 * record a box is, and the id travels with the scan. It is still checked, and
 * checked by the same rule as every lookup above: an object carrying somebody
 * else's racktrack_uid is never handed back.
 *
 * It asks NetBox itself every time and never anything remembered, because the
 * answer decides a write, and a preload is a snapshot of a moment.
 */
async function byId(client, endpoint, netboxId, { uid = null } = {}) {
  const id = netboxId === null || netboxId === undefined || netboxId === '' ? null : Number(netboxId);
  if (!Number.isFinite(id)) return none('no record id was given, so nothing is claimed');
  if (!client) return none('there is no connection to the record, so nothing is claimed');
  let row;
  try {
    const res = await client.get(endpoint, { id });
    const hits = (Array.isArray(res && res.results) ? res.results : []).filter((r) => Number(r.id) === id);
    row = hits[0] || null;
  } catch {
    return none(`the record could not be asked about id ${id} just now, so nothing is claimed`, true);
  }
  if (!row) return none(`the record holds nothing at id ${id} any more`, true);
  const carried = uidOn(row);
  if (carried && carried !== text(uid)) {
    return none(`${label(row)} is already recorded as ${carried}, so it belongs to another `
      + 'RackTrack record and is not claimed here', true);
  }
  return found(row, 'record-binding', `a person named ${label(row)} as this object's record`);
}

module.exports = { findRack, findDevice, byId, RACKS, DEVICES };
