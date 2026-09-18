/**
 * Join the camera scan with what the switches said about themselves.
 *
 * The camera knows WHERE a device sits (its U position) but guesses at what it
 * is. A managed switch knows exactly what it is (model, serial, every port)
 * but has no idea where it sits. Neither can be matched to the other
 * automatically with certainty, because the one shared handle -- how many
 * ports -- is not unique when a rack holds two identical switches. So the
 * match is proposed here by port count and CONFIRMED by a human in Review.
 *
 * Once a switch is matched to a rack position, this overwrites the camera's
 * guesses with the switch's own facts (Evidence.SNMP), keeps the U position
 * the camera gave (the switch cannot know it), and builds cables from LLDP
 * where both switches are known to this rack.
 *
 * Nothing is invented. A field the switch did not state stays exactly as the
 * camera left it, and a cable whose two ends cannot both be resolved is not
 * drawn.
 */
const {
  Evidence, observed, Manufacturer, DeviceType, Interface, Cable, Termination,
} = require('./model');
const switches = require('./switches');
const identity = require('./identity');
const bindings = require('./bindings');

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'x';

// Chassis ids and MACs arrive with assorted separators; compare on hex only.
const normId = (x) => String(x || '').toLowerCase().replace(/[^0-9a-f]/g, '');

const clone = (o) => JSON.parse(JSON.stringify(o));

/** NetBox interface type, chosen from speed and whether it reads as fibre. */
function ifTypeFor(i) {
  const s = Number(i.speedMbps) || 0;
  const fibre = /sfp|fibre|fiber|base-?x/i.test(i.type || '');
  if (s >= 10000) return '10gbase-x-sfpp';
  if (s >= 1000) return fibre ? '1000base-x-sfp' : '1000base-t';
  if (s >= 100) return '100base-tx';
  if (s > 0) return '10base-t';
  return '1000base-t';
}

/** Physical port count a switch reported. */
const portsOf = (sw) => (sw.reading?.counts?.interfaces
  ?? sw.reading?.interfaces?.length ?? 0);

/** Every switch filed against this rack, paired with its last reading. */
function gatherSwitches(rackId) {
  return switches.list(rackId).map((record) => ({
    record,
    reading: switches.loadData(record.id),
  }));
}

/** The camera's devices, flattened for matching and for the Review screen. */
function cameraDevices(snapshot) {
  const typeOf = (uid) => snapshot.deviceTypes.find((t) => t.uid === uid);
  const mfrName = (uid) => (snapshot.manufacturers.find((m) => m.uid === uid)?.name || '');
  return (snapshot.devices || []).map((d) => {
    const type = typeOf(d.deviceTypeUid);
    return {
      uid: d.uid,
      name: d.name,
      position: d.position,
      cvClass: d.provenance?.cvClass || '',
      // The rectangle on the rack photo, so the Network screen can offer the
      // picture as a way of choosing rather than only a list of names.
      box: Array.isArray(d.provenance?.box) ? d.provenance.box : null,
      portCount: (snapshot.interfaces || []).filter((i) => i.deviceUid === d.uid).length,
      model: type?.model || '',
      // The make OCR read off the faceplate, carried on the device's type.
      make: mfrName(type?.manufacturerUid),
      serial: d.serial || null,
    };
  });
}

/**
 * Normalise a make/model for comparison. "Unknown" and a bare "enterprise
 * <number>" (an SNMP vendor we could not name) both read as absent, so they
 * neither match nor penalise: an unnamed vendor is not a conflicting one.
 */
const norm = (s) => {
  const t = String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (t === 'unknown' || /^enterprise\d+$/.test(t)) return '';
  return t;
};

/**
 * Score one (switch, camera-device) pairing on three independent signals:
 * the model each claims, the make (OCR off the photo vs the switch's own
 * vendor), and how close their port counts are. Returns the score and a
 * plain-language reason, so the human verifying sees why it was proposed.
 *
 * None of these three is an identity. A model agreement is a shape agreement,
 * and two identical switches in one rack agree with each other exactly as well
 * as either agrees with itself. So a score is rank 8 evidence (standard section
 * 6, Inferred) and can never be better than 'possible'; what stops it being
 * acted on as a fact is the margin test in suggest, not the number itself.
 */
