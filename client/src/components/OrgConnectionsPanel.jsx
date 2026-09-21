import { useEffect, useId, useState, useCallback } from 'react';
import {
  listOrgConnections, createOrgConnection, deleteOrgConnection, TYPE_INFO,
} from '../utils/connectionsApi';

// Admin-only panel to configure the ORGANIZATION's external access (CMDB/ITSM
// databases, live network sources, etc.). The admin enters credentials ONCE for
// the whole org; the server stores them AES-256-GCM encrypted and NEVER returns
// the plaintext - not even here. So the list shows only which integrations are
// configured, never the secret. Editing = re-entering to replace.

const TYPE_KEYS = Object.keys(TYPE_INFO);

function emptySecretFor(type) {
  const out = {};
  for (const f of (TYPE_INFO[type]?.fields || [])) out[f.key] = '';
  return out;
}

export default function OrgConnectionsPanel() {
  // The credential fields are driven by TYPE_INFO, so the label/field pairing
  // has to be generated too - a shared prefix keeps the ids unique per mount.
  const uid = useId();
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [type, setType]         = useState(TYPE_KEYS[0]);
  const [name, setName]         = useState('');
  const [secret, setSecret]     = useState(emptySecretFor(TYPE_KEYS[0]));
  const [saving, setSaving]     = useState(false);
  const [formError, setFormError] = useState(null);

  const load = useCallback(async () => {
    try { const { profiles } = await listOrgConnections(); setProfiles(profiles); setError(null); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => { setSecret(emptySecretFor(type)); }, [type]);

  const info = TYPE_INFO[type] || { fields: [] };

  const onSave = async (e) => {
    e.preventDefault();
    setFormError(null);
    const missing = (info.fields || []).filter(f => f.required && !String(secret[f.key] || '').trim());
    if (missing.length) { setFormError(`Fill in: ${missing.map(f => f.label).join(', ')}`); return; }
    setSaving(true);
    try {
      await createOrgConnection({ name: name.trim() || info.label, type, secret });
      setFormOpen(false); setName(''); setSecret(emptySecretFor(type));
      await load();
    } catch (e2) { setFormError(e2.message); }
    finally { setSaving(false); }
  };

  const onRemove = async (p) => {
    if (!window.confirm(`Remove the ${TYPE_INFO[p.type]?.label || p.type} integration for this organization?`)) return;
    try { await deleteOrgConnection(p.id); await load(); } catch (e) { setError(e.message); }
  };

  const card = { border: '1px solid #ececec', borderRadius: 14, background: '#fff', padding: 16 };
  const btn = { fontSize: 'var(--fs-body)', fontWeight: 'var(--fw-label)', padding: '9px 14px', borderRadius: 10, cursor: 'pointer' };
  const primaryBtn = { ...btn, background: '#000000', color: '#fff', border: '1px solid #000000' };
  const ghostBtn = { ...btn, background: '#fff', color: '#333', border: '1px solid #ececec' };
  const dangerBtn = { ...btn, background: '#fff', color: '#dc2626', border: '1px solid rgba(220,38,38,0.35)', padding: '7px 12px', fontSize: 'var(--fs-sub)' };
  const label = { display: 'block', fontSize: 'var(--fs-label)', fontWeight: 'var(--fw-title)', letterSpacing: '0.06em', textTransform: 'uppercase', color: '#6b6b6b', marginBottom: 6 };
  // fontSize 16 (not smaller): iOS Safari auto-zooms the viewport when a
  // focused input is under 16px and never restores the scale on blur.
  const input = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, border: '1px solid #e2e2e2', fontSize: 'var(--fs-section)', marginBottom: 12 };

  return (
    <section style={{ marginTop: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontSize: 'var(--fs-section)', fontWeight: 'var(--fw-title)', color: '#1c1c1c' }}>Organization integrations</h3>
        {!formOpen && (
          <button type="button" style={primaryBtn} onClick={() => { setFormError(null); setFormOpen(true); }}>
            + Add integration
          </button>
        )}
      </div>
      <p style={{ margin: '0 0 14px', fontSize: 'var(--fs-body)', color: '#6b6b6b', lineHeight: 1.5, maxWidth: 640 }}>
        Set your organization's credentials once. They are stored <strong>encrypted</strong> and{' '}
        <strong>never shown again</strong>. To change one, enter it again.
      </p>

      {error && <div style={{ ...card, borderColor: 'rgba(220,38,38,0.35)', color: '#dc2626', marginBottom: 12 }}>{error}</div>}

      {formOpen && (
        <form onSubmit={onSave} style={{ ...card, marginBottom: 14 }}>
          <label style={label} htmlFor={`${uid}-type`}>Integration type</label>
          <select id={`${uid}-type`} style={input} value={type} onChange={e => setType(e.target.value)}>
            {TYPE_KEYS.map(t => <option key={t} value={t}>{TYPE_INFO[t].label}</option>)}
          </select>

          <label style={label} htmlFor={`${uid}-name`}>Label (optional)</label>
          <input id={`${uid}-name`} style={input} value={name} placeholder={info.label}
            onChange={e => setName(e.target.value)} />

          {(info.fields || []).map(f => (
            <div key={f.key}>
              <label style={label} htmlFor={`${uid}-${f.key}`}>{f.label}{f.required ? ' *' : ''}</label>
              <input id={`${uid}-${f.key}`} style={input}
                type={f.type === 'password' ? 'password' : 'text'}
                autoComplete="new-password"
                placeholder={f.placeholder || ''}
                value={secret[f.key] || ''}
                onChange={e => setSecret(s => ({ ...s, [f.key]: e.target.value }))} />
            </div>
          ))}
          {info.hint && <p style={{ margin: '0 0 12px', fontSize: 'var(--fs-sub)', color: '#6b6b6b' }}>{info.hint}</p>}
          {formError && <div style={{ color: '#dc2626', fontSize: 'var(--fs-body)', marginBottom: 12 }}>{formError}</div>}

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" style={ghostBtn} onClick={() => setFormOpen(false)} disabled={saving}>Cancel</button>
            {/* "(encrypted)" on the button and "· encrypted" on every saved row both
                repeated the paragraph above, which is where that promise belongs. */}
            <button type="submit" style={primaryBtn} disabled={saving}>{saving ? 'Saving' : 'Save'}</button>
          </div>
        </form>
      )}

      {loading ? (
        <div style={{ ...card, color: '#6b6b6b' }}>Loading…</div>
      ) : profiles.length === 0 ? (
        <div style={{ ...card, color: '#6b6b6b', textAlign: 'center' }}>No integrations configured yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {profiles.map(p => (
            <div key={p.id} style={{ ...card, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px' }}>
              <div>
                <div style={{ fontWeight: 'var(--fw-title)', color: '#1c1c1c', fontSize: 'var(--fs-item)' }}>
                  {p.name} <span style={{ fontSize: 'var(--fs-sub)', fontWeight: 'var(--fw-label)', color: '#6b6b6b' }}>· {TYPE_INFO[p.type]?.label || p.type}</span>
                </div>
                <div style={{ fontSize: 'var(--fs-sub)', color: '#16a34a', fontWeight: 'var(--fw-label)', marginTop: 2 }}>● Configured</div>
              </div>
              <button type="button" style={dangerBtn} onClick={() => onRemove(p)}>Remove</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
