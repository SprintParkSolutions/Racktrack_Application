import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import styles from './ProfilePage.module.css';
import PageHeader from '../components/PageHeader.jsx';
import { useAuth } from '../AuthContext.jsx';
import { useConnections } from '../ConnectionsContext.jsx';
import { useScanSite } from '../hooks/useScanSite.js';
import { TYPE_INFO } from '../utils/connectionsApi';
import { apiUrl, authFetch } from '../utils/api';
import Avatar from '../components/Avatar.jsx';
import { AVATARS, resolveAvatarIndex } from '../utils/avatars';
import Icon from '../components/Icon';
import AssetImg from '../components/AssetImg';

function formatJoined(d) {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
  } catch { return null; }
}
function formatRelative(d) {
  if (!d) return '-';
  const ms = Date.now() - new Date(d).getTime();
  if (isNaN(ms) || ms < 0) return 'now';
  const m = Math.floor(ms / 60000);
  if (m < 1)   return 'just now';
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7)  return `${days}d ago`;
  if (days < 30) return `${Math.floor(days/7)}w ago`;
  return `${Math.floor(days/30)}mo ago`;
}
const titleCase = (s) => (s ? String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '-');

/* A rack nobody has named is known only by the hash of its photograph, which
   is not something to print at a person. The same test Home and the report
   page use. */
const UNNAMED = /^RK-[0-9A-F]{6,}$/i;
const NO_NAME = 'Rack not identified yet';

