/**
 * The one ServiceNow incident of a check, against a fake instance.
 *
 * The service on a throwaway database, as in submit-assign.test.js, with a
 * ServiceNow that lives in this file handed in through incidents._setDeps.
 * Nothing here reaches a network. What is pinned:
 *
 *   - the incident is raised when the check is sent, in the SPOC's name, the
 *     answer to the send carries its number, and every ticket carries a copy
 *   - two sends at once raise one incident; a later check raises its own
 *   - nobody in ServiceNow with the SPOC's email: raised all the same,
 *     unassigned, and the admins are warned
 *   - the drift report and the photograph go up after the answer, each is
 *     recorded, and a retry sends only what is missing
 *   - each outcome reaches the incident: from the route's own call for reject,
 *     rework and cancel, and from the bus when a write finishes or fails
 *   - the close code comes from the instance's own list, and from the stock
 *     ones when the list is refused
 *   - what ServiceNow refuses is owed, tried again, and given up on at eight
 *   - an incident closed over there is flagged and decides nothing; a closure
 *     RackTrack pushed is not read back as anything
 *   - no ServiceNow at all: the same flow, with `system: 'none'`
 *   - a dead instance does not hold the send
 */
process.env.NODE_ENV = 'test';
process.env.RACKTRACK_SKIP_WORKER_POOL = '1';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, afterEach, before, beforeEach, describe, it } = require('node:test');

let tmp;
let store;
let service;
let incidents;
let spoc;
let bus;
let tickets;

const user = (id, username, role, tenantId = 32, orgId = 1) => ({ id, username,
  email: `${username}@dc007.example`, role, organization_id: orgId, tenant_id: tenantId });
const TECH = user(39, 'dc007.tech', 'member');
const SPOC = user(41, 'dc007.spoc', 'site_manager');
const OTHER = user(42, 'dc007.member', 'member');
const ADMIN = user(44, 'Aasritha', 'org_admin', 33);

const CFG = { instanceUrl: 'https://acme.service-now.com', username: 'svc', password: 'x', incidentTable: 'incident' };
const STOCK_CODES = [
  { value: 'Duplicate', label: 'Duplicate', sequence: 1 },
  { value: 'Resolved by caller', label: 'Resolved by caller', sequence: 2 },
  { value: 'No resolution provided', label: 'No resolution provided', sequence: 3 },
  { value: 'Solution provided', label: 'Solution provided', sequence: 4 },
];

/**
 * A ServiceNow small enough to read: users by email, incidents by correlation
 * id and sys_id, the two choice lists, and attachments. `refuse(call)` answers
 * a canned refusal for the calls it picks; `hang` never answers at all.
 */
function instance({ users = [{ sys_id: 'u-spoc', name: 'DC007 Spoc', email: SPOC.email },
  { sys_id: 'u-tech', name: 'DC007 Tech', email: TECH.email },
  { sys_id: 'u-other', name: 'DC007 Member', email: OTHER.email }], closeCodes = STOCK_CODES } = {}) {
  const sn = { calls: [], rows: new Map(), files: [], refuse: null, hang: false, slow: 0, slowFiles: 0,
    users, closeCodes, n: 0 };
  const ok = (result, status = 200) => ({ ok: true, status, body: { result } });
  sn.of = (method, part) => sn.calls.filter((c) => c.method === method && c.url.includes(part));
  sn.fetch = async (url, method, headers, body) => {
    const call = { url: decodeURIComponent(url), method, headers, body };
    sn.calls.push(call);
    if (sn.hang) return new Promise(() => {});
    if (sn.slow) await new Promise((r) => setTimeout(r, sn.slow));
    const no = sn.refuse && sn.refuse(call);
    if (no instanceof Error) throw no;
    if (no) return no;
    const u = new URL(url);
    const query = u.searchParams.get('sysparm_query') || '';
    if (u.pathname.endsWith('/table/sys_user')) {
      const asked = (query.match(/emailIN([^^]*)/) || [])[1].split(',');
      return ok(sn.users.filter((x) => asked.includes(x.email.toLowerCase())));
    }
    if (u.pathname.endsWith('/table/sys_choice')) {
      return ok(/element=close_code/.test(query) ? sn.closeCodes
        : [{ value: '1', label: 'Awaiting Caller', sequence: 1 }, { value: '5', label: 'Awaiting Change', sequence: 5 }]);
    }
    if (u.pathname === '/api/now/attachment/file') {
      if (sn.slowFiles) await new Promise((r) => setTimeout(r, sn.slowFiles));
      sn.files.push({ name: u.searchParams.get('file_name'), on: u.searchParams.get('table_sys_id'),
        type: headers['Content-Type'], body });
      return ok({ sys_id: `att-${sn.files.length}`, file_name: u.searchParams.get('file_name'), size_bytes: body.length }, 201);
    }
    if (method === 'GET' && /correlation_id=/.test(query)) {
      const id = query.split('correlation_id=')[1];
      return ok([...sn.rows.values()].filter((r) => r.correlation_id === id));
    }
    if (method === 'GET' && /sys_idIN/.test(query)) {
      const ids = query.split('sys_idIN')[1].split(',');
      return ok(ids.map((id) => sn.rows.get(id)).filter(Boolean));
    }
    if (method === 'POST') {
      sn.n += 1;
      const row = { ...body, sys_id: `inc-${sn.n}`, number: `INC00100${40 + sn.n}`, state: '1',
        assigned_to: body.assigned_to ? { link: 'x', value: body.assigned_to } : '' };
      sn.rows.set(row.sys_id, row);
      return ok(row, 201);
    }
    if (method === 'PATCH') {
      const row = sn.rows.get(u.pathname.split('/').pop());
      if (!row) return { ok: false, status: 404, body: { error: { message: 'No Record found' } } };
      Object.assign(row, body, body.state ? { state: String(body.state) } : {});
      return ok(row);
    }
    throw new Error(`the fake instance does not know ${method} ${url}`);
  };
  return sn;
}
const refusal = (status, message) => ({ ok: false, status, body: { error: { message }, status: 'failure' } });

