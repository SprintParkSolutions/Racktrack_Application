import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiUrl, refreshAssetToken, clearAssetToken, installAssetTokenRefresh } from './utils/api';
import { getItem, getJSON, removeItem, setItem } from './utils/safeStorage';

const AuthContext = createContext(null);
const TOKEN_KEY = 'rt_authToken';
const USER_KEY  = 'rt_authUser';

function readStored() {
  return { token: getItem(TOKEN_KEY), user: getJSON(USER_KEY) };
}

async function callApi(path, options = {}) {
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* non-JSON response */ }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export function AuthProvider({ children }) {
  const [{ token, user }, setState] = useState(readStored);
  const [loading, setLoading] = useState(false);

  // Persist on every change.
  //
  // These writes are unguarded no longer: a storage-blocked browser threw here
  // the instant a sign-in succeeded, and with the throw landing inside an
  // effect the whole app unmounted — the user watched login work and then got
  // a white screen. Failing to persist just means they sign in again next
  // launch, which is a far better outcome than losing the app.
  useEffect(() => {
    if (token) setItem(TOKEN_KEY, token);
    else removeItem(TOKEN_KEY);
    if (user) setItem(USER_KEY, JSON.stringify(user));
    else removeItem(USER_KEY);

    // Rack images are served to <img>, which cannot send an Authorization
    // header, so they travel with a separate short-lived asset token. Minted
    // here rather than at each of the five sign-in paths: this effect already
    // runs on every token change, so login, signup, code-login, logout and
    // session expiry are all covered by one place that cannot be forgotten.
    if (token) {
      refreshAssetToken();
      // The capability expires in 12 hours while this token lasts 30 days, and
      // this effect only re-runs when the auth token itself changes. A phone
      // that keeps the app resident and resumes it the next day would otherwise
      // hold a dead capability: fetches keep working, every <img> 404s. Re-mint
      // on foreground too.
      installAssetTokenRefresh();
    } else clearAssetToken();
  }, [token, user]);

  // Validate stored token against the server on mount; clear if the server
  // explicitly rejects (401/403). A network failure (server unreachable) 
  // must NOT clear the token, otherwise the user gets bounced to /login 
  // and that page also can't fetch.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch(apiUrl('/api/auth/me'), { headers: { Authorization: `Bearer ${token}` } })
      .then(r => {
        if (cancelled) return null;
        if (r.ok) return r.json();
        if (r.status === 401 || r.status === 403) {
          setState({ token: null, user: null });
        }
        return null;
      })
      .then(data => { if (!cancelled && data?.user) setState(prev => ({ ...prev, user: data.user })); })
      .catch(() => {
        // Network error — keep the cached token. The user can still use
        // offline features; auth will revalidate next time the server is
        // reachable.
      });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Any /api request that comes back 401 fires this event (set up by the
  // global fetch interceptor in main.jsx). Treat it as "your token is no
  // longer valid": clear the session so ProtectedRoute bounces to /login.
  useEffect(() => {
    const onExpired = () => setState({ token: null, user: null });
    window.addEventListener('rt:auth-expired', onExpired);
    return () => window.removeEventListener('rt:auth-expired', onExpired);
  }, []);

  const login = useCallback(async (username, password, tenant = '') => {
    setLoading(true);
    try {
      const body = { username, password };
      if (tenant) body.tenant = tenant;
      const data = await callApi('/api/auth/login', { body });
      setState({ token: data.token, user: data.user });
      // Fresh session — drop any "last rack" left in memory from a previous
      // login so the Overview / rack nav doesn't open a stale past scan. The
      // rack section reappears once the user runs a new scan.
      try { window.dispatchEvent(new CustomEvent('rt:rack-id-changed', { detail: null })); } catch (_) {}
      return data.user;
    } finally { setLoading(false); }
  }, []);

  const forgotPassword = useCallback(async (email) => {
    return await callApi('/api/auth/forgot-password', { body: { email } });
  }, []);

  // Validates the 6-digit code without consuming it. The page uses this
  // before asking "Do you want to change your password?" so a wrong/expired
  // code can't slip past that confirmation step.
  const verifyResetCode = useCallback(async (email, code) => {
    setLoading(true);
    try {
      return await callApi('/api/auth/verify-reset-code', { body: { email, code } });
    } finally { setLoading(false); }
  }, []);

  const resetPassword = useCallback(async (email, code, password) => {
    setLoading(true);
    try {
      const data = await callApi('/api/auth/reset-password', { body: { email, code, password } });
      setState({ token: data.token, user: data.user });
      return data.user;
    } finally { setLoading(false); }
  }, []);

  // Sign in via the verified reset code WITHOUT changing the password.
  // The code stays valid only until this call (the server consumes it),
  // and the existing password remains unchanged.
  const loginWithCode = useCallback(async (email, code) => {
    setLoading(true);
    try {
      const data = await callApi('/api/auth/login-with-code', { body: { email, code } });
      setState({ token: data.token, user: data.user });
      return data.user;
    } finally { setLoading(false); }
  }, []);

  const signup = useCallback(async (email, username, password, company = '') => {
    setLoading(true);
    try {
      return await callApi('/api/auth/signup', {
        body: { email, username, password, company },
      });
    } finally { setLoading(false); }
  }, []);

  const verifyCode = useCallback(async (email, code) => {
    setLoading(true);
    try {
      const data = await callApi('/api/auth/verify', { body: { email, code } });
      setState({ token: data.token, user: data.user });
      return data.user;
    } finally { setLoading(false); }
  }, []);

  const resendCode = useCallback(async (email) => {
    return await callApi('/api/auth/resend-code', { body: { email } });
  }, []);

  const logout = useCallback(() => {
    setState({ token: null, user: null });
    // Clear the remembered rack so the next user's Overview nav starts clean.
    try { window.dispatchEvent(new CustomEvent('rt:rack-id-changed', { detail: null })); } catch (_) {}
  }, []);

  // Re-fetch the current user from the server and update state. Used by the
  // "awaiting approval" screen to detect the moment the owner activates the org.
  // Returns the fresh user (or null if the token was rejected).
  const refreshUser = useCallback(async () => {
    if (!token) return null;
    try {
      const r = await fetch(apiUrl('/api/auth/me'), { headers: { Authorization: `Bearer ${token}` } });
      if (r.status === 401 || r.status === 403) { setState({ token: null, user: null }); return null; }
      if (!r.ok) return null;
      const data = await r.json();
      if (data?.user) { setState(prev => ({ ...prev, user: data.user })); return data.user; }
      return null;
    } catch { return null; }   // network error — keep current session
  }, [token]);

  return (
    <AuthContext.Provider value={{
      user, token, loading,
      isAuthed: !!user,
      login, signup, verifyCode, resendCode, logout, refreshUser,
      forgotPassword, verifyResetCode, resetPassword, loginWithCode,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
