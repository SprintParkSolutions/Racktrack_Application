/**
 * Seeded network data for the public demo.
 *
 * demo.racktrack.ai runs on a cloud VPS. Netdisco discovers devices on its own
 * network and the switch console SSHes into real hardware — neither of which
 * exists next to that box, so both features answered "unreachable" and the
 * demo looked broken rather than empty. This module answers those two
 * subsystems with a small, self-consistent fake network instead.
 *
 * OFF unless RACKTRACK_DEMO_DATA is set. A real deployment must never serve
 * invented network data as though it were measured, so the switch is explicit,
 * opt-in, and logged loudly on startup.
 *
 * Two seams, chosen so the real code above them still runs:
 *   - netdisco_proxy.ndGet()   — fixtures are shaped like Netdisco's own
 *                                /api/v1 responses, so the proxy's mapping,
 *                                neighbour resolution and MAC joins all
 *                                execute for real against them.
 *   - runSwitchCommand()       — fixtures are raw CLI transcripts, so the
 *                                vendor parsers are exercised exactly as they
 *                                are against a live TP-Link JetStream.
 *
 * That matters: stubbing the routes instead would have demoed a code path
 * nobody ships.
 */

const ENABLED = process.env.RACKTRACK_DEMO_DATA === '1'
             || process.env.RACKTRACK_DEMO_DATA === 'true';

// ── The pretend rack ────────────────────────────────────────────────
// One core switch, two access switches, one edge router — enough for the
// topology, neighbour and MAC-trace screens to all have something true to say
// about each other. Names carry DEMO so a screenshot can never be mistaken for
// a customer's real estate.
const DEVICES = [
  {
    ip: '10.20.0.11', dns: 'DEMO-SW-CORE-01', name: 'DEMO-SW-CORE-01',
    model: 'T2600G-28TS', vendor: 'TP-Link', os: 'JetStream', os_ver: '3.0.5',
    location: 'Demo DC · Rack A1 · U24', contact: 'netops@demo.racktrack.ai',
    serial: 'DEMOCORE0001', uptime: 5_184_000,
    mac: 'AA:BB:CC:00:00:11', chassis_id: 'AA:BB:CC:00:00:11',
    layers: '00000010', ports: 28,
  },
  {
    ip: '10.20.0.12', dns: 'DEMO-SW-ACC-U08', name: 'DEMO-SW-ACC-U08',
    model: 'T1600G-28PS', vendor: 'TP-Link', os: 'JetStream', os_ver: '3.0.2',
    location: 'Demo DC · Rack A1 · U08', contact: 'netops@demo.racktrack.ai',
    serial: 'DEMOACC00008', uptime: 2_592_000,
    mac: 'AA:BB:CC:00:00:12', chassis_id: 'AA:BB:CC:00:00:12',
    layers: '00000010', ports: 28,
  },
  {
    ip: '10.20.0.13', dns: 'DEMO-SW-ACC-U12', name: 'DEMO-SW-ACC-U12',
    model: 'T1600G-28PS', vendor: 'TP-Link', os: 'JetStream', os_ver: '3.0.2',
    location: 'Demo DC · Rack A1 · U12', contact: 'netops@demo.racktrack.ai',
    serial: 'DEMOACC00012', uptime: 1_209_600,
    mac: 'AA:BB:CC:00:00:13', chassis_id: 'AA:BB:CC:00:00:13',
    layers: '00000010', ports: 28,
  },
  {
    ip: '10.20.0.1', dns: 'DEMO-GW-EDGE', name: 'DEMO-GW-EDGE',
    model: 'ER8411', vendor: 'TP-Link', os: 'Omada', os_ver: '1.2.1',
    location: 'Demo DC · Rack A1 · U01', contact: 'netops@demo.racktrack.ai',
    serial: 'DEMOGW000001', uptime: 7_776_000,
    mac: 'AA:BB:CC:00:00:01', chassis_id: 'AA:BB:CC:00:00:01',
    layers: '00000100', ports: 8,
  },
];

