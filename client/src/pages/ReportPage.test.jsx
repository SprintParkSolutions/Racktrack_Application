/**
 * The report, driven headless against a stubbed server.
 *
 * One promise under test: the report never states a proposal as a fact. Where a
 * device's make, model or serial comes from a switch that was matched to it by
 * the machine and by nobody else, the row says so.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { reply } = vi.hoisted(() => ({ reply: { view: null, doc: null } }));

vi.mock('../utils/api', () => ({
  apiUrl: (p) => p,
  publicOrigin: () => 'https://example.test',
  authFetch: async (url) => {
    const json = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
    if (/\/adopt\//.test(url)) return json({ id: 5 });
    if (/\/reconcile$/.test(url)) return json(reply.view);
    if (/\/report$/.test(url)) return json(reply.doc);
    return json({ ok: true });
  },
}));
vi.mock('../AuthContext.jsx', () => ({ useAuth: () => ({ user: { role: 'owner' } }) }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('@capacitor/browser', () => ({ Browser: { open: async () => {} } }));
vi.mock('../utils/exportApi', () => ({
  downloadExport: async () => ({ tone: 'ok', text: 'done' }),
  nb: async () => ({ ok: true, body: {} }),
  explain: () => '',
  errText: () => '',
  healthView: () => ({}),
}));

import ReportPage from './ReportPage.jsx';

const doc = () => ({
  summary: { switchesRead: 1, portsInUse: 2 },
  devices: [{
    name: 'Switch', u: 12, source: 'switch', vendor: 'Cisco', model: 'C2960X',
    serial: 'FOC1', portCount: 24, portsUp: 2, seen: 0, ports: [],
  }],
  cables: [], vlans: [], addresses: [],
});

const view = (extra) => ({
  image: null,
  devices: [{ uid: 'd1', name: 'Switch', position: 12, portCount: 24, cvClass: 'Switch', model: '', make: '' }],
  switches: [{
    id: 1, label: 'Core A', host: '10.0.0.1', read: true, model: 'C2960X', serial: 'FOC1',
    vendor: 'Cisco', ports: 24, matchedTo: 'd1', ...extra,
  }],
  reasons: { 1: { deviceUid: 'd1', confidence: 'probable', evidence: [{ kind: 'ports', rank: 5 }], candidateCount: 2, margin: 5 } },
  matches: { 1: 'd1' },
  summary: { matched: 1, switchesTotal: 1, unmatched: 0, cables: 0, changes: [] },
  suggested: false,
});

const draw = () => render(
  <MemoryRouter initialEntries={['/results/r1/report']}>
    <Routes>
      <Route path="/results/:rackId/report" element={<ReportPage />} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => { reply.doc = doc(); reply.view = view(); });
afterEach(cleanup);

describe('ReportPage', () => {
  test('a match nobody confirmed is named as a proposal', async () => {
    draw();
    await screen.findByText('proposal, not confirmed');
    expect(screen.getByText('A proposal, waiting for someone to confirm that this switch is this box.')).toBeTruthy();
    expect(screen.getByText(/One device below takes its make, model or serial/)).toBeTruthy();
  });

  test('a confirmed match reads as the switch speaking for itself', async () => {
    reply.view = view({ confirmed: true, confirmedAt: '2026-09-18T09:30:00Z', confirmedBy: 'Jane Patel' });
    draw();
    await screen.findByText('from the switch');
    expect(screen.queryByText('proposal, not confirmed')).toBe(null);
  });

  test('a match carried over from an earlier check needs no note', async () => {
    const v = view();
    v.reasons[1].fromBinding = true;
    reply.view = v;
    draw();
    await screen.findByText('from the switch');
    expect(screen.queryByText('proposal, not confirmed')).toBe(null);
  });

  test('an older server that cannot report confirmations reads as it always did', async () => {
    reply.view = { ...view(), reasons: { 1: { deviceUid: 'd1', confidence: 'high', why: 'same port count' } } };
    draw();
    await screen.findByText('from the switch');
    expect(screen.queryByText('proposal, not confirmed')).toBe(null);
  });
});
