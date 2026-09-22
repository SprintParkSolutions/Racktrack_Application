/**
 * The one incident of a whole check, against a fake instance.
 *
 * The HTTP call is injected, as in tickets.test.js. What is pinned here: what
 * a check's incident says, that it is raised once per check and never picked
 * up by a later one, who it is assigned to and what is said when that is
 * nobody, the fields a stock instance demands before it will change state,
 * and that a file goes up as the bytes it is.
 */
const assert = require('node:assert/strict');
const { describe, it, beforeEach, afterEach } = require('node:test');

const t = require('../../lib/netbox/tickets');

const CFG = {
  instanceUrl: 'https://acme.service-now.com/',
  username: 'svc', password: 'x', incidentTable: 'incident',
};
const HOLDER = { userId: 41, username: 'dc007.spoc', email: 'Spoc@dc007.example' };
const SENDER = { userId: 39, username: 'dc007.tech', email: 'tech@dc007.example' };

const MOVED = {
  uid: 'dev:RK-5B81BE87:u20', type: 'Device', name: 'Router U20 SP-HYB-RM01-R01-R1', action: 'update',
  netboxId: 199,
  diff: { position: { from: 22, to: 20 }, racktrack_uid: { from: null, to: 'dev:t32:u20' }, recordId: { from: null, to: 199 } },
};
const PORT = { uid: 'if:dev:RK-5B81BE87:u17:4', type: 'Interface', name: '4', action: 'create' };
const TAG = {
  uid: 'rack:t32:26', type: 'Rack', name: 'SP-HYB-RM01-R01-R1', action: 'rebind', fromUid: null,
  diff: { racktrack_uid: { from: null, to: 'rack:t32:26' } },
};

const CTX = {
  plan: { id: 140, submittedBy: 'dc007.tech', submittedAt: '2026-09-21T15:02:11Z', submittedNote: 'the router is on shelf U20' },
  items: [TAG, MOVED, PORT],
  rackName: 'SP-HYB-RM01-R01-R1', siteName: 'Office-Sprintpark',
  holder: HOLDER, sender: SENDER,
  appUrl: 'https://demo.racktrack.ai/approvals/drifts/140',
};

/** A fake ServiceNow that records what it was asked. */
function fake(responses) {
  const calls = [];
  const impl = async (url, method, headers, body) => {
    calls.push({ url: decodeURIComponent(url), method, headers, body });
    const next = responses.shift();
    if (!next) throw new Error(`no canned response for ${method} ${url}`);
    if (next instanceof Error) throw next;
    return next;
  };
  impl.calls = calls;
  return impl;
}
const ok = (result, status = 200) => ({ ok: true, status, body: { result } });
const refused = (status, message) => ({ ok: false, status, body: { error: { message }, status: 'failure' } });
const NONE = ok([]);
const RAISED = ok({ sys_id: '9d3', number: 'INC0010042', state: '1', assigned_to: { link: 'x', value: '6816' } }, 201);
const SPOC_USER = { sys_id: '6816', name: 'DC007 Spoc', email: 'spoc@dc007.example' };
const TECH_USER = { sys_id: '77aa', name: 'DC007 Tech', email: 'tech@dc007.example' };

beforeEach(() => { t._choiceCache.clear(); t._worked.clear(); t._sessions.clear(); });

