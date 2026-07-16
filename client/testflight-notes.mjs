#!/usr/bin/env node
/**
 * Set the TestFlight "What to Test" notes for a build, via the App Store
 * Connect API. Called by ship-ipa.sh right after the IPA upload — this is the
 * bit `altool`/Transporter can't do, and it's why iOS testers never saw the
 * release notes that Android testers get automatically.
 *
 *   node testflight-notes.mjs <buildNumber> "<notes>"
 *
 * Auth: App Store Connect API key (.p8). The .p8 is NEVER committed — it's
 * gitignored and read from ~/.appstoreconnect/private_keys or the repo root.
 * The Key ID / Issuer ID are identifiers, not secrets (useless without the .p8).
 */
import { existsSync, readFileSync } from 'node:fs';
import { createPrivateKey, sign as cryptoSign } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';

const KEY_ID    = process.env.ASC_KEY_ID    || 'ZGYSK2PGM4';
const ISSUER_ID = process.env.ASC_ISSUER_ID || 'a693e02a-5a08-4740-88fa-670e02f68bf8';
const BUNDLE_ID = process.env.ASC_BUNDLE_ID || 'com.racktrack.app';
const LOCALE    = process.env.ASC_LOCALE    || 'en-US';
const API       = 'https://api.appstoreconnect.apple.com';

const args = process.argv.slice(2);
const CHECK = args[0] === '--check';   // verify auth only — no upload, no writes
const [buildNumber, notes] = CHECK ? [] : args;
if (!CHECK && (!buildNumber || !notes)) {
  console.error('usage: node testflight-notes.mjs <buildNumber> "<notes>"');
  console.error('       node testflight-notes.mjs --check      (verify API key works)');
  process.exit(1);
}

function findKeyFile() {
  const name = `AuthKey_${KEY_ID}.p8`;
  const dirs = [
    path.join(homedir(), '.appstoreconnect', 'private_keys'),
    path.join(homedir(), 'private_keys'),
    path.resolve(process.cwd(), '..'),   // repo root when run from client/
    process.cwd(),
  ];
  for (const d of dirs) {
    const p = path.join(d, name);
    if (existsSync(p)) return p;
  }
  return null;
}

const b64url = (b) => Buffer.from(b).toString('base64url');

function makeJwt() {
  const keyPath = findKeyFile();
  if (!keyPath) {
    console.error(`Could not find AuthKey_${KEY_ID}.p8 (looked in ~/.appstoreconnect/private_keys and the repo root).`);
    process.exit(2);
  }
  const key = createPrivateKey(readFileSync(keyPath, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const header  = { alg: 'ES256', kid: KEY_ID, typ: 'JWT' };
  const payload = { iss: ISSUER_ID, iat: now, exp: now + 19 * 60, aud: 'appstoreconnect-v1' };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  // JWT ES256 wants raw R||S, not DER — hence ieee-p1363.
  const sig = cryptoSign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' });
  return `${input}.${b64url(sig)}`;
}

const TOKEN = makeJwt();

async function api(method, urlPath, body) {
  const res = await fetch(`${API}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    const detail = json?.errors?.map(e => `${e.title}: ${e.detail}`).join('; ') || text.slice(0, 400);
    throw new Error(`${method} ${urlPath} → HTTP ${res.status}: ${detail}`);
  }
  return json;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  // 1. Resolve the app
  const apps = await api('GET', `/v1/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}&limit=1`);
  const app = apps.data?.[0];
  if (!app) throw new Error(`No app found for bundle id ${BUNDLE_ID}`);
  console.log(`app: ${app.attributes?.name} (${app.id})`);

  if (CHECK) {
    // Read-only sanity pass: prove the key/JWT works and show recent builds.
    const r = await api('GET', `/v1/builds?filter[app]=${app.id}&limit=5&sort=-version`);
    console.log(`✔ API key ${KEY_ID} works. Recent TestFlight builds:`);
    for (const b of r.data || []) {
      console.log(`   build ${b.attributes?.version}  state=${b.attributes?.processingState}  uploaded=${b.attributes?.uploadedDate}`);
    }
    if (!(r.data || []).length) console.log('   (none yet)');
    return;
  }

  // 2. Wait for the uploaded build to appear + finish processing enough to be
  //    addressable. Apple takes a few minutes after upload.
  let build = null;
  const deadline = Date.now() + 30 * 60 * 1000;   // 30 min
  process.stdout.write(`waiting for build ${buildNumber} to appear`);
  while (Date.now() < deadline) {
    const r = await api('GET',
      `/v1/builds?filter[app]=${app.id}&filter[version]=${encodeURIComponent(buildNumber)}&limit=1`);
    build = r.data?.[0];
    if (build) break;
    process.stdout.write('.');
    await sleep(20000);
  }
  process.stdout.write('\n');
  if (!build) throw new Error(`Build ${buildNumber} never appeared (still processing?). Notes not set — you can add them in App Store Connect.`);
  console.log(`build: ${buildNumber} (${build.id}) state=${build.attributes?.processingState}`);

  // 3. Create or update the "What to Test" localization
  const locs = await api('GET', `/v1/builds/${build.id}/betaBuildLocalizations`);
  const existing = (locs.data || []).find(l => l.attributes?.locale === LOCALE);

  if (existing) {
    await api('PATCH', `/v1/betaBuildLocalizations/${existing.id}`, {
      data: { type: 'betaBuildLocalizations', id: existing.id, attributes: { whatsNew: notes } },
    });
    console.log(`✔ updated "What to Test" (${LOCALE})`);
  } else {
    await api('POST', '/v1/betaBuildLocalizations', {
      data: {
        type: 'betaBuildLocalizations',
        attributes: { locale: LOCALE, whatsNew: notes },
        relationships: { build: { data: { type: 'builds', id: build.id } } },
      },
    });
    console.log(`✔ set "What to Test" (${LOCALE})`);
  }
  console.log('\n--- notes testers will see ---');
  console.log(notes);
})().catch(e => { console.error(String(e.message || e)); process.exit(1); });