// Devices synthesised to match whatever rack the user is looking at.
//
// The Network view matches a scanned device to a Netdisco one by its CMDB name
// (SW-U08, PP-U18 …), so a fixed inventory matches nothing and the page reports
// "0 live" on every rack — technically working, and useless as a demo. When the
// match route tells us which names a rack contains, we mint a switch for each
// so the rack on screen always has a live counterpart.
//
// Keyed by name, with the address derived from the name rather than a counter,
// so the same rack gets the same addresses on every request.
const _synth = new Map();   // ip -> device

function ipForName(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 200;
  return `10.20.1.${10 + h}`;
}

function registerScanNames(names = []) {
  for (const name of names) {
    if (!name) continue;
    const ip = ipForName(name);
    if (_synth.has(ip)) continue;
    const unit = (String(name).match(/U(\d+)/i) || [])[1] || '01';
    _synth.set(ip, {
      ip, dns: name, name,
      model: name.startsWith('PP-') ? 'TL-PP24' : 'T1600G-28PS',
      vendor: 'TP-Link', os: 'JetStream', os_ver: '3.0.2',
      location: `Demo DC · Rack A1 · U${unit}`,
      contact: 'netops@demo.racktrack.ai',
      serial: `DEMO${String(name).replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 8).padEnd(8, '0')}`,
      uptime: 1_209_600 + Number(unit) * 3600,
      mac: `AA:BB:CC:01:${hex2(Number(unit) % 256)}:01`,
      chassis_id: `AA:BB:CC:01:${hex2(Number(unit) % 256)}:01`,
      layers: '00000010', ports: 28, synthetic: true,
    });
  }
}

const byIp = (ip) => DEVICES.find(d => d.ip === ip) || _synth.get(ip) || null;

// Cabling. Only the uplinks are interesting; everything else is an access port.
const LINKS = {
  '10.20.0.11': {                        // core: two downlinks + one to the edge
    'Gi1/0/1':  { ip: '10.20.0.12', port: 'Gi1/0/28' },
    'Gi1/0/2':  { ip: '10.20.0.13', port: 'Gi1/0/28' },
    'Gi1/0/28': { ip: '10.20.0.1',  port: 'Gi0/1' },
  },
  '10.20.0.12': { 'Gi1/0/28': { ip: '10.20.0.11', port: 'Gi1/0/1' } },
  '10.20.0.13': { 'Gi1/0/28': { ip: '10.20.0.11', port: 'Gi1/0/2' } },
  '10.20.0.1':  { 'Gi0/1':    { ip: '10.20.0.11', port: 'Gi1/0/28' } },
};

// Which access ports have something plugged in. Deterministic rather than
// random so two page loads agree with each other, and so a screenshot taken
// today still matches the demo tomorrow.
const OCCUPIED = {
  '10.20.0.12': [1, 2, 3, 5, 8, 11, 12, 17, 22],
  '10.20.0.13': [1, 4, 6, 7, 9, 14, 19],
  '10.20.0.11': [4, 6, 9],
};

const hex2 = (n) => n.toString(16).toUpperCase().padStart(2, '0');
const macFor = (ip, port) => {
  const last = Number(ip.split('.').pop());
  return `E8:D8:D1:${hex2(last)}:${hex2(port)}:${hex2((last * 7 + port * 13) % 256)}`;
};
const ipFor = (ip, port) => `10.20.${Number(ip.split('.').pop())}.${100 + port}`;
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString().replace('T', ' ').slice(0, 19);

// A synthesised switch still needs somewhere for its uplink to land and a
// plausible set of occupied ports, both derived from its address so they hold
// still between requests.
function linksFor(ip) {
  if (LINKS[ip]) return LINKS[ip];
  if (!_synth.has(ip)) return {};
  return { 'Gi1/0/28': { ip: DEVICES[0].ip, port: 'Gi1/0/2' } };
}

function occupancyFor(ip) {
  if (OCCUPIED[ip]) return new Set(OCCUPIED[ip]);
  const seed = Number(String(ip).split('.').pop()) || 7;
  const set = new Set();
  for (let i = 1; i <= 24; i++) if ((i * seed) % 5 < 2) set.add(i);
  return set;
}

