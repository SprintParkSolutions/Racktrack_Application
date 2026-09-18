/**
 * The Review screen, driven headless against a stubbed server.
 *
 * What is being guarded here is not the layout, it is the promise: a proposal
 * is never stored behind somebody's back, confirming is one deliberate act per
 * switch, and a match the evidence cannot settle is left empty with the reason
 * written out.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { calls, reply } = vi.hoisted(() => ({ calls: [], reply: { view: null, scan: null, after: null } }));

// An em dash, built from its code: an older server's wording can carry one, and
// this file must not.
const EM = String.fromCharCode(8212);

vi.mock('../utils/api', () => ({
  apiUrl: (p) => p,
  authFetch: async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    const json = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
    if (/\/adopt\//.test(url)) return json({ id: 5 });
    if (/\/reconcile$/.test(url) && opts.method === 'POST') return json({ ok: true, summary: reply.view.summary });
    if (/\/reconcile$/.test(url)) {
      const posted = calls.some((c) => c.method === 'POST' && /\/reconcile$/.test(c.url));
      return json(posted && reply.after ? reply.after : reply.view);
    }
    return json(reply.scan);
  },
}));

import ReviewPage from './ReviewPage.jsx';

const device = (uid, position) => ({
  uid, position, name: 'Switch', portCount: 24, cvClass: 'Switch', model: '', make: '', serial: null, box: null,
});

const baseView = () => ({
  image: '/outputs/r1/rack.jpg',
  devices: [device('d1', 12), device('d2', 11)],
  switches: [
    { id: 1, label: 'Core A', host: '10.0.0.1', read: true, model: 'C2960X', serial: 'FOC1', vendor: 'Cisco', ports: 24, matchedTo: 'd1' },
    { id: 2, label: 'Core B', host: '10.0.0.2', read: true, model: 'C2960X', serial: null, vendor: 'Cisco', ports: 24, matchedTo: null },
  ],
  reasons: {
    1: {
      deviceUid: 'd1', confidence: 'confirmed', candidateCount: 1, margin: 80, fromBinding: false,
      evidence: [{ kind: 'serial', rank: 1, detail: 'FOC1' }, { kind: 'ports', rank: 5, detail: '24' }],
      why: 'serial matches',
    },
    2: {
      deviceUid: null, confidence: 'unidentified', candidateCount: 2, margin: 0, fromBinding: false,
      evidence: [{ kind: 'ports', rank: 5, detail: '24' }],
      why: 'two boxes look the same',
    },
  },
  matches: { 1: 'd1', 2: null },
  summary: { matched: 1, switchesTotal: 2, unmatched: 1, cables: 0, cablesProven: 0, changes: [] },
  suggested: true,
});

const draw = () => render(
  <MemoryRouter initialEntries={['/results/r1/review']}>
    <Routes>
      <Route path="/results/:rackId/review" element={<ReviewPage />} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  calls.length = 0;
  reply.view = baseView();
  reply.after = null;
  reply.scan = { id: 5, uHeight: 12, conflicts: [], detections: null, hasImage: false };
});
afterEach(cleanup);

const posts = () => calls.filter((c) => c.method === 'POST' && /\/reconcile$/.test(c.url));

describe('ReviewPage', () => {
  test('opening the screen stores nothing', async () => {
    draw();
    await screen.findByText('Core A');
    expect(posts()).toEqual([]);
  });

  test('says why each box was proposed, in words, with no field names', async () => {
    draw();
    await screen.findByText('Core A');
    const why = screen.getByText('The serial number and the number of ports match.');
    expect(why).toBeTruthy();
    // How sure the engine is, in the engine's own right. "Confirmed" is the
    // word for a person's act and never appears beside a Confirm button.
    expect(screen.getByText('Almost certain')).toBeTruthy();
    expect(screen.getByText('The serial number: FOC1')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/serial number matches.*rank/i);
    expect(screen.queryByText('Confirmed')).toBe(null);
  });

  test('the evidence stops speaking for a box the operator moved away from', async () => {
    draw();
    await screen.findByText('Core A');
    fireEvent.click(screen.getByRole('button', { name: 'U11, Switch, 24 ports' }));
    expect(screen.getByText('You chose this box yourself. The photo had proposed U12.')).toBeTruthy();
    expect(screen.queryByText('The serial number and the number of ports match.')).toBe(null);
    expect(screen.queryByText('Almost certain')).toBe(null);
  });

  test('two boxes that look the same are left empty, with what would settle it', async () => {
    draw();
    await screen.findByText('Core B');
    expect(screen.getByText('Not identified')).toBeTruthy();
    expect(screen.getByText(
      'Two boxes here look the same. Read the serial number off the label on one of them to tell them apart.',
    )).toBeTruthy();
    // Nothing preselected for that switch.
    const select = screen.getByLabelText('Is this box in the rack', { selector: '#rt-review-match-2' });
    expect(select.value).toBe('');
  });

  test('saving the list stores the matches and confirms nothing', async () => {
    draw();
    await screen.findByText('Core A');
    fireEvent.click(screen.getByRole('button', { name: 'Save the list' }));
    await waitFor(() => expect(posts().length).toBe(1));
    expect(posts()[0].body).toEqual({ matches: { 1: 'd1', 2: null } });
    expect(posts()[0].body.confirm).toBeUndefined();
  });

  test('Confirm confirms one switch, and the row then says who did it', async () => {
    reply.after = {
      ...baseView(),
      suggested: false,
      switches: [
        { ...baseView().switches[0], confirmed: true, confirmedAt: '2026-09-18T09:30:00Z', confirmedBy: 'Jane Patel' },
        baseView().switches[1],
      ],
    };
    draw();
    await screen.findByText('Core A');
    fireEvent.click(screen.getAllByRole('button', { name: 'Confirm' })[0]);
    await waitFor(() => expect(posts().length).toBe(1));
    expect(posts()[0].body).toEqual({ matches: { 1: 'd1', 2: null }, confirm: true, switchId: 1 });

    await screen.findByText(/Jane Patel confirmed this on /);
    expect(screen.getByRole('button', { name: 'Change' })).toBeTruthy();
  });

  test('confirming one switch does not store another switch it never looked at', async () => {
    const v = baseView();
    // Core B now has a clear proposal of its own, and nobody has touched it.
    v.reasons[2] = {
      deviceUid: 'd2', confidence: 'probable', candidateCount: 2, margin: 20, fromBinding: false,
      evidence: [{ kind: 'ports', rank: 5, detail: '24' }], why: 'the port count matches',
    };
    v.matches = { 1: 'd1', 2: 'd2' };
    v.switches[1].matchedTo = 'd2';
    reply.view = v;
    draw();
    await screen.findByText('Core B');
    fireEvent.click(screen.getAllByRole('button', { name: 'Confirm' })[0]);
    await waitFor(() => expect(posts().length).toBe(1));
    expect(posts()[0].body).toEqual({ matches: { 1: 'd1', 2: null }, confirm: true, switchId: 1 });
  });

  test('a server that acknowledges nothing does not get to look confirmed', async () => {
    draw();
    await screen.findByText('Core A');
    fireEvent.click(screen.getAllByRole('button', { name: 'Confirm' })[0]);
    await waitFor(() => expect(posts().length).toBe(1));
    await screen.findByText(/The server did not record a confirmation for Core A/);
    expect(screen.queryByText(/confirmed this on /)).toBe(null);
    expect(screen.getByText('0 of 1 confirmed')).toBeTruthy();
  });

  test('moving a confirmed switch spends the confirmation', async () => {
    reply.after = {
      ...baseView(),
      suggested: false,
      switches: [
        { ...baseView().switches[0], confirmed: true, confirmedAt: '2026-09-18T09:30:00Z', confirmedBy: 'Jane Patel' },
        baseView().switches[1],
      ],
    };
    draw();
    await screen.findByText('Core A');
    fireEvent.click(screen.getAllByRole('button', { name: 'Confirm' })[0]);
    await screen.findByText(/Jane Patel confirmed this on /);

    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    fireEvent.click(screen.getByRole('button', { name: 'U11, Switch, 24 ports' }));
    expect(screen.getByText('The box has changed. Confirm it again.')).toBeTruthy();
    expect(screen.queryByText(/Jane Patel confirmed this on /)).toBe(null);
    expect(screen.getByText('0 of 1 confirmed')).toBeTruthy();
  });

  test('a confirmed switch cannot be moved by tapping the rack picture', async () => {
    reply.after = {
      ...baseView(),
      suggested: false,
      switches: [
        { ...baseView().switches[0], confirmed: true, confirmedAt: '2026-09-18T09:30:00Z', confirmedBy: 'Jane Patel' },
        baseView().switches[1],
      ],
    };
    draw();
    await screen.findByText('Core A');
    fireEvent.click(screen.getAllByRole('button', { name: 'Confirm' })[0]);
    await screen.findByText(/Jane Patel confirmed this on /);

    fireEvent.click(screen.getByRole('button', { name: 'U11, Switch, 24 ports' }));
    expect(screen.getByText('Core A is confirmed. Press Change on it first.')).toBeTruthy();
    const select = screen.getByLabelText('Is this box in the rack', { selector: '#rt-review-match-1' });
    expect(select.value).toBe('d1');
  });

  test('a match from a previous check needs no confirming', async () => {
    const view = baseView();
    view.reasons[1].fromBinding = true;
    reply.view = view;
    draw();
    await screen.findByText('Core A');
    expect(screen.getByText('Matched from an earlier check.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Change' })).toBeTruthy();
  });

  test('an older server that sends no evidence still works', async () => {
    reply.view = {
      ...baseView(),
      reasons: { 1: { deviceUid: 'd1', confidence: 'high', why: `same port count ${EM} the only box it could be` }, 2: null },
    };
    draw();
    await screen.findByText('Core A');
    expect(screen.getByText('Same port count - the only box it could be.')).toBeTruthy();
    expect(screen.getByText('Probably')).toBeTruthy();
    expect(posts()).toEqual([]);
  });

  test('the rack picture is drawn beside the switches', async () => {
    draw();
    await screen.findByText('Core A');
    expect(screen.getByText('12U rack')).toBeTruthy();
    // The first read switch is the one the picture is showing, so its proposed
    // shelf is the one lifted out.
    expect(screen.getByRole('button', { name: 'U12, Switch, 24 ports' }).getAttribute('aria-pressed')).toBe('true');
  });

  test('tapping a shelf moves the chosen switch to it', async () => {
    draw();
    await screen.findByText('Core A');
    fireEvent.click(screen.getByRole('button', { name: 'U11, Switch, 24 ports' }));
    const select = screen.getByLabelText('Is this box in the rack', { selector: '#rt-review-match-1' });
    expect(select.value).toBe('d2');
    expect(posts()).toEqual([]);
  });
});
