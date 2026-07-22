import { Component } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import styles from './ErrorBoundary.module.css';

/**
 * Per-route error boundary. The root ErrorBoundary (around <App/>) catches
 * everything, but when it does it replaces the WHOLE app — providers, nav,
 * background handlers and all — and its "Try again" only re-renders the same
 * cached failure. This boundary sits between the router and the route elements
 * so a failure in one route is contained: the shell, the Android back handler
 * and the scan resumer keep running, and recovery is meaningful.
 *
 * Two failure modes are handled differently:
 *
 *  - A code-split chunk that fails to download. React caches a rejected lazy
 *    import PERMANENTLY (the Rejected status is terminal), so re-rendering the
 *    same <Suspense> just re-throws the cached rejection — only a fresh page
 *    load can re-request the chunk. So the recovery here is a hard reload, and
 *    the copy says the page could not be loaded rather than "something broke".
 *
 *  - A genuine render error inside a route. That is a real bug; "Try again"
 *    clears the boundary and re-renders the route, and navigating anywhere
 *    else (Android back, Go home) clears it via the location change below.
 */

// Chrome: "Failed to fetch dynamically imported module".
// Firefox: "error loading dynamically imported module".
// Safari: "Importing a module script failed".
// Legacy webpack/older builds: "Loading chunk N failed" / ChunkLoadError.
function isChunkLoadError(err) {
  if (!err) return false;
  const name = String(err.name || '');
  const msg = String(err.message || '');
  return name === 'ChunkLoadError'
    || /loading chunk [\d]+ failed/i.test(msg)
    || /loading css chunk/i.test(msg)
    || /failed to fetch dynamically imported module/i.test(msg)
    || /error loading dynamically imported module/i.test(msg)
    || /importing a module script failed/i.test(msg);
}

class RouteErrorBoundary extends Component {
  constructor(props) {
    super(props);
    // prevKey lets us drop a caught error the moment the user navigates to a
    // different route, so the destination renders clean instead of inheriting
    // the previous route's error screen.
    this.state = { error: null, prevKey: props.locationKey };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  static getDerivedStateFromProps(props, state) {
    if (props.locationKey !== state.prevKey) {
      return { error: null, prevKey: props.locationKey };
    }
    return null;
  }

  componentDidCatch(error, info) {
    console.error('[RackTrack] route error:', error, info?.componentStack);
    // Best-effort report; never let reporting throw and mask the real error.
    try {
      const body = JSON.stringify({
        message: String(error?.message || error),
        stack: String(error?.stack || '').slice(0, 4000),
        componentStack: String(info?.componentStack || '').slice(0, 4000),
        path: window.location?.pathname,
        chunkLoad: isChunkLoadError(error),
        userAgent: navigator?.userAgent,
      });
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/client-error', new Blob([body], { type: 'application/json' }));
      }
    } catch { /* reporting is best effort */ }
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (isChunkLoadError(error)) {
      return (
        <div className={styles.wrap} role="alert">
          <div className={styles.card}>
            <div className={styles.icon} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 11-6.2-8.5" />
                <polyline points="21 3 21 9 15 9" />
              </svg>
            </div>
            <h1 className={styles.title}>This page couldn&rsquo;t be loaded</h1>
            <p className={styles.body}>
              We couldn&rsquo;t download this part of the app &mdash; usually a network
              hiccup or an update that landed mid-session. Reloading fetches it again.
              Your scans and data are safe.
            </p>
            <div className={styles.actions}>
              <button type="button" className={styles.primary}
                      onClick={() => window.location.reload()}>
                Reload
              </button>
              <button type="button" className={styles.ghost}
                      onClick={() => { window.location.href = '/'; }}>
                Go to Home
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className={styles.wrap} role="alert">
        <div className={styles.card}>
          <div className={styles.icon} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <h1 className={styles.title}>This screen stopped working</h1>
          <p className={styles.body}>
            Something went wrong drawing this page. Your scans and data are safe &mdash;
            this is a display problem, not a lost-work problem.
          </p>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={this.reset}>
              Try again
            </button>
            <button type="button" className={styles.ghost} onClick={this.props.onHome}>
              Go to Home
            </button>
          </div>
        </div>
      </div>
    );
  }
}

/**
 * Wrapper that feeds the current location into the class boundary (so it can
 * self-clear on navigation) and an SPA "Go home" that clears the error without
 * a full reload.
 */
export default function RouteBoundary({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <RouteErrorBoundary
      locationKey={location.pathname}
      onHome={() => navigate('/', { replace: true })}
    >
      {children}
    </RouteErrorBoundary>
  );
}
