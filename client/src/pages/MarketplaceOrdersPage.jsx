import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import styles from './MarketplaceOrdersPage.module.css';
import { apiUrl, authFetch } from '../utils/api';
import { useAuth } from '../AuthContext.jsx';

const CATEGORY_ICON = {
  cable: '🔌', switch: '🔁', router: '🌐', rack: '🗄️',
  optic: '✨', server: '🖥️', pdu: '⚡', firewall: '🛡️',
  patch_panel: '🧩', other: '📦',
};

const STATUS_LABEL = {
  pending: 'Pending', paid: 'Paid', shipped: 'Shipped',
  completed: 'Completed', cancelled: 'Cancelled',
};
const STATUS_CLASS = {
  pending: 'pending', paid: 'paid', shipped: 'shipped',
  completed: 'completed', cancelled: 'cancelled',
};

function formatCurrency(cents, currency = 'USD') {
  if (cents == null) return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency, maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch { return `${currency} ${(cents / 100).toFixed(2)}`; }
}

function formatRelative(d) {
  if (!d) return '';
  const ms = Date.now() - new Date(d + 'Z').getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const m = Math.floor(ms / 60000);
  if (m < 1)   return 'just now';
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7)  return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

export default function MarketplaceOrdersPage() {
  const navigate = useNavigate();
  const { isAuthed, user } = useAuth();
  const { orderId } = useParams();

  const [role, setRole]         = useState('buying');
  const [orders, setOrders]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [detail, setDetail]     = useState(null); // {order, messages}
  const [msgBody, setMsgBody]   = useState('');
  const [sending, setSending]   = useState(false);
  const [trackCarrier, setTrackCarrier] = useState('');
  const [trackNumber, setTrackNumber]   = useState('');
  const msgsEndRef = useRef(null);

  useEffect(() => {
    if (!isAuthed) {
      navigate('/login', { state: { from: '/marketplace/orders' }, replace: true });
    }
  }, [isAuthed, navigate]);

  const fetchOrders = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res  = await authFetch(apiUrl(`/api/marketplace/orders?role=${role}`));
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setOrders(data.orders || []);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [role]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  // Auto-open order from URL param
  useEffect(() => {
    if (orderId && orders.length > 0) {
      const o = orders.find(x => x.id === Number(orderId));
      if (o) openOrder(o.id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, orders]);

  const openOrder = async (id) => {
    try {
      const res  = await authFetch(apiUrl(`/api/marketplace/orders/${id}`));
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setDetail(data);
      setTrackCarrier(data.order.carrier || '');
      setTrackNumber(data.order.trackingNumber || '');
      setTimeout(() => msgsEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch (err) { alert(err.message); }
  };

  const sendMessage = async () => {
    if (!msgBody.trim() || sending || !detail) return;
    setSending(true);
    try {
      const res = await authFetch(apiUrl(`/api/marketplace/orders/${detail.order.id}/messages`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: msgBody.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setDetail(prev => ({ ...prev, messages: [...prev.messages, data.message] }));
      setMsgBody('');
      setTimeout(() => msgsEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch (err) { alert(err.message); }
    finally { setSending(false); }
  };

  const patchOrder = async (patch) => {
    if (!detail) return;
    try {
      const res = await authFetch(apiUrl(`/api/marketplace/orders/${detail.order.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setDetail(prev => ({ ...prev, order: data.order }));
      fetchOrders();
    } catch (err) { alert(err.message); }
  };

  // Auto-refresh messages every 30s when detail open
  useEffect(() => {
    if (!detail) return;
    const iv = setInterval(() => openOrder(detail.order.id), 30000);
    return () => clearInterval(iv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.order?.id]);

  const isSeller = detail && detail.order.sellerId === user?.id;

  return (
    <div className={`page page-full ${styles.page}`}>
      <header className={styles.header}>
        <button className={styles.backBtn} onClick={() => detail ? setDetail(null) : navigate('/marketplace')} aria-label="Back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <h1 className={styles.title}>{detail ? 'Order Details' : 'My Orders'}</h1>
      </header>

      {!detail && (
        <>
          <div className={styles.toolbar}>
            <div className={styles.tabs}>
              <button className={`${styles.tab} ${role === 'buying' ? styles.tabActive : ''}`}
                      onClick={() => setRole('buying')}>Buying</button>
              <button className={`${styles.tab} ${role === 'selling' ? styles.tabActive : ''}`}
                      onClick={() => setRole('selling')}>Selling</button>
            </div>
          </div>

          <div className={styles.list}>
            {loading && <div className={styles.center}><span className={styles.spinner}/></div>}
            {error && <div className={styles.errBanner}>{error}</div>}
            {!loading && !error && orders.length === 0 && (
              <div className={styles.empty}>
                <p>No {role} orders yet.</p>
                <button className={styles.btnPrimary} onClick={() => navigate('/marketplace')}>
                  Browse Marketplace
                </button>
              </div>
            )}
            {orders.map(o => (
              <button key={o.id} type="button" className={styles.orderCard} onClick={() => openOrder(o.id)}>
                <div className={styles.orderThumb}>
                  {o.listingImageUrl
                    ? <img src={o.listingImageUrl} alt="" />
                    : <span>{CATEGORY_ICON[o.listingCategory] || '📦'}</span>}
                </div>
                <div className={styles.orderInfo}>
                  <h3 className={styles.orderTitle}>{o.listingTitle || 'Listing'}</h3>
                  <p className={styles.orderMeta}>
                    {role === 'buying' ? `Seller: ${o.sellerUsername || 'unknown'}` : `Buyer: ${o.buyerUsername || 'unknown'}`}
                    {' · '}{formatRelative(o.createdAt)}
                  </p>
                  <span className={`${styles.badge} ${styles[STATUS_CLASS[o.status]] || ''}`}>
                    {STATUS_LABEL[o.status] || o.status}
                  </span>
                </div>
                <div className={styles.orderPrice}>{formatCurrency(o.totalCents, o.currency)}</div>
              </button>
            ))}
          </div>
        </>
      )}

      {/* ─── Order detail + messaging ────────────────────────────── */}
      {detail && (
        <div className={styles.detailWrap}>
          {/* Order info */}
          <div className={styles.detailCard}>
            <div className={styles.detailTop}>
              <div className={styles.orderThumb}>
                {detail.order.listingImageUrl
                  ? <img src={detail.order.listingImageUrl} alt="" />
                  : <span>{CATEGORY_ICON[detail.order.listingCategory] || '📦'}</span>}
              </div>
              <div className={styles.orderInfo}>
                <h3 className={styles.orderTitle}>{detail.order.listingTitle || 'Listing'}</h3>
                <p className={styles.orderMeta}>
                  {isSeller
                    ? `Buyer: @${detail.order.buyerUsername || 'unknown'}`
                    : `Seller: @${detail.order.sellerUsername || 'unknown'}`}
                </p>
              </div>
              <div>
                <span className={`${styles.badge} ${styles[STATUS_CLASS[detail.order.status]] || ''}`}>
                  {STATUS_LABEL[detail.order.status] || detail.order.status}
                </span>
              </div>
            </div>

            <div className={styles.detailRow}>
              <span>Qty: {detail.order.quantity}</span>
              <span>{formatCurrency(detail.order.totalCents, detail.order.currency)}</span>
            </div>

            {detail.order.trackingNumber && (
              <div className={styles.trackingBox}>
                <span className={styles.trackingLabel}>Tracking:</span>
                <span>{detail.order.carrier && `${detail.order.carrier} — `}{detail.order.trackingNumber}</span>
              </div>
            )}

            {/* Seller actions */}
            {isSeller && detail.order.status === 'paid' && (
              <div className={styles.shipSection}>
                <h4 className={styles.sectionLabel}>Ship this order</h4>
                <div className={styles.row2}>
                  <input className={styles.input} placeholder="Carrier (UPS, USPS…)"
                         value={trackCarrier} onChange={(e) => setTrackCarrier(e.target.value)} />
                  <input className={styles.input} placeholder="Tracking number"
                         value={trackNumber} onChange={(e) => setTrackNumber(e.target.value)} />
                </div>
                <button className={styles.btnPrimary}
                        onClick={() => patchOrder({
                          status: 'shipped',
                          carrier: trackCarrier,
                          trackingNumber: trackNumber,
                        })}>
                  Mark Shipped
                </button>
              </div>
            )}

            {/* Complete / cancel */}
            <div className={styles.actionRow}>
              {detail.order.status === 'shipped' && (
                <button className={styles.btnSecondary}
                        onClick={() => { if (confirm('Mark this order as completed?')) patchOrder({ status: 'completed' }); }}>
                  Mark Completed
                </button>
              )}
              {['pending', 'paid'].includes(detail.order.status) && (
                <button className={styles.btnDanger}
                        onClick={() => { if (confirm('Cancel this order?')) patchOrder({ status: 'cancelled' }); }}>
                  Cancel Order
                </button>
              )}
            </div>
          </div>

          {/* Messages */}
          <div className={styles.msgsSection}>
            <h4 className={styles.sectionLabel}>Messages</h4>
            <div className={styles.msgsBox}>
              {detail.messages.length === 0 && (
                <p className={styles.msgsEmpty}>No messages yet. Start the conversation below.</p>
              )}
              {detail.messages.map(m => (
                <div key={m.id} className={`${styles.msg} ${m.senderId === user?.id ? styles.msgMe : styles.msgThem}`}>
                  <span className={styles.msgSender}>@{m.senderUsername}</span>
                  <p className={styles.msgBody}>{m.body}</p>
                  <span className={styles.msgTime}>{formatRelative(m.createdAt)}</span>
                </div>
              ))}
              <div ref={msgsEndRef} />
            </div>
            <div className={styles.msgInput}>
              <input className={styles.input} placeholder="Type a message…"
                     value={msgBody}
                     onChange={(e) => setMsgBody(e.target.value)}
                     onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }}} />
              <button className={styles.sendBtn} disabled={sending || !msgBody.trim()} onClick={sendMessage}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