function scorePair(sw, dev) {
  const why = [];
  let score = 0;

  const swModel = norm(sw.model);
  const devModel = norm(dev.model);
  if (swModel && devModel && !devModel.startsWith('unidentified') && swModel === devModel) {
    score += 200; why.push(`same model ${sw.model}`);
  }

  const swMake = norm(sw.vendor);
  const devMake = norm(dev.make);
  if (swMake && devMake) {
    if (swMake === devMake) { score += 100; why.push(`both ${sw.vendor}`); }
    else { score -= 60; why.push(`make differs (${dev.make} vs ${sw.vendor})`); }
  }

  const diff = Math.abs(dev.portCount - sw.ports);
  const tol = Math.max(4, Math.round(sw.ports * 0.25));
  if (diff === 0) { score += 60; why.push(`exact ${sw.ports} ports`); }
  else if (diff <= tol) { score += 40 - diff * 2; why.push(`ports ${dev.portCount} close to ${sw.ports}`); }
  else { score -= 10; why.push(`ports ${dev.portCount} against ${sw.ports}`); }

  return { score, why: why.join(', ') };
}

// A managed switch answers SNMP, so it can only be an active network box in the
// rack. It is never a patch panel or a PDU, both passive, and matching one to a
// switch is always wrong. Auto-match only considers the active classes.
const PASSIVE_CLASS = new Set(['Patch Panel', 'PDU', 'Empty']);

// A score has to clear this before it counts as a candidate at all: at least a
// port-count agreement or a make match.
const FLOOR = 20;

// Two candidates this close are not two candidates, they are one answer we do
// not have. Nothing inside the margin is proposed; the switch shows blank and
// says what would settle it. Two identical switches in one rack score
// identically against the same box, which is the case this whole rule exists
// for - it is our own office rack.
const MARGIN = 25;

/**
 * How many shelves a device may occupy, by what the camera called it.
 *
 * Taken from the "Device Size and Rack Unit Occupancy" table in
 * docs/reference/rack-planning-guide.html. Used ONLY as a veto: a reading that
 * cannot fit the box is not a candidate for it. It never adds to a score,
 * because fitting is not evidence - almost everything fits.
 *
 * The open-ended rows in that table ("2U-4U+", "2U-6U+") are capped at 8 here,
 * and the guide says plainly that the figures are representative and must be
 * checked against the manufacturer. So the veto is deliberately one-sided: a
 * class the camera did not recognise gets no ceiling at all.
 */
const RU_BY_CLASS = new Map([
  ['patch panel', [1, 1]],
  ['cable manager', [1, 1]],
  ['switch', [1, 2]],
  ['network switch', [1, 2]],
  ['router', [1, 2]],
  ['firewall', [1, 2]],
  ['kvm', [1, 2]],
  ['server', [1, 4]],
  ['rack server', [1, 4]],
  ['storage', [2, 8]],
  ['storage system', [2, 8]],
  ['ups', [2, 8]],
]);

/**
 * The shelves each box in this photograph occupies.
 *
 * The engine's unit list is the direct answer and is per device; the device
 * type's height is a fallback, and only a fallback, because a type is shared by
 * model and its height is whichever box created it first.
 */
function spanByUid(snapshot) {
  const heightOf = new Map((snapshot.deviceTypes || []).map((t) => [t.uid, Number(t.uHeight)]));
  const out = new Map();
  for (const d of snapshot.devices || []) {
    const units = (Array.isArray(d.provenance?.cvUnits) ? d.provenance.cvUnits : [])
      .map((u) => parseInt(String(u).replace(/\D/g, ''), 10))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    const fromUnits = units.length ? units[units.length - 1] - units[0] + 1 : 0;
    const fromType = heightOf.get(d.deviceTypeUid);
    out.set(d.uid, fromUnits || (Number.isFinite(fromType) && fromType > 0 ? fromType : 1));
  }
  return out;
}

