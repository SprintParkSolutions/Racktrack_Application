// Cisco IOS output parsers — written against IOL (i86bi-linux-l2/l3)
// images running in EVE-NG, which is what the owner-only lab tab points
// at. The output shapes match classic IOS 15.x, so real Catalyst gear
// should parse too, but only IOL has been exercised so far.
//
// Mirrors the tplink_parser.js contract exactly so port_poller's vendor
// recipe stays a straight swap:
//   oper      'up' | 'down' | 'unknown'
//   admin     'enabled' | 'disabled' | 'unknown'
//   speed_mbps  integer | null   (parsed from "a-1000" / "100" / "auto")
//   duplex    'Full' | 'Half' | 'Auto' | null
//   flowctrl  always null — `show interfaces status` doesn't carry it and
//             we're not paying for a second command just to fill a column
//   medium    'Copper' | 'Fiber' | null
//   descr     trimmed string | null

// IOS pages with " --More-- " and erases it with backspaces once you hit
// space. The runner sends `terminal length 0`, but a device that dropped
// its config (or a mid-session reload) still emits it, so scrub anyway.
function stripPager(s) {
  return String(s || '')
    .replace(/\s*--More--\s*/g, '')
    .replace(/[\b]/g, '')
    .replace(/\r/g, '');
}

// IOS prints interfaces abbreviated in `show interfaces status` ("Et0/0")
// but spelled out in running-config ("interface Ethernet0/0") and LLDP
// detail. Normalise everything to the short form so the three maps key
// against each other in mergePortRows.
const PORT_ABBREV = [
  [/^TenGigabitEthernet/i, 'Te'],
  [/^GigabitEthernet/i,    'Gi'],
  [/^FastEthernet/i,       'Fa'],
  [/^Ethernet/i,           'Et'],
  [/^Port-channel/i,       'Po'],
  [/^Vlan/i,               'Vl'],
];
function normalizePort(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  for (const [re, abbrev] of PORT_ABBREV) {
    if (re.test(s)) return s.replace(re, abbrev);
  }
  return s;
}

