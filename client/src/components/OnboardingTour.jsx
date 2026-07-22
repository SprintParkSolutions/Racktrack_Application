import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';
import useModalA11y from '../hooks/useModalA11y.js';
import { getItem, setItem } from '../utils/safeStorage';

// First-run walkthrough. Shows once per device for a signed-in user, then
// never again (localStorage flag). Purely additive — it overlays the app and
// dismisses to the scan screen. Skippable at every step.

const KEY = 'racktrack:onboarded';

const STEPS = [
  {
    art: 'logo',
    title: 'Welcome to RackTrack',
    body: 'Turn a photo of a server rack into a full, labelled map of what’s inside — in seconds.',
  },
  {
    art: 'scan',
    title: '1 · Scan a rack',
    body: 'Point your camera at the rack (or upload a photo or short video) and tap Scan. RackTrack finds every device for you.',
  },
  {
    art: 'review',
    title: '2 · Review the results',
    body: 'See each device, where it sits in the rack, and its details. Tap any item to dig deeper or fix a label.',
  },
  {
    art: 'ports',
    title: '3 · Check the ports',
    body: 'Open the Ports tab to see the switch live — which ports are free, which are connected, and what’s plugged in.',
  },
];

function Art({ kind }) {
  if (kind === 'logo') {
    return <img src="/logo.jpg" alt="" width="72" height="72" style={{ borderRadius: 18 }} />;
  }
  const common = { width: 40, height: 40, fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (kind === 'scan') return (
    <svg viewBox="0 0 24 24" {...common}><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><rect x="8" y="8" width="8" height="8" rx="1.5"/></svg>
  );
  if (kind === 'review') return (
    <svg viewBox="0 0 24 24" {...common}><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="14" x2="21" y2="14"/><line x1="8" y1="4" x2="8" y2="20"/></svg>
  );
  return (
    <svg viewBox="0 0 24 24" {...common}><path d="M9 7V4M15 7V4M8 7h8v4a4 4 0 0 1-8 0z"/><line x1="12" y1="15" x2="12" y2="21"/></svg>
  );
}

export default function OnboardingTour() {
  const { isAuthed } = useAuth();
  const navigate = useNavigate();
  const [i, setI] = useState(0);
  const [done, setDone] = useState(() => {
    try { return getItem(KEY) === '1'; } catch { return false; }
  });

  const finish = (goScan) => {
    try { setItem(KEY, '1'); } catch (_) {}
    setDone(true);
    if (goScan) navigate('/scan');
  };

  // Escape skips the tour — same as the Skip button — and Tab stays inside
  // the card while it is up. Hook must run before the early return.
  const open = !done && isAuthed;
  const cardRef = useModalA11y(() => finish(false), { active: open });

  if (!open) return null;

  const last = i === STEPS.length - 1;
  const step = STEPS[i];

  return (
    <div className="rtob-backdrop">
      <div ref={cardRef} className="rtob-card"
           role="dialog" aria-modal="true" aria-labelledby="rtob-title">
        <button className="rtob-skip" onClick={() => finish(false)}>Skip</button>

        <div className="rtob-art"><Art kind={step.art} /></div>
        <h2 id="rtob-title" className="rtob-title">{step.title}</h2>
        <p className="rtob-body">{step.body}</p>

        <div className="rtob-dots" aria-hidden="true">
          {STEPS.map((_, k) => <span key={k} className={`rtob-dot ${k === i ? 'on' : ''}`} />)}
        </div>

        <div className="rtob-actions">
          {i > 0 && <button className="rtob-btn ghost" onClick={() => setI(i - 1)}>Back</button>}
          {!last
            ? <button className="rtob-btn primary" onClick={() => setI(i + 1)}>Next</button>
            : <button className="rtob-btn primary" onClick={() => finish(true)}>Start scanning</button>}
        </div>
      </div>

      <style>{`
        .rtob-backdrop{position:fixed; inset:0; z-index:10000; display:flex; align-items:center; justify-content:center;
          padding:max(22px, env(safe-area-inset-top)) max(22px, env(safe-area-inset-right)) max(22px, env(safe-area-inset-bottom)) max(22px, env(safe-area-inset-left));
          background:rgba(8,11,18,.7); backdrop-filter:blur(6px);}
        .rtob-card{position:relative; width:100%; max-width:380px; border-radius:22px; padding:34px 26px 24px;
          background:#ffffff; color:#0f1826; box-shadow:0 24px 60px rgba(0,0,0,.34); text-align:center;
          animation:rtob-in .28s cubic-bezier(.2,.7,.3,1);}
        @keyframes rtob-in{from{opacity:0; transform:translateY(14px) scale(.98)} to{opacity:1; transform:none}}
        .rtob-skip{position:absolute; top:14px; right:16px; background:none; border:none; color:#6b7688;
          font-size:14px; font-weight:600; cursor:pointer; padding:6px;}
        .rtob-art{width:78px; height:78px; margin:6px auto 18px; border-radius:20px; display:flex; align-items:center;
          justify-content:center; background:#eef2fb; color:#2b6fed;}
        .rtob-title{margin:0 0 10px; font-size:21px; font-weight:750; letter-spacing:-.02em; text-wrap:balance;}
        .rtob-body{margin:0 auto; max-width:30ch; color:#4a5876; font-size:15px; line-height:1.55;}
        .rtob-dots{display:flex; gap:7px; justify-content:center; margin:22px 0 20px;}
        .rtob-dot{width:7px; height:7px; border-radius:50%; background:#d3dae7; transition:all .2s;}
        .rtob-dot.on{background:#2b6fed; width:22px; border-radius:4px;}
        .rtob-actions{display:flex; gap:10px; justify-content:center;}
        .rtob-btn{flex:1; padding:13px 18px; border-radius:13px; font-size:15px; font-weight:700; cursor:pointer; border:1px solid transparent;}
        .rtob-btn.primary{background:#2b6fed; color:#fff;}
        .rtob-btn.primary:active{transform:translateY(1px);}
        .rtob-btn.ghost{background:transparent; color:#4a5876; border-color:#d9e0ec; flex:0 0 auto; padding-left:20px; padding-right:20px;}
        @media (prefers-color-scheme:dark){
          .rtob-card{background:#141b28; color:#eef3fb; box-shadow:0 24px 60px rgba(0,0,0,.6);}
          .rtob-skip{color:#9db0cd;}
          .rtob-art{background:#1b2740; color:#6aa4ff;}
          .rtob-body{color:#9db0cd;}
          .rtob-dot{background:#2c384c;} .rtob-dot.on{background:#6aa4ff;}
          .rtob-btn.primary{background:#2b6fed;}
          .rtob-btn.ghost{color:#9db0cd; border-color:#2c384c;}
        }
      `}</style>
    </div>
  );
}
