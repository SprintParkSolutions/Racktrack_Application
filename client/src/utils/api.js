import { getItem, setItem, removeItem } from './safeStorage';

// In dev, VITE_API_BASE is empty → Vite's proxy routes /api, /outputs, /uploads.
// In the APK build, we set VITE_API_BASE=https://<public-host> so the WebView
// can reach the real backend instead of its own (non-existent) origin.
let API_BASE = import.meta.env.VITE_API_BASE || '';
const APP_KEY  = import.meta.env.VITE_APP_KEY  || '';

// Self-heal a common misbuild: the web dist gets built with a LOCALHOST API
// base (e.g. from a leftover .env.production.local pointing at localhost:3001),
// then served publicly through a tunnel. On the https tunnel page, every call
// to http://localhost:3001 is blocked as mixed content → "Load failed"
// everywhere. If we detect a localhost base but the page is actually served
// from a real host, drop to same-origin (relative) so the app talks to whatever
// host is serving it. Native (capacitor://localhost) and real dev on localhost
// are untouched — they only trigger when the SERVING host is also localhost.
try {
  if (typeof window !== 'undefined' && /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(API_BASE)) {
    const host = window.location.hostname;
    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      API_BASE = '';   // same origin as the served page
    }
  }
} catch (_) { /* non-browser */ }

// Append ?app_key=... to a URL so the server's app-key gate accepts it.
// The key rides in the query string rather than a header because <img>/<video>/
// <a download> URLs can't carry custom headers. Appending on every URL means a
// single code path works for both fetches and tag-driven media loads.
function withAppKey(url) {
  if (!APP_KEY) return url;
  const sep = url.includes('?') ? '&' : '?';
  return url + sep + 'app_key=' + encodeURIComponent(APP_KEY);
}

// ── Asset tokens ─────────────────────────────────────────────────────
// Rack photographs are served from /outputs and /uploads, and an <img> tag
// cannot send an Authorization header — which is why those paths used to be
// open to anyone holding a rack id. The server now accepts a short-lived asset
// token in the query string instead, so it rides the same appending pattern as
// the app key above and every image URL is covered by one code path.
const ASSET_PATH_RE = /^\/(outputs|uploads)\//i;
let assetToken = getItem('rt_assetToken');

// The token is captured into a module variable, and apiUrl() is not reactive —
// nothing re-renders when a new one lands. So a component that rendered its
// <img> before the mint (a cold start, or the morning after when the stored
// token has expired) emitted a src the server now 404s, and it stayed broken
// until that component happened to remount. Bumping a generation counter and
// telling the app about it lets those images re-render once, on the render
// after the token arrives.
let assetTokenGen = 0;
export function assetTokenGeneration() { return assetTokenGen; }

// Guards the logout race: a sign-out during an in-flight mint used to be
// overwritten by the response, re-arming a 12-hour capability on a device that
// had just signed out — the exact "departed employee keeps access" case.
let assetTokenEpoch = 0;

/** Called after sign-in to mint the capability <img> tags travel with. */
export async function refreshAssetToken() {
  const epoch = ++assetTokenEpoch;
  try {
    const res = await authFetch(apiUrl('/api/assets/token'));
    if (!res.ok) return null;
    const { token } = await res.json();
    // Someone signed out (or signed in as someone else) while this was in
    // flight. Drop the result on the floor rather than resurrecting it.
    if (epoch !== assetTokenEpoch) return null;
    if (token) {
      assetToken = token;
      assetTokenGen += 1;
      setItem('rt_assetToken', token);
      try { window.dispatchEvent(new Event('rt:asset-token')); } catch { /* non-browser */ }
    }
    return token || null;
  } catch {
    return null;   // images degrade to a broken thumbnail, not a broken app
  }
}

export function clearAssetToken() {
  assetTokenEpoch += 1;   // invalidates any mint already in flight
  assetToken = null;
  assetTokenGen += 1;
  removeItem('rt_assetToken');
  try { window.dispatchEvent(new Event('rt:asset-token')); } catch { /* non-browser */ }
}

function withAssetToken(path, url) {
  if (!assetToken || !ASSET_PATH_RE.test(path)) return url;
  const sep = url.includes('?') ? '&' : '?';
  return url + sep + 't=' + encodeURIComponent(assetToken);
}

export function apiUrl(path) {
  if (!path) return path;
  if (/^https?:\/\//i.test(path)) return withAppKey(path); // already absolute
  return withAssetToken(path, withAppKey(API_BASE + path));
}

// Free ngrok tunnels serve an HTML interstitial ("You are about to visit...")
// instead of the real response to clients that look like a browser — which a
// Capacitor WebView does. Any request carrying this header skips it. Scoped to
// our own backend so third-party fetches are untouched (a custom header on a
// cross-origin request forces a CORS preflight).
//
// Harmless once off ngrok: the header is simply ignored by any other host.
export function installFetchInterceptor() {
  if (typeof window === 'undefined' || window.__rtFetchPatched) return;
  window.__rtFetchPatched = true;

  const nativeFetch = window.fetch.bind(window);

  const isOurBackend = (url) => {
    const u = String(url);
    if (!/^https?:\/\//i.test(u)) return true;        // relative → same origin
    return API_BASE ? u.startsWith(API_BASE) : false; // absolute → only our API
  };

  window.fetch = (input, init = {}) => {
    const url = input instanceof Request ? input.url : input;
    if (!isOurBackend(url)) return nativeFetch(input, init);

    // A Request's headers live on the Request, not on init.
    if (input instanceof Request) {
      const headers = new Headers(input.headers);
      headers.set('ngrok-skip-browser-warning', 'true');
      return nativeFetch(new Request(input, { headers }), init);
    }
    const headers = new Headers(init.headers || {});
    headers.set('ngrok-skip-browser-warning', 'true');
    return nativeFetch(input, { ...init, headers });
  };
}

// Wrapper around fetch that automatically attaches the auth Bearer token
// (read from localStorage where AuthContext persists it). Use this for any
// API call that may need to be attributed to the signed-in user. When an
// authenticated call comes back 401 (token missing/expired/invalid) it
// dispatches a 'rt:auth-expired' event so AuthContext can sign the user out
// and bounce to the login screen instead of leaving them on a silently-broken
// page.
export function authFetch(input, init = {}) {
  let token = null;
  token = getItem('rt_authToken');
  const headers = new Headers(init.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(input, { ...init, headers }).then((res) => {
    if (res.status === 401 && token) {
      try { window.dispatchEvent(new Event('rt:auth-expired')); } catch { /* non-browser */ }
    }
    return res;
  });
}