function portsFor(ip) {
  const dev = byIp(ip);
  if (!dev) return [];
  const total = dev.ports;
  const links = linksFor(ip);
  const occupied = occupancyFor(ip);
  const isEdge = ip === '10.20.0.1';
  const out = [];
  for (let i = 1; i <= total; i++) {
    const name = isEdge ? `Gi0/${i}` : `Gi1/0/${i}`;
    const link = links[name];
    const live = !!link || occupied.has(i);
    const uplink = !!link;
    out.push({
      port: name,
      name,
      descr: uplink ? `uplink to ${byIp(link.ip)?.dns || link.ip}`
           : live   ? `access port ${i}`
           : null,
      type: 'ethernetCsmacd',
      // The one deliberately interesting fault: a 10G-capable uplink that
      // negotiated down, so "speed dropped" has something to find.
      speed: uplink ? (name === 'Gi1/0/2' ? '1.0 Gbps' : '10 Gbps') : (live ? '1.0 Gbps' : null),
      duplex: live ? 'full' : null,
      vlan: uplink ? 1 : (live ? (i % 3 === 0 ? 30 : i % 2 === 0 ? 20 : 10) : 1),
      up_admin: 'up',
      up: live ? 'up' : 'down',
      mac: macFor(ip, i),
      remote_id:   uplink ? byIp(link.ip)?.chassis_id || null : null,
      remote_ip:   uplink ? link.ip : null,
      remote_port: uplink ? link.port : null,
      remote_type: uplink ? byIp(link.ip)?.model || null : null,
      proto: uplink ? 'lldp' : null,
    });
  }
  return out;
}

function nodesFor(ip) {
  const occupied = [...occupancyFor(ip)];
  const isEdge = ip === '10.20.0.1';
  return occupied.map((i, n) => ({
    port: isEdge ? `Gi0/${i}` : `Gi1/0/${i}`,
    mac: macFor(ip, i),
    vlan: i % 3 === 0 ? 30 : i % 2 === 0 ? 20 : 10,
    active: true,
    time_last: iso(n * 90_000),
    time_first: iso(86_400_000 * (3 + n)),
  }));
}

// Every learned MAC across the demo network, so a MAC lookup can find where a
// device is plugged in — the question the MAC report exists to answer.
function allNodes() {
  const ips = [...Object.keys(OCCUPIED), ..._synth.keys()];
  return ips.flatMap(ip =>
    nodesFor(ip).map(n => ({ ...n, switch: ip, device: ip })));
}

// ── Netdisco seam ───────────────────────────────────────────────────
// Answers the /api/v1 paths netdisco_proxy asks for. Anything unrecognised
// returns an empty array rather than throwing, which is what the proxy's own
// .catch(() => []) call sites already expect.
function netdiscoGet(pathAndQuery, ctx = null) {
  const [rawPath, rawQuery = ''] = String(pathAndQuery).split('?');
  const q = new URLSearchParams(rawQuery);

  // The match route tells us which CMDB names the open rack contains, so the
  // inventory can include a live counterpart for each of them.
  if (ctx && Array.isArray(ctx.cmdbNames)) registerScanNames(ctx.cmdbNames);

  if (rawPath === '/api/v1/search/device') return [...DEVICES, ..._synth.values()];

  const objMatch = rawPath.match(/^\/api\/v1\/object\/device\/([^/]+)(\/(ports|nodes))?$/);
  if (objMatch) {
    const ip = decodeURIComponent(objMatch[1]);
    if (objMatch[3] === 'ports') return portsFor(ip);
    if (objMatch[3] === 'nodes') return nodesFor(ip);
    return byIp(ip);
  }

  // MAC search — both the sightings and the ip-history endpoints.
  if (rawPath === '/api/v1/search/node' || rawPath === '/api/v1/search/nodeip') {
    const needle = (q.get('q') || '').toLowerCase().replace(/[^0-9a-f]/g, '');
    if (!needle) return [];
    const hits = allNodes().filter(n =>
      n.mac.toLowerCase().replace(/[^0-9a-f]/g, '').includes(needle));
    if (rawPath === '/api/v1/search/nodeip') {
      return hits.map(n => ({
        mac: n.mac,
        ip: ipFor(n.switch, Number(n.port.split('/').pop())),
        time_first: n.time_first,
        time_last: n.time_last,
        active: true,
      }));
    }
    return hits.map(n => ({
      mac: n.mac, switch: n.switch, port: n.port, vlan: n.vlan,
      active: n.active, time_first: n.time_first, time_last: n.time_last,
    }));
  }

  const nodeObj = rawPath.match(/^\/api\/v1\/object\/node\/([^/]+)$/);
  if (nodeObj) {
    const mac = decodeURIComponent(nodeObj[1]);
    return allNodes().find(n => n.mac.toLowerCase() === mac.toLowerCase()) || null;
  }

  return [];
}

