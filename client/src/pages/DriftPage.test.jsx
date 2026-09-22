import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/* The technician's screen: it compares and sends, and that is all. Nothing on
   it approves, assigns or writes, whatever the caller's role. What it sends goes
   to the SPOC of the site, and the screen says so by name. */

const { routes } = vi.hoisted(() => ({ routes: { current: {} } }));
vi.mock('../utils/api', () => ({
  apiUrl: (p) => p,
  authFetch: vi.fn(async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    const h = routes.current[`${method} ${url}`];
    if (!h) return { ok: false, status: 404, json: async () => ({ error: `no stub for ${method} ${url}` }) };
    const status = h.status || 200;
    // A body may be a function, so a stub can answer differently once something
    // has been written - which is how a confirmation changes the next answer.
    return { ok: status < 400, status, json: async () => (typeof h.body === 'function' ? h.body() : h.body) };
  }),
}));

import DriftPage from './DriftPage.jsx';
import { authFetch } from '../utils/api';

const DEV = 'dev:RK-1:u16';
const plan = (status) => ({
  id: 7, rackId: 'RK-1', scanId: 3, status,
  submittedBy: status === 'submitted' ? 'ravi' : null,
  submittedAt: status === 'submitted' ? new Date().toISOString() : null,
  items: [{ uid: DEV, type: 'Device', name: 'SW-16', action: 'create', decidable: true, decision: 'pending' }],
});
function stub(status, contacts = { body: { spoc: null } }, extra = {}) {
  routes.current = {
    'POST /api/nb/scans/adopt/RK-1': { body: { id: 3 } },
    'POST /api/nb/netbox/3/preview': { body: { planId: 7 } },
    'GET /api/nb/plans/7': { body: plan(status) },
    'GET /api/nb/plans/7/contacts': contacts,
    'GET /api/nb/scans/rack/RK-1/name': { body: { name: '' } },
    ...extra,
  };
}
const mountAt = (path) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes><Route path="/results/:rackId/drift" element={<DriftPage />} /></Routes>
  </MemoryRouter>,
);
const mount = () => mountAt('/results/RK-1/drift');
const buttonNames = () => screen.queryAllByRole('button').map((b) => b.textContent.trim().toLowerCase());
const FORBIDDEN = /approve|reject|assign|write|export/;

// What the server says about who a check goes to, and what Send answers.
const SPOC = { name: 'dc007.spoc', email: 'spoc@dc007.example', title: 'SPOC of Site 32 - Office-Sprintpark', userId: 41, source: 'site' };
const toSpoc = { body: { spoc: SPOC, goesTo: 'spoc', why: null, whyText: null, others: [], everyone: [], serviceNow: true } };
const NO_SPOC = 'Office-Sprintpark has no SPOC yet.';
const toAdmin = { body: { spoc: null, siteSpoc: null, goesTo: 'admin', why: 'no_spoc', whyText: NO_SPOC } };
const INCIDENT = { system: 'servicenow', number: 'INC0010042', url: 'https://dev1.service-now.com/incident/42', state: 'new', assigned: true, error: null };
const SUBMIT = 'POST /api/nb/plans/7/submit';
const FLOW = 'GET /api/approvals/plans/7';
// A sent check: a named section that says where the check has got to, the
// incident number as a labelled fact inside it, and the line that says who
// holds it. The section comes AFTER the differences - they are the page.
const sentBlock = () => document.querySelector('section[class*="waiting"], section[class*="done"]');
const heading = () => sentBlock().querySelector('h2').textContent;
const statusLine = () => sentBlock().querySelector('dd p').textContent;
const incidentNumber = () => {
  const el = sentBlock().querySelector('[class*="factMono"]');
  return el ? el.textContent : null;
};

// The calls are counted per test: more than one of them sends a check.
afterEach(() => { cleanup(); authFetch.mockClear(); });

