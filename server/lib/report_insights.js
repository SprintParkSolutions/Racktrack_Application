'use strict';

/**
 * Turns a built scan-report payload into the summary box that sits at the top
 * of the report — the four tiers, in the order they are READ rather than the
 * order they were gathered:
 *
 *   1 verdict  one sentence with a count in it
 *   2 actions  what to do, ranked, each carrying its evidence
 *   3 facts    every section of the report as label/value pairs
 *   4 gaps     what we could NOT check
 *
 * Tier 4 is not optional. Without it a short summary reads as "all clear" when
 * it may only mean "we could not see" — on a rack where OCR failed on half the
 * faceplates those are very different statements.
 *
 * DELIBERATELY PURE. No fs, no db, no network, no clock of its own — every
 * input arrives on `data`, `now` is injected. That is what lets the rules be
 * tested against saved fixtures with no rack, no switch and no network, and
 * it is the reason this lives in its own file rather than inside app.js.
 *
 * Nothing here guesses. A rule that cannot prove its claim from the data
 * produces no finding, and the reason lands in `gaps` instead. There is no
 * model in this path: a wrong summary is worse than no summary, and every
 * test below is exact arithmetic on values we already hold.
 */

// ── Thresholds ───────────────────────────────────────────────────────
// Named, not inlined, because these are the numbers someone will want to
// argue with after living with the report for a week.
const FLAP_MIN_DROPS   = 3;    // link-down events in the window before we call it flapping
const FLAP_WINDOW_H    = 24;   // how far back "keeps dropping" looks
const CAPACITY_PCT     = 90;   // ports in use before we suggest planning an uplink
const STALE_POLL_H     = 6;    // no successful poll in this long → say so rather than imply calm
const RECABLE_WINDOW_D = 7;    // neighbour changes worth surfacing

