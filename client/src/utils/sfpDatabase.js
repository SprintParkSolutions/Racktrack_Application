/**
 * SFP Module Database Query
 *
 * Queries vendor SFP specifications to advise procurement and validate
 * cable compatibility in the switch. Server-side lookup only — no on-device inference.
 */

import { apiUrl, authFetch } from './api';

// ── Session cache (per-session, cleared on navigation) ────────────────────
const _cache = new Map();  // "(vendor,model,iface...)" -> result

// ── Slot type metadata ─────────────────────────────────────────────────────
// Common SFP/XFP slot types and their standard configurations.
export const SFP_SLOT_TYPES = {
  SFP: { name: 'SFP', desc: 'SFP/LC', speed: '1G', maxSlots: 48 },
  'SFP+': { name: 'SFP+', desc: 'SFP+/LC', speed: '10G', maxSlots: 48 },
  XFP: { name: 'XFP', desc: 'XFP/LC', speed: '10G', maxSlots: 48 },
  QSFP: { name: 'QSFP', desc: 'QSFP', speed: '40G', maxSlots: 4 },
  'QSFP28': { name: 'QSFP28', desc: 'QSFP28', speed: '100G', maxSlots: 4 },
};

/**
 * Fetch SFP analysis from the server for a given switch.
 * Returns vendor SFP specifications, compatible transceiver models, and port layout.
 */
export async function fetchSfpAnalysis(vendor, model, ifaces) {
  if (!vendor || vendor === 'Unknown' || !model || model === 'Unknown') {
    return null;
  }

  const cacheKey = `${vendor}|${model}|${(ifaces || []).sort().join(',')}`;
  if (_cache.has(cacheKey)) {
    return _cache.get(cacheKey);
  }

  try {
    // Server route is /api/sfp/analyze; it expects `interfaces` as a
    // comma-separated string (it's passed straight to the Python script's
    // --interfaces flag).
    const r = await authFetch(apiUrl('/api/sfp/analyze'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vendor,
        model,
        interfaces: Array.isArray(ifaces) ? ifaces.join(',') : (ifaces || ''),
      }),
    });

    if (!r.ok) {
      return null;
    }

    const result = await r.json();
    _cache.set(cacheKey, result);
    return result;
  } catch (e) {
    console.error('[sfpDatabase] fetch error:', e);
    return null;
  }
}

/**
 * Generate a minimal fallback advice when SFP analysis cannot be fetched.
 * This is used when the server is unreachable and provides basic info only.
 */
export function generateOfflineFallback({ vendor, model, sfpPorts, sfpCounts }) {
  return {
    vendor,
    model,
    slotType: 'SFP',
    slotInfo: SFP_SLOT_TYPES['SFP'],
    compatibleModels: [],
    explanation: 'Server unavailable; limited information available.',
    sfpPorts: sfpPorts || [],
    sfpCounts: sfpCounts || {},
  };
}

/**
 * Clear the session cache (called on logout or navigation).
 */
export function clearSfpCache() {
  _cache.clear();
}
