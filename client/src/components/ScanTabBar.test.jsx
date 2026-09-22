import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import ScanTabBar from './ScanTabBar.jsx';

/* The rack's tab bar. A rack holds two jobs and each has its own bar; what
   matters is that a bar never changes shape within its own job.

   Analysing the network is one row of four, with no menu behind it. Looking a
   port up leads to more screens than a bar holds, so it is four and a More. */

const labels = () => screen.getAllByRole('tab').map((t) => t.textContent);
const selected = () => screen.getAllByRole('tab').filter((t) => t.getAttribute('aria-selected') === 'true').map((t) => t.textContent);

afterEach(cleanup);

describe('<ScanTabBar>', () => {
  test('four tabs, in order: Overview, Network, Report, Drift', () => {
    render(<ScanTabBar activeTab="overview" onTabChange={() => {}} />);
    expect(labels()).toEqual(['Overview', 'Network', 'Report', 'Drift']);
    expect(selected()).toEqual(['Overview']);
  });

  test('the rack bar is four plain tabs: the raised action belongs to the app bar alone', () => {
    render(<ScanTabBar activeTab="overview" onTabChange={() => {}} />);
    expect(labels()).toEqual(['Overview', 'Network', 'Report', 'Drift']);
    expect(screen.queryByRole('button', { name: 'Look up a port' })).toBeNull();
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

  test('the port workflow leads with the rack, then the port, then the rest under More', () => {
    render(<ScanTabBar flow="port" activeTab="result" onTabChange={() => {}} />);
    expect(labels()).toEqual(['Rack', 'Port', 'Switches', 'Network']);
    expect(selected()).toEqual(['Port']);
    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Topology', 'Report']);
  });

  /* Comparing the rack against the record belongs to the other workflow.
     Looking a port up never offers it, on the bar or under More. */
  test('no Drift anywhere in the port workflow', () => {
    render(<ScanTabBar flow="port" activeTab="result" onTabChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    expect(screen.queryByText('Drift')).toBeNull();
  });

  test('in the port workflow Switches and Topology are tabs of their own, not Overview', () => {
    render(<ScanTabBar flow="port" activeTab="switches" onTabChange={() => {}} />);
    expect(selected()).toEqual(['Switches']);
    cleanup();
    // Under More, so nothing in the row is lit - the More button carries it.
    render(<ScanTabBar flow="port" activeTab="topology" onTabChange={() => {}} />);
    expect(selected()).toEqual([]);
  });

  test('a screen the workflow does not have falls back to its first tab, never to nothing', () => {
    render(<ScanTabBar flow="port" activeTab="nowhere" onTabChange={() => {}} />);
    expect(selected()).toEqual(['Rack']);
    cleanup();
    render(<ScanTabBar activeTab="nowhere" onTabChange={() => {}} />);
    expect(selected()).toEqual(['Overview']);
  });

  test('each bar says which job it belongs to', () => {
    render(<ScanTabBar activeTab="overview" onTabChange={() => {}} />);
    expect(screen.getByRole('tablist').getAttribute('aria-label')).toBe('Network analysis tabs');
    cleanup();
    render(<ScanTabBar flow="port" activeTab="result" onTabChange={() => {}} />);
    expect(screen.getByRole('tablist').getAttribute('aria-label')).toBe('Port lookup tabs');
  });
});
