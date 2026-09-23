import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { apiUrl, authFetch } from '../utils/api';
import { useAuth } from '../AuthContext';
import Icon from '../components/Icon.jsx';
import PageHeader from '../components/PageHeader.jsx';
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

// The four trust signals that used to sit here are gone. The person reading this
// screen is already signed in and already on the support form - they are not being
// sold the product - and one of the four ("Replies within a few hours") was said
// again in the rail beside it.

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
  // the blobs stay alive for the life of the tab. Removal revokes its own URL,
  // so this only has to catch what is still on screen when the page unmounts - // hence the ref. Depending on `files` would revoke the URLs of the surviving
  // items every time the list changed, blanking the previews.
  const filesRef = useRef(files);
  filesRef.current = files;
  useEffect(() => () => {
    filesRef.current.forEach((f) => { if (f.url) URL.revokeObjectURL(f.url); });
  }, []);

  const email = user?.email || 'your account email';
  const canSend = message.trim().length >= 4 && status !== 'sending';
  const totalBytes = files.reduce((n, f) => n + f.file.size, 0);

  const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
    subject || 'Support request',
  )}&body=${encodeURIComponent(message)}`;

  const addFiles = (picked) => {
    const incoming = Array.from(picked || []);
    if (!incoming.length) return;
    setFileError(null);

    const accepted = [];
    const rejected = [];
    let running = totalBytes;

    for (const file of incoming) {
      if (files.length + accepted.length >= MAX_FILES) {
        rejected.push(`${file.name} - at most ${MAX_FILES} files`);
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
        rejected.push(`${file.name} - must be an image, PDF, or text file`);
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        rejected.push(`${file.name} - ${prettyBytes(file.size)}, over the ${prettyBytes(MAX_FILE_BYTES)} limit`);
        continue;
      }
      if (running + file.size > MAX_TOTAL_BYTES) {
        rejected.push(`${file.name} - would exceed the ${prettyBytes(MAX_TOTAL_BYTES)} total`);
        continue;
      }
      running += file.size;
      accepted.push({ file, url: type.startsWith('image/') ? URL.createObjectURL(file) : null });
    }

    if (accepted.length) setFiles((prev) => [...prev, ...accepted]);
    if (rejected.length) setFileError(rejected.join(' · '));
    // Clearing the input lets the same file be re-picked after it was removed;
    // otherwise the change event never fires for an identical selection.
    if (fileInput.current) fileInput.current.value = '';
  };

  const removeFile = (idx) => {
    setFiles((prev) => {
      const gone = prev[idx];
      if (gone?.url) URL.revokeObjectURL(gone.url);
      return prev.filter((_, i) => i !== idx);
    });
    setFileError(null);
  };


  const submit = async (e) => {
    e.preventDefault();
    if (!canSend) return;
    setStatus('sending');
    setError(null);
    try {
      // Multipart only when there is something to attach. A plain message stays
      // on the JSON path it has always used. Deliberately no Content-Type header
      // for the multipart case: the browser has to set it itself so the boundary
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

      const res = await authFetch(apiUrl('/api/support/contact'), { method: 'POST', headers, body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `Couldn't send (HTTP ${res.status}).`);
      setStatus('sent');
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  };

  /* The head of the page is the app's own bar, like every other screen.
     It was a landing page: a text "Back" link, a purple SUPPORT eyebrow, a
     display-size title and a black-and-white stock photograph of somebody
     else's cabinets, and then the form. The owner called it the worst screen
     in the app on 23 September 2026. None of that told a person anything a
     support form needs, and none of it looked like the rest of the product. */
  const Intro = (
    <PageHeader
      title="Contact support"
      sub="We reply within a few hours."
      back={() => navigate(-1)}
    />
  );

  if (status === 'sent') {
    return (
      <div className={styles.page}>
        {Intro}
        <div className={styles.wrap}>
          <div className={`${styles.block} ${styles.done}`}>
            <span className={styles.doneMark} aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
            </span>
            <div>
              <h2 className={styles.doneH}>Message sent</h2>
              <p className={styles.doneP}>We will reply to <strong>{email}</strong>.</p>
              <button className={styles.secondary} onClick={() => navigate(-1)}>
                Back
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {Intro}

      <div className={styles.wrap}>
        <div className={styles.cols}>
          {/* ── The two fast ways first. Most questions are answered by DOT
              in the time it takes to type a subject line, and an email is
              one press; the form is for what those cannot do. They stood
              under the form, where a person reached them after writing a
              message they might not have needed to (23 September 2026). */}
          <nav className={styles.ways} aria-label="Other ways to reach us">
            <button type="button" className={styles.way} onClick={() => navigate('/help')}>
              <span className={styles.wayGlyph} aria-hidden="true"><Icon name="chat" /></span>
              <span className={styles.wayText}>
                <span className={styles.wayName}>Ask DOT</span>
                <span className={styles.waySub}>Answers now, from the documentation</span>
              </span>
            </button>
            <a className={styles.way} href={mailto}>
              <span className={styles.wayGlyph} aria-hidden="true"><Icon name="mail" /></span>
              <span className={styles.wayText}>
                <span className={styles.wayName}>Email us</span>
                <span className={styles.waySub}>{SUPPORT_EMAIL}</span>
              </span>
            </a>
          </nav>
          {/* ── Form ── */}
          <form className={`${styles.block} ${styles.form}`} onSubmit={submit} noValidate>
            <h2 className={styles.blockH}>Send us a message</h2>
            {/* The message box's own placeholder already asks for what happened, what
                they were doing and any error message. */}

            <div className={styles.field}>
              <label className={styles.label} htmlFor="ct-subject">
                Subject
              </label>
              <input
                id="ct-subject"
                className={styles.input}
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g. Scan won't upload"
                maxLength={140}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="ct-message">Message <span className={styles.req} aria-hidden="true">*</span></label>
              <textarea
                id="ct-message"
                className={`${styles.input} ${styles.textarea}`}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="What happened? What were you doing when it happened? Include any error message or relevant details."
                maxLength={5000}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="contact-attachments">
                Attachments
              </label>

              <input
                id="contact-attachments"
                ref={fileInput}
                type="file"
                className={styles.fileInput}
                accept={ACCEPT}
                multiple
                onChange={(e) => addFiles(e.target.files)}
              />

              {/* Drop target and picker in one. A button rather than a label so
                  the keyboard path is the same as the pointer path. */}
              <button
                type="button"
                className={styles.attach}
                onClick={() => fileInput.current?.click()}
                disabled={files.length >= MAX_FILES}
              >
                <Icon name="paperclip" />
                {files.length >= MAX_FILES
                  ? `${MAX_FILES} files is the most`
                  : files.length ? 'Attach another file' : 'Attach a screenshot or a file'}
              </button>

              {files.length > 0 && (
                <ul className={styles.fileList}>
                  {files.map((f, i) => (
                    <li key={`${f.file.name}-${i}`} className={styles.fileRow}>
                      {f.url
                        ? <img src={f.url} alt="" className={styles.thumb} />
                        : <span className={styles.thumbDoc} aria-hidden="true"><Icon name="book" /></span>}
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
                        <Icon name="close" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {files.length > 0 && (
                <div className={styles.fileTotal}>
                  {files.length} of {MAX_FILES} · {prettyBytes(totalBytes)} of {prettyBytes(MAX_TOTAL_BYTES)}
                </div>
              )}

              {fileError && <p className={styles.fileWarn}>{fileError}</p>}
            </div>

            {status === 'error' && (
              <div className={styles.errorBox} role="alert">
                <strong className={styles.errorH}>We couldn&rsquo;t send your message.</strong>
                <span className={styles.errorP}>
                  {error} Please try again, or email{' '}
                  <a href={mailto} className={styles.link}>{SUPPORT_EMAIL}</a>.
                </span>
              </div>
            )}

            <div className={styles.actions}>
              <button type="submit" className={styles.send} disabled={!canSend}>
                {status === 'sending' ? 'Sending' : 'Send message'}
              </button>
            </div>
          </form>

        </div>
      </div>

    </div>
  );
}

// Privacy / Terms / Security belong here, but this build has no route for any
// of them and no marketing-site URL to point at - every candidate path 404s.
// Dead links on the page a customer reaches when they already distrust
// something cost more than the missing row does, so the footer carries the
// notice only. Fill these in and the nav below renders itself:
//
//   const LEGAL = [
//     { label: 'Privacy',  href: 'https://racktrack.ai/privacy'  },
//     { label: 'Terms',    href: 'https://racktrack.ai/terms'    },
//     { label: 'Security', href: 'https://racktrack.ai/security' },
//   ];
const LEGAL = [];