describe('the incident of a check', () => {
  it('is pure, and names nobody in assigned_to', () => {
    const before = JSON.stringify(CTX);
    const f = t.toCheckIncident(CTX);
    assert.equal(JSON.stringify(CTX), before, 'what it was given is left as it was');
    assert.deepEqual(t.toCheckIncident(CTX), f);
    assert.ok(!('assigned_to' in f), 'who that is on the instance has to be looked up first');
    assert.ok(!('caller_id' in f));
  });

  it('is keyed on the check, so a later check of the same rack is another incident', () => {
    assert.equal(t.correlationForCheck(140), 'racktrack:check:140');
    assert.equal(t.toCheckIncident(CTX).correlation_id, 'racktrack:check:140');
    assert.notEqual(t.toCheckIncident({ ...CTX, plan: { ...CTX.plan, id: 141 } }).correlation_id,
      t.toCheckIncident(CTX).correlation_id);
  });

  it('says which rack, how many differences, who sent it, and that nothing was written', () => {
    const f = t.toCheckIncident(CTX);
    assert.equal(f.short_description,
      'SP-HYB-RM01-R01-R1, Office-Sprintpark: 2 differences from NetBox - RackTrack check 140',
      "RackTrack's own tag on the rack is not a difference");
    assert.match(f.description, /Sent by: dc007\.tech on Mon, 21 Sep 2026 15:02:11 UTC/);
    assert.match(f.description, /With: dc007\.spoc \(Spoc@dc007\.example\)/);
    assert.match(f.description, /1\. Device "Router U20" does not match NetBox\./);
    assert.match(f.description, /position: NetBox says 22, we saw 20/);
    assert.match(f.description, /2\. Interface "4" was found in the rack and is not in NetBox\./);
    assert.match(f.description, /Note from the technician: the router is on shelf U20/);
    assert.match(f.description, /Open it in RackTrack: https:\/\/demo\.racktrack\.ai\/approvals\/drifts\/140/);
    assert.match(f.description,
      /Nothing has been written to NetBox\. The SPOC reviews this check and approves, rejects or changes each difference\.$/);
    assert.equal(f.correlation_display, 'RackTrack');
    assert.equal(f.category, 'inquiry');
    assert.equal(f.impact, 3);
    assert.equal(f.contact_type, 'integration');
  });

  it('never prints a key of ours, a photo hash or a long dash', () => {
    const f = t.toCheckIncident({ ...CTX, rackName: 'RK-5B81BE87',
      items: [{ ...MOVED, name: 'Router U20 RK-5B81BE87' }] });
    const words = `${f.short_description}\n${f.description}`;
    assert.ok(!/racktrack_uid|recordId|RK-5B81BE87|dev:t32/.test(words), words);
    assert.match(f.short_description, /^Rack not identified yet, Office-Sprintpark: 1 difference from NetBox/);
    assert.ok(!/[–—]/.test(words));
  });

  it('is as urgent as its most urgent item', () => {
    assert.equal(t.toCheckIncident(CTX).urgency, 2);
    assert.equal(t.toCheckIncident({ ...CTX, items: [PORT] }).urgency, 3);
    assert.equal(t.toCheckIncident({ ...CTX, items: [] }).urgency, 3);
  });

  it('leaves the link out when there is no public address, and the note when there is none', () => {
    const f = t.toCheckIncident({ ...CTX, appUrl: null, plan: { id: 140 }, sender: null });
    assert.ok(!/Open it in RackTrack/.test(f.description));
    assert.ok(!/Note from the technician/.test(f.description));
    assert.ok(!/Sent by/.test(f.description));
  });

  it('lists the first twenty and points at the report for the rest', () => {
    const many = Array.from({ length: 48 }, (_, n) => ({ ...PORT, uid: `if:x:${n}`, name: String(n + 1) }));
    const f = t.toCheckIncident({ ...CTX, items: many });
    assert.match(f.short_description, /48 differences/);
    assert.match(f.description, /20\. Interface "20"/);
    assert.ok(!/21\. Interface/.test(f.description));
    assert.match(f.description, /And 28 more\. The attached drift report lists every one\./);
    assert.ok(f.description.length < 4000, 'a stock description field holds 4000 characters');
  });

  describe('the link to the Drift Desk', () => {
    const was = process.env.PUBLIC_BASE_URL;
    afterEach(() => { if (was === undefined) delete process.env.PUBLIC_BASE_URL; else process.env.PUBLIC_BASE_URL = was; });

    it('comes from PUBLIC_BASE_URL, and is nothing without it', () => {
      process.env.PUBLIC_BASE_URL = 'https://demo.racktrack.ai/';
      assert.equal(t.appUrlFor(140), 'https://demo.racktrack.ai/approvals/drifts/140');
      delete process.env.PUBLIC_BASE_URL;
      assert.equal(t.appUrlFor(140), null);
    });

    it('is worked out by raiseCheck when the caller gives none', async () => {
      process.env.PUBLIC_BASE_URL = 'https://demo.racktrack.ai';
      const impl = fake([NONE, ok([SPOC_USER]), RAISED]);
      const ctx = { ...CTX };
      delete ctx.appUrl;
      await t.raiseCheck(CFG, ctx, impl);
      assert.match(impl.calls[2].body.description, /Open it in RackTrack: https:\/\/demo\.racktrack\.ai\/approvals\/drifts\/140/);
    });
  });
});

describe('who an email is in ServiceNow', () => {
  it('asks once for every address, active users only, and answers under each address', async () => {
    const impl = fake([ok([SPOC_USER, TECH_USER])]);
    const out = await t.findUsers(CFG, ['Spoc@dc007.example', 'tech@dc007.example', 'spoc@dc007.example', null], impl);
    assert.equal(impl.calls.length, 1);
    assert.equal(impl.calls[0].method, 'GET');
    assert.match(impl.calls[0].url, /\/api\/now\/table\/sys_user\?sysparm_query=emailINspoc@dc007\.example,tech@dc007\.example\^active=true&sysparm_fields=sys_id,name,email&sysparm_limit=10$/);
    assert.deepEqual(out, { ok: true, byEmail: {
      'spoc@dc007.example': [{ sysId: '6816', name: 'DC007 Spoc' }],
      'tech@dc007.example': [{ sysId: '77aa', name: 'DC007 Tech' }],
    } });
  });

  it('tells nobody from several', async () => {
    const twin = { sys_id: '6817', name: 'Spoc (old account)', email: 'SPOC@dc007.example' };
    const out = await t.findUsers(CFG, ['spoc@dc007.example', 'tech@dc007.example'], fake([ok([SPOC_USER, twin])]));
    assert.equal(out.byEmail['spoc@dc007.example'].length, 2);
    assert.deepEqual(out.byEmail['tech@dc007.example'], []);
  });

  it('asks nothing when there is no address, and never puts a query inside one', async () => {
    const impl = fake([]);
    assert.deepEqual(await t.findUsers(CFG, [], impl), { ok: true, byEmail: {} });
    assert.deepEqual(await t.findUsers(CFG, ['a@x^active=false', 'a@x,b@x'], impl), { ok: true, byEmail: {} });
    assert.equal(impl.calls.length, 0);
  });

  it('says so when ServiceNow refuses or does not answer, and never throws', async () => {
    const no = await t.findUsers(CFG, ['spoc@dc007.example'], fake([refused(403, 'ACL')]));
    assert.equal(no.ok, false);
    assert.equal(no.status, 403);
    assert.equal(no.error, 'ServiceNow replied 403: ACL');
    assert.deepEqual(no.byEmail, { 'spoc@dc007.example': [] });

    const gone = await t.findUsers(CFG, ['spoc@dc007.example'], fake([new Error('request timed out')]));
    assert.equal(gone.ok, false);
    assert.equal(gone.status, 0);
    assert.match(gone.error, /could not reach ServiceNow: request timed out/);
  });
});

