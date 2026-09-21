import { describe, test, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import ScanTabBar from './ScanTabBar.jsx';
import { setRackFlow } from '../utils/rackFlow';

/* The rack's tab bar: two rows of five, one for each job the review page
   offers. Every page the old More sheet held is a tab now, so there is no More
   tab and no sheet. */

const labels = () => screen.getAllByRole('tab').map((t) => t.textContent);
const selected = () => screen.getAllByRole('tab').filter((t) => t.getAttribute('aria-selected') === 'true').map((t) => t.textContent);

beforeEach(() => window.sessionStorage.clear());
afterEach(cleanup);

describe('<ScanTabBar>', () => {
  test('Analyse the network is the default: Overview, Network, Drift, Report, Timeline', () => {
    render(<ScanTabBar rackId="RK-1" activeTab="overview" onTabChange={() => {}} />);
    expect(labels()).toEqual(['Overview', 'Network', 'Drift', 'Report', 'Timeline']);
    expect(selected()).toEqual(['Overview']);
  });

  test('Look up a port: Result, Switches, Network, Topology, Timeline', () => {
    render(<ScanTabBar rackId="RK-1" flow="port" activeTab="overview" onTabChange={() => {}} />);
    expect(labels()).toEqual(['Result', 'Switches', 'Network', 'Topology', 'Timeline']);
    // the results page is lit under the name it has in this flow
    expect(selected()).toEqual(['Result']);
  });

  test('a page that does not say which flow reads what was remembered for the rack', () => {
    setRackFlow('RK-1', 'port');
    render(<ScanTabBar rackId="RK-1" activeTab="network" onTabChange={() => {}} />);
    expect(labels()).toEqual(['Result', 'Switches', 'Network', 'Topology', 'Timeline']);
    expect(selected()).toEqual(['Network']);
    cleanup();
    // another rack is not in that flow
    render(<ScanTabBar rackId="RK-2" activeTab="network" onTabChange={() => {}} />);
    expect(labels()).toEqual(['Overview', 'Network', 'Drift', 'Report', 'Timeline']);
  });

  test('the centre action answers with its own key, and is not a tab', () => {
    const picked = vi.fn();
    render(<ScanTabBar rackId="RK-1" activeTab="overview" onTabChange={picked} />);
    // It carries no label and never lights up, so it is found by what it does.
    const centre = screen.getByRole('button', { name: 'Look up a port' });
    expect(centre.getAttribute('role')).toBeNull();
    fireEvent.click(centre);
    expect(picked.mock.calls.map(([k]) => k)).toEqual(['port']);
    // and it is not counted among the tabs
    expect(labels()).toEqual(['Overview', 'Network', 'Drift', 'Report', 'Timeline']);
  });

  test('there is no More tab and no sheet: every tab answers with its own key', () => {
    const picked = vi.fn();
    for (const [flow, keys] of [['analyse', ['overview', 'network', 'drift', 'report', 'timeline']],
      ['port', ['result', 'switches', 'network', 'topology', 'timeline']]]) {
      render(<ScanTabBar rackId="RK-1" flow={flow} activeTab="timeline" onTabChange={picked} />);
      expect(screen.queryByText('More')).toBeNull();
      expect(screen.queryByRole('menu')).toBeNull();
      screen.getAllByRole('tab').forEach((t) => fireEvent.click(t));
      expect(picked.mock.calls.map(([k]) => k)).toEqual(keys);
      expect(screen.queryByRole('menu')).toBeNull();
      expect(selected()).toEqual(['Timeline']);
      picked.mockClear(); cleanup();
    }
  });
});
