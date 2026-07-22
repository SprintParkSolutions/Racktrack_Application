import { useEffect, useState, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useSmartBack } from '../hooks/useSmartBack';
import styles from './SpecificationsPage.module.css';
import ThemeToggle from '../components/ThemeToggle.jsx';
import { apiUrl, authFetch } from '../utils/api';
import { useTheme } from '../ThemeContext.jsx';
import { getCached, setCached, cacheKey } from '../utils/scanPrefetch';
import SfpAdvisor from '../components/SfpAdvisor.jsx';
import { findVendorLogin } from '../utils/vendorLoginUrls';
import { getItem, setItem, removeItem } from '../utils/safeStorage';

// CMDB-driven switch info. Reads the list of switches stored in CMDB for
// this rack, and on demand fetches vendor specs + firmware-update info per
// device. Distinct from the live SSH "Switch Info" modal in port mode —
// that one talks directly to the device; this one trusts what's in CMDB.

// Map common CMDB manufacturer strings to the display name in the
// vendor-spec Excel sheet so /api/specs matches.
function vendorFromCmdb(manufacturer, model) {
  const m = (manufacturer || '').toLowerCase();
  if (m.includes('cisco'))   return 'Cisco';
  if (m.includes('tp-link') || m.includes('tplink')) return 'TP-Link';
  if (m.includes('d-link')   || m.includes('dlink')) return 'D-Link';
  if (m.includes('juniper')) return 'Juniper';
  if (m.includes('aruba'))   return 'Aruba';
  if (m.includes('arista'))  return 'Arista';
  if (m.includes('huawei'))  return 'Huawei';
  if (m.includes('dell'))    return 'Dell';
  if (m.includes('hpe') || m.includes('hewlett')) return 'HPE';
  // Last-ditch: guess from the model number prefix.
  const mod = (model || '').toUpperCase();
  if (mod.startsWith('C9') || mod.startsWith('WS-C')) return 'Cisco';
  if (mod.startsWith('TL-'))                          return 'TP-Link';
  if (mod.startsWith('DGS-') || mod.startsWith('DXS-')) return 'D-Link';
  return manufacturer || '';
}

// Client-side fallback: extract model number from raw OCR text when the
// pipeline returned make but missed the model (e.g. underscore/hyphen misread).
function extractModelFromRaw(rawText, make) {
  if (!rawText) return '';
  // Normalize underscores → hyphens (same logic as pipeline fix)
  const norm = rawText.replace(/[_][-]|[-][_]/g, '-').replace(/(?<=[A-Za-z0-9])_(?=[A-Za-z0-9])/g, '-');
  const patterns = [
    /\b(?:WS-C|C)\d{4,5}[A-Z]*-\d{1,3}[A-Z]{0,4}(?:-\w{1,4})?\b/,  // Cisco
    /\bTL-[A-Z]{2,4}\d{3,5}[A-Z]{0,4}\b/,                            // TP-Link
    /\bT[1-9]\d{2,3}[A-Z]{0,4}\b/,                                    // TP-Link JetStream
    /\bD[GX]S-\d{3,4}[A-Z]?-\d{1,3}[A-Z]{0,4}\b/,                   // D-Link
    /\b(?:EX|QFX|MX|SRX)\d{3,5}[A-Z0-9-]*\b/,                       // Juniper
    /\bCX\s?\d{4}[A-Z]?\b/,                                           // Aruba
    /\b(?:DCS-)?7\d{3}[A-Z]?-\d{1,3}[A-Z0-9-]*\b/,                  // Arista
    /\b(?:CRS|CCR)\d{3,4}(?:-[\w+]{1,12})*\b/i,                      // Mikrotik
  ];
  for (const rx of patterns) {
    const m = norm.match(rx);
    if (m) return m[0].toUpperCase();
  }
  // Fuzzy fallback for Mikrotik: OCR often garbles CRS→CAS/CR5/@R5 etc.
  // Look for patterns like *RS3xx or *RS1xx followed by dash-separated suffixes
  if (make && make.toLowerCase().includes('mikro')) {
    const fuzzy = norm.match(/[A-Z@][A-Z]*[RS]\d{3,4}(?:-[\w+]{1,12})*/i);
    if (fuzzy) {
      // Try to reconstruct: assume CRS or CCR prefix
      const raw = fuzzy[0];
      const digits = raw.match(/\d{3,4}(?:-[\w+]{1,12})*/);
      if (digits) {
        const prefix = raw.toLowerCase().includes('ccr') ? 'CCR' : 'CRS';
        return prefix + digits[0].toUpperCase();
      }
    }
  }
  return '';
}

// Expand known partial OCR model fragments to full model numbers.
// Mirrors the _FUZZY_MODEL_DB in pipeline/all_vendor.py.
const PARTIAL_MODEL_MAP = [
  // MikroTik
  [/^CRS3265?$/i,   'CRS326-24G-2S+RM'],
  [/^CRS3261?$/i,   'CRS326-24G-2S+RM'],
  [/^CRS3541?/i,    'CRS354-48G-4S+2Q+RM'],
  [/^CRS3121?/i,    'CRS312-4C+8XG-RM'],
  [/^CRS3171?/i,    'CRS317-1G-16S+RM'],
  [/^CRS3051?/i,    'CRS305-1G-4S+IN'],
  [/^CRS3281?/i,    'CRS328-24P-4S+RM'],
  [/^CRS5181?/i,    'CRS518-16XS-2XQ-RM'],
  [/^CCR20041?/i,   'CCR2004-1G-12S+2XS'],
  [/^CCR20161?/i,   'CCR2016-1G-12S+2XS'],
  // Cisco
  [/^C93001?$/i,    'C9300-24T'],
  [/^C93004?$/i,    'C9300-48T'],
  [/^C93002?$/i,    'C9300-24P'],
  [/^C93006?$/i,    'C9300-48P'],
  // TP-Link
  [/^TLSG24281?/i,  'TL-SG2428P'],
];

function expandPartialModel(model) {
  if (!model) return model;
  // Only try to expand if it looks partial: no hyphens and short, or ends with 1-2 digits
  const looksPartial = (!model.includes('-') && !model.includes('+') && model.length < 12)
    || /[A-Z]\d{1,2}$/i.test(model);
  if (!looksPartial) return model;
  for (const [rx, full] of PARTIAL_MODEL_MAP) {
    if (rx.test(model)) return full;
  }
  return model;
}

function cleanModel(m) {
  if (!m) return '';
  return String(m).trim().replace(/\s+v?\d+(?:\.\d+){0,2}\s*$/i, '').trim();
}

// Pull a clean dotted version out of messy firmware strings.
function cleanVersion(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  const nx = s.match(/\b\d+\.\d+\([^)]+\)(?:[A-Z]\d+(?:\([^)]+\))?)?/);
  if (nx) return nx[0];
  const dotted = s.match(/\b\d+\.\d+(?:\.\d+){0,3}(?:[A-Za-z][A-Za-z0-9]{0,5})?(?:-[A-Za-z0-9]{1,8})?\b/);
  return dotted ? dotted[0] : s;
}