describe('raising the incident of a check', () => {
  it('assigns it to the one user with the holder\'s email, by sys_id, and names the sender as caller', async () => {
    const impl = fake([NONE, ok([SPOC_USER, TECH_USER]), RAISED]);
    const out = await t.raiseCheck(CFG, CTX, impl);

    assert.match(impl.calls[0].url, /sysparm_query=correlation_id=racktrack:check:140&/,
      'it looks for this check\'s incident and no other');
    assert.equal(impl.calls[2].method, 'POST');
    assert.match(impl.calls[2].url, /\/api\/now\/table\/incident$/);
    assert.equal(impl.calls[2].body.assigned_to, '6816');
    assert.equal(impl.calls[2].body.caller_id, '77aa');
    assert.equal(impl.calls[2].body.correlation_id, 'racktrack:check:140');
    assert.deepEqual(out, {
      ok: true, reused: false, sysId: '9d3', number: 'INC0010042', state: 'new',
      url: 'https://acme.service-now.com/nav_to.do?uri=incident.do?sys_id=9d3',
      assigned: true, assignedTo: { sysId: '6816', name: 'DC007 Spoc' }, assignWarning: null,
    });
  });

  /* An incident nobody holds is an incident nobody picks up, so when the
     instance has no user for the person a check went to, RackTrack makes one
     and assigns to it. */
  it('makes the user when the instance has none, and assigns the incident to it', async () => {
    const made = { sys_id: 'u-new', name: 'Spoc', email: 'spoc@dc007.example', user_name: 'dc007.spoc' };
    const impl = fake([NONE, ok([]), ok(made, 201),
      ok({ sys_id: '9d3', number: 'INC0010042', state: '1', assigned_to: 'u-new' }, 201)]);
    const out = await t.raiseCheck(CFG, CTX, impl);
    // The third call makes the user, from what RackTrack knows about them.
    assert.equal(impl.calls[2].method, 'POST');
    assert.match(impl.calls[2].url, /\/table\/sys_user$/);
    assert.equal(impl.calls[2].body.email, 'spoc@dc007.example');
    assert.equal(impl.calls[2].body.user_name, 'dc007.spoc');
    assert.equal(impl.calls[2].body.source, 'racktrack');
    // Nothing else: no password, no roles, no groups.
    assert.deepEqual(Object.keys(impl.calls[2].body).sort(),
      ['email', 'first_name', 'last_name', 'source', 'user_name']);
    // And the incident is raised naming it.
    assert.equal(impl.calls[3].body.assigned_to, 'u-new');
    assert.equal(out.assigned, true);
    assert.deepEqual(out.assignedTo, { sysId: 'u-new', name: 'Spoc' });
    assert.equal(out.assignWarning, null);
  });

  it('still raises it when the instance will not create the user, and says why', async () => {
    const impl = fake([NONE, ok([]), refused(403, 'Insufficient rights'),
      ok({ sys_id: '9d3', number: 'INC0010042', state: '1', assigned_to: '' }, 201)]);
    const out = await t.raiseCheck(CFG, CTX, impl);
    assert.ok(!('assigned_to' in impl.calls[3].body), 'an empty assignee is left out, not sent empty');
    assert.equal(out.ok, true);
    assert.equal(out.number, 'INC0010042');
    assert.equal(out.assigned, false);
    assert.equal(out.assignedTo, null);
    assert.match(out.assignWarning, /would not create a user for spoc@dc007\.example/);
  });

  it('does not choose between two users with the same email', async () => {
    const twin = { sys_id: '6817', name: 'Spoc (old account)', email: 'spoc@dc007.example' };
    const impl = fake([NONE, ok([SPOC_USER, twin]), RAISED]);
    const out = await t.raiseCheck(CFG, CTX, impl);
    assert.ok(!('assigned_to' in impl.calls[2].body));
    assert.equal(out.assigned, false);
    assert.equal(out.assignWarning,
      'More than one ServiceNow user has the email spoc@dc007.example, so the incident is not assigned to anybody.');
  });

  it('raises it unassigned when the user list cannot be read, or the holder has no email', async () => {
    const acl = await t.raiseCheck(CFG, CTX, fake([NONE, refused(403, 'ACL'), RAISED]));
    assert.equal(acl.ok, true);
    assert.equal(acl.assigned, false);
    assert.match(acl.assignWarning, /could not look the SPOC up in ServiceNow \(ServiceNow replied 403: ACL\), so the incident is not assigned to anybody\.$/);

    const impl = fake([NONE, RAISED]);
    const bare = await t.raiseCheck(CFG, { ...CTX, holder: { username: 'dc007.spoc' }, sender: { username: 'dc007.tech' } }, impl);
    assert.equal(impl.calls.length, 2, 'with no address there is nobody to look up');
    assert.equal(bare.assigned, false);
    assert.equal(bare.assignWarning, 'dc007.spoc has no email address in RackTrack, so the incident is not assigned to anybody.');
  });

  it('believes the instance, not itself, about who it is assigned to', async () => {
    const impl = fake([NONE, ok([SPOC_USER]), ok({ sys_id: '9d3', number: 'INC0010042', state: '1', assigned_to: '' }, 201)]);
    const out = await t.raiseCheck(CFG, CTX, impl);
    assert.equal(impl.calls[2].body.assigned_to, '6816');
    assert.equal(out.assigned, false);
    assert.equal(out.assignWarning, 'ServiceNow did not keep DC007 Spoc as the assignee, so the incident is not assigned to anybody.');
  });

  it('answers a second send with the incident of the first, and writes nothing', async () => {
    const impl = fake([ok([{ sys_id: '9d3', number: 'INC0010042', state: '2', assigned_to: { link: 'x', value: '6816' } }])]);
    const out = await t.raiseCheck(CFG, CTX, impl);
    assert.equal(impl.calls.length, 1, 'no second incident, no note, no reopening');
    assert.equal(impl.calls[0].method, 'GET');
    assert.equal(out.ok, true);
    assert.equal(out.reused, true);
    assert.equal(out.number, 'INC0010042');
    assert.equal(out.state, 'in progress');
    assert.equal(out.assigned, true);
    assert.deepEqual(out.assignedTo, { sysId: '6816', name: null });
  });

  it('puts right a missing assignee on the incident it finds, and touches nothing else', async () => {
    const bare = { sys_id: '9d3', number: 'INC0010042', state: '7', assigned_to: '' };
    const impl = fake([ok([bare]), ok([SPOC_USER]), ok({ number: 'INC0010042', state: '7' })]);
    const out = await t.raiseCheck(CFG, CTX, impl);
    assert.deepEqual(impl.calls.map((c) => c.method), ['GET', 'GET', 'PATCH']);
    assert.deepEqual(impl.calls[2].body, { assigned_to: '6816' }, 'no note, and a closed incident is not reopened');
    assert.equal(out.state, 'closed');
    assert.equal(out.assigned, true);
    assert.deepEqual(out.assignedTo, { sysId: '6816', name: 'DC007 Spoc' });

    // Nobody with that email: the user is made, and the incident it found is
    // assigned to it.
    const made = { sys_id: 'u-new', name: 'Spoc', email: 'spoc@dc007.example' };
    const nobody = await t.raiseCheck(CFG, CTX,
      fake([ok([bare]), ok([]), ok(made, 201), ok({ number: 'INC0010042', state: '7' })]));
    assert.equal(nobody.ok, true);
    assert.equal(nobody.assigned, true);
    assert.deepEqual(nobody.assignedTo, { sysId: 'u-new', name: 'Spoc' });
    assert.equal(nobody.assignWarning, null);

    const refusedTo = await t.raiseCheck(CFG, CTX, fake([ok([bare]), ok([SPOC_USER]), refused(403, 'ACL')]));
    assert.equal(refusedTo.ok, true, 'the incident exists all the same');
    assert.equal(refusedTo.assigned, false);
    assert.match(refusedTo.assignWarning, /ServiceNow would not assign it \(ServiceNow replied 403: ACL\)/);
  });

  it('never picks up the incident of an older check of the same rack', async () => {
    // The fake instance holds check 139's incident. It is only ever found by its own id.
    const held = { 'racktrack:check:139': { sys_id: 'old', number: 'INC0010001', state: '7' } };
    const calls = [];
    const impl = async (url, method, _h, body) => {
      calls.push({ url: decodeURIComponent(url), method, body });
      if (method === 'POST') return RAISED;
      if (/sys_user/.test(url)) return ok([SPOC_USER]);
      const id = decodeURIComponent(url).match(/correlation_id=([^&]+)/)[1];
      return ok(held[id] ? [held[id]] : []);
    };
    const out = await t.raiseCheck(CFG, CTX, impl);
    assert.equal(out.reused, false);
    assert.equal(out.number, 'INC0010042');
    assert.ok(calls.every((c) => !/racktrack:check:139|racktrack:RK-/.test(c.url)));
    assert.ok(calls.every((c) => c.method !== 'PATCH'), 'the old incident is not reopened');
  });

  it('reports ServiceNow refusing, at the search or at the raise', async () => {
    const search = await t.raiseCheck(CFG, CTX, fake([refused(401, 'User Not Authenticated')]));
    assert.equal(search.ok, false);
    assert.equal(search.status, 401);
    assert.equal(search.error, 'ServiceNow replied 401: User Not Authenticated');

    const post = await t.raiseCheck(CFG, CTX, fake([NONE, ok([SPOC_USER]), refused(403, 'Operation Failed')]));
    assert.equal(post.ok, false);
    assert.equal(post.status, 403);
    assert.equal(post.error, 'ServiceNow replied 403: Operation Failed');
    assert.ok(post.detail, 'what it said is kept whole for whoever looks into it');
  });

  it('reports a timeout or no answer without throwing', async () => {
    const out = await t.raiseCheck(CFG, CTX, fake([new Error('request timed out')]));
    assert.equal(out.ok, false);
    assert.equal(out.status, 0);
    assert.match(out.error, /could not reach ServiceNow: request timed out/);

    const blank = await t.raiseCheck(CFG, CTX, fake([{ ok: false, status: 0, body: '' }]));
    assert.equal(blank.error, 'ServiceNow replied nothing');
  });
});

