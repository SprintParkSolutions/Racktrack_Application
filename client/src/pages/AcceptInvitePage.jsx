import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import styles from './AuthPages.module.css';
import AuthLayout, { AuthAside, IcAlert, IcEye } from '../components/AuthLayout.jsx';
import { setItem } from '../utils/safeStorage';
import { apiUrl } from '../utils/api';
import SocialSignIn from '../components/SocialSignIn.jsx';

function roleLabel(r) {
  return { site_manager: 'Site Manager', member: 'Member' }[r] || 'Member';
}

export default function AcceptInvitePage() {
  const { code } = useParams();
  const [invite, setInvite] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(apiUrl(`/api/invites/${code}`))
      .then(r => r.json().then(d => ({ ok: r.ok, d })))
      .then(({ ok, d }) => { if (cancelled) return; if (ok && d.ok) setInvite(d.invite); else setErr(d.error || 'This invite is invalid.'); })
      .catch(() => { if (!cancelled) setErr('Could not load this invite.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [code]);

  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    if (!username.trim()) { setErr('Choose a username.'); return; }
    if (!password) { setErr('Create a password.'); return; }
    setBusy(true);
    try {
      const r = await fetch(apiUrl(`/api/invites/${code}/accept`), {
        method: 'POST',
        credentials: 'include',   // so the server's session cookies land
        headers: {
          'Content-Type': 'application/json',
          ...(Capacitor.isNativePlatform() ? { 'X-Client-Platform': 'native' } : {}),
        },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not accept the invite.');
      try {
        // Guarded: this is the same unguarded-write crash that blanked the
        // app at sign-in on storage-blocked browsers. Failing to persist means
        // signing in again next launch; throwing here means losing the app.
        //
        // d.token only comes back for native; on web the session is in the
        // cookies set above and there is nothing to store but the cached user.
        if (d.token) setItem('rt_authToken', d.token);
        setItem('rt_authUser', JSON.stringify(d.user));
      } catch (_) { /* ignore */ }
      window.location.assign('/scan');   // full reload so AuthContext picks up the session
    } catch (ex) { setErr(ex.message); setBusy(false); }
  };

  return (
    <AuthLayout
      aside={
        <AuthAside text="Already have an account?">
          <Link to="/login" className={styles.asideLink}>Sign in</Link>
        </AuthAside>
      }
    >
      {loading ? (
        <p className={styles.subheading}>Loading your invite…</p>
      ) : !invite ? (
        <>
          <h1 className={styles.heading}>Invite unavailable</h1>
          <p className={styles.subheading}>{err || 'This invite is invalid or has expired.'}</p>
          <div className={styles.altRow}>
            <Link to="/login" className={styles.altLink}>Go to sign in</Link>
          </div>
        </>
      ) : (
        <>
          <h1 className={styles.heading}>You're invited</h1>
          <p className={styles.subheading}>
            Join <b>{invite.organization}</b> · {invite.site} as {roleLabel(invite.role)}.
          </p>

          {/* Joining this way skips inventing a username and a password that
              satisfies the four-class policy. The server still requires the
              provider to assert THIS invite's email address, so the button is
              no weaker than the form below it. */}
          <SocialSignIn mode="invite" inviteCode={code} />

          <form className={styles.form} onSubmit={submit} autoComplete="on">
            <div className={styles.field}>
              <label className={styles.label} htmlFor="inv-email">Email</label>
              <div className={styles.inputWrap}>
                <input id="inv-email" className={styles.input} value={invite.email} disabled readOnly />
              </div>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="inv-user">Choose a username</label>
              <div className={styles.inputWrap}>
                <input id="inv-user" className={styles.input} type="text" autoComplete="username"
                  value={username} onChange={e => { setUsername(e.target.value); setErr(null); }} autoFocus />
              </div>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="inv-pw">Create a password</label>
              <div className={styles.inputWrap}>
                <input id="inv-pw" className={`${styles.input} ${styles.inputPw}`} type={showPw ? 'text' : 'password'}
                  autoComplete="new-password" value={password}
                  onChange={e => { setPassword(e.target.value); setErr(null); }} />
                <button type="button" className={styles.eyeBtn} onClick={() => setShowPw(v => !v)}
                  aria-label={showPw ? 'Hide password' : 'Show password'}><IcEye off={showPw} /></button>
              </div>
            </div>
            {err && (
              <div className={styles.errBox}><IcAlert width="14" height="14" />{err}</div>
            )}
            <button type="submit" className={styles.primaryBtn} disabled={busy}>
              {busy && <span className={styles.spinner} />}
              <span>{busy ? 'Joining…' : `Join ${invite.organization}`}</span>
            </button>
          </form>
        </>
      )}
    </AuthLayout>
  );
}
