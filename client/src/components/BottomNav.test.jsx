import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

/* On a rack's own pages the bottom bar is the rack's own tabs - which tabs
   depends on the job the rack is in, and that is the whole point of these:
   the bar has to be the SAME bar on every screen of a job. Anywhere else it
   is the app's navigation. */

vi.mock('../ShutterContext.jsx', () => ({ useShutter: () => ({ fn: null, canShoot: false }) }));
vi.mock('../AuthContext.jsx', () => ({ useAuth: () => ({ isAuthed: true }) }));
vi.mock('../nav/navLinks.jsx', () => ({
  usePrimaryNav: () => [{ to: '/', label: 'Home', icon: null, inBar: true, end: true }, { to: '/scan', label: 'Scan', icon: null, inBar: true }],
  MoreIcon: () => null,
  ScanIcon: () => null,
  HomeIcon: () => null,
}));

import BottomNav from './BottomNav.jsx';
import { setRackFlow, getRackFlow, NETWORK, PORT } from '../utils/rackFlow.js';

function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname + l.hash}</p>; }
const mountAt = (path) => render(<MemoryRouter initialEntries={[path]}><BottomNav /><Where /></MemoryRouter>);
const labels = () => screen.getAllByRole('tab').map((t) => t.textContent);
const selected = () => screen.getAllByRole('tab').filter((t) => t.getAttribute('aria-selected') === 'true').map((t) => t.textContent);
const tap = (name) => { fireEvent.click(screen.getByRole('tab', { name })); return screen.getByTestId('where').textContent; };

const more = () => screen.getByRole('button', { name: /More/ });
const inMore = () => { fireEvent.click(more()); return screen.getAllByRole('menuitem').map((i) => i.textContent); };
const tapInMore = (name) => {
  fireEvent.click(more());
  fireEvent.click(screen.getByRole('menuitem', { name }));
  return screen.getByTestId('where').textContent;
};

afterEach(() => { cleanup(); sessionStorage.clear(); });

describe('<BottomNav> on a rack', () => {
  test('four tabs, each opening the page it names', () => {
    mountAt('/results/RK-1/network');
    expect(labels()).toEqual(['Overview', 'Network', 'Report', 'Drift']);
    expect(selected()).toEqual(['Network']);
    expect(tap('Drift')).toBe('/results/RK-1/drift');
    expect(selected()).toEqual(['Drift']);
    expect(tap('Report')).toBe('/results/RK-1/report');
    expect(selected()).toEqual(['Report']);
    expect(tap('Overview')).toBe('/results/RK-1');
    expect(selected()).toEqual(['Overview']);
    expect(screen.queryByText('More')).toBeNull();
  });

  test('Topology and Switches are not tabs, and keep Overview lit', () => {
    mountAt('/results/RK-1/topology');
    expect(labels()).toEqual(['Overview', 'Network', 'Report', 'Drift']);
    expect(selected()).toEqual(['Overview']);
    cleanup();
    mountAt('/switch-info/RK-1');
    expect(labels()).toEqual(['Overview', 'Network', 'Report', 'Drift']);
    expect(selected()).toEqual(['Overview']);
    expect(tap('Overview')).toBe('/results/RK-1');
  });

  test('off the rack the bar is the app again', () => {
    mountAt('/scan');
    expect(screen.queryAllByRole('tab')).toEqual([]);
    expect(screen.getByText('SCAN')).toBeTruthy();
  });

  test('the centre action takes a scan, and is not one of the items', () => {
    mountAt('/');
    // It carries no label, so it is found by what it says it does.
    const centre = screen.getByRole('button', { name: 'Scan a rack' });
    expect(centre).toBeTruthy();
    // Off the Scan page it goes there; on it, ScanPage's shutter takes over.
    fireEvent.click(centre);
    expect(screen.getByTestId('where').textContent).toBe('/scan');
    // and Scan takes no slot in the row beside it
    expect(screen.queryByRole('tab', { name: /^scan$/i })).toBeNull();
  });

  test('the rack bar is four plain tabs, with no raised action of its own', () => {
    mountAt('/results/RK-1/network');
    expect(screen.queryByRole('button', { name: 'Look up a port' })).toBeNull();
    expect(tap('Report')).toBe('/results/RK-1/report');
  });

  test('the port workflow carries its own bar, unchanged, on every screen it leads to', () => {
    setRackFlow('RK-1', PORT);
    // The bar is the same four and the same More on the rack's own page, on
    // Network, and on Switches - it used to become the other workflow's the
    // moment the person left the located port.
    for (const where of ['/results/RK-1', '/results/RK-1/network', '/switch-info/RK-1']) {
      mountAt(where);
      expect(labels()).toEqual(['Rack', 'Port', 'Switches', 'Network']);
      // No Drift: comparing the rack against the record is the other job.
      expect(inMore()).toEqual(['Topology', 'Report']);
      cleanup();
    }
  });

  test('in the port workflow every screen lights its own tab', () => {
    setRackFlow('RK-1', PORT);
    mountAt('/switch-info/RK-1');
    expect(selected()).toEqual(['Switches']);
    cleanup();
    mountAt('/results/RK-1/network');
    expect(selected()).toEqual(['Network']);
    cleanup();
    // The rack's root IS the port lookup while that is the job.
    mountAt('/results/RK-1');
    expect(selected()).toEqual(['Port']);
  });

  test('picking the job is what changes the bar, and it changes everywhere at once', () => {
    mountAt('/results/RK-1/network');
    expect(labels()).toEqual(['Overview', 'Network', 'Report', 'Drift']);
    // Nothing here chooses the port workflow, so the bar cannot offer Port.
    expect(screen.queryByRole('tab', { name: 'Port' })).toBeNull();
    cleanup();

    setRackFlow('RK-1', PORT);
    mountAt('/results/RK-1/network');
    expect(tap('Port')).toBe('/results/RK-1#port');
    expect(getRackFlow('RK-1')).toBe(PORT);
    // Back to the rack itself, which is where the other job starts.
    expect(tap('Rack')).toBe('/results/RK-1');
    expect(getRackFlow('RK-1')).toBe(NETWORK);
    expect(labels()).toEqual(['Overview', 'Network', 'Report', 'Drift']);
  });

  test("the port workflow's More opens the rack-wide screens", () => {
    setRackFlow('RK-1', PORT);
    mountAt('/results/RK-1/network');
    expect(tapInMore('Topology')).toBe('/results/RK-1/topology');
    expect(tapInMore('Report')).toBe('/results/RK-1/report');
  });

  /* Nobody has chosen a job yet: every other screen of the rack still draws a
     bar, and it is the one the Overview offers first. The Overview itself
     draws none, which is the results page's own doing. */
  test('a rack with no job chosen still carries the network bar on its other screens', () => {
    mountAt('/results/RK-9/report');
    expect(labels()).toEqual(['Overview', 'Network', 'Report', 'Drift']);
  });

  /* The rack's own Overview asks one question - analyse the rack, or look a
     port up - and until it is answered there is no bar under it, from this
     component or from the page. */
  test('a rack nobody has chosen a job for draws no bar on its Overview', () => {
    const { container } = mountAt('/results/RK-7');
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
  });

  test('choosing the job brings the bar in', () => {
    setRackFlow('RK-7', PORT);
    mountAt('/results/RK-7');
    expect(labels()).toEqual(['Rack', 'Port', 'Switches', 'Network']);
  });

  test('one rack in the port workflow does not drag another into it', () => {
    setRackFlow('RK-1', PORT);
    mountAt('/results/RK-2/network');
    expect(labels()).toEqual(['Overview', 'Network', 'Report', 'Drift']);
  });
});
