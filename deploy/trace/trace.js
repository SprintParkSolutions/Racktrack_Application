/* RackTrack Trace.

   A page beside the application, on the same address, so it reads the same
   answers the application reads with the same sign-in - and shows them whole:
   how a scan was tied to a rack, rung by rung; what the comparison with the
   record proposed; and every step the check has been through since. It asks
   and never tells: there is no call here that writes anything. */

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = (iso) => { if (!iso) return ' - '; const d = new Date(iso); return Number.isNaN(d.getTime()) ? esc(iso) : d.toLocaleString(); };

async function ask(path) {
  try {
    const r = await fetch(path, { credentials: 'include' });
    let body = null;
    try { body = await r.json(); } catch { body = null; }
    return { ok: r.ok, status: r.status, body };
  } catch (err) {
    return { ok: false, status: 0, body: { error: String(err && err.message ? err.message : err) } };
  }
}

/* The ladder, in the order the application climbs it. Only the rung that
   answered is known for certain; the rungs above it gave no answer (or it would
   have stopped there) and the rungs below it were never asked. */
const RUNGS = [
  { key: 'record', name: 'The record', what: 'A person, or an earlier scan, has already tied this photograph to a rack.' },
  { key: 'label', name: 'The label, in this room', what: 'The id read off the rack matches a rack set up in the room it was scanned in.' },
  { key: 'label-netbox', name: 'The label, against NetBox', what: 'The id read off the rack matches a rack id or name in the record system.' },
  { key: 'devices', name: 'The devices inside', what: 'Names read off the equipment belong to one rack in the record.' },
  { key: 'only-rack', name: 'The only rack in the room', what: 'The room is set up to hold one rack, and one rack is set up in it.' },
];
const DECISION = {
  matched: ['good', 'Decided'],
  suggested: ['warn', 'Suggested - a person confirms'],
  ambiguous: ['warn', 'More than one rack fits'],
  new: ['warn', 'Not in the record'],
  unknown: ['stop', 'Nothing says which rack'],
};

/* The workflow's main line, in order, in plain words. Anything off the line
   (on hold, sent back, failed) is shown as where the check is now. */
const LINE = [
  ['draft', 'Compared, not sent'], ['submitted', 'Sent to the admin'], ['triage', 'Being sized up'],
  ['assigned', 'Given to a person'], ['accepted', 'Accepted'], ['in_progress', 'Being checked'],
  ['resolved', 'Checked, finding recorded'], ['verification_pending', 'Waiting for a second scan'],
  ['approval_pending', 'Waiting for approval'], ['approved', 'Approved'],
  ['write_in_progress', 'Writing to the record'], ['written', 'Written'], ['completed', 'Done'],
];
const OFF_LINE = {
  pending: 'On hold', rework: 'Sent back for rework', rejected: 'Rejected', write_failed: 'The write failed',
  manual_review: 'Handed to a person after a failed write', reopened: 'Reopened', cancelled: 'Cancelled',
  duplicate: 'A duplicate of another check', known_exception: 'A known exception',
};
const ACTION_WORD = { create: 'Not in the record', update: 'Different in the record', rebind: 'Tie to the record', noop: 'Same in both', skip: 'Left alone', fail: 'Refused' };

const state = { scans: [], plans: [], rackId: null, planId: null, names: new Map() };

async function boot() {
  const me = await ask('/api/auth/me');
  if (!me.ok) {
    $('#who').innerHTML = 'Not signed in.';
    $('#scans').innerHTML = '';
    $('#main').innerHTML = `<div class="empty"><h2>Sign in first</h2>
      <p>This page uses the same sign-in as the application. <a href="/login">Sign in at demo.racktrack.ai</a>, then come back to this address.</p></div>`;
    return;
  }
  const u = me.body.user || me.body;
  $('#who').innerHTML = `Signed in as <b>${esc(u.username || u.email)}</b> - ${esc(u.role || '')}`;

  const [scans, plans] = await Promise.all([ask('/api/scans'), ask('/api/approvals/plans')]);
  state.scans = (scans.body && (scans.body.scans || scans.body)) || [];
  state.plans = (plans.body && plans.body.plans) || [];
  drawScans();

  const fromHash = decodeURIComponent((location.hash || '').replace(/^#/, ''));
  const first = fromHash.split('/')[0] || (state.scans[0] && state.scans[0].rackId);
  if (first) pick(first, Number(fromHash.split('/')[2]) || null);
  nameScans();
}

function drawScans() {
  const box = $('#scans');
  if (!state.scans.length) { box.innerHTML = '<p class="muted pad">No scans yet.</p>'; return; }
  box.innerHTML = state.scans.map((s) => `
    <button type="button" data-rack="${esc(s.rackId)}" aria-current="${s.rackId === state.rackId}">
      <span class="n">${esc(state.names.get(s.rackId) || s.rackId)}</span>
      <span class="m">${esc(s.rackId)} - ${when(s.timestamp)}</span>
    </button>`).join('');
  box.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => pick(b.dataset.rack)));
}