describe('<DriftPage>', () => {
  test('before sending: one button, Raise incident, under who it goes to, and nothing that decides or writes', async () => {
    stub('open', { body: { ...toSpoc.body, matchedRack: KNOWN } });
    mount();
    await screen.findByText('SW-16');
    // who it goes to is said before anything is sent
    expect(screen.getByText('Goes to')).toBeTruthy();
    expect(screen.getByText('dc007.spoc')).toBeTruthy();
    expect(screen.getByText('SPOC of Site 32 - Office-Sprintpark')).toBeTruthy();
    expect(screen.getByText('spoc@dc007.example')).toBeTruthy();
    expect(screen.getByLabelText('Note for the SPOC (optional)')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Raise incident' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Send/ })).toBeNull();
    // sending it is one action, so it is one block: who it goes to, the note for
    // them and the button, with the drift report the quiet thing after it
    const action = screen.getByRole('button', { name: 'Raise incident' }).closest('div').parentElement;
    expect(action.contains(screen.getByText('Goes to'))).toBe(true);
    expect(action.contains(screen.getByLabelText('Note for the SPOC (optional)'))).toBe(true);
    expect(action.nextElementSibling.textContent).toMatch(/^Report/);
    expect(buttonNames().filter((n) => FORBIDDEN.test(n))).toEqual([]);
    expect(document.body.textContent).not.toMatch(/Write the approved|Assign to|Approve\b/);
    // the answer is one sentence, and no strip of big numbers says it again
    expect(document.body.textContent).toMatch(/1 difference/);
    expect(document.body.textContent).not.toMatch(/Compared with NetBox just now/);
    expect(screen.queryByRole('group', { name: 'Summary of the comparison' })).toBeNull();
    expect(document.body.textContent).not.toMatch(/Send it to/);
    // Nothing to track until it has been sent.
    expect(screen.queryByRole('button', { name: /Track it/ })).toBeNull();
  });

  test('a server that names nobody: the button still raises the incident, and no Goes to block is drawn', async () => {
    stub('open');
    mount();
    await screen.findByText('SW-16');
    expect(screen.getByRole('button', { name: 'Raise incident' })).toBeTruthy();
    expect(screen.queryByText('Goes to')).toBeNull();
  });

  test('no SPOC, or the sender is the SPOC: it says before sending that an admin will choose', async () => {
    stub('open', { body: { ...toAdmin.body, matchedRack: KNOWN } });
    routes.current[SUBMIT] = { body: { planId: 7, status: 'submitted', state: 'triage', goesTo: 'admin', assignee: null,
      needsAdmin: { why: 'no_spoc', text: NO_SPOC }, incident: null } };
    mount();
    await screen.findByText('SW-16');
    expect(screen.getByText('An organization admin')).toBeTruthy();
    expect(screen.getByText(`${NO_SPOC} An admin will choose who decides it.`)).toBeTruthy();
    expect(screen.getByLabelText('Note for the admin (optional)')).toBeTruthy();
    // who decides it is said once, by the block over the button, not in the answer
    expect(document.body.textContent).not.toMatch(/Send it to/);

    fireEvent.click(screen.getByRole('button', { name: 'Raise incident' }));
    // no incident was raised, so the heading says where it went; one line under it
    await screen.findByText('It needs an admin');
    expect(statusLine()).toBe('Needs an admin');
    expect(document.querySelector('ol[aria-label="Progress of this check"]')).toBeNull();
    expect(screen.getByText('Waiting on an admin')).toBeTruthy();
  });

  test('after sending: watches only, still nothing that decides or writes', async () => {
    stub('submitted');
    mount();
    await screen.findByText('Sent to the SPOC');
    expect(statusLine()).toBe('With the SPOC');
    expect(screen.queryByRole('button', { name: /^(Send|Raise)/ })).toBeNull();
    // it has gone, so nothing on the screen still asks for it to be sent
    expect(document.body.textContent).not.toMatch(/Send it to/);
    expect(buttonNames().filter((n) => FORBIDDEN.test(n))).toEqual([]);
    expect(screen.getByText('Waiting on the SPOC')).toBeTruthy();
    // One way on, and it stays in the app: the check's own page, which is
    // where a technician follows what they sent. Nothing leaves for the Desk.
    const track = screen.getAllByRole('button', { name: /Track it/ });
    expect(track).toHaveLength(1);
    expect(track[0].getAttribute('href')).toBe(null);
    expect(document.querySelector('a[href*="/approvals/"]')).toBeNull();
  });

  test('a member whom the contacts route turns away still gets the page', async () => {
    stub('open', { status: 403, body: { error: 'admins only' } });
    mount();
    await screen.findByText('SW-16');
    expect(screen.getByRole('button', { name: 'Raise incident' })).toBeTruthy();
    expect(screen.queryByText('Goes to')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

/* Which rack is this? The answer, how it was found, and - when nothing can
   decide - the short list a person picks from. The screen never calls a
   suggestion a match, and the rack a person picks is what the next check
   compares against. */

const IDENTITY = 'GET /api/scan/RK-1/identity';
const CONFIRM = 'POST /api/scan/RK-1/identity/confirm';
const contactsFor = (rack) => ({ body: { spoc: null, matchedRack: rack } });
const KNOWN = { name: 'RK-07', confidence: 'known', why: 'matched a rack the customer set up; not in NetBox yet' };
const NOTHING = { name: 'RK-1', confidence: 'none', why: 'this scan is not tied to a rack the customer has set up' };
const cand = (id, name, score) => ({ source: 'known', id, name, facilityId: null, score, reasons: [] });

describe('<DriftPage> choosing and following', () => {
  const two = (status) => ({
    id: 7, rackId: 'RK-1', scanId: 3, status,
    submittedBy: status === 'submitted' ? 'ravi' : null,
    submittedAt: status === 'submitted' ? new Date().toISOString() : null,
    items: [
      { uid: 'dev:a', type: 'Device', name: 'SW-16', action: 'create', decidable: true, decision: 'pending' },
      { uid: 'dev:b', type: 'Device', name: 'FW-02', action: 'update', decidable: true, decision: 'pending' },
    ],
  });

  test('one difference can be left out, and only the ticked ones are sent', async () => {
    stub('open');
    routes.current['GET /api/nb/plans/7'] = { body: two('open') };
    routes.current['POST /api/nb/plans/7/submit'] = { body: { planId: 7, status: 'submitted' } };
    mount();
    await screen.findByText('SW-16');
    expect(screen.getByText('All selected')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Raise incident' })).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Send FW-02' }));
    expect(screen.getByText('1 of 2 selected')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Raise incident for 1 of 2' }));
    await waitFor(() => {
      const call = authFetch.mock.calls.find(([u, init]) => u === '/api/nb/plans/7/submit' && init && init.method === 'POST');
      expect(call).toBeTruthy();
      expect(JSON.parse(call[1].body).items).toEqual(['dev:a']);
    });
  });

  test('with nothing ticked there is nothing to send', async () => {
    stub('open');
    routes.current['GET /api/nb/plans/7'] = { body: two('open') };
    mount();
    await screen.findByText('SW-16');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Send SW-16' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Send FW-02' }));
    expect(screen.getByRole('button', { name: 'Choose at least one to send' }).disabled).toBe(true);
  });

  test('a part send says how many, and the SPOC stays named above it', async () => {
    stub('open', toSpoc);
    routes.current['GET /api/nb/plans/7'] = { body: two('open') };
    mount();
    await screen.findByText('SW-16');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Send FW-02' }));
    expect(screen.getByRole('button', { name: 'Raise incident for 1 of 2' })).toBeTruthy();
    expect(screen.getByText('Goes to')).toBeTruthy();
    expect(screen.getByText('dc007.spoc')).toBeTruthy();
  });

  test('after sending: the incident number, one line that says who holds it, and the two ways on', async () => {
    stub('submitted', toSpoc);
    routes.current[FLOW] = { body: {
      ok: true,
      plan: { id: 7, status: 'assigned', spocUserId: 41 },
      holder: { userId: 41, username: 'dc007.spoc', source: 'site' },
      items: [{ uid: DEV, name: 'SW-16' }],
      // the pointer copies of the one incident, which a held check does not list
      tickets: [{ itemUid: DEV, assignee: 'dc007.spoc', status: 'open', external: { number: 'INC0010042', planLevel: true } }],
      incident: INCIDENT,
    } };
    mount();
    await screen.findByText('Sent');
    expect(incidentNumber()).toBe('INC0010042');
    expect(statusLine()).toBe('With dc007.spoc');
    // the four steps are that one line now
    expect(document.querySelector('ol[aria-label="Progress of this check"]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/Sent to dc007\.spoc|It is with/);
    // The incident's number is on the screen; the way into ServiceNow is not
    // a control here any more, and no address is ever printed.
    expect(screen.queryByRole('link', { name: /ServiceNow/ })).toBeNull();
    expect(document.body.textContent).not.toMatch(/https?:\/\//);
    // one line says who has it; the ticket per difference is not listed
    expect(screen.queryByText(/INC0010042 - open/)).toBeNull();
    expect(buttonNames().filter((n) => FORBIDDEN.test(n))).toEqual([]);
  });

  test('once sent, the drift report sits right under the number and the line, and only there', async () => {
    stub('submitted', { body: { ...toSpoc.body, matchedRack: KNOWN } });
    routes.current[FLOW] = { body: { plan: { id: 7, status: 'assigned' }, holder: { username: 'dc007.spoc' }, incident: INCIDENT } };
    mount();
    await screen.findByText(/^(Sent|It needs an admin|The record has been updated)$/);
    const reports = screen.getAllByRole('button', { name: /^Report/ });
    expect(reports).toHaveLength(1);
    expect(sentBlock().nextElementSibling.contains(reports[0])).toBe(true);
    // Two blocks, each saying what it opens, and no sentence under them once
    // the check has been sent.
    expect(sentBlock().nextElementSibling.textContent)
      .toBe('ReportThis check, one pageTrack itWhere it is now');
  });

  test('right after Send the line starts where the check landed, without waiting to be told again', async () => {
    stub('open', toSpoc);
    routes.current[SUBMIT] = { body: { planId: 7, status: 'submitted', already: false, state: 'assigned', goesTo: 'spoc',
      assignee: { userId: 41, name: 'dc007.spoc', email: 'spoc@dc007.example' }, needsAdmin: null, incident: INCIDENT } };
    mount();                                       // no approvals route stubbed: the follow-up answers 404
    await screen.findByText('SW-16');
    fireEvent.click(screen.getByRole('button', { name: 'Raise incident' }));
    await screen.findByText(/^(Sent|It needs an admin|The record has been updated)$/);
    expect(statusLine()).toBe('With dc007.spoc');
  });

  test('an older check, sent before checks had a holder, still lists who has each ticket', async () => {
    stub('submitted');
    routes.current[FLOW] = { body: {
      plan: { id: 7, status: 'in_progress' },
      items: [{ uid: DEV, name: 'SW-16' }],
      tickets: [{ itemUid: DEV, assignee: 'dc007.tech', status: 'in_progress', external: { number: 'INC0010007' } }],
    } };
    mount();
    await screen.findByText('Sent to the SPOC');
    expect(statusLine()).toBe('With the SPOC');
    await screen.findByText(/With dc007.tech - INC0010007 - in progress/);
  });

  test('sent back, and on hold, are still with the SPOC to the person who sent it', async () => {
    stub('submitted');
    routes.current[FLOW] = { body: { plan: { id: 7, status: 'rework', spocUserId: 41 }, holder: { username: 'dc007.spoc' } } };
    mount();
    await waitFor(() => expect(statusLine()).toBe('With dc007.spoc'));
    cleanup();

    routes.current[FLOW] = { body: { plan: { id: 7, status: 'pending', pendingReason: 'waiting_for_access', spocUserId: 41 }, holder: { username: 'dc007.spoc' } } };
    mount();
    await waitFor(() => expect(statusLine()).toBe('With dc007.spoc'));
    expect(document.body.textContent).not.toMatch(/waiting_for_access/);
  });

  test('approved, rejected, and a write that failed: each is the one line', async () => {
    stub('submitted');
    for (const [status, line] of [['approved', 'Approved'], ['write_in_progress', 'Approved'], ['rejected', 'Rejected'],
      ['write_failed', 'Needs an admin'], ['manual_review', 'Needs an admin'], ['triage', 'Needs an admin'],
      ['cancelled', 'This check was cancelled.']]) {
      routes.current[FLOW] = { body: { plan: { id: 7, status }, holder: { username: 'dc007.spoc' }, incident: INCIDENT } };
      mount();
      await waitFor(() => expect(statusLine()).toBe(line));
      expect(incidentNumber()).toBe('INC0010042');
      cleanup();
    }
  });

  test('the incident line: nothing while it is being raised or where there is no ServiceNow, a sentence when it failed', async () => {
    const held = (incident) => ({ body: { plan: { id: 7, status: 'assigned' }, holder: { username: 'dc007.spoc' }, incident } });
    stub('submitted');
    routes.current[FLOW] = held({ system: 'servicenow', number: null, state: 'raising', error: null });
    mount();
    await screen.findByText('Sent');
    expect(statusLine()).toBe('With dc007.spoc');
    expect(document.body.textContent).not.toMatch(/Incident|INC|ServiceNow/);
    cleanup();

    routes.current[FLOW] = held({ system: 'none' });
    mount();
    await screen.findByText('Sent');
    expect(document.body.textContent).not.toMatch(/Incident|INC|ServiceNow/);
    cleanup();

    routes.current[FLOW] = held({ system: 'servicenow', number: null, error: 'HTTP 503' });
    mount();
    await screen.findByText('No ServiceNow incident could be raised. An admin has been told.');
    expect(document.body.textContent).not.toMatch(/503/);
  });

  test('a written check keeps its incident number and says Written to NetBox', async () => {
    stub('applied');
    routes.current[FLOW] = { body: { plan: { id: 7, status: 'completed' }, holder: { username: 'dc007.spoc' },
      decisions: [{ stage: 'final', approver: 'dc007.spoc', decision: 'approved' }], incident: { ...INCIDENT, state: 'resolved' } } };
    mount();
    await screen.findByText(/^(Sent|It needs an admin|The record has been updated)$/);
    expect(statusLine()).toBe('Written to NetBox');
    expect(screen.queryByRole('link', { name: /ServiceNow/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^(Send|Raise)/ })).toBeNull();
    expect(screen.getAllByRole('button', { name: /Track it/ })).toHaveLength(1);
  });

  test('a written check on a server that cannot be followed still ends on Written', async () => {
    stub('applied');                               // no approvals route: 404
    mount();
    await screen.findByText('The record has been updated');
    expect(statusLine()).toBe('Written to NetBox');
  });
});

/* A notice about a sent check names it. The screen shows that check as it
   stands: comparing again would file a new draft beside a rejected one. */
describe('<DriftPage> opened on a named check', () => {
  const asked = () => authFetch.mock.calls.map(([url, init = {}]) => `${(init.method || 'GET').toUpperCase()} ${url}`);

  test('a rejected check is shown as rejected: nothing is compared again and nothing can be sent', async () => {
    stub('open');                                   // what comparing again would answer: a new draft
    routes.current['GET /api/nb/plans/140'] = { body: { ...plan('rejected'), id: 140, state: 'rejected' } };
    routes.current['GET /api/nb/plans/140/contacts'] = toSpoc;
    mountAt('/results/RK-1/drift?plan=140');
    await waitFor(() => expect(screen.getAllByText('Rejected').length).toBeGreaterThan(0));
    expect(asked().filter((c) => /\/adopt\/|\/preview$/.test(c))).toEqual([]);
    expect(asked()).toContain('GET /api/nb/plans/140/contacts');
    expect(asked()).toContain('GET /api/approvals/plans/140');
    expect(screen.queryByRole('button', { name: /^(Send|Raise)/ })).toBeNull();
    expect(screen.queryByText('Goes to')).toBeNull();
  });

  test("another rack's check, one never sent, or one that cannot be read: compared as usual", async () => {
    for (const named of [
      { body: { ...plan('rejected'), id: 140, rackId: 'RK-2' } },
      { body: { ...plan('open'), id: 140 } },
      { status: 404, body: { error: 'no such plan' } },
    ]) {
      stub('open', toSpoc);
      routes.current['GET /api/nb/plans/140'] = named;
      mountAt('/results/RK-1/drift?plan=140');
      await screen.findByText('Goes to');
      expect(asked()).toContain('POST /api/nb/netbox/3/preview');
      expect(asked()).not.toContain('GET /api/nb/plans/140/contacts');
      cleanup(); authFetch.mockClear();
    }
  });
});

/* Ports: physical against logical. Asked for after the comparison is up, never
   waited on, and left out when the server has nothing to say. */
describe('<DriftPage> ports', () => {
  const PORTS = { ok: true, planId: 7, sources: { camera: true, switch: true, netbox: true },
    summary: { match: 21, mismatch: 1, unknown: 25 },
    rows: [
      { deviceUid: DEV, device: 'Switch on shelf U16', port: 3, portName: 'Gi1/0/3', camera: 'cabled', switch: 'down',
        netbox: 'connected', verdict: 'mismatch', why: 'The photo shows a cable. The switch says the port is down.' },
      { deviceUid: DEV, device: 'Switch on shelf U16', port: 4, portName: 'Gi1/0/4', camera: 'cabled', switch: 'up',
        netbox: 'connected', verdict: 'match', why: null },
    ], note: null };

  test('the section is closed by default, and opens to what does not match', async () => {
    stub('open', toSpoc, { 'GET /api/nb/plans/7/connectivity': { body: PORTS } });
    mount();
    await screen.findByText('SW-16');
    // The three quiet groups share one line, and only the one picked opens.
    const top = await screen.findByRole('tab', { name: /^Ports/ });
    expect(top.getAttribute('aria-selected')).toBe('false');
    expect(top.textContent).toBe('Ports47');
    fireEvent.click(top);
    expect(top.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Matched 21, not matched 1, not known 25.')).toBeTruthy();
    expect(screen.getByText('Switch on shelf U16 - port 3')).toBeTruthy();
    expect(screen.getByText('Switch: down')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Matched ports (1)' })).toBeTruthy();
    expect(buttonNames().filter((n) => FORBIDDEN.test(n))).toEqual([]);
  });

  test('a server without the route, or one that refuses, leaves the section out and the page whole', async () => {
    stub('open', toSpoc);                          // no connectivity stub: 404
    mount();
    await screen.findByText('SW-16');
    expect(screen.getByRole('button', { name: 'Raise incident' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Ports/ })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('<DriftPage> the whole comparison', () => {
  test('says how much matches, names the record each match is, and lists what was not seen', async () => {
    stub('open', contactsFor(KNOWN));
    routes.current['GET /api/nb/plans/7'] = { body: {
      id: 7, rackId: 'RK-1', scanId: 3, status: 'open',
      items: [
        { uid: 'dev:RK-1:u20', type: 'Device', name: 'Router U20', action: 'create', decidable: true, decision: 'pending' },
        { uid: 'dev:RK-1:u17', type: 'Device', name: 'Switch U17', action: 'skip', decidable: false },
        { uid: 'if:1', type: 'Interface', name: '1', action: 'skip' },
      ],
      orphans: [
        { netboxId: 196, name: 'SP-R1-U17-SW03', position: 17, seen: true, matchedBox: 'dev:RK-1:u17' },
        { netboxId: 198, name: 'SP-R1-U19-FW', position: 19, seen: false },
      ],
    } };
    mount();
    await screen.findByText('Router on shelf U20');
    // the difference is the substance of the page; what agrees and what was not
    // seen is one quiet row each, with one number on it
    expect(screen.getByText('Not in your records')).toBeTruthy();
    expect(screen.getByRole('tab', { name: /^Matched/ }).textContent).toBe('Matched1');
    expect(screen.getByRole('tab', { name: /^Not seen/ }).textContent).toBe('Not seen1');
    // and only the one a person picks opens: the match is named by the record
    // it matched, the unseen record by its shelf
    fireEvent.click(screen.getByRole('tab', { name: /^Matched/ }));
    expect(screen.getByText('Switch on shelf U17')).toBeTruthy();
    expect(screen.getByText('SP-R1-U17-SW03')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /^Not seen/ }));
    expect(screen.getByText('SP-R1-U19-FW')).toBeTruthy();
    expect(screen.getByText('Shelf U19')).toBeTruthy();
    // no strip of big numbers, and no heading that counts the differences again
    expect(screen.queryByRole('group', { name: 'Summary of the comparison' })).toBeNull();
    expect(document.querySelector('h3')).toBeNull();
    expect(document.body.textContent).not.toMatch(/Unmatched/);
    expect(document.body.textContent).not.toMatch(/Matching your records|not seen in the photo/);
    // the count is said once, and the sentence under it says the rest agrees
    expect(document.body.textContent.match(/1 difference/g)).toHaveLength(1);
    expect(screen.getByRole('button', { name: /^Report/ })).toBeTruthy();
    expect(screen.getByText('This check, one page')).toBeTruthy();
    expect(screen.getByText('The report is attached to the incident when you send.')).toBeTruthy();
  });

  test('each thing is said once, and in the order a person needs it', async () => {
    stub('open', { body: { ...toSpoc.body, matchedRack: KNOWN } });
    routes.current['GET /api/nb/plans/7'] = { body: {
      id: 7, rackId: 'RK-1', scanId: 3, status: 'open',
      items: [
        { uid: 'dev:RK-1:u20', type: 'Device', name: 'Router U20', action: 'create', decidable: true, decision: 'pending' },
        { uid: 'dev:RK-1:u17', type: 'Device', name: 'Switch U17', action: 'skip', decidable: false },
      ],
      orphans: [
        { netboxId: 196, name: 'SP-R1-U17-SW03', position: 17, seen: true, matchedBox: 'dev:RK-1:u17' },
        { netboxId: 198, name: 'SP-R1-U19-FW', position: 19, seen: false },
      ],
    } };
    mount();
    await screen.findByText('Router on shelf U20');
    const text = document.body.textContent;
    const at = (s) => { const i = text.indexOf(s); expect(i).toBeGreaterThan(-1); return i; };
    // which rack, the answer, the difference itself, what needs no attention,
    // then the one action - who it goes to, the note and the button - and last
    // the report
    const order = ['Drift check', 'RK-07', '1 difference',
      'Router on shelf U20', 'Matched', 'Not seen', 'Goes to', 'dc007.spoc',
      'Note for the SPOC', 'Raise incident', 'Report'].map(at);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // and no count is said twice
    expect(text.match(/1 difference/g)).toHaveLength(1);
    expect(text.match(/Matched/g)).toHaveLength(1);
  });

  test('the drift report is read in the app, on a fresh link that names the check', async () => {
    stub('open', contactsFor(KNOWN), { 'GET /api/scan/RK-1/report-token': { body: { token: 'tok' } } });
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null);
    mount();
    await screen.findByText('SW-16');
    fireEvent.click(screen.getByRole('button', { name: /^Report/ }));
    const frame = await screen.findByTitle('Drift report');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame.getAttribute('src')).toMatch(/\/api\/scan\/RK-1\/drift-report\?plan=7&t=tok$/);
    // nothing inside the report may steer the app somewhere else
    expect(frame.getAttribute('sandbox')).toBe('allow-same-origin');
    // and nobody is sent out to a browser to read our own page
    expect(opened).not.toHaveBeenCalled();
    opened.mockRestore();
  });

  test("the report's own back arrow closes it and leaves the check where it was", async () => {
    stub('open', contactsFor(KNOWN), { 'GET /api/scan/RK-1/report-token': { body: { token: 'tok' } } });
    mount();
    await screen.findByText('SW-16');
    fireEvent.click(screen.getByRole('button', { name: /^Report/ }));
    const report = await screen.findByRole('dialog', { name: 'Drift report' });
    fireEvent.click(within(report).getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('dialog', { name: 'Drift report' })).toBeNull();
    expect(screen.getByText('SW-16')).toBeTruthy();
  });

  test("the phone's own back button closes the report rather than leaving the check", async () => {
    stub('open', contactsFor(KNOWN), { 'GET /api/scan/RK-1/report-token': { body: { token: 'tok' } } });
    mount();
    await screen.findByText('SW-16');
    fireEvent.click(screen.getByRole('button', { name: /^Report/ }));
    await screen.findByRole('dialog', { name: 'Drift report' });
    // App.jsx asks the screen first and takes a cancelled event as "handled here"
    let handled = true;
    act(() => { handled = window.dispatchEvent(new CustomEvent('rt:back', { cancelable: true })); });
    expect(handled).toBe(false);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Drift report' })).toBeNull());
    expect(screen.getByText('SW-16')).toBeTruthy();
  });
});

describe('<DriftPage> housekeeping', () => {
  test("RackTrack's own tag on a matched rack is a note, not a mismatch, and shows no internal keys", async () => {
    stub('draft');
    routes.current['GET /api/nb/plans/7'] = { body: {
      id: 7, rackId: 'RK-1', scanId: 3, status: 'draft',
      items: [{
        uid: 'rack:t32:16', type: 'Rack', name: 'SP-HYB-RM01-R01-R1', action: 'rebind',
        fromUid: null, boundBy: 'record-binding', decidable: true, decision: 'pending',
        diff: { racktrack_uid: { from: null, to: 'rack:t32:16' }, recordId: { from: null, to: 26 } },
      }, { uid: 'site:office', type: 'Site', name: 'Office-Sprintpark', action: 'create', supporting: true, decidable: false }],
    } };
    mount();
    await screen.findByText('Everything matches');
    expect(screen.queryByText(/does not match/)).toBeNull();
    expect(screen.queryByText(/racktrack_uid|recordId|rack:t32:16/)).toBeNull();
    expect(screen.queryByText(/related record/)).toBeNull();
    expect(screen.queryByRole('button', { name: /^send/i })).toBeNull();
    expect(screen.getByText(/will note its own id on the record/)).toBeTruthy();
  });

  test('the same line carrying a shelf the SPOC approved is the difference that was sent, not a note', async () => {
    stub('submitted');
    routes.current['GET /api/nb/plans/7'] = { body: {
      id: 7, rackId: 'RK-1', scanId: 3, status: 'submitted', state: 'assigned', submittedBy: 'ravi', submittedAt: new Date().toISOString(),
      items: [{
        uid: 'dev:RK-1:u20', type: 'Device', name: 'Router U20', action: 'rebind',
        fromUid: null, decidable: true, decision: 'approved',
        diff: { racktrack_uid: { from: null, to: 'dev:RK-1:u20' }, recordId: { from: null, to: 199 }, position: { from: 22, to: 20 } },
      }],
    } };
    mount();
    await screen.findByText('Router on shelf U20');
    expect(screen.getAllByText('Different from your records').length).toBeGreaterThan(0);
    expect(screen.getByText('Your records list this on shelf U22. You saw it on shelf U20.')).toBeTruthy();
    expect(screen.queryByText('Listed under an older id')).toBeNull();
    expect(screen.queryByText(/racktrack_uid|recordId|dev:RK-1/)).toBeNull();
  });

  test("a rack really held under an older RackTrack id is still a difference", async () => {
    stub('draft');
    routes.current['GET /api/nb/plans/7'] = { body: {
      id: 7, rackId: 'RK-1', scanId: 3, status: 'draft',
      items: [{
        uid: 'rack:t32:16', type: 'Rack', name: 'SP-HYB-RM01-R01-R1', action: 'rebind',
        fromUid: 'rack:RK-OLD', decidable: true, decision: 'pending',
        diff: { racktrack_uid: { from: 'rack:RK-OLD', to: 'rack:t32:16' } },
      }],
    } };
    mount();
    await screen.findByText(/1 difference|would be added/);
    expect(screen.getByText('Listed under an older id')).toBeTruthy();
    expect(screen.queryByText(/racktrack_uid/)).toBeNull();
  });
});

describe('<DriftPage> which rack', () => {
  test('the rack it was compared against, and what found it, are on the screen', async () => {
    stub('open', contactsFor(KNOWN), {
      [IDENTITY]: {
        body: {
          ok: true, decision: 'matched', confidence: 'probable', rule: 'label',
          rack: { source: 'known', id: 5, name: 'RK-07', facilityId: null },
          rackKey: 't11:5', candidates: [cand(5, 'RK-07', 0.9)],
        },
      },
    });
    mount();
    await screen.findByText('SW-16');
    // The rack's own name is the heading; how it was matched is in the drift
    // report, not on this screen (the owner took the sentence and its Read more
    // off on 22 Sep: the screen answers what differs, not how the rack was found).
    expect(screen.getByText('RK-07')).toBeTruthy();
    expect(screen.queryByText('Compared against')).toBeNull();
    expect(document.querySelector('[class*="rack"] details')).toBeNull();
    // It is settled, so nothing is asked of anybody.
    expect(screen.queryByText('Which rack is this?')).toBeNull();
    // Nothing internal reaches the screen.
    expect(document.body.textContent).not.toMatch(/\brung\b|\brackKey\b|\buid\b|\btenant\b/i);
    // Where the phone stood is no part of it: the site is chosen on the scan screen.
    expect(document.body.textContent).not.toMatch(/location|photo was taken|Photo taken/i);
  });

  test('a suggestion is put to a person, and the rack they pick is what the next check uses', async () => {
    let confirmed = false;
    const suggested = {
      ok: true, decision: 'suggested', confidence: 'possible', rule: 'only-rack',
      rack: null, rackKey: null,
      candidates: [cand(5, 'RK-07', 0.5), cand(6, 'RK-08', 0.4), cand(7, 'RK-09', 0.3), cand(8, 'RK-10', 0.2)],
    };
    const settled = {
      ok: true, decision: 'matched', confidence: 'confirmed', rule: 'record',
      rack: { source: 'known', id: 6, name: 'RK-08', facilityId: null }, rackKey: 't11:6',
      candidates: [cand(6, 'RK-08', 1)],
    };
    stub('open', { body: () => ({ spoc: null, matchedRack: confirmed ? { ...KNOWN, name: 'RK-08' } : KNOWN }) }, {
      [IDENTITY]: { body: () => (confirmed ? settled : suggested) },
      [CONFIRM]: { body: () => { confirmed = true; return { ok: true, rackKey: 't11:6' }; } },
    });
    mount();
    await screen.findByText('SW-16');

    // A suggestion is never worded as a match, and it says who has not confirmed it.
    expect(screen.getByText('It is the only rack set up in this room. Nobody has confirmed it.')).toBeTruthy();
    expect(screen.queryByText(/^Matched by/)).toBeNull();
    // A short list, never the whole site: three at most, in the order they ranked.
    expect(screen.getByText('Which rack is this?')).toBeTruthy();
    const choices = ['RK-07', 'RK-08', 'RK-09'].map((n) => screen.getByRole('button', { name: n }));
    expect(choices).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'RK-10' })).toBeNull();

    fireEvent.click(choices[1]);
    // The rack that was picked is the one it was confirmed as, by its record.
    const sent = authFetch.mock.calls.find(([url, init]) => url === '/api/scan/RK-1/identity/confirm' && init);
    expect(JSON.parse(sent[1].body)).toEqual({ knownRackId: 6 });
    // And the check ran again, against the rack that was chosen.
    await waitFor(() => expect(screen.getByText('RK-08')).toBeTruthy());
    expect(screen.queryByText('Which rack is this?')).toBeNull();
  });

  test('a rack the record has never heard of says so, and can be added rather than forced', async () => {
    stub('open', contactsFor(NOTHING), {
      [IDENTITY]: {
        body: {
          ok: true, decision: 'new', confidence: 'unidentified', rule: null,
          rack: null, rackKey: null, candidates: [], proposal: { name: 'RACK 7', where: 'rail chip' },
        },
      },
    });
    mount();
    await screen.findByText('SW-16');
    expect(screen.getByText('Not identified yet')).toBeTruthy();
    expect(screen.getByText('This rack is not in the record yet. Everything here reads as new.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add RACK 7 to the record' })).toBeTruthy();
    // Not an error, and nothing on it decides or writes to the record.
    expect(screen.queryByRole('alert')).toBeNull();
    // And nothing is called a mismatch: nothing was compared. The owner read
    // "9 things do not match" on a rack this screen had just said the record
    // has never heard of.
    expect(document.body.textContent).not.toMatch(/do(es)? not match/i);
    expect(screen.getByText(/would be added/)).toBeTruthy();
    expect(document.body.textContent).toMatch(/Your records do not have this rack yet/);
  });

  test('with no answer from the identity route the line is what the comparison used', async () => {
    stub('open', contactsFor(KNOWN));   // no identity stub: the route answers 404
    mount();
    await screen.findByText('SW-16');
    expect(screen.getByText('RK-07')).toBeTruthy();
    // The sentence about how the rack was found is off this screen (22 Sep):
    // the name is the heading, and the reasoning is in the drift report.
    expect(screen.queryByText(KNOWN.why)).toBeNull();
    expect(screen.queryByText('Which rack is this?')).toBeNull();
  });
});