// ── Switch console seam ─────────────────────────────────────────────
// Raw TP-Link JetStream transcripts. Column widths matter: parseInterfaceStatus
// wants six columns before the description, and getting that wrong yields zero
// rows and a "probe returned no port rows" that looks like a switch fault.
function ifStatusTable(ip) {
  const rows = portsFor(ip).map((p) => {
    const status = p.up === 'up' ? 'LinkUp' : 'LinkDown';
    const speed = p.up === 'up' ? (p.speed === '10 Gbps' ? '10000M' : '1000M') : 'Auto';
    const duplex = p.up === 'up' ? 'Full' : 'Auto';
    const medium = p.speed === '10 Gbps' ? 'Fiber' : 'Copper';
    return [
      p.port.padEnd(10),
      status.padEnd(12),
      speed.padEnd(10),
      duplex.padEnd(10),
      'Disable'.padEnd(10),
      medium.padEnd(15),
      p.descr || '',
    ].join('').trimEnd();
  });
  return [
    'Port      Status      Speed     Duplex    FlowCtrl  Active-Medium  Description',
    '--------- ----------- --------- --------- --------- -------------- -----------',
    ...rows,
  ].join('\n');
}

function sysInfo(ip) {
  const d = byIp(ip) || DEVICES[0];
  const days = Math.floor(d.uptime / 86400);
  return [
    `System Description - ${d.vendor} ${d.model} ${d.os} Switch`,
    `Device Name        - ${d.dns}`,
    `Device Location    - ${d.location}`,
    `System Contact     - ${d.contact}`,
    `Hardware Version   - ${d.model} 2.0`,
    `Software Version   - ${d.os_ver} Build 20250114 Rel.58321`,
    `Serial Number      - ${d.serial}`,
    `System Time        - ${iso(0)}`,
    `Running Time       - ${days} day(s) 4 hour(s) 12 minute(s)`,
  ].join('\n');
}

function lldpTable(ip) {
  const links = LINKS[ip] || {};
  const rows = Object.entries(links).map(([local, l]) => {
    const peer = byIp(l.ip);
    return [
      `Local Port    : ${local}`,
      `Chassis ID    : ${peer?.chassis_id || '-'}`,
      `Port ID       : ${l.port}`,
      `System Name   : ${peer?.dns || l.ip}`,
      `System Descr  : ${peer?.vendor || ''} ${peer?.model || ''} ${peer?.os || ''}`.trimEnd(),
      `Management IP : ${l.ip}`,
      '',
    ].join('\n');
  });
  return rows.length
    ? `LLDP neighbor-information of port [ALL]\n\n${rows.join('\n')}`
    : 'LLDP neighbor-information of port [ALL]\n\nNo neighbor information found.';
}

// Column order matters and is not the order a JetStream prints it in the
// manual: parseMacTable() reads MAC, then VLAN, then port. Getting it wrong
// yields an empty table and a switch that looks like it learned nothing.
function macTable(ip) {
  const rows = nodesFor(ip).map(n =>
    `${n.mac.toLowerCase().padEnd(20)}${String(n.vlan).padEnd(6)}${n.port.padEnd(12)}dynamic   aging`);
  return [
    'MAC Address Table',
    '',
    'MAC Address         Vlan  Port        Type      Status',
    '------------------- ----- ----------- --------- --------',
    ...rows,
    '',
    `Total MAC Addresses: ${rows.length}`,
  ].join('\n');
}

