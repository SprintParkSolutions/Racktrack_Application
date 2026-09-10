/**
 * Raising ServiceNow incidents from plan items, without an instance.
 *
 * The HTTP call is injected, so these tests assert the two things that
 * actually matter: what we send, and that the same problem found twice does
 * not become two tickets.
 */
const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const t = require('../../lib/netbox/tickets');

const CFG = {
  instanceUrl: 'https://acme.service-now.com/',
  username: 'svc', password: 'x', incidentTable: 'incident',
};
const SPOC = { name: 'Meera Raghavan', email: 'meera.raghavan@sprintpark.com' };

const CTX = {
  item: {
    uid: 'dev:RK-A31AE2E7:u15', type: 'Device', name: 'SW2', action: 'update',
    diff: { position: { from: 14, to: 15 } },
  },
  rackId: 'RK-A31AE2E7', rackName: 'RACK-01', siteName: 'Sprintpark HQ',
  spoc: SPOC, planId: 12, question: 'Is it really at U15?',
  appUrl: 'https://demo.racktrack.ai/plans/12',
};

/** A fake ServiceNow that records what it was asked. */
function fake(responses) {
  const calls = [];
  const impl = async (url, method, _h, body) => {
    calls.push({ url, method, body });
    const next = responses.shift();
    if (!next) throw new Error(`no canned response for ${method} ${url}`);
    return next;
  };
  impl.calls = calls;
  return impl;
}

describe('the incident we send', () => {
  it('is addressed to the SPOC by email, not by name', () => {
    const f = t.toIncident(CTX);
    assert.equal(f.assigned_to, 'meera.raghavan@sprintpark.com',
      'ServiceNow resolves an email to a user; a name matches nothing on most instances');
  });

  it('says what differs, in words somebody can act on', () => {
    const f = t.toIncident(CTX);
    assert.match(f.short_description, /RACK-01, Sprintpark HQ/);
    assert.match(f.short_description, /SW2/);
    assert.match(f.description, /NetBox says 14, we saw 15/);
    assert.match(f.description, /Nothing has been written to NetBox/,
      'the person must know this is not a fait accompli');
    assert.match(f.description, /Is it really at U15\?/, 'the admin\'s question travels with it');
  });

  it('leaves assigned_to out entirely when nobody is named', () => {
    const f = t.toIncident({ ...CTX, spoc: null });
    assert.ok(!('assigned_to' in f), 'an empty assignee is worse than none — it clears theirs');
  });

  it('keys on the rack and the thing, never on the scan or the date', () => {
    const a = t.correlationFor('RK-A31AE2E7', 'dev:RK-A31AE2E7:u15');
    const b = t.toIncident({ ...CTX, planId: 99, item: { ...CTX.item } }).correlation_id;
    assert.equal(a, b, 'a later scan of the same rack must produce the same id');
    assert.notEqual(a, t.correlationFor('RK-OTHER', 'dev:RK-A31AE2E7:u15'));
  });
});

describe('the same problem found twice', () => {
  it('raises one incident the first time', async () => {
    const impl = fake([
      { ok: true, status: 200, body: { result: [] } },
      { ok: true, status: 201, body: { result: { sys_id: 'abc123', number: 'INC0012345', state: '1' } } },
    ]);
    const out = await t.raise(CFG, CTX, impl);
    assert.equal(out.ok, true);
    assert.equal(out.reused, false);
    assert.equal(out.number, 'INC0012345');
    assert.equal(impl.calls[1].method, 'POST');
    assert.match(out.url, /sys_id=abc123/);
  });

  it('comments on the open one rather than raising a second', async () => {
    const impl = fake([
      { ok: true, status: 200,
        body: { result: [{ sys_id: 'abc123', number: 'INC0012345', state: '2' }] } },
      { ok: true, status: 200, body: { result: { sys_id: 'abc123', number: 'INC0012345', state: '2' } } },
    ]);
    const out = await t.raise(CFG, CTX, impl);
    assert.equal(out.reused, true);
    assert.equal(out.reopened, false);
    assert.equal(out.number, 'INC0012345');
    assert.equal(impl.calls[1].method, 'PATCH');
    assert.match(impl.calls[1].body.work_notes, /Seen again/);
    assert.ok(!('state' in impl.calls[1].body), 'an open incident is left in its own state');
  });

  it('reopens a closed one when the problem comes back', async () => {
    const impl = fake([
      { ok: true, status: 200,
        body: { result: [{ sys_id: 'abc123', number: 'INC0012345', state: '7' }] } },
      { ok: true, status: 200, body: { result: { sys_id: 'abc123', number: 'INC0012345', state: '2' } } },
    ]);
    const out = await t.raise(CFG, CTX, impl);
    assert.equal(out.reused, true);
    assert.equal(out.reopened, true);
    assert.equal(impl.calls[1].body.state, 2);
    assert.match(impl.calls[1].body.work_notes, /Reopened/);
  });

  it('reports a failure instead of pretending it worked', async () => {
    const impl = fake([{ ok: false, status: 401, body: { error: 'unauthorised' } }]);
    const out = await t.raise(CFG, CTX, impl);
    assert.equal(out.ok, false);
    assert.equal(out.status, 401);
  });
});

describe('hearing back', () => {
  it('reads state from ServiceNow and never sets it', async () => {
    const impl = fake([{ ok: true, status: 200, body: { result: [
      { sys_id: 'a1', number: 'INC1', state: '2' },
      { sys_id: 'a2', number: 'INC2', state: '6', close_notes: 'It is at U15. NetBox was wrong.',
        resolved_at: '2026-09-10 09:14:22' },
      { sys_id: 'a3', number: 'INC3', state: '7' },
    ] } }]);
    const out = await t.statusOf(CFG, ['a1', 'a2', 'a3'], impl);

    assert.equal(out.ok, true);
    assert.equal(out.states.a1.closed, false);
    assert.equal(out.states.a1.state, 'in progress');
    assert.equal(out.states.a2.closed, true);
    assert.equal(out.states.a2.state, 'resolved');
    assert.equal(out.states.a2.notes, 'It is at U15. NetBox was wrong.');
    assert.equal(out.states.a3.state, 'closed');
    assert.equal(impl.calls[0].method, 'GET', 'reading back is read-only');
  });

  it('asks nothing when there is nothing to ask about', async () => {
    const out = await t.statusOf(CFG, [], fake([]));
    assert.deepEqual(out, { ok: true, states: {} });
  });
});

describe('urgency comes from what it is, not from a guess', () => {
  it('rates a device higher than a port', () => {
    assert.equal(t.urgencyFor({ type: 'Device', action: 'create' }), 2);
    assert.equal(t.urgencyFor({ type: 'Interface', action: 'create' }), 3);
  });
});
