/**
 * The report, driven headless against a stubbed server.
 *
 * One promise under test: the report never states a proposal as a fact. Where a
 * device's make, model or serial comes from a switch that was matched to it by
 * the machine and by nobody else, the row says so.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
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
// The report is read inside the app now, and the viewer that shows it reaches
// ExternalLink for its one way out - which registers the app's own web view.
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
  registerPlugin: () => ({ open: async () => {} }),
}));
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
      {/* Where the report's closing step goes. Named here so a test can follow
          the button rather than assert on its handler. */}
      <Route path="/results/:rackId/drift" element={<p>the drift check</p>} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => { reply.doc = doc(); reply.view = view(); });
afterEach(cleanup);

describe('ReportPage', () => {
  /* The report is read and then the rack has to be checked against the record.
     The people testing it did not find the way on, because it was an item
     inside a menu called Check, so the step is now a control of its own, said
     in words, and it is the only filled one on the page. */
  /* Looking a port up never offers the rack-wide check: that belongs to
     analysing the rack. */
  test('the port workflow gets no drift check on the report', async () => {
    const { setRackFlow, PORT } = await import('../utils/rackFlow.js');
    setRackFlow('r1', PORT);
    draw();
    await screen.findByRole('heading', { name: /Rack not identified yet|SP-/ });
    expect(screen.queryByRole('button', { name: 'Drift check' })).toBeNull();
    setRackFlow('r1', null);
  });

  test('the step after the report is a named control, and it gets there', async () => {
    draw();
    const go = await screen.findByRole('button', { name: 'Drift check' });
    fireEvent.click(go);
    expect(await screen.findByText('the drift check')).toBeTruthy();
  });

  /* The site, the rack and the time are the header's, and are not said twice. */
  test('the header carries the rack, its site and when it was read', async () => {
    reply.doc = { ...doc(), rackName: 'SP-HYB-RM01-R01-R1', siteName: 'Office-Sprintpark' };
    draw();
    expect(await screen.findByRole('heading', { name: 'SP-HYB-RM01-R01-R1' })).toBeTruthy();
    expect(screen.getAllByText(/Office-Sprintpark/)).toHaveLength(1);
  });

  test('a match nobody confirmed is named as a proposal', async () => {
    draw();
    // One phrase for every matched device; the colour - carried as data-match -
    // says nobody has confirmed this one, and no sentence says it again.
    const tag = await screen.findByText('from the switch');
    expect(tag.getAttribute('data-match')).toBe('proposal');
    expect(screen.queryByText(/is a proposal/)).toBe(null);
  });

  test('a confirmed match reads as the switch speaking for itself', async () => {
    reply.view = view({ confirmed: true, confirmedAt: '2026-09-18T09:30:00Z', confirmedBy: 'Jane Patel' });
    draw();
    const tag = await screen.findByText('from the switch');
    expect(tag.getAttribute('data-match')).toBe('confirmed');
  });

  test('a match carried over from an earlier check needs no note', async () => {
    const v = view();
    v.reasons[1].fromBinding = true;
    reply.view = v;
    draw();
    const tag = await screen.findByText('from the switch');
    expect(tag.getAttribute('data-match')).toBe('confirmed');
  });

  test('a server that cannot report confirmations says so, rather than claiming one', async () => {
    reply.view = { ...view(), reasons: { 1: { deviceUid: 'd1', confidence: 'high', why: 'same port count' } } };
    draw();
    const tag = await screen.findByText('from the switch');
    expect(tag.getAttribute('data-match')).toBe('unsure');
    expect(screen.getByText('Nobody is recorded as confirming these matches.')).toBeTruthy();
  });

  test('a matching nobody saved is named, not silently left out', async () => {
    reply.view = { ...view(), suggested: true };
    draw();
    await screen.findByText(/Nothing the switches said is in this report yet/);
    expect(screen.getByRole('link', { name: 'Open Review' })).toBeTruthy();
  });

  test('the page says everything the report holds, not a chosen five facts of it', async () => {
    reply.doc = {
      rackName: 'SP-HYB-RM01-R01-R1',
      siteName: 'Office-Sprintpark',
      summary: { devices: 2, switchesRead: 1, ports: 48, portsInUse: 1, portsUp: 1, addresses: 2 },
      devices: [
        {
          name: 'Switch', u: 12, role: 'Access switch', source: 'switch + camera',
          vendor: 'Cisco', model: 'C2960X', serial: 'FOC1', mgmtIp: '10.0.0.1',
          hardware: 'V03', firmware: '15.2(7)', location: 'Room 3, rack 26',
          portCount: 24, portsUp: 1, seen: 2,
          ports: [{
            name: 'Gi1/0/1', inUse: true, state: 'up', speedMbps: 1000, duplex: 'Full', vlan: 10,
            hosts: [{ mac: 'aa:bb:cc:dd:ee:01', ip: '10.0.0.5' }, { mac: 'aa:bb:cc:dd:ee:02', ip: '10.0.0.9' }],
          }],
        },
        { name: 'PP-01', u: 5, role: 'Patch panel', source: 'camera', portCount: 24, ports: [] },
      ],
      cables: [], vlans: [],
      addresses: [
        { ip: '10.0.0.1', on: 'Core A', kind: 'switch' },
        { ip: '10.0.0.5', mac: 'aa:bb:cc:dd:ee:01', on: 'Core A', kind: 'host' },
      ],
    };
    reply.view = view({ sysName: 'core-a.dc007' });
    draw();

    // the rack is named, and what is in it is counted by kind - the patch panel
    // is not swallowed by "2 devices"
    await screen.findByText('SP-HYB-RM01-R01-R1');
    expect(screen.getByText('1 access switch · 1 patch panel')).toBeTruthy();
    // the links the switches say are up: a number the summary held and never said
    expect(screen.getByText('links up')).toBeTruthy();
    // a box with no make or model of its own still says what it is
    expect(screen.getByText('Patch panel')).toBeTruthy();

    // open the switch: every named fact the report carries about it
    fireEvent.click(screen.getByText('Cisco C2960X'));
    expect(screen.getByText('Access switch')).toBeTruthy();
    expect(screen.getByText('core-a.dc007')).toBeTruthy();
    expect(screen.getByText('Room 3, rack 26')).toBeTruthy();
    expect(screen.getByText('15.2(7)')).toBeTruthy();
    expect(screen.getByText('the switch and the photograph')).toBeTruthy();
    // the port line carries the duplex and every address heard on it
    expect(screen.getByText('full duplex')).toBeTruthy();
    expect(screen.getByText('2 hosts · 10.0.0.5, 10.0.0.9')).toBeTruthy();

    // the addresses themselves, not two counts of them
    expect(screen.getByText('the switch itself')).toBeTruthy();
    expect(screen.getByText('heard on it')).toBeTruthy();
    expect(screen.getByText('Core A')).toBeTruthy();
    expect(screen.getByText('Core A · aa:bb:cc:dd:ee:01')).toBeTruthy();
  });

  test('a rack nothing has identified is said in words, never as the hash of its photograph', async () => {
    reply.doc = { ...doc(), rackName: 'RK-5B81BE87' };
    draw();
    await screen.findByText('Rack not identified yet');
    expect(document.body.textContent).not.toMatch(/RK-5B81BE87/);
  });

  test('a report with no matching at all cannot show a match as confirmed', async () => {
    reply.view = null;   // the reconcile call came back empty
    draw();
    const tag = await screen.findByText('from the switch');
    expect(tag.getAttribute('data-match')).toBe('unsure');
    expect(screen.getByText(/The matching could not be loaded/)).toBeTruthy();
  });
});
