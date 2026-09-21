import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';
import { useHasSidebar } from '../hooks/useIsDesktop';
import useModalA11y from '../hooks/useModalA11y';
import { useOrgSettings } from '../hooks/useOrgSettings';
import { STEPS, STEP_KEYS, stepOf, stepLocked, firstIncompleteStep } from '../utils/orgSettings';
import { setupDecision } from '../utils/setupGuard';
import BackButton from '../components/BackButton.jsx';
import { Act, SaveMark, Err } from '../components/orgsettings/Fields.jsx';
import { OrgSection, SitesSection, RulesSection, ReviewSection, DoneSection } from '../components/orgsettings/SectionsEstate.jsx';
import '../components/orgsettings/sections.css';
import styles from './SetupPage.module.css';

/**
 * Organization settings.
 *
 * One way in and one shape: a popup container over the app that shows one
 * step at a time, with a Back and a Next button and nothing else to navigate
 * by. It is the same container whether the route gate sent an admin here
 * because the organization still lacks a mandatory item, or the person opened
 * Profile > Organization settings to change something later. The last step
 * thanks them and closes.
 *
 * Everything saves as it goes, through hooks/useOrgSettings; the steps and
 * what counts as done live in utils/orgSettings. On a phone the container
 * fills the screen; on a laptop it is a card over a dimmed backdrop.
 */

const SECTION = { org: OrgSection, sites: SitesSection, rules: RulesSection, review: ReviewSection, done: DoneSection };

/* The latest save mark for a step, across its per-site keys. The account a
   SPOC is given says its own failure beside its button, so it is not here. */
function markFor(marks, key) {
  const extra = { sites: ['datacentres', 'facility:', 'contacts:', 'people:'] }[key] || [];
  const keys = Object.keys(marks).filter((k) => k === key || k.startsWith(`${key}:`) || extra.some((p) => k.startsWith(p)));
  return keys.map((k) => marks[k]).sort((a, b) => b.at - a.at)[0] || null;
}

/* Whether the markup under `ref` holds a mandatory control, read after each
   render, so the "* Required" legend is shown exactly where an asterisk is.
   No dependency list on purpose: the answer depends on what a section
   rendered, not on a prop. The functional update returns the same value
   when nothing changed, so React does not re-render and there is no loop. */
function useHasStars(ref) {
  const [has, setHas] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const next = !!ref.current?.querySelector('[aria-required="true"]');
    setHas((h) => (h === next ? h : next));
  });
  return has;
}

export default function SetupPage() {
  const { user, refreshUser, logout } = useAuth();
  const navigate = useNavigate();
  const hasSidebar = useHasSidebar();
  const s = useOrgSettings();
  const [sp] = useSearchParams();
  const gated = setupDecision(user) === 'setup';

  /* Which step the container opens on is decided once, when the model
     arrives: the step the link asked for, else the first one that still has
     mandatory work. Decided once, so a save never moves the page out from
     under the person making it. */
  const [step, setStep] = useState(null);
  useEffect(() => {
    if (step !== null || s.loading) return;
    const asked = sp.get('step');
    setStep(STEP_KEYS.includes(asked) ? asked : firstIncompleteStep(s.model));
  }, [s.loading, step, sp, s.model]);

  /* Closing goes back to where the row that opens this lives. An admin the
     gate sent here has nothing to go back to, so that container offers a
     sign out instead. */
  const close = useCallback(() => { navigate('/profile'); }, [navigate]);
  const finish = useCallback(async () => {
    await refreshUser();
    navigate(gated ? '/scan' : '/profile', { replace: true });
  }, [refreshUser, navigate, gated]);
  const signOut = useCallback(() => { logout(); navigate('/login'); }, [logout, navigate]);

  return (
    <div className={styles.page}>
      {!hasSidebar && (
        <header className={styles.topbar}>
          <div className={styles.topbarLeft}>
            <BackButton fallback="/profile" always />
            <h1 className={styles.topbarT}>Organization settings</h1>
          </div>
        </header>
      )}
      {step
        ? <FlowModal s={s} step={step} setStep={setStep} gated={gated} onClose={close} onFinish={finish} onSignOut={signOut} />
        : <p className={styles.wait}>Loading</p>}
    </div>
  );
}

/* ---- The container: one step at a time ---------------------------------- */
/* The one line at the top of a step when Next was pressed before the
   step's mandatory work was done. The fields carry their own messages. */
