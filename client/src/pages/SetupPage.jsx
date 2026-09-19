import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';
import { useHasSidebar } from '../hooks/useIsDesktop';
import useModalA11y from '../hooks/useModalA11y';
import { useOrgSettings } from '../hooks/useOrgSettings';
import { STEPS, STEP_KEYS, stepOf, stepDone, stepLocked, progress, firstIncompleteStep } from '../utils/orgSettings';
import { setupDecision } from '../utils/setupGuard';
import BackButton from '../components/BackButton.jsx';
import { Act, SaveMark, Select, Err, cx } from '../components/orgsettings/Fields.jsx';
import { OrgSection, DatacentresSection, SpacesSection, PeopleSection, RulesSection, ReviewSection, RemainingList } from '../components/orgsettings/SectionsEstate.jsx';
import { SystemsSection, VendorsSection, ConventionsSection, NetworkSection } from '../components/orgsettings/SectionsProfile.jsx';
import '../components/orgsettings/sections.css';
import styles from './SetupPage.module.css';

/**
 * Organization settings.
 *
 * One route, two things on it:
 *
 *   The settings view: every section as a card that is edited in place,
 *   with a status card at the top that lists what is still needed and what
 *   is not filled yet. This is what Profile > Organization settings opens.
 *
 *   The guided flow: a container over the app that shows one step at a
 *   time, with a Back and a Next button and nothing else to navigate by. It
 *   opens by itself for an admin the route gate sent here (the organization
 *   still lacks a mandatory item) and on demand from the settings view.
 *
 * Everything saves as it goes, through hooks/useOrgSettings; the steps and
 * what counts as done live in utils/orgSettings. On a phone the container
 * fills the screen; on a laptop it is a card over a dimmed backdrop.
 */

const SECTION = { org: OrgSection, datacentres: DatacentresSection, spaces: SpacesSection, people: PeopleSection, systems: SystemsSection, vendors: VendorsSection, conventions: ConventionsSection, network: NetworkSection, rules: RulesSection, review: ReviewSection };
const PANELS = STEPS.filter((st) => st.kind !== 'review');

/* The latest save mark for a step, across its per-datacentre keys. */
function markFor(marks, key) {
  const extra = { people: ['contacts:'], network: ['snmp:'], datacentres: ['facility:'] }[key] || [];
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
  const [sp, setSp] = useSearchParams();
  const pr = useMemo(() => progress(s.model), [s.model]);
  const gated = setupDecision(user) === 'setup';

  /* The flow opens by itself when the gate sent the admin here or the link
     asked for it, at the first step that still has mandatory work. Decided
     once, when the model arrives, so a save never moves the page out from
     under the person making it. */
  const [flow, setFlow] = useState(null);
  useEffect(() => {
    if (s.loading || flow !== null) return;
    if (gated || sp.get('flow')) setFlow(STEP_KEYS.includes(sp.get('step')) ? sp.get('step') : firstIncompleteStep(s.model));
    else setFlow(false);
  }, [s.loading, flow, gated, sp, s.model]);

  const openFlow = useCallback((step) => setFlow(step && STEP_KEYS.includes(step) ? step : firstIncompleteStep(s.model)), [s.model]);
  const closeFlow = useCallback(() => {
    setFlow(false);
    if (sp.get('flow') || sp.get('step')) setSp({}, { replace: true });
  }, [sp, setSp]);
  const finish = useCallback(async () => {
    await refreshUser();
    setFlow(false);
    navigate('/scan', { replace: true });
  }, [refreshUser, navigate]);
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
      <Settings s={s} pr={pr} gated={gated} onOpenFlow={openFlow} flowOpen={!!flow} />
      {flow ? (
        <FlowModal s={s} step={flow} setStep={setFlow} gated={gated} onClose={closeFlow} onFinish={finish} onSignOut={signOut} />
      ) : null}
    </div>
  );
}

/* ---- The settings view ------------------------------------------------ */
/* While the flow is open the cards stay unmounted: the container covers
   them, and two copies of a section would carry the same field ids and save
   the arrival defaults twice. */
