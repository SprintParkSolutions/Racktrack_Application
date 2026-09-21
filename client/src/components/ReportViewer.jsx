import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { BackIcon } from './BackButton.jsx';
import ExternalLink from './ExternalLink.jsx';
import useModalA11y from '../hooks/useModalA11y.js';
import styles from './ReportViewer.module.css';

/**
 * A RackTrack report, read inside the app.
 *
 * Every report button used to hand its address to the system browser, so
 * pressing "Drift report" threw the person out of the app and onto a web page
 * with the server's name in the address bar. The report is ours and it belongs
 * on our own screen, so it is shown here instead: the app's header with a back
 * arrow, the report's name, and the report itself filling the rest.
 *
 * `url` is the same short-lived signed address the caller always built - the
 * report token in the query string, because an iframe cannot carry an
 * Authorization header. Nothing about the server changes.
 *
 * The frame is sandboxed to `allow-same-origin` and nothing else: the report is
 * a printable page with no script of its own, and a sandbox without
 * `allow-top-navigation` means nothing inside it can steer the app somewhere
 * else - which is the whole point of bringing it in here.
 *
 * `children` is for whatever the calling screen can already do with the report
 * without leaving - send it, save it, push it on. Under that sits one plain
 * link to the browser, kept deliberately quiet: a person who has to hand the
 * file to somebody outside the app still can, and nothing becomes impossible.
 * `browserUrl` is for the screens whose way of saving the report is a file the
 * WebView will not save for itself - the server-rendered PDF - so the quiet
 * link hands over that address instead of the page being read.
 */
export default function ReportViewer({
  title, url, error = null, onClose, children = null, browserUrl = null,
}) {
  const panelRef = useModalA11y(onClose, { active: true });

  // The phone's own back button closes the report, exactly as the arrow does.
  // App.jsx asks the screen first and takes a cancelled event to mean "handled
  // here"; stopping the rest of the listeners keeps the page underneath from
  // stepping back as well, so one press closes one thing.
  useEffect(() => {
    const onBack = (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('rt:back', onBack);
    return () => window.removeEventListener('rt:back', onBack);
  }, [onClose]);

  return createPortal(
    <div className={styles.scrim}>
      <section className={styles.viewer} ref={panelRef} role="dialog" aria-modal="true" aria-label={title}>
        <header className={styles.head}>
          <button type="button" className={styles.back} onClick={onClose} aria-label="Back">
            <BackIcon />
          </button>
          <h2 className={styles.title}>{title}</h2>
        </header>

        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {!error && !url ? <p className={styles.busy}>Opening the report</p> : null}
        {!error && url ? (
          <iframe className={styles.frame} src={url} title={title} sandbox="allow-same-origin" />
        ) : null}

        {(children || (url && !error)) && (
          <footer className={styles.foot}>
            {children}
            {url && !error && (
              <ExternalLink className={styles.browser} href={browserUrl || url}>
                Open in the browser
              </ExternalLink>
            )}
          </footer>
        )}
      </section>
    </div>,
    document.body,
  );
}
