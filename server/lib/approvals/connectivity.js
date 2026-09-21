/**
 * Ports: what the photo shows against what the network says.
 *
 * Three witnesses, one row per socket. The camera saw the front of the box and
 * says whether a socket holds a cable. The switch was read over SNMP and says
 * whether the port is up. NetBox is the record and says whether a cable is
 * documented there. The first is physical and the other two are logical, and
 * the row's verdict is the one against the others:
 *
 *   mismatch   the camera is sure, and a logical witness that answered says
 *              the opposite - a cable where the port is down or nothing is
 *              recorded, an empty socket where the port is up or a cable is;
 *   match      the camera is sure, at least one logical witness answered, and
 *              every one that did agrees with it;
 *   unknown    anything else. A socket the camera could not read, or a port
 *              nobody else has spoken for, is not a finding.
 *
 * Nothing is measured here. Every value comes out of what is already stored:
 * the scan's snapshot (reconcile.cameraDevices), the last reading of each
 * switch filed against the rack, joined to a box through the same matching the
 * Review screen shows (reconcile.view), and the interfaces NetBox holds for the
 * record a box is known by - the plan item's own record, or the record the
 * comparison found sitting on that box (an orphan with `matchedBox`).
 *
 * LINING PORTS UP. Socket n is the port whose name ends in n, and only when
 * the two sides carry the same number of sockets. Where they do not, or where
 * the switch is a stack answering as one, that witness says nothing for the
 * whole box and the row says why. A wrong pairing would turn one miscounted
 * socket into a column of false alarms, so there is no best guess.
 *
 * Passive boxes - patch panels, power strips - are left out: nothing logical
 * can ever answer for them.
 */
const reconcile = require('../netbox/reconcile');
const fingerprint = require('../netbox/fingerprint');
const bindings = require('../netbox/bindings');
const identity = require('../netbox/identity');
const scans = require('../netbox/store');

const CACHE_MS = 60 * 1000;
const NO_SWITCH = 'No switch has been read for this rack yet.';
const NO_SCAN = 'The scan behind this check could not be read.';
const NOT_LINED_UP = 'The port numbers could not be lined up.';

/** NetBox interface types that are not a socket on the front of a box. */
const NOT_PHYSICAL = new Set(['virtual', 'lag', 'bridge']);

const lower = (v) => String(v ?? '').toLowerCase();

/** The number a port's name ends in: Gi1/0/3 is port 3. */
function trailingNumber(name) {
  const m = /(\d+)\s*$/.exec(String(name ?? ''));
  return m ? Number(m[1]) : null;
}

/** What the camera says of one socket. */
const cameraWord = (status) => (status === 'connected' ? 'cabled' : status === 'empty' ? 'empty' : 'unknown');

/** What the switch says of one port. A port it never reported on is not a "down". */
function switchWord(port) {
  const s = port ? port.operStatus : null;
  if (s === 1 || lower(s) === 'up') return 'up';
  if (s === 2 || lower(s) === 'down') return 'down';
  return 'unknown';
}

/** What NetBox records for one interface. */
function netboxWord(iface) {
  if (!iface) return 'unknown';
  const ends = iface.connected_endpoints;
  return iface.cable || (Array.isArray(ends) && ends.length) ? 'connected' : 'not_connected';
}

/**
 * Whether a reading is a stack answering as one switch. The same test
 * reconcile applies: chassis rows are only believed as members where they
 * carry distinct serial numbers.
 */
function isStack(reading) {
  const members = Array.isArray(reading?.identity?.members) ? reading.identity.members : [];
  const serials = new Set(members
    .map((m) => lower(m && m.serial).replace(/[^a-z0-9]+/g, ''))
    .filter((s) => s && !identity.isJunkValue(s)));
  return serials.size >= 2;
}

/**
 * Ports by the number their name ends in, or null when the two sides cannot
 * be lined up at all. A number two ports share (Gi1/0/1 and Te1/1/1) answers
 * for neither.
 */