/* Put the rack's own name on each scan, a few at a time so the list is usable at once. */
async function nameScans() {
  for (const s of state.scans.slice(0, 25)) {
    if (state.names.has(s.rackId)) continue;
    const id = await ask(`/api/scan/${encodeURIComponent(s.rackId)}/identity`);
    const rack = id.ok && id.body && (id.body.rack || (id.body.decision === 'suggested' && (id.body.candidates || [])[0]));
    if (rack && (rack.facilityId || rack.name)) { state.names.set(s.rackId, rack.facilityId || rack.name); drawScans(); }
  }
}

async function pick(rackId, planId = null) {
  state.rackId = rackId;
  drawScans();
  $('#main').innerHTML = '<div class="empty"><p>Reading</p></div>';
  const identity = await ask(`/api/scan/${encodeURIComponent(rackId)}/identity`);
  const mine = state.plans.filter((p) => p.rackId === rackId).sort((a, b) => b.id - a.id);
  state.planId = planId && mine.some((p) => p.id === planId) ? planId : (mine[0] ? mine[0].id : null);
  const plan = state.planId ? await ask(`/api/approvals/plans/${state.planId}`) : null;
  history.replaceState(null, '', `#${encodeURIComponent(rackId)}${state.planId ? `/plan/${state.planId}` : ''}`);
  draw(rackId, identity, mine, plan);
}

function draw(rackId, identity, plans, plan) {
  const id = identity.body || {};
  const rack = id.rack || null;
  const title = rack ? (rack.facilityId || rack.name) : rackId;
  if (rack) state.names.set(rackId, title);
  const scan = state.scans.find((s) => s.rackId === rackId) || {};

  $('#main').innerHTML = `
    <div class="head"><h2>${esc(title)}</h2><span class="sub">scan ${esc(rackId)} - ${when(scan.timestamp)}</span></div>
    ${identity.ok ? ladder(id) : `<section><h3>Which rack this is</h3><p class="note warn">The application gave no answer for this scan (${esc(identity.status)} ${esc(id.error || '')}).</p></section>`}
    ${comparison(plans, plan)}
    ${workflow(plan)}`;
  $('#main').querySelectorAll('[data-plan]').forEach((b) => b.addEventListener('click', () => pick(rackId, Number(b.dataset.plan))));
}

