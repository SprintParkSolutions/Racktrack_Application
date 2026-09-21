import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiUrl, authFetch } from '../utils/api';
import { validateMedia } from '../utils/validateMedia';
import { IMAGE_ACCEPT, VIDEO_ACCEPT } from '../utils/mediaAccept';
import SitePicker from '../components/SitePicker.jsx';
import { useScanSite, SITE_REFUSED, isSiteRefused } from '../hooks/useScanSite';
import styles from './MultiRackNewPage.module.css';
import PageHeader from '../components/PageHeader.jsx';

// Analyze one image → returns its rackId (throws on failure). The chosen Site
// goes with it exactly as it does from the scan page, so both racks are
// matched inside that Site.
async function analyzeImage(file, siteId) {
  const fd = new FormData();
  fd.append('image', file);
  if (siteId) fd.append('siteId', siteId);
  const res = await authFetch(apiUrl('/api/analyze'), { method: 'POST', body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = isSiteRefused(res, data) ? SITE_REFUSED
      : (data.error || 'Could not analyze that photo. Try again.');
    const err = new Error(msg);
    err.kind = data.kind;   // e.g. 'not_a_rack'
    throw err;
  }
  if (!data.rackId) throw new Error('No rack detected in that image.');
  return data.rackId;
}

function ImageSlot({ index, file, onPick, disabled }) {
  // Two inputs, not one. The single `accept="image/*"` input opened the gallery
  // on Android, so testers reported there was no way to photograph the racks - // the feature looked upload-only. `capture="environment"` opens the rear
  // camera directly; the plain input keeps the gallery available for people
  // who already have the photos.
  const inputRef = useRef(null);
  const url = file ? URL.createObjectURL(file) : null;
  const take = (e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ''; };
  // One tap on the container. No `capture` attribute → the phone shows its
  // native chooser (Take Photo / Photo Library); desktop opens the file picker.
  const open = () => { if (!disabled) inputRef.current?.click(); };

  return (
    <div className={styles.slot}>
      <div className={styles.slotLabel}>Rack {index + 1}</div>

      <button
        type="button"
        className={`${styles.dropZone} ${file ? styles.dropZoneFilled : ''}`}
        onClick={open}
        disabled={disabled}
        aria-label={file ? `Replace Rack ${index + 1} photo` : `Add Rack ${index + 1} photo`}
      >
        {url ? (
          <img src={url} alt={`Rack ${index + 1}`} className={styles.thumb} />
        ) : (
          <div className={styles.placeholder}>
            <span className={styles.iconWrap} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                   strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2" />
                <circle cx="12" cy="12" r="3.2" />
              </svg>
            </span>
            <span className={styles.dropTitle}>Add a photo</span>
            <span className={styles.pickHint}>Tap to take a photo or pick from your gallery</span>
            {/* No format pills: a phone camera roll cannot hand the app a format it
                refuses, so naming five of them only filled the frame. */}
          </div>
        )}
      </button>

      <input ref={inputRef} type="file" accept={IMAGE_ACCEPT} hidden onChange={take} />
    </div>
  );
}

export default function MultiRackNewPage() {
  const navigate = useNavigate();
  const [mode,   setMode]   = useState('images');       // 'images' | 'video'
  const [images, setImages] = useState([null, null]);   // two rack photos
  const [video,  setVideo]  = useState(null);
  const [busy,   setBusy]   = useState(false);
  const [step,   setStep]   = useState('');
  const [error,  setError]  = useState(null);
  const videoInputRef = useRef(null);
  // The same Site list, remembered choice and picker as the scan page - a
  // pair of racks is scanned for a Site like any other.
  const { sites, siteId, chooseSite: rememberSite, needsSite } = useScanSite();
  const chooseSite = (id) => { rememberSite(id); setError(null); };

  // Two-rack uploads ran no quality check at all. A single-rack upload goes
  // through validateMedia() in ScanPage before analysis - blur, size, and the
  // unsupported-type guard - so a photo too soft to read was caught there and
  // waved straight through here. Same check, same wording, on both paths now.
  //
  // It runs when the photo is PICKED rather than at build time, because two
  // images are chosen before anything is submitted: telling someone the first
  // photo was blurry while they are choosing the second is far more useful than
  // failing the whole pair at the end. A retryable verdict is reported the same
  // way as a hard one here - this page has one error line and no override
  // affordance, and inventing a "use it anyway" path for two-rack that
  // single-rack gates differently is not something to slip in silently.
  const setImage = useCallback(async (i, f) => {
    setError(null);
    if (f) {
      const check = await validateMedia(f);
      if (!check.ok) {
        setError(`Rack ${i === 0 ? 'A' : 'B'}: ${check.error}`);
        return;
      }
    }
    setImages(prev => { const next = prev.slice(); next[i] = f; return next; });
  }, []);

  const canBuildImages = images[0] && images[1] && !needsSite;

  const buildFromImages = async () => {
    if (needsSite) return;
    setBusy(true); setError(null);
    try {
      setStep('Analyzing rack 1…');
      const id1 = await analyzeImage(images[0], siteId);
      setStep('Analyzing rack 2…');
      const id2 = await analyzeImage(images[1], siteId);
      if (id1 === id2) {
        throw new Error('Both photos show the same rack. Photograph two different racks.');
      }
      setStep('Linking the two racks…');
      const gRes = await authFetch(apiUrl('/api/rack-groups'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rackIds: [id1, id2] }),
      });
      const gJson = await gRes.json().catch(() => ({}));
      if (!gRes.ok || !gJson.groupId) throw new Error(gJson.error || 'Could not link the racks.');
      setStep('Opening results…');
      // Land on the Overview of the first rack WITH the ?group signal so it
      // renders both racks side by side. (Without the signal, a rack always
      // shows as a single report - see useGroupView.)
      navigate(`/results/${encodeURIComponent(id1)}?group=${encodeURIComponent(gJson.groupId)}`, { replace: true });
    } catch (err) {
      setError(err.kind === 'not_a_rack'
        ? "One of the photos doesn't look like a server rack. Point the camera at the front of a rack."
        : err.message);
      setBusy(false); setStep('');
    }
  };

  const buildFromVideo = async () => {
    if (!video || needsSite) return;
    setBusy(true); setError(null);
    try {
      setStep('Detecting racks in the video…');
      const fd = new FormData();
      fd.append('video', video);
      if (siteId) fd.append('siteId', siteId);
      const res = await authFetch(apiUrl('/api/analyze-video'), { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (isSiteRefused(res, data)) throw new Error(SITE_REFUSED);
      if (!res.ok || !data.groupId) throw new Error(data.error || 'Could not process the video.');
      if ((data.count || 0) < 2) {
        // Fewer than two, so it is one or none. Saying "only one" when the video
        // showed none would be the shorter line and the wrong one.
        throw new Error(data.count === 1
          ? 'Only one rack in that video. Pan across both and record again.'
          : 'No rack in that video. Pan across both racks and record again.');
      }
      setStep('Opening results…');
      const firstRack = data.racks?.[0]?.rackId;
      const g = encodeURIComponent(data.groupId);
      navigate(firstRack ? `/results/${encodeURIComponent(firstRack)}?group=${g}`
                         : `/multi-rack/${g}/topology`, { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false); setStep('');
    }
  };

  return (
    <div className={styles.page}>
      <PageHeader title="Scan two racks" back={() => navigate(-1)} sticky />

      <main className={styles.body}>
        <p className={styles.intro}>
          Both racks side by side, with the cabling between them.
        </p>

        {/* Drawn only when the server has Sites to offer: a line for one, a
            search for several. The picker locks with the page while it works. */}
        <SitePicker sites={sites} value={siteId} onChange={busy ? undefined : chooseSite} />

        <div className={styles.eyebrow}>Capture mode</div>
        <div className={styles.modeToggle}>
          <button
            className={`${styles.modeBtn} ${mode === 'images' ? styles.modeBtnOn : ''}`}
            onClick={() => { setMode('images'); setError(null); }}
            disabled={busy}
          >Two photos</button>
          <button
            className={`${styles.modeBtn} ${mode === 'video' ? styles.modeBtnOn : ''}`}
            onClick={() => { setMode('video'); setError(null); }}
            disabled={busy}
          >One video</button>
        </div>

        {mode === 'images' ? (
          <>
            <div className={styles.eyebrow}>Rack photos</div>
            <div className={styles.slots}>
              <ImageSlot index={0} file={images[0]} onPick={(f) => setImage(0, f)} disabled={busy} />
              <ImageSlot index={1} file={images[1]} onPick={(f) => setImage(1, f)} disabled={busy} />
            </div>
            {needsSite && <p className={styles.siteHint}>Choose the site first.</p>}
            <button
              className={styles.primaryBtn}
              onClick={buildFromImages}
              disabled={!canBuildImages || busy}
            >
              {busy ? (step || 'Working…') : 'Build combined view'}
            </button>
          </>
        ) : (
          <>
            <div className={styles.eyebrow}>Rack video</div>
            <button
              type="button"
              className={`${styles.videoZone} ${video ? styles.videoZoneFilled : ''}`}
              onClick={() => !busy && videoInputRef.current?.click()}
              disabled={busy}
            >
              {video
                ? <span className={styles.videoName}>🎬 {video.name}</span>
                : <span className={styles.placeholder}>
                    <span className={styles.iconWrap} aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                           strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="6" width="14" height="12" rx="2" />
                        <path d="M22 8l-6 4 6 4z" />
                      </svg>
                    </span>
                    <span className={styles.dropTitle}>Add a rack video</span>
                    <span className={styles.pickHint}>Pan across both racks · or tap to browse</span>
                    <span className={styles.fmtPills} aria-hidden="true">
                      <span className={styles.fmtPill}>MP4</span>
                      <span className={styles.fmtPill}>MOV</span>
                      <span className={styles.fmtPill}>WEBM</span>
                    </span>
                  </span>}
            </button>
            <input
              ref={videoInputRef}
              type="file"
              accept={VIDEO_ACCEPT}
              hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) { setVideo(f); setError(null); } e.target.value = ''; }}
            />
            {needsSite && <p className={styles.siteHint}>Choose the site first.</p>}
            <button
              className={styles.primaryBtn}
              onClick={buildFromVideo}
              disabled={!video || needsSite || busy}
            >
              {busy ? (step || 'Working…') : 'Build combined view'}
            </button>
          </>
        )}

        {busy && step && <div className={styles.progress}><span className={styles.spinner} />{step}</div>}
        {error && <div className={styles.error}>{error}</div>}
      </main>
    </div>
  );
}
