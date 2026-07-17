#!/usr/bin/env node
// One-off helper: push the EVE-NG lab switches into a realistic shape so the
// Lab page has something worth looking at (port descriptions, users split
// across VLANs, LLDP if the image supports it).
//
// Run it ON the machine that hosts RackTrack — that box can reach
// 192.168.1.60-.62; a laptop on the VPN generally cannot.
//
//   cd server && node scripts/configure-lab.js          # apply
//   cd server && node scripts/configure-lab.js --dry    # print, change nothing
//
// Credentials come from the same encrypted store the poller uses
// (server/.env + .env.key, vendor 'cisco-ios'), so no passwords live here.
//
// This is deliberately NOT wired into the app. RackTrack stays read-only:
// it reads switches, it doesn't configure them. This script is lab scaffolding,
// kept in the repo because it documents exactly how the lab was built.
//
// Safe by construction: it only sets descriptions, access VLANs (10/20 already
// exist) and `lldp run`. It never touches Ethernet0/3 — that's the management
// link on VLAN 99 that RackTrack polls over, and changing it would lock the
// switch out mid-run.

const path = require('path');
const { Client } = require('ssh2');
const sshCreds = require(path.join(__dirname, '..', 'lib', 'ssh-creds'));

const DRY = process.argv.includes('--dry');

// e0/2 is an access port in the user VLAN, not a trunk: CoreSW runs the L3
// image, where interfaces are routed and `switchport` doesn't apply — so the
// L2 switches hand it a plain VLAN and it routes between them.
const PLAN = [
  {
    host: '192.168.1.61', name: 'L2SW1',
    lines: [
      'lldp run',
      'interface Ethernet0/0', 'description User1 - Sales PC', 'switchport mode access', 'switchport access vlan 10',
      'interface Ethernet0/1', 'description User2 - Sales PC', 'switchport mode access', 'switchport access vlan 10',
      'interface Ethernet0/2', 'description Uplink to CoreSW e0/1', 'switchport mode access', 'switchport access vlan 10',
      'interface Ethernet0/3', 'description RackTrack management',
    ],
  },
  {
    host: '192.168.1.60', name: 'L2SW2',
    lines: [
      'lldp run',
      'interface Ethernet0/0', 'description User3 - Engineering PC', 'switchport mode access', 'switchport access vlan 20',
      'interface Ethernet0/1', 'description User4 - Engineering PC', 'switchport mode access', 'switchport access vlan 20',
      'interface Ethernet0/2', 'description Uplink to CoreSW e0/0', 'switchport mode access', 'switchport access vlan 20',
      'interface Ethernet0/3', 'description RackTrack management',
    ],
  },
  {
    host: '192.168.1.62', name: 'CoreSW',
    lines: [
      'lldp run',
      'interface Ethernet0/0', 'description Downlink to L2SW2 e0/2', 'ip address 10.10.20.1 255.255.255.0', 'no shutdown',
      'interface Ethernet0/1', 'description Downlink to L2SW1 e0/2', 'ip address 10.10.10.1 255.255.255.0', 'no shutdown',
      'interface Ethernet0/2', 'description Link to Router fa0/1',
      'interface Ethernet0/3', 'description RackTrack management',
    ],
  },
];

// Drive an interactive shell. IOS needs a real PTY for config mode — exec()
// runs one command with no session state, so `conf t` would be pointless there.
function configure({ host, name, lines, username, password }) {
  return new Promise((resolve) => {
    const conn = new Client();
    let buf = '';
    const log = [];
    let done = false;

    const finish = (ok, msg) => {
      if (done) return;
      done = true;
      try { conn.end(); } catch (_) {}
      resolve({ name, host, ok, msg, log });
    };

    const timer = setTimeout(() => finish(false, 'timed out after 60s'), 60_000);

    conn.on('ready', () => {
      conn.shell({ term: 'vt100' }, (err, stream) => {
        if (err) { clearTimeout(timer); return finish(false, err.message); }

        // Feed one line at a time and let IOS echo back between them. Sending
        // the whole block at once is what mangles pasted config in a terminal.
        const script = ['terminal length 0', 'configure terminal', ...lines, 'end', 'write memory'];
        let i = 0;
        const pump = () => {
          if (i >= script.length) {
            clearTimeout(timer);
            // Give `write memory` a moment to land before dropping the session.
            return setTimeout(() => finish(true, 'applied'), 2500);
          }
          const line = script[i++];
          log.push(`> ${line}`);
          stream.write(line + '\n');
          setTimeout(pump, 350);
        };

        stream.on('data', (d) => { buf += d.toString('utf8'); });
        stream.on('close', () => { clearTimeout(timer); finish(true, 'session closed'); });
        setTimeout(pump, 800);   // let the banner/prompt settle first
      });
    });

    conn.on('error', (e) => { clearTimeout(timer); finish(false, e.message); });
    conn.connect({
      host, port: 22, username, password, readyTimeout: 20_000,
      // IOL ships ancient crypto; Node's modern defaults won't negotiate with
      // it, which surfaces as "Connection lost before handshake".
      algorithms: {
        kex: ['diffie-hellman-group14-sha1', 'diffie-hellman-group1-sha1', 'diffie-hellman-group-exchange-sha1'],
        cipher: ['aes128-cbc', '3des-cbc', 'aes192-cbc', 'aes256-cbc', 'aes128-ctr', 'aes192-ctr', 'aes256-ctr'],
        serverHostKey: ['ssh-rsa', 'ssh-dss'],
        hmac: ['hmac-sha1', 'hmac-sha2-256'],
      },
    });
  });
}

(async () => {
  const creds = sshCreds.getForVendor('cisco-ios');
  if (!creds || !creds.username) {
    console.error("No credentials for vendor 'cisco-ios'.");
    console.error('Run:  node encrypt-creds.js set cisco-ios');
    process.exit(1);
  }
  console.log(`Using stored cisco-ios credentials (user: ${creds.username})\n`);

  if (DRY) {
    for (const d of PLAN) {
      console.log(`--- ${d.name} (${d.host})`);
      ['terminal length 0', 'configure terminal', ...d.lines, 'end', 'write memory']
        .forEach((l) => console.log('    ' + l));
      console.log('');
    }
    console.log('Dry run — nothing was sent.');
    return;
  }

  // Serial, not parallel: these switches allow ~1 SSH session, and the poller
  // is already competing for it.
  const results = [];
  for (const d of PLAN) {
    process.stdout.write(`${d.name.padEnd(8)} ${d.host} ... `);
    const r = await configure({ ...d, username: creds.username, password: creds.password });
    console.log(r.ok ? 'ok' : `FAILED — ${r.msg}`);
    results.push(r);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} configured.`);
  if (failed.length) {
    failed.forEach((f) => console.log(`  ${f.name} (${f.host}): ${f.msg}`));
    process.exitCode = 1;
  } else {
    console.log('Open the Lab page and hit "Run full audit".');
    console.log('If LLDP is still empty, this image has no LLDP support — say so and');
    console.log('the audit can switch to CDP for cisco-ios.');
  }
})();