// Spot raw Python tracebacks / JSONDecodeError text leaking from the
// backend so we can hide them behind a friendly empty state rather than
// dumping them in the UI. The user shouldn't have to read "Expecting
// value: line 1 column 1 (char 0)" — that's a backend signal, not a
// user-actionable message.
function looksLikeBackendNoise(msg) {
  if (!msg || typeof msg !== 'string') return false;
  const m = msg.toLowerCase();
  return (
    m.includes('expecting value') ||
    m.includes('traceback') ||
    m.includes('jsondecode') ||
    m.includes('line 1 column') ||
    m.startsWith('http ') ||
    m.includes('econnrefused') ||
    m.includes('etimedout') ||
    // Catch anything that looks like a Python module / dotted path or
    // a stray "X timed out" message — those are developer-facing
    // strings that occasionally slip through the server's friendly
    // wrapper and shouldn't reach end users.
    m.includes('pipeline.') ||
    m.includes('timed out') ||
    m.includes('spawn ') ||
    m.includes('python exited') ||
    m.includes('exit code')
  );
}

function SourceBadge({ sw }) {
  const source = sw.discovery_source || '';
  const conf = sw.ocr_conf != null ? Math.round(sw.ocr_conf * 100) : null;

  let label, bg, color;
  if (sw._fromOcr) {
    // From the rack photo — confidence shown when available.
    label = conf != null ? `Photo ${conf}%` : 'From photo';
    bg = '#ffffff';
    color = '#717171';
  } else if (source.startsWith('ocr')) {
    label = conf != null ? `Photo ${conf}%` : 'From photo';
    bg = '#ffffff';
    color = '#717171';
  } else if (source === 'override') {
    label = 'Manual';
    bg = '#ffffff';
    color = '#717171';
  } else if (source === 'synth') {
    label = 'Synth';
    bg = '#ffffff';
    color = '#717171';
  } else {
    label = 'CMDB';
    bg = '#ffffff';
    color = '#717171';
  }

  return (
    <span style={{
      fontSize: '.6rem', fontWeight: 600, textTransform: 'uppercase',
      letterSpacing: '.04em', padding: '2px 6px', borderRadius: 4,
      background: bg, color, border: '1px solid #ececec',
    }}>
      {label}
    </span>
  );
}

// Stable per-switch identifier for localStorage keys. Uses serial > mac >
// position as the primary key — deliberately NOT manufacturer/model
// because those are exactly the fields the user can override, and the
// key needs to be stable across edits so a saved override survives a
// re-scan that returns different OCR text.
function switchStableId(sw) {
  if (sw.serial_number) return `s:${sw.serial_number}`;
  if (sw.mac_address)   return `m:${sw.mac_address}`;
  if (sw.position)      return `p:${sw.position}`;
  // Last-ditch fallback — at least pin to the original (CV-derived) name
  // so multiple unidentified devices at the same scan don't collide.
  return `n:${sw.name || 'unknown'}`;
}

function userOverrideKey(rackId, sw, field) {
  return `racktrack:${field}:${rackId || '_'}::${switchStableId(sw)}`;
}
function loadOverride(rackId, sw, field) {
  try { return getItem(userOverrideKey(rackId, sw, field)) || ''; }
  catch { return ''; }
}
function saveOverride(rackId, sw, field, value) {
  try {
    const k = userOverrideKey(rackId, sw, field);
    if (value) setItem(k, value);
    else removeItem(k);
  } catch (_) {}
}

// Backwards-compat helpers for the existing firmware-version override.
function loadUserVersion(rackId, sw)        { return loadOverride(rackId, sw, 'fwVersion'); }
function saveUserVersion(rackId, sw, value) { saveOverride(rackId, sw, 'fwVersion', value); }