function byNumber(ports, socketCount) {
  if (ports.length !== socketCount) return null;
  const out = new Map();
  const twice = new Set();
  for (const p of ports) {
    const n = trailingNumber(p.name);
    if (n === null) continue;
    if (out.has(n)) twice.add(n);
    out.set(n, p);
  }
  for (const n of twice) out.delete(n);
  return out;
}

/** The NetBox interfaces that are sockets: not virtual, not a LAG, not management. */
const physicalInterfaces = (rows) => (rows || []).filter((i) => i
  && !NOT_PHYSICAL.has(lower(i.type && typeof i.type === 'object' ? i.type.value : i.type))
  && !i.mgmt_only);

/** How a box is named to a person: what it is and where it sits, never a uid. */
function deviceLabel(dev) {
  const what = String(dev.cvClass || '').trim() || 'Device';
  const at = Number(dev.position);
  return Number.isFinite(at) && at > 0 ? `${what} on shelf U${at}` : what;
}

const SWITCH_SAYS = { up: 'The switch says the port is up.', down: 'The switch says the port is down.' };
const NETBOX_SAYS = {
  connected: 'NetBox has a cable on this port.',
  not_connected: 'NetBox has no cable on this port.',
};

/** One row's verdict and the sentence that goes with it. */
function judge(camera, sw, nb, { linedUp = true } = {}) {
  if (camera === 'unknown') {
    return { verdict: 'unknown', why: 'The photo does not show whether this socket holds a cable.' };
  }
  const cabled = camera === 'cabled';
  const against = [];
  let answered = 0;
  if (sw !== 'unknown') { answered += 1; if ((sw === 'up') !== cabled) against.push(SWITCH_SAYS[sw]); }
  if (nb !== 'unknown') { answered += 1; if ((nb === 'connected') !== cabled) against.push(NETBOX_SAYS[nb]); }
  if (against.length) {
    const saw = cabled ? 'The photo shows a cable.' : 'The photo shows an empty socket.';
    return { verdict: 'mismatch', why: `${saw} ${against.join(' ')}` };
  }
  if (answered) return { verdict: 'match', why: null };
  return {
    verdict: 'unknown',
    why: linedUp ? 'Neither the switch nor NetBox has anything for this port.' : NOT_LINED_UP,
  };
}

/**
 * The rows, from the three witnesses already in hand. Pure.
 *
 *   devices    reconcile.cameraDevices(snapshot)
 *   readings   Map of box uid -> the reading of the switch matched to it
 *   records    Map of box uid -> the interfaces NetBox holds for its record
 */
function compare({ devices = [], readings = new Map(), records = new Map() } = {}) {
  const rows = [];
  for (const dev of devices) {
    if (dev.passive || reconcile.isPassive(dev.cvClass)) continue;
    const sockets = dev.sockets || [];
    if (!sockets.length) continue;

    const reading = readings.get(dev.uid) || null;
    const stack = reading ? isStack(reading) : false;
    const swPorts = reading && !stack ? byNumber(fingerprint.physicalPorts(reading), sockets.length) : null;
    const held = records.get(dev.uid) || null;
    const nbPorts = held && !stack ? byNumber(physicalInterfaces(held), sockets.length) : null;
    // A witness that is there and could not be lined up, as against one that is not there.
    const linedUp = !((reading && !swPorts) || (held && !nbPorts));

    sockets.forEach((socket, i) => {
      const n = Number.isFinite(socket.n) ? socket.n : i + 1;
      const swPort = swPorts ? swPorts.get(n) : null;
      const nbPort = nbPorts ? nbPorts.get(n) : null;
      const camera = cameraWord(socket.status);
      const sw = switchWord(swPort);
      const nb = netboxWord(nbPort);
      rows.push({
        deviceUid: dev.uid,
        device: deviceLabel(dev),
        port: n,
        portName: (swPort && swPort.name) || (nbPort && nbPort.name) || null,
        camera, switch: sw, netbox: nb,
        ...judge(camera, sw, nb, { linedUp }),
      });
    });
  }
  const summary = { match: 0, mismatch: 0, unknown: 0 };
  for (const r of rows) summary[r.verdict] += 1;
  return { rows, summary };
}