let sn;
let heard;
let stop = [];
const listen = (event) => { const fn = (p) => heard.push({ event, ...p }); bus.on(event, fn); return () => bus.off(event, fn); };
const problems = () => heard.filter((h) => h.event === 'incident_failed').map((h) => h.problem);
const settle = () => new Promise((r) => setTimeout(r, 20));

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-incidents-'));
  process.env.RACKTRACK_APPROVALS_DB = path.join(tmp, 'approvals.db');
  process.env.RT_DATA_DIR = tmp;
  process.env.RT_OUTPUTS_DIR = path.join(tmp, 'outputs');
  store = require('../../lib/approvals/store');
  service = require('../../lib/approvals/service');
  incidents = require('../../lib/approvals/incidents');
  spoc = require('../../lib/approvals/spoc');
  bus = require('../../lib/approvals/bus');
  tickets = require('../../lib/netbox/tickets');
  const db = store.db();
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenants (id INTEGER PRIMARY KEY, name TEXT, slug TEXT,
      organization_id INTEGER, timezone TEXT, approver_user_id INTEGER, approver_email TEXT);
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT, email TEXT,
      role TEXT, tenant_id INTEGER, organization_id INTEGER, active INTEGER NOT NULL DEFAULT 1);
    INSERT INTO tenants (id, name, slug, organization_id, approver_user_id)
      VALUES (32, 'Office-Sprintpark', 'office', 1, 41);
    INSERT INTO tenants (id, name, slug, organization_id) VALUES (33, 'Annex', 'annex', 1);
  `);
  const add = db.prepare(`INSERT INTO users (id, username, email, role, tenant_id, organization_id, active)
    VALUES (?, ?, ?, ?, ?, ?, 1)`);
  for (const u of [TECH, SPOC, OTHER, ADMIN]) add.run(u.id, u.username, u.email, u.role, u.tenant_id, u.organization_id);
  incidents.subscribe();
});

after(() => {
  incidents._setDeps({});
  try { store._reset(); } catch { /* already closed */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  // Every test starts with no checks: the poller's pass looks at all of them,
  // and each test's instance numbers its incidents from one.
  store.db().exec('DELETE FROM approval_plans');
  heard = [];
  stop = ['assigned', 'incident_failed'].map(listen);
  sn = instance();
  incidents._setDeps({ serviceNowFor: () => CFG, fetchImpl: sn.fetch });
  spoc._setLookup((tenantId) => (Number(tenantId) === 32 ? { user_id: 41 } : null));
  tickets._choiceCache.clear();
  tickets._worked.clear();
  delete process.env.RT_INCIDENT_WAIT_MS;
});
afterEach(() => { stop.forEach((off) => off()); spoc._setLookup(null); });

let n = 0;
const DEV = 'dev:SPHYB:u20';
const DEV2 = 'dev:SPHYB:u21';
const changes = () => [
  { type: 'Device', uid: DEV, name: 'Router U20', action: 'update', netboxId: 199,
    diff: { position: { from: 22, to: 20 }, racktrack_uid: { from: null, to: 'dev:t32:u20' } } },
  { type: 'Device', uid: DEV2, name: 'FW U21', action: 'update', netboxId: 44,
    diff: { serial: { from: 'A', to: 'B' } } },
];
function draft({ rackName = 'SP-HYB-RM01-R01-R1' } = {}) {
  n += 1;
  return service.create({ scanId: 900 + n, rackId: `RK-ABC${String(n).padStart(3, '0')}`, rackName,
    report: { rackUid: `rack:${n}`, netboxUrl: 'http://netbox.test', counts: {}, warnings: [], orphans: [],
      changes: changes() },
    actor: TECH, orgId: 1, tenantId: 32 }).plan.id;
}
async function send(opts) {
  const id = draft(opts);
  const out = await service.submitAndDispatch(id, { note: 'the router is on shelf U20', actor: TECH });
  await incidents.attachEvidence(id);   // the uploads that followed the answer
  return { id, out };
}
const incidentOf = (id) => store.getPlan(id, { heavy: false }).incident;
const patches = () => sn.of('PATCH', '/table/incident/').map((c) => c.body);

/** What S3's write does to a check that was approved, as far as this file can tell. */
function finishWrite(id, to, patch = {}) {
  const from = store.getPlan(id, { heavy: false }).status;
  const plan = store.updatePlan(id, { status: to, ...patch });
  store.addEvent(id, { action: to, actorName: 'system', fromStatus: from, toStatus: to });
  bus.emit('transition', { plan, from, to, actor: { system: true } });
}
const decideAll = (id, who = SPOC) => service.decideItems(id,
  [DEV, DEV2].map((uid) => ({ uid, decision: 'approved' })), { actor: who });

describe('sending a check raises its incident', () => {
  it('in the name of the SPOC, and the answer to the send carries the number', async () => {
    const { id, out } = await send();
    assert.equal(out.plan.status, 'assigned');
    assert.equal(out.incident.system, 'servicenow');
    assert.equal(out.incident.number, 'INC0010041');
    assert.equal(out.incident.state, 'new');
    assert.equal(out.incident.assigned, true);
    assert.deepEqual(out.incident.assignedTo, { sysId: 'u-spoc', name: 'DC007 Spoc' });
    assert.equal(out.incident.error, null);
    assert.match(out.incident.url, /incident\.do\?sys_id=inc-1$/);
    assert.deepEqual(out.incident.pending, []);

    const [post] = sn.of('POST', '/table/incident');
    assert.equal(post.body.correlation_id, `racktrack:check:${id}`);
    assert.equal(post.body.assigned_to, 'u-spoc');
    assert.equal(post.body.caller_id, 'u-tech');
    assert.match(post.body.short_description, /^SP-HYB-RM01-R01-R1, Office-Sprintpark: 2 differences from NetBox/);
    assert.ok(!/racktrack_uid|RK-ABC/.test(post.body.description), post.body.description);

    const told = heard.find((h) => h.event === 'assigned');
    assert.equal(told.incident.number, 'INC0010041', 'the notice to the SPOC is sent after the raise, with the number');
    assert.deepEqual(problems(), []);
  });

  it('stamps a copy of the pointer on every ticket, from the one helper', async () => {
    const { id } = await send();
    const rows = store.ticketsOf(id);
    assert.equal(rows.length, 2);
    for (const t of rows) {
      assert.deepEqual(t.external, { system: 'servicenow', number: 'INC0010041', sysId: 'inc-1',
        url: incidentOf(id).url, state: 'new', error: null, planLevel: true });
    }
    incidents.stamp(id, { state: 'in progress' });
    assert.ok(store.ticketsOf(id).every((t) => t.external.state === 'in progress'), 'they cannot diverge');
    assert.deepEqual(store.ticketsWaitingOnServiceNow().filter((t) => t.planId === id), [],
      'and a copy is never polled one ticket at a time');
  });

  it('raises one incident for two sends at the same moment, and a fresh one for a later check', async () => {
    const id = draft();
    service.submit(id, { actor: TECH });
    sn.slow = 5;
    const [a, b] = await Promise.all([service.dispatch(id, { actor: TECH }), service.dispatch(id, { actor: TECH })]);
    assert.equal(sn.of('POST', '/table/incident').length, 1);
    assert.equal(a.incident.number, b.incident.number);
    assert.equal(heard.filter((h) => h.event === 'assigned').length, 1, 'and the SPOC is told once');

    const again = await service.submitAndDispatch(id, { actor: TECH });
    assert.equal(again.already, true);
    assert.equal(again.incident.number, a.incident.number);
    assert.equal(sn.of('POST', '/table/incident').length, 1, 'sending twice is not raising twice');

    sn.slow = 0;
    const later = await send();
    assert.notEqual(later.out.incident.number, a.incident.number, 'an older check of the rack is never reused');
  });

  it('raises it unassigned when nobody in ServiceNow has the email, and warns the admins', async () => {
    sn.users = sn.users.filter((x) => x.sys_id !== 'u-spoc');
    const { id, out } = await send();
    assert.equal(out.incident.number, 'INC0010041');
    assert.equal(out.incident.assigned, false);
    assert.equal(out.incident.assignWarning,
      'No ServiceNow user has the email dc007.spoc@dc007.example, so the incident is not assigned to anybody.');
    assert.ok(!('assigned_to' in sn.of('POST', '/table/incident')[0].body));
    assert.deepEqual(problems(), ['unassigned']);
    assert.equal(store.getPlan(id).status, 'assigned', 'the check is with its SPOC all the same');

    const notify = require('../../lib/approvals/notify');
    const warning = heard.find((h) => h.event === 'incident_failed');
    const { subject, body } = notify.wordsFor('incident_failed', warning.plan, warning, { name: 'Aasritha' });
    assert.match(subject, /the ServiceNow incident for rack SP-HYB-RM01-R01-R1 needs a look/);
    assert.match(body, /Incident INC0010041 was raised, but No ServiceNow user has the email/);
    assert.ok(!/[–—]/.test(body));
  });
});

describe('the drift report and the photograph', () => {
  it('go up after the answer, as the bytes they are, and are written down', async () => {
    const id = draft();
    const dir = path.join(process.env.RT_OUTPUTS_DIR, store.getPlan(id).rackId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'original_image.jpeg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));

    sn.slowFiles = 30;
    const out = await service.submitAndDispatch(id, { actor: TECH });
    assert.equal(sn.files.length, 0, 'the send did not wait for them');
    assert.deepEqual(out.incident.attachments, []);
    await incidents.attachEvidence(id);

    assert.deepEqual(sn.files.map((f) => [f.name, f.on, f.type]), [
      [`drift-report-check-${id}.html`, 'inc-1', 'text/html; charset=utf-8'],
      [`rack-photo-check-${id}.jpeg`, 'inc-1', 'image/jpeg'],
    ]);
    const html = sn.files[0].body.toString('utf8');
    assert.match(html, /<title>Drift report - SP-HYB-RM01-R01-R1<\/title>/);
    assert.match(html, /INC0010041/, 'the report names the incident it is attached to');
    assert.deepEqual([...sn.files[1].body], [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

    const rows = incidentOf(id).attachments;
    assert.deepEqual(rows.map((a) => [a.kind, a.name, a.sysId, a.error]), [
      ['report', `drift-report-check-${id}.html`, 'att-1', null],
      ['photo', `rack-photo-check-${id}.jpeg`, 'att-2', null],
    ]);
    await incidents.attachEvidence(id);
    assert.equal(sn.files.length, 2, 'what is there is never sent twice');
  });

  it('has nothing to say about a rack with no photograph on disk', async () => {
    const { id } = await send();
    assert.deepEqual(incidentOf(id).attachments.map((a) => a.kind), ['report']);
    assert.deepEqual(incidentOf(id).pending, []);
    assert.deepEqual(problems(), []);
  });

  it('owes what ServiceNow refused, says so once, and sends only that on the retry', async () => {
    const id = draft();
    const dir = path.join(process.env.RT_OUTPUTS_DIR, store.getPlan(id).rackId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'original_image.png'), Buffer.from([1, 2, 3]));
    sn.refuse = (c) => (/file_name=drift-report/.test(c.url) ? refusal(403, 'Attachment type not allowed') : null);
    await service.submitAndDispatch(id, { actor: TECH });
    await settle();

    let inc = incidentOf(id);
    assert.equal(inc.number, 'INC0010041', 'the incident itself is fine');
    assert.match(inc.attachments.find((a) => a.kind === 'report').error, /ServiceNow replied 403/);
    assert.equal(inc.attachments.find((a) => a.kind === 'photo').sysId, 'att-1');
    assert.deepEqual(inc.pending.map((p) => [p.op, p.tries]), [['attach', 1]]);
    assert.deepEqual(problems(), ['attachment_failed']);

    await incidents.retryPending();
    assert.deepEqual(problems(), ['attachment_failed'], 'said once');
    assert.equal(incidentOf(id).pending[0].tries, 2);

    sn.refuse = null;
    await incidents.retryPending();
    inc = incidentOf(id);
    assert.deepEqual(inc.pending, []);
    assert.deepEqual(sn.files.map((f) => f.name), [`rack-photo-check-${id}.png`, `drift-report-check-${id}.html`],
      'the photograph went up once');
  });
});

describe('the outcome of the check reaches its incident', () => {
  it('rejected: Cancelled at once, from the call the route makes, with who and why', async () => {
    const { id } = await send();
    const out = service.reject(id, { reasonCode: 'insufficient_evidence', comment: 'The photo is too dark.', actor: SPOC });
    assert.equal(out.plan.status, 'rejected');
    const brief = await incidents.answerFor(id, { push: true });
    assert.deepEqual(brief, { number: 'INC0010041', state: 'cancelled', pushed: true, error: null });

    const sent = patches();
    assert.equal(sent.length, 1, 'the listener and the route shared one push');
    assert.equal(sent[0].state, 8);
    assert.equal(sent[0].close_code, 'No resolution provided', 'a check that ended without a write says so');
    assert.equal(sent[0].close_notes,
      `Rejected by dc007.spoc in RackTrack check ${id} (not enough evidence): The photo is too dark.`);
    assert.equal(incidentOf(id).pushedState, 'cancelled');
    assert.ok(store.ticketsOf(id).every((t) => t.external.state === 'cancelled'));

    await incidents.pushOutcome(id);
    assert.equal(patches().length, 1, 'pushing it again does nothing');
  });

  it('takes the state the person chose instead of the default', async () => {
    const { id } = await send();
    service.reject(id, { reasonCode: 'other', comment: 'Not now.', incidentState: 'closed', actor: SPOC });
    await incidents.pushOutcome(id);
    assert.equal(patches()[0].state, 7);
    assert.equal(incidentOf(id).state, 'closed');
    assert.equal(incidentOf(id).pushedState, 'closed');
  });

  it('sent back: On Hold with a hold reason; cancelled by an admin: Cancelled', async () => {
    const a = await send();
    service.rework(a.id, { reasonCode: 'insufficient_evidence', comment: 'Scan it again.', actor: SPOC });
    await incidents.pushOutcome(a.id);
    assert.deepEqual(patches()[0], { state: 3, hold_reason: '5',
      work_notes: `Sent back by dc007.spoc in RackTrack check ${a.id}: Scan it again.` });
    assert.equal(incidentOf(a.id).state, 'on hold', 'the state is kept in the words ServiceNow reports it in');

    const b = await send();
    service.cancel(b.id, { reason: 'Scanned the wrong rack.', actor: ADMIN });
    assert.deepEqual(await incidents.answerFor(b.id, { push: true }),
      { number: 'INC0010042', state: 'cancelled', pushed: true, error: null });
    assert.equal(patches().pop().close_notes, 'Closed in RackTrack: Scanned the wrong rack.');
  });

  it('approved and written: Resolved when the write finishes, heard on the bus, naming what was written', async () => {
    const { id } = await send();
    decideAll(id);
    const approved = service.approve(id, { comment: 'Looks right.', actor: SPOC });
    assert.equal(approved.plan.status, 'approved');
    await settle();
    assert.equal(patches().length, 0, 'an approval alone pushes nothing: the write has not happened yet');

    finishWrite(id, 'completed', { result: { written: 2, failed: 0, failures: [] } });
    const brief = await incidents.answerFor(id);
    assert.deepEqual(brief, { number: 'INC0010041', state: 'resolved', pushed: true, error: null });
    const [sent] = patches();
    assert.equal(sent.state, 6);
    assert.equal(sent.close_code, 'Solution provided', "from the instance's own list");
    assert.equal(sent.close_notes, [
      `Approved by dc007.spoc in RackTrack check ${id}. Written to NetBox: 2 changes.`,
      'Router U20: position 22 -> 20',
      'FW U21: serial A -> B',
    ].join('\n'));
  });

  it('pushes once when the bus and a caller ask in the same tick', async () => {
    const { id } = await send();
    decideAll(id);
    service.approve(id, { incidentState: 'in_progress', actor: SPOC });
    finishWrite(id, 'completed', { result: { written: 2 } });
    await Promise.all([incidents.pushOutcome(id), incidents.pushOutcome(id)]);
    assert.equal(patches().length, 1);
    assert.equal(patches()[0].state, 2, 'and leaves it In Progress because the approver said so');
  });

  it('write failed: a work note, and the incident stays open', async () => {
    const { id } = await send();
    decideAll(id);
    service.approve(id, { actor: SPOC });
    finishWrite(id, 'write_failed', { result: { written: 1, failed: 1,
      failures: [{ uid: DEV2, name: 'FW U21', reason: 'serial must be unique' }] } });
    const brief = await incidents.answerFor(id);
    assert.equal(brief.state, 'new');
    const [sent] = patches();
    assert.deepEqual(Object.keys(sent), ['work_notes']);
    assert.match(sent.work_notes, /^Approved, but NetBox refused 1 object:\nFW U21: serial must be unique\n/);
    assert.match(sent.work_notes, /This incident stays open\. An organization admin can try the write again\.$/);
    assert.equal(incidentOf(id).pushedState, undefined);

    bus.emit('transition', { plan: store.getPlan(id), from: 'write_in_progress', to: 'write_failed' });
    await settle();
    assert.equal(patches().length, 1, 'the same failure is noted once');
  });

  it('an approval whose write could not start is noted, once', async () => {
    const { id } = await send();
    decideAll(id);
    const { plan } = service.approve(id, { actor: SPOC });
    const said = { plan, notStarted: true, error: 'No NetBox is configured for this organization.' };
    bus.emit('write_failed', said);
    bus.emit('write_failed', said);
    await settle();
    assert.deepEqual(patches(), [{ work_notes: 'Approved, but the write to NetBox could not start: '
      + 'No NetBox is configured for this organization. An organization admin can start it again.' }]);
  });
});

describe('the close code', () => {
  it("comes from the instance's own list when it has none of the stock ones", async () => {
    sn.closeCodes = [{ value: 'dup', label: 'Duplicate', sequence: 1 }, { value: 'fixed_perm', label: 'Fixed for good', sequence: 2 }];
    const { id } = await send();
    decideAll(id);
    service.approve(id, { actor: SPOC });
    finishWrite(id, 'completed', { result: { written: 2 } });
    await incidents.answerFor(id);
    assert.equal(patches()[0].close_code, 'fixed_perm');
    assert.equal(sn.of('GET', '/table/sys_choice').length, 1, 'asked once, then remembered');
  });

  it('falls back to the stock codes when the list is refused, moving on only when the code is the complaint', async () => {
    const { id } = await send();
    decideAll(id);
    service.approve(id, { actor: SPOC });
    sn.refuse = (c) => {
      if (c.url.includes('/table/sys_choice')) return refusal(403, 'User Not Authorized');
      if (c.method === 'PATCH' && c.body.close_code === 'Solution provided') {
        return refusal(403, 'Data Policy Exception: Resolution code is not valid');
      }
      return null;
    };
    finishWrite(id, 'completed', { result: { written: 2 } });
    await incidents.answerFor(id);
    assert.deepEqual(patches().map((p) => p.close_code), ['Solution provided', 'Solved (Permanently)']);
    assert.equal(incidentOf(id).state, 'resolved');
    assert.deepEqual(incidentOf(id).pending, []);
  });

  it('does not walk the ladder for a refusal that is about something else', async () => {
    const { id } = await send();
    service.reject(id, { reasonCode: 'other', comment: 'No.', incidentState: 'resolved', actor: SPOC });
    sn.refuse = (c) => (c.url.includes('/table/sys_choice') || c.method === 'PATCH'
      ? refusal(403, 'User Not Authorized') : null);
    await incidents.pushOutcome(id);
    assert.equal(patches().length, 1);
    assert.equal(incidentOf(id).pending[0].op, 'state');
  });
});

describe('what ServiceNow refuses is owed, and tried again', () => {
  it('a raise that failed: the check is with its SPOC all the same, the admins are told, the poller raises it', async () => {
    sn.refuse = () => new Error('getaddrinfo ENOTFOUND acme.service-now.com');
    const { id, out } = await send();
    assert.equal(out.plan.status, 'assigned');
    assert.equal(out.holder.username, 'dc007.spoc');
    assert.equal(out.incident.number, null);
    assert.match(out.incident.error, /could not reach ServiceNow/);
    assert.deepEqual(out.incident.pending.map((p) => [p.op, p.tries]), [['raise', 1]]);
    assert.deepEqual(problems(), ['raise_failed']);
    assert.equal(heard.filter((h) => h.event === 'assigned').length, 1, 'the SPOC is told without a number');
    assert.match(store.ticketsOf(id)[0].external.error, /could not reach ServiceNow/);

    const again = await service.submitAndDispatch(id, { actor: TECH });
    assert.deepEqual(again.incident.pending.map((p) => p.tries), [1], 'a second send does not hammer it');

    sn.refuse = null;
    const pass = await incidents.sync();
    assert.equal(pass.retried, 1);
    await incidents.attachEvidence(id);
    const inc = incidentOf(id);
    assert.equal(inc.number, 'INC0010041');
    assert.equal(inc.error, null);
    assert.deepEqual(inc.pending, []);
    assert.ok(store.ticketsOf(id).every((t) => t.external.number === 'INC0010041' && t.external.error === null));
    assert.equal(heard.filter((h) => h.event === 'assigned').length, 1, 'and the SPOC is not told a second time');
    assert.equal(sn.files.length, 1, 'the drift report followed the late raise');
  });

  it('a raise that lands after the check was decided pushes that outcome straight away', async () => {
    sn.refuse = () => refusal(503, 'Instance is hibernating');
    const { id } = await send();
    service.reject(id, { reasonCode: 'other', comment: 'Wrong rack.', actor: SPOC });
    assert.deepEqual(await incidents.answerFor(id, { push: true }),
      { number: null, state: null, pushed: false, error: 'ServiceNow replied 503: Instance is hibernating' });
    sn.refuse = null;
    await incidents.retryPending();
    assert.equal(incidentOf(id).pending.length, 0, 'a rejected check no longer needs an incident raised');

    const b = await send();
    sn.refuse = () => refusal(503, 'Instance is hibernating');
    const c = draft();
    await service.submitAndDispatch(c, { actor: TECH });
    service.rework(c, { reasonCode: 'other', comment: 'Again please.', actor: SPOC });
    sn.refuse = null;
    await incidents.retryPending();
    assert.equal(incidentOf(c).pushedState, 'on_hold');
    assert.equal(incidentOf(b.id).pushedState, undefined);
  });

  it('an outcome ServiceNow refuses is tried eight times, then the admins are told once', async () => {
    const { id } = await send();
    service.reject(id, { reasonCode: 'other', comment: 'No.', actor: SPOC });
    sn.refuse = (c) => (c.method === 'PATCH' ? refusal(500, 'Internal error') : null);
    const brief = await incidents.answerFor(id, { push: true });
    assert.deepEqual(brief, { number: 'INC0010041', state: 'new', pushed: false,
      error: 'ServiceNow replied 500: Internal error' });
    assert.equal(incidentOf(id).error, null, 'the incident itself was raised: only the push is owed');

    for (let i = 0; i < 10; i += 1) await incidents.retryPending();
    const op = incidentOf(id).pending[0];
    assert.equal(op.tries, incidents.MAX_TRIES);
    assert.equal(op.gaveUp, true);
    assert.equal(patches().length, incidents.MAX_TRIES, 'and it is left alone after that');
    assert.deepEqual(problems(), ['push_failed']);
    const gone = heard.find((h) => h.problem === 'push_failed');
    const { body } = require('../../lib/approvals/notify').wordsFor('incident_failed', gone.plan, gone, { name: 'A' });
    assert.match(body, /Incident INC0010041 could not be set to Cancelled: ServiceNow replied 500: Internal error\. It is still open in ServiceNow\./);
  });

  it('an outcome that went through on the retry clears what was owed', async () => {
    const { id } = await send();
    service.reject(id, { reasonCode: 'other', comment: 'No.', actor: SPOC });
    sn.refuse = (c) => (c.method === 'PATCH' ? refusal(500, 'Internal error') : null);
    await incidents.pushOutcome(id);
    sn.refuse = null;
    await incidents.sync();
    assert.deepEqual(incidentOf(id).pending, []);
    assert.equal(incidentOf(id).pushedState, 'cancelled');
  });
});

describe('an incident somebody closes in ServiceNow', () => {
  it('is flagged on the check, said once, and decides nothing', async () => {
    const { id } = await send();
    sn.rows.get('inc-1').state = '6';
    sn.rows.get('inc-1').close_notes = 'Looked fine to me.';
    const pass = await incidents.sync();
    assert.equal(pass.changed, 1);

    const plan = store.getPlan(id);
    assert.equal(plan.status, 'assigned', 'the check has not moved');
    assert.equal(plan.incident.state, 'resolved');
    assert.equal(plan.incident.closedInServiceNow.state, 'resolved');
    assert.equal(plan.incident.closedInServiceNow.notes, 'Looked fine to me.');
    assert.ok(store.itemsOf(id).filter((i) => i.decidable).every((i) => ['pending', 'ticketed'].includes(i.decision)),
      'nothing was decided');
    assert.ok(store.ticketsOf(id).every((t) => t.status === 'open' && !t.finding), 'and no ticket took it as a finding');
    assert.equal(store.decisionsOf(id).length, 0);
    assert.ok(store.eventsOf(id).some((e) => e.action === 'servicenow.closed_outside'));
    assert.deepEqual(problems(), ['closed_outside']);

    const said = heard.find((h) => h.problem === 'closed_outside');
    const notify = require('../../lib/approvals/notify');
    assert.deepEqual(notify.recipientsFor('incident_failed', said.plan, said).map((p) => p.userId).sort(),
      [SPOC.id, ADMIN.id], 'the admins, and the holder it was closed under');
    assert.match(notify.wordsFor('incident_failed', said.plan, said, { name: 'A' }).body,
      /Incident INC0010041 was set to Resolved in ServiceNow\. That does not approve or write anything: check \d+ is still with dc007\.spoc\./);

    await incidents.sync();
    assert.deepEqual(problems(), ['closed_outside'], 'once');

    sn.rows.get('inc-1').state = '2';
    await incidents.sync();
    assert.equal(incidentOf(id).closedInServiceNow, null, 'opened again over there, the flag goes');
  });

  it('is not what the old per-ticket path acts on either', async () => {
    const { id } = await send();
    const out = service.applyTicketStates(id, { 'inc-1': { number: 'INC0010041', state: 'resolved', closed: true, notes: 'done' } });
    assert.deepEqual(out.changed, []);
    assert.ok(store.ticketsOf(id).every((t) => t.status === 'open'));
    assert.equal(store.getPlan(id).status, 'assigned');
  });

  it('does not read a closure RackTrack pushed back as anything', async () => {
    const { id } = await send();
    service.rework(id, { reasonCode: 'other', comment: 'Again.', incidentState: 'resolved', actor: SPOC });
    await incidents.pushOutcome(id);
    assert.equal(store.getPlan(id).status, 'rework', 'still an open check, and still polled');
    sn.rows.get('inc-1').state = '7';   // the instance closes a Resolved incident by itself, days later
    await incidents.sync();
    assert.equal(incidentOf(id).state, 'closed');
    assert.equal(incidentOf(id).closedInServiceNow, null);
    assert.deepEqual(problems(), []);
  });
});

describe('an admin gives the check to somebody else', () => {
  it('and the incident follows, with a work note', async () => {
    const { id } = await send();
    const out = await service.assign(id, { userId: OTHER.id, reason: 'The SPOC is on leave.' }, { actor: ADMIN });
    assert.equal(out.holder.username, 'dc007.member');
    assert.equal(out.incident.number, 'INC0010041', 'the same incident, not another');
    assert.equal(sn.of('POST', '/table/incident').length, 1);
    assert.deepEqual(patches(), [{ assigned_to: 'u-other',
      work_notes: 'Reassigned by Aasritha in RackTrack from dc007.spoc to dc007.member: The SPOC is on leave.' }]);
    assert.deepEqual(out.incident.assignedTo, { sysId: 'u-other', name: 'DC007 Member' });
    assert.equal(out.incident.raisedFor.username, 'dc007.member');
    assert.ok(store.ticketsOf(id).every((t) => t.assignee === 'dc007.member' && t.external.number === 'INC0010041'));
  });

  it('keeps the number on the fresh tickets when ServiceNow cannot be reached', async () => {
    const { id } = await send();
    sn.refuse = () => new Error('socket hang up');
    const out = await service.assign(id, { userId: OTHER.id, reason: 'On leave.' }, { actor: ADMIN });
    assert.equal(out.plan.spocUserId, OTHER.id);
    for (const t of store.ticketsOf(id)) {
      assert.equal(t.assignee, 'dc007.member');
      assert.equal(t.external.number, 'INC0010041');
      assert.equal(t.external.planLevel, true);
    }
    assert.deepEqual(incidentOf(id).pending.map((p) => p.op), ['reassign']);
    sn.refuse = null;
    await incidents.retryPending();
    assert.deepEqual(incidentOf(id).pending, []);
    assert.equal(sn.rows.get('inc-1').assigned_to, 'u-other');
  });

  it('opens a closed incident again when a rejected check goes to a new holder', async () => {
    const { id } = await send();
    service.reject(id, { reasonCode: 'wrong_spoc', comment: 'Not my site.', actor: SPOC });
    await incidents.pushOutcome(id);
    await service.assign(id, { userId: OTHER.id, reason: 'It is theirs.' }, { actor: ADMIN });
    assert.equal(patches().pop().state, 2);
    assert.equal(incidentOf(id).state, 'in progress');
    assert.equal(incidentOf(id).pushedState, null);

    service.reject(id, { reasonCode: 'other', comment: 'No.', actor: OTHER });
    await incidents.pushOutcome(id);
    assert.equal(patches().pop().state, 8, 'a second rejection is pushed again, not skipped as already Cancelled');
  });
});

describe('with no ServiceNow', () => {
  it('the whole flow works inside RackTrack, and nothing is called', async () => {
    incidents._setDeps({ serviceNowFor: () => null, fetchImpl: sn.fetch });
    const { id, out } = await send();
    assert.deepEqual(out.incident, incidents.NO_SERVICENOW);
    assert.ok(store.ticketsOf(id).every((t) => t.external.system === 'none' && t.external.planLevel));
    decideAll(id);
    assert.equal(service.approve(id, { actor: SPOC }).plan.status, 'approved');
    finishWrite(id, 'completed');
    assert.equal(await incidents.answerFor(id), null);
    assert.equal((await incidents.sync()).asked, 0);
    assert.equal(sn.calls.length, 0);
    assert.deepEqual(problems(), []);
  });
});

describe('a ServiceNow that does not answer', () => {
  it('does not hold the send: the answer says the incident is still being raised', async () => {
    process.env.RT_INCIDENT_WAIT_MS = '40';
    sn.hang = true;
    const id = draft();
    const started = Date.now();
    const out = await service.submitAndDispatch(id, { actor: TECH });
    assert.ok(Date.now() - started < 2000, 'the send came back');
    assert.equal(out.plan.status, 'assigned');
    assert.equal(out.holder.username, 'dc007.spoc');
    assert.equal(out.incident.system, 'servicenow');
    assert.equal(out.incident.state, 'raising');
    assert.equal(out.incident.number, null);
    assert.equal(out.incident.error, null);
    assert.deepEqual(incidentOf(id).pending.map((p) => p.op), ['raise'],
      'and the raise is owed, so a restart in the middle loses nothing');
  });
});
