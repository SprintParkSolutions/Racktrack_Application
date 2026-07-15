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
  const inputRef = useRef(null);
  const url = file ? URL.createObjectURL(file) : null;
  return (
    <div className={styles.slot}>
      <div className={styles.slotLabel}>Rack {index + 1}</div>
      <button
        type="button"
        className={`${styles.dropZone} ${file ? styles.dropZoneFilled : ''}`}
        onClick={() => !disabled && inputRef.current?.click()}
        disabled={disabled}
      >
        {url ? (
          <img src={url} alt={`Rack ${index + 1}`} className={styles.thumb} />
        ) : (
          <div className={styles.placeholder}>
            <span className={styles.plus}>+</span>
            <span className={styles.pickHint}>Tap to add photo</span>
          </div>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,image/heic,image/heif,.heic,.heif"
        hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ''; }}
      />
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
      // Land on the normal Overview of the first rack; it renders BOTH racks
      // side by side because they're in a group.
      navigate(`/results/${encodeURIComponent(id1)}`, { replace: true });
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
      navigate(firstRack ? `/results/${encodeURIComponent(firstRack)}`
                         : `/multi-rack/${encodeURIComponent(data.groupId)}/topology`, { replace: true });
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
            <button
              type="button"
              className={`${styles.videoZone} ${video ? styles.videoZoneFilled : ''}`}
              onClick={() => !busy && videoInputRef.current?.click()}
              disabled={busy}
            >
              {video
                ? <span className={styles.videoName}>🎬 {video.name}</span>
                : <span className={styles.placeholder}>
                    <span className={styles.plus}>+</span>
                    <span className={styles.pickHint}>Tap to add a video panning across both racks</span>
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
