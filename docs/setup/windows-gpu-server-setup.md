# RackTrack — Status + Windows GPU Server Migration

**Everything we've done, and the exact plan to move the backend onto the always-on Windows GPU machine.**
Copy this whole directory to the Windows PC and follow Part 3 onward.

Written: 13 Jul 2026

---

## Part 1 — What RackTrack is

- **Client**: React (Vite) app, wrapped with Capacitor into a real **iPhone** and **Android** app.
- **Server**: Node/Express (`server/app.js`), port **3001**. Serves the app and the API.
- **AI pipeline**: Python + YOLO models (`pipeline/`) — detects devices, ports, cables from a rack photo.
- **Live switch**: the server SSHes (read-only) into a TP-Link switch at **192.168.1.33** to read ports, PoE, VLAN, MAC, LLDP.

**Key point:** the phone does no heavy work. It calls the server. The server does the AI *and* talks to the switch.

---

## Part 2 — Where we are today

### Shipped
| Thing | Status |
|---|---|
| iOS app | On **TestFlight**, build **1.0 (4)**, signed, RackTrack logo |
| Android app | **APK built** (sideload, ~11 MB) |
| Bundle ID | `com.racktrack.app` |
| Apple team | **SPRINTPARK LLC** — Team ID `6GS882NNAX` |

### Fixed / added recently
- **Scan survives app-switching** — leaving the app mid-scan no longer loses it; it resumes and shows the result.
- **"Load failed"** — the backend was auto-restarting mid-scan (dev file-watcher). Fixed via `server/nodemon.json`.
- **Back buttons** never dead-end (`useSmartBack`).
- **First-run walkthrough** (scan → review → ports).
- **Ports** screen top made compact; **Network** screen shows "No switches detected" instead of blank.
- **Android scrolling** — several fixes (viewport units, `touch-action`, single scroll container). **⚠ Still needs confirming on a real Android phone.**
- **Profile avatars** — 8 preset gradient avatars, auto-assigned from the user's initial, changeable. (Needs an app rebuild to reach testers.)

### The problem we're solving
The backend runs on the **Mac** behind a **temporary Cloudflare tunnel**. The tunnel's URL is random and **changes whenever it restarts**, and that URL is **compiled into the installed apps** — so the apps break and need rebuilding. Plus the Mac can't stay on 24/7.

---

## Part 3 — Target setup (what we're building)

```
Phone app  ──HTTPS──>  api.racktrack.ai  ──port-forward──>  Windows PC (always on, GPU)
                                                              ├── Node server  :3001
                                                              ├── Python AI (GPU)
                                                              └── SSH ──> switch 192.168.1.33
```

- Windows PC is **always on**, has a **GPU** (faster AI), and is on the **same office network as the switch**.
- Reached at a **permanent address**, so the app never breaks again.
- **One final app rebuild** with that address — then never again for the URL.

> **Important:** the Windows box replaces the **backend server** only. **Building the iOS app still requires the Mac** (Xcode only runs on macOS). Android APKs can be built on Windows.

---

## Part 4 — Copy the project to Windows

Copy the whole `dark_mobile` directory. **Three things are NOT in git and must be copied manually:**

1. **`server/.env`** — all secrets (switch credentials, email, Slack).
2. **`server/.env.key`** — the key that decrypts the stored switch credentials.
3. **The `Models/` folder** — the AI weights, excluded from the repo because of size:
   - `Models/devices_seg.pt`
   - `Models/port_count.pt`
   - `Models/ports_9.pt`
   - `Models/pdu_ports_v1_det_best.pt`

Without these three, the server will start but **scanning and the switch will not work**.

---

## Part 5 — Install on Windows

1. **Node.js** (LTS) — https://nodejs.org
2. **Python 3.10–3.12** — https://python.org (tick **"Add Python to PATH"**)
3. **NVIDIA driver + CUDA** (for the GPU)
4. **Git** (optional)

The server already knows it's on Windows — it uses the `py` launcher automatically:
```js
const pythonCmd = process.env.PYTHON_PATH || (process.platform === 'win32' ? 'py' : 'python3');
```

---

## Part 6 — ⚠ Verify prerequisites BEFORE going further

Run these on the **Windows PC**. All must pass.

```powershell
# 1. CRITICAL — can it reach the switch? (This is the make-or-break check.)
ping 192.168.1.33

# 2. GPU present?
nvidia-smi

# 3. Versions
node -v
py --version
```

> **If `ping 192.168.1.33` fails**, the live-switch/ports features will NOT work from this machine.
> Note the Mac sits on a `10.10.1.x` gateway while the switch is `192.168.1.33` — different subnets — so **do not assume**; actually run the ping.

---

## Part 7 — Install dependencies & run

```powershell
cd path\to\dark_mobile

# Server deps
cd server
npm install

# Client deps + build the web app
cd ..\client
npm install
npm run build

# Python AI deps
cd ..
py -m pip install -r requirements.txt
```