/* ── 1. which rack this is ─────────────────────────────────────────────── */
function ladder(id) {
  const [tone, word] = DECISION[id.decision] || ['', id.decision || 'No answer'];
  const at = RUNGS.findIndex((r) => r.key === id.rule);
  const ev = id.evidence || {};
  const labels = (ev.labels || []).map((l) => `${l.normalized || l.text}${l.conf != null ? ` (${Math.round(l.conf * 100)}%)` : ''}${l.source ? ` - ${l.source}` : ''}`);
  const loc = ev.location || null;

  const rows = RUNGS.map((r, i) => {
    let cls = ''; let tag = '<span class="tag">Not reached</span>';
    if (at === -1) { tag = '<span class="tag">No answer</span>'; }
    else if (i < at) { tag = '<span class="tag">No answer</span>'; }
    else if (i === at) {
      cls = id.decision === 'matched' ? 'decided' : 'offered';
      tag = id.decision === 'matched' ? '<span class="tag good">Answered here</span>' : '<span class="tag warn">Offered here</span>';
    }
    return `<li class="rung ${cls}"><span class="no">${i + 1}</span><span class="name">${esc(r.name)}</span><span class="what">${esc(r.what)}</span>${tag}</li>`;
  }).join('');

  const gps = loc && loc.verdict && loc.verdict !== 'unknown'
    ? `<li class="rung ${loc.verdict === 'here' ? 'decided' : 'offered'}"><span class="no">+</span><span class="name">Where the photograph was taken</span>
        <span class="what">${esc(loc.note || '')}${loc.at ? ` (${esc(loc.at.lat)}, ${esc(loc.at.lng)}, within ${esc(loc.at.accuracyM)} m)` : ''}</span>
        <span class="tag ${loc.verdict === 'here' ? 'good' : 'warn'}">${loc.verdict === 'here' ? 'At the site' : esc(loc.verdict)}</span></li>`
    : `<li class="rung"><span class="no">+</span><span class="name">Where the photograph was taken</span><span class="what">The phone gave no position with this photograph.</span><span class="tag">No position</span></li>`;

  const cands = (id.candidates || []).map((c) => `<tr><td>${esc(c.facilityId || c.name || '')}</td><td>${esc(c.source || '')}</td>
      <td class="t">${c.score != null ? Number(c.score).toFixed(2) : ' - '}</td><td>${(c.reasons || []).map(esc).join('<br>')}</td></tr>`).join('');

  return `<section>
    <h3>1. Which rack this is</h3>
    <p class="lede">The application climbs these steps in order and stops at the first one that answers. Only a record or a label read in the right room may state a rack; everything else is offered to a person.</p>
    <div class="kv">
      <div><b>Outcome</b><span><span class="tag ${tone}">${esc(word)}</span></span></div>
      <div><b>Rack</b><span>${esc(id.rack ? (id.rack.facilityId || id.rack.name) : ' - ')}</span></div>
      <div><b>How sure</b><span>${esc(id.confidence || ' - ')}</span></div>
      <div><b>Labels read off the rack</b><span>${labels.length ? labels.map(esc).join('<br>') : 'none read'}</span></div>
      <div><b>Naming pattern</b><span>${esc((ev.pattern && ev.pattern.rackPattern) || 'none set')}</span></div>
      <div><b>Internal key</b><span class="mono">${esc(id.rackKey || ' - ')}</span></div>
    </div>
    <div class="panel" style="margin-top:12px"><ol class="rungs">${rows}${gps}</ol></div>
    ${(ev.notes || []).length ? `<p class="note">${ev.notes.map(esc).join('<br>')}</p>` : ''}
    ${cands ? `<div class="panel tw" style="margin-top:12px"><table><thead><tr><th>Rack considered</th><th>From</th><th>Score</th><th>Why</th></tr></thead><tbody>${cands}</tbody></table></div>` : ''}
  </section>`;
}

