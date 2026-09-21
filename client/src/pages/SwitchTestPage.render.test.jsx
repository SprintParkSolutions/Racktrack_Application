import { describe, test, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/* The Network page, as a person meets it: this rack first, then the switches,
   then the one they chose in full, and the Timeline on its own segment. */

const { routes } = vi.hoisted(() => ({ routes: { current: {} } }));
vi.mock('../utils/api', () => ({
  apiUrl: (p) => p,
  authFetch: vi.fn(async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    const h = routes.current[`${method} ${url}`];
    if (!h) return { ok: false, status: 404, json: async () => ({ error: `no stub for ${method} ${url}` }) };
    return { ok: true, status: 200, json: async () => h };
  }),
}));
vi.mock('../utils/snmpClient', () => ({
  canReadSwitches: () => true,
  readSwitch: vi.fn(),
  testLogin: vi.fn(),
  toServerReading: (r) => r,
}));
vi.mock('../components/PlacePicker.jsx', () => ({ default: () => <p>where it sits</p> }));
vi.mock('./PortHistoryPage.jsx', () => ({ PortHistoryContent: () => <p>the change log</p> }));

import SwitchTestPage from './SwitchTestPage.jsx';

const READ_AT = new Date(Date.now() - 12 * 60_000).toISOString();
const iface = (n, up, speed = 1000) => ({
  index: n, name: `Gi1/0/${n}`, descr: null, up, enabled: true, speedMbps: speed, type: 6, attached: 0,
});
const READING = {
  kind: 'full', vendor: 'TP-Link', model: 'T2600G-28TS', serial: 'ABC123',
  sysName: 'core-sw', uptime: 8_640_000, readAt: READ_AT, filed: true,
  interfaces: [iface(1, true), iface(2, false), iface(3, false), iface(4, true)],
  neighbours: [], attached: [], gaps: [],
  counts: { ports: 4, up: 2, neighbours: 0, attached: 0 },
};
// The photograph: a cable in sockets 1, 2 and 4, socket 3 empty, socket 4 an SFP
// cage. So socket 2 disagrees (cable, port down) and the rest agree.
const DEVICE = {
  uid: 'dev:1', name: 'Switch U15', position: 15, cvClass: 'Switch', passive: false,
  box: [0, 0, 1, 1], portCount: 4, model: '', make: '',
  sockets: [
    { n: 1, status: 'connected', uplink: false, type: 'rj45' },
    { n: 2, status: 'connected', uplink: false, type: 'rj45' },
    { n: 3, status: 'empty', uplink: false, type: 'rj45' },
    { n: 4, status: 'connected', uplink: true, type: 'sfp' },
  ],
};

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('rt_snmp_test_switches', JSON.stringify([
    { id: 'sw_1', label: 'Core switch', host: '10.10.1.11', port: 161, version: 'v2c', serverIds: { 'RK-1': 5 } },
    { id: 'sw_2', label: 'Edge switch', host: '10.10.1.12', port: 161, version: 'v3', username: 'racktrack' },
  ]));
  window.localStorage.setItem('rt_snmp_results', JSON.stringify({ sw_1: READING }));
  routes.current = {
    'GET /api/nb/switches?rackId=RK-1': [{ id: 5, host: '10.10.1.11', port: 161, collected: { at: READ_AT } }],
    'POST /api/nb/scans/adopt/RK-1': { id: 3 },
    'GET /api/nb/scans/3/reconcile': {
      image: null, devices: [DEVICE], matches: { 5: 'dev:1' }, reasons: {}, levels: {}, summary: {},
      suggested: false,
      switches: [{ id: 5, label: 'Core switch', host: '10.10.1.11', read: true, ports: 4, matchedTo: 'dev:1', autoMatch: null, written: false }],
    },
  };
});
afterEach(cleanup);

const mount = () => render(
  <MemoryRouter initialEntries={['/results/RK-1/network']}>
    <Routes><Route path="/results/:rackId/network" element={<SwitchTestPage />} /></Routes>
  </MemoryRouter>,
);

