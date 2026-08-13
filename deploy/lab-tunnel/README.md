# Real lab switches on demo.racktrack.ai

How to make the demo's live-switch screens read the **real** EVE-NG lab instead
of showing nothing. Four steps: harden, route, credential, register.

The demo VPS has no path to `192.168.1.0/24`, which is why
`deploy/demo.env.example` omits `SSH_CREDS_ENC` and every Netdisco variable.
This closes that gap deliberately and narrowly.

---

## Why WireGuard and not a reverse SSH tunnel

The obvious answer is `ssh -R` from the lab out to the VPS. It does not work
here, for a reason that is easy to miss:

`docker-compose.demo.yml` runs the app as the `racktrack-demo` **container** on a
private compose network. A reverse tunnel's forwarded port binds to the *VPS
host's* loopback (sshd's default, `GatewayPorts no`), and a host loopback
listener is only reachable from the host's own network namespace. `127.0.0.1`
inside the container is the container's own loopback. The app would never see it.

Working around that means either `GatewayPorts` plus firewall rules to keep
switch SSH off the public interfaces, or a sidecar sshd, or brittle
`host-gateway` addressing. WireGuard sidesteps all of it: routes live in the
**host's** routing table, and container egress already traverses the host, so the
container reaches `192.168.1.60` with no compose change at all.

It is also tighter. `AllowedIPs` is a cryptographically enforced allowlist — the
VPS can reach exactly the three switch addresses and nothing else on the office
LAN. And because the switches keep their real addresses, everything already
written about the lab stays true: `docs/knowledge-base/lab-live-switches.md`,
`server/scripts/configure-lab.js`, and the addresses in `monitored_devices` all
still say `192.168.1.60/.61/.62`.

```
  demo.racktrack.ai (VPS)                        office
  ┌────────────────────────────┐                 ┌──────────────────────────┐
  │ racktrack-demo (container) │                 │ EVE-NG host              │
  │   connects to 192.168.1.62 │                 │   wg0  10.99.0.2         │
  │        │                   │                 │   ip_forward + MASQUERADE│
  │   compose bridge           │                 │        │                 │
  │        ▼                   │                 │        ▼                 │
  │ host routing table         │  WireGuard      │  L2SW1 .61  L2SW2 .60    │
  │   192.168.1.60/32 → wg0 ───┼─── UDP 51820 ───┤  CoreSW .62              │
  │   wg0  10.99.0.1           │  lab initiates  │  (Ethernet0/3, VLAN 99)  │
  └────────────────────────────┘                 └──────────────────────────┘
```

The lab side initiates (it is behind NAT) and holds the association open with
`PersistentKeepalive`. The VPS needs one inbound UDP port and learns the lab's
endpoint from the handshake.

---

## Step 1 — Harden the console first (already done in this repo)

**Do not skip this, and do not open the tunnel before it is deployed.**

Every `/api/switch/*` route is `auth.requireAuth`, not `requireRole` — any
approved member, which on a public demo means anyone you hand a login to. Before
hardening, `/api/switch/console/run` took its command string from the request
body with no constraint, and `ResultsPage` rendered a free-form terminal box that
posted to it. Pointed at a tunnelled lab, that is a config-mode prompt on your
IOL nodes for every demo user.

`server/app.js` now holds non-owners to `isAllowedConsoleCommand()`: the command
must be one the product itself issues (every intent and auto-command in
`console_commands.json`, plus `AUDIT_CMDS` and the Switch Info commands) **and**
must still begin with a read verb. Owners keep the free-form box. Pinned by
`server/test/console_allowlist.test.js`.

Confirm it is live on the demo before continuing:

```bash
# As a MEMBER token — must return 403.
curl -s -X POST https://demo.racktrack.ai/api/switch/console/run \
  -H "Authorization: Bearer $MEMBER_TOKEN" -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.62","command":"configure terminal"}'
# {"error":"That command is not available on this account. Use one of the listed checks."}
```

Two things this does **not** cover, so decide about them knowingly:

- `/api/switch/trace` lets any member run `ping`/`traceroute` *from* the switch
  to a target they choose. The target is validated as an IP/hostname and the
  command comes from a server-side template, so it is not arbitrary CLI — but it
  is a network probe originating inside your office LAN. Gate it to owner too if
  that bothers you.
- The **Lab page** stays owner-only and cannot be shown to prospects.
  `monitored_devices` has no `tenant_id` and the audit response returns the real
  host, which is exactly why the gate exists. Prospects see the live-switch
  console on the Results page; the Lab page remains yours.

## Step 1b — Clear the history the fixtures already wrote

Removing the fixture seam stopped *new* invented rows. It could not remove the
ones already on disk, and they are the reason invented data can still appear on a
build that no longer has any way to invent it.

`RACKTRACK_DEMO_DATA` used to intercept `runSwitchCommandsSequential` — the exact
runner the port poller is handed. So every poll cycle while it was on parsed a
fixture transcript and wrote the result down as measurement: per-port snapshots,
drift events, and each device's identity (model, serial, firmware, MAC) plus a
`last_seen` stamp that made it read **Live**. `server/data` is a persisted volume
in `docker-compose.demo.yml`, so all of it survived every redeploy.

Drift, the Ports view and the Port History view read straight from those tables.

```bash
docker compose -f docker-compose.demo.yml stop racktrack   # poller must not be writing
node server/scripts/purge-poller-history.js                # dry run — shows what it would delete
node server/scripts/purge-poller-history.js --yes          # takes a backup first
docker compose -f docker-compose.demo.yml start racktrack
```

There is no marker distinguishing a fabricated row from a genuine one — they are
the same shape — so this deletes **all** history for the devices you name. That is
correct on the demo VPS, which has never had a reachable switch, so 100% of its
history is fixture-derived. On a box that has polled real hardware, scope it with
`--host` or leave it alone. The device rows themselves (host, vendor, label,
tenant) are kept; only the polled fields are reset.

## Step 2 — WireGuard

### On the EVE-NG host

```bash
sudo apt install -y wireguard
umask 077
wg genkey | sudo tee /etc/wireguard/privatekey | wg pubkey | sudo tee /etc/wireguard/publickey
```

Copy `wg0.eveng.conf.example` to `/etc/wireguard/wg0.conf` and fill in the keys.
Enable forwarding so the wg peer can reach the switches, which know nothing about
WireGuard:

```bash
echo 'net.ipv4.ip_forward=1' | sudo tee /etc/sysctl.d/99-racktrack-lab.conf
sudo sysctl --system
sudo systemctl enable --now wg-quick@wg0
```

The `PostUp` MASQUERADE in the example config makes traffic arrive at the
switches from the EVE-NG host's own LAN address — the same source they already
see today, so no switch-side ACL or config changes.

### On the VPS

```bash
sudo apt install -y wireguard
umask 077
wg genkey | sudo tee /etc/wireguard/privatekey | wg pubkey | sudo tee /etc/wireguard/publickey
# Open the one port the lab dials in on.
sudo ufw allow 51820/udp comment 'racktrack lab wireguard'
```

Copy `wg0.vps.conf.example` to `/etc/wireguard/wg0.conf`, exchange public keys,
then `sudo systemctl enable --now wg-quick@wg0`.

### Verify — from inside the container, which is what actually matters

```bash
sudo wg show                                    # a recent handshake, non-zero transfer
ip route get 192.168.1.62                       # ... dev wg0
docker exec racktrack-demo node -e "
  const net=require('net');
  for (const h of ['192.168.1.60','192.168.1.61','192.168.1.62']) {
    const s=net.connect(22,h);
    s.setTimeout(4000);
    s.on('connect',()=>{console.log(h,'OPEN');s.destroy();});
    s.on('timeout',()=>{console.log(h,'TIMEOUT');s.destroy();});
    s.on('error',e=>console.log(h,e.code));
  }"
```

All three must print `OPEN`. If the host can reach them but the container cannot,
the route is on the host but container egress is being dropped — check that
Docker's MASQUERADE rule for the compose bridge subnet has not been overridden by
a local firewall policy.

