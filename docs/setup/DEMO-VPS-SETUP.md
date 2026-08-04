# demo.racktrack.ai — public demo on the Hostinger VPS

The demo runs the same image as production but **CPU-only** — no GPU, no CUDA.
Measured on the real weights at two threads, a 14-device rack costs ~1.4 s of
inference; allow 2–4× for a KVM vCPU and a scan lands around 3–8 s. That is fine
for a demo. There is no need for a GPU instance.

This deployment is entirely separate from the Windows production box. Nothing
here touches it, and the auto-deploy on `audit/remaining` does not reach this
VPS — the demo is updated by hand (see [Updating](#updating)).

| | |
|---|---|
| Host | `srv1596954.hstgr.cloud` (Hostinger KVM 2) |
| IP | `82.29.164.213` |
| URL | `https://demo.racktrack.ai` |
| Stack | Caddy (TLS) → RackTrack container (Node + Python workers) |

---

## 1. DNS at GoDaddy

`racktrack.ai` serves the marketing site and **stays exactly as it is** — this
adds one record alongside it and touches nothing else.

GoDaddy → *My Products* → `racktrack.ai` → **DNS** → *Add New Record*:

| Field | Value |
|---|---|
| Type | `A` |
| Name | `demo` |
| Value | `82.29.164.213` |
| TTL | `600` (10 min) |

Do **not** add a CNAME or a forwarding rule — forwarding breaks the ACME
challenge, and the site never gets a certificate.

Confirm it before going near the VPS. Certificate issuance fails if DNS has not
propagated, and repeated failures burn Let's Encrypt rate limit:

```bash
dig +short demo.racktrack.ai        # must print 82.29.164.213
```

---

## 2. Prepare the VPS

SSH in as root (Hostinger → VPS → *Manage* → SSH details):

```bash
ssh root@82.29.164.213
```

Install Docker and open the firewall:

```bash
curl -fsSL https://get.docker.com | sh

ufw allow OpenSSH
ufw allow 80/tcp      # required — ACME HTTP-01 runs here, it is not just a redirect
ufw allow 443/tcp
ufw --force enable
```

Port 3001 is deliberately **not** opened. The app is only reachable through
Caddy, so there is no way to hit it over plain HTTP.

---

## 3. Get the code and the weights onto the box

The repo is private, so clone with a deploy key or a PAT:

```bash
git clone https://github.com/<org>/dark_mobile.git /opt/racktrack
cd /opt/racktrack
```

`Models/` (~483 MB) is git-ignored, so it never arrives with a clone. Push it
**from the Mac**:

```bash
rsync -avz --progress Models/ root@82.29.164.213:/opt/racktrack/Models/
```

**Do not rsync `server/.env`.** Production's copy holds `SLACK_TOKEN`,
`JIRA_TOKEN`, `OPENROUTER_API_KEY`, `SWITCH_USER_PASSWORD`,
`NETDISCO_PASSWORD` and `SSH_CREDS_ENC` — live lab and third-party
credentials. A public demo box needs none of them, and each one copied there
is another secret to rotate if the box is ever compromised. Build a minimal
one instead (next section).

Create the runtime directories the volumes expect:

```bash
mkdir -p /opt/racktrack/{outputs,server/data,active_learning_Cache/data}
```

### Build `server/.env` on the VPS

A template ships with the repo. On the VPS:

```bash
cp deploy/demo.env.example server/.env
openssl rand -hex 32                     # paste into JWT_SECRET=
nano server/.env
```

`JWT_SECRET` is the only required value. Generate a **fresh** one — reusing
production's would make a token minted on the demo valid against the Windows
box as well.

`NODE_ENV`, `PORT`, `CORS_ALLOWED_ORIGINS` and `RACKTRACK_WORKERS` are not in
this file on purpose: `docker-compose.demo.yml` sets them, and compose's
`environment:` beats `env_file:`. (On Windows they come from `start.ps1`,
which is why production's `.env` has none of them either.)

The loader takes everything after `=` verbatim — **no inline comments**. A
trailing `# demo` makes the value `production # demo`, which is not
`production`, and the server silently stays in dev mode leaking raw errors to
the public internet.

---

## 4. Build and start

Check the proxy config parses before starting anything — Caddy refuses to boot
on a bad Caddyfile, which would take the whole site down rather than one
setting:

```bash
cd /opt/racktrack
docker run --rm -v "$PWD/deploy/caddy/Caddyfile:/etc/caddy/Caddyfile:ro" \
  caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile
```

Then build and start:

```bash
docker compose -f docker-compose.demo.yml up -d --build
```

First build takes a while — it compiles the client and installs CPU torch.

Watch it come up:

```bash
docker compose -f docker-compose.demo.yml logs -f racktrack
```

Expect two `worker N ready` lines. Then confirm TLS was issued:

```bash
docker compose -f docker-compose.demo.yml logs caddy | grep -i "certificate obtained"
curl -I https://demo.racktrack.ai/healthz     # 200
```

---

## 5. First run

The container's first boot creates the schema (`server/auth.js` runs the
`CREATE TABLE`s on require) but leaves it empty — there is no owner to sign in
as. Seed one **after** the container is up, not before:

```bash
docker compose -f docker-compose.demo.yml exec racktrack node server/scripts/seed-racktrack.js
docker compose -f docker-compose.demo.yml restart racktrack
```

That prints the owner and org-admin credentials and writes 15 member invite
codes to `server/data/racktrack-invites.json`. **Copy the printed credentials
out of the terminal now** — the passwords are only shown once.

> The script wipes users, orgs and racks before seeding. On a fresh demo
> database that is exactly what you want, and it is a different machine from
> production — but never point it at the Windows box.

Then open `https://demo.racktrack.ai`, sign in, and run one real scan end to end
before showing anyone. Check `docker stats` while it runs — if memory heads past
~7 GB, drop `RACKTRACK_WORKERS` to `1` in `docker-compose.demo.yml`.

> **Decide before sharing the link:** whether public sign-up stays open. A demo
> URL with open registration is reachable by anyone who finds it. If it should
> be invite-only, use `server/scripts/gen-invites.js` and close sign-up.

---

## Updating

The demo does not auto-deploy. To ship a change:

```bash
cd /opt/racktrack
git pull
docker compose -f docker-compose.demo.yml up -d --build
```

`server/data`, `outputs` and `Models` are bind-mounted from the host, so
accounts, scans and weights survive a rebuild.

## Troubleshooting

**No certificate.** Almost always DNS. `dig +short demo.racktrack.ai` must
return the VPS IP, and `:80` must be open. Check `docker compose -f
docker-compose.demo.yml logs caddy`.

**API calls fail from the browser but `curl` works.** `CORS_ALLOWED_ORIGINS`
does not match `https://demo.racktrack.ai` exactly — scheme included, no
trailing slash.

**Scans fail or the container restarts mid-scan.** Out of memory. Two workers
plus torch is close to the limit of an 8 GB box. Set `RACKTRACK_WORKERS=1`.

**Everything signs out after a redeploy.** The `./server/data` mount is missing
or was created after the container's first start, so the DB was written inside
the container layer instead of the host.