/** The value shown under a label, on either the rack band or a switch's facts. */
const factValue = (label) => {
  const all = screen.getAllByText(label);
  return all.map((el) => el.parentElement.textContent.replace(label, '').trim());
};

describe('the Network page', () => {
  test('the screen opens on the choice, and says nothing the ports already say', async () => {
    mount();
    await waitFor(() => expect(screen.getByText('Choose a switch')).toBeTruthy());
    // The band of totals across the whole rack is gone: the cards say it.
    expect(screen.queryByText('This rack')).toBeNull();
    expect(screen.queryByText('Ports reported')).toBeNull();
    expect(screen.queryByText('Ports up')).toBeNull();
    expect(screen.queryByText('Cabled in the photo')).toBeNull();
    expect(screen.getByText('1 has not been read yet')).toBeTruthy();
  });

  test('a switch is a card to choose, and the chosen one is what is shown below', async () => {
    mount();
    await waitFor(() => expect(screen.getByText('Choose a switch')).toBeTruthy());
    const cards = within(screen.getByRole('tablist', { name: 'Switches on this rack' })).getAllByRole('tab');
    expect(cards.map((c) => c.getAttribute('aria-selected'))).toEqual(['true', 'false']);
    expect(cards[0].textContent).toContain('TP-Link T2600G-28TS');
    expect(cards[0].textContent).toContain('2 of 4 ports up');
    expect(cards[1].textContent).toContain('Not read yet');
    // The chosen switch says what it is on one line, then only what its ports cannot.
    expect(screen.getByText(/TP-Link T2600G-28TS · 10.10.1.11 · SNMP v2c · read 12 min ago/)).toBeTruthy();
    expect(factValue('Where it sits')).toContain('Shelf U15');
    expect(screen.queryByText('Ports free')).toBeNull();
    expect(screen.queryByText('Make')).toBeNull();
  });

  test('the ports the photograph and the switch disagree about are named', async () => {
    mount();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Ports that disagree' })).toBeTruthy());
    expect(screen.getByText('The photo shows a cable. The switch says the port is down.')).toBeTruthy();
    expect(screen.getByText('Port 2')).toBeTruthy();
    expect(screen.getByText('SFP')).toBeTruthy();
    expect(screen.getByText('disagrees')).toBeTruthy();
  });

  test('choosing the other switch shows that one instead, and offers to read it', async () => {
    mount();
    await waitFor(() => expect(screen.getByText('Choose a switch')).toBeTruthy());
    fireEvent.click(screen.getByText('Edge switch'));
    expect(within(screen.getByRole('tablist', { name: 'Switches on this rack' })).getAllByRole('tab')
      .map((c) => c.getAttribute('aria-selected'))).toEqual(['false', 'true']);
    expect(screen.getByRole('button', { name: 'Read this switch' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Ports that disagree' })).toBeNull();
    expect(screen.getByText(/SNMP v3/)).toBeTruthy();
  });

  test('the Timeline is the page\'s other half, and adding a switch has no plus on it', async () => {
    mount();
    await waitFor(() => expect(screen.getByText('Choose a switch')).toBeTruthy());
    const add = screen.getByRole('button', { name: 'Add another switch' });
    expect(add.textContent).toBe('Add another switch');
    fireEvent.click(screen.getByRole('tab', { name: 'Timeline' }));
    expect(screen.getByText('What changed on these ports')).toBeTruthy();
    expect(screen.getByText('the change log')).toBeTruthy();
    expect(screen.queryByText('Choose a switch')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Switches' }));
    expect(screen.getByText('Choose a switch')).toBeTruthy();
  });

  test('an older link to the port history opens the Timeline', async () => {
    render(
      <MemoryRouter initialEntries={['/results/RK-1/network#timeline']}>
        <Routes><Route path="/results/:rackId/network" element={<SwitchTestPage />} /></Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('What changed on these ports')).toBeTruthy());
  });
});
