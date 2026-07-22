import { useEffect, useState } from 'react';
import { assetTokenGeneration } from '../utils/api';

/**
 * Re-render when the asset token changes.
 *
 * Rack images are served from /outputs and /uploads, which now require a
 * short-lived capability appended to the URL. That token is held in a module
 * variable and `apiUrl()` is a plain function, so React has no idea when it
 * changes — an <img> rendered before the token arrived kept its stale `src`
 * and showed a broken thumbnail until the component happened to remount.
 *
 * Two cases where that bites, both ordinary:
 *   * cold start on a new device — nothing is stored, so the first render
 *     emits URLs with no token at all
 *   * the morning after — the stored token has expired, so the first render
 *     emits URLs the server refuses
 *
 * Mounting this once near the root is enough: the returned generation number
 * changes when a token is minted or cleared, which re-renders the tree and
 * rebuilds every src through apiUrl().
 */
export function useAssetToken() {
  const [gen, setGen] = useState(assetTokenGeneration);

  useEffect(() => {
    const onChange = () => setGen(assetTokenGeneration());
    window.addEventListener('rt:asset-token', onChange);
    // Cover a mint that landed between first render and this effect running.
    onChange();
    return () => window.removeEventListener('rt:asset-token', onChange);
  }, []);

  return gen;
}