/**
 * Can this reading physically be this box? A plain reason when it cannot.
 *
 * Two rules, both from the rack planning guide's occupancy table:
 *   - a stack needs a shelf per member. Three members cannot sit on one shelf;
 *   - a box the camera named has a ceiling for its class. A single-chassis
 *     switch is 1U to 2U, so it is not the 4U box.
 *
 * A class the table does not name has no ceiling, so an unrecognised box is
 * never vetoed on size - only on the stack rule, which is about the reading.
 */
function sizeVeto(boxUnits, stackMembers, cvClass) {
  const units = Number(boxUnits) > 0 ? Number(boxUnits) : 1;
  const members = Number(stackMembers) > 0 ? Number(stackMembers) : 1;
  if (units < members) {
    return `it answers as a stack of ${members}, which needs at least ${members} shelves, `
      + `and this box takes up ${units}`;
  }
  const range = RU_BY_CLASS.get(String(cvClass || '').trim().toLowerCase());
  if (range) {
    const ceiling = range[1] * members;
    if (units > ceiling) {
      return `a ${String(cvClass).toLowerCase()} of this kind takes up to ${ceiling} `
        + `rack unit${ceiling === 1 ? '' : 's'}, and this box takes up ${units}`;
    }
  }
  return null;
}

/** The scope a rack's bindings live in, from the snapshot alone. */
function scopeFromSnapshot(snapshot) {
  const uid = String((snapshot?.racks || [])[0]?.uid || '').replace(/^rack:/, '');
  return bindings.scopeOf({ rackKey: uid || null });
}

/** Stable ordering, numbers as numbers, so the answer never depends on input order. */
function cmpId(a, b) {
  const x = Number(a);
  const y = Number(b);
  if (Number.isFinite(x) && Number.isFinite(y) && x !== y) return x - y;
  return String(a).localeCompare(String(b));
}

/**
 * Propose which box each switch is, and say nothing when it cannot be told.
 *
 * Three passes, in this order, because the order is the whole design:
 *
 *   1. A binding wins outright. Somebody stood at the rack and said this switch
 *      is this box; no amount of port counting overrules that. The binding is
 *      found by the SET of hardware aliases the switch published, so a reading
 *      that names a serial and a reading that names a chassis address both find
 *      the same one (lib/netbox/identity.js explains why that matters).
 *   2. Every remaining switch is scored against every remaining box, with a size
 *      veto first. A score is rank 8 evidence and tops out at 'possible'.
 *   3. Anything two switches or two boxes cannot be told apart goes blank, with
 *      a reason that says what would settle it.
 *
 * Deterministic: switches are worked in id order and candidates are ranked by
 * score then uid, so reversing the switch list cannot change a single answer.
 *
 * Returns { matches, reasons } with the field names it always had. Each reason
 * now also carries the evidence it rests on, its confidence under standard
 * section 7, how many boxes were in the candidate set (8.3), the margin over
 * the runner-up, and whether it came from a binding.
 *
 * `opts.scope` is the bindings scope, which the route computes from the scan's
 * tenant and rack key. Left out, it is derived from the snapshot's own rack uid,
 * which is the same value for an identified rack and the photo hash otherwise.
 */
