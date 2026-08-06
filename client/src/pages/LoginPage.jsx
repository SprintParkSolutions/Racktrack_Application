import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import styles from './AuthPages.module.css';
import AuthBackdrop from '../components/AuthBackdrop.jsx';
import { useAuth } from '../AuthContext.jsx';
import SocialSignIn from '../components/SocialSignIn.jsx';

const Arrow = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
  </svg>
);

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, loading } = useAuth();
  const [org,      setOrg]      = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  // A failed social sign-in redirects back here carrying its reason, so the
  // user learns "no account uses that address" instead of silently landing on
  // an empty login form.
  const [error,    setError]    = useState(location.state?.socialError || null);

  const from = location.state?.from || '/scan';

  const submit = async (e) => {
    e?.preventDefault();
    setError(null);
    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }
    try {
      // Organization is optional: given, it scopes the lookup (needed when the
      // same username exists in more than one org); left blank, we fall back to
      // the global username/email lookup. Either way we route by the account's
      // REAL role once the credentials resolve — no role picker.
      const u = await login(username.trim(), password, org.trim());
      // Everyone lands on Home after signing in. Owner / org-admin used to be
      // sent straight to the organization dashboard; they now start on Home
      // like everyone else and reach the dashboard from the Profile page or the
      // sidebar. A deep link that bounced them to login is still honoured.
      if (u?.role === 'owner' || u?.role === 'org_admin') {
        navigate(location.state?.from || '/', { replace: true });
      } else {
        navigate(from, { replace: true });
      }
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className={styles.authPage}>
      <AuthBackdrop />

      <header className={styles.authHeader}>
        <button className={styles.authBack} onClick={() => navigate('/')} aria-label="Back to home">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>
        <span className={styles.authHeaderTitle}>Sign in</span>
        <span aria-hidden="true" />
      </header>

      <main className={styles.authShell}>

        <div className={styles.authBrandLockup} style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:'10px', marginBottom:'22px' }}>
          <img src="/logo.jpg" alt="" style={{ width:'40px', height:'40px', borderRadius:'11px', objectFit:'cover', boxShadow:'var(--lift)' }} />
          <span style={{ fontFamily: 'var(--font)', fontWeight:800, fontSize:'1.15rem', letterSpacing:'-0.01em' }}>RackTrack</span>
        </div>

        <h1 className={styles.heading}>Welcome back</h1>
        <p className={styles.subheading}>Sign in to continue.</p>

        <form className={styles.form} onSubmit={submit} autoComplete="on">
          <div className={styles.field}>
            <label className={styles.label} htmlFor="login-org">Organization <span className={styles.labelOpt}>(optional)</span></label>
            <input
              id="login-org"
              className={styles.input}
              type="text"
              autoComplete="organization"
              value={org}
              onChange={e => { setOrg(e.target.value); setError(null); }}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="login-user">Username or email</label>
            <input
              id="login-user"
              className={styles.input}
              type="text"
              autoComplete="username"
              value={username}
              onChange={e => { setUsername(e.target.value); setError(null); }}
              autoFocus
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="login-pw">Password</label>
            <div className={styles.pwRow}>
            <input
              id="login-pw"
              className={styles.input}
              type={showPw ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={e => { setPassword(e.target.value); setError(null); }}
            />
            <button type="button" className={styles.eyeBtn} onClick={() => setShowPw(v => !v)}
              aria-label={showPw ? 'Hide password' : 'Show password'}>
              {showPw
                ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
            </button>
            </div>
          </div>

          <div className={styles.forgotRow}>
            <Link
              to="/forgot-password"
              state={{ email: username.includes('@') ? username.trim() : '' }}
              className={styles.forgotLink}
            >
              Forgot password?
            </Link>
          </div>

          {error && (
            <div className={styles.errBox}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              {error}
            </div>
          )}


          <button type="submit" className={styles.primaryBtn} disabled={loading}>
            <span>Sign in</span>
            <span className={styles.btnArrow}>
              {loading ? <span className={styles.spinner}/> : <Arrow />}
            </span>
          </button>
        </form>

        <SocialSignIn mode="login" />

        <div className={styles.altRow}>
          New here?
          <Link to="/signup" state={{ from }} className={styles.altLink}>Create an organization</Link>
        </div>

        {/* A brand-new user otherwise has no way to know that joining an
            existing team is invite/credentials-only — spell out the paths. */}
        {/* A carved well, not a bordered box — matches the depth system used
            by the inputs above it (see --press in index.css). */}
        <div style={{
          marginTop: 18, padding: '15px 17px', borderRadius: 12,
          background: 'var(--sunken, #e8e8e8)',
          boxShadow: 'var(--press)',
          border: 0,
          fontSize: '0.82rem', lineHeight: 1.55,
          color: 'var(--muted, #474747)',
        }}>
          <div style={{ fontWeight: 700, color: 'var(--md-on-surface, #1c1c1c)', marginBottom: 5 }}>
            How to get access
          </div>
          <div style={{ marginBottom: 6 }}>
            <b>Setting up your own team?</b> Tap <b>Create an organization</b> above.
          </div>
          <div>
            <b>Joining an existing team?</b> Ask your organization admin for an
            <b> invite link</b>, or a <b>username &amp; password</b> — new sign-ups can’t
            join an existing organization on their own.
          </div>
        </div>
      </main>
    </div>
  );
}
