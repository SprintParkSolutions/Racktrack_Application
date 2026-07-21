const BASE = 'https://enigmatic-tarnish-tackle.ngrok-free.dev';
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