function suggest(snapshot, sws, opts = {}) {
  const scope = opts.scope || scopeFromSnapshot(snapshot);
  const spans = spanByUid(snapshot);
  const devices = cameraDevices(snapshot)
    .filter((d) => !PASSIVE_CLASS.has(d.cvClass))
    .map((d) => ({
      ...d,
      // The switch's own port count is the truer number, so compare the
      // camera's detected ports to it, not the reverse.
      ports: d.portCount,
      vendor: d.make,
      units: spans.get(d.uid) || 1,
    }));
  const deviceByUid = new Map(devices.map((d) => [d.uid, d]));

  // Worked in id order, and the keys are created in id order too, so reversing
  // the switch list cannot change the answer or even the shape of it.
  const order = [...sws].sort((a, b) => cmpId(a.record.id, b.record.id));
  const matches = {};
  const reasons = {};
  for (const sw of order) { matches[sw.record.id] = null; reasons[sw.record.id] = null; }

  const facts = new Map();     // swId -> what the switch published about itself
  for (const sw of order) {
    facts.set(sw.record.id, {
      id: sw.record.id,
      label: sw.record.label,
      read: Boolean(sw.reading),
      ports: portsOf(sw),
      vendor: sw.reading?.system?.vendor || sw.reading?.identity?.manufacturer || null,
      model: sw.reading?.identity?.model || null,
      stackMembers: Number(sw.reading?.identity?.stackMembers) || 1,
      aliases: sw.reading ? identity.aliasesOf({ ...sw.reading, host: sw.record.host }) : [],
    });
  }

  // ── 1. bindings ────────────────────────────────────────────────────────────
  const claimedBy = new Map();   // devUid -> swId, boxes a binding has taken
  const proposals = new Map();   // swId -> { devUid, reason }
  for (const sw of order) {
    const f = facts.get(sw.record.id);
    const hit = f.aliases.length ? bindings.find(scope, f.aliases) : null;
    if (!hit) continue;
    const dev = deviceByUid.get(hit.binding.deviceUid);
    if (!dev) {
      reasons[f.id] = blank(
        `this switch was confirmed as a box that this photograph does not show. `
        + `Confirm it again against a box in this scan, or take the photograph the box is in`,
        { candidateCount: 0 },
      );
      continue;
    }
    if (claimedBy.has(dev.uid)) {
      reasons[f.id] = blank(
        `another switch record publishes the same hardware identity and is already `
        + `confirmed as this box. Remove whichever of the two is a duplicate`,
        { candidateCount: 0 },
      );
      continue;
    }
    claimedBy.set(dev.uid, f.id);
    // Two entries on purpose. The first is the person's act, which is what makes
    // this confirmed rather than a guess; the second is the honest note that we
    // are recalling it rather than watching it happen, which standard 10.1 asks
    // for. confidenceOf reads the pair as 'confirmed'.
    const ev = [
      ...(Array.isArray(hit.binding.evidence) ? hit.binding.evidence : []),
      identity.evidence('remembered',
        `recalled from the binding made on ${hit.binding.at}`, { by: hit.by }),
    ];
    proposals.set(f.id, {
      devUid: dev.uid,
      reason: {
        deviceUid: dev.uid,
        confidence: identity.confidenceOf(ev),
        why: `confirmed before as ${dev.name}, matched on its ${hit.by}`,
        evidence: ev,
        candidateCount: 1,
        margin: null,
        fromBinding: true,
      },
    });
  }

  // ── 2. scoring, with the size veto first ───────────────────────────────────
  for (const sw of order) {
    const f = facts.get(sw.record.id);
    if (proposals.has(f.id) || reasons[f.id]) continue;
    if (!f.read) {
      reasons[f.id] = blank('this switch has not been read yet, so it has published '
        + 'nothing to match a box on', { candidateCount: 0 });
      continue;
    }

    const candidates = [];
    const vetoed = [];
    for (const dev of devices) {
      if (claimedBy.has(dev.uid)) continue;    // a confirmed box is not up for scoring
      const veto = sizeVeto(dev.units, f.stackMembers, dev.cvClass);
      if (veto) { vetoed.push(`${dev.name}: ${veto}`); continue; }
      const { score, why } = scorePair(f, dev);
      if (score < FLOOR) continue;
      candidates.push({ devUid: dev.uid, name: dev.name, score, why });
    }
    candidates.sort((a, b) => b.score - a.score || String(a.devUid).localeCompare(String(b.devUid)));

    if (!candidates.length) {
      reasons[f.id] = blank(
        vetoed.length
          ? `no box in this rack fits it. ${vetoed[0]}`
          : 'no box in this rack looks like it. Pick the box by hand, or scan the rack again '
            + 'so the ports can be counted',
        { candidateCount: 0 },
      );
      continue;
    }

    const top = candidates[0];
    const second = candidates[1] || null;
    const margin = second ? top.score - second.score : null;
    const tied = candidates.filter((c) => top.score - c.score <= MARGIN);
    if (tied.length > 1) {
      const names = tied.map((c) => c.name).join(' and ');
      reasons[f.id] = blank(
        `${names} cannot be told apart from what this switch published. A serial number, `
        + 'a chassis address or somebody at the rack confirming which box it is would settle it',
        { candidateCount: candidates.length, margin },
      );
      continue;
    }

    // Rank 8, and the count that matters to standard 6.2 is how many boxes this
    // evidence could not tell apart - which the margin test has just made one.
    const ev = [identity.evidence('inferred', top.why, { candidateCount: tied.length })];
    proposals.set(f.id, {
      devUid: top.devUid,
      reason: {
        deviceUid: top.devUid,
        confidence: identity.confidenceOf(ev),
        why: candidates.length === 1
          ? `${top.why}, and it is the only box it could be`
          : top.why,
        evidence: ev,
        candidateCount: candidates.length,
        margin,
        fromBinding: false,
      },
    });
  }

  // ── 3. one box, one switch ─────────────────────────────────────────────────
  const claimants = new Map();
  for (const [swId, p] of proposals) {
    const a = claimants.get(p.devUid) || [];
    a.push(swId);
    claimants.set(p.devUid, a);
  }
  for (const ids of claimants.values()) {
    if (ids.length === 1) continue;
    // A binding cannot be in here - a bound box is never offered to scoring -
    // but if one ever were, the person's answer is the one that stands.
    const keep = ids.find((x) => proposals.get(x).reason.fromBinding) ?? null;
    for (const swId of ids) {
      if (swId === keep) continue;
      const others = ids.filter((x) => x !== swId).map((x) => facts.get(x).label || x);
      proposals.delete(swId);
      reasons[swId] = blank(
        `${others.join(' and ')} read as the same box as this one, and nothing in what they `
        + 'published tells them apart. Confirm each switch against its own box',
        { candidateCount: 1 },
      );
    }
  }

  for (const [swId, p] of proposals) {
    matches[swId] = p.devUid;
    reasons[swId] = p.reason;
  }
  return { matches, reasons };
}

