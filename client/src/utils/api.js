// In dev, VITE_API_BASE is empty → Vite's proxy routes /api, /outputs, /uploads.
// In the APK build, we set VITE_API_BASE=https://<public-host> so the WebView
// can reach the real backend instead of its own (non-existent) origin.
const API_BASE = import.meta.env.VITE_API_BASE || '';
const APP_KEY  = import.meta.env.VITE_APP_KEY  || '';

// Append ?app_key=... to a URL so the server's app-key gate accepts it.
// The key rides in the query string rather than a header because <img>/<video>/
// <a download> URLs can't carry custom headers. Appending on every URL means a
// single code path works for both fetches and tag-driven media loads.
function withAppKey(url) {
  if (!APP_KEY) return url;
  const sep = url.includes('?') ? '&' : '?';
  return url + sep + 'app_key=' + encodeURIComponent(APP_KEY);
}

export function apiUrl(path) {
  if (!path) return path;
  if (/^https?:\/\//i.test(path)) return withAppKey(path); // already absolute
  return withAppKey(API_BASE + path);
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
  try { token = localStorage.getItem('rt_authToken'); } catch { /* ignore */ }
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
