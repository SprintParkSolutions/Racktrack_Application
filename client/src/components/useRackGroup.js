import { useEffect, useState } from 'react';
import { apiUrl, authFetch } from '../utils/api';

// Cache responses per rackId for the lifetime of the page so navigating
// between Ports / Topology / Results doesn't re-fetch the same group.
const _cache = new Map(); // rackId → { group, members } | null

/**
 * useRackGroup(rackId)
 *
 * Returns { group, members, loading, error } describing the multi-rack
 * scan this rackId belongs to (if any). When the rack is standalone,
 * `group` is null — callers should treat that as "no rack tabs".
 */
// A cached entry is only trustworthy if we aren't expecting a specific group
// that it doesn't contain. Otherwise a stale `null` (cached when the rack had
// no group yet, or during the old dedupe behaviour) would hide a real group —
// which is exactly what made two-rack scans show as single on mobile, where the
// in-memory cache isn't cleared by a page refresh.
function _cacheValid(rackId, expectedGroupId) {
  if (!_cache.has(rackId)) return false;
  if (!expectedGroupId) return true;
  const c = _cache.get(rackId);
  return c?.group?.id === expectedGroupId;
}

export function useRackGroup(rackId, expectedGroupId = null) {
  const valid = rackId ? _cacheValid(rackId, expectedGroupId) : false;
  const [data, setData] = useState(valid ? _cache.get(rackId) : null);
  const [loading, setLoading] = useState(!valid);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!rackId) { setData(null); setLoading(false); return; }
    if (_cacheValid(rackId, expectedGroupId)) {
      setData(_cache.get(rackId));
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        // Pass the expected group so the server returns THAT group rather than
        // whichever one it happens to find first (a rack can be in several).
        const q = expectedGroupId ? `?group=${encodeURIComponent(expectedGroupId)}` : '';
        const r = await authFetch(apiUrl(`/api/rack/${encodeURIComponent(rackId)}/group${q}`));
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        const payload = j.group ? { group: j.group, members: j.members || [] } : null;
        _cache.set(rackId, payload);
        if (alive) setData(payload);
      } catch (e) {
        if (alive) setError(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [rackId, expectedGroupId]);

  return { data, loading, error };
}