/**
 * A reason for proposing nothing.
 *
 * Blank is a real answer here, not a failure (standard 7.3), so it carries the
 * same fields a match does and says what would settle it.
 */
function blank(why, { candidateCount = 0, margin = null } = {}) {
  return {
    deviceUid: null,
    confidence: 'unidentified',
    why,
    evidence: [],
    candidateCount,
    margin,
    fromBinding: false,
  };
}

/**
 * Apply confirmed matches to the camera snapshot and return the merged result.
 *
 * `matches` maps a switch id to a device uid (or null for "not in this rack").
 */
function reconcile(base, sws, matches) {
  const snap = clone(base);
  if (!snap.cables) snap.cables = [];
  const changes = [];

  const deviceByUid = new Map(snap.devices.map((d) => [d.uid, d]));
  const typeByUid = new Map(snap.deviceTypes.map((t) => [t.uid, t]));
  const mfrUids = new Set(snap.manufacturers.map((m) => m.uid));
  const byId = new Map(sws.map((s) => [s.record.id, s]));

  const ensureManufacturer = (name) => {
    if (!name) return null;
    const uid = `mfr:${slug(name)}`;
    if (!mfrUids.has(uid)) {
      snap.manufacturers.push(Manufacturer(observed(uid, Evidence.SNMP),
        { name, slug: slug(name) }));
      mfrUids.add(uid);
    }
    return uid;
  };

  // ── enrich each matched device from its switch ────────────────────────────
  for (const sw of sws) {
    const devUid = matches[sw.record.id];
    if (!devUid || !sw.reading) continue;
    const dev = deviceByUid.get(devUid);
    if (!dev) continue;

    const r = sw.reading;
    const ident = r.identity || {};
    const vendor = ident.manufacturer || r.system?.vendor || null;
    const mfrUid = ensureManufacturer(vendor);

    if (ident.model) {
      const typeUid = `dtype:${slug(ident.model)}`;
      if (!typeByUid.has(typeUid)) {
        const t = DeviceType(observed(typeUid, Evidence.SNMP), {
          manufacturerUid: mfrUid || typeByUid.get(dev.deviceTypeUid)?.manufacturerUid || '',
          model: ident.model, slug: slug(ident.model), uHeight: 1,
        });
        snap.deviceTypes.push(t);
        typeByUid.set(typeUid, t);
      }
      dev.deviceTypeUid = typeUid;
      dev.evidence = Evidence.SNMP;
      changes.push({ device: dev.name, field: 'model', was: null, now: ident.model });
    } else if (mfrUid) {
      // No ENTITY model (e.g. this D-Link), but we at least know the make.
      const t = typeByUid.get(dev.deviceTypeUid);
      if (t) t.manufacturerUid = mfrUid;
      changes.push({ device: dev.name, field: 'manufacturer', was: null, now: vendor });
    }

    if (ident.serial) {
      dev.serial = ident.serial;
      dev.evidence = Evidence.SNMP;
      changes.push({ device: dev.name, field: 'serial', was: null, now: ident.serial });
    }

    dev.customFields = { ...(dev.customFields || {}), managementIp: sw.record.host };
    if (ident.firmwareRev) dev.customFields.firmware = ident.firmwareRev;
    dev.provenance = {
      ...(dev.provenance || {}),
      switchId: sw.record.id, snmpHost: sw.record.host,
      sysName: r.system?.sysName || null, sysDescr: r.system?.sysDescr || null,
      stackMembers: ident.stackMembers || 1,
    };

    // Real ports replace the camera's port guesses entirely.
    snap.interfaces = snap.interfaces.filter((i) => i.deviceUid !== devUid);
    for (const i of r.interfaces || []) {
      snap.interfaces.push(Interface(
        observed(`if:${devUid}:${i.ifIndex}`, Evidence.SNMP,
          { ifIndex: i.ifIndex, oper: i.operStatus, speedMbps: i.speedMbps }),
        {
          deviceUid: devUid, name: i.name, type: ifTypeFor(i),
          description: i.alias || '', mac: i.mac || null,
          enabled: i.adminStatus !== 'down', label: null,
        }));
    }
    changes.push({ device: dev.name, field: 'ports', was: null,
      now: `${(r.interfaces || []).length} real ports` });
  }

  // ── cables from LLDP, only between switches we can place ───────────────────
  const byChassis = new Map();
  const bySysName = new Map();
  for (const s of sws) {
    if (!s.reading) continue;
    if (s.reading.localChassisId) byChassis.set(normId(s.reading.localChassisId), s);
    const nm = s.reading.system?.sysName;
    if (nm) { const a = bySysName.get(nm) || []; a.push(s); bySysName.set(nm, a); }
  }
  const remoteSwitchOf = (n) => {
    if (n.chassisId) {
      const hit = byChassis.get(normId(n.chassisId));
      if (hit) return hit;
    }
    if (n.remoteSysName) {
      const a = bySysName.get(n.remoteSysName);
      if (a && a.length === 1) return a[0]; // unique name only; no guessing
    }
    return null;
  };
  const ifUid = (devUid, name) => {
    if (!name) return null;
    const hit = snap.interfaces.find((i) => i.deviceUid === devUid && i.name === name);
    return hit ? hit.uid : null;
  };

  const cables = [];
  const seen = new Set();
  const unresolved = [];

  for (const sw of sws) {
    const devUid = matches[sw.record.id];
    if (!devUid || !sw.reading) continue;

    for (const n of sw.reading.neighbours || []) {
      const remote = remoteSwitchOf(n);
      if (!remote || remote.record.id === sw.record.id) continue;
      const remoteDevUid = matches[remote.record.id];
      if (!remoteDevUid) { unresolved.push({ from: sw.record.label, seen: n.remoteSysName || n.chassisId, why: 'the neighbour is a switch in this rack but not placed yet' }); continue; }

      const localIf = ifUid(devUid, n.localPortName) || ifUid(devUid, `port ${n.localPort}`);
      const remoteName = n.remotePortDesc || n.remotePortId;
      const remoteIf = ifUid(remoteDevUid, remoteName);
      if (!localIf || !remoteIf) {
        unresolved.push({ from: sw.record.label, seen: n.remoteSysName || remoteName,
          why: 'could not line the LLDP port name up with a port that was read' });
        continue;
      }

      const key = [localIf, remoteIf].sort().join('::');
      if (seen.has(key)) continue;
      seen.add(key);

      const mutual = (remote.reading.neighbours || []).some((rn) => {
        const back = remoteSwitchOf(rn);
        return back && back.record.id === sw.record.id;
      });

      const cable = Cable(
        observed(`cable:${slug(key)}`, mutual ? Evidence.LLDP_BOTH : Evidence.LLDP_ONE,
          { via: 'lldp', localPort: n.localPortName, remotePort: remoteName }),
        { a: Termination('dcim.interface', localIf), b: Termination('dcim.interface', remoteIf),
          type: 'cat6' });
      snap.cables.push(cable);
      cables.push({
        from: `${deviceByUid.get(devUid).name} · ${n.localPortName}`,
        to: `${deviceByUid.get(remoteDevUid).name} · ${remoteName}`,
        evidence: cable.evidence,
      });
    }
  }

  const summary = {
    switchesTotal: sws.length,
    matched: Object.values(matches).filter(Boolean).length,
    unmatched: sws.filter((s) => !matches[s.record.id]).length,
    serials: changes.filter((c) => c.field === 'serial').length,
    models: changes.filter((c) => c.field === 'model').length,
    cables: cables.length,
    cablesProven: cables.filter((c) => c.evidence === Evidence.LLDP_BOTH).length,
    changes,
    cableList: cables,
    unresolved,
  };
  return { snapshot: snap, summary };
}

