import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './MarketplacePartnerAccountsPage.module.css';
import { apiUrl, authFetch } from '../utils/api';
import { useAuth } from '../AuthContext.jsx';
import MarketplaceShell from '../components/marketplace/MarketplaceShell.jsx';

/* ──────────────────────────────────────────────────────────────────────
   MarketplacePartnerAccountsPage — connect eBay, Amazon and Discord.

   Each card used to wear its partner's colours (a peach tile for eBay, a
   cream one for Amazon, periwinkle for Discord) around an emoji, which
   made three integrations of equal standing look like three unrelated
   promotions. The cards are now identical monochrome objects: the only
   thing that varies between them is the sentence explaining what
   connecting does and whether the status dot is green or grey.

   Every alert() and confirm() on this page — six of them — is now
   in-page: failures land in an error banner at the top, the webhook test
   reports into a success banner, and Disconnect asks for a second click
   in the card itself rather than in a browser dialog.
   ────────────────────────────────────────────────────────────────────── */

/* Flat stroke glyphs at the page's ink, never the partner's brand mark —
   a coloured logo would reintroduce exactly the inconsistency the
   monochrome cards were built to remove. */
const GLYPH = {
  ebay: (
    <>
      <path d="M20.6 13.4 13 21a2 2 0 0 1-2.8 0L3 13.8a2 2 0 0 1-.6-1.4V4.5a2 2 0 0 1 2-2h7.9a2 2 0 0 1 1.4.6l6.9 6.9a2 2 0 0 1 0 3.4Z" />
      <circle cx="7.6" cy="7.6" r="1.3" />
    </>
  ),
  amazon: (
    <>
      <path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5Z" />
      <path d="m3 7.5 9 4.5 9-4.5M12 12v9" />
    </>
  ),
  discord: (
    <>
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.6 9.6 0 0 1-2.9-.4L3.5 21l1.6-4.2A8.1 8.1 0 0 1 3 11.5a8.4 8.4 0 0 1 9-8.4 8.4 8.4 0 0 1 9 8.4Z" />
      <path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01" />
    </>
  ),
};

const PLATFORMS = [
  {
    id: 'ebay', name: 'eBay',
    desc: 'Cross-post listings to eBay. Connect your existing seller account via OAuth.',
  },
  {
    id: 'amazon', name: 'Amazon',
    desc: 'Publish listings to Amazon Marketplace. One-time seller account setup.',
  },
  {
    id: 'discord', name: 'Discord',
    desc: 'Push new listing announcements to a Discord channel via webhook.',
  },
];

function PlatformGlyph({ id }) {
  return (
    <svg
      className={styles.glyph}
      width="24" height="24" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false"
    >
      {GLYPH[id]}
    </svg>
  );
}

