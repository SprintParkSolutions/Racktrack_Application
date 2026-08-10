import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { apiUrl, authFetch } from '../utils/api';
import { useAuth } from '../AuthContext';
import styles from './ContactPage.module.css';

const SUPPORT_EMAIL = 'support@racktrack.ai';

// Mirrors the limits the server enforces on /api/support/contact. Checking here
// too is not redundant: a technician on site should be told a 40 MB burst photo
// is too big before it is uploaded over a phone connection, not after.
const MAX_FILES       = 5;
const MAX_FILE_BYTES  = 5  * 1024 * 1024;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;

const ACCEPT = 'image/*,application/pdf,text/plain,text/csv,application/json';
const ALLOWED_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif',
  'image/heic', 'image/heif',
  'application/pdf', 'text/plain', 'text/csv', 'application/json',
]);

const prettyBytes = (n) =>
  n < 1024 ? `${n} B`
    : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB`
      : `${(n / 1024 / 1024).toFixed(1)} MB`;

// Contact support — full-bleed data-center hero + form, rendered inside the
// shell. The message is sent server-side to the support inbox with the user's
// identity + context attached (Reply-To is their email); if the server can't
// send, a mailto: fallback keeps the user unstuck.
//
// Arrived-from-DOT: the assistant's "Contact support" button navigates here with
// { context } — the question it couldn't answer — pre-filled into the message.
export default function ContactPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const fromDot = location.state?.context || '';
  const [subject, setSubject] = useState(location.state?.subject || '');
  const [message, setMessage] = useState(
    fromDot ? `I couldn't get an answer to: "${fromDot}"\n\n` : '',
  );
  const [status, setStatus] = useState('idle'); // idle | sending | sent | error
  const [error, setError] = useState(null);
  const [files, setFiles] = useState([]);       // [{ file, url? }]
  const [fileError, setFileError] = useState(null);
  const fileInput = useRef(null);

  // Object URLs for the thumbnails are a manual allocation: without the revoke
  // the blobs stay alive for the life of the tab, which on a phone is every
  // screenshot the technician ever previewed. Removal revokes its own URL, so
  // this only has to catch what is still on screen when the page unmounts —
  // hence the ref. Depending on `files` instead would revoke the URLs of the
  // surviving items every time the list changed, blanking the previews.
  const filesRef = useRef(files);
  filesRef.current = files;
  useEffect(() => () => {
    filesRef.current.forEach((f) => { if (f.url) URL.revokeObjectURL(f.url); });
  }, []);

  const email = user?.email || 'your account email';
  const canSend = message.trim().length >= 4 && status !== 'sending';

  const totalBytes = files.reduce((n, f) => n + f.file.size, 0);

  const addFiles = (picked) => {
    const incoming = Array.from(picked || []);
    if (!incoming.length) return;
    setFileError(null);

    const accepted = [];
    const rejected = [];
    let running = totalBytes;

    for (const file of incoming) {
      if (files.length + accepted.length >= MAX_FILES) {
        rejected.push(`${file.name} — at most ${MAX_FILES} files`);
        continue;
      }
      // Some Android pickers hand back an empty type for a file they cannot
      // classify; fall back to the extension rather than rejecting a valid
      // screenshot outright.
      const type = (file.type || '').toLowerCase();
      const looksAllowed = type
        ? ALLOWED_TYPES.has(type)
        : /\.(png|jpe?g|webp|gif|heic|heif|pdf|txt|csv|json|log)$/i.test(file.name);
      if (!looksAllowed) {
        rejected.push(`${file.name} — must be an image, PDF, or text file`);
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        rejected.push(`${file.name} — ${prettyBytes(file.size)}, over the ${prettyBytes(MAX_FILE_BYTES)} limit`);
        continue;
      }
      if (running + file.size > MAX_TOTAL_BYTES) {
        rejected.push(`${file.name} — would exceed the ${prettyBytes(MAX_TOTAL_BYTES)} total`);
        continue;
      }
      running += file.size;
      accepted.push({
        file,
        url: type.startsWith('image/') ? URL.createObjectURL(file) : null,
      });
    }

    if (accepted.length) setFiles((prev) => [...prev, ...accepted]);
    if (rejected.length) setFileError(rejected.join(' · '));
    // Clearing the input lets the same file be re-picked after it was removed;
    // otherwise the change event never fires for an identical selection.
    if (fileInput.current) fileInput.current.value = '';
  };

  const removeFile = (idx) => {
    setFiles((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      const gone = prev[idx];
      if (gone?.url) URL.revokeObjectURL(gone.url);
      return next;
    });
    setFileError(null);
  };

  const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
    subject || 'Support request',
  )}&body=${encodeURIComponent(message)}`;

  const submit = async (e) => {
    e.preventDefault();
    if (!canSend) return;
    setStatus('sending');
    setError(null);
    try {
      // Multipart only when there is something to attach. A plain message stays
      // on the JSON path it has always used — no reason to make every send pay
      // for a boundary-encoded body. Deliberately no Content-Type header for
      // the multipart case: the browser has to set it itself so the boundary
      // matches, and supplying one produces a body the server cannot parse.
      const hasFiles = files.length > 0;
      let body;
      const headers = {};
      if (hasFiles) {
        body = new FormData();
        body.append('subject', subject.trim());
        body.append('message', message.trim());
        body.append('context', fromDot);
        files.forEach(({ file }) => body.append('attachments', file, file.name));
      } else {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify({ subject: subject.trim(), message: message.trim(), context: fromDot });
      }

      const res = await authFetch(apiUrl('/api/support/contact'), {
        method: 'POST',
        headers,
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `Couldn't send (HTTP ${res.status}).`);
      setStatus('sent');
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  };

  // The hero used to be the same dark datacenter photo as Home, dimmed by a
  // 72% scrim. It read as heavy for the one screen a person reaches when
  // something has already gone wrong, so it is now a light indigo field with
  // the channels drawn as icons — warmer, and it loads nothing: no photo
  // request, no decode, and nothing to go stale in the cache.
  const channels = [
    {
      label: 'Email us',
      paths: [
        'M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z',
        'M22 6l-10 7L2 6',
      ],
    },
    {
      label: 'Ask DOT',
      paths: [
        'M21 11.5a8.4 8.4 0 01-8.5 8.5 8.4 8.4 0 01-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 01-.9-3.8A8.4 8.4 0 0112.5 3 8.4 8.4 0 0121 11.5z',
      ],
    },
    {
      label: 'Attach a screenshot',
      paths: [
        'M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48',
      ],
    },
    {
      label: 'Replies in hours',
      paths: ['M12 2a10 10 0 100 20 10 10 0 000-20z', 'M12 6v6l4 2'],
    },
  ];

  const Hero = (
    <section className={styles.hero}>
      <nav className={styles.nav}>
        <button className={styles.back} onClick={() => navigate(-1)} aria-label="Back">‹</button>
        <span className={styles.brand}>RackTrack</span>
      </nav>
      <div className={styles.heroTitle}>
        <div className={styles.eyebrow}>Support</div>
        <h1 className={styles.h1}>Contact us</h1>
        <p className={styles.heroSub}>
          Something not working, or not sure how it should work? Tell us what happened —
          a real person reads every message.
        </p>
        <ul className={styles.channels}>
          {channels.map((c) => (
            <li key={c.label} className={styles.channel}>
              <span className={styles.channelIcon} aria-hidden="true">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  {c.paths.map((d, i) => <path key={i} d={d} />)}
                </svg>
              </span>
              <span className={styles.channelLabel}>{c.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );

  if (status === 'sent') {
    return (
      <div className={styles.page}>
        {Hero}
        <div className={styles.wrap}>
          <div className={styles.doneCard}>
            <div className={styles.doneMark} aria-hidden="true">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
            </div>
            <h2 className={styles.doneTitle}>Message sent</h2>
            <p className={styles.doneText}>
              Thanks — the RackTrack support team has it and will reply to{' '}
              <strong>{email}</strong>.
            </p>
            <button className={styles.send} onClick={() => navigate(-1)}>Back to what I was doing</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {Hero}

      <div className={styles.wrap}>
        <div className={styles.grid}>
          <form className={styles.formCard} onSubmit={submit}>
            <label className={styles.label}>Subject <span className={styles.optional}>optional</span></label>
            <input
              className={styles.fld}
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Scan won't upload"
              maxLength={140}
            />

            <label className={`${styles.label} ${styles.labelGap}`}>Message</label>
            <textarea
              className={`${styles.fld} ${styles.textarea}`}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What happened? What were you doing when it happened? Paste any exact error text."
              maxLength={5000}
              autoFocus
            />

            <label className={`${styles.label} ${styles.labelGap}`}>
              Attachments <span className={styles.optional}>optional</span>
            </label>
            <p className={styles.attachHint}>
              A screenshot of what went wrong is the most useful thing you can send.
              Up to {MAX_FILES} images, PDFs or text files, {prettyBytes(MAX_FILE_BYTES)} each.
            </p>

            <input
              ref={fileInput}
              type="file"
              className={styles.fileInput}
              accept={ACCEPT}
              multiple
              onChange={(e) => addFiles(e.target.files)}
            />

            <button
              type="button"
              className={styles.attachBtn}
              onClick={() => fileInput.current?.click()}
              disabled={files.length >= MAX_FILES}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
              </svg>
              {files.length ? 'Add another file' : 'Attach a file'}
            </button>

            {files.length > 0 && (
              <>
                <ul className={styles.fileList}>
                  {files.map((f, i) => (
                    <li key={`${f.file.name}-${i}`} className={styles.fileItem}>
                      {f.url ? (
                        <img src={f.url} alt="" className={styles.thumb} />
                      ) : (
                        <span className={styles.thumbDoc} aria-hidden="true">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
                          </svg>
                        </span>
                      )}
                      <span className={styles.fileMeta}>
                        <span className={styles.fileName}>{f.file.name}</span>
                        <span className={styles.fileSize}>{prettyBytes(f.file.size)}</span>
                      </span>
                      <button
                        type="button"
                        className={styles.fileRemove}
                        onClick={() => removeFile(i)}
                        aria-label={`Remove ${f.file.name}`}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
                <div className={styles.fileTotal}>
                  {files.length} of {MAX_FILES} · {prettyBytes(totalBytes)} of {prettyBytes(MAX_TOTAL_BYTES)}
                </div>
              </>
            )}

            {fileError && <div className={styles.fileWarn}>{fileError}</div>}

            {error && (
              <div className={styles.errorBox}>
                {error}{' '}
                <a href={mailto} className={styles.link}>Email us directly →</a>
              </div>
            )}

            <button type="submit" className={styles.send} disabled={!canSend}>
              {status === 'sending' ? 'Sending…' : 'Send message →'}
            </button>
          </form>

          {/* Desktop/iPad: support details rail */}
          <aside className={styles.aside}>
            <div className={styles.infoCard}>
              <div className={styles.k}>Email</div>
              <a className={styles.v} href={mailto}>{SUPPORT_EMAIL}</a>
              <div className={styles.m}>Replies within a few hours</div>
            </div>
          </aside>
        </div>

        {/* Mobile: compact email card */}
        <a className={styles.emailCard} href={mailto}>
          <div>
            <div className={styles.k}>Prefer email?</div>
            <div className={styles.v}>{SUPPORT_EMAIL}</div>
          </div>
          <span aria-hidden="true">›</span>
        </a>
      </div>
    </div>
  );
}