/**
 * The whole picture the Review screen needs: the camera's devices, each
 * switch's headline facts, and the current or suggested matching.
 */
/**
 * Where the rack's photo can be fetched from, or null when none was kept.
 *
 * Adoption stores the absolute path of whatever file was on disk; the served
 * route is /outputs/<rackId>/<file>, so take the name and rebuild the path.
 */
function rackImageUrl(base, rackId) {
  const stored = (base.racks || [])[0]?.provenance?.image || '';
  const file = String(stored).split(/[\\/]/).pop();
  if (!file) return null;
  return `/outputs/${encodeURIComponent(rackId)}/${encodeURIComponent(file)}`;
}

function view(base, rackId, storedMatches, opts = {}) {
  const sws = gatherSwitches(rackId);
  const auto = suggest(base, sws, opts);
  const matches = storedMatches || auto.matches;
  const { summary } = reconcile(base, sws, matches);
  return {
    // The photo the camera read, as a URL this rack's owner may fetch. The
    // snapshot carries wherever the file sat on disk when it was adopted;
    // only its name survives into a path the client can ask for.
    image: rackImageUrl(base, rackId),
    devices: cameraDevices(base),
    switches: sws.map((s) => ({
      id: s.record.id,
      label: s.record.label,
      host: s.record.host,
      read: Boolean(s.reading),
      model: s.reading?.identity?.model || null,
      serial: s.reading?.identity?.serial || null,
      vendor: s.reading?.system?.vendor || null,
      sysName: s.reading?.system?.sysName || null,
      // The maker's own MIB gives these where the standard one is silent —
      // and the Switches tab wants them, because a firmware version read off
      // the box beats one read off a photograph of the box.
      hardware: s.reading?.identity?.hardwareRev || null,
      firmware: s.reading?.identity?.firmwareRev || null,
      uptimeSeconds: s.reading?.system?.uptimeSeconds ?? null,
      ports: portsOf(s),
      neighbours: s.reading?.counts?.neighbours ?? 0,
      matchedTo: matches[s.record.id] || null,
      // Why the auto-matcher proposed this, for the user to verify against.
      autoMatch: auto.reasons[s.record.id] || null,
    })),
    matches,
    reasons: auto.reasons,
    summary,
    suggested: !storedMatches,
  };
}

// slug is shared with the writer, which has to undo it to find the hash-based
// uid a keyed cable was written under: the two must agree on one rule.
// PASSIVE_CLASS is shared with the reconcile route, which has to refuse a posted
// match onto a patch panel or a PDU: one list, in one place.
module.exports = {
  gatherSwitches, cameraDevices, suggest, reconcile, view, slug, PASSIVE_CLASS,
};
