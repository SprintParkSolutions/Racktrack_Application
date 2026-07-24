import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiUrl, authFetch } from '../utils/api';
import styles from './MultiRackNewPage.module.css';

// Analyze one image → returns its rackId (throws on failure).
async function analyzeImage(file) {
  const fd = new FormData();
  fd.append('image', file);
  const res = await authFetch(apiUrl('/api/analyze'), { method: 'POST', body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error || `Analysis failed (HTTP ${res.status})`;
    const err = new Error(msg);
    err.kind = data.kind;   // e.g. 'not_a_rack'
    throw err;
  }
  if (!data.rackId) throw new Error('No rack detected in that image.');
  return data.rackId;
}

function ImageSlot({ index, file, onPick, disabled }) {
  // Two inputs, not one. The single `accept="image/*"` input opened the gallery
  // on Android, so testers reported there was no way to photograph the racks —
  // the feature looked upload-only. `capture="environment"` opens the rear
  // camera directly; the plain input keeps the gallery available for people
  // who already have the photos.
  const cameraRef = useRef(null);
  const galleryRef = useRef(null);
  const url = file ? URL.createObjectURL(file) : null;
  const ACCEPT = 'image/*,image/heic,image/heif,.heic,.heif';
  const take = (e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ''; };

  return (
    <div className={styles.slot}>
      <div className={styles.slotLabel}>Rack {index + 1}</div>

      <div className={`${styles.dropZone} ${file ? styles.dropZoneFilled : ''}`}>
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
            <span className={styles.pickHint}>Camera or gallery below</span>
            <span className={styles.fmtPills} aria-hidden="true">
              <span className={styles.fmtPill}>JPG</span>
              <span className={styles.fmtPill}>PNG</span>
              <span className={styles.fmtPill}>HEIC</span>
            </span>
          </div>
        )}
      </div>

      <div className={styles.slotActions}>
        <button
          type="button"
          className={`${styles.slotBtn} ${styles.slotBtnPrimary}`}
          onClick={() => !disabled && cameraRef.current?.click()}
          disabled={disabled}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
          {file ? 'Retake' : 'Camera'}
        </button>
        <button
          type="button"
          className={styles.slotBtn}
          onClick={() => !disabled && galleryRef.current?.click()}
          disabled={disabled}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
          {file ? 'Replace' : 'Gallery'}
        </button>
      </div>

      <input ref={cameraRef} type="file" accept={ACCEPT} capture="environment" hidden onChange={take} />
      <input ref={galleryRef} type="file" accept={ACCEPT} hidden onChange={take} />
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

  const setImage = useCallback((i, f) => {
    setError(null);
    setImages(prev => { const next = prev.slice(); next[i] = f; return next; });
  }, []);

  const canBuildImages = images[0] && images[1];

  const buildFromImages = async () => {
    setBusy(true); setError(null);
    try {
      setStep('Analyzing rack 1…');
      const id1 = await analyzeImage(images[0]);
      setStep('Analyzing rack 2…');
      const id2 = await analyzeImage(images[1]);
      if (id1 === id2) {
        throw new Error('Both photos resolved to the same rack — use two different racks.');
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
      // shows as a single report — see useGroupView.)
      navigate(`/results/${encodeURIComponent(id1)}?group=${encodeURIComponent(gJson.groupId)}`, { replace: true });
    } catch (err) {
      setError(err.kind === 'not_a_rack'
        ? "One of the photos doesn't look like a server rack. Point the camera at the front of a rack."
        : err.message);
      setBusy(false); setStep('');
    }
  };

  const buildFromVideo = async () => {
    if (!video) return;
    setBusy(true); setError(null);
    try {
      setStep('Detecting racks in the video…');
      const fd = new FormData();
      fd.append('video', video);
      const res = await authFetch(apiUrl('/api/analyze-video'), { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.groupId) throw new Error(data.error || 'Could not process the video.');
      if ((data.count || 0) < 2) {
        throw new Error(`Only ${data.count || 0} rack detected — pan across both racks so each is clearly visible.`);
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
      <header className={styles.header}>
        <button className={styles.back} onClick={() => navigate(-1)} aria-label="Back">←</button>
        <h1 className={styles.title}>Scan two racks</h1>
        <span aria-hidden="true" />
      </header>

      <main className={styles.body}>
        <p className={styles.intro}>
          Capture two racks and we'll detect each one, then show them side by side
          with the uplink cabling that runs <b>between</b> them.
        </p>

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
              accept="video/*,.mp4,.mov,.webm"
              hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) { setVideo(f); setError(null); } e.target.value = ''; }}
            />
            <button
              className={styles.primaryBtn}
              onClick={buildFromVideo}
              disabled={!video || busy}
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