function SwitchCard({ sw, rackId, defaultExpanded = false, hideHeader = false }) {
  const { theme } = useTheme();
  const lt = theme === 'light';

  const [expanded, setExpanded] = useState(defaultExpanded);
  const [specs, setSpecs] = useState(null);
  const [specsStatus, setSpecsStatus] = useState('idle');
  const [firmware, setFirmware] = useState(null);
  const [firmwareStatus, setFirmwareStatus] = useState('idle');
  // In-card tab strip — Specifications first (the vendor spec sheet),
  // then Firmware (version check), then the SFP Advisor (which optics
  // fit this chassis). Order chosen by the user.
  const [swTab, setSwTab] = useState('hardware');

  // User-supplied overrides — used when OCR / CMDB didn't capture the
  // value. Persisted per switch (keyed by serial > mac > position) so
  // they survive reloads and aren't disturbed by a re-scan that returns
  // different OCR text. Empty string means "not set".
  const [userMake, setUserMake]       = useState(() => loadOverride(rackId, sw, 'make'));
  const [userModel, setUserModel]     = useState(() => loadOverride(rackId, sw, 'model'));
  const [userVersion, setUserVersion] = useState(() => loadUserVersion(rackId, sw));
  const [editingIdent, setEditingIdent] = useState(false);
  const [identDraftMake,  setIdentDraftMake]  = useState('');
  const [identDraftModel, setIdentDraftModel] = useState('');
  const [editingVersion, setEditingVersion] = useState(false);
  const [versionDraft, setVersionDraft] = useState('');

  // Effective values: user override wins over OCR/CMDB. This means a user
  // who corrects OCR garbage gets the corrected value flowing into the
  // specs / firmware lookups below.
  const effectiveMake  = sw.manufacturer || userMake;
  const effectiveModel = sw.model_number || userModel;
  const makeIsUserSupplied  = !sw.manufacturer && !!userMake;
  const modelIsUserSupplied = !sw.model_number && !!userModel;

  const displayVendor = vendorFromCmdb(effectiveMake, effectiveModel);
  const lookupModel = cleanModel(effectiveModel);
  const effectiveVersionRaw = sw.os_version || userVersion;
  const lookupVersion = cleanVersion(effectiveVersionRaw);
  const versionIsUserSupplied = !sw.os_version && !!userVersion;

  // OCR/CMDB returned nothing for either field — surface the editor as
  // the primary call-to-action instead of a tiny "edit" affordance.
  const identMissing = !effectiveMake && !effectiveModel;
  // OCR got vendor but missed model (the common case after fuzzy-match
  // recovery) or vice-versa. Still surface the editor, just less
  // prominently — the user requested manual entry whenever the pipeline
  // failed on *either* field, not just both.
  const identIncomplete = !identMissing && (!effectiveMake || !effectiveModel);

  const loadDetails = async (overrideVersion) => {
    if (!displayVendor || !lookupModel) {
      setSpecsStatus('skipped');
      setFirmwareStatus('skipped');
      return;
    }
    const versionForLookup = overrideVersion != null
      ? cleanVersion(overrideVersion)
      : lookupVersion;

    // Check the prefetch cache first — if scanPrefetch already populated
    // this (vendor, model) pair, render synchronously and skip the network.
    const specsCached = rackId ? getCached(cacheKey.specs(rackId, displayVendor, lookupModel)) : null;
    if (specsCached) {
      setSpecs(specsCached);
      setSpecsStatus(specsCached.ok ? 'ready' : 'error');
    } else {
      setSpecsStatus(prev => prev === 'ready' ? prev : 'loading');
    }

    const firmwareCached = (rackId && versionForLookup)
      ? getCached(cacheKey.firmware(rackId, displayVendor, lookupModel, versionForLookup))
      : null;
    if (firmwareCached) {
      if (firmwareCached.ok) { setFirmware(firmwareCached); setFirmwareStatus('ready'); }
      else { setFirmwareStatus('error'); }
    } else {
      setFirmwareStatus(versionForLookup ? 'loading' : 'skipped');
    }

    // Only OCR-derived data needs the server's OCR-correction probe. A
    // manual model edit (modelIsUserSupplied) means the user has
    // confirmed the model, so we tell the server to skip the probe and
    // save a Python spawn.
    const fromOcr = !!sw._fromOcr && !modelIsUserSupplied;

    if (!specsCached && specsStatus !== 'ready') {
      authFetch(apiUrl('/api/specs'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendor: displayVendor, model: lookupModel, fromOcr }),
      }).then(async r => {
        const text = await r.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch {}
        if (data && data.ok) {
          setSpecs(data); setSpecsStatus('ready');
          if (rackId) setCached(cacheKey.specs(rackId, displayVendor, lookupModel), data);
        } else {
          setSpecs(data); setSpecsStatus('error');
        }
      }).catch(() => setSpecsStatus('error'));
    }

    if (!firmwareCached && versionForLookup) {
      authFetch(apiUrl('/api/firmware'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendor: displayVendor, model: lookupModel, currentVersion: versionForLookup, fromOcr }),
      }).then(async r => {
        const text = await r.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch {}
        if (data && data.ok) {
          setFirmware(data); setFirmwareStatus('ready');
          if (rackId) setCached(cacheKey.firmware(rackId, displayVendor, lookupModel, versionForLookup), data);
        } else {
          setFirmwareStatus('error');
        }
      }).catch(() => setFirmwareStatus('error'));
    }
  };

  // Auto-fire details on mount (rather than waiting for expand) — the
  // prefetcher has already done the network work, so this just wires the
  // cached payload into the card's render state. If the cache misses,
  // it falls back to the same on-mount fetch a one-time visit would do.
  useEffect(() => {
    if (displayVendor && lookupModel && specsStatus === 'idle') {
      loadDetails();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayVendor, lookupModel]);

  const onToggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && specsStatus === 'idle' && firmwareStatus === 'idle') loadDetails();
  };

  const startEditVersion = () => {
    setVersionDraft(userVersion || '');
    setEditingVersion(true);
  };
  const cancelEditVersion = () => {
    setEditingVersion(false);
    setVersionDraft('');
  };
  const saveVersion = () => {
    const v = versionDraft.trim();
    setUserVersion(v);
    saveUserVersion(rackId, sw, v);
    setEditingVersion(false);
    setVersionDraft('');
    setFirmware(null);
    setFirmwareStatus(v ? 'loading' : 'skipped');
    if (v) loadDetails(v);
  };
  const clearVersion = () => {
    setUserVersion('');
    saveUserVersion(rackId, sw, '');
    setEditingVersion(false);
    setVersionDraft('');
    setFirmware(null);
    setFirmwareStatus('skipped');
  };

  // Make/model editor — used when OCR couldn't pin down vendor or model.
  // Saving triggers a fresh specs/firmware lookup against the new values.
  const startEditIdent = () => {
    setIdentDraftMake(userMake || sw.manufacturer || '');
    setIdentDraftModel(userModel || sw.model_number || '');
    setEditingIdent(true);
  };
  const cancelEditIdent = () => {
    setEditingIdent(false);
    setIdentDraftMake('');
    setIdentDraftModel('');
  };
  const saveIdent = () => {
    const newMake  = identDraftMake.trim();
    const newModel = identDraftModel.trim();
    setUserMake(newMake);
    setUserModel(newModel);
    saveOverride(rackId, sw, 'make',  newMake);
    saveOverride(rackId, sw, 'model', newModel);
    setEditingIdent(false);
    setIdentDraftMake('');
    setIdentDraftModel('');
    // New values invalidate any cached spec/firmware results — re-fetch.
    setSpecs(null);
    setSpecsStatus('idle');
    setFirmware(null);
    setFirmwareStatus('idle');
    if (newMake && newModel && expanded) {
      // Trigger fresh lookup with the new values; loadDetails reads
      // displayVendor/lookupModel from state which won't have updated
      // yet, so pass the values explicitly via a microtask.
      setTimeout(() => loadDetails(), 0);
    }
  };
  const clearIdent = () => {
    setUserMake('');
    setUserModel('');
    saveOverride(rackId, sw, 'make',  '');
    saveOverride(rackId, sw, 'model', '');
    setEditingIdent(false);
    setIdentDraftMake('');
    setIdentDraftModel('');
    setSpecs(null);
    setSpecsStatus('idle');
    setFirmware(null);
    setFirmwareStatus('idle');
  };

  const fwTone =
    firmware?.upToDate === true ? 'ok'
    : firmware?.upToDate === false ? 'warn'
    : 'neutral';
  // Headline. When the vendor scrape couldn't confirm the latest version
  // (upToDate === null), the agent often still surfaces a recommended min
  // version or a portal pointer — use those instead of dead-ending with
  // "couldn't reach vendor right now".
  let fwHeadline;
  if (firmware?.upToDate === true) {
    fwHeadline = 'Up to date';
  } else if (firmware?.upToDate === false) {
    fwHeadline = 'Upgrade available';
  } else if (firmware?.recommendedMinVersion) {
    fwHeadline = `Recommended min: ${firmware.recommendedMinVersion}`;
  } else if (firmware?.releaseNotesGated || firmware?.portalUrl) {
    fwHeadline = 'Check vendor portal';
  } else if (firmware?.releaseNotesUrl) {
    fwHeadline = "Couldn't read latest — check vendor";
  } else {
    fwHeadline = 'Latest version unknown';
  }
  const fwColor =
    fwTone === 'ok' ? '#1a1c1d' : fwTone === 'critical' ? '#1a1c1d'
    : fwTone === 'warn' ? '#4c4546' : lt ? '#4c4546' : 'rgba(0,0,0,0.7)';

  // Accent: indigo (light) / cyan (dark) for CMDB; amber for OCR
  const accent      = sw._fromOcr ? '#4c4546' : lt ? '#000000' : '#000000';
  const accentDim   = sw._fromOcr ? (lt ? 'rgba(0,0,0,0.10)'  : 'rgba(0,0,0,0.15)')
                                  : (lt ? 'rgba(0,0,0,0.10)' : 'rgba(0,0,0,0.12)');
  const accentBorder= sw._fromOcr ? (lt ? 'rgba(0,0,0,0.35)'  : 'rgba(0,0,0,0.35)')
                                  : (lt ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.25)');

  // Theme tokens
  const cardBg      = lt ? '#ffffff'                         : 'rgba(0,0,0,0.95)';
  const cardBorder  = lt ? '#cfc4c5'                         : 'rgba(255,255,255,0.08)';
  const titleColor  = lt ? '#1a1c1d'                         : '#e9e9e9';
  const subColor    = lt ? '#4c4546'                         : 'rgba(0,0,0,0.8)';
  const divider     = lt ? '#cfc4c5'                         : 'rgba(255,255,255,0.06)';
  const fieldBg     = lt ? '#ffffff'                         : 'rgba(255,255,255,0.03)';
  const fieldBorder = lt ? '#cfc4c5'                         : 'rgba(255,255,255,0.07)';
  const valueColor  = lt ? '#1a1c1d'                         : '#e9e9e9';
  const chevronColor= lt ? '#4c4546'                         : 'rgba(0,0,0,0.6)';
  const statusColor = lt ? '#4c4546'                         : 'rgba(0,0,0,0.7)';
  const linkColor   = lt ? '#000000'                         : '#000000';

  const displayVersion = sw.os_version || userVersion;
  const hasDetails = effectiveMake || effectiveModel || displayVersion || sw.serial_number || sw.ip_address || sw.mac_address;

  return (
    <article style={{
      borderRadius: 14,
      background: cardBg,
      border: `1px solid ${cardBorder}`,
      borderTop: `2px solid ${accent}`,
      marginBottom: 12,
      overflow: 'hidden',
      boxShadow: lt
        ? '0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.04)'
        : '0 4px 24px rgba(0,0,0,0.35)',
    }}>

      {/* ── Header ── */}
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        style={{
          display: 'flex', width: '100%', alignItems: 'center', gap: 12,
          background: 'transparent', border: 0, color: 'inherit', textAlign: 'left',
          cursor: 'pointer', padding: '14px 16px',
        }}
      >
        <div style={{
          width: 36, height: 36, borderRadius: 10, flexShrink: 0,
          background: accentDim, border: `1px solid ${accentBorder}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="6" width="20" height="12" rx="2"/>
            <line x1="6" y1="12" x2="6" y2="12"/><line x1="10" y1="12" x2="10" y2="12"/>
            <line x1="14" y1="12" x2="14" y2="12"/><line x1="18" y1="12" x2="18" y2="12"/>
          </svg>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.01em', color: titleColor }}>
              {effectiveMake && effectiveModel
                ? `${effectiveMake} ${specs?.model || effectiveModel}`
                : effectiveMake || effectiveModel || sw.name || 'Unidentified device'}
            </span>
          </div>
          {(sw.position || sw.ip_address || effectiveMake) && (() => {
            // Per-vendor login portal: if we have a curated URL for this
            // vendor (from login-info.xlsx) use it; otherwise fall back to
            // a known support/site landing page; otherwise show nothing.
            const portal = effectiveMake ? findVendorLogin(effectiveMake) : null;
            return (
              <div style={{ fontSize: '.72rem', color: subColor, marginTop: 3, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {sw.position   && <span style={{ color: accent, fontWeight: 600 }}>{sw.position}</span>}
                {sw.ip_address && <span>{sw.ip_address}</span>}
                {portal && (
                  <a
                    href={portal.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    onClick={(e) => e.stopPropagation()}
                    title={portal.source === 'login'
                      ? `Log in to ${portal.name} to view device details`
                      : `Open ${portal.name} support`}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      fontSize: '.68rem', fontWeight: 700,
                      padding: '2px 8px', borderRadius: 999,
                      background: accentDim,
                      border: `1px solid ${accentBorder}`,
                      color: accent,
                      textDecoration: 'none',
                      letterSpacing: '.02em',
                    }}>
                    {portal.source === 'login' ? 'Login portal' : 'Vendor site'}
                    <span aria-hidden="true">↗</span>
                  </a>
                )}
              </div>
            );
          })()}
        </div>

        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke={chevronColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ flexShrink: 0, transform: expanded ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform .2s ease' }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {/* ── Fields grid ──
          Vendor and Model are already in the header title, so we drop them
          here to avoid the previously-flagged duplication. Firmware DOES
          get its own tile (with an em-dash placeholder when unknown) so
          the user always knows where the firmware version lives and can
          add one via the expanded Firmware section. Serial / MAC / IP
          appear when populated. */}
      {(displayVersion || sw.serial_number || sw.mac_address || sw.ip_address) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(0, 1fr))', gap: 1, borderTop: `1px solid ${divider}` }}>
          {[
            ['Firmware',     displayVersion
                              ? (versionIsUserSupplied ? `${displayVersion} · entered` : displayVersion)
                              : '—'],
            sw.serial_number && ['Serial', sw.serial_number],
            sw.mac_address   && ['MAC',    sw.mac_address],
            sw.ip_address    && ['IP',     sw.ip_address],
          ].filter(Boolean).map(([label, value]) => (
            <div key={label} style={{ padding: '10px 16px', background: fieldBg }}>
              <span style={{ display: 'block', fontSize: '.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: accent, marginBottom: 3 }}>
                {label}
              </span>
              <span style={{ display: 'block', fontSize: '.82rem', fontWeight: 600, color: valueColor }}>
                {value}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── Expanded: firmware + specs ── */}
      {expanded && (
        <div style={{ borderTop: `1px solid ${divider}`, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Identifier section — shown whenever OCR didn't pin down the
              full make + model, or whenever the user wants to correct
              what OCR returned. The user explicitly asked for manual
              entry on either-missing, not just both-missing. */}
          {(identMissing || identIncomplete || editingIdent || makeIsUserSupplied || modelIsUserSupplied) && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: '.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: statusColor }}>
                  Identification
                </span>
                {identMissing && !editingIdent && (
                  <span style={{ fontSize: '.7rem', fontWeight: 700, color: '#717171', background: '#ffffff', padding: '2px 8px', borderRadius: 20, border: '1px solid #ececec' }}>
                    Not detected
                  </span>
                )}
                {identIncomplete && !editingIdent && !makeIsUserSupplied && !modelIsUserSupplied && (
                  <span style={{ fontSize: '.7rem', fontWeight: 700, color: '#717171', background: '#ffffff', padding: '2px 8px', borderRadius: 20, border: '1px solid #ececec' }}>
                    {effectiveMake ? 'Model not detected' : 'Vendor not detected'}
                  </span>
                )}
                {(makeIsUserSupplied || modelIsUserSupplied) && !editingIdent && (
                  <span style={{ fontSize: '.7rem', fontWeight: 700, color: '#717171', background: '#ffffff', padding: '2px 8px', borderRadius: 20, border: '1px solid #ececec' }}>
                    Manual entry
                  </span>
                )}
                {!editingIdent && (
                  <button
                    type="button"
                    onClick={startEditIdent}
                    style={{
                      marginLeft: 'auto', background: 'transparent', border: 0,
                      color: linkColor, fontSize: '.7rem', fontWeight: 600, cursor: 'pointer',
                      padding: 0,
                    }}
                  >{
                    identMissing && !makeIsUserSupplied && !modelIsUserSupplied
                      ? 'Enter make / model'
                      : identIncomplete && !makeIsUserSupplied && !modelIsUserSupplied
                        ? (effectiveMake ? 'Add model' : 'Add vendor')
                        : 'Edit'
                  }</button>
                )}
              </div>
              {editingIdent ? (
                <IdentEditor
                  draftMake={identDraftMake}
                  setDraftMake={setIdentDraftMake}
                  draftModel={identDraftModel}
                  setDraftModel={setIdentDraftModel}
                  onSave={saveIdent}
                  onCancel={cancelEditIdent}
                  hasExisting={!!(userMake || userModel)}
                  onClear={clearIdent}
                  accent={accent}
                  fieldBg={fieldBg}
                  fieldBorder={fieldBorder}
                  valueColor={valueColor}
                  statusColor={statusColor}
                />
              ) : identMissing ? (
                <StatusLine color={statusColor}>
                  We couldn't identify this device from the rack photo.
                </StatusLine>
              ) : identIncomplete && !makeIsUserSupplied && !modelIsUserSupplied ? (
                <StatusLine color={statusColor}>
                  {effectiveMake
                    ? `We identified "${effectiveMake}" but couldn't read the model. Specs and firmware checks need both.`
                    : `We read a model but couldn't identify the vendor.`}
                </StatusLine>
              ) : null}
            </div>
          )}

          {/* Tab strip — Firmware / Hardware / Optics. Renders one focused
              section at a time so the card stays compact and each tab maps
              to a real data source (firmware lookup / vendor spec sheet /
              SFP procurement advisor). */}
          <div role="tablist" aria-label="Switch details"
            style={{
              display: 'flex', gap: 0,
              borderBottom: `1px solid ${divider}`,
              marginBottom: 4,
            }}>
            {[
              { k: 'hardware', label: 'Specifications' },
              { k: 'firmware', label: 'Firmware' },
              { k: 'optics',   label: 'SFP Advisor' },
            ].map(t => {
              const on = swTab === t.k;
              return (
                <button
                  key={t.k}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setSwTab(t.k)}
                  style={{
                    flex: 1,
                    padding: '10px 4px',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: `2px solid ${on ? accent : 'transparent'}`,
                    color: on ? titleColor : statusColor,
                    fontSize: '.74rem',
                    fontWeight: on ? 700 : 500,
                    letterSpacing: '.04em',
                    cursor: 'pointer',
                    transition: 'color .15s, border-color .15s',
                    marginBottom: -1,
                  }}>
                  {t.label}
                </button>
              );
            })}
          </div>

          {swTab === 'firmware' && (<>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: '.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: statusColor }}>Firmware</span>
              {firmwareStatus === 'ready' && (
                <span style={{ fontSize: '.7rem', fontWeight: 700, color: fwColor, background: `${fwColor}18`, padding: '2px 8px', borderRadius: 20, border: `1px solid ${fwColor}40` }}>
                  {fwHeadline}
                </span>
              )}
              {versionIsUserSupplied && !editingVersion && (firmwareStatus === 'ready' || firmwareStatus === 'error') && (
                <button
                  type="button"
                  onClick={startEditVersion}
                  style={{
                    marginLeft: 'auto', background: 'transparent', border: 0,
                    color: linkColor, fontSize: '.7rem', fontWeight: 600, cursor: 'pointer',
                    padding: 0,
                  }}
                >Edit version</button>
              )}
            </div>
            {versionIsUserSupplied && editingVersion && (firmwareStatus === 'ready' || firmwareStatus === 'error') && (
              <div style={{ marginBottom: 10 }}>
                <VersionEditor
                  editing
                  draft={versionDraft}
                  setDraft={setVersionDraft}
                  onSave={saveVersion}
                  onCancel={cancelEditVersion}
                  hasExisting={!!userVersion}
                  onClear={clearVersion}
                  onStartEdit={startEditVersion}
                  accent={accent}
                  fieldBg={fieldBg}
                  fieldBorder={fieldBorder}
                  valueColor={valueColor}
                  statusColor={statusColor}
                />
              </div>
            )}
            {firmwareStatus === 'loading' && <StatusLine color={statusColor}>Checking for updates…</StatusLine>}
            {firmwareStatus === 'skipped' && lookupModel && (
              <VersionEditor
                editing={editingVersion || !displayVersion}
                draft={versionDraft}
                setDraft={setVersionDraft}
                onSave={saveVersion}
                onCancel={cancelEditVersion}
                hasExisting={!!userVersion}
                onClear={clearVersion}
                onStartEdit={startEditVersion}
                accent={accent}
                fieldBg={fieldBg}
                fieldBorder={fieldBorder}
                valueColor={valueColor}
                statusColor={statusColor}
              />
            )}
            {firmwareStatus === 'skipped' && !lookupModel && (
              <StatusLine color={statusColor}>Add a model to check for updates.</StatusLine>
            )}
            {firmwareStatus === 'error'   && <StatusLine color={statusColor}>Couldn't check for updates right now.</StatusLine>}
            {firmwareStatus === 'ready' && firmware && (() => {
              // When the agent didn't have a verified latest version, the
              // "Latest" cell becomes a direct link to the vendor's official
              // download page instead of showing a dead em-dash. The same
              // VENDOR_FW_URL map is reused for the explanatory block below.
              const VENDOR_FW_URL = {
                mikrotik: 'https://mikrotik.com/download',
                cisco:    'https://software.cisco.com/download/home',
                juniper:  'https://support.juniper.net/support/downloads/',
                arista:   'https://www.arista.com/en/support/software-download',
                hpe:      'https://support.hpe.com/connect/s/',
                aruba:    'https://asp.arubanetworks.com/downloads',
                dell:     'https://www.dell.com/support/home/en-in?app=drivers',
                fortinet: 'https://support.fortinet.com/Download/FirmwareImages.aspx',
                extreme:  'https://www.extremenetworks.com/support/documentation',
                netgear:  'https://www.netgear.com/support/download/',
                tplink:   'https://www.tp-link.com/support/download/',
                dlink:    'https://www.dlink.com/support/downloads/',
                ubiquiti: 'https://www.ui.com/download/',
                huawei:   'https://support.huawei.com/enterprise/en/index.html',
                ruijie:   'https://www.ruijienetworks.com/support/documents',
                zyxel:    'https://www.zyxel.com/global/en/support/download',
              };
              const norm = String(displayVendor || effectiveMake || '')
                .toLowerCase().replace(/[^a-z0-9]/g, '');
              let fwUrl = null;
              for (const k of Object.keys(VENDOR_FW_URL)) {
                if (norm.includes(k)) { fwUrl = VENDOR_FW_URL[k]; break; }
              }
              const latestUnknown = firmware.latestVersion == null;
              return (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8 }}>
                  <MiniField label="Current" value={firmware.currentVersion} accent={accent} fieldBg={fieldBg} fieldBorder={fieldBorder} valueColor={valueColor} />
                  {latestUnknown && fwUrl ? (
                    <a href={fwUrl} target="_blank" rel="noreferrer noopener"
                      style={{
                        display: 'flex', flexDirection: 'column', gap: 2,
                        padding: '8px 10px', borderRadius: 8,
                        background: fieldBg,
                        border: `1px solid ${fieldBorder}`,
                        textDecoration: 'none',
                      }}>
                      <span style={{ fontSize: '.55rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.10em', color: accent }}>
                        Latest
                      </span>
                      <span style={{ fontSize: '.78rem', fontWeight: 700, color: linkColor }}>
                        Check site ↗
                      </span>
                    </a>
                  ) : (
                    <MiniField label="Latest" value={firmware.latestVersion || '—'} accent={accent} fieldBg={fieldBg} fieldBorder={fieldBorder} valueColor={valueColor} />
                  )}
                  {firmware.recommendedMinVersion && firmware.recommendedMinVersion !== firmware.latestVersion && (
                    <MiniField label="Min safe" value={firmware.recommendedMinVersion} accent={'#4c4546'} fieldBg={fieldBg} fieldBorder={fieldBorder} valueColor={valueColor} />
                  )}
                  {firmware.releaseNotesUrl && (
                    <a href={firmware.releaseNotesUrl} target="_blank" rel="noreferrer noopener"
                      style={{ display: 'flex', alignItems: 'center', fontSize: '.72rem', color: linkColor, textDecoration: 'none' }}>
                      Release notes ↗
                    </a>
                  )}
                  {!firmware.releaseNotesUrl && firmware.portalUrl && (
                    <a href={firmware.portalUrl} target="_blank" rel="noreferrer noopener"
                      style={{ display: 'flex', alignItems: 'center', fontSize: '.72rem', color: linkColor, textDecoration: 'none' }}>
                      Vendor portal ↗
                    </a>
                  )}
                </div>
                {/* Explanatory note below the cells — when latest is unknown,
                    surface either the agent's diagnostic or a clear "DB
                    doesn't cover this vendor" message. The clickable Latest
                    cell above already gives the user a one-tap route to the
                    vendor's download page, so this is just plain text. */}
                {latestUnknown && (
                  <div style={{ marginTop: 10, fontSize: '.72rem', color: statusColor, lineHeight: 1.5 }}>
                    {firmware.advisoryMessage ||
                      `Couldn't find a verified latest firmware for ${effectiveMake || displayVendor || 'this vendor'} ${effectiveModel || ''} in our database. Tap "Check site ↗" above to see the current release on the manufacturer's official site.`}
                  </div>
                )}
              </>
              );
            })()}
          </div>
          </>)}

          {swTab === 'hardware' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: '.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: statusColor }}>
                Hardware
              </span>
              {specs?.productUrl && (
                <a href={specs.productUrl} target="_blank" rel="noreferrer noopener"
                  style={{ fontSize: '.72rem', fontWeight: 600, color: linkColor, textDecoration: 'none' }}>
                  View full details ↗
                </a>
              )}
            </div>
            {specsStatus === 'loading' && <StatusLine color={statusColor}>Looking up specs…</StatusLine>}
            {specsStatus === 'skipped' && <StatusLine color={statusColor}>Add vendor and model to see specs.</StatusLine>}
            {specsStatus === 'error'   && <StatusLine color={statusColor}>{looksLikeBackendNoise(specs?.error) ? 'Couldn’t load specs.' : (specs?.error || 'Couldn’t load specs.')}</StatusLine>}
            {specsStatus === 'ready' && specs?.specs && (() => {
              const rows = Object.entries(specs.specs);
              return (
                <div style={{ display: 'flex', flexDirection: 'column', borderRadius: 10, border: `1px solid ${fieldBorder}`, overflow: 'hidden' }}>
                  {rows.map(([k, v], i) => (
                    <div key={k} style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(110px, 42%) 1fr',
                      gap: 10,
                      padding: '9px 12px',
                      background: i % 2 === 0 ? fieldBg : 'transparent',
                      borderBottom: i < rows.length - 1 ? `1px solid ${fieldBorder}` : 'none',
                      alignItems: 'start',
                    }}>
                      <span style={{ fontSize: '.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: accent, lineHeight: 1.4, paddingTop: 1 }}>
                        {k}
                      </span>
                      <span style={{ fontSize: '.82rem', fontWeight: 500, color: valueColor, lineHeight: 1.45, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                        {String(v)}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
          )}

          {swTab === 'optics' && (
            <SfpAdvisor
              rackId={rackId}
              vendor={effectiveMake || 'Unknown'}
              model={effectiveModel || 'Unknown'}
            />
          )}

        </div>
      )}
    </article>
  );
}

function VersionEditor({
  editing, draft, setDraft, onSave, onCancel, hasExisting, onClear, onStartEdit,
  accent, fieldBg, fieldBorder, valueColor, statusColor,
}) {
  if (!editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <StatusLine color={statusColor}>No firmware version recorded.</StatusLine>
        <button
          type="button"
          onClick={onStartEdit}
          style={{
            background: 'transparent', border: `1px solid ${accent}`,
            color: accent, fontSize: '.72rem', fontWeight: 600,
            padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
          }}
        >Enter version</button>
      </div>
    );
  }
  return (
    <div style={{
      padding: 10, borderRadius: 10,
      background: fieldBg, border: `1px solid ${fieldBorder}`,
    }}>
      <span style={{
        display: 'block', fontSize: '.62rem', fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '.08em',
        color: accent, marginBottom: 8,
      }}>
        Enter firmware version
      </span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <input
          type="text"
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); onSave(); }
            else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
          }}
          placeholder="e.g. 1.0.6 Build 20210323"
          style={{
            flex: '1 1 160px', minWidth: 0,
            padding: '6px 10px', borderRadius: 6,
            background: 'transparent', color: valueColor,
            border: `1px solid ${fieldBorder}`,
            fontSize: '16px', fontFamily: 'inherit',
            outline: 'none',
          }}
        />
        <button
          type="button"
          onClick={onSave}
          disabled={!draft.trim()}
          style={{
            background: accent, color: '#ffffff', border: 0,
            padding: '6px 12px', borderRadius: 6,
            fontSize: '.78rem', fontWeight: 700, cursor: draft.trim() ? 'pointer' : 'not-allowed',
            opacity: draft.trim() ? 1 : 0.5,
          }}
        >Save</button>
        <button
          type="button"
          onClick={onCancel}
          style={{
            background: 'transparent', color: statusColor,
            border: `1px solid ${fieldBorder}`,
            padding: '6px 10px', borderRadius: 6,
            fontSize: '.78rem', fontWeight: 600, cursor: 'pointer',
          }}
        >Cancel</button>
        {hasExisting && (
          <button
            type="button"
            onClick={onClear}
            style={{
              background: 'transparent', color: '#1a1c1d',
              border: `1px solid rgba(0,0,0,0.35)`,
              padding: '6px 10px', borderRadius: 6,
              fontSize: '.78rem', fontWeight: 600, cursor: 'pointer',
            }}
          >Clear</button>
        )}
      </div>
    </div>
  );
}

