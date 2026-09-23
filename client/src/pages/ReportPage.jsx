import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import ThemeToggle from '../components/ThemeToggle.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { useRackFlow } from '../hooks/useRackFlow.js';
import { PORT } from '../utils/rackFlow.js';
import { apiUrl, authFetch } from '../utils/api';
import ExportSheet from '../components/ExportSheet.jsx';
import ShareSheet from '../components/ShareSheet.jsx';
import ReportViewer from '../components/ReportViewer.jsx';
import { downloadExport, saveBlob } from '../utils/exportApi';
import { driftReportUrl } from '../utils/approvals.js';
import { setCached } from '../utils/scanPrefetch';
import { getJSON } from '../utils/safeStorage';
import { matchIsTrusted, serverReportsConfirmations } from '../utils/matchEvidence';
import { useSmartBack } from '../hooks/useSmartBack';
import styles from './ReportPage.module.css';

/**
 * Report - the rack and its network on one page.
 *
 * Scan → Physical → Network → **Report**. The report is the end of the chain:
 * downloading it, pushing it to NetBox and sending it to somebody all happen
 * here, because they are all things you do with the report you are reading.
 *
 * Two witnesses, joined and read-only. The camera gives the layout: which box
 * sits in which U, and what was read off its bezel. A switch reading gives the
 * live truth about that box: its own make, model and serial, every port's
 * state and VLAN, and who it hears on the other end of each cable. Where the
 * two were matched (in Review, on the NetBox side), a device shows both; where
 * they were not, it shows the camera's view and says so.
 *
 * Every value here has a named source. Nothing is filled in.
 *
 * Ported from RackTrack for NetBox. The route carries V1's rack id; the NetBox
 * side keeps its own numeric scan id, obtained (or created) once per visit with
 * POST /api/nb/scans/adopt/:rackId - the same call Export makes.
 */

/**
 * One round trip to the NetBox side of the server, through V1's authFetch.
 * Never throws; a failed request keeps the server's body, because the 409s
 * carry the reason a step could not run and that reason is what gets shown.
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
  try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text.slice(0, 400) }; }
  return { ok: res.ok, status: res.status, body };
}

/** The server's reason, said once, with what to do where the status tells us. */
function explain(r, fallback) {
  const raw = String((r.body && r.body.error) || '').trim();
  const msg = raw ? raw[0].toUpperCase() + raw.slice(1) : fallback;
  // Not the owner: an organisation admin or a site manager can open it too, and
  // on most accounts they are the person actually sitting next to you. Naming
  // the owner sent people up a chain they did not need to climb.
  if (r.status === 403) return 'This report is for an admin. Ask yours to open it.';
  if (r.status === 404) return 'This rack could not be found on the NetBox side. Go back to the rack and open Report again.';
  return msg.endsWith('.') ? msg : `${msg}.`;
}

const IconDownload = () => (
  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);
const IconSend = () => (
  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);
const IconExport = () => (
  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5" />
    <path d="M3 12c0 1.7 4 3 9 3s9-1.3 9-3" />
  </svg>
);

/** Uptime in seconds, as something a person would say. */
function uptimeText(secs) {
  const n = Number(secs || 0);
  if (!n) return '';
  const d = Math.floor(n / 86400);
  const h = Math.floor((n % 86400) / 3600);
  if (d > 0) return `up ${d} day${d === 1 ? '' : 's'}`;
  if (h > 0) return `up ${h} hour${h === 1 ? '' : 's'}`;
  return `up ${Math.max(1, Math.floor(n / 60))} min`;
}

const when = (iso) => {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch { return iso; }
};