describe('changing an incident', () => {
  it('patches the fields given and says what the incident looks like now', async () => {
    const impl = fake([ok({ sys_id: '9d3', number: 'INC0010042', state: '2' })]);
    const out = await t.update(CFG, '9d3', { work_notes: 'hello' }, impl);
    assert.equal(impl.calls[0].method, 'PATCH');
    assert.match(impl.calls[0].url, /\/api\/now\/table\/incident\/9d3$/);
    assert.deepEqual(impl.calls[0].body, { work_notes: 'hello' });
    assert.deepEqual(out, { ok: true, status: 200, state: 'in progress', number: 'INC0010042', error: null });
  });

  it('reports a refusal, a timeout and a missing incident in the same shape', async () => {
    const no = await t.update(CFG, '9d3', { state: 6 }, fake([refused(403, 'Data Policy Exception: Resolution code is mandatory')]));
    assert.deepEqual([no.ok, no.status, no.state, no.number], [false, 403, null, null]);
    assert.equal(no.error, 'ServiceNow replied 403: Data Policy Exception: Resolution code is mandatory');

    const gone = await t.update(CFG, '9d3', { state: 6 }, fake([new Error('socket hang up')]));
    assert.deepEqual([gone.ok, gone.status], [false, 0]);
    assert.match(gone.error, /could not reach ServiceNow/);

    const impl = fake([]);
    const none = await t.update(CFG, '', { state: 6 }, impl);
    assert.equal(none.ok, false);
    assert.equal(impl.calls.length, 0);
  });

  it('adds a work note, and hands it to another user with the reason', async () => {
    const impl = fake([ok({ number: 'INC0010042', state: '2' }), ok({ number: 'INC0010042', state: '2' }), ok({ number: 'INC0010042', state: '2' })]);
    await t.workNote(CFG, '9d3', 'NetBox did not hold what was written. An admin is looking at it.', impl);
    assert.deepEqual(impl.calls[0].body, { work_notes: 'NetBox did not hold what was written. An admin is looking at it.' });

    await t.reassign(CFG, '9d3', '77aa', { note: 'Reassigned by Aasritha from old.spoc to dc007.spoc: on leave' }, impl);
    assert.deepEqual(impl.calls[1].body,
      { assigned_to: '77aa', work_notes: 'Reassigned by Aasritha from old.spoc to dc007.spoc: on leave' },
      'an open incident keeps its own state');

    await t.reassign(CFG, '9d3', '77aa', { note: 'Reassigned', reopen: true }, impl);
    assert.equal(impl.calls[2].body.state, 2, 'a closed incident cannot be anybody\'s to work');

    assert.equal((await t.workNote(CFG, '9d3', '  ', impl)).ok, false);
    assert.equal((await t.reassign(CFG, '9d3', '', {}, impl)).ok, false);
    assert.equal(impl.calls.length, 3);
  });
});

