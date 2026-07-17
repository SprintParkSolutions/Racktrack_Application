import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './MarketplacePartnerAccountsPage.module.css';
import { apiUrl, authFetch } from '../utils/api';
import { useAuth } from '../AuthContext.jsx';

const PLATFORMS = [
  {
    id: 'ebay', name: 'eBay', icon: '🛍️',
    desc: 'Cross-post listings to eBay. Connect your existing seller account via OAuth.',
    bg: '#FFF0E0',
  },
  {
    id: 'amazon', name: 'Amazon', icon: '📦',
    desc: 'Publish listings to Amazon Marketplace. One-time seller account setup.',
    bg: '#FFF8E0',
  },
  {
    id: 'discord', name: 'Discord', icon: '💬',
    desc: 'Push new listing announcements to a Discord channel via webhook.',
    bg: '#EEF0FF',
  },
];

export default function MarketplacePartnerAccountsPage() {
  const navigate = useNavigate();
  const { isAuthed } = useAuth();
  const [accounts, setAccounts]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [connecting, setConnecting] = useState(null);
  const [testing, setTesting]     = useState(false);
  const [oauthStatus, setOauthStatus] = useState({ ebay: false, amazon: false });

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
    // For eBay/Amazon with OAuth configured, redirect to auth URL
    if ((platform === 'ebay' || platform === 'amazon') && oauthStatus[platform]) {
      setConnecting(platform);
      try {
        const res = await authFetch(apiUrl(`/api/marketplace/partner-accounts/${platform}/auth-url`));
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
        window.location.href = data.authUrl;
        return;
      } catch (err) { alert(err.message); setConnecting(null); return; }
    }
    setConnecting(platform);
    try {
      const body = { platform };
      if (platform === 'discord') {
        if (!webhookUrl.trim()) { alert('Paste your Discord webhook URL first.'); return; }
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
    } catch (err) { alert(err.message); }
    finally { setConnecting(null); }
  };

  const testDiscordWebhook = async () => {
    setTesting(true);
    try {
      const res = await authFetch(apiUrl('/api/marketplace/partner-accounts/discord/test'), {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      alert('Test notification sent to Discord!');
    } catch (err) { alert(`Test failed: ${err.message}`); }
    finally { setTesting(false); }
  };

  const disconnectPartner = async (platform) => {
    if (!confirm(`Disconnect ${platform}? Your listings on that platform won't be affected.`)) return;
    try {
      await authFetch(apiUrl(`/api/marketplace/partner-accounts/${platform}`), { method: 'DELETE' });
      setAccounts(prev => prev.map(a => a.platform === platform ? { ...a, status: 'disconnected' } : a));
    } catch (err) { alert(err.message); }
  };

  return (
    <div className={`page page-full ${styles.page}`}>
      <header className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate('/marketplace')} aria-label="Back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <h1 className={styles.title}>Partner Accounts</h1>
      </header>

      <p className={styles.intro}>
        Connect your seller accounts on other platforms to cross-post
        RackTrack listings or push announcements to Discord.
      </p>

      {loading && <div className={styles.center}><span className={styles.spinner}/></div>}

      {!loading && (
        <div className={styles.list}>
          {PLATFORMS.map(p => {
            const acct = getAccount(p.id);
            const isConnected = acct && acct.status === 'connected';

            return (
              <div key={p.id} className={styles.card}>
                <div className={styles.cardTop}>
                  <div className={styles.iconWrap} style={{ background: p.bg }}>
                    <span className={styles.icon}>{p.icon}</span>
                  </div>
                  <div className={styles.cardInfo}>
                    <h3 className={styles.cardName}>{p.name}</h3>
                    <p className={styles.cardId}>
                      {isConnected
                        ? (acct.accountId || acct.webhookUrl || 'Connected')
                        : 'Not connected'}
                    </p>
                  </div>
                  <span className={`${styles.statusBadge} ${isConnected ? styles.connected : styles.disconnected}`}>
                    {isConnected ? 'Connected' : 'Disconnected'}
                  </span>
                </div>

                <p className={styles.cardDesc}>{p.desc}</p>

                {isConnected && acct.listingsCount > 0 && (
                  <p className={styles.cardMeta}>
                    {acct.listingsCount} listing{acct.listingsCount !== 1 && 's'} live on {p.name}
                  </p>
                )}

                {/* Discord webhook input */}
                {p.id === 'discord' && !isConnected && (
                  <input
                    className={styles.input}
                    placeholder="Paste Discord webhook URL"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                  />
                )}

                <div className={styles.cardActions}>
                  {isConnected ? (
                    <>
                      {p.id === 'discord' && (
                        <button className={styles.btnSecondary} disabled={testing}
                                onClick={testDiscordWebhook}>
                          {testing ? 'Sending…' : 'Test Webhook'}
                        </button>
                      )}
                      <button className={styles.btnDanger} onClick={() => disconnectPartner(p.id)}>
                        Disconnect
                      </button>
                    </>
                  ) : (
                    <>
                      <button className={styles.btnPrimary}
                              disabled={connecting === p.id || ((p.id === 'ebay' || p.id === 'amazon') && !oauthStatus[p.id] && p.id !== 'discord')}
                              onClick={() => connectPartner(p.id)}>
                        {connecting === p.id
                          ? 'Connecting…'
                          : p.id === 'discord'
                            ? 'Save Webhook'
                            : oauthStatus[p.id]
                              ? `Connect ${p.name}`
                              : `Connect ${p.name}`}
                      </button>
                      {(p.id === 'ebay' || p.id === 'amazon') && !oauthStatus[p.id] && (
                        <span className={styles.oauthNote}>API keys not configured on server</span>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
