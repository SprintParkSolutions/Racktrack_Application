import { describe, test, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

/* On a rack's own pages the bottom bar is the rack's tabs, in the flow the
   person chose on the review page. Anywhere else it is the app's navigation,
   and the flow is forgotten. */

vi.mock('../ShutterContext.jsx', () => ({ useShutter: () => ({ fn: null, canShoot: false }) }));
vi.mock('../AuthContext.jsx', () => ({ useAuth: () => ({ isAuthed: true }) }));
vi.mock('../nav/navLinks.jsx', () => ({
  usePrimaryNav: () => [{ to: '/', label: 'Home', icon: null, inBar: true, end: true }, { to: '/scan', label: 'Scan', icon: null, inBar: true }],
  MoreIcon: () => null,
  ScanIcon: () => null,
}));

import BottomNav from './BottomNav.jsx';
import { getRackFlow, setRackFlow } from '../utils/rackFlow';

function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname + l.hash}</p>; }
const mountAt = (path) => render(<MemoryRouter initialEntries={[path]}><BottomNav /><Where /></MemoryRouter>);
const labels = () => screen.getAllByRole('tab').map((t) => t.textContent);
const selected = () => screen.getAllByRole('tab').filter((t) => t.getAttribute('aria-selected') === 'true').map((t) => t.textContent);
const tap = (name) => { fireEvent.click(screen.getByRole('tab', { name })); return screen.getByTestId('where').textContent; };

beforeEach(() => window.sessionStorage.clear());
afterEach(cleanup);

describe('<BottomNav> on a rack', () => {
  test('Analyse the network: five tabs, each opening the page it always opened', () => {
    mountAt('/results/RK-1/network');
    expect(labels()).toEqual(['Overview', 'Network', 'Drift', 'Report', 'Timeline']);
    expect(selected()).toEqual(['Network']);
    expect(tap('Drift')).toBe('/results/RK-1/drift');
    expect(selected()).toEqual(['Drift']);
    expect(tap('Report')).toBe('/results/RK-1/report');
    expect(tap('Timeline')).toBe('/results/RK-1#drift');
    expect(tap('Overview')).toBe('/results/RK-1');
  });

  test('Look up a port: the pages More used to hold are tabs, and the flow stays while the rack does', () => {
    setRackFlow('RK-1', 'port');
    mountAt('/results/RK-1/network');
    expect(labels()).toEqual(['Result', 'Switches', 'Network', 'Topology', 'Timeline']);
    expect(selected()).toEqual(['Network']);
    expect(tap('Switches')).toBe('/switch-info/RK-1');
    expect(selected()).toEqual(['Switches']);
    expect(tap('Topology')).toBe('/results/RK-1/topology');
    expect(selected()).toEqual(['Topology']);
    expect(labels()).toEqual(['Result', 'Switches', 'Network', 'Topology', 'Timeline']);
    expect(tap('Timeline')).toBe('/results/RK-1#drift');
    expect(tap('Result')).toBe('/results/RK-1');
    expect(getRackFlow('RK-1')).toBe('port');
    expect(screen.queryByText('More')).toBeNull();
  });

  test('off the rack the bar is the app again and the flow is forgotten', () => {
    setRackFlow('RK-1', 'port');
    mountAt('/scan');
    expect(screen.queryAllByRole('tab')).toEqual([]);
    expect(screen.getByText('SCAN')).toBeTruthy();
    expect(getRackFlow('RK-1')).toBe('analyse');
  });

  test('the centre action takes a scan, and is not one of the items', () => {
    mountAt('/');
    // It carries no label, so it is found by what it says it does.
    const centre = screen.getByRole('button', { name: 'Scan a rack' });
    expect(centre).toBeTruthy();
    // Off the Scan page it goes there; on it, ScanPage's shutter handler takes
    // over (mocked to none here, so this is the navigating case).
    fireEvent.click(centre);
    expect(screen.getByTestId('where').textContent).toBe('/scan');
  });

  test("the rack bar's centre action puts the rack in the port flow and opens the picker", () => {
    mountAt('/results/RK-1/network');
    fireEvent.click(screen.getByRole('button', { name: 'Look up a port' }));
    expect(getRackFlow('RK-1')).toBe('port');
    expect(screen.getByTestId('where').textContent).toBe('/results/RK-1');
  });
});