const CLOSE_CODES = ok([
  { value: 'Duplicate', label: 'Duplicate', sequence: '30' },
  { value: 'Resolved by caller', label: 'Resolved by caller', sequence: '20' },
  { value: 'No resolution provided', label: 'No resolution provided', sequence: '10' },
]);
const HOLD_REASONS = ok([
  { value: '1', label: 'Awaiting Caller', sequence: '1' },
  { value: '5', label: 'Awaiting Change', sequence: '2' },
]);

describe('the choice lists of the instance', () => {
  it('asks the instance for its own list, in its order', async () => {
    const impl = fake([CLOSE_CODES]);
    const out = await t.choices(CFG, 'close_code', impl);
    assert.match(impl.calls[0].url, /\/api\/now\/table\/sys_choice\?sysparm_query=name=incident\^element=close_code\^inactive=false\^language=en&sysparm_fields=value,label,sequence$/);
    assert.equal(out.ok, true);
    assert.deepEqual(out.choices.map((c) => c.value), ['No resolution provided', 'Resolved by caller', 'Duplicate']);
  });

  it('remembers a list for an hour, for that instance and that field only', async () => {
    const impl = fake([CLOSE_CODES, HOLD_REASONS, CLOSE_CODES, CLOSE_CODES]);
    await t.choices(CFG, 'close_code', impl);
    const again = await t.choices(CFG, 'close_code', impl);
    assert.equal(impl.calls.length, 1);
    assert.equal(again.cached, true);

    await t.choices(CFG, 'hold_reason', impl);
    await t.choices({ ...CFG, instanceUrl: 'https://other.service-now.com' }, 'close_code', impl);
    assert.equal(impl.calls.length, 3, 'another field and another instance are asked for themselves');

    for (const entry of t._choiceCache.values()) entry.at -= 61 * 60 * 1000;
    await t.choices(CFG, 'close_code', impl);
    assert.equal(impl.calls.length, 4, 'after an hour it asks again');
  });

  it('does not remember a refusal or an empty list', async () => {
    const impl = fake([refused(403, 'ACL'), NONE, CLOSE_CODES]);
    assert.equal((await t.choices(CFG, 'close_code', impl)).ok, false);
    assert.deepEqual((await t.choices(CFG, 'close_code', impl)).choices, []);
    assert.equal((await t.choices(CFG, 'close_code', impl)).choices.length, 3);
    assert.equal(impl.calls.length, 3);
  });
});