export default function ProfilePage() {
  const navigate = useNavigate();
  const { user, logout, refreshUser } = useAuth();
  const { active: activeConnection } = useConnections();
  // The only thing that knows a rack's name and the Site it stands in.
  const { sites } = useScanSite();
  const [scans, setScans] = useState([]);
  const [scansLoading, setScansLoading] = useState(true);
  const [scansError, setScansError] = useState(null);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);

  const currentAvatar = resolveAvatarIndex(user);
  const chooseAvatar = async (idx) => {
    setSavingAvatar(true);
    try {
      const r = await authFetch(apiUrl('/api/auth/avatar'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar: idx }),
      });
      if (r.ok) { await refreshUser?.(); setPickerOpen(false); }
    } catch (_) { /* keep the sheet open so they can retry */ }
    finally { setSavingAvatar(false); }
  };

  useEffect(() => {
    let cancelled = false;
    setScansLoading(true);
    authFetch(apiUrl('/api/scans'))
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Could not load your scans. Try again.')))
      .then(data => { if (!cancelled) { setScans(data.scans || []); setScansError(null); } })
      .catch(err => { if (!cancelled) setScansError(err.message); })
      .finally(() => { if (!cancelled) setScansLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // The "copied" flag has to be cleared on a timer, and that timer has to be
  // cancelled on unmount - otherwise navigating away mid-countdown sets state
  // on a page that no longer exists.
  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  const joined = useMemo(() => formatJoined(user?.created_at), [user]);
  /* rack id -> the name it was given when it was set up. Without this the
     list printed the hash of the photograph, which says nothing to anybody
     and is not a name. */
  const rackNames = useMemo(() => {
    const out = new Map();
    for (const site of sites || []) {
      for (const r of site.racks || []) {
        if (!r || r.rackId == null) continue;
        const name = String(r.name || '').trim();
        if (name && !UNNAMED.test(name)) out.set(String(r.rackId), name);
      }
    }
    return out;
  }, [sites]);
  // Profile shows the 5 most recent only; the rest live on /history.
  const recent = useMemo(() => scans.slice(0, 5), [scans]);
  const orgName = user?.organization?.name || user?.tenant?.name || 'DEFAULT';
  const isAdmin = user?.role === 'owner' || user?.role === 'org_admin';

  const onSignOut = () => {
    logout();
    navigate('/', { replace: true });
  };

  // Sign out everywhere. The endpoint bumps token_version and revokes every
  // refresh row, which invalidates THIS session too - so the only correct
  // follow-up is to drop the local session and land on the sign-in page.
  // Treating a failure as success would leave someone believing a stolen
  // laptop had been locked out when it had not.
  const revokeEverywhere = async () => {
    setRevoking(true);
    try {
      const r = await authFetch(apiUrl('/api/auth/logout-all'), { method: 'POST' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) throw new Error(data.error || 'Could not sign out everywhere. Try again.');
      logout();
      navigate('/', { replace: true });
    } catch (err) {
      setScansError(err.message);
      setConfirmingRevoke(false);
    } finally {
      setRevoking(false);
    }
  };

  const copyEmail = async () => {
    if (!user?.email) return;
    try {
      await navigator.clipboard.writeText(user.email);
      setCopied(true);
    } catch { /* clipboard blocked - the address is on screen to select */ }
  };

  const openScan = async (rackId) => {
    try {
      const meta = scans.find(s => s.rackId === rackId);
      const res  = await authFetch(apiUrl(`/api/scan/${rackId}/report?format=json`));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load scan');
      const result = {
        scanId: rackId, rackId, cached: true, timestamp: meta?.timestamp,
        devices: data.devices || [], units_detected: data.units_detected || [],
        originalExt: 'jpg',
      };
      // Navigate WITH the rackId in the URL (not bare /results) so the
      // Overview tab / sidebar link matches the route and highlights, and the
      // page is a proper deep link. state.result still preloads the data so it
      // doesn't refetch.
      navigate(`/results/${rackId}`, { state: { result } });
    } catch (err) { setScansError(err.message); }
  };

  return (
    <div className={`page page-full ${styles.profile}`}>
      <PageHeader
        title="Profile"
        backFallback="/"
        sticky
        /* Kept even though the identity block below carries the account
           actions: on a phone the sidebar is a bottom bar with no sign-out,
           so removing this would leave that surface with no way out. */
        action={(
          <button
            type="button"
            className={styles.topbarIconBtn}
            onClick={() => setConfirmingSignOut(true)}
            aria-label="Sign out">
            <Icon name="logout" />
          </button>
        )}
      />

      <main className={styles.main}>
        {/* ── Identity ──
            An <img> banner rather than a CSS background: index.css strips
            background-image from a broad substring allow-list, so a background
            here would silently vanish.

            The picture is a lit white aisle with the cabinet doors down one
            side. It was a near-black photograph of tangled orange and blue
            patch leads, which is what a datacenter looks like when nobody has
            tidied it - the owner asked on 23 September 2026 for something
            professional, and this is the one in the bundle that is. It is
            also white, which is the app. */}
        <section className={styles.identity}>
          <div className={styles.banner} aria-hidden="true">
            <img src="/home-aisle.jpg" alt="" className={styles.bannerImg} loading="lazy" />
          </div>

          <div className={styles.idRow}>
            <button
              type="button"
              className={styles.avatarBtn}
              onClick={() => setPickerOpen(true)}
              aria-label="Change profile picture"
            >
              <Avatar user={user} size={104} ring />
              <span className={styles.avatarEdit}><Icon name="edit" /></span>
            </button>

            <div className={styles.idText}>
              <h2 className={styles.name}>{user?.username || 'Guest'}</h2>
              {user?.email && (
                <p className={styles.email}>
                  <span className={styles.emailText}>{user.email}</span>
                  <button
                    type="button"
                    className={styles.copyBtn}
                    onClick={copyEmail}
                    aria-label={copied ? 'Email copied' : 'Copy email address'}
                  >
                    <Icon name={copied ? 'check' : 'copy'} />
                  </button>
                  {copied && <span className={styles.copied}>Copied</span>}
                </p>
              )}
              {/* What this person is, and where. The organisation, the Site
                  and the join date are all rows in Profile details now, so
                  this line says the one thing the name does not. */}
              <p className={styles.metaLine}>
                {[titleCase(user?.role), user?.tenant?.name || orgName].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>
        </section>

        {scansError && <div className={styles.errBanner} role="alert">{scansError}</div>}

        <div className={styles.cols}>
          {/* ── Left column ── */}
          <div className={styles.colMain}>
            {isAdmin && (
              <section className={styles.block}>
                <h3 className={styles.blockH}>Administration</h3>
                <button
                  type="button"
                  className={styles.row}
                  onClick={() => navigate('/organizations')}
                >
                  <span className={styles.rowIcon}><Icon name="space_dashboard" /></span>
                  <span className={styles.rowMain}>
                    <span className={styles.rowTitle}>
                      {user?.role === 'owner' ? 'Owner Dashboard' : 'Organization Dashboard'}
                    </span>
                    <span className={styles.rowMeta}>
                      {user?.role === 'owner'
                        ? 'All organizations, sites & scans'
                        : 'Sites, members & scan activity'}
                    </span>
                  </span>
                  <Icon name="chevron_right" className={styles.rowChevron} />
                </button>
                <button
                  type="button"
                  className={styles.row}
                  onClick={() => navigate('/setup')}
                >
                  <span className={styles.rowIcon}><Icon name="apartment" /></span>
                  <span className={styles.rowMain}>
                    <span className={styles.rowTitle}>Organization settings</span>
                    <span className={styles.rowMeta}>Sites, their SPOCs and the rules</span>
                  </span>
                  <Icon name="chevron_right" className={styles.rowChevron} />
                </button>
              </section>
            )}

            <section className={styles.block}>
              <h3 className={styles.blockH}>Recent scans</h3>

              {scansLoading && (
                <div className={styles.note}>Loading scans…</div>
              )}

              {!scansLoading && recent.length === 0 && !scansError && (
                <div className={styles.empty}>
                  <p className={styles.emptyText}>No scans yet.</p>
                  <button className={styles.startBtn} onClick={() => navigate('/scan')}>
                    Start your first scan
                  </button>
                </div>
              )}

              {!scansLoading && recent.length > 0 && (
                <ul className={styles.rowList}>
                  {recent.map(s => (
                    <li key={s.rackId}>
                      <button
                        type="button"
                        className={styles.row}
                        onClick={() => openScan(s.rackId)}
                      >
                        <span className={styles.rowThumb}>
                          {s.image
                            ? <AssetImg path={s.image} alt="" loading="lazy" />
                            : <Icon name="terminal" />}
                        </span>
                        <span className={styles.rowMain}>
                          <span className={`${styles.rowTitle} ${styles.rowTitleMono} ${rackNames.get(String(s.rackId)) ? '' : styles.rowTitleNone}`}>
                            {rackNames.get(String(s.rackId)) || NO_NAME}
                          </span>
                          <span className={styles.rowMeta}>
                            {s.deviceCount} device{s.deviceCount === 1 ? '' : 's'}
                          </span>
                        </span>
                        <span className={styles.rowEnd}>
                          <span className={styles.rowTime}>{formatRelative(s.timestamp)}</span>
                          <Icon name="chevron_right" className={styles.rowChevron} />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {/* Beyond five, the archive is its own page - expanding the list in
                  place turned Profile into an endless scroll with no way to find a
                  particular rack. /history is searchable, filtered and paged. */}
              {!scansLoading && scans.length > 5 && (
                <button
                  type="button"
                  className={styles.showAllBtn}
                  onClick={() => navigate('/history')}
                >
                  View all {scans.length} scans
                  <Icon name="chevron_right" className={styles.showAllChevron} />
                </button>
              )}
            </section>
          </div>

          {/* ── Right column ── */}
          <div className={styles.colSide}>
            {isAdmin && (
              <section className={styles.block}>
                <h3 className={styles.blockH}>Data sources</h3>
                <button
                  type="button"
                  className={styles.row}
                  onClick={() => navigate('/connections')}
                >
                  <span className={styles.rowIcon}><Icon name="dns" /></span>
                  <span className={styles.rowMain}>
                    <span className={styles.rowTitle}>
                      {activeConnection ? activeConnection.name : 'Connect a database'}
                    </span>
                    <span className={styles.rowMeta}>
                      {activeConnection
                        ? <>{TYPE_INFO[activeConnection.type]?.label || activeConnection.type} · <span className={styles.ok}>Active</span></>
                        : 'Set up ServiceNow, NetBox, Orion…'}
                    </span>
                  </span>
                  <Icon name="chevron_right" className={styles.rowChevron} />
                </button>
              </section>
            )}

            <section className={styles.block}>
              <h3 className={styles.blockH}>Profile details</h3>
              {/* It was one row saying Role, under a heading, in a card of its
                  own: a container three times the height of what it held. The
                  owner asked on 23 September 2026 for this page to be worth
                  opening, so it says what the account actually is. Every line
                  comes from the signed-in account and one that is not there is
                  left out rather than printed as a dash. */}
              <dl className={styles.details}>
                <div className={styles.detail}>
                  <dt className={styles.dt}>Role</dt>
                  <dd className={styles.dd}>{titleCase(user?.role)}</dd>
                </div>
                <div className={styles.detail}>
                  <dt className={styles.dt}>Username</dt>
                  <dd className={styles.dd}>{user?.username || '-'}</dd>
                </div>
                {user?.tenant?.name && (
                  <div className={styles.detail}>
                    <dt className={styles.dt}>Site</dt>
                    <dd className={styles.dd}>{user.tenant.name}</dd>
                  </div>
                )}
                {user?.organization?.name && (
                  <div className={styles.detail}>
                    <dt className={styles.dt}>Organization</dt>
                    <dd className={styles.dd}>{user.organization.name}</dd>
                  </div>
                )}
                {joined && (
                  <div className={styles.detail}>
                    <dt className={styles.dt}>Member since</dt>
                    <dd className={styles.dd}>{joined}</dd>
                  </div>
                )}
                <div className={styles.detail}>
                  <dt className={styles.dt}>Racks read</dt>
                  <dd className={styles.dd}>{scansLoading ? '-' : scans.length}</dd>
                </div>
              </dl>
            </section>

            <section className={styles.block}>
              <h3 className={styles.blockH}>Account actions</h3>
              <div className={styles.actionWrap}>
                <button
                  type="button"
                  className={styles.danger}
                  onClick={() => setConfirmingRevoke(true)}
                  disabled={revoking}
                >
                  <Icon name="logout" className={styles.dangerIcon} />
                  {revoking ? 'Signing out…' : 'Sign out from all devices'}
                </button>
                <p className={styles.actionNote}>
                  Ends every session, including this one.
                </p>
              </div>
            </section>
          </div>
        </div>
      </main>

      {/* ── Sign-out confirm ── */}
      {confirmingSignOut && (
        <div className={styles.confirmBackdrop}>
          <div className={styles.confirmModal}>
            <div className={styles.confirmIcon}><Icon name="logout" /></div>
            <h3 className={styles.confirmTitle}>Sign out?</h3>
            <p className={styles.confirmMsg}>You&apos;ll need to sign in again to scan racks.</p>
            <div className={styles.confirmActions}>
              <button className={styles.confirmCancel} onClick={() => setConfirmingSignOut(false)}>Cancel</button>
              <button className={styles.confirmGo} onClick={onSignOut}>Sign out</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Sign-out-everywhere confirm ──
          Separate from the ordinary sign-out prompt on purpose: this one also
          ends sessions on devices the person is not holding, and that is not
          something to discover after the fact. */}
      {confirmingRevoke && (
        <div className={styles.confirmBackdrop}>
          <div className={styles.confirmModal}>
            <div className={styles.confirmIcon}><Icon name="logout" /></div>
            <h3 className={styles.confirmTitle}>Sign out from all devices?</h3>
            <p className={styles.confirmMsg}>
              Signs out every device using <strong>{user?.username}</strong>, including this one.
            </p>
            <div className={styles.confirmActions}>
              <button className={styles.confirmCancel} onClick={() => setConfirmingRevoke(false)} disabled={revoking}>
                Cancel
              </button>
              <button className={styles.confirmGo} onClick={revokeEverywhere} disabled={revoking}>
                {revoking ? 'Signing out…' : 'Sign out everywhere'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Avatar picker ── */}
      {/* The sheet is drawn on the document itself, not inside the page. The
          phone's floating bar sits in a stacking context of its own and was
          painted over the last row of pictures and the Close button whatever
          z-index this carried (23 September 2026). */}
      {pickerOpen && createPortal(
        <div
          onClick={() => !savingAvatar && setPickerOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 1200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            background: 'rgba(0, 0, 0,.55)', backdropFilter: 'blur(4px)' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 440, background: 'var(--md-background, #fff)', color: 'var(--md-on-surface, #171717)',
              borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: '20px 22px calc(24px + env(safe-area-inset-bottom))',
              boxShadow: '0 -10px 40px rgba(0,0,0,.28)' }}
          >
            <div style={{ width: 38, height: 4, borderRadius: 2, background: 'rgba(128,128,128,.35)', margin: '0 auto 16px' }} />
            <h3 style={{ margin: '0 0 4px', fontSize: 'var(--fs-head)', fontWeight: 'var(--fw-title)', textAlign: 'center' }}>Choose your picture</h3>
            <p style={{ margin: '0 0 18px', fontSize: 'var(--fs-body)', opacity: .6, textAlign: 'center' }}>Pick a look - tap to save.</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, justifyItems: 'center' }}>
              {AVATARS.map((_, idx) => (
                <Avatar
                  key={idx}
                  index={idx}
                  initial={(user?.username || user?.email || '?').charAt(0).toUpperCase()}
                  size={64}
                  ring={idx === currentAvatar}
                  title={idx === currentAvatar ? 'Current' : 'Select'}
                  onClick={() => !savingAvatar && chooseAvatar(idx)}
                  style={savingAvatar ? { opacity: .5, pointerEvents: 'none' } : undefined}
                />
              ))}
            </div>
            <button
              onClick={() => !savingAvatar && setPickerOpen(false)}
              style={{ width: '100%', marginTop: 22, padding: '13px', borderRadius: 13, border: '1px solid rgba(128,128,128,.28)',
                background: 'transparent', color: 'inherit', fontSize: 'var(--fs-section)', fontWeight: 'var(--fw-title)', cursor: 'pointer' }}
            >
              {savingAvatar ? 'Saving…' : 'Close'}
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
