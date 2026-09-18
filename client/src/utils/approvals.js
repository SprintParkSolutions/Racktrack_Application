import { Capacitor } from '@capacitor/core';
import { apiUrl, authFetch } from './api';
import { Browser } from '@capacitor/browser';

/**
 * RackTrack Approvals is another page of the same site.
 *
 * Deciding on a drift check, assigning it and writing it to NetBox happens
 * there, at /approvals/ on the server this app already talks to. It is its own
 * bundle, so this app stays uncluttered, but it is the same site, the same API
 * and the same sign-in. The portal is a different product and has nothing to
 * do with it.
 *
 * On the phone the app runs from capacitor://localhost, so the link has to
 * carry the server's address; on the web it is a plain path on this host.
 */
const API_BASE = String(import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '');
export const APPROVALS_BASE = String(import.meta.env.VITE_APPROVALS_BASE || `${API_BASE}/approvals`)
  .replace(/\/+$/, '');

export const APPROVALS_URL = `${APPROVALS_BASE}/`;

/** One drift check inside the sub-application. */
export const driftCheckUrl = (planId) =>
  `${APPROVALS_BASE}/drifts/${encodeURIComponent(planId)}`;

/**
 * Click handler for a link that leaves the app.
 *
 * A link into RackTrack Approvals always goes through the sign-in hand-over,
 * on the web as well as on the phone: this app may hold a bearer token that
 * the browser knows nothing about, and nobody should be asked to sign in
 * again a minute after signing in. Any other external link behaves as it
 * always did: the anchor opens a tab on the web, and on the phone the address
 * is handed to the system browser, because a new tab goes nowhere in a
 * WebView.
 */
export function openExternalClick(e, url) {
  const inside = isApprovals(url);
  if (inside) {
    e.preventDefault();
    openApprovals(pathOf(url)).catch(() => { /* openApprovals falls back by itself */ });
    return;
  }
  if (!Capacitor.isNativePlatform()) return;
  e.preventDefault();
  Browser.open({ url }).catch(() => { /* the plugin reports its own failure */ });
}

/** Does this address belong to RackTrack Approvals? */
function isApprovals(url) {
  const u = String(url || '');
  return u.startsWith(APPROVALS_BASE) || u.startsWith('/approvals/') || u === '/approvals';
}

/** The path part of an Approvals address, always starting at /approvals. */
function pathOf(url) {
  const u = String(url || '');
  const at = u.indexOf('/approvals');
  return at >= 0 ? u.slice(at) : '/approvals/';
}

/**
 * Open RackTrack Approvals already signed in.
 *
 * This app holds a bearer token; a browser holds cookies, and it has neither.
 * Sent straight to the page, a person who signed in a minute ago would be
 * asked to sign in again. So ask the server to trade this app's credential
 * for a single-use key, and open the key's address instead: it sets the
 * browser's session and forwards to the page. If that fails for any reason,
 * open the page anyway rather than leaving the button dead.
 */
export async function openApprovals(path = '/approvals/') {
  const plain = `${APPROVALS_BASE.replace(/\/approvals$/, '')}${path}`;
  try {
    const r = await authFetch(apiUrl('/api/auth/handoff'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: path }),
    });
    if (r.ok) {
      const { url } = await r.json();
      if (url) return openUrl(`${API_BASE}${url}`);
    }
  } catch { /* fall through to the plain address */ }
  return openUrl(plain);
}

/** Open a URL where it belongs: a new tab on the web, the system browser on a phone. */
function openUrl(url) {
  if (Capacitor.isNativePlatform()) return Browser.open({ url });
  window.open(url, '_blank', 'noopener');
  return Promise.resolve();
}
