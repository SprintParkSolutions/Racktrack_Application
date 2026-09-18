import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import ThemeToggle from '../components/ThemeToggle.jsx';
import { BackIcon } from '../components/BackButton.jsx';
import Icon from '../components/Icon.jsx';
import RackPicture from '../components/RackPicture.jsx';
import { apiUrl, authFetch } from '../utils/api';
import { useSmartBack } from '../hooks/useSmartBack';
import {
  confidenceWord, confirmedLine, evidenceDetail, evidenceSentence,
  matchConfirmation, plainDashes, settleAdvice, unclearMatch,
} from '../utils/matchEvidence';
import styles from './ReviewPage.module.css';

/**
 * Review: join the two witnesses and let a person confirm the join.
 *
 * The camera knows where each device sits. The switch knows what it is. The one
 * thing neither states is which is which, so the operator confirms the match
 * here: this switch is that box in the rack. Once confirmed, the switch's own
 * model, serial, real ports and LLDP cabling are merged onto the camera's
 * layout, and that merged result is what Export writes.
 *
 * Three rules this screen keeps to:
 *
 *   Confirming is a person's act. The Confirm button beside a switch is the
 *   only thing that confirms it. Saving the list keeps the choices and confirms
 *   nothing, so nothing downstream can read a proposal as a finding.
 *
 *   Every proposal shows its reasons in words. The server sends the evidence it
 *   used; this screen writes it as a sentence a person can check against the
 *   box, and says how sure it is in a word rather than a score.
 *
 *   Where two boxes look the same, nothing is preselected. The screen says what
 *   would tell them apart instead of picking one and hoping.
 *
 * A field the switch did not state is left as the camera had it. A cable whose
 * two ends cannot both be resolved is not drawn. Disagreements are surfaced,
 * never settled silently. Nothing is invented.
 *
 * Ported from RackTrack for NetBox. The route carries V1's rack id; the NetBox
 * side keeps its own numeric scan id, obtained (or created) once per visit
 * with POST /api/nb/scans/adopt/:rackId -> { id }.
 */

const NOT_HERE = ''; // select value for "not in this rack"

const evLabel = {
  lldp_both: 'both ends agree',
  lldp_one: 'one end only',
};

/**
 * One round trip to the NetBox side of the server, through V1's authFetch.
 *
 * Never throws, and a failed request keeps the server's body: the 409s and
 * 502s carry the reason a step could not run, and that reason is the thing
 * the engineer needs to read. A body that is not JSON (an HTML 404 page from
 * a route that is not there yet) is dropped rather than shown.
 */
async function nb(path, opts = {}) {
  let res;
  try {
    res = await authFetch(apiUrl(path), opts);
  } catch {
    return {
      ok: false, status: 0,
      body: { error: 'Could not reach the server. Check your connection and try again.' },
    };
  }
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  if (!body || typeof body !== 'object') body = {};
  return { ok: res.ok, status: res.status, body };
}

