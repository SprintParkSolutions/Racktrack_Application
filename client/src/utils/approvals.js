import { Capacitor } from '@capacitor/core';
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
 * On the web build the anchor does the work by itself (href, new tab). Inside
 * the phone's WebView a new tab goes nowhere, so the same URL is handed to the
 * system browser through the Capacitor Browser plugin instead.
 */
export function openExternalClick(e, url) {
  if (!Capacitor.isNativePlatform()) return;
  e.preventDefault();
  Browser.open({ url }).catch(() => { /* the plugin reports its own failure */ });
}