function Settings({ s, pr, gated, onOpenFlow, flowOpen }) {
  const [at, setAt] = useState('org');
  const go = useCallback((key) => {
    setAt(key);
    const el = document.getElementById(`os-${key}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);
  const stateOf = (st) => (stepLocked(st.key, s.model) ? 'locked' : stepDone(st.key, s.model) ? 'done' : 'todo');
  const missing = pr.required.total - pr.required.done;
  const allDone = missing === 0;
  const orgName = s.orgProfile?.name || s.user?.organization?.name || '';

  return (
    <div className={styles.settings}>
      <nav className={styles.index} aria-label="Sections">
        <span className={styles.indexT}>{orgName || 'Sections'}</span>
        {PANELS.map((st) => (
          <button type="button" key={st.key} className={cx(styles.ix, at === st.key && styles.ixOn)} onClick={() => go(st.key)}>
            <i className={cx(styles.ixDot, styles[`ixDot_${stateOf(st)}`])} />
            <span>{st.title}</span>
          </button>
        ))}
      </nav>

      <div className={styles.panes}>
        <section className={styles.pane} aria-labelledby="os-status-t">
          <div className={styles.paneH}>
            <div className={styles.paneHT}>
              <h2 id="os-status-t">Setup</h2>
              <p>{s.loading ? 'Loading' : allDone ? 'Setup is complete.' : `${missing} still to do${gated ? ' before you can scan' : ''}.`}</p>
            </div>
            <div className={styles.paneHR}>
              {s.isOwner && s.orgs.length > 1 ? (
                <label className={styles.orgPick}>
                  <span>Organization</span>
                  <Select value={s.orgId ?? ''} onChange={(e) => s.pickOrg(e.target.value)} aria-label="Organization">
                    {s.orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </Select>
                </label>
              ) : null}
              <Act variant={allDone ? 'secondary' : 'primary'} onClick={() => onOpenFlow()} disabled={s.loading || s.orgId == null}>{allDone ? 'Walk through again' : 'Continue setup'}</Act>
            </div>
          </div>
          {s.error ? <div className={styles.paneB}><Err>{s.error.message}</Err> <button type="button" className="os-link" onClick={s.refresh}>Try again</button></div>
            : !s.loading ? <div className={styles.paneB}><RemainingList model={s.model} goto={go} /></div> : null}
        </section>

        {!s.loading && !s.error && !flowOpen ? PANELS.map((st) => <Pane key={st.key} st={st} s={s} go={go} />) : null}
      </div>
    </div>
  );
}

function Pane({ st, s, go }) {
  const ref = useRef(null);
  const stars = useHasStars(ref);
  const Section = SECTION[st.key];
  return (
    <section ref={ref} id={`os-${st.key}`} className={styles.pane} aria-labelledby={`os-${st.key}-t`}>
      <div className={styles.paneH}>
        <div className={styles.paneHT}>
          <h2 id={`os-${st.key}-t`}>{st.title}</h2>
          {/* A step whose fields speak for themselves carries no lead at all. */}
          {st.lead ? <p>{st.lead}</p> : null}
          {stars ? <p className={styles.legend}>* Required</p> : null}
        </div>
        <div className={styles.paneHR}><SaveMark mark={markFor(s.marks, st.key)} /></div>
      </div>
      <div className={styles.paneB}>
        <Section s={s} inFlow={false} goto={go} />
      </div>
    </section>
  );
}

/* ---- The guided flow: one step at a time, in a container over the app ---- */
/* The one line at the top of a step when Next was pressed before the
   step's mandatory work was done. The fields carry their own messages. */
const STOP = {
  org: 'Complete the marked fields to continue.',
  spaces: 'Add a space with racks to each datacentre to continue.',
  people: 'Set an approver for each datacentre to continue.',
  rules: 'Accept the rules to continue.',
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
  const canContinue = def.kind !== 'required' || valid;
  const goto = useCallback((k) => { setStep(k); setShowAll(false); if (bodyRef.current) bodyRef.current.scrollTop = 0; }, [setStep]);

  /* Next commits whatever field is still focused, then moves on. On a
     mandatory step that is not done it shows every message instead. */
  const onNext = () => {
    if (def.kind === 'required' && !valid) { setShowAll(true); if (bodyRef.current) bodyRef.current.scrollTop = 0; return; }
    if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur();
    const n = around(1); if (n) goto(n);
  };
  const finish = async () => {
    if (finishing || !canContinue) return;
    setFinishing(true);
    try { await onFinish(); } finally { setFinishing(false); }
  };
  const onKey = (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
    const tag = e.target?.tagName;
    if (tag !== 'INPUT' && tag !== 'SELECT') return;
    e.preventDefault();
    if (def.key === 'review') finish(); else onNext();
  };
  const mark = markFor(s.marks, def.key);
  const Section = SECTION[def.key];
  const prev = around(-1);
  const stop = def.key === 'datacentres' ? (s.dcs.length ? STOP.org : 'Add a datacentre to continue.') : STOP[def.key] || STOP.org;

  return createPortal(
    <div className={styles.veil} role="presentation">
      <div ref={ref} className={styles.box} role="dialog" aria-modal="true" aria-labelledby="os-flow-t" onKeyDown={onKey} data-testid="flow">
        <header className={styles.boxH}>
          <div className={styles.boxHRow}>
            <h2 id="os-flow-t" className={styles.boxT} ref={titleRef} tabIndex={-1}>{def.title}</h2>
            <span className={styles.boxHRight}>
              <SaveMark mark={mark} />
              {gated
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

        <footer className={styles.boxF}>
          <Act variant="secondary" disabled={!prev} onClick={() => prev && goto(prev)}>Back</Act>
          {def.key === 'review'
            ? <Act variant="primary" disabled={!canContinue || finishing || s.loading} onClick={finish} data-testid="finish">{finishing ? 'Finishing' : 'Finish'}</Act>
            : <Act variant="primary" disabled={s.loading || (def.kind === 'required' && !valid && showAll)} onClick={onNext} data-testid="next">Next</Act>}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