describe('the close code', () => {
  it('is the admin\'s own when the instance lists it', async () => {
    const out = await t.pickCloseCode({ ...CFG, closeCode: 'Duplicate' }, fake([CLOSE_CODES]));
    assert.equal(out.value, 'Duplicate');
    assert.equal(out.source, 'profile');
  });

  it('is otherwise the first on the instance that reads as solved', async () => {
    const out = await t.pickCloseCode({ ...CFG, closeCode: 'Not on this instance' }, fake([CLOSE_CODES]));
    assert.equal(out.value, 'Resolved by caller');
    assert.deepEqual(out.candidates, ['Resolved by caller']);
  });

  it('is the first in the instance\'s order when none reads as solved', async () => {
    const out = await t.pickCloseCode(CFG, fake([ok([
      { value: 'b', label: 'Beta', sequence: '2' }, { value: 'a', label: 'Alpha', sequence: '1' }])]));
    assert.equal(out.value, 'a');
  });

  it('falls back to the stock codes, in order, when the list is refused', async () => {
    const out = await t.pickCloseCode(CFG, fake([refused(403, 'ACL')]));
    assert.equal(out.source, 'stock');
    assert.deepEqual(out.candidates,
      ['Solution provided', 'Solved (Permanently)', 'Resolution confirmed', 'Solved (Work Around)']);
  });
});