/* ── 2. what the comparison found ──────────────────────────────────────── */
function comparison(plans, plan) {
  if (!plans.length) {
    return `<section><h3>2. Compared with the record</h3><p class="note warn">This scan has not been compared yet. Open its Drift screen in the application once and come back.</p></section>`;
  }
  const picker = `<div class="plans">${plans.slice(0, 14).map((p) => `<button type="button" data-plan="${p.id}" aria-current="${p.id === state.planId}">check ${p.id} - ${esc(p.status)}</button>`).join('')}</div>`;
  if (!plan || !plan.ok) return `<section><h3>2. Compared with the record</h3>${picker}<p class="note warn">That check could not be opened.</p></section>`;
  const b = plan.body; const p = b.plan || {}; const items = b.items || [];
  const open = items.filter((i) => i.decidable);
  const counts = p.counts || {};
  const rows = open.slice(0, 60).map((i) => `<tr><td>${esc(i.type)}</td><td>${esc(i.name)}</td><td>${esc(ACTION_WORD[i.action] || i.action)}</td>
      <td>${esc(i.decision || '')}</td><td>${esc(i.reason || '')}</td></tr>`).join('');
  const unseen = (p.orphans || []).filter((o) => !o.seen);
  return `<section>
    <h3>2. Compared with the record</h3>
    <p class="lede">Each time the Drift screen opens the scan is compared again and the result is kept as a check. Nothing in a check is written until an admin approves it.</p>
    ${picker}
    <div class="kv">
      <div><b>Record system</b><span class="mono">${esc(p.netboxUrl || ' - ')}</span></div>
      <div><b>Compared by</b><span>${esc(p.createdBy || ' - ')} - ${when(p.createdAt)}</span></div>
      <div><b>For a person to decide</b><span>${esc((p.summary && p.summary.decidable) ?? open.length)}</span></div>
      <div><b>Same in both</b><span>${esc(counts.noop ?? 0)}</span></div>
      <div><b>Left alone</b><span>${esc(counts.skip ?? 0)}</span></div>
      <div><b>Priority and risk</b><span>${esc(p.priority || ' - ')} - ${esc(p.risk || ' - ')}</span></div>
    </div>
    ${rows ? `<div class="panel tw" style="margin-top:12px"><table><thead><tr><th>Kind</th><th>Name</th><th>What differs</th><th>Decision</th><th>Why</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="note">Nothing in this check needs a decision.</p>'}
    ${unseen.length ? `<div class="panel tw" style="margin-top:12px"><table><thead><tr><th>In the record, not seen in this scan</th><th>Shelf</th><th>Whose record</th></tr></thead><tbody>${
      unseen.map((o) => `<tr><td>${esc(o.name)}</td><td class="t">${o.position != null ? `U${esc(o.position)}` : ' - '}</td><td>${esc(o.whose || '')}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${(p.warnings || []).length ? `<p class="note warn">${p.warnings.length} question${p.warnings.length === 1 ? '' : 's'} for a person: ${esc(p.warnings[0])}${p.warnings.length > 1 ? ' ...' : ''}</p>` : ''}
  </section>`;
}

/* ── 3. what became of the check ───────────────────────────────────────── */
function workflow(plan) {
  if (!plan || !plan.ok) return '';
  const b = plan.body; const p = b.plan || {};
  const at = LINE.findIndex(([k]) => k === p.status);
  const steps = LINE.map(([k, word], i) => `<span class="step ${at > -1 && i < at ? 'done' : ''} ${i === at ? 'now' : ''}">${esc(word)}</span>`).join('');
  const off = at === -1 ? `<p class="note warn">Now: ${esc(OFF_LINE[p.status] || p.status)}.</p>` : '';
  const events = (b.events || []).map((e) => `<tr><td class="t">${when(e.ts)}</td><td>${esc(e.actorName || 'the system')}</td>
      <td>${esc((e.payload && e.payload.what) || e.action)}</td><td>${e.fromStatus === e.toStatus ? esc(e.toStatus || '') : `${esc(e.fromStatus || '')} to ${esc(e.toStatus || '')}`}</td>
      <td>${esc(e.reason || (e.itemUid ? e.itemUid : ''))}</td></tr>`).join('');
  const tickets = (b.tickets || []).map((t) => `<tr><td>${esc(t.itemUid || t.uid || '')}</td><td>${esc(t.assignee || ' - ')}</td><td>${esc(t.status)}</td>
      <td>${esc(t.question || '')}</td><td>${esc(t.finding || '')}</td></tr>`).join('');
  const decisions = (b.decisions || []).map((d) => `<tr><td class="t">${when(d.ts || d.decidedAt)}</td><td>${esc(d.actorName || d.by || '')}</td><td>${esc(d.decision)}</td><td>${esc(d.comment || d.note || '')}</td></tr>`).join('');
  const can = b.can ? Object.entries(b.can).filter(([, v]) => v === true).map(([k]) => k) : [];
  return `<section>
    <h3>3. What became of the check</h3>
    <p class="lede">The person at the rack sends it. An admin sizes it up and hands items to people. Whoever resolves an item may not approve it. Only an approved check is written, and only if the record has not moved since.</p>
    <div class="panel"><div class="steps">${steps}</div></div>
    ${off}
    <div class="kv" style="margin-top:12px">
      <div><b>Sent by</b><span>${esc(p.submittedBy || 'not sent yet')}${p.submittedAt ? ` - ${when(p.submittedAt)}` : ''}</span></div>
      <div><b>Sized up by</b><span>${esc(p.triagedBy || ' - ')}</span></div>
      <div><b>Goes to</b><span>${esc((b.spoc && b.spoc.name) || 'nobody named in the record')}</span></div>
      <div><b>Written</b><span>${p.writtenAt ? `${when(p.writtenAt)} by ${esc(p.writtenBy)}` : 'nothing written'}</span></div>
      <div><b>You may</b><span>${can.length ? can.map(esc).join(', ') : 'read only'}</span></div>
    </div>
    ${tickets ? `<div class="panel tw" style="margin-top:12px"><table><thead><tr><th>Item</th><th>Held by</th><th>State</th><th>Question</th><th>Finding</th></tr></thead><tbody>${tickets}</tbody></table></div>` : ''}
    ${decisions ? `<div class="panel tw" style="margin-top:12px"><table><thead><tr><th>When</th><th>Who</th><th>Decision</th><th>Note</th></tr></thead><tbody>${decisions}</tbody></table></div>` : ''}
    <div class="panel tw" style="margin-top:12px"><table><thead><tr><th>When</th><th>Who</th><th>What happened</th><th>State</th><th>Detail</th></tr></thead><tbody>${events || '<tr><td colspan="5" class="muted">Nothing has happened yet.</td></tr>'}</tbody></table></div>
  </section>`;
}

boot();
