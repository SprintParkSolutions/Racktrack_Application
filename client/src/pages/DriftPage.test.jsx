import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/* The technician's screen: it compares and sends, and that is all. Nothing on
   it approves, assigns or writes, whatever the caller's role. */

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
const mount = () => render(
  <MemoryRouter initialEntries={['/results/RK-1/drift']}>
    <Routes><Route path="/results/:rackId/drift" element={<DriftPage />} /></Routes>
  </MemoryRouter>,
);
const buttonNames = () => screen.queryAllByRole('button').map((b) => b.textContent.trim().toLowerCase());
const FORBIDDEN = /approve|reject|assign|write|export/;

afterEach(cleanup);

describe('<DriftPage>', () => {
  test('before sending: one button, Send to the admin, and nothing that decides or writes', async () => {
    stub('open');
    mount();
    await screen.findByText('SW-16');
    expect(screen.getByRole('button', { name: 'Send to the admin' })).toBeTruthy();
    expect(buttonNames().filter((n) => FORBIDDEN.test(n))).toEqual([]);
    expect(document.body.textContent).not.toMatch(/Write the approved|Assign to|Approve\b/);
    // Nothing to track until it has been sent.
    expect(screen.queryByRole('link', { name: 'Track this check' })).toBeNull();
  });

  test('after sending: watches only, still nothing that decides or writes', async () => {
    stub('submitted');
    mount();
    await screen.findByText('Sent to the admin');
    expect(screen.queryByRole('button', { name: 'Send to the admin' })).toBeNull();
    expect(buttonNames().filter((n) => FORBIDDEN.test(n))).toEqual([]);
    expect(screen.getByText('Waiting on the admin')).toBeTruthy();
    // One link out: this check, in RackTrack Approvals.
    const track = screen.getAllByRole('link', { name: 'Track this check' });
    expect(track).toHaveLength(1);
    expect(track[0].getAttribute('href')).toBe('/approvals/drifts/7');
    expect(track[0].getAttribute('target')).toBe('_blank');
  });

  test('a member whom the contacts route turns away still gets the page', async () => {
    stub('open', { status: 403, body: { error: 'admins only' } });
    mount();
    await screen.findByText('SW-16');
    expect(screen.getByRole('button', { name: 'Send to the admin' })).toBeTruthy();
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
    await screen.findByText('Everything matches your records');
    expect(screen.queryByText(/does not match/)).toBeNull();
    expect(screen.queryByText(/racktrack_uid|recordId|rack:t32:16/)).toBeNull();
    expect(screen.queryByText(/related record/)).toBeNull();
    expect(screen.queryByRole('button', { name: /send to the admin/i })).toBeNull();
    expect(screen.getByText(/will note its own id on the record/)).toBeTruthy();
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
    await screen.findByText(/1 thing is different from your records|1 thing would be added/);
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
    expect(screen.getByText('Compared against')).toBeTruthy();
    expect(screen.getByText('RK-07')).toBeTruthy();
    // What found it, and how sure that leaves it: a reading is never a confirmation.
    expect(screen.getByText('Matched by the label read off the rack. Probable, not confirmed.')).toBeTruthy();
    // It is settled, so nothing is asked of anybody.
    expect(screen.queryByText('Which rack is this?')).toBeNull();
    // Nothing internal reaches the screen.
    expect(document.body.textContent).not.toMatch(/\brung\b|\brackKey\b|\buid\b|\btenant\b/i);
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
    await waitFor(() => expect(screen.getByText('Confirmed: this rack is tied to that record.')).toBeTruthy());
    // The rack that was picked is the one it was confirmed as, by its record.
    const sent = authFetch.mock.calls.find(([url, init]) => url === '/api/scan/RK-1/identity/confirm' && init);
    expect(JSON.parse(sent[1].body)).toEqual({ knownRackId: 6 });
    // And the check ran again, against the rack that was chosen.
    expect(screen.getByText('RK-08')).toBeTruthy();
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
    expect(screen.getByText(KNOWN.why)).toBeTruthy();
    expect(screen.queryByText('Which rack is this?')).toBeNull();
  });
});
