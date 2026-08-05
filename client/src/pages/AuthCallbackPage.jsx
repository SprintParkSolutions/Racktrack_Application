import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './AuthPages.module.css';
import { useAuth } from '../AuthContext.jsx';
import { parseAuthFragment } from '../utils/socialSession';

/**
 * Landing point for the web social sign-in redirect
 * (https://<app>/auth/callback#token=…&user=…).
 *
 * Native never reaches this route — a deep link arrives on an app that is
 * already running, so App.jsx handles it directly. Both paths share
 * parseAuthFragment and adoptSession, so they cannot drift apart.
 *
 * This screen is deliberately almost empty. It exists for the fraction of a
 * second between the redirect landing and the session being adopted; anything
 * elaborate here would flash.
 */
export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const { adoptSession } = useAuth();
  // React 18 StrictMode runs effects twice in dev. Adopting a session is
  // idempotent, but navigating twice is not, so guard it.
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const result = parseAuthFragment(window.location.hash);

    // Drop the fragment from the address bar before doing anything else, so the
    // token isn't sitting in the URL bar or in browser history.
    try {
      window.history.replaceState(null, '', window.location.pathname);
    } catch { /* non-fatal */ }

    if (!result) {
      navigate('/login', { replace: true });
      return;
    }
    if (!result.ok) {
      navigate('/login', { replace: true, state: { socialError: result.message } });
      return;
    }

    const user = adoptSession(result.token, result.user);
    // Same routing rule as LoginPage: an org still awaiting owner approval gets
    // picked up by the route guards, so send everyone to their normal landing
    // spot and let those decide.
    navigate(user?.role === 'owner' || user?.role === 'org_admin' ? '/' : '/scan',
      { replace: true });
  }, [adoptSession, navigate]);

  return (
    <div className={styles.authPage}>
      <main className={styles.authShell}>
        <p className={styles.subheading} role="status" aria-live="polite">Signing you in&hellip;</p>
        <span className={styles.spinner} />
      </main>
    </div>
  );
}