// parsePoe() reads the SECOND whitespace token as watts and decides "powered"
// from the LAST token being "On", so the column order here is dictated by the
// parser rather than by any one vendor's manual.
function poeTable(ip) {
  const occupied = OCCUPIED[ip] || [];
  let total = 0;
  const rows = portsFor(ip).map((p, idx) => {
    const on = occupied.includes(idx + 1) && (idx + 1) % 2 === 1;
    const watts = on ? (4.2 + ((idx * 7) % 9) * 0.4).toFixed(1) : '0.0';
    if (on) total += parseFloat(watts);
    return [
      p.port.padEnd(10),
      String(watts).padEnd(9),
      (on ? 'Class3' : '-').padEnd(8),
      on ? 'On' : 'Off',
    ].join('');
  });
  return [
    'Interface Power(W)  Class   Status',
    '--------- --------- ------- ------',
    ...rows,
    '',
    'System Power Limit       : 250.0',
    `System Power Consumption : ${total.toFixed(1)}`,
  ].join('\n');
}

function vlanTable() {
  return [
    'VLAN  Name                 Status    Ports',
    '----- -------------------- --------- ------------------------------',
    '1     System-VLAN          active    Gi1/0/28',
    '10    DEMO-Office          active    Gi1/0/1, Gi1/0/5, Gi1/0/11, Gi1/0/17',
    '20    DEMO-Voice           active    Gi1/0/2, Gi1/0/8, Gi1/0/12, Gi1/0/22',
    '30    DEMO-Cameras         active    Gi1/0/3',
  ].join('\n');
}

function ifConfig(ip) {
  const rows = portsFor(ip).map(p =>
    `${p.port.padEnd(10)}${(p.up_admin === 'up' ? 'Enable' : 'Disable').padEnd(9)}${String(p.vlan).padEnd(7)}${p.descr || ''}`.trimEnd());
  return [
    'Interface Status   PVID   Description',
    '--------- -------- ------ --------------------',
    ...rows,
  ].join('\n');
}

/** Raw transcript for one CLI command, as a live switch would return it. */
function switchCommand({ host, command }) {
  const cmd = String(command || '').toLowerCase();
  const ip = byIp(host) ? host : DEVICES[0].ip;
  let body;
  if (cmd.includes('system-info') || cmd.includes('show version') || cmd.includes('show switch')) body = sysInfo(ip);
  else if (cmd.includes('interface status') || cmd.includes('interfaces status') || cmd.includes('show ports')) body = ifStatusTable(ip);
  else if (cmd.includes('interface configuration') || cmd.includes('interfaces description')) body = ifConfig(ip);
  else if (cmd.includes('power inline')) body = poeTable(ip);
  else if (cmd.includes('vlan')) body = vlanTable();
  else if (cmd.includes('lldp')) body = lldpTable(ip);
  else if (cmd.includes('mac address') || cmd.includes('mac-address')) body = macTable(ip);
  else if (cmd.includes('cdp')) body = 'CDP is not enabled on this device.';
  else body = `% Unrecognized command "${command}" (demo data)`;
  // Echo + prompt, because cleanShellOutput() strips exactly that and we want
  // the same code path a real session takes.
  const name = byIp(ip)?.dns || 'DEMO-SW';
  return `${command}\n${body}\n${name}#`;
}

/** Multi-command batch, mirroring runSwitchCommandsSequential's contract. */
async function switchCommandsSequential({ host, commands = [], onEntry }) {
  const entries = [];
  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    const entry = {
      name: c.name,
      cmd: c.cmd,
      output: switchCommand({ host, command: c.cmd }),
      error: null,
      startedAt: new Date().toISOString(),
    };
    entries.push(entry);
    if (typeof onEntry === 'function') {
      try { onEntry(i, entry); } catch { /* a listener must not break collection */ }
    }
  }
  return entries;
}

module.exports = {
  enabled: ENABLED,
  devices: DEVICES,
  defaultHost: () => DEVICES[0].ip,
  netdiscoGet,
  switchCommand,
  switchCommandsSequential,
};