/** The NetBox record each box is known by: the item's own, else the one found on it. */
function recordIds(plan, items) {
  const out = new Map();
  for (const o of plan.orphans || []) {
    if (o && o.seen && o.matchedBox && o.netboxId != null) out.set(o.matchedBox, o.netboxId);
  }
  for (const i of items || []) {
    if (i && i.type === 'Device' && i.netboxId != null) out.set(i.uid, i.netboxId);
  }
  return out;
}

const cache = new Map();   // plan id -> { at, stamp, body }

/**
 * The ports of one check, as D9 answers them.
 *
 * `plan` and `items` come from whichever door the caller used (the phone's
 * /api/nb or the desk's /api/approvals), already authorised there. `client` is
 * that organization's NetBox, or null: without one the NetBox column is
 * unknown and nothing else changes. Kept for a minute per check, because the
 * phone and the desk both ask, and every ask is a NetBox call per box.
 */
async function forPlan(plan, items, { client = null, now = Date.now() } = {}) {
  const stamp = `${plan.fingerprint || ''}|${client ? 'nb' : '-'}`;
  const hit = cache.get(plan.id);
  if (hit && hit.stamp === stamp && now - hit.at < CACHE_MS) return hit.body;

  const blank = (note) => ({
    ok: true, planId: plan.id, sources: { camera: false, switch: false, netbox: false },
    summary: { match: 0, mismatch: 0, unknown: 0 }, rows: [], note,
  });
  const scan = plan.scanId != null ? scans.getScan(plan.scanId) : null;
  const base = scan && scan.payload && scan.payload.snapshot;
  if (!base) return blank(NO_SCAN);

  const scope = bindings.scopeOf({ tenantId: scan.payload.tenantId ?? null, rackId: scan.rackId });
  const seen = reconcile.view(base, scan.rackId, scan.payload.matches || null, { scope, scanId: scan.id });
  const sws = reconcile.gatherSwitches(scan.rackId);
  const readingOf = new Map(sws.filter((s) => s.reading).map((s) => [String(s.record.id), s.reading]));
  const readings = new Map();
  for (const s of seen.switches) {
    const reading = readingOf.get(String(s.id));
    if (s.matchedTo && reading) readings.set(s.matchedTo, reading);
  }

  const boxes = seen.devices.filter((d) => !d.passive && (d.sockets || []).length);
  const records = new Map();
  if (client) {
    const ids = recordIds(plan, items);
    await Promise.all(boxes.filter((d) => ids.has(d.uid)).map(async (d) => {
      // One box NetBox would not answer for is that box unknown, not the page.
      try { records.set(d.uid, await client.paginate('/api/dcim/interfaces/', { device_id: ids.get(d.uid) })); }
      catch { /* stays unknown */ }
    }));
  }

  const { rows, summary } = compare({ devices: seen.devices, readings, records });
  const sources = { camera: boxes.length > 0, switch: readingOf.size > 0, netbox: records.size > 0 };
  const body = { ok: true, planId: plan.id, sources, summary, rows, note: sources.switch ? null : NO_SWITCH };
  for (const [id, kept] of cache) if (now - kept.at >= CACHE_MS) cache.delete(id);
  cache.set(plan.id, { at: now, stamp, body });
  return body;
}

module.exports = {
  forPlan, compare, judge, recordIds, trailingNumber,
  CACHE_MS, NO_SWITCH, NOT_LINED_UP,
  /** For tests: forget every kept answer. */
  _forget: () => cache.clear(),
};
