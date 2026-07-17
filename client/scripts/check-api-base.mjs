// Guard: a mobile (Capacitor) build MUST point at a public HTTPS backend.
// The packaged app runs from capacitor://localhost, so a relative or
// localhost API base means "the phone itself" — every request would fail.
const url = process.env.VITE_API_BASE || '';
const die = (msg) => {
  console.error('\n\x1b[31m✖ Mobile build blocked:\x1b[0m ' + msg);
  console.error('\n  Build like this instead:');
  console.error('    VITE_API_BASE=https://api.your-domain.com npm run build:mobile\n');
  process.exit(1);
};
if (!url) die('VITE_API_BASE is empty. The app would have no backend to call.');
if (/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(url)) die(`VITE_API_BASE is "${url}" — on a phone, localhost is the PHONE, not your server.`);
if (!/^https:\/\//i.test(url)) die(`VITE_API_BASE is "${url}" — iOS requires HTTPS (App Transport Security).`);
if (/trycloudflare\.com/i.test(url)) {
  console.warn(`\n\x1b[33m⚠ Warning:\x1b[0m "${url}" is a TEMPORARY Cloudflare quick-tunnel.`);
  console.warn('  Its URL changes on every restart — the shipped app will break and need a rebuild.');
  console.warn('  Use a NAMED tunnel on your own domain for anything you distribute.\n');
}
console.log(`\x1b[32m✔\x1b[0m Mobile build API base: ${url}`);