const WORDS = ['no', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
const countWord = (n) => (n < WORDS.length ? WORDS[n] : String(n));

// Drift stores whatever the switch calls a port ("Gi1/0/14", "1/0/14", "14").
// The scan only ever knows the number. Match on the trailing integer, which is
// the same rule server/lib/tplink_parser.js and collectDriftHistory already use.
const portNum = (p) => {
  const m = String(p ?? '').match(/(\d+)$/);
  return m ? Number(m[1]) : null;
};

const speedLabel = (mbps) => {
  const n = Number(mbps);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n >= 1000 ? `${+(n / 1000).toFixed(n % 1000 ? 1 : 0)} Gbps` : `${n} Mbps`;
};

// Accepts ISO strings or epoch millis on either side — `now` is injected as a
// number by callers and by every test, and Date.parse(number) is NaN.
const ms = (v) => (typeof v === 'number' ? v : Date.parse(v));
const hoursBetween = (a, b) => {
  const x = ms(a), y = ms(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return (y - x) / 3_600_000;
};

// "06:42 today" / "22:40 on 5 Aug" — a technician wants the clock time first.
function clockLabel(iso, now) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const sameDay = new Date(now).toDateString() === d.toDateString();
  if (sameDay) return `${hh}:${mm} today`;
  const day = d.getDate();
  const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
  return `${hh}:${mm} on ${day} ${mon}`;
}

function agoLabel(iso, now) {
  const h = hoursBetween(iso, now);
  if (h == null) return null;
  if (h < 1)  return `${Math.max(1, Math.round(h * 60))} minutes ago`;
  if (h < 48) return `${Math.round(h)} hours ago`;
  return `${Math.round(h / 24)} days ago`;
}

// Rack slots that hold nothing identifiable are not devices and must not be
// counted — otherwise "13 devices" on a rack with 3 closed blanks is a lie.
// Kept in step with NON_DEVICE_CLASSES in app.js's renderer: if the Devices
// section does not list them, the summary must not count them either, or the
// box says "10 devices" above a list of six.
const NON_DEVICE = new Set(['Closed Unit', 'Empty', 'Unidentified']);

// Device classes are title-case nouns ("Switch", "Patch Panel", "UPS") that
// have to survive being counted. Naive +"s" produced "5 unidentifieds" and
// "1 switchs"; acronyms must not be lowercased into "1 ups".
function classLabel(name, n) {
  const c = String(name || '').trim();
  if (!c) return '';
  const acronym = c === c.toUpperCase();
  const base = acronym ? c : c.toLowerCase();
  if (n === 1 || acronym) return base;
  if (/ed$/i.test(base)) return base;                 // "unidentified" is already plural-safe
  if (/(s|x|z|ch|sh)$/i.test(base)) return `${base}es`; // switch → switches
  return `${base}s`;
}

// "Switch you picked" is wrong when the technician picked a patch panel.
const isSwitchy = (cls) => /switch|router|firewall|gateway|aggregation/i.test(String(cls || ''));

/**
 * @param {object} data  the object buildScanReportData() returns
 * @param {object} [opts]
 * @param {number|string|Date} [opts.now]  injected clock (tests pin this)
 * @param {(ts:string)=>string} [opts.formatTimestamp]  reuse the report's formatter
 * @returns {{severity:string, verdict:string, stamp:string, actions:Array, facts:Array, gaps:Array}}
 */
function buildInsights(data, opts = {}) {
  const now = opts.now ? new Date(opts.now).getTime() : Date.now();
  const fmtTs = opts.formatTimestamp || ((t) => String(t ?? ''));

  const devices  = Array.isArray(data?.devices) ? data.devices : [];
  const real     = devices.filter(d => !NON_DEVICE.has(d.class_name));
  const sel      = data?.selectedDevice || null;
  const port     = (Array.isArray(data?.port_identifications) ? data.port_identifications : [])[0] || null;
  const mon      = data?.monitoredSwitch || null;
  const events   = Array.isArray(mon?.events) ? mon.events : [];

  const actions = [];
  const facts   = [];
  const gaps    = [];

  // ── Tier 2 · what to do ────────────────────────────────────────────
  // Ordered by how soon someone should act, not by how the data arrived.

  // Flapping. Count only up→down transitions: a flap is one drop plus one
  // recovery, and counting both sides would report every number doubled.
  const flapCutoff = now - FLAP_WINDOW_H * 3_600_000;
  const drops = new Map();               // port → [iso, ...] newest first
  for (const e of events) {
    if (e.field !== 'oper') continue;
    const at = Date.parse(e.at);
    if (!Number.isFinite(at) || at < flapCutoff) continue;
    const wentDown = /down/i.test(String(e.to)) && !/down/i.test(String(e.from));
    if (!wentDown) continue;
    if (!drops.has(e.port)) drops.set(e.port, []);
    drops.get(e.port).push(e.at);
  }
  const flapping = [...drops.entries()]
    .filter(([, list]) => list.length >= FLAP_MIN_DROPS)
    .sort((a, b) => b[1].length - a[1].length);
  for (const [p, list] of flapping) {
    const oldest = list[list.length - 1];
    const newest = list[0];
    actions.push({
      level: 'crit',
      tag: 'Check first',
      text: `Port ${portNum(p) ?? p} has dropped and come back ${list.length} times since ${clockLabel(oldest, now)}.`,
      evidence: `start with the cable, then the transceiver · last drop ${clockLabel(newest, now)}`,
    });
  }

  // A port that went down and never came back. Skipped when it is already
  // reported as flapping — same port, and the flap line is the stronger one.
  const flappingPorts = new Set(flapping.map(([p]) => p));
  const byPortOper = new Map();
  for (const e of events) {
    if (e.field !== 'oper' || byPortOper.has(e.port)) continue;
    byPortOper.set(e.port, e);          // events arrive newest-first
  }
  for (const [p, e] of byPortOper) {
    if (flappingPorts.has(p)) continue;
    if (!/down/i.test(String(e.to)) || /down/i.test(String(e.from))) continue;
    actions.push({
      level: 'warn',
      tag: 'Look at',
      text: `Port ${portNum(p) ?? p} went down and has not come back.`,
      evidence: `down since ${clockLabel(e.at, now)}`,
    });
  }

  // Firmware. Only ever speaks when the lookup actually resolved — "unknown"
  // belongs in gaps, never as a reassuring silence.
  const fw = sel?.firmware;
  if (fw?.ok && fw.upToDate === false && fw.latestVersion) {
    actions.push({
      level: 'warn',
      tag: 'Plan',
      text: `Firmware is behind — ${fw.currentVersion} running, ${fw.latestVersion} available.`,
      evidence: [sel.position, [sel.make, sel.model].filter(Boolean).join(' ')].filter(Boolean).join(' · '),
    });
  }

  // Re-cabling: the neighbour on the far end of a port changed.
  const recableCutoff = now - RECABLE_WINDOW_D * 24 * 3_600_000;
  const seenRecable = new Set();
  for (const e of events) {
    if (e.field !== 'lldp_system' && e.field !== 'lldp_chassis') continue;
    if (seenRecable.has(e.port)) continue;
    const at = Date.parse(e.at);
    if (!Number.isFinite(at) || at < recableCutoff) continue;
    if (!e.to || !e.from || e.to === e.from) continue;
    seenRecable.add(e.port);
    actions.push({
      level: 'warn',
      tag: 'Confirm',
      text: `Port ${portNum(e.port) ?? e.port} was re-cabled — it now reaches ${e.to}, not ${e.from}.`,
      evidence: `changed ${clockLabel(e.at, now)}`,
    });
  }

  // Speed that dropped and stayed down.
  const seenSpeed = new Set();
  for (const e of events) {
    if (e.field !== 'speed_mbps' || seenSpeed.has(e.port)) continue;
    seenSpeed.add(e.port);
    const from = Number(e.from), to = Number(e.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to >= from || to <= 0) continue;
    actions.push({
      level: 'warn',
      tag: 'Look at',
      text: `Port ${portNum(e.port) ?? e.port} renegotiated down — ${speedLabel(from)} to ${speedLabel(to)} — and has stayed there.`,
      evidence: `changed ${clockLabel(e.at, now)}`,
    });
  }

  // Capacity, from the scan alone — no drift needed.
  //
  // Scoped to the SELECTED device only. Every recommendation in this box is
  // about the device the technician actually picked; sweeping the whole rack
  // produced "U12 is nearly full" about a patch panel nobody was looking at,
  // which is true and useless. The rack-wide numbers still appear as a fact
  // below, where context belongs — recommendations stay on the one device.
  const totalPorts = real.reduce((s, d) => s + (d.port_count || 0), 0);
  const usedPorts  = real.reduce((s, d) => s + (d.connected_ports || 0), 0);
  if (sel?.port_count) {
    const pct = Math.round(100 * (sel.connected_ports || 0) / sel.port_count);
    if (pct >= CAPACITY_PCT) {
      actions.push({
        level: 'warn',
        tag: 'Plan',
        text: `${sel.position} is nearly full — ${sel.connected_ports} of ${sel.port_count} ports in use.`,
        evidence: 'plan an uplink before the next install',
      });
    }
  }

  // Stale telemetry is an ACTION, not a footnote: if we have not reached the
  // switch, an empty drift section means nothing and must not read as calm.
  const staleH = mon?.last_seen ? hoursBetween(mon.last_seen, now) : null;
  const stale  = staleH != null && staleH > STALE_POLL_H;
  if (mon && stale) {
    actions.push({
      level: 'warn',
      tag: 'Check first',
      text: `We have not reached ${mon.label || mon.host} for ${String(agoLabel(mon.last_seen, now)).replace(/ ago$/, '')}.`,
      evidence: `nothing below reflects changes made since then${mon.last_error ? ` · ${mon.last_error}` : ''}`,
    });
  }

  const ordered = actions.sort((a, b) => (a.level === 'crit' ? 0 : 1) - (b.level === 'crit' ? 0 : 1));
  const needing = ordered.filter(a => a.level === 'crit' || a.level === 'warn').length;

  // The all-clear line. Only claimed when we actually watched something.
  if (!needing) {
    ordered.push({
      level: 'ok',
      tag: 'Otherwise',
      text: mon && !stale
        ? 'Nothing changed on the ports we watch.'
        : 'Nothing in this scan needs attention.',
      evidence: mon?.last_seen ? `last reached this switch ${agoLabel(mon.last_seen, now)}` : 'from the scan alone',
    });
  }

  // ── Tier 1 · verdict ───────────────────────────────────────────────
  const anyCrit  = ordered.some(a => a.level === 'crit');
  const severity = anyCrit ? 'critical' : needing ? 'attention' : 'clear';

  // An all-clear is only allowed to sound like one when we could actually see.
  // With no linked switch, or a switch we have not reached, "nothing needs
  // attention" would be claiming a result we never measured — the precise
  // failure this summary exists to avoid.
  const limited = !mon || stale;
  const verdict = needing
    ? `${countWord(needing)} thing${needing === 1 ? '' : 's'} need${needing === 1 ? 's' : ''} attention on this rack`
    : limited
      ? 'Nothing needs attention in what we could check'
      : 'Nothing on this rack needs attention';

  const stamp = [
    data?.rackId,
    data?.timestamp ? `scanned ${fmtTs(data.timestamp)}` : null,
    data?.units_range || null,
  ].filter(Boolean).join(' · ');

  // ── Tier 3 · the facts ─────────────────────────────────────────────
  // Every section of the report, so the box can be read instead of it.
  const fact = (k, v, detail, pill) => { if (v) facts.push({ k, v, detail: detail || null, pill: pill || null }); };

  const byClass = {};
  for (const d of real) byClass[d.class_name] = (byClass[d.class_name] || 0) + 1;
  const classLine = Object.entries(byClass)
    .sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `${n} ${classLabel(c, n)}`)
    .join(' · ');
  fact('Rack',
    `${real.length} device${real.length === 1 ? '' : 's'}${data?.units_detected?.length ? ` in ${data.units_detected.length} U` : ''}`,
    classLine || null);

  if (totalPorts) {
    const pct = Math.round(100 * usedPorts / totalPorts);
    fact('Capacity', `${usedPorts} of ${totalPorts} ports in use`, `${pct}% · ${totalPorts - usedPorts} free`);
  }

  if (sel) {
    // Only claim a source when something was actually identified. A bare
    // "read from faceplate, 0%" under a device whose faceplate we could not
    // read at all is worse than saying nothing — it implies a reading exists.
    const identified = !!(sel.make || sel.model);
    const source = !identified ? null
      : sel.model_source === 'user' ? 'you entered this'
      : sel.model_confidence ? `read from faceplate, ${Math.round(sel.model_confidence * 100)}%`
      : 'read from faceplate';
    fact(isSwitchy(sel.class_name) ? 'Switch you picked' : 'Device you picked',
      [sel.position, sel.model || sel.class_name].filter(Boolean).join(' · '),
      [sel.make, source].filter(Boolean).join(' · ') || null);

    const s = sel.specs;
    if (s?.ok && s.specs) {
      const cfg = [s.specs['Port config'], s.specs['Switching capacity (Gbps)'] ? `${s.specs['Switching capacity (Gbps)']} Gbps` : null]
        .filter(Boolean).join(' · ');
      fact('On paper', s.specs.Ports ? `${s.specs.Ports} ports` : (s.specs.SKU || null), cfg || null);
    }

    const running = (fw?.ok && fw.currentVersion) || sel.firmware_version_ocr || null;
    if (running) {
      const pill = fw?.ok && fw.upToDate === false ? { text: 'behind', tone: 'warn' }
                 : fw?.ok && fw.upToDate === true  ? { text: 'current', tone: 'ok' } : null;
      const src = fw?.currentVersionSource === 'ocr' ? 'read from the faceplate'
                : String(fw?.currentVersionSource || '').startsWith('monitored') ? 'read live from the switch' : null;
      fact('Firmware', running,
        [fw?.ok && fw.latestVersion ? `latest ${fw.latestVersion}` : null, src].filter(Boolean).join(' · ') || null,
        pill);
    }
  }

  if (port) {
    const CAT = { main: 'RJ45', sfp: 'SFP', console: 'Console', other: 'USB' };
    const pill = port.status === 'connected' ? { text: 'connected', tone: 'ok' }
               : port.status === 'empty' ? { text: 'empty', tone: 'muted' }
               : port.status ? { text: port.status, tone: 'warn' } : null;
    fact('Port you picked',
      [`${port.port}`, CAT[port.port_category] || port.port_category].filter(Boolean).join(' · '),
      // cable_type already reads "RJ_45 Green" on most rows, so prepending the
      // colour again produced "Green RJ_45 Green". Trust cable_type when it is
      // there; fall back to colour + connector only when it is not.
      [ (port.cable_type || [port.cable_color, port.cable_connector].filter(Boolean).join(' ')) || null,
        port.confidence != null ? `detected ${Math.round(port.confidence * 100)}%` : null,
      ].filter(Boolean).join(' · ') || null,
      pill);

    // What the switch itself reported for that port — the live counterpart to
    // what the camera saw. Only present once the join has found the switch.
    const snap = mon?.portSnapshot;
    if (snap) {
      fact('What the switch said',
        [snap.oper ? (/up/i.test(snap.oper) ? 'Up' : 'Down') : null, speedLabel(snap.speed_mbps), snap.duplex]
          .filter(Boolean).join(' · ') || null,
        [snap.descr || null, snap.lldp_system ? `neighbour ${snap.lldp_system}` : null].filter(Boolean).join(' · ') || null);
    }
  }

  if (mon) {
    const changes = events.length;
    fact('Live port data',
      mon.last_seen ? `polled ${agoLabel(mon.last_seen, now)}` : 'never reached',
      [`${changes} change${changes === 1 ? '' : 's'} in ${mon.window_days} days`, mon.label].filter(Boolean).join(' · '),
      stale ? { text: 'stale', tone: 'warn' } : null);
  }

  // ── Tier 4 · what we could not check ───────────────────────────────
  const unread = real.filter(d => !d.make && !d.model);
  if (unread.length) {
    const where = unread.slice(0, 6).map(d => String(d.position || '').split(/[\s–—-]/)[0]).filter(Boolean).join(', ');
    gaps.push(`we could not read a make or model on ${unread.length} of ${real.length} devices (${where}${unread.length > 6 ? ', …' : ''})`);
  }
  if (!port) {
    gaps.push('no port has been identified on this rack yet, so there is nothing port-level to report');
  }
  if (!mon) {
    gaps.push('this rack is not linked to a monitored switch, so nothing here reflects live port history');
  } else if (stale) {
    gaps.push(`the last successful poll was ${agoLabel(mon.last_seen, now)}`);
  }
  if (sel && !fw?.ok) {
    const why = sel.make && sel.model ? 'no published version was found for this model' : 'we could not read the make and model';
    gaps.push(`firmware could not be checked — ${why}`);
  }

  // ── The paragraph ──────────────────────────────────────────────────
  // The same findings as prose, for someone who would rather read a short
  // account than scan a grid. Assembled from clauses that are simply omitted
  // when their data is missing, so it never contains a dangling "undefined"
  // or a sentence asserting something we did not measure.
  const sentences = [];

  let s1 = `This scan covers ${real.length} device${real.length === 1 ? '' : 's'}`;
  if (data?.units_detected?.length) s1 += ` across ${data.units_detected.length} rack units`;
  if (totalPorts) s1 += `, with ${usedPorts} of ${totalPorts} ports in use`;
  sentences.push(`${s1}.`);

  if (sel) {
    // With a make and model we name the product; without one the class is all
    // we know, and "the patch panel at U12" reads as English where the raw
    // class name ("You selected Patch Panel at U12") does not.
    const named = [sel.make, sel.model].filter(Boolean).join(' ');
    const what = named || String(sel.class_name || 'device').toLowerCase();
    const fwBit = (fw?.ok && fw.currentVersion) || sel.firmware_version_ocr;
    let s = `You selected the ${what} at ${sel.position}`;
    if (fwBit) {
      s += `, running firmware ${fwBit}`;
      if (fw?.ok && fw.upToDate === false && fw.latestVersion) s += ` — ${fw.latestVersion} is available`;
      else if (fw?.ok && fw.upToDate === true) s += ', which is the current release';
    }
    sentences.push(`${s}.`);
  }

  if (port) {
    const CATP = { main: 'RJ45', sfp: 'SFP', console: 'console', other: 'USB' };
    const cat = port.port_category ? (CATP[port.port_category] || port.port_category) : null;
    const article = (w) => (/^[aeiou]/i.test(String(w)) || /^[fhlmnrsx]$/i.test(String(w)[0]) ? 'an' : 'a');
    // Status reads as an adjective, not a clause: "a connected RJ45 port",
    // never "is connected, an RJ45 port".
    let s = `Port ${port.port} is`;
    if (cat) {
      const head = port.status ? `${port.status} ${cat}` : cat;
      s += ` ${article(head)} ${head} port`;
    } else if (port.status) {
      s += ` ${port.status}`;
    }
    // cable_type arrives as "RJ_45 Green" — underscores are a wire-format
    // artefact, not how anyone writes it.
    const cable = (port.cable_type || port.cable_color || '').replace(/_/g, '-').trim();
    if (cable) s += `, with ${article(cable)} ${cable} cable`;
    sentences.push(`${s}.`);

    const snap = mon?.portSnapshot;
    if (snap?.oper) {
      let t = `The switch reports it ${/up/i.test(snap.oper) ? 'up' : 'down'}`;
      const sp = speedLabel(snap.speed_mbps);
      if (sp) t += ` at ${sp}`;
      if (snap.lldp_system) t += `, connected to ${snap.lldp_system}`;
      sentences.push(`${t}.`);
    }
  }

  if (mon) {
    const n = events.length;
    sentences.push(stale
      ? `Live polling of ${mon.label} has stalled — the last successful reading was ${agoLabel(mon.last_seen, now)}, so recent changes may be missing.`
      : `Live polling of ${mon.label} is current, with ${n === 0 ? 'no changes' : `${n} change${n === 1 ? '' : 's'}`} recorded in the last ${mon.window_days} days.`);
  } else {
    sentences.push('This rack is not yet linked to a monitored switch, so the notes above come from the scan alone rather than live port history.');
  }

  const summary = sentences.join(' ');

  return { severity, verdict, stamp, summary, actions: ordered, facts, gaps };
}

module.exports = {
  buildInsights,
  // exported for tests, so the thresholds can be asserted rather than retyped
  FLAP_MIN_DROPS, FLAP_WINDOW_H, CAPACITY_PCT, STALE_POLL_H, RECABLE_WINDOW_D,
};
