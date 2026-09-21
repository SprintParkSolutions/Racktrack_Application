import { describe, test, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import PortsCheck from './PortsCheck.jsx';

/* Ports on the Drift check: the cables in the photo against what the switch and
   NetBox say, in plain words, closed until somebody asks. */

const row = (port, verdict, over = {}) => ({
  deviceUid: 'dev:RK-5B81BE87:u18', device: 'Switch on shelf U18', port, portName: `Gi1/0/${port}`,
  camera: 'cabled', switch: 'up', netbox: 'connected', verdict, why: null, ...over,
});
const PORTS = {
  ok: true, planId: 140, sources: { camera: true, switch: true, netbox: true },
  summary: { match: 2, mismatch: 1, unknown: 25 },
  rows: [
    row(1, 'match'),
    row(3, 'mismatch', { switch: 'down', why: 'The photo shows a cable. The switch says the port is down.' }),
    row(2, 'match', { camera: 'empty', switch: 'down', netbox: 'not_connected' }),
    row(9, 'unknown', { camera: 'unknown', switch: 'unknown', netbox: 'unknown' }),
  ],
  note: null,
};

afterEach(cleanup);

describe('<PortsCheck>', () => {
  test('closed by default: the heading, how many ports were read, and no rows', () => {
    render(<PortsCheck ports={PORTS} />);
    const top = screen.getByRole('button', { name: /^Ports/ });
    expect(top.getAttribute('aria-expanded')).toBe('false');
    // one number on the row, not a strip of three
    expect(top.textContent).toBe('Ports28');
    expect(screen.queryByText(/Matched 2\b/)).toBeNull();
    expect(screen.queryByText(/Not matched/)).toBeNull();
    expect(screen.queryByText(/Not known/)).toBeNull();
    expect(screen.queryByText(/port 3/)).toBeNull();
  });

  test('opened: what does not match comes first, in plain words, and what matches is one more tap away', () => {
    render(<PortsCheck ports={PORTS} />);
    fireEvent.click(screen.getByRole('button', { name: /^Ports/ }));
    expect(screen.getByText('Cables in the photo against what the switch and NetBox say.')).toBeTruthy();
    // the three figures are a sentence in here, said once
    expect(screen.getByText('Matched 2, not matched 1, not known 25.')).toBeTruthy();
    expect(screen.getByText('Switch on shelf U18 - port 3')).toBeTruthy();
    expect(screen.getByText('Photo: cable')).toBeTruthy();
    expect(screen.getByText('Switch: down')).toBeTruthy();
    expect(screen.getByText('NetBox: connected')).toBeTruthy();
    expect(screen.getByText('The photo shows a cable. The switch says the port is down.')).toBeTruthy();
    // the ports that agree are behind their own line
    expect(screen.queryByText('Switch on shelf U18 - port 1')).toBeNull();
    const fold = screen.getByRole('button', { name: 'Matched ports (2)' });
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(fold);
    expect(screen.getByText('Switch on shelf U18 - port 1')).toBeTruthy();
    expect(screen.getByText('Photo: no cable')).toBeTruthy();
    expect(screen.getByText('NetBox: not connected')).toBeTruthy();
    // a port nothing is known about is counted and not listed
    expect(screen.queryByText('Switch on shelf U18 - port 9')).toBeNull();
    // and nothing internal is printed, nor any long dash
    expect(document.body.textContent).not.toMatch(/dev:|RK-5B81BE87|not_connected|\u2013|\u2014/);
  });

  test('the note is shown as it came, and a value the screen does not know reads as not known', () => {
    render(<PortsCheck ports={{ ok: true, rows: [row(4, 'mismatch', { switch: 'dormant', netbox: undefined })],
      note: 'No switch has been read for this rack yet.' }} />);
    // no summary from the server: the numbers are counted from the rows
    expect(screen.getByRole('button', { name: /^Ports/ }).textContent).toBe('Ports1');
    fireEvent.click(screen.getByRole('button', { name: /^Ports/ }));
    expect(screen.getByText('Matched 0, not matched 1, not known 0.')).toBeTruthy();
    expect(screen.getByText('No switch has been read for this rack yet.')).toBeTruthy();
    expect(screen.getByText('Switch: not known')).toBeTruthy();
    expect(screen.getByText('NetBox: not known')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Matched ports/ })).toBeNull();
  });

  test('a box named only by a key is never printed by it', () => {
    render(<PortsCheck ports={{ ok: true, rows: [row(5, 'mismatch', { device: 'dev:RK-5B81BE87:u18' })] }} />);
    fireEvent.click(screen.getByRole('button', { name: /^Ports/ }));
    expect(screen.getByText('A device - port 5')).toBeTruthy();
  });

  test('nothing to show, nothing drawn', () => {
    for (const ports of [null, undefined, { ok: false, error: 'Not found' }, { ok: true, rows: [], note: null }]) {
      const { container } = render(<PortsCheck ports={ports} />);
      expect(container.textContent).toBe('');
      cleanup();
    }
  });
});
