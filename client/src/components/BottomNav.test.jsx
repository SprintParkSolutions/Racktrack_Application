import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

/* On a rack's own pages the bottom bar is the rack's four tabs. Anywhere else
   it is the app's navigation. */

vi.mock('../ShutterContext.jsx', () => ({ useShutter: () => ({ fn: null, canShoot: false }) }));
vi.mock('../AuthContext.jsx', () => ({ useAuth: () => ({ isAuthed: true }) }));
vi.mock('../nav/navLinks.jsx', () => ({
  usePrimaryNav: () => [{ to: '/', label: 'Home', icon: null, inBar: true, end: true }, { to: '/scan', label: 'Scan', icon: null, inBar: true }],
  MoreIcon: () => null,
}));

import BottomNav from './BottomNav.jsx';

function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname + l.hash}</p>; }
const mountAt = (path) => render(<MemoryRouter initialEntries={[path]}><BottomNav /><Where /></MemoryRouter>);
const labels = () => screen.getAllByRole('tab').map((t) => t.textContent);
const selected = () => screen.getAllByRole('tab').filter((t) => t.getAttribute('aria-selected') === 'true').map((t) => t.textContent);
const tap = (name) => { fireEvent.click(screen.getByRole('tab', { name })); return screen.getByTestId('where').textContent; };

afterEach(cleanup);

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
});
