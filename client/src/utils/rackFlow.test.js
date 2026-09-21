import { describe, test, expect, beforeEach } from 'vitest';
import { clearRackFlow, getRackFlow, setRackFlow } from './rackFlow';

/* Which of the two jobs a rack is in. Analyse the network is the default; Look
   up a port is remembered for one rack, for as long as the person stays on
   that rack's pages. */

beforeEach(() => window.sessionStorage.clear());

describe('rackFlow', () => {
  test('a rack nobody has chosen anything for is in Analyse the network', () => {
    expect(getRackFlow('RK-1')).toBe('analyse');
    expect(getRackFlow(null)).toBe('analyse');
  });

  test('Look up a port is remembered for that rack and no other', () => {
    setRackFlow('RK-1', 'port');
    expect(getRackFlow('RK-1')).toBe('port');
    expect(getRackFlow('RK-2')).toBe('analyse');
  });

  test('that screen\'s own Back, or leaving the rack, puts it back', () => {
    setRackFlow('RK-1', 'port');
    setRackFlow('RK-1', 'analyse');
    expect(getRackFlow('RK-1')).toBe('analyse');
    setRackFlow('RK-1', 'port');
    clearRackFlow();
    expect(getRackFlow('RK-1')).toBe('analyse');
  });

  test('something unreadable in the store is the default, not a crash', () => {
    window.sessionStorage.setItem('rt.rack.flow', '{not json');
    expect(getRackFlow('RK-1')).toBe('analyse');
    window.sessionStorage.setItem('rt.rack.flow', JSON.stringify({ rackId: 'RK-1', flow: 'other' }));
    expect(getRackFlow('RK-1')).toBe('analyse');
  });
});