// Make + model editor. Used when OCR couldn't pin down identification
// or when the user is correcting what OCR returned. Saves both fields
// atomically — model regex resolution happens server-side at /api/specs
// time, so the UI doesn't need to validate model strings.
function IdentEditor({
  draftMake, setDraftMake, draftModel, setDraftModel,
  onSave, onCancel, hasExisting, onClear,
  accent, fieldBg, fieldBorder, valueColor, statusColor,
}) {
  const inputStyle = {
    flex: '1 1 140px', minWidth: 0,
    padding: '6px 10px', borderRadius: 6,
    background: 'transparent', color: valueColor,
    border: `1px solid ${fieldBorder}`,
    fontSize: '16px', fontFamily: 'inherit',
    outline: 'none',
  };
  const onKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); onSave(); }
    else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
  };
  const canSave = !!(draftMake.trim() && draftModel.trim());
  return (
    <div style={{
      padding: 10, borderRadius: 10,
      background: fieldBg, border: `1px solid ${fieldBorder}`,
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div>
          <span style={{
            display: 'block', fontSize: '.6rem', fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '.07em',
            color: accent, marginBottom: 4,
          }}>Make / Vendor</span>
          <input
            type="text"
            autoFocus
            value={draftMake}
            onChange={e => setDraftMake(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="e.g. MikroTik"
            style={inputStyle}
          />
        </div>
        <div>
          <span style={{
            display: 'block', fontSize: '.6rem', fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '.07em',
            color: accent, marginBottom: 4,
          }}>Model</span>
          <input
            type="text"
            value={draftModel}
            onChange={e => setDraftModel(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="e.g. CRS328-24P-4S+RM"
            style={inputStyle}
          />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
        <button
          type="button"
          onClick={onSave}
          disabled={!canSave}
          style={{
            background: accent, color: '#ffffff', border: 0,
            padding: '6px 12px', borderRadius: 6,
            fontSize: '.78rem', fontWeight: 700, cursor: canSave ? 'pointer' : 'not-allowed',
            opacity: canSave ? 1 : 0.5,
          }}
        >Save</button>
        <button
          type="button"
          onClick={onCancel}
          style={{
            background: 'transparent', color: statusColor,
            border: `1px solid ${fieldBorder}`,
            padding: '6px 10px', borderRadius: 6,
            fontSize: '.78rem', fontWeight: 600, cursor: 'pointer',
          }}
        >Cancel</button>
        {hasExisting && (
          <button
            type="button"
            onClick={onClear}
            style={{
              background: 'transparent', color: '#1a1c1d',
              border: `1px solid rgba(0,0,0,0.35)`,
              padding: '6px 10px', borderRadius: 6,
              fontSize: '.78rem', fontWeight: 600, cursor: 'pointer',
            }}
          >Clear</button>
        )}
      </div>
    </div>
  );
}

function StatusLine({ children, color }) {
  return (
    <p style={{ margin: 0, fontSize: '.78rem', color: color || 'rgba(0,0,0,0.7)', fontStyle: 'italic' }}>
      {children}
    </p>
  );
}

function MiniField({ label, value, accent, fieldBg, fieldBorder, valueColor }) {
  return (
    <div style={{ padding: '8px 10px', borderRadius: 8, background: fieldBg, border: `1px solid ${fieldBorder}` }}>
      <span style={{ display: 'block', fontSize: '.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: accent, marginBottom: 3 }}>
        {label}
      </span>
      <span style={{ display: 'block', fontSize: '.8rem', fontWeight: 600, color: valueColor, wordBreak: 'break-word' }}>
        {value || '—'}
      </span>
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <span style={{ display: 'block', fontSize: '.65rem', color: 'rgba(0,0,0,0.5)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
        {label}
      </span>
      <span style={{ display: 'block', fontSize: '.82rem', color: '#e9e9e9', wordBreak: 'break-word' }}>
        {value || '—'}
      </span>
    </div>
  );
}

// ── Shared data + rendering logic ────────────────────────────
function useSwitchData(rackId) {
  // The Switches tab is driven purely by what the rack scan saw (OCR /
  // detection) plus any user overrides — CMDB is intentionally excluded
  // here. The user doesn't want this page to surface ServiceNow-sourced
  // facts; the page's purpose is "what's actually in front of me", not
  // "what does the asset DB claim is in front of me".
  const ocrCached  = rackId ? getCached(cacheKey.ocrDevices(rackId)) : null;
  const ocrCachedDevs = ocrCached?.devices && Array.isArray(ocrCached.devices)
    ? ocrCached.devices
    : null;

  const [loading, setLoading] = useState(!ocrCachedDevs);
  const [ocrDevices, setOcrDevices] = useState(ocrCachedDevs);

  useEffect(() => {
    if (!rackId) { setLoading(false); return; }
    let cancelled = false;
    if (ocrCachedDevs) { setLoading(false); return; }

    setLoading(true);
    authFetch(apiUrl(`/api/scan/${encodeURIComponent(rackId)}/ocr-devices`))
      .then(async r => {
        if (!r.ok) return null;
        const text = await r.text();
        try { return text ? JSON.parse(text) : null; } catch { return null; }
      })
      .catch(() => null)
      .then(ocrData => {
        if (cancelled) return;
        const devs = Array.isArray(ocrData) ? ocrData
                   : (ocrData?.devices && Array.isArray(ocrData.devices)) ? ocrData.devices
                   : null;
        if (devs) {
          setOcrDevices(devs);
          if (ocrData && !ocrCached) setCached(cacheKey.ocrDevices(rackId), ocrData);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [rackId]);

  // Switch Information is switches only — routers are a different device class
  // and were showing up here mislabelled as switches (e.g. a Mikrotik router).
  const NETWORK_CLASSES = ['switch'];
  const switches = (ocrDevices || [])
    .filter(ocr => NETWORK_CLASSES.includes((ocr.class_name || '').toLowerCase()))
    .map(ocr => {
      // Prefer extracting from raw_text (more complete), fall back to ocr.model
      const rawExtracted = extractModelFromRaw(ocr.raw_text, ocr.make);
      const model = expandPartialModel(rawExtracted || ocr.model || '');
      return {
        name: ocr.position ? `${ocr.class_name} (${ocr.position})` : (ocr.name || ocr.class_name || 'Detected switch'),
        manufacturer: ocr.make || '',
        model_number: model,
        os_version: ocr.version || '',
        serial_number: '',
        mac_address: '',
        ip_address: '',
        position: ocr.position || '',
        discovery_source: ocr.source || 'ocr',
        ocr_conf: ocr.match_conf,
        raw_text: ocr.raw_text || '',
        _fromOcr: true,
      };
    });
  // Always treat the Switches tab as OCR/scan-driven now — drives the
  // existing UI branch that hides CMDB chrome (CMDB tag, "entered" tags
  // sourced from CMDB, etc.).
  const showingOcrOnly = true;

  return { loading, data: null, switches, showingOcrOnly };
}

function SwitchInfoBody({ rackId, loading, data, switches, showingOcrOnly }) {
  return (
    <>
      {loading && (
        <div style={{ padding: '32px 16px', textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: '.88rem', color: 'rgba(0,0,0,0.55)' }}>
            Scanning rack for switches…
          </p>
        </div>
      )}

      {!loading && switches.length === 0 && (
        <div style={{
          marginTop: 18, padding: 16, borderRadius: 12,
          background: '#ffffff',
          border: '1px dashed #e6e6e6',
        }}>
          <p style={{ margin: 0, fontWeight: 600, color: '#121417', fontSize: '.92rem' }}>
            Scanning…
          </p>
          <p style={{ margin: '6px 0 0', fontSize: '.78rem', color: '#717171' }}>
            Run a rack scan to detect switches. Their make, model and firmware version will appear here once detected.
          </p>
        </div>
      )}

      {!loading && switches.length > 0 && (
        <SwitchPicker switches={switches} rackId={rackId} />
      )}
    </>
  );
}

// ── Switch picker — replaces the old stacked-rows layout ────
// Horizontal tab strip of every detected switch. Selecting a tab swaps
// in its fully-expanded detail panel. For single-switch racks the picker
// collapses to just the panel (no point in a single tab).
function SwitchPicker({ switches, rackId }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const safeIdx = Math.min(activeIdx, switches.length - 1);
  const active  = switches[safeIdx];

  // Build a short label per switch — prefer position (U09 / U07) when the
  // OCR caught it, fall back to the short model, then to the index.
  const tabLabel = (sw, i) => {
    if (sw.position) return sw.position;
    if (sw.model_number) {
      const m = String(sw.model_number);
      return m.length > 18 ? m.slice(0, 16) + '…' : m;
    }
    return `Switch ${i + 1}`;
  };
  const tabSub = (sw) => {
    if (sw.model_number) {
      const m = String(sw.model_number);
      return m.length > 18 ? m.slice(0, 16) + '…' : m;
    }
    return sw.manufacturer || '';
  };

  return (
    <section style={{ marginTop: 16 }}>
      {switches.length > 1 && (
        <div
          role="tablist"
          aria-label="Switches detected in this rack"
          style={{
            display: 'grid',
            gridAutoFlow: 'column',
            gridAutoColumns: 'minmax(140px, 1fr)',
            gap: 10,
            overflowX: 'auto',
            padding: '4px 0 18px',
            marginBottom: 4,
            msOverflowStyle: 'none',
            scrollbarWidth: 'none',
          }}>
          {switches.map((sw, i) => {
            const on = i === safeIdx;
            return (
              <button
                key={sw.serial_number || sw.name || i}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setActiveIdx(i)}
                style={{
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: 6,
                  padding: on ? '14px 14px 14px 18px' : '14px',
                  borderRadius: 14,
                  border: on
                    ? '2px solid var(--md-on-surface, #121417)'
                    : '1px solid var(--md-outline-variant, #E0E0E0)',
                  background: 'var(--md-surface-container-lowest, #FFFFFF)',
                  color: 'var(--md-on-surface, #121417)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  textAlign: 'left',
                  transition: 'border-color 0.16s, padding 0.16s',
                  overflow: 'hidden',
                  minWidth: 0,
                }}>
                {/* Left accent strip on the active card */}
                {on && (
                  <span aria-hidden="true" style={{
                    position: 'absolute',
                    left: 0, top: 0, bottom: 0,
                    width: 4,
                    background: 'var(--md-on-surface, #121417)',
                  }} />
                )}

                {/* Tiny status dot — black filled for active, hollow for inactive */}
                <span aria-hidden="true" style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                }}>
                  <span style={{
                    width: 7, height: 7, borderRadius: '50%',
                    background: on ? 'var(--md-on-surface, #121417)' : 'transparent',
                    border: on ? 'none' : '1.5px solid var(--md-on-surface, #121417)',
                    opacity: on ? 1 : 0.55,
                    transition: 'background 0.14s, opacity 0.14s',
                  }} />
                  <span style={{
                    fontFamily: 'var(--font, inherit)',
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.10em',
                    textTransform: 'uppercase',
                    color: 'var(--md-on-surface, #121417)',
                    opacity: on ? 0.7 : 0.45,
                  }}>
                    Switch {i + 1}
                  </span>
                </span>

                <span style={{
                  fontSize: 18,
                  fontWeight: 700,
                  letterSpacing: '-0.01em',
                  lineHeight: '22px',
                  color: 'var(--md-on-surface, #121417)',
                }}>
                  {tabLabel(sw, i)}
                </span>

                {tabSub(sw) && (
                  <span style={{
                    fontFamily: 'var(--mono, ui-monospace, monospace)',
                    fontSize: 11,
                    fontWeight: 500,
                    letterSpacing: 0,
                    lineHeight: '14px',
                    color: 'var(--md-on-surface, #121417)',
                    opacity: 0.6,
                    maxWidth: '100%',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {tabSub(sw)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {active && (
        <SwitchCard
          key={active.serial_number || active.name || safeIdx}
          sw={active}
          rackId={rackId}
          defaultExpanded
        />
      )}
    </section>
  );
}

// ── Embeddable content (used as a tab in ResultsPage) ────────
export function SwitchInfoContent({ rackId }) {
  const d = useSwitchData(rackId);
  return <SwitchInfoBody rackId={rackId} {...d} />;
}

// ── Standalone page (used by /switch-info route) ─────────────
export default function SwitchInformationPage() {
  const navigate = useNavigate();
  const goBack = useSmartBack();
  const location = useLocation();
  const params = useParams();
  const rackId = params.rackId || location.state?.rackId || null;
  const switchData = useSwitchData(rackId);
  const { loading, data, switches, showingOcrOnly } = switchData;

  // The page root is `.page.page-full` (height:100dvh, overflow:hidden), so the
  // content must scroll in its OWN container — otherwise long spec tables get
  // clipped and the page can't be scrolled on mobile. A ref on that container
  // also drives the "Back to top" button.
  const scrollRef = useRef(null);
  const [showTop, setShowTop] = useState(false);

  return (
    <div className={`page page-full ${styles.specs}`}>
      <div className={styles.amb} />
      <div className={styles.amb2} />

      <header className={styles.header}>
        <button className={styles.backBtn} onClick={() => goBack()} aria-label="Back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/>
            <polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>
        <h1 className={styles.title}>Switch Information</h1>
        <ThemeToggle />
      </header>

      <div
        className={styles.scrollBody}
        ref={scrollRef}
        onScroll={(e) => setShowTop(e.currentTarget.scrollTop > 320)}
      >
        <SwitchInfoBody rackId={rackId} {...switchData} />
      </div>

      {showTop && (
        <button
          type="button"
          className={styles.backToTop}
          onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="Back to top"
          title="Back to top"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="19" x2="12" y2="5"/>
            <polyline points="5 12 12 5 19 12"/>
          </svg>
        </button>
      )}
    </div>
  );
}
