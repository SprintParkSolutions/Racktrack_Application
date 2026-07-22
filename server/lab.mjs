import { readFileSync } from 'node:fs';
// Single source for the tunnel URL — see ../BACKEND_URL. Hardcoding it here
// meant this script silently pointed at a dead tunnel when it moved.
const BASE = (process.env.VITE_API_BASE
  || readFileSync(new URL('../BACKEND_URL', import.meta.url), 'utf8')).trim();
const H = { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' };
const l = await (await fetch(`${BASE}/api/auth/login`, { method:'POST', headers:H,
  body: JSON.stringify({ username:'Owner', password: process.env.PW }) })).json();
const auth = { ...H, Authorization: `Bearer ${l.token}` };
const r = await (await fetch(`${BASE}/api/lab/devices`, { headers: auth })).json();
const devs = r.devices || r.data || [];
console.log(`devices: ${devs.length}`);
for (const d of devs) {
  console.log(`  ${d.host}:${d.ssh_port||22}  vendor=${d.vendor||'-'}  enabled=${d.enabled}  last_ok=${d.last_ok_at||'never'}`);
  console.log(`      last_error: ${d.last_error || '(none)'}`);
}