**Enable the GPU** (big speedup — the pipeline currently defaults to CPU):
```powershell
# Install the CUDA build of PyTorch (check pytorch.org for the right CUDA version)
py -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121

# Verify the GPU is visible to PyTorch
py -c "import torch; print('CUDA:', torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

**Start the server:**
```powershell
cd server
node app.js
```
Then check `http://localhost:3001/api/health` returns OK.

**Make it auto-start & stay running** (so it survives reboots) — use a Windows Service wrapper such as **NSSM** or **pm2-windows-service**. Run `node app.js` (NOT `npm run dev` — the dev runner auto-restarts on file changes, which is what caused the earlier "load failed").

---

## Part 8 — Permanent HTTPS address (port-forward path)

**You chose port-forwarding.** Three hard requirements:

### 8a. HTTPS is mandatory
iOS and Android **block plain HTTP**. `http://183.82.3.22:3001` will **not** work in the app.
You need a **domain + certificate** (a certificate can't be issued for a bare IP).
You own **racktrack.ai** — so use a subdomain.

### 8b. Your public IP must not change
- Current office public IP: **183.82.3.22** (not CGNAT — port-forwarding is possible ✓)
- **Most ISPs give a *dynamic* IP.** If it changes, the app breaks — the same problem we're escaping.
- **Action:** ask the ISP for a **static IP**, or run a **dynamic-DNS updater** that keeps the DNS record pointed at the current IP.

### 8c. Steps
1. **DNS**: in your domain provider (GoDaddy), add an **A record**:
   `api.racktrack.ai → 183.82.3.22`
   (Your website at `racktrack.ai` is untouched — this is just a new subdomain.)
2. **Reverse proxy with automatic HTTPS** on the Windows PC — **Caddy** is by far the easiest (it gets and renews the Let's Encrypt certificate for you). Install Caddy, then use this `Caddyfile`:
   ```
   api.racktrack.ai {
       reverse_proxy localhost:3001
   }
   ```
   Run Caddy as a service. It will fetch the certificate automatically.
3. **Router**: forward **port 443** → the Windows PC's local IP.
   (Also forward **port 80** — Let's Encrypt uses it for the certificate challenge.)
4. **Windows Firewall**: allow inbound **80** and **443**.
5. **Test from outside** (mobile data, not office Wi-Fi):
   `https://api.racktrack.ai/api/health` should return OK.

### 8d. ⚠ Security — read this
Port-forwarding puts this machine **directly on the internet**, and it holds **switch SSH credentials**. Please:
- Keep Windows and Node updated.
- Expose **only** 80/443 (never 3001 directly, never RDP).
- Consider a firewall rule / rate-limiting.
- A tunnel (Cloudflare/ngrok) would open **no inbound ports** and is safer — worth reconsidering if this feels risky.

---

## Part 9 — Rebuild the apps with the permanent address

This is the **last** rebuild caused by the URL.

**Android (can be done on Windows):**
```powershell
cd client
# build web with the permanent URL baked in
set VITE_API_BASE=https://api.racktrack.ai
npm run build
npx cap copy android
cd android
.\gradlew assembleDebug
# APK: client\android\app\build\outputs\apk\debug\racktrack.apk
```

**iOS (must be done on the Mac):**
```bash
cd client
./make-ipa.sh 6GS882NNAX https://api.racktrack.ai
```
Then bump the build number, upload via Transporter, and assign testers.

---

## Part 10 — ⚠ Outstanding security issue (do this)

**`server/.env` and `server/.env.key` are committed to git.** That means anyone with the repo can decrypt the **switch credentials**, and can read the **Gmail app password** and **Slack token**.

To fix:
1. Remove them from git tracking and add to `.gitignore`.
2. **Rotate** the exposed secrets: Gmail app password, Slack token, switch passwords, and the `.env.key`.

---

## Part 11 — Still pending

- [ ] **Confirm Android scrolling** works on a real phone with the latest APK.
- [ ] Upload the latest **iOS build** to TestFlight and assign testers.
- [ ] Distribute the **APK** to Android testers.
- [ ] Rebuild both apps to ship **profile avatars** + latest fixes.
- [ ] **Migrate backend to Windows** (this document).
- [ ] **Static IP / dynamic DNS** so the address never breaks.
- [ ] **Security cleanup** (Part 10).

---

## Quick reference

| Item | Value |
|---|---|
| Server port | `3001` |
| Switch (read-only) | `192.168.1.33` |
| Office public IP | `183.82.3.22` (not CGNAT) |
| Planned address | `https://api.racktrack.ai` |
| App bundle ID | `com.racktrack.app` |
| Apple Team ID | `6GS882NNAX` (SPRINTPARK LLC) |
| Health check | `/api/health` |
