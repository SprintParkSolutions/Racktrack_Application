import { useState, useEffect, useCallback } from 'react';
import { apiUrl, ensureFreshAssetToken, assetTokenGeneration } from '../utils/api';

/* An <img> for /outputs and /uploads.
 *
 * Those paths are authorised by a short-lived token in the query string,
 * because an <img> cannot send an Authorization header. When that token
 * expires the server answers 404 and the browser shows a broken image —
 * silently, with the rest of the page working normally, because every other
 * request carries a Bearer header and is unaffected. Testers reported it as
 * "the scanned rack images are not displayed".
 *
 * Foreground refresh (installAssetTokenRefresh) is the main defence. This is
 * the backstop for the rest: a token that expired while the page sat open, a
 * mint that failed on a flaky connection, a race between first paint and the
 * token landing. One failure triggers one re-mint and one retry; if that also
 * fails we stop, so a genuinely missing file cannot spin.
 */
export default function AssetImg({ path, src, alt = '', onError, ...rest }) {
  const [gen, setGen] = useState(assetTokenGeneration());
  const [tried, setTried] = useState(false);

  // Re-render when a new capability lands so an <img> that first painted with a
  // stale (or absent) token picks up the fresh one.
  useEffect(() => {
    const onToken = () => setGen(assetTokenGeneration());
    window.addEventListener('rt:asset-token', onToken);
    return () => window.removeEventListener('rt:asset-token', onToken);
  }, []);

  const handleError = useCallback((e) => {
    if (!tried) {
      setTried(true);
      ensureFreshAssetToken({ force: true }).then((t) => {
        if (t) setGen(assetTokenGeneration());
      });
      return;
    }
    if (onError) onError(e);
  }, [tried, onError]);

  const url = path ? apiUrl(path) : src;
  // gen participates in the key so a new token produces a genuinely new request
  // rather than the browser reusing its cached 404.
  return <img key={gen} src={url} alt={alt} onError={handleError} {...rest} />;
}