const jsonBody = (method, body) => ({
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

/** The server's reason, plus what to do about it where the status tells us. */
function explain(r, fallback) {
  if (r.status === 0) return r.body.error;
  if (r.status === 403) {
    return 'Only the account owner can use Review for now. Ask them to sign in and review this rack.';
  }
  if (r.status === 409) {
    return 'This rack has not been analysed yet. Scan the rack first, then come back to Review.';
  }
  const raw = plainDashes(r.body.error || '').trim().replace(/\.$/, '');
  const msg = raw ? raw[0].toUpperCase() + raw.slice(1) : fallback.replace(/\.$/, '');
  if (r.status === 404) return `${msg}. Go back to the rack and open Review again.`;
  return `${msg}. Try again in a moment.`;
}

/** The reasons the server gave for one switch, whatever shape it sent them in. */
const reasonFor = (view, sw) => (view && view.reasons && view.reasons[sw.id]) || sw.autoMatch || null;

export default function ReviewPage() {
  const { rackId } = useParams();
  const navigate = useNavigate();
  const goBack = useSmartBack(`/results/${rackId}`);

  const [scanId, setScanId] = useState(null);   // the NetBox-side scan for this rack
  const [scan, setScan] = useState(null);       // conflicts + detection boxes + rack height
  const [recon, setRecon] = useState(null);
  const [picking, setPicking] = useState(null); // the switch being matched from the photo
  const [matches, setMatches] = useState({});
  const [selected, setSelected] = useState(null); // the switch the picture is showing
  const [changed, setChanged] = useState({});   // switches whose box moved since it loaded
  const [unlocked, setUnlocked] = useState({}); // switches reopened with Change
  const [confirmedHere, setConfirmedHere] = useState({}); // what this visit confirmed
  const [confirming, setConfirming] = useState(null);
  const [result, setResult] = useState(null);   // summary from the last save
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState(null);         // the review could not load
  const [saveErr, setSaveErr] = useState(null); // the matches could not be saved
  const [pickNote, setPickNote] = useState(false); // tapped the rack with no switch chosen
  const [attempt, setAttempt] = useState(0);    // "Try again" / "Check again"

  const reload = () => setAttempt((n) => n + 1);

  /**
   * What the server holds, turned into what is on screen.
   *
   * A stored matching is somebody's saved work and is shown as it is. A fresh
   * proposal is shown too, except where the evidence cannot tell two boxes
   * apart: that one is left empty, because putting a coin-toss in the box and
   * waiting for someone to notice is how a guess becomes a record.
   */
  const takeView = (body) => {
    const start = { ...(body.matches || {}) };
    if (body.suggested) {
      for (const sw of body.switches || []) {
        if (unclearMatch(reasonFor(body, sw))) start[sw.id] = null;
      }
    }
    setRecon(body);
    setMatches(start);
    setResult(body.summary || null);
    setDirty(Boolean(body.suggested));   // a fresh proposal is unsaved until saved
    setChanged({});
    setUnlocked({});
    setSelected((cur) => {
      const list = body.switches || [];
      if (cur !== null && list.some((s) => String(s.id) === String(cur))) return cur;
      const first = list.find((s) => s.read) || list[0];
      return first ? first.id : null;
    });
  };

  // Step one: V1's rack id -> the NetBox side's scan id. Idempotent on the
  // server, so revisiting the page never makes a second scan. Step two: the
  // reconcile view, and the scan record for the rack height, the conflicts and
  // the detection boxes the photo picker draws. The review works without the
  // scan record; it does not work without the view.
  useEffect(() => {
    let live = true;
    setErr(null); setSaveErr(null); setRecon(null); setScan(null); setScanId(null);
    setConfirmedHere({});
    (async () => {
      const a = await nb(`/api/nb/scans/adopt/${encodeURIComponent(rackId)}`, { method: 'POST' });
      if (!live) return;
      const id = a.ok ? a.body.id : null;
      if (id === null || id === undefined) {
        setErr(explain(a, 'Could not open this rack for review'));
        return;
      }
      setScanId(id);
      const [r, s] = await Promise.all([
        nb(`/api/nb/scans/${encodeURIComponent(id)}/reconcile`),
        nb(`/api/nb/scans/${encodeURIComponent(id)}`),
      ]);
      if (!live) return;
      if (!r.ok) { setErr(explain(r, 'Could not load the review')); return; }
      takeView(r.body);
      if (s.ok) setScan(s.body);
    })();
    return () => { live = false; };
  }, [rackId, attempt]);

  /** Read the view again, after the server has been told something. */
  const refresh = async (id) => {
    const r = await nb(`/api/nb/scans/${encodeURIComponent(id)}/reconcile`);
    if (r.ok) takeView(r.body);
    return r;
  };

  const cleanMatches = () => {
    const clean = {};
    for (const [id, uid] of Object.entries(matches)) clean[id] = uid || null;
    return clean;
  };

  /** Keep the list. This stores the choices and confirms nothing. */
  async function saveList() {
    setSaving(true); setSaveErr(null);
    const r = await nb(`/api/nb/scans/${encodeURIComponent(scanId)}/reconcile`,
      jsonBody('POST', { matches: cleanMatches() }));
    setSaving(false);
    if (!r.ok) { setSaveErr(explain(r, 'Could not save the matches')); return; }
    // The server takes the rows it can and names the ones it will not, each in
    // its own sentence. A save that was partly refused must not read as a save
    // that went through: the person needs to know which switch it was.
    const refused = (r.body?.rejected || []).map((x) => x.error).filter(Boolean);
    const note = r.body?.confirmNote ? [r.body.confirmNote] : [];
    if (refused.length || note.length) setSaveErr([...note, ...refused].join(' '));
    setResult(r.body.summary || null);
    setDirty(false);
  }

  /**
   * Confirm one switch. The only thing on this screen that confirms anything.
   *
   * The whole list rides along so the server is confirming the matching that is
   * actually on screen, and only the named switch is confirmed by it.
   */
  async function confirmOne(sw) {
    setConfirming(sw.id); setSaveErr(null);
    const r = await nb(`/api/nb/scans/${encodeURIComponent(scanId)}/reconcile`,
      jsonBody('POST', { matches: cleanMatches(), confirm: true, switchId: sw.id }));
    if (!r.ok) {
      setConfirming(null);
      setSaveErr(explain(r, 'Could not confirm this match'));
      return;
    }
    // Remember it here as well. An older server stores the confirmation without
    // reporting it back, and the person who just pressed the button should not
    // have to wonder whether it took.
    const said = r.body && (r.body.confirmation || r.body.confirmed);
    const at = (said && typeof said === 'object' && (said.confirmedAt || said.at)) || new Date().toISOString();
    const by = (said && typeof said === 'object' && (said.confirmedBy || said.by)) || 'You';
    setConfirmedHere((m) => ({ ...m, [sw.id]: { at, by: typeof by === 'string' ? by : 'You' } }));
    setResult((cur) => (r.body && r.body.summary) || cur);
    setDirty(false);
    await refresh(scanId);
    setConfirming(null);
  }

  // Shared by the dropdown, the photo and the rack picture, so all three write
  // the same value under the same rule.
  const setMatch = (id, uid) => {
    setMatches((m) => {
      const next = { ...m, [id]: uid };
      // One switch per device. If this box was already assigned to another
      // switch, release that one, so reassigning moves the match rather than
      // pointing two switches at the same physical box.
      if (uid) {
        for (const other of Object.keys(next)) {
          if (String(other) !== String(id) && next[other] === uid) next[other] = null;
        }
      }
      return next;
    });
    setChanged((c) => ({ ...c, [id]: true }));
    setSelected(id);
    setDirty(true);
    setPickNote(false);
  };

  /** Who confirmed this switch's match, taking this visit's own work as well. */
  const confirmationFor = (sw) => {
    const fromServer = matchConfirmation(recon, sw);
    if (fromServer.confirmed) return fromServer;
    const here = confirmedHere[sw.id];
    if (here) return { confirmed: true, fromBinding: fromServer.fromBinding, at: here.at, by: here.by };
    return fromServer;
  };

  const cameraConflicts = (scan && scan.conflicts) || [];

  const conflictsBlock = cameraConflicts.length > 0 && (
    <div className={styles.paneBody}>
      <p className={styles.k}>
        {cameraConflicts.length} disagreement{cameraConflicts.length === 1 ? '' : 's'},
        held back from export
      </p>
      {cameraConflicts.map((c) => (
        <div key={`${c.subjectUid}-${c.field}`} className={`${styles.note} ${styles.noteWarn}`}>
          <b>{c.field}</b>
          <span>{plainDashes(c.note)}</span>
        </div>
      ))}
    </div>
  );

  let body;

  if (err) {
    body = (
      <div className={styles.stack}>
        <div className={`${styles.note} ${styles.noteBad}`}>
          <b>Not ready</b>
          <span>{err}</span>
        </div>
        <div className={styles.nav}>
          <button className={styles.secondary} type="button" onClick={() => navigate(`/results/${rackId}`)}>
            <Icon name="arrow_back" />Back to the rack
          </button>
          <button className={styles.primary} type="button" onClick={reload}>
            Try again
          </button>
        </div>
      </div>
    );
  } else if (!recon) {
    body = (
      <p className={styles.working}>
        <span className={styles.spinner} aria-hidden="true" />
        {scanId === null ? 'Opening this rack.' : 'Loading the review.'}
      </p>
    );
  } else if (recon.switches.length === 0 || !recon.switches.some((s) => s.read)) {
    // Nothing to join yet. The camera side is here; the switch side is not.
    const added = recon.switches.length;
    body = (
      <>
        <div className={styles.empty}>
          <h2>Read the switches in the Network step first</h2>
          <p>
            {added === 0
              ? 'No switches have been added for this rack yet. Add each managed switch in the Network step and read it, then come back here to match them to the photo.'
              : `${added} switch${added === 1 ? ' is' : 'es are'} added but none has been read. Open the Network step, press Read switch on each one, then come back.`}
          </p>
          <div className={styles.emptyActions}>
            <Link className={styles.primary} to={`/results/${rackId}/network`}>
              Go to Network<Icon name="arrow_forward" />
            </Link>
            <button type="button" className={styles.secondary} onClick={reload}>
              Check again
            </button>
          </div>
        </div>
        {conflictsBlock && <section className={styles.pane}>{conflictsBlock}</section>}
      </>
    );
  } else {
    const changes = (result && result.changes) || [];

    const deviceOptions = [...recon.devices].sort(
      (a, b) => (b.position ?? -1) - (a.position ?? -1),
    );
    // Which switch currently claims each box, so the dropdown can say so.
    const claimedBy = {};
    for (const s of recon.switches) if (matches[s.id]) claimedBy[matches[s.id]] = s.label;
    const labelFor = (d) => (d.position !== null
      ? `U${d.position} · ${d.name} (${d.portCount}p)`
      : `${d.name} (${d.portCount}p, unplaced)`);

    const chosenSwitch = recon.switches.find((s) => String(s.id) === String(selected)) || null;
    const highlight = chosenSwitch ? (matches[chosenSwitch.id] || null) : null;
    const confirmedCount = recon.switches.filter((s) => {
      const c = confirmationFor(s);
      return c.confirmed || c.fromBinding;
    }).length;

    body = (
      <>
        <div className={styles.intro}>
          <p>
            The photo shows <strong>where</strong> each box sits. Each switch you read
            says <strong>what</strong> it is. Choose which switch is which box, then
            confirm each one. The report is built on what you confirm here.
          </p>
          <p>
            Nothing is invented: a value the switch did not state stays as the camera
            had it, and a cable is only drawn when both ends are known.
          </p>
        </div>

        <div className={styles.panes}>

          {/* ── The join ── */}
          <section className={styles.pane}>
            <div className={styles.paneHead}>
              <h2 className={styles.paneTitle}>Match each switch to its place</h2>
              <span className={styles.pill}>
                {confirmedCount} of {recon.switches.length} confirmed
              </span>
            </div>

            <div className={styles.joinBody}>
              {/* The rack, beside the switches it holds. Choose a switch and its
                  proposed shelf lifts out of the rest; tap a shelf and that
                  switch moves to it. */}
              <div className={styles.rackSide}>
                <RackPicture
                  devices={recon.devices}
                  size={(scan && scan.uHeight) || null}
                  highlight={highlight}
                  onPick={(uid) => {
                    if (!chosenSwitch) { setPickNote(true); return; }
                    setMatch(chosenSwitch.id, uid);
                  }}
                />
                <p className={styles.rackHint}>
                  {chosenSwitch
                    ? `Tap a shelf to say that is where ${chosenSwitch.label} sits.`
                    : 'Choose a switch on the right, then tap the shelf it sits on.'}
                </p>
                {pickNote && (
                  <p className={styles.rackWarn}>
                    Choose a switch first, then tap the shelf it sits on.
                  </p>
                )}
              </div>

              <div className={styles.listSide}>
                {recon.devices.length === 0 && (
                  <div className={`${styles.note} ${styles.noteWarn}`}>
                    <b>No boxes in the photo</b>
                    <span>
                      The scan found no devices to match a switch to. Scan the rack again
                      from the Scan step, then come back.
                    </span>
                  </div>
                )}

                <ul className={styles.swList}>
                  {recon.switches.map((s) => {
                    const selectId = `rt-review-match-${s.id}`;
                    const reason = reasonFor(recon, s);
                    const has = Boolean(matches[s.id]);
                    const conf = confidenceWord(reason, has);
                    const advice = settleAdvice(reason, has);
                    const detail = evidenceDetail(reason);
                    const c = confirmationFor(s);
                    const moved = Boolean(changed[s.id]);
                    const settled = (c.confirmed || c.fromBinding) && !moved && !unlocked[s.id];
                    const isSelected = String(s.id) === String(selected);

                    return (
                      <li
                        key={s.id}
                        className={`${styles.sw} ${isSelected ? styles.swOn : ''}`}
                        onPointerDown={() => setSelected(s.id)}
                        onFocusCapture={() => setSelected(s.id)}
                      >
                        <div className={styles.swHead}>
                          <div className={styles.swWho}>
                            <h3>{s.label}</h3>
                            <p className={styles.mono}>{s.host}</p>
                          </div>
                          <span className={`${styles.pill} ${s.read ? styles.pillOk : ''}`}>
                            {s.read ? 'Read' : 'Not read yet'}
                          </span>
                        </div>

                        <div className={styles.says}>
                          <span className={styles.k}>What it says it is</span>
                          {s.read ? (
                            <>
                              <span className={styles.saysModel}>
                                {s.model || <em className={styles.unstated}>model not stated</em>}
                              </span>
                              <span className={styles.dim}>
                                {s.ports} ports
                                {s.vendor ? ` · ${s.vendor}` : ''}
                                {s.serial ? ` · serial ${s.serial}` : ''}
                              </span>
                            </>
                          ) : (
                            <em className={styles.unstated}>
                              not read yet - read it in the Network step
                            </em>
                          )}
                        </div>

                        {/* Why this box, in words, and how sure it is in one of
                            four. The word carries the meaning; the colour and
                            the four bars only repeat it. */}
                        {s.read && (
                          <div className={styles.whyBlock}>
                            <span className={styles.k}>How sure this match is</span>
                            <div className={styles.confRow}>
                              <span className={`${styles.conf} ${styles[`conf_${conf.tone}`]}`}>
                                <Meter tone={conf.tone} />
                                {conf.word}
                              </span>
                            </div>
                            <p className={styles.why}>{evidenceSentence(reason)}</p>
                            {detail && <p className={styles.whyDetail}>{detail}</p>}
                            {/* The server says some things this screen cannot work
                                out for itself: a confirmation made against an older
                                photograph, a shelf it remembers for a box this
                                photograph does not show. Its sentences, unchanged. */}
                            {(reason?.notes || []).map((note) => (
                              <p className={styles.whyDetail} key={note}>{note}</p>
                            ))}
                            {advice && (
                              <p className={styles.advice}>
                                <b>What would settle it</b>
                                <span>{advice}</span>
                              </p>
                            )}
                            {c.fromBinding && !c.confirmed && (
                              <p className={styles.settledLine}>
                                Matched from a previous check. It does not need confirming again.
                              </p>
                            )}
                          </div>
                        )}

                        <label className={styles.k} htmlFor={selectId}>Is this box in the rack</label>
                        <div className={styles.matchCell}>
                          <select
                            id={selectId}
                            className={styles.select}
                            value={matches[s.id] || NOT_HERE}
                            disabled={!s.read || settled}
                            onChange={(e) => setMatch(s.id, e.target.value)}
                          >
                            <option value={NOT_HERE}> - not in this rack - </option>
                            {deviceOptions.map((d) => {
                              const taken = claimedBy[d.uid];
                              const mine = matches[s.id] === d.uid;
                              return (
                                <option key={d.uid} value={d.uid}>
                                  {labelFor(d)}{taken && !mine ? ` · on ${taken}` : ''}
                                </option>
                              );
                            })}
                          </select>
                          {/* The list names devices as "U14 · switch (24p)",
                              which is only useful to someone who already knows
                              which shelf is which. Standing at the rack you
                              know the box by looking at it, so this opens the
                              photograph and takes the tap. */}
                          <button
                            type="button"
                            className={styles.pickBtn}
                            disabled={!s.read || settled}
                            title="Point at it in the photograph instead"
                            onClick={() => setPicking(s)}
                          >
                            <Icon name="filter_center_focus" />
                            Photo
                          </button>
                        </div>

                        {/* Confirming is the whole point of the screen, so it
                            sits under the choice it is about, one switch at a
                            time. Saving the list above confirms nothing. */}
                        {s.read && (
                          <div className={styles.confirmRow}>
                            {settled ? (
                              <>
                                <p className={styles.confirmedLine}>
                                  <Icon name="check" />
                                  {c.confirmed
                                    ? confirmedLine(c)
                                    : 'Matched from a previous check.'}
                                </p>
                                <button
                                  type="button"
                                  className={`${styles.secondary} ${styles.small}`}
                                  onClick={() => setUnlocked((m) => ({ ...m, [s.id]: true }))}
                                >
                                  Change
                                </button>
                              </>
                            ) : (
                              <>
                                <p className={styles.confirmHint}>
                                  {moved && (c.confirmed || c.fromBinding)
                                    ? 'This box has changed since it was confirmed. Confirm it again.'
                                    : has
                                      ? 'Nothing is treated as a fact until you confirm it.'
                                      : 'Choose the box this switch is, then confirm it.'}
                                </p>
                                <button
                                  type="button"
                                  className={`${styles.primary} ${styles.small}`}
                                  disabled={!has || confirming !== null}
                                  onClick={() => confirmOne(s)}
                                >
                                  {confirming === s.id ? 'Confirming…' : 'Confirm'}
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>

                {saveErr && (
                  <div className={`${styles.note} ${styles.noteBad}`}>
                    <b>Not saved</b>
                    <span>{saveErr}</span>
                  </div>
                )}
              </div>
            </div>

            <div className={styles.paneFoot}>
              <span className={`${styles.dim} ${styles.grow}`}>
                {dirty
                  ? 'Your choices are not saved yet. Saving keeps them; it does not confirm them.'
                  : 'Your choices are saved. Confirming is a separate step, switch by switch.'}
              </span>
              <button
                className={`${styles.secondary} ${styles.small}`}
                type="button"
                onClick={saveList}
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save the list'}
              </button>
            </div>
          </section>

          {/* ── What the join produces ── */}
          <section className={styles.pane}>
            <div className={styles.paneHead}>
              <h2 className={styles.paneTitle}>What will be written</h2>
            </div>

            {dirty && (
              <p className={styles.paneBlank}>
                Save the list to see what these matches produce.
              </p>
            )}

            {result && !dirty && (
              <div className={styles.paneBody}>
                {/* The counts used to be switches / serials / models / cables,
                    which between them can all read zero while six real values
                    are queued: a switch that states a manufacturer and a port
                    count but no serial and no ENTITY model is the common case,
                    and this pane reported it as "nothing to write". It counts
                    every value now, and lists them underneath. */}
                <div className={styles.summary}>
                  <Stat v={`${result.matched} of ${result.switchesTotal}`} k="switches placed"
                        n={result.unmatched ? `${result.unmatched} not placed` : 'all matched'} />
                  <Stat v={changes.length} k="values from SNMP"
                        n={fieldSummary(changes)} />
                  <Stat v={result.cables} k="cables from LLDP"
                        n={result.cablesProven ? `${result.cablesProven} proven both ends` : ''} />
                </div>

                {confirmedCount < recon.switches.length && (
                  <p className={styles.dimText}>
                    {confirmedCount === 0
                      ? 'No switch has been confirmed yet, so everything below is still a proposal.'
                      : `${recon.switches.length - confirmedCount} of these matches are still proposals, waiting for someone to confirm them.`}
                  </p>
                )}

                {/* Every value, named, with the device it lands on. This is what
                    "what will be written" actually means; three numbers is a
                    summary of it, not a statement of it. */}
                {changes.length > 0 && (
                  <>
                    <p className={styles.k}>Every value the switches supply</p>
                    <div className={styles.writeList}>
                      {Object.entries(byDevice(changes)).map(([device, rows]) => (
                        <div key={device} className={styles.writeGroup}>
                          <div className={styles.writeDev}>{device}</div>
                          {rows.map((c) => (
                            <div key={`${device}-${c.field}`} className={styles.writeRow}>
                              <span className={styles.writeField}>{c.field}</span>
                              <span className={styles.writeVal}>{c.now}</span>
                              {c.was ? <span className={styles.writeWas}>was {c.was}</span> : null}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {changes.length === 0 && (
                  <p className={styles.dimText}>
                    The switches that answered stated nothing the camera did not
                    already have. Nothing is overwritten.
                  </p>
                )}

                {result.cableList && result.cableList.length > 0 && (
                  <>
                    <p className={styles.k}>Cables from LLDP</p>
                    <ul className={styles.cables}>
                      {result.cableList.map((c, i) => (
                        <li key={i} className={styles.cable}>
                          <span className={styles.mono}>{c.from}</span>
                          <span className={styles.dim}>to</span>
                          <span className={styles.mono}>{c.to}</span>
                          <span className={`${styles.pill} ${c.evidence === 'lldp_both' ? styles.pillOk : styles.pillWarn}`}>
                            {evLabel[c.evidence] || c.evidence}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {result.unresolved && result.unresolved.length > 0 && (
                  <div className={`${styles.note} ${styles.noteWarn}`}>
                    <b>
                      {result.unresolved.length} LLDP neighbour{result.unresolved.length === 1 ? '' : 's'} not turned into a cable
                    </b>
                    {result.unresolved.map((u, i) => (
                      <span key={i}>{u.from}: saw {u.seen || 'a neighbour'} - {plainDashes(u.why)}.</span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {conflictsBlock}

            <div className={styles.paneFoot}>
              <div className={`${styles.nav} ${styles.grow}`}>
                <button
                  className={styles.secondary} type="button"
                  onClick={() => navigate(`/results/${rackId}/network`)}
                >
                  <Icon name="arrow_back" />Network
                </button>
                <button
                  className={styles.primary} type="button"
                  onClick={() => navigate(`/results/${rackId}/report`)}
                  disabled={dirty}
                >
                  Next: report<Icon name="arrow_forward" />
                </button>
                {dirty && (
                  <p className={styles.navHint}>Save the list first, then go to the report.</p>
                )}
              </div>
            </div>
          </section>

        </div>
      </>
    );
  }

  return (
    <div className={`page page-full ${styles.page}`}>
      <header className={styles.header}>
        <button
          type="button"
          className={styles.backBtn}
          onClick={goBack}
          aria-label="Back"
        >
          <BackIcon />
        </button>
        <h1 className={styles.title}>Review</h1>
        <ThemeToggle />
      </header>

      <div className={styles.scroll}>
        {body}
      </div>

      {picking && recon && (
        <DevicePicker
          scanId={scanId}
          hasImage={!scan || scan.hasImage !== false}
          detections={scan ? scan.detections : null}
          devices={recon.devices}
          label={picking.label}
          value={matches[picking.id] || NOT_HERE}
          onPick={(uid) => { setMatch(picking.id, uid); setPicking(null); }}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}

/**
 * Four bars, filled to match the word beside them.
 *
 * Colour alone cannot carry how sure a match is: a red chip and a green chip
 * are the same chip to anybody who cannot tell them apart, and on a phone in a
 * data hall both are grey. The word says it, this repeats it in a shape.
 */
function Meter({ tone }) {
  const filled = { sure: 4, likely: 3, maybe: 2, none: 0 }[tone] ?? 0;
  return (
    <span className={styles.meter} aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <i key={i} className={i < filled ? styles.barOn : styles.barOff} />
      ))}
    </span>
  );
}

function Stat({ v, k, n }) {
  return (
    <div>
      <b>{v ?? ' - '}</b>
      <span>{k}</span>
      {n ? <small>{n}</small> : null}
    </div>
  );
}

/** Group the flat change list by the device each value lands on, keeping the
    order the reconciler produced so the list reads the way the write runs. */
function byDevice(changes) {
  const out = {};
  for (const c of changes) (out[c.device] = out[c.device] || []).push(c);
  return out;
}

/** "3 manufacturers, 3 port counts" - what the number above is made of. */
function fieldSummary(changes) {
  const n = {};
  for (const c of changes) n[c.field] = (n[c.field] || 0) + 1;
  const label = { ports: 'port counts', serial: 'serials', model: 'models',
                  manufacturer: 'manufacturers' };
  return Object.entries(n).map(([f, k]) => `${k} ${label[f] || f}`).join(', ');
}

/* ── Pick a device off the photograph ─────────────────────────────────────
   The same picture and the same boxes the scan drew, made tappable. The join
   between a detection box and a reconcile device is the U it sits in - the
   only handle the two sides share - so a box the engine could not place is
   drawn but not offered.

   The photograph comes from /api/nb/scans/:id/image, which sits behind the
   login. An SVG <image> cannot send the Authorization header the native app
   relies on, so the picture is fetched through authFetch and shown from an
   object URL that is revoked when the picker closes.
   ──────────────────────────────────────────────────────────────────────── */

function DevicePicker({ scanId, hasImage, detections, devices, label, value, onPick, onClose }) {
  const [pic, setPic] = useState(null);     // { url, w, h } once the photo is in
  const [picErr, setPicErr] = useState(null);
  const [hot, setHot] = useState(null);

  useEffect(() => {
    if (!hasImage) { setPicErr('This scan has no photograph to show. Use the list instead.'); return undefined; }
    let live = true;
    let objectUrl = null;
    (async () => {
      let res;
      try {
        res = await authFetch(apiUrl(`/api/nb/scans/${encodeURIComponent(scanId)}/image`));
      } catch {
        if (live) setPicErr('Could not load the photograph. Check your connection, or use the list instead.');
        return;
      }
      if (!res.ok) {
        if (live) setPicErr('Could not load the photograph. Use the list instead.');
        return;
      }
      const blob = await res.blob();
      if (!live) return;
      objectUrl = URL.createObjectURL(blob);
      const probe = new Image();
      probe.onload = () => {
        if (live) setPic({ url: objectUrl, w: probe.naturalWidth, h: probe.naturalHeight });
      };
      probe.onerror = () => {
        if (live) setPicErr('Could not read the photograph. Use the list instead.');
      };
      probe.src = objectUrl;
    })();
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [scanId, hasImage]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Each drawn box, carrying the reconcile device it stands for, or null.
  const targets = useMemo(() => ((detections && detections.devices) || []).map((d) => {
    const m = /(\d+)/.exec((d.units && d.units[0]) || '');
    const u = m ? Number(m[1]) : null;
    return { ...d, u, dev: u === null ? null : devices.find((x) => x.position === u) || null };
  }), [detections, devices]);

  const hotDev = targets.find((t) => t.i === hot);
  // One typographic step, in image pixels, so the label scales with the photo.
  const k = pic ? Math.max(pic.w, pic.h) / 52 : 0;

  const stageText = !detections
    ? 'This scan has no detection boxes to tap. Use the list instead.'
    : picErr || (!pic ? 'Loading the photograph.' : null);

  return (
    <div className={styles.pickWrap} role="dialog" aria-modal="true" aria-label={`Pick the rack position for ${label}`}>
      <div className={styles.pickScrim} onClick={onClose} aria-hidden="true" />
      <div className={styles.pick}>
        <div className={styles.pickHead}>
          <div className={styles.pickTitle}>
            <b>{label}</b>
            <span>Tap it in the rack</span>
          </div>
          <button type="button" className={styles.pickClose} onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>

        <div className={styles.pickStage}>
          {stageText && <p className={styles.stageEmpty}>{stageText}</p>}
          {pic && detections && (
            <svg
              className={styles.canvas}
              viewBox={`0 0 ${pic.w} ${pic.h}`}
              preserveAspectRatio="xMidYMid meet"
            >
              <defs>
                <clipPath id="rt-review-pick-frame">
                  <rect x="0" y="0" width={pic.w} height={pic.h} />
                </clipPath>
              </defs>
              <image href={pic.url} x="0" y="0" width={pic.w} height={pic.h} />
              <g clipPath="url(#rt-review-pick-frame)">
                {targets.map((t) => {
                  const on = t.dev && t.dev.uid === value;
                  return (
                    <g
                      key={`t${t.i}`}
                      className={t.dev ? styles.pickable : styles.unpickable}
                      onMouseEnter={() => setHot(t.i)}
                      onMouseLeave={() => setHot(null)}
                      onClick={() => t.dev && onPick(t.dev.uid)}
                    >
                      <rect
                        className={[
                          styles.pickBox,
                          t.dev ? '' : styles.pickDead,
                          on ? styles.pickOn : '',
                          hot === t.i ? styles.pickHot : '',
                        ].join(' ')}
                        x={t.box[0]} y={t.box[1]}
                        width={t.box[2] - t.box[0]} height={t.box[3] - t.box[1]}
                      />
                      {(hot === t.i || on) && t.dev && (
                        <text
                          className={styles.devLabel}
                          x={t.box[0] + k * 0.5} y={t.box[1] + k * 1.4}
                          style={{ fontSize: k * 1.1, strokeWidth: k * 0.3 }}
                        >
                          U{t.u} · {t.dev.name} · {t.dev.portCount}p
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            </svg>
          )}
        </div>

        <div className={styles.pickFoot}>
          <span className={styles.pickHint}>
            {hotDev && hotDev.dev
              ? `U${hotDev.u} · ${hotDev.dev.name} · ${hotDev.dev.portCount} ports`
              : hotDev
                ? 'This box was never placed on a shelf, so it cannot be matched.'
                : 'Tap the switch in the photo to match it.'}
          </span>
          <button type="button" className={`${styles.secondary} ${styles.small}`} onClick={() => onPick(NOT_HERE)}>
            Not in this rack
          </button>
        </div>
      </div>
    </div>
  );
}