export default function MarketplacePartnerAccountsPage() {
  const navigate = useNavigate();
  const { isAuthed } = useAuth();
  const [accounts, setAccounts]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [connecting, setConnecting] = useState(null);
  const [testing, setTesting]     = useState(false);
  const [oauthStatus, setOauthStatus] = useState({ ebay: false, amazon: false });

  // Feedback that used to be alert()/confirm(): one error banner, one
  // success banner, and the id of the card currently asking "are you
  // sure?" — only ever one, so a second Disconnect closes the first.
  const [error, setError]     = useState(null);
  const [notice, setNotice]   = useState(null);
  const [confirmId, setConfirmId] = useState(null);

  useEffect(() => {
    if (!isAuthed) navigate('/login', { state: { from: '/marketplace/partners' }, replace: true });
  }, [isAuthed, navigate]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [acctRes, ebayRes, amazonRes] = await Promise.all([
          authFetch(apiUrl('/api/marketplace/partner-accounts')),
          authFetch(apiUrl('/api/marketplace/partner-accounts/ebay/status')).catch(() => null),
          authFetch(apiUrl('/api/marketplace/partner-accounts/amazon/status')).catch(() => null),
        ]);
        const data = await acctRes.json();
        if (data.ok) setAccounts(data.accounts || []);
        const eb = ebayRes ? await ebayRes.json().catch(() => ({})) : {};
        const am = amazonRes ? await amazonRes.json().catch(() => ({})) : {};
        setOauthStatus({ ebay: !!eb.configured, amazon: !!am.configured });
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, []);

  const getAccount = (platform) => accounts.find(a => a.platform === platform);

  const connectPartner = async (platform) => {
    setError(null); setNotice(null);
    // For eBay/Amazon with OAuth configured, redirect to auth URL
    if ((platform === 'ebay' || platform === 'amazon') && oauthStatus[platform]) {
      setConnecting(platform);
      try {
        const res = await authFetch(apiUrl(`/api/marketplace/partner-accounts/${platform}/auth-url`));
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
        window.location.href = data.authUrl;
        return;
      } catch (err) { setError(err.message); setConnecting(null); return; }
    }
    setConnecting(platform);
    try {
      const body = { platform };
      if (platform === 'discord') {
        if (!webhookUrl.trim()) { setError('Paste your Discord webhook URL first.'); return; }
        body.webhookUrl = webhookUrl.trim();
      }
      const res = await authFetch(apiUrl('/api/marketplace/partner-accounts'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setAccounts(prev => {
        const idx = prev.findIndex(a => a.platform === platform);
        if (idx >= 0) { const next = [...prev]; next[idx] = data.account; return next; }
        return [...prev, data.account];
      });
      if (platform === 'discord') setWebhookUrl('');
    } catch (err) { setError(err.message); }
    finally { setConnecting(null); }
  };

  const testDiscordWebhook = async () => {
    setError(null); setNotice(null);
    setTesting(true);
    try {
      const res = await authFetch(apiUrl('/api/marketplace/partner-accounts/discord/test'), {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setNotice('Test notification sent to Discord.');
    } catch (err) { setError(`Test failed: ${err.message}`); }
    finally { setTesting(false); }
  };

  const disconnectPartner = async (platform) => {
    setError(null); setNotice(null);
    setConfirmId(null);
    try {
      await authFetch(apiUrl(`/api/marketplace/partner-accounts/${platform}`), { method: 'DELETE' });
      setAccounts(prev => prev.map(a => a.platform === platform ? { ...a, status: 'disconnected' } : a));
    } catch (err) { setError(err.message); }
  };

  return (
    <MarketplaceShell
      title="Partner accounts"
      subtitle="Connect eBay, Amazon and Discord"
      action={null}
      backTo="/marketplace"
    >
      <p className="mkt-body">
        Connect your seller accounts on other platforms to cross-post RackTrack
        listings, or push announcements to a Discord channel.
      </p>

      {error && (
        <div className="mkt-banner mkt-banner--error" role="alert">
          <span>{error}</span>
          <button className="mkt-linkBtn" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}
      {notice && (
        <div className="mkt-banner mkt-banner--success" role="status">
          <span>{notice}</span>
          <button className="mkt-linkBtn" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}

      {loading && (
        <div className={styles.loading}><span className="mkt-spinner" /></div>
      )}

      {!loading && (
        <div className={styles.grid}>
          {PLATFORMS.map(p => {
            const acct = getAccount(p.id);
            const isConnected = acct && acct.status === 'connected';
            const needsKeys = (p.id === 'ebay' || p.id === 'amazon') && !oauthStatus[p.id];

            return (
              <article key={p.id} className={`mkt-card ${styles.card}`}>
                <div className={styles.cardHead}>
                  <PlatformGlyph id={p.id} />
                  <h2 className={styles.cardName}>{p.name}</h2>
                  <span className={`mkt-pill ${isConnected ? 'mkt-pill--active' : 'mkt-pill--neutral'}`}>
                    <span className="mkt-pill__dot" />
                    {isConnected ? 'Connected' : 'Not connected'}
                  </span>
                </div>

                <p className={styles.cardDesc}>{p.desc}</p>

                {isConnected && (
                  <div className={styles.cardFacts}>
                    <div className="mkt-row">
                      <span className="mkt-row__key">Account</span>
                      <span className="mkt-row__val">
                        {acct.accountId || acct.webhookUrl || 'Connected'}
                      </span>
                    </div>
                    {acct.listingsCount > 0 && (
                      <div className="mkt-row">
                        <span className="mkt-row__key">Live listings</span>
                        <span className="mkt-row__val">{acct.listingsCount}</span>
                      </div>
                    )}
                  </div>
                )}

                {p.id === 'discord' && !isConnected && (
                  <div className="mkt-fieldGroup">
                    <label className="mkt-label" htmlFor="mkt-discord-webhook">
                      Webhook URL
                    </label>
                    <input
                      id="mkt-discord-webhook"
                      className="mkt-field"
                      placeholder="https://discord.com/api/webhooks/…"
                      value={webhookUrl}
                      onChange={(e) => setWebhookUrl(e.target.value)}
                    />
                    <span className="mkt-hint">
                      Channel settings → Integrations → Webhooks → Copy webhook URL.
                    </span>
                  </div>
                )}

                {/* Actions sit at the foot of every card so the row of
                    buttons lines up across cards of different heights. */}
                <div className={styles.cardActions}>
                  {isConnected ? (
                    confirmId === p.id ? (
                      <>
                        <span className={styles.confirmText}>Disconnect {p.name}?</span>
                        <button
                          className="mkt-btn mkt-btn--sm mkt-btn--danger"
                          onClick={() => disconnectPartner(p.id)}
                        >
                          Yes, disconnect
                        </button>
                        <button
                          className="mkt-btn mkt-btn--sm"
                          onClick={() => setConfirmId(null)}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        {p.id === 'discord' && (
                          <button
                            className="mkt-btn mkt-btn--sm"
                            disabled={testing}
                            onClick={testDiscordWebhook}
                          >
                            {testing ? 'Sending…' : 'Send test'}
                          </button>
                        )}
                        <button
                          className="mkt-btn mkt-btn--sm mkt-btn--danger"
                          onClick={() => setConfirmId(p.id)}
                        >
                          Disconnect
                        </button>
                      </>
                    )
                  ) : (
                    <>
                      <button
                        className="mkt-btn mkt-btn--primary mkt-btn--sm"
                        disabled={connecting === p.id || (needsKeys && p.id !== 'discord')}
                        onClick={() => connectPartner(p.id)}
                      >
                        {connecting === p.id
                          ? 'Connecting…'
                          : p.id === 'discord'
                            ? 'Save webhook'
                            : `Connect ${p.name}`}
                      </button>
                      {needsKeys && (
                        <span className={styles.actionNote}>
                          API keys not configured on this server
                        </span>
                      )}
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </MarketplaceShell>
  );
}
