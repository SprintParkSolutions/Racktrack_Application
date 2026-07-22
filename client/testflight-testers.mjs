#!/usr/bin/env node
/**
 * List the TestFlight (iOS) beta testers for RackTrack.
 *
 *   node testflight-testers.mjs
 *
 * TestFlight keeps its own tester list, entirely separate from Firebase App
 * Distribution — a person invited to one is NOT invited to the other. This
 * prints the iOS side so the two can be compared and app accounts created for
 * anyone who only exists here.
 *
 * Read-only. Auth is the same App Store Connect API key ship-ipa.sh uses; the
 * .p8 is never committed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createPrivateKey, sign as cryptoSign } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';

const KEY_ID    = process.env.ASC_KEY_ID    || 'ZGYSK2PGM4';
const ISSUER_ID = process.env.ASC_ISSUER_ID || 'a693e02a-5a08-4740-88fa-670e02f68bf8';
const BUNDLE_ID = process.env.ASC_BUNDLE_ID || 'com.racktrack.app';
const API       = 'https://api.appstoreconnect.apple.com';

function findKeyFile() {
  const name = `AuthKey_${KEY_ID}.p8`;
  for (const d of [
    path.join(homedir(), '.appstoreconnect', 'private_keys'),
    path.join(homedir(), 'private_keys'),
    path.resolve(process.cwd(), '..'),
    process.cwd(),
  ]) {
    const p = path.join(d, name);
    if (existsSync(p)) return p;
  }
  return null;
}

const b64url = (b) => Buffer.from(b).toString('base64url');
function makeJwt() {
  const keyPath = findKeyFile();
  if (!keyPath) { console.error(`✗ AuthKey_${KEY_ID}.p8 not found`); process.exit(2); }
  const key = createPrivateKey(readFileSync(keyPath, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const header  = { alg: 'ES256', kid: KEY_ID, typ: 'JWT' };
  const payload = { iss: ISSUER_ID, iat: now, exp: now + 19 * 60, aud: 'appstoreconnect-v1' };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = cryptoSign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' });
  return `${input}.${b64url(sig)}`;
}
const TOKEN = makeJwt();

async function api(urlPath) {
  const res = await fetch(`${API}${urlPath}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    const detail = json?.errors?.map(e => `${e.title}: ${e.detail}`).join('; ') || text.slice(0, 300);
    throw new Error(`GET ${urlPath} → HTTP ${res.status}: ${detail}`);
  }
  return json;
}

(async () => {
  const apps = await api(`/v1/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}&limit=1`);
  const app = apps.data?.[0];
  if (!app) { console.error(`✗ no app for bundle ${BUNDLE_ID}`); process.exit(1); }
  console.log(`app: ${app.attributes?.name} (${app.id})\n`);

  const groups = await api(`/v1/apps/${app.id}/betaGroups?limit=50`);
  const all = [];
  const seen = new Set();

  // Testers are only listable through the group they belong to — the app-level
  // betaTesters relationship is delete-only.
  for (const g of groups.data || []) {
    console.log(`group: ${g.attributes?.name}  (public=${g.attributes?.isPublicLink ? 'yes' : 'no'})`);
    let url = `/v1/betaGroups/${g.id}/betaTesters?limit=200`;
    while (url) {
      const page = await api(url);
      for (const t of page.data || []) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        all.push({ ...t, _group: g.attributes?.name });
      }
      const next = page.links?.next;
      url = next ? next.replace(API, '') : null;
    }
  }
  console.log('');

  if (!all.length) { console.log('No TestFlight testers.'); return; }
  console.log(`${all.length} TestFlight tester(s):\n`);
  const w = Math.max(...all.map(t => (t.attributes?.email || '').length), 5);
  for (const t of all) {
    const a = t.attributes || {};
    const name = `${a.firstName || ''} ${a.lastName || ''}`.trim() || '(no name)';
    console.log(`  ${String(a.email || '—').padEnd(w)}  ${name.padEnd(24)} ${a.state || ''} ${a.inviteType || ''}`);
  }
})().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