const STOP = {
  org: 'Complete the marked fields to continue.',
  sites: 'Complete the marked fields and give each site\'s SPOC an account to continue.',
  rules: 'Accept to continue.',
  review: 'Finish the steps above to continue.',
};
function FlowModal({ s, step, setStep, gated, onClose, onFinish, onSignOut }) {
  const def = stepOf(step) || STEPS[0];
  const i = STEP_KEYS.indexOf(def.key);
  const [validity, setValidity] = useState({});
  const [showAll, setShowAll] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const bodyRef = useRef(null);
  const titleRef = useRef(null);
  const ref = useModalA11y(gated ? () => {} : onClose);
  const stars = useHasStars(bodyRef);
  /* Focus lands on the step title, so a screen reader announces the step
     and no control wears a focus ring before anyone has touched it. Layout
     effect, so it runs before the a11y hook looks for something to focus. */
  useLayoutEffect(() => { titleRef.current?.focus(); }, [def.key]);

  const isLocked = (k) => stepLocked(k, s.model);
  const around = (dir) => { for (let j = i + dir; j >= 0 && j < STEPS.length; j += dir) if (!isLocked(STEP_KEYS[j])) return STEP_KEYS[j]; return null; };
  const onValidity = useCallback((v) => setValidity((m) => (m[def.key] === v ? m : { ...m, [def.key]: v })), [def.key]);
  const valid = validity[def.key] === true;
  const last = def.kind === 'done';
  const goto = useCallback((k) => { setStep(k); setShowAll(false); if (bodyRef.current) bodyRef.current.scrollTop = 0; }, [setStep]);

  /* Next commits whatever field is still focused, then moves on. On a
     mandatory step that is not done it shows every message instead. */
  const onNext = () => {
    if (def.kind === 'required' && !valid) { setShowAll(true); if (bodyRef.current) bodyRef.current.scrollTop = 0; return; }
    if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur();
    const n = around(1); if (n) goto(n);
  };
  const finish = async () => {
    if (finishing) return;
    setFinishing(true);
    try { await onFinish(); } finally { setFinishing(false); }
  };
  const onKey = (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
    const tag = e.target?.tagName;
    if (tag !== 'INPUT' && tag !== 'SELECT') return;
    e.preventDefault();
    if (last) finish(); else onNext();
  };
  const mark = markFor(s.marks, def.key);
  const Section = SECTION[def.key];
  const prev = around(-1);
  const stop = def.key === 'sites' && !s.dcs.length ? 'Add a site to continue.' : STOP[def.key] || STOP.org;

  return createPortal(
    <div className={styles.veil} role="presentation">
      <div ref={ref} className={styles.box} role="dialog" aria-modal="true" aria-labelledby="os-flow-t" onKeyDown={onKey} data-testid="flow">
        <header className={styles.boxH}>
          <div className={styles.boxHRow}>
            <h2 id="os-flow-t" className={styles.boxT} ref={titleRef} tabIndex={-1}>{def.title}</h2>
            {/* The closing step has its one button below and nothing else. */}
            <span className={styles.boxHRight}>
              <SaveMark mark={mark} />
              {last ? null : gated
                ? <button type="button" className={styles.boxQuit} onClick={onSignOut}>Sign out</button>
                : <button type="button" className={styles.boxQuit} onClick={onClose} aria-label="Close">Close</button>}
            </span>
          </div>
          {def.lead ? <p className={styles.boxLead}>{def.lead}</p> : null}
          {stars ? <p className={styles.legend}>* Required</p> : null}
        </header>

        <div className={styles.boxB} ref={bodyRef}>
          {showAll && def.kind === 'required' && !valid ? <p className={styles.stop} role="alert">{stop}</p> : null}
          {s.loading ? <div className={styles.loading}>Loading</div>
            : s.error ? <div><Err>{s.error.message}</Err> <button type="button" className="os-link" onClick={s.refresh}>Try again</button></div>
              : <Section key={def.key} s={s} onValidity={onValidity} showAll={showAll} inFlow goto={goto} />}
        </div>

        {/* The closing step has the one button that closes; every other step
            has Back and Next and nothing else. */}
        <footer className={styles.boxF}>
          {last ? <span /> : <Act variant="secondary" disabled={!prev} onClick={() => prev && goto(prev)}>Back</Act>}
          {last
            ? <Act variant="primary" disabled={finishing} onClick={finish} data-testid="finish">{finishing ? 'Finishing' : 'Done'}</Act>
            : <Act variant="primary" disabled={s.loading || (def.kind === 'required' && !valid && showAll)} onClick={onNext} data-testid="next">Next</Act>}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