// Speed column is "a-1000" (autonegotiated), "1000" (forced), or "auto"
// (link down, nothing negotiated yet). The a- prefix is noise for our
// purposes — a negotiated 1000 and a forced 1000 are both 1000.
function parseSpeed(raw) {
  const v = String(raw || '').trim();
  if (!v || /^(auto|unknown|-+)$/i.test(v)) return null;
  const m = v.match(/^a?-?(\d+)/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

// "a-full" → Full, "half" → Half, "auto" → Auto.
function parseDuplex(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (!v || /^-+$/.test(v)) return null;
  if (v.includes('full')) return 'Full';
  if (v.includes('half')) return 'Half';
  if (v.includes('auto')) return 'Auto';
  return null;
}

// The Type column is free-form ("RJ45", "10/100/1000BaseTX", "1000BaseSX",
// "Not Present"). We only care about the copper/fiber split the faceplate
// uses; anything unrecognised stays null rather than guessing.
function parseMedium(raw) {
  const v = String(raw || '').trim();
  if (!v) return null;
  if (/RJ45|BaseTX|BaseT\b|10\/100/i.test(v)) return 'Copper';
  if (/BaseSX|BaseLX|BaseSR|BaseLR|SFP|Fiber/i.test(v)) return 'Fiber';
  return null;
}

// `show interfaces status` →
//   Port      Name               Status       Vlan       Duplex  Speed Type
//   Et0/0     uplink-core        connected    1          a-full  a-100 RJ45
//   Et0/1                        notconnect   1            auto   auto RJ45
//   Et0/2                        disabled     trunk        auto   auto RJ45
//
// Status → oper mapping: only "connected" is up. "disabled" means the port
// is admin-down, which we surface via admin from running-config rather than
// inferring here — the two sources disagreeing is itself worth seeing.
//
// Columns are positional but Name/Vlan can be empty and Name can contain
// spaces, so slicing beats tokenising. Boundaries come from the header.
function parseInterfaceStatus(raw) {
  const text  = stripPager(raw);
  const lines = text.split('\n');
  const out   = new Map();

  const hdrIdx = lines.findIndex((l) => /^\s*Port\s+Name\s+Status\s+Vlan/i.test(l));
  if (hdrIdx === -1) return out;
  const header = lines[hdrIdx];

  // Locate each column by where its title starts in the header. The final
  // column runs to end-of-line.
  const colNames = ['Port', 'Name', 'Status', 'Vlan', 'Duplex', 'Speed', 'Type'];
  const cols = [];
  for (const name of colNames) {
    const idx = header.search(new RegExp(`\\b${name}\\b`));
    if (idx !== -1) cols.push({ name, start: idx });
  }
  cols.sort((a, b) => a.start - b.start);
  for (let i = 0; i < cols.length; i++) {
    cols[i].end = i < cols.length - 1 ? cols[i + 1].start : 500;
  }

  for (let i = hdrIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    // Stop at the next prompt echo (hostname# / hostname>).
    if (/^\S+[#>]\s*$/.test(line.trim())) break;

    const cell = (n) => {
      const c = cols.find((x) => x.name === n);
      return c ? line.slice(c.start, c.end).trim() : '';
    };
    const port = normalizePort(cell('Port'));
    if (!port || !/^\w+[\d/]/.test(port)) continue;

    const status = cell('Status').toLowerCase();
    out.set(port, {
      port,
      oper:         status.includes('connected') && !status.includes('notconnect')
                      ? 'up'
                      : (status ? 'down' : 'unknown'),
      speed_mbps:   parseSpeed(cell('Speed')),
      duplex:       parseDuplex(cell('Duplex')),
      medium:       parseMedium(cell('Type')),
      descr_status: cell('Name') || null,
    });
  }
  return out;
}

// `show running-config | section interface` →
//   interface Ethernet0/0
//    description uplink-core
//    switchport access vlan 10
//   !
//   interface Ethernet0/1
//    shutdown
//   !
//
// A port is admin-down iff it carries an explicit `shutdown`. IOS omits
// `no shutdown` from running-config (it's the default), so absence means
// enabled — we can't return 'unknown' here without marking every healthy
// port unknown.
function parseInterfaceConfiguration(raw) {
  const text = stripPager(raw);
  const out  = new Map();

  // Split on the interface stanza header; each chunk runs to the next one.
  const blocks = text.split(/^interface\s+/mi).slice(1);
  for (const blk of blocks) {
    const nameMatch = blk.match(/^(\S+)/);
    if (!nameMatch) continue;
    const port = normalizePort(nameMatch[1]);
    if (!port) continue;

    // Only look at this stanza's own lines — stop at the closing "!".
    const body = blk.split(/^!/m)[0];
    const shut = /^\s*shutdown\s*$/mi.test(body);
    const desc = body.match(/^\s*description\s+([^\n]+)/mi);

    out.set(port, {
      port,
      admin:        shut ? 'disabled' : 'enabled',
      descr_config: desc ? desc[1].trim() : null,
    });
  }
  return out;
}

// `show version` → the handful of fields the device badge shows.
// IOL's output is thinner than real hardware (no chassis serial, model
// only inferable from the image name), so several fields come back null
// on the lab boxes. That's expected, not a parse failure.
function parseSystemInfo(raw) {
  const text = stripPager(raw);
  const out  = {};
  const pick = (re) => { const m = text.match(re); return m ? m[1].trim() : null; };

  // First line: "Cisco IOS Software, Linux Software (I86BI_LINUX-L3-...), Version 15.4(2)T, ..."
  out.system_description = pick(/^(Cisco IOS Software[^\n]+)/mi);
  out.sw_version         = pick(/Version\s+([0-9][^\s,]*)/i);
  // "L3-Switch uptime is 4 minutes" — the only place running-config's
  // hostname reliably appears in show version.
  out.system_name        = pick(/^(\S+)\s+uptime is/mi);
  out.serial             = pick(/Processor board ID\s+(\S+)/i);
  out.mac                = pick(/Base ethernet MAC Address\s*:\s*(\S+)/i);
  out.system_location    = null;
  out.hw_version         = null;

  // Model: real gear says "cisco WS-C3750G-24TS (PowerPC405) processor".
  // IOL says "cisco Unknown (Intel-x86) processor", so fall back to the
  // image filename, which is the only thing that distinguishes l2 from l3.
  const chassis = pick(/^cisco\s+(\S+)\s+\(/mi);
  if (chassis && !/^unknown$/i.test(chassis)) {
    out.model = chassis;
  } else {
    const img = pick(/System image file is\s+"([^"]+)"/i);
    out.model = img ? (img.split('/').pop() || null) : null;
  }
  return out;
}

// `show lldp neighbors detail` →
//   ------------------------------------------------
//   Local Intf: Et0/2
//   Chassis id: aabb.cc00.0800
//   Port id: Et0/1
//   Port Description: Ethernet0/1
//   System Name: L3-Switch
//
// NOTE: IOS does not run LLDP unless `lldp run` is configured globally,
// and the IOL l2-ipbase image may not support it at all (CDP is the
// default on Cisco gear). An empty map here is the normal case for an
// un-configured lab switch, not an error — the poller treats missing LLDP
// as "no neighbour" and the drift path simply won't emit lldp_* events.
function parseLldpNeighbors(raw) {
  const text = stripPager(raw);
  const out  = new Map();

  const blocks = text.split(/^-{10,}\s*$/m);
  for (const blk of blocks) {
    const local = blk.match(/Local Intf:\s*(\S+)/i);
    if (!local) continue;
    const port = normalizePort(local[1]);
    if (!port) continue;

    const pick = (re) => { const m = blk.match(re); return m ? m[1].trim() : null; };
    const chassis    = pick(/Chassis id:\s*([^\n]+)/i);
    const portId     = pick(/Port id:\s*([^\n]+)/i);
    const systemName = pick(/System Name:\s*([^\n]+)/i);
    if (!chassis && !portId && !systemName) continue;

    out.set(port, {
      port,
      lldp_chassis: chassis,
      lldp_port:    portId,
      lldp_system:  systemName,
    });
  }
  return out;
}

// Same shape and sort as the TP-Link merge: union of every port seen
// across the three sources, sorted by trailing port number so Et0/0..Et0/3
// read in order rather than alphabetically.
function mergePortRows(statusMap, configMap, lldpMap = new Map()) {
  const rows  = [];
  const ports = new Set([
    ...statusMap.keys(), ...configMap.keys(), ...lldpMap.keys(),
  ]);
  for (const port of ports) {
    const s = statusMap.get(port) || {};
    const c = configMap.get(port) || {};
    const l = lldpMap.get(port)   || {};
    rows.push({
      port,
      oper:         s.oper       ?? 'unknown',
      admin:        c.admin      ?? 'unknown',
      speed_mbps:   s.speed_mbps ?? null,
      duplex:       s.duplex     ?? null,
      flowctrl:     null,
      medium:       s.medium     ?? null,
      descr:        c.descr_config || s.descr_status || null,
      lldp_chassis: l.lldp_chassis ?? null,
      lldp_port:    l.lldp_port    ?? null,
      lldp_system:  l.lldp_system  ?? null,
    });
  }
  rows.sort((a, b) => {
    const na = parseInt((a.port.match(/(\d+)$/) || [])[1] || '0', 10);
    const nb = parseInt((b.port.match(/(\d+)$/) || [])[1] || '0', 10);
    return na - nb;
  });
  return rows;
}

module.exports = {
  parseInterfaceStatus,
  parseInterfaceConfiguration,
  parseSystemInfo,
  parseLldpNeighbors,
  mergePortRows,
  normalizePort,
  stripPager,
};
