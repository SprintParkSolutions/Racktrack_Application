import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import ScanTabBar from './ScanTabBar.jsx';

/* The rack's tab bar: one row of four, the same four everywhere. There is no
   More tab, no menu behind it and no second row for a different job. */

const labels = () => screen.getAllByRole('tab').map((t) => t.textContent);
const selected = () => screen.getAllByRole('tab').filter((t) => t.getAttribute('aria-selected') === 'true').map((t) => t.textContent);

afterEach(cleanup);

describe('<ScanTabBar>', () => {
  test('four tabs, in order: Overview, Network, Report, Drift', () => {
    render(<ScanTabBar activeTab="overview" onTabChange={() => {}} />);
    expect(labels()).toEqual(['Overview', 'Network', 'Report', 'Drift']);
    expect(selected()).toEqual(['Overview']);
  });

  test('the centre action answers with its own key, and is not a tab', () => {
    const picked = vi.fn();
    render(<ScanTabBar activeTab="overview" onTabChange={picked} />);
    // It carries no label and never lights up, so it is found by what it does.
    const centre = screen.getByRole('button', { name: 'Look up a port' });
    expect(centre.getAttribute('role')).toBeNull();
    fireEvent.click(centre);
    expect(picked.mock.calls.map(([x]) => x)).toEqual(['port']);
    // and it is not counted among the tabs
    expect(labels()).toEqual(['Overview', 'Network', 'Report', 'Drift']);
  });

  test('each tab answers with its own key, and there is no menu', () => {
    const picked = vi.fn();
    render(<ScanTabBar activeTab="network" onTabChange={picked} />);
    expect(selected()).toEqual(['Network']);
    expect(screen.queryByText('More')).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
    screen.getAllByRole('tab').forEach((t) => fireEvent.click(t));
    expect(picked.mock.calls.map(([k]) => k)).toEqual(['overview', 'network', 'report', 'drift']);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  test('the screens that belong to Overview keep Overview lit', () => {
    for (const where of ['result', 'topology', 'switches']) {
      render(<ScanTabBar activeTab={where} onTabChange={() => {}} />);
      expect(labels()).toEqual(['Overview', 'Network', 'Report', 'Drift']);
      expect(selected()).toEqual(['Overview']);
      cleanup();
    }
  });

  test('a badge shows on its own tab and nowhere else', () => {
    render(<ScanTabBar activeTab="overview" onTabChange={() => {}} badges={{ drift: 3, report: 0 }} />);
    const drift = screen.getByRole('tab', { name: /Drift/ });
    expect(drift.textContent).toContain('3');
    expect(screen.getByRole('tab', { name: /Report/ }).textContent).toBe('Report');
  });
});