## Step 3 — A credential for the demo, not your lab credential

Whatever goes in the demo's `SSH_CREDS_ENC` is decryptable by anyone who gets a
shell on that public VPS, because `.env.key` sits next to it. So do not reuse a
credential that reaches anything else — in particular not the one that reaches
the real TP-Link bench switch.

Make a dedicated account on each of the three IOL nodes:

```
conf t
 username racktrack-demo privilege 15 secret <a-password-used-nowhere-else>
 enable secret <the-same-password>
end
write memory
```

**On the privilege level, plainly:** the poller's `cisco-ios` recipe sends
`enable` and then `show running-config | section interface`
(`server/lib/port_poller.js`), which needs enable mode. A `privilege 1` account
therefore leaves the **Admin** column blank and stops admin-state drift being
recorded — the rest of the page still works. If you prefer that trade, use
`privilege 1` and skip the `enable secret`.

`privilege 15` is what I would use here, because the blast radius is genuinely
small and bounded: these are disposable EVE-NG nodes whose config is volatile by
design, `AllowedIPs` means a compromised VPS can reach only those three
addresses, and Step 1 means the app itself will not carry a write command from a
demo user. Judge it against your own lab, not against a production switch.

Install it on the VPS:

```bash
cd /opt/racktrack            # wherever the demo checkout lives
node server/encrypt-creds.js init          # only if server/.env.key is absent
node server/encrypt-creds.js set cisco-ios
node server/encrypt-creds.js show          # passwords masked — confirm the entry
docker compose -f docker-compose.demo.yml up -d   # picks up server/.env
```

## Step 4 — Register the three switches

`register-lab-devices.sh` in this directory does it via the owner-only API:

```bash
OWNER_TOKEN=... ./deploy/lab-tunnel/register-lab-devices.sh https://demo.racktrack.ai
```

Real addresses, default port 22 — nothing to translate:

| Host | Vendor | Label |
|---|---|---|
| `192.168.1.60` | `cisco-ios` | L2SW2 |
| `192.168.1.61` | `cisco-ios` | L2SW1 |
| `192.168.1.62` | `cisco-ios` | CoreSW |

Then open the Lab page as owner. Within a poll cycle the pills should go
**Live**, and **Run full audit** should return real ports.

---

## What to expect once it is up

**Offline is a normal state, not a fault.** IOL running-config — management IP
*and* SSH host key — is volatile and evaporates when a node is stopped or the
EVE-NG host reboots (`docs/knowledge-base/lab-live-switches.md` §7). The demo
will honestly show Offline during those windows. That is the gap the removed
demo fixtures were papering over, and on a prospect-facing page it is the thing
to watch: a prospect who lands on "Offline" is a worse impression than one who
never saw the page. If the lab is not reliably up, consider hiding the
live-switch entry point on the demo rather than letting prospects find it dark.

**One SSH session per switch.** Unchanged by the tunnel, and now shared with
public traffic. `PORT_POLL_INTERVAL_MS` defaults to hourly for this reason. If
several demo users open the console at once they will serialise behind the host
lock and may time out; that is the switch's limit, not RackTrack's.

**Latency.** Every audit is a real SSH round trip from the VPS through WireGuard
to the office. Expect seconds, and expect it to feel slower than the fixtures
did.

**Netdisco is untouched.** `RACKTRACK_DEMO_DATA=1` still seeds the Network view
only. Drop it from `server/.env` if you want that surface to go real too — but
that needs a reachable Netdisco, which is a separate exercise.

## Backing it out

```bash
# VPS
sudo systemctl disable --now wg-quick@wg0
sudo ufw delete allow 51820/udp
node server/encrypt-creds.js remove cisco-ios
# then DELETE /api/lab/devices/:id for each of the three, as owner
# EVE-NG host
sudo systemctl disable --now wg-quick@wg0
```

Remove the `racktrack-demo` account from the three switches too — a credential
nobody is using is still a credential.
