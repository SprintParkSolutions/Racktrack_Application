import { Capacitor, registerPlugin } from '@capacitor/core';
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
  /* Say who is opening it. The Desk draws its own name and menu at the top,
     which is right in a browser tab and is one title too many inside the
     app's own browser sheet, where "RackTrack Drift Desk" is already written
     above it (23 September 2026). The Desk reads `in=app` and drops its
     wordmark; anything that ignores the flag is unaffected. */
  const withFlag = path.includes('in=app') ? path
    : `${path}${path.includes('?') ? '&' : '?'}in=app`;
  const plain = `${APPROVALS_BASE.replace(/\/approvals$/, '')}${withFlag}`;
  try {
    const r = await authFetch(apiUrl('/api/auth/handoff'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: withFlag }),
    });
    if (r.ok) {
      const { url } = await r.json();
      if (url) return openUrl(`${API_BASE}${url}`);
    }
  } catch { /* fall through to the plain address */ }
  return openUrl(plain);
}

/**
 * The address of the drift report: one printable page of a comparison.
 *
 * A short-lived link, because the app's own sign-in does not travel in an
 * iframe's address and a frame cannot carry a header. The link is minted on
 * every open - it lasts five minutes - and always names the check, so the page
 * is that comparison and not whatever the rack reads as today.
 *
 * It used to open the report in the system browser, which threw the person out
 * of the app. The report is shown in the app now (components/ReportViewer.jsx),
 * so this hands back the address and opens nothing. Throws when the address
 * cannot be minted; the caller says so in its own words.
 */
export async function driftReportUrl(rackId, planId) {
  const at = `/api/scan/${encodeURIComponent(rackId)}`;
  const r = await authFetch(apiUrl(`${at}/report-token`));
  const { token } = r.ok ? await r.json() : {};
  const query = [
    planId != null ? `plan=${encodeURIComponent(planId)}` : '',
    token ? `t=${encodeURIComponent(token)}` : '',
  ].filter(Boolean).join('&');
  const url = apiUrl(`${at}/drift-report${query ? `?${query}` : ''}`);
  return /^https?:/.test(url) ? url : `${window.location.origin}${url}`;
}

/**
 * Our own full-screen web view, so Approvals is part of the application
 * rather than a trip out to a website. It is an app-local plugin, present
 * only in a build that carries it, hence the fallback below.
 */
const InAppSite = registerPlugin('InAppSite');

/**
 * Open a URL where it belongs.
 *
 * Web: a new tab. Phone: our own web view, which shows the page's name and a
 * Close button and no address at all. Should that view be missing - an older
 * build, or a platform we have not written it for - the system browser still
 * opens the page, which is what happened before and is never a dead button.
 */
async function openUrl(url) {
  if (!Capacitor.isNativePlatform()) {
    window.open(url, '_blank', 'noopener');
    return;
  }
  try {
    await InAppSite.open({ url, title: 'RackTrack Drift Desk', closeOn: ['/', '/login'] });
    return;
  } catch { /* no such view in this build - fall back to the browser */ }
  await Browser.open({ url, presentationStyle: 'fullscreen', toolbarColor: '#ffffff' });
}