describe('setting the state of an incident', () => {
  it('resolves with a close code from the instance and the close notes', async () => {
    const impl = fake([CLOSE_CODES, ok({ number: 'INC0010042', state: '6' })]);
    const out = await t.setState(CFG, '9d3', 'resolved',
      { notes: 'Approved by dc007.spoc in RackTrack check 140. Written to NetBox: 1 change.' }, impl);
    assert.deepEqual(impl.calls[1].body, {
      state: 6, close_code: 'Resolved by caller',
      close_notes: 'Approved by dc007.spoc in RackTrack check 140. Written to NetBox: 1 change.',
    });
    assert.equal(out.ok, true);
    assert.equal(out.state, 'resolved');
    assert.equal(out.closeCode, 'Resolved by caller');
  });

  it('closes the same way', async () => {
    const impl = fake([CLOSE_CODES, ok({ number: 'INC0010042', state: '7' })]);
    await t.setState(CFG, '9d3', 'closed', { notes: 'Done.' }, impl);
    assert.deepEqual(Object.keys(impl.calls[1].body).sort(), ['close_code', 'close_notes', 'state']);
    assert.equal(impl.calls[1].body.state, 7);
  });

  it('tries the stock codes one after another on a 400 or a 403, and remembers the one that worked', async () => {
    const impl = fake([
      refused(403, 'ACL'),                                   // the choice list is closed to us
      refused(403, 'Invalid close code'),                    // Solution provided
      refused(400, 'Invalid close code'),                    // Solved (Permanently)
      ok({ number: 'INC0010042', state: '6' }),              // Resolution confirmed
    ]);
    const out = await t.setState(CFG, '9d3', 'resolved', { notes: 'Done.' }, impl);
    assert.deepEqual(impl.calls.slice(1).map((c) => c.body.close_code),
      ['Solution provided', 'Solved (Permanently)', 'Resolution confirmed']);
    assert.equal(out.ok, true);
    assert.equal(out.closeCode, 'Resolution confirmed');

    const next = fake([refused(403, 'ACL'), ok({ number: 'INC0010043', state: '6' })]);
    await t.setState(CFG, 'aaa', 'resolved', { notes: 'Done.' }, next);
    assert.equal(next.calls[1].body.close_code, 'Resolution confirmed', 'the next incident starts with it');
    assert.equal(next.calls.length, 2);

    const other = fake([refused(403, 'ACL'), ok({ number: 'INC7', state: '6' })]);
    await t.setState({ ...CFG, instanceUrl: 'https://other.service-now.com' }, 'bbb', 'resolved', { notes: 'Done.' }, other);
    assert.equal(other.calls[1].body.close_code, 'Solution provided', 'what worked is remembered per instance');
  });

  it('gives up with the last refusal when no stock code is taken, and at once on any other failure', async () => {
    const all = fake([refused(403, 'ACL'), refused(403, 'a'), refused(403, 'b'), refused(403, 'c'), refused(403, 'd')]);
    const out = await t.setState(CFG, '9d3', 'resolved', { notes: 'Done.' }, all);
    assert.equal(out.ok, false);
    assert.equal(out.error, 'ServiceNow replied 403: d');
    assert.equal(all.calls.length, 5);

    const down = fake([refused(403, 'ACL'), refused(500, 'boom')]);
    const stop = await t.setState(CFG, '9d3', 'resolved', { notes: 'Done.' }, down);
    assert.equal(stop.status, 500);
    assert.equal(down.calls.length, 2, 'a server error is not a wrong close code');

    const gone = await t.setState(CFG, '9d3', 'resolved', { notes: 'Done.' }, fake([new Error('timed out'), new Error('timed out')]));
    assert.equal(gone.ok, false);
    assert.equal(gone.status, 0);
  });

  it('uses the close code it is handed without asking', async () => {
    const impl = fake([ok({ number: 'INC0010042', state: '6' })]);
    await t.setState(CFG, '9d3', 'resolved', { notes: 'Done.', closeCode: 'Known error' }, impl);
    assert.equal(impl.calls.length, 1);
    assert.equal(impl.calls[0].body.close_code, 'Known error');
  });

  it('puts on hold with a hold reason, preferring the one about a change', async () => {
    const impl = fake([HOLD_REASONS, ok({ number: 'INC0010042', state: '3' })]);
    const out = await t.setState(CFG, '9d3', 'on_hold', { notes: 'Sent back by dc007.spoc: photo is blurred' }, impl);
    assert.match(impl.calls[0].url, /element=hold_reason/);
    assert.deepEqual(impl.calls[1].body,
      { state: 3, hold_reason: '5', work_notes: 'Sent back by dc007.spoc: photo is blurred' });
    assert.equal(out.holdReason, '5');
    assert.equal(out.state, 'on hold');
  });

  it('falls back to the stock hold reasons when the list is refused', async () => {
    const impl = fake([refused(403, 'ACL'), refused(400, 'bad'), ok({ number: 'INC0010042', state: '3' })]);
    const out = await t.setState(CFG, '9d3', 'on_hold', { notes: 'Waiting.' }, impl);
    assert.deepEqual(impl.calls.slice(1).map((c) => c.body.hold_reason), ['5', '1']);
    assert.equal(out.holdReason, '1');
  });

  it('sets In Progress and Cancelled with a work note and nothing else', async () => {
    const impl = fake([ok({ number: 'INC0010042', state: '2' }), ok({ number: 'INC0010042', state: '8' })]);
    await t.setState(CFG, '9d3', 'in_progress', { notes: 'Back with the SPOC.' }, impl);
    const out = await t.setState(CFG, '9d3', 'cancelled', { notes: 'Rejected by dc007.spoc (not a drift): label was misread' }, impl);
    assert.deepEqual(impl.calls[0].body, { state: 2, work_notes: 'Back with the SPOC.' });
    assert.deepEqual(impl.calls[1].body, { state: 8, work_notes: 'Rejected by dc007.spoc (not a drift): label was misread' });
    assert.equal(out.state, 'cancelled');
    assert.deepEqual(t.STATE_CODE, { in_progress: 2, on_hold: 3, resolved: 6, closed: 7, cancelled: 8 });
  });

  it('refuses a state RackTrack does not set, without calling anybody', async () => {
    const impl = fake([]);
    const out = await t.setState(CFG, '9d3', 'new', {}, impl);
    assert.equal(out.ok, false);
    assert.equal(impl.calls.length, 0);
  });
});

/**
 * A fake instance one level down, at fetch: the sign-in pages and the
 * attachment API. localhost, so that nothing is looked up in DNS.
 */
const LOCAL = { instanceUrl: 'https://localhost', username: 'svc', password: 'x', incidentTable: 'incident' };
const TOKEN = 'ab'.repeat(36);
function instance({ attachment }) {
  const calls = [];
  const page = (text, cookies = []) => ({ status: 200, ok: true, text: async () => text,
    headers: { get: () => null, getSetCookie: () => cookies } });
  const impl = async (url, opts = {}) => {
    calls.push({ url, ...opts });
    if (/login\.do$/.test(url) && opts.method !== 'POST') return page('<input name="sysparm_ck" value="ck1">', ['JSESSIONID=j1; Path=/']);
    if (/login\.do$/.test(url)) return page('', ['glide_user_route=glide.1; Path=/']);
    if (/login_redirect\.do/.test(url)) return page(`<script>var g_ck = '${TOKEN}';</script>`);
    const next = attachment.shift();
    if (next instanceof Error) throw next;
    return { status: next.status, ok: next.status >= 200 && next.status < 300,
      text: async () => JSON.stringify(next.body), headers: { get: () => null, getSetCookie: () => [] } };
  };
  impl.calls = calls;
  impl.uploads = () => calls.filter((c) => /\/api\/now\/attachment\/file/.test(c.url));
  return impl;
}

