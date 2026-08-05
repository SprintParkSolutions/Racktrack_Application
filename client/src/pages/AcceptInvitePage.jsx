import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import styles from './AuthPages.module.css';
import AuthBackdrop from '../components/AuthBackdrop.jsx';
import { setItem } from '../utils/safeStorage';
import { apiUrl } from '../utils/api';
import SocialSignIn from '../components/SocialSignIn.jsx';

const Eye = ({ off }) => off
  ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
  : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>;

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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not accept the invite.');
      try {
        // Guarded: this is the same unguarded-write crash that blanked the
        // app at sign-in on storage-blocked browsers. Failing to persist means
        // signing in again next launch; throwing here means losing the app.
        setItem('rt_authToken', d.token);
        setItem('rt_authUser', JSON.stringify(d.user));
      } catch (_) { /* ignore */ }
      window.location.assign('/scan');   // full reload so AuthContext picks up the session
    } catch (ex) { setErr(ex.message); setBusy(false); }
  };

  return (
    <div className={styles.authPage}>
      <AuthBackdrop />
      <main className={styles.authShell}>
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
            <form className={styles.form} onSubmit={submit} autoComplete="on">
              <div className={styles.field}>
                <label className={styles.label}>Email</label>
                <input className={styles.input} value={invite.email} disabled readOnly />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="inv-user">Choose a username</label>
                <input id="inv-user" className={styles.input} type="text" autoComplete="username"
                  value={username} onChange={e => { setUsername(e.target.value); setErr(null); }} autoFocus />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="inv-pw">Create a password</label>
                <div className={styles.pwRow}>
                  <input id="inv-pw" className={styles.input} type={showPw ? 'text' : 'password'}
                    autoComplete="new-password" value={password}
                    onChange={e => { setPassword(e.target.value); setErr(null); }} />
                  <button type="button" className={styles.eyeBtn} onClick={() => setShowPw(v => !v)}
                    aria-label={showPw ? 'Hide password' : 'Show password'}><Eye off={showPw} /></button>
                </div>
              </div>
              {err && (
                <div className={styles.errBox}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  {err}
                </div>
              )}
              <button type="submit" className={styles.primaryBtn} disabled={busy}>
                <span>{busy ? 'Joining…' : 'Join'}</span>
              </button>
            </form>

            {/* Joining this way skips inventing a username and a password that
                satisfies the four-class policy. The server still requires the
                provider to assert THIS invite's email address, so the button is
                no weaker than the form above it. */}
            <SocialSignIn mode="invite" inviteCode={code} />
          </>
        )}
      </main>
    </div>
  );
}