// "Unknown" is the camera's word for a make it could not read; "enterprise
// 11863" is SNMP's for a vendor number we could not name. Both are absences.
const noMake = (s) => !s || /^unknown$/i.test(s) || /^enterprise\s*\d+$/i.test(s);
// "Unidentified Switch (24-port)" is the camera's placeholder, not a model.
const noModel = (s) => !s || /^unidentified\b/i.test(s);
const said = (make, model) => [noMake(make) ? '' : make, noModel(model) ? '' : model].filter(Boolean).join(' ');
const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || `${one}s`)}`;
// "Patch Panel" reads as "patch panels" in a sentence. "PDU" does not become
// "pdus", so a word that is all capitals is an abbreviation and is left alone.
const kindWord = (k) => (/^[A-Z0-9]+$/.test(k) ? k : k.toLowerCase());
// A rack nothing has identified is known only by the hash of its photograph,
// which tells a person nothing at all.
const UNNAMED_RACK = /^RK-[0-9A-F]{6,}$/i;

/**
 * The camera names a placed device by its class and U ("Switch U12"). Next to
 * a U badge that repeats itself, so the row shows the class alone; a name a
 * person gave is kept exactly.
 */
function titleOf(d, rackName = '') {
  if (d.role && d.u != null && d.name === `${d.role} U${d.u}`) return d.role;
  let name = String(d.name || d.role || 'Device');
  // "Router U20 SP-HYB-RM01-R01-R1": the rack is the page this is on and the
  // shelf is the badge beside it, so the title keeps the part that is new.
  if (rackName && name.endsWith(rackName)) name = name.slice(0, -rackName.length).trim();
  if (d.u != null) name = name.replace(new RegExp(`\\s+U0?${d.u}$`), '').trim();
  return name || d.role || 'Device';
}

const speedText = (mbps) => (!mbps ? '' : mbps >= 1000 ? `${mbps / 1000}G` : `${mbps}M`);

/** What the camera saw of a cable on a port, reconciled with what the switch shows. */
function cableText(p) {
  if (p.cableColor) return `${p.cableColor}${p.cableType ? ` ${p.cableType}` : ''} cable`;
  if (p.plugged) return 'cabled';
  const live = p.state === 'up' || (p.hosts && p.hosts.length > 0) || Boolean(p.neighbour);
  // The switch proves the port is in use; the camera caught no cable (thin
  // lead, glare, a bend out of frame). Trust the switch, and say who missed it.
  if (live) return p.plugged === false ? 'cabled · camera missed it' : '';
  if (p.plugged === false) return 'empty';
  return '';
}

const PROOF = {
  lldp_both: 'both ends agree',
  lldp_one: 'one end says so',
  manual: 'typed by a person',
};
const proofText = (ev) => PROOF[ev] || String(ev || '').replace(/_/g, ' ');

/**
 * Everything the page says that is not read straight off the report: which
 * words are the camera's and which the switch's, what was heard but not
 * proven, and the list of things nobody has stated.
 *
 * `doc` is the report. `view` is the Review picture for the same scan,
 * optional: it carries the camera's un-merged identity per device and each
 * filed switch's own headline facts. Its unsaved suggestions are never used -
 * a proposal is not a fact.
 *
 * A stored match is not a confirmed one either. Somebody has to say "this
 * switch is that box" on the Review screen; until they do, the make, model and
 * serial this report shows for that device rest on a machine's proposal, and
 * `proposalDevNames` holds the devices where that is the case so the page can
 * say so instead of printing the values as findings.
 *
 * "Nobody confirmed it" and "this page cannot say" are two different things,
 * and the second one is not a reason to print the first one's opposite. Where
 * the Review view could not be loaded, or the server does not report
 * confirmations at all, the row is tagged for what is actually known - the
 * values came off a switch that was matched to this box - and `unsureDevNames`
 * marks them so the page can say that once, plainly.
 */
function derive(doc, view) {
  const devices = doc.devices || [];
  const camByName = new Map((view?.devices || []).map((d) => [d.name, d]));
  const uidToName = new Map((view?.devices || []).map((d) => [d.uid, d.name]));
  const saved = Boolean(view) && !view.suggested;
  const asks = serverReportsConfirmations(view);

  const swByDevName = new Map();
  const proposalDevNames = new Set();   // the server says nobody has confirmed it
  const unsureDevNames = new Set();     // this server cannot say whether anybody did
  if (saved) {
    for (const sw of view.switches || []) {
      if (!sw.read || !sw.matchedTo) continue;
      const name = uidToName.get(sw.matchedTo);
      if (!name) continue;
      swByDevName.set(name, sw);
      if (!asks) unsureDevNames.add(name);
      else if (!matchIsTrusted(view, sw)) proposalDevNames.add(name);
    }
  }

  // The places for this rack have never been saved. Nothing a switch said is in
  // this report, and the page says why rather than quietly being thin: nothing
  // stores a proposal on somebody's behalf any more.
  const placesUnsaved = Boolean(view) && Boolean(view.suggested)
    && (view.switches || []).some((s) => s.read && (s.matchedTo || s.autoMatch?.deviceUid));
  // No Review view at all: the second request failed. Every value that came off
  // a switch is still here, and none of it can be shown as confirmed.
  const viewMissing = !view;

  const filed = view?.switches || [];
  const read = filed.filter((s) => s.read);
  const up = devices.reduce((n, d) => n + (d.portsUp || 0), 0);

  // Neighbours heard on a port that did not become a proven cable: the far
  // end is outside this rack, or not placed in it yet.
  const cabledEnds = new Set();
  for (const c of doc.cables || []) {
    if (c.a) cabledEnds.add(`${c.a.device}|${c.a.port}`);
    if (c.b) cabledEnds.add(`${c.b.device}|${c.b.port}`);
  }
  const heard = [];
  for (const d of devices) {
    for (const p of d.ports || []) {
      if (p.neighbour && !cabledEnds.has(`${d.name}|${p.name}`)) {
        heard.push({ from: d.name, port: p.name, to: p.neighbour.device, toPort: p.neighbour.port });
      }
    }
  }

  return {
    camByName, swByDevName, proposalDevNames, unsureDevNames,
    placesUnsaved, viewMissing, filed, read, up, heard,
  };
}

export default function ReportPage() {
  const { rackId } = useParams();
  const navigate = useNavigate();
  // Which job this rack is in. Checking the rack against the record belongs
  // to analysing the rack; somebody who came here looking a port up is not
  // offered it, on the owner's direction of 22 Sep 2026.
  const flow = useRackFlow(rackId);
  const goBack = useSmartBack(`/results/${rackId}`);

  const [doc, setDoc] = useState(null);     // the report
  const [view, setView] = useState(null);   // the Review picture: camera vs switch, per device
  const [err, setErr] = useState(null);     // { text, hint }
  const [open, setOpen] = useState({});     // which device's ports are shown

  // What this phone read on the Network step. The Network page files each
  // reading on the server, but a filing can fail or not have happened yet, and
  // the report can only contain what the server holds. When the two differ
  // the page says so, with numbers, rather than leave it unexplained.
  const phoneNet = useMemo(() => getJSON(`rt_network_state_${rackId}`, null), [rackId]);

  // The NetBox side's id for this rack, and the three things a finished report
  // is for: keeping it, writing it to the system of record, and sending it to
  // somebody.
  const [scanId, setScanId] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [sharing, setSharing] = useState(null);   // null | 'teams' | 'outlook' | 'link'
  const [menu, setMenu] = useState(null);         // which of the three is open

  // The printed report, read in the app. Both addresses carry a short-lived
  // report token, because a frame and a download can neither of them carry a
  // header: the page for reading, and the server-rendered PDF for the one
  // thing the WebView cannot do for itself, which is save a file.
  const [printed, setPrinted] = useState(null);   // { url, pdfUrl } | null
  /**
   * Open the printed report. It used to hand the PDF's address to the system
   * browser, which threw the person out of the app onto one of our own pages;
   * the report opens here now, and the PDF is one quiet link away inside it.
   */
  const openPrinted = async () => {
    setFileBusy('pdf'); setNote(null);
    try {
      const r = await authFetch(apiUrl(`/api/scan/${encodeURIComponent(rackId)}/report-token`));
      if (!r.ok) throw new Error('The server would not authorise the report.');
      const { token } = await r.json();
      const at = `/api/scan/${encodeURIComponent(rackId)}/report`;
      const t = encodeURIComponent(token);
      const abs = (u) => (/^https?:/.test(u) ? u : `${window.location.origin}${u}`);
      setPrinted({
        url: abs(apiUrl(`${at}?format=html&t=${t}`)),
        pdfUrl: abs(apiUrl(`${at}?format=pdf&download=1&t=${t}`)),
      });
    } catch (e) {
      setNote({ tone: 'bad', text: e.message || 'The report could not be opened.' });
    } finally {
      setFileBusy(null);
    }
  };
  const [fileBusy, setFileBusy] = useState(null);   // 'csv' | 'json' | 'share'
  const [note, setNote] = useState(null);           // { tone, text }

  /* The report on this screen, as a file.
   *
   * The same document the printed view shows, fetched with the same one-shot
   * token, and handed to saveBlob - which writes it into the app's documents
   * and opens the share sheet on a phone, and downloads it in a browser. */
  const saveReport = async () => {
    setFileBusy('report'); setNote(null);
    try {
      const r = await authFetch(apiUrl(`/api/scan/${encodeURIComponent(rackId)}/report-token`));
      if (!r.ok) throw new Error('The server would not authorise the report.');
      const { token } = await r.json();
      const at = apiUrl(`/api/scan/${encodeURIComponent(rackId)}/report?format=pdf&download=1&t=${encodeURIComponent(token)}`);
      const file = await fetch(at);
      if (!file.ok) throw new Error('The report could not be made.');
      const blob = await file.blob();
      const name = `${String(rackId).replace(/[^A-Za-z0-9_-]/g, '_')}-${flow === PORT ? 'port' : 'rack'}-report.pdf`;
      setNote(await saveBlob(blob, name, 'pdf'));
    } catch (e) {
      setNote({ tone: 'bad', text: e.message || 'The report could not be downloaded.' });
    } finally {
      setFileBusy(null);
    }
  };

  /* The drift report: this rack against the record.
   *
   * One of the product's three reports, and the only one that was not on this
   * screen - a single point of contact photographed a rack, opened the report
   * and found no way to the drift report from it (the owner, 23 September
   * 2026). The server picks the check when none is named, and says in a
   * sentence when the rack has never been compared. */
  const saveDrift = async () => {
    setFileBusy('drift'); setNote(null);
    try {
      const at = await driftReportUrl(rackId, null);
      const file = await fetch(`${at}${at.includes('?') ? '&' : '?'}download=1`);
      if (file.status === 404) {
        throw new Error('This rack has not been compared with the record yet. Run the drift check first.');
      }
      if (!file.ok) throw new Error('The drift report could not be made.');
      const blob = await file.blob();
      setNote(await saveBlob(blob, `${String(rackId).replace(/[^A-Za-z0-9_-]/g, '_')}-drift-report.html`, 'html'));
    } catch (e) {
      setNote({ tone: 'bad', text: e.message || 'The drift report could not be downloaded.' });
    } finally {
      setFileBusy(null);
    }
  };

  const getFile = async (kind) => {
    setFileBusy(kind); setNote(null);
    try { setNote(await downloadExport(scanId, rackId, kind)); }
    catch (e) { setNote({ tone: 'bad', text: e.message || 'The download failed.' }); }
    finally { setFileBusy(null); }
  };

  useEffect(() => {
    let live = true;
    setDoc(null); setView(null); setErr(null); setOpen({});
    (async () => {
      // V1's rack id -> the NetBox side's scan id. Idempotent on the server.
      const a = await nb(`/api/nb/scans/adopt/${encodeURIComponent(rackId)}`, { method: 'POST' });
      if (!live) return;
      if (!a.ok || !a.body || a.body.id === undefined || a.body.id === null) {
        setErr({ text: explain(a, 'Could not open this rack on the NetBox side'), hint: a.body?.hint || null });
        return;
      }
      const id = a.body.id;
      setScanId(id);
      // Compare with NetBox now, in the background, so Export opens with the
      // answer already there instead of a spinner.
      nb(`/api/nb/netbox/${id}/preview`, { method: 'POST' })
        .then((r) => { if (r.ok) setCached(`nb-preview:${id}`, { body: r.body, at: Date.now() }); })
        .catch(() => {});
      const [r, v] = await Promise.all([
        nb(`/api/nb/scans/${id}/report`),
        nb(`/api/nb/scans/${id}/reconcile`),
      ]);
      if (!live) return;
      if (!r.ok) {
        setErr({ text: explain(r, 'Could not build the report'), hint: r.body?.hint || null });
        return;
      }
      setDoc(r.body);
      if (v.ok) setView(v.body);   // optional: without it the report still stands
    })();
    return () => { live = false; };
  }, [rackId]);

  const facts = useMemo(() => (doc ? derive(doc, view) : null), [doc, view]);

  const s = (doc && doc.summary) || {};
  const devices = (doc && doc.devices) || [];
  const cables = (doc && doc.cables) || [];
  const vlans = (doc && doc.vlans) || [];
  const addresses = (doc && doc.addresses) || [];
  const switchesRead = facts ? Math.max(facts.read.length, s.switchesRead || 0) : 0;
  const noReadings = Boolean(facts) && switchesRead === 0;
  const hasNetwork = Boolean(facts) && (cables.length > 0 || facts.heard.length > 0 || vlans.length > 0 || addresses.length > 0);
  const addrSwitch = addresses.filter((a) => a.kind === 'switch').length;
  // The name, or plainly that there is not one yet. The hash of a photograph is
  // not a name, and the drift report already says so in words.
  const rackTitle = doc && doc.rackName && !UNNAMED_RACK.test(doc.rackName)
    ? doc.rackName : 'Unidentified rack';
  // What is in the rack, counted by kind. "12 devices" hides the two patch
  // panels and the power strip, and those are the rows a reader looks for and
  // cannot find. The record's own word for a box comes first; where the record
  // has none, the word the camera used.
  const kinds = (() => {
    const by = new Map();
    for (const d of devices) {
      const word = String(d.role || facts?.camByName.get(d.name)?.cvClass || 'Device').trim();
      by.set(word, (by.get(word) || 0) + 1);
    }
    return [...by.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  })();
  // Rows whose values came off a switch rather than the camera. Which caveat
  // they carry depends on what is known about the match behind them.
  const fromSwitch = devices.some((d) => String(d.source || '').startsWith('switch'));
  const unsureAll = Boolean(facts) && facts.viewMissing && fromSwitch;
  const anyUnsure = Boolean(facts) && (unsureAll || facts.unsureDevNames.size > 0);
  const anyProposal = Boolean(facts) && facts.proposalDevNames.size > 0;
  const toneFor = (name) => {
    if (facts.proposalDevNames.has(name)) return 'proposal';
    if (unsureAll || facts.unsureDevNames.has(name)) return 'unsure';
    return 'switch';
  };

  return (
    <div className={`page page-full ${styles.page}`}>
      {/* The header is the report's own title block: what kind of document this
          is, which rack it is about, and where and when it was read. The page
          used to open with the word "Report" and then say the site, the rack
          and the time again in a block of its own, which is the same three
          facts twice. */}
      <PageHeader
        eyebrow="Report"
        title={doc ? rackTitle : 'Report'}
        sub={doc ? [doc.siteName, doc.scannedAt ? `read ${when(doc.scannedAt)}` : null,
          doc.changeNote || null].filter(Boolean).join(' · ') : null}
        back={goBack}
        action={<ThemeToggle />}
      />

      {/* One row, not three cards. Checking the rack against the record is what
          a person does next, so it is the one filled control and it says so in
          words; downloading and sharing are quiet text controls beside it, each
          opening its own choices. Three equal bordered cards with carets put a
          file format, a destination and the next step of the workflow on the
          same footing, and the step that matters was the middle of them. */}
      <div className={styles.tools}>
        {flow !== PORT && (
          <button
            type="button"
            className={styles.check}
            disabled={!doc || scanId === null}
            onClick={() => navigate(`/results/${encodeURIComponent(rackId)}/drift`)}
          >
            Drift check
          </button>
        )}
        {/* One control, one file: the report on this screen. It was a menu of
            CSV, JSON and PDF, of which the first two are the NetBox export -
            a different document - so pressing Download handed people a report
            they were not reading (the owner, 23 September 2026). The NetBox
            files keep their own control beside it. */}
        <button
          type="button"
          className={styles.quiet}
          disabled={!doc || fileBusy === 'report'}
          onClick={saveReport}
        >
          <IconDownload />
          {fileBusy === 'report' ? 'Preparing' : 'Download'}
        </button>
        {/* And the drift report, which is a different document about the same
            rack: what differs from the record. */}
        {flow !== PORT && (
          <button
            type="button"
            className={styles.quiet}
            disabled={!doc || fileBusy === 'drift'}
            onClick={saveDrift}
          >
            <IconDownload />
            {fileBusy === 'drift' ? 'Preparing' : 'Drift report'}
          </button>
        )}
        {[
          ['netbox', 'NetBox files', <IconExport key="i" />, [
            ['CSV for NetBox', () => getFile('csv'), fileBusy === 'csv'],
            ['JSON bundle', () => getFile('json'), fileBusy === 'json'],
          ]],
          ['share', 'Share', <IconSend key="i" />, [
            ['Teams', () => setSharing('teams'), false],
            ['Email', () => setSharing('outlook'), false],
            ['Link', () => setSharing('link'), false],
          ]],
        ].map(([key, label, icon, items]) => (
          <div key={key} className={styles.menuWrap}>
            <button
              type="button"
              className={`${styles.quiet} ${menu === key ? styles.quietOpen : ''}`}
              aria-haspopup="menu"
              aria-expanded={menu === key}
              disabled={!doc || (key !== 'share' && scanId === null)}
              onClick={() => setMenu(menu === key ? null : key)}
            >
              {icon}
              <span>{label}</span>
            </button>
            {menu === key && (
              <>
                <button type="button" tabIndex={-1} aria-hidden="true" className={styles.menuScrim} onClick={() => setMenu(null)} />
                <div className={styles.menu} role="menu">
                  {items.map(([text, run, busy]) => (
                    <button key={text} type="button" role="menuitem" disabled={busy || fileBusy !== null}
                      onClick={() => { setMenu(null); run(); }}>
                      {busy ? `${text}…` : text}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      {note && <p className={note.tone === 'bad' ? styles.noteBad : styles.noteOk}>{note.text}</p>}

      <div className={styles.scroll}>
        {!doc && !err && (
          <p className={styles.working}>
            <span className={styles.spinner} />
            Building the report…
          </p>
        )}

        {err && (
          <div className={`${styles.note} ${styles.noteBad}`}>
            <h3>Could not build the report</h3>
            <p>{err.text}</p>
            {err.hint && <p className={styles.hint}>{err.hint}</p>}
            <Link to={`/results/${rackId}`} className={styles.linkBtn}>Open the rack</Link>
          </div>
        )}

        {doc && facts && (
          <>
            {/* The figures, under a heading like every other part of the page.
                Devices and Network announce themselves; the numbers above them
                did not, so the page began in the middle of itself. */}
            <div className={styles.secHead}>
              <h2>Summary</h2>
              <span>what this rack holds</span>
            </div>

            {/* At a glance.
                A wrapping row of number-and-word pairs put "6 ADDRESSES" alone
                on a third line and left every column ragged - nine facts in a
                shape that has to be read rather than seen. A fixed grid for the
                counts, and the ports as what they actually are: a proportion,
                drawn. */}
            {(() => {
              const ports = s.ports || 0;
              const inUse = s.portsInUse ?? facts.up ?? 0;
              const free = Math.max(0, ports - inUse);
              const pct = ports ? Math.round((inUse / ports) * 100) : 0;
              const cells = [
                [s.devices || 0, 'devices'],
                [switchesRead, `switch${switchesRead === 1 ? '' : 'es'} read`],
                // In use counts a cable or a link; this counts the links the
                // switches say are up, which is not the same number and was the
                // one fact the summary held and never said.
                [s.portsUp ?? facts.up ?? 0, 'links up'],
                [s.seen || 0, 'plugged in'],
                [s.cables || 0, 'cables'],
                [s.vlans || 0, 'VLANs'],
                [s.addresses || 0, 'addresses'],
              ].filter(([n]) => n > 0);
              return (
                <div className={styles.glance}>
                  {ports > 0 && (
                    <div className={styles.ports}>
                      <div className={styles.portsHead}>
                        <span>Ports</span>
                        <b>{inUse} of {ports} in use</b>
                      </div>
                      <div className={styles.bar} role="img"
                        aria-label={`${pct} per cent of ports in use`}>
                        <i style={{ width: `${pct}%` }} />
                      </div>
                      <div className={styles.portsFoot}>
                        <span><b>{inUse}</b> in use</span>
                        <span><b>{free}</b> free</span>
                        <span>{pct}%</span>
                      </div>
                    </div>
                  )}
                  {cells.length > 0 && (
                    <div className={styles.grid}>
                      {cells.map(([n, what]) => (
                        <div key={what}><b>{n}</b><span>{what}</span></div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            {noReadings && (
              <div className={`${styles.note} ${styles.noteInfo}`}>
                <h3>No switch reading has been filed for this rack yet</h3>
                <p>
                  The rack below is what the camera saw. Port state, VLANs and
                  neighbours come from the switches.
                </p>
                {phoneNet && phoneNet.read > 0 && (
                  <p className={styles.hint}>
                    This phone read {plural(phoneNet.read, 'switch', 'switches')}, but the
                    readings have not reached the server yet.
                  </p>
                )}
                <Link to={`/results/${rackId}/network`} className={styles.linkBtn}>Open Network</Link>
              </div>
            )}

            {/* ── The rack, top down ── */}
            <section className={styles.section}>
              <div className={styles.secHead}>
                <h2>Rack</h2>
                <span>{plural(devices.length, 'device')} · top down</span>
              </div>

              {kinds.length > 1 && (
                <p className={styles.subLine}>
                  {kinds.map(([k, n]) => plural(n, kindWord(k))).join(' · ')}
                </p>
              )}

              {devices.length === 0 && (
                <p className={styles.emptyLine}>The camera saw no devices in this rack.</p>
              )}

              {/* Nothing was stored for this rack, so the switch readings are
                  not in this report at all. Without this line the page simply
                  looks thin, and a reader takes the camera's view for
                  everything there is. */}
              {facts.placesUnsaved && (
                <p className={styles.proposalNote}>
                  Nothing the switches said is in this report yet.{' '}
                  <Link to={`/results/${rackId}/review`}>Open Review</Link> to confirm which
                  switch is which box.
                </p>
              )}


              {anyUnsure && (
                <p className={styles.proposalNote}>
                  {facts.viewMissing
                    ? 'The matching could not be loaded, so nothing below is shown as confirmed.'
                    : 'Nobody is recorded as confirming these matches.'}
                </p>
              )}

              <div className={styles.rows}>
                {devices.map((d) => {
                  const key = `${d.u ?? 'x'}-${d.name}`;
                  return (
                    <DeviceRow
                      key={key}
                      d={d}
                      cam={facts.camByName.get(d.name) || null}
                      sw={facts.swByDevName.get(d.name) || null}
                      tone={toneFor(d.name)}
                      rackName={doc.rackName || ''}
                      open={Boolean(open[key])}
                      onToggle={() => setOpen((o) => ({ ...o, [key]: !o[key] }))}
                    />
                  );
                })}
              </div>
            </section>

            {/* ── Network: what the switches said about each other ── */}
            {hasNetwork && (
              <section className={styles.section}>
                <div className={styles.secHead}>
                  <h2>Network</h2>
                  <span>from the switches</span>
                </div>

                {/* "Both ends agree" is proof about the cable, not about which
                    box each end is. That part rests on the same match as the
                    rows above, so the same caveat belongs here. */}
                {(anyProposal || anyUnsure) && (
                  <p className={styles.subLine}>
                    {anyProposal
                      ? 'The box at each end rests on a match nobody has confirmed.'
                      : 'The box at each end rests on a match that cannot be shown as confirmed.'}
                  </p>
                )}

                {cables.length > 0 && (
                  <div className={styles.sub}>
                    <h3>Cables <span className={styles.count}>{cables.length}</span></h3>
                    <ul className={styles.links}>
                      {cables.map((c, i) => (
                        <li key={i}>
                          <span className={styles.end}><b>{c.a?.device || ' - '}</b> {c.a?.port || ''}</span>
                          <span className={styles.arrow} aria-hidden="true">→</span>
                          <span className={styles.end}><b>{c.b?.device || ' - '}</b> {c.b?.port || ''}</span>
                          <span className={`${styles.proof} ${c.evidence === 'lldp_both' ? styles.proofGood : ''}`}>
                            {proofText(c.evidence)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {facts.heard.length > 0 && (
                  <div className={styles.sub}>
                    <h3>Neighbours heard <span className={styles.count}>{facts.heard.length}</span></h3>
                    <ul className={styles.links}>
                      {facts.heard.map((h, i) => (
                        <li key={i}>
                          <span className={styles.end}><b>{h.from}</b> {h.port}</span>
                          <span className={styles.arrow} aria-hidden="true">→</span>
                          <span className={styles.end}><b>{h.to}</b> {h.toPort}</span>
                          <span className={styles.proof}>LLDP</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {vlans.length > 0 && (
                  <div className={styles.sub}>
                    <h3>VLANs <span className={styles.count}>{vlans.length}</span></h3>
                    <div className={styles.chips}>
                      {vlans.map((v) => (
                        <span key={v.id} className={styles.chip}>
                          <b>{v.id}</b>
                          {v.name && String(v.name) !== String(v.id) ? ` ${v.name}` : ''}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {addresses.length > 0 && (
                  <div className={styles.sub}>
                    <h3>Addresses <span className={styles.count}>{addresses.length}</span></h3>
                    <p className={styles.subLine}>
                      {addrSwitch} on switches · {addresses.length - addrSwitch} on things plugged into them
                    </p>
                    <AddressList rows={addresses} />
                  </div>
                )}
              </section>
            )}

          </>
        )}

      </div>

      {exporting && scanId !== null && (
        <ExportSheet scanId={scanId} rackId={rackId} onClose={() => setExporting(false)} />
      )}
      {sharing && <ShareSheet rackId={rackId} initial={sharing} onClose={() => setSharing(null)} />}

      {/* The printed report, over this page. Sending it is the app's own way of
          handing it to somebody, so that button is here rather than a trip out. */}
      {printed && (
        <ReportViewer
          title="Report"
          url={printed.url}
          browserUrl={printed.pdfUrl}
          onClose={() => setPrinted(null)}
        >
          <button type="button" onClick={() => { setPrinted(null); setSharing('outlook'); }}>
            Send it
          </button>
        </ReportViewer>
      )}
    </div>
  );
}

/**
 * One device: its U, what the camera saw, and - where a switch was matched to
 * it - what the switch said about itself. Ports fold out underneath.
 *
 * `tone` says how far the switch's word can be taken: 'switch' when a person
 * confirmed the match, 'proposal' when the server says nobody has, and
 * 'unsure' when nothing here can say either way.
 */
function DeviceRow({ d, cam, sw, tone = 'switch', rackName = '', open, onToggle }) {
  const matched = String(d.source || '').startsWith('switch');
  const proposal = tone === 'proposal';
  const unsure = tone === 'unsure';
  const ports = d.ports || [];
  const inUse = ports.filter((p) => p.inUse).length;
  // The list opens on the ports that are doing something; "View all" is the
  // rest, one tap away, with the count so nobody has to guess how long it is.
  const [showAll, setShowAll] = useState(false);
  const cabled = ports.filter((p) => p.plugged === true).length;

  // A report states what is there. "Make and model not read" is not a fact
  // about the rack, it is a fact about us, and printing it on every row a
  // camera could not read made the page look like a list of failures.
  const camMake = cam ? cam.make : (matched ? '' : d.vendor);
  const camModel = cam ? cam.model : (matched ? '' : d.model);
  const camPorts = cam ? cam.portCount : (matched ? null : d.portCount);
  // A router's make and model are not read off its face: the owner does not
  // want them, and the camera's guess at a small box's lettering ("MOXA" on an
  // ISP router) was wrong more often than it was right. What a matched switch
  // says about itself still stands.
  const isRouter = /router/i.test(String(d.role || d.name || ''));
  const identity = matched ? said(sw ? sw.vendor : d.vendor, sw ? sw.model : d.model)
    : (isRouter ? '' : said(camMake, camModel));

  // What kind of box it is, in the record's own word, or the camera's where the
  // record has none. Where the title is already that word - "Switch U12" is
  // titled "Switch" - saying it again is noise, so it is said once.
  const titleText = titleOf(d, rackName);
  const kind = String(d.role || cam?.cvClass || '').trim();
  const kindShown = kind && kind.toLowerCase() !== titleText.toLowerCase() ? kind : '';

  // How it is doing, as numbers with their names - a sentence of six facts
  // separated by dots wraps into a shape nobody can scan, and "1 of 28 ports
  // up" next to a button saying "16 ports in use" reads as a contradiction
  // when it is two different questions. Each count is labelled with what it
  // counts, and they sit next to each other so the comparison is the layout.
  const stats = [
    [d.portCount || camPorts || 0, 'ports'],
    [inUse, 'in use'],
    [d.portsUp, 'up'],
    [cabled, 'cabled'],
    [d.seen, 'devices'],
  ].filter(([n]) => n != null && n > 0);

  // Who it is, for anyone who has to find it again. The report holds more about
  // a box than the five facts this used to print: the kind of box, the name the
  // switch answers to, where the switch says it is standing, and which of the
  // two witnesses the row was read from. All of it is here, none of it invented.
  const ids = [
    ['role', kindShown],
    ['at', d.mgmtIp],
    ['known as', sw ? sw.sysName : null],
    ['serial', d.serial],
    ['hardware', d.hardware],
    ['firmware', d.firmware],
    ['location', d.location],
    ['up', d.uptimeSeconds ? uptimeText(d.uptimeSeconds).replace(/^up /, '') : null],
    // Which witness this row was read from, said plainly on every row rather
    // than only on the ones a switch was matched to.
    ['read from', matched ? 'the switch and the photograph' : 'the photograph'],
  ].filter(([, v]) => v);

  // The witness that knows most goes first. A matched device is the switch
  // stating what it is; an unmatched one is the camera guessing. Naming the
  // other witness inline reads better than a label column, which squeezed the
  // sentence into three words a line on a phone.
  return (
    <div className={styles.row}>
      <span className={`${styles.u} ${d.u == null ? styles.uNone : ''}`}>
        {d.u != null ? `U${d.u}` : ' - '}
      </span>
      <div className={styles.rowMain}>
        {/* Closed, a device is one glance: what it is, what it says it is, and
            how many of its ports are busy. The owner read the old card - five
            counts, five identifiers and a button, on every device - as clutter;
            all of that is still here, one tap away. */}
        <button type="button" className={styles.rowHead} aria-expanded={open} onClick={onToggle}>
          <span className={styles.rowTop}>
            <b className={styles.rowTitle}>{titleText}</b>
            {/* One phrase for every matched device, and the colour carries the
                rest: green where a person confirmed the match, orange where
                nobody has yet. The owner did not want it spelled out each time. */}
            {matched && (
              <span className={proposal || unsure ? styles.tagProposal : styles.tag}
                data-match={proposal ? 'proposal' : unsure ? 'unsure' : 'confirmed'}
                title={proposal || unsure ? 'Matched to a switch. Nobody has confirmed it yet.' : 'Matched to a switch, and confirmed.'}>
                from the switch
              </span>
            )}
          </span>
          <span className={styles.rowSub}>
            {/* A switch says its make and model; a patch panel has neither, and
                used to show a bare title with nothing under it. It says what
                kind of box it is instead - one line either way, no clutter. */}
            {identity ? <span className={styles.said}>{identity}</span>
              : kindShown ? <span className={styles.said}>{kindShown}</span> : null}
            {(d.portCount || camPorts) ? (
              <span className={styles.rowBusy}>{inUse} of {d.portCount || camPorts} ports in use</span>
            ) : null}
          </span>
          <svg className={`${styles.chev} ${open ? styles.chevOpen : ''}`} aria-hidden="true" width="18" height="18"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {/* The tag beside the title already says "proposal, not confirmed" or "from a
            matched switch" on this very row, so a paragraph under it saying the same
            thing in a sentence was the caveat twice. The tag is the caveat. */}

        {open && stats.length > 0 && (
          <div className={styles.stats}>
            {stats.map(([n, what]) => (
              <div key={what}><b>{n}</b><span>{what}</span></div>
            ))}
          </div>
        )}

        {open && ids.length > 0 && (
          <dl className={styles.ids}>
            {ids.map(([k, v]) => (
              <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
        )}

        {open && ports.length > 0 && inUse > 0 && ports.length > inUse && (
          <div className={styles.moreRow}>
            <button type="button" className={styles.more} onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'In use only' : `View all ${ports.length} ports`}
            </button>
          </div>
        )}
        {open && (
          <PortList
            ports={showAll || inUse === 0 ? ports : ports.filter((p) => p.inUse)}
            total={ports.length}
            all={showAll || inUse === 0}
          />
        )}
      </div>
    </div>
  );
}

/**
 * The addresses, one line each.
 *
 * The report has carried every address the switches know for a long time and
 * the page printed two numbers from it. A reader who wants to find a thing in
 * the rack wants the addresses themselves: the switches' own first, because
 * those are the ones somebody signs in to, then everything they have heard.
 * Long lists fold, the same way a device's ports do.
 */
function AddressList({ rows }) {
  const [showAll, setShowAll] = useState(false);
  const ordered = [...rows].sort((a, b) => (a.kind === 'switch' ? 0 : 1) - (b.kind === 'switch' ? 0 : 1));
  const shown = showAll ? ordered : ordered.slice(0, 8);
  return (
    <>
      <ul className={styles.links}>
        {shown.map((a, i) => (
          <li key={`${a.ip}-${a.on}-${i}`}>
            <span className={styles.end}><b>{a.ip}</b></span>
            <span className={styles.arrow} aria-hidden="true">→</span>
            <span className={styles.end}>{a.on}{a.mac ? ` · ${a.mac}` : ''}</span>
            <span className={styles.proof}>{a.kind === 'switch' ? 'the switch itself' : 'heard on it'}</span>
          </li>
        ))}
      </ul>
      {ordered.length > shown.length || showAll ? (
        <div className={styles.moreRow}>
          <button type="button" className={styles.more} onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Show fewer' : `View all ${ordered.length} addresses`}
          </button>
        </div>
      ) : null}
    </>
  );
}

/** The ports in use, one line each: the switch's view and the camera's, side by side. */
function PortList({ ports, total, all = false }) {
  return (
    <div className={styles.ports}>
      {ports.map((p, i) => {
        const cable = cableText(p);
        const hosts = p.hosts || [];
        // Every address the switch heard on this port, not only the first of
        // them: "2 hosts · 10.0.0.5" left the second one unnamed on the page
        // that is supposed to be the whole record of the rack.
        const ips = hosts.map((h) => h.ip).filter(Boolean);
        // A thing the switch has heard but nobody has an address for is known by
        // its hardware address and nothing else. That is still who is on the
        // port, so it is said rather than counted and dropped.
        const macs = ips.length ? [] : hosts.map((h) => h.mac).filter(Boolean);
        return (
          <div key={`${p.name}-${i}`} className={styles.port}>
            <span className={styles.portName}>{p.name}</span>
            <span className={styles.portFacts}>
              {p.state && (
                <span className={p.state === 'up' ? styles.up : styles.down}>{p.state}</span>
              )}
              {p.state === 'up' && p.speedMbps ? <span>{speedText(p.speedMbps)}</span> : null}
              {p.state === 'up' && p.duplex ? <span>{String(p.duplex).toLowerCase()} duplex</span> : null}
              {p.vlan != null && <span>VLAN {p.vlan}</span>}
              {p.neighbour && (
                <span>→ {p.neighbour.device}{p.neighbour.port ? ` ${p.neighbour.port}` : ''}</span>
              )}
              {cable && <span>{cable}</span>}
              {hosts.length > 0 && (
                <span>
                  {plural(hosts.length, 'host')}
                  {ips.length ? ` · ${ips.slice(0, 4).join(', ')}` : ''}
                  {ips.length > 4 ? ` and ${ips.length - 4} more` : ''}
                  {macs.length ? ` · ${macs.slice(0, 2).join(', ')}` : ''}
                  {macs.length > 2 ? ` and ${macs.length - 2} more` : ''}
                </span>
              )}
            </span>
          </div>
        );
      })}
      <p className={styles.portNote}>
        {all ? `All ${total} ports.` : `${ports.length} of ${total} ports in use.`}
      </p>
    </div>
  );
}