describe('attaching a file', () => {
  const HTML = Buffer.from('<!doctype html><html><body>Drift report é</body></html>', 'utf8');
  const FILE = { fileName: 'drift-report-check-140.html', contentType: 'text/html; charset=utf-8', body: HTML };
  const STORED = { status: 201, body: { result: { sys_id: 'ab1', file_name: 'drift-report-check-140.html', size_bytes: String(HTML.length) } } };

  it('sends the bytes as they are, under the file\'s own content type, signed like any other call', async () => {
    const sn = instance({ attachment: [STORED] });
    const out = await t.attach(LOCAL, '9d3', FILE, (...a) => t._reqRaw(...a, sn));
    const [up] = sn.uploads();

    assert.equal(up.url, 'https://localhost/api/now/attachment/file?table_name=incident&table_sys_id=9d3&file_name=drift-report-check-140.html');
    assert.equal(up.method, 'POST');
    assert.ok(Buffer.isBuffer(up.body) && up.body.equals(HTML), 'not JSON, not a string: the file');
    assert.equal(up.headers['Content-Type'], 'text/html; charset=utf-8');
    assert.equal(up.headers['Content-Length'], String(HTML.length));
    assert.equal(up.headers['X-UserToken'], TOKEN);
    assert.match(up.headers.Cookie, /glide_user_route=glide\.1/);
    assert.deepEqual(out, { ok: true, status: 201, sysId: 'ab1', name: 'drift-report-check-140.html', size: HTML.length, error: null });
  });

  it('uses the session a table call already opened', async () => {
    const sn = instance({ attachment: [{ status: 200, body: { result: { number: 'INC0010042', state: '2' } } }, STORED] });
    await t.update(LOCAL, '9d3', { work_notes: 'x' }, (...a) => t._req(...a, sn));
    await t.attach(LOCAL, '9d3', FILE, (...a) => t._reqRaw(...a, sn));
    assert.equal(sn.calls.filter((c) => /login\.do$/.test(c.url) && c.method === 'POST').length, 1, 'one sign-in for both');
  });

  it('signs in again once when the session has gone stale', async () => {
    const sn = instance({ attachment: [{ status: 401, body: { error: { message: 'User Not Authenticated' } } }, STORED] });
    const out = await t.attach(LOCAL, '9d3', FILE, (...a) => t._reqRaw(...a, sn));
    assert.equal(out.ok, true);
    assert.equal(sn.uploads().length, 2);
    assert.equal(sn.calls.filter((c) => /login\.do$/.test(c.url) && c.method === 'POST').length, 2);
  });

  it('reports a refusal, and does not try a dropped upload a second time', async () => {
    const no = instance({ attachment: [{ status: 403, body: { error: { message: 'File type not allowed' } } },
      { status: 403, body: { error: { message: 'File type not allowed' } } }] });
    const out = await t.attach(LOCAL, '9d3', FILE, (...a) => t._reqRaw(...a, no));
    assert.deepEqual([out.ok, out.status, out.sysId], [false, 403, null]);
    assert.equal(out.error, 'ServiceNow replied 403: File type not allowed');
    assert.equal(out.name, 'drift-report-check-140.html');

    const cut = instance({ attachment: [new Error('socket hang up'), STORED] });
    const lost = await t.attach(LOCAL, '9d3', FILE, (...a) => t._reqRaw(...a, cut));
    assert.equal(lost.ok, false);
    assert.equal(lost.status, 0);
    assert.match(lost.error, /could not reach ServiceNow: socket hang up/);
    assert.equal(cut.uploads().length, 1, 'nothing says whether the file landed, so it is not sent twice');
  });

  it('takes a photograph the same way, and refuses to send nothing', async () => {
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const impl = fake([ok({ sys_id: 'ab2', file_name: 'rack photo.jpg', size_bytes: '6' }, 201)]);
    const out = await t.attach(CFG, '9d3', { fileName: 'rack photo.jpg', contentType: 'image/jpeg', body: jpg }, impl);
    assert.match(impl.calls[0].url, /file_name=rack photo\.jpg$/, 'the name is escaped on the wire');
    assert.deepEqual(impl.calls[0].headers, { 'Content-Type': 'image/jpeg' });
    assert.ok(impl.calls[0].body.equals(jpg));
    assert.equal(out.sysId, 'ab2');

    assert.equal((await t.attach(CFG, '9d3', { fileName: 'empty.html', contentType: 'text/html', body: Buffer.alloc(0) }, impl)).ok, false);
    assert.equal((await t.attach(CFG, '', FILE, impl)).ok, false);
    assert.equal(impl.calls.length, 1);
  });
});
