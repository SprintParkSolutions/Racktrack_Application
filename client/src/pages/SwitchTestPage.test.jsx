import { describe, test, expect } from 'vitest';
import { comparePorts, trailingNumber, agoText } from './SwitchTestPage.jsx';

/* The Network page's one piece of judgement: the photograph against the
   reading, socket by socket. Everything else on that page is a number carried
   straight from the phone's reading or from the rack's scan. */

const socket = (n, status, uplink = false) => ({ n, status, uplink, type: uplink ? 'sfp' : 'rj45' });
const port = (n, up) => ({ index: n, name: `Gi1/0/${n}`, up });

describe('trailingNumber', () => {
  test('a port is the number its name ends in', () => {
    expect(trailingNumber('Gi1/0/24')).toBe(24);
    expect(trailingNumber('Slot0/52')).toBe(52);
    expect(trailingNumber('3')).toBe(3);
    expect(trailingNumber('uplink')).toBe(null);
    expect(trailingNumber(null)).toBe(null);
  });
});

describe('comparePorts', () => {
  test('a cable on a port that is down, and an empty socket on a port that is up', () => {
    const out = comparePorts(
      [socket(1, 'connected'), socket(2, 'connected'), socket(3, 'empty'), socket(4, 'empty')],
      [port(1, true), port(2, false), port(3, true), port(4, false)],
    );
    expect(out.linedUp).toBe(true);
    expect(out.cabled).toBe(2);
    expect(out.emptyInPhoto).toBe(2);
    expect(out.disagree.map((r) => r.n)).toEqual([2, 3]);
    expect(out.rows[1].why).toBe('The photo shows a cable. The switch says the port is down.');
    expect(out.rows[2].why).toBe('The photo shows an empty socket. The switch says the port is up.');
    expect(out.rows[0].disagrees).toBe(false);
    expect(out.rows[3].disagrees).toBe(false);
  });

  test('a socket the photo could not read is not a finding', () => {
    const out = comparePorts([socket(1, 'unknown'), socket(2, 'connected')], [port(1, false), port(2, true)]);
    expect(out.linedUp).toBe(true);
    expect(out.unreadable).toBe(1);
    expect(out.disagree).toEqual([]);
    expect(out.rows[0].camera).toBe('unknown');
  });

  test('two sides with different socket counts are not lined up, and claim nothing', () => {
    const out = comparePorts(
      [socket(1, 'connected'), socket(2, 'connected')],
      [port(1, false), port(2, false), port(3, false)],
    );
    expect(out.linedUp).toBe(false);
    expect(out.rows).toEqual([]);
    expect(out.disagree).toEqual([]);
    // What the photo shows is still counted: it does not need the switch.
    expect(out.cabled).toBe(2);
  });

  test('a number two ports share answers for neither', () => {
    const out = comparePorts(
      [socket(1, 'connected'), socket(2, 'empty'), socket(3, 'connected')],
      [{ index: 1, name: 'Gi1/0/1', up: false }, { index: 2, name: 'Te1/1/1', up: false },
        { index: 3, name: 'Gi1/0/3', up: true }],
    );
    expect(out.linedUp).toBe(true);
    // 1 is the end of both Gi1/0/1 and Te1/1/1, so it speaks for neither, and
    // nothing ends in 2. Only socket 3 has a port to be judged against.
    expect(out.rows.map((r) => r.state)).toEqual(['unknown', 'unknown', 'up']);
    expect(out.disagree).toEqual([]);
  });

  test('when no port number can be trusted, nothing is lined up', () => {
    const out = comparePorts(
      [socket(1, 'connected'), socket(2, 'empty')],
      [{ index: 1, name: 'Gi1/0/1', up: true }, { index: 2, name: 'Te1/1/1', up: false }],
    );
    expect(out.linedUp).toBe(false);
    expect(out.rows).toEqual([]);
  });

  test('an SFP cage in the photo is carried onto the port', () => {
    const out = comparePorts([socket(1, 'connected', true), socket(2, 'empty')], [port(1, true), port(2, false)]);
    expect(out.rows.map((r) => r.sfp)).toEqual([true, false]);
  });

  test('nothing from the photo means nothing to compare', () => {
    const out = comparePorts([], [port(1, true)]);
    expect(out.linedUp).toBe(false);
    expect(out.cabled).toBe(0);
  });
});

describe('agoText', () => {
  test('how long ago, in the words a person would use', () => {
    const at = (ms) => new Date(Date.now() - ms).toISOString();
    expect(agoText(null)).toBe(null);
    expect(agoText(at(5_000))).toBe('just now');
    expect(agoText(at(12 * 60_000))).toBe('12 min ago');
    expect(agoText(at(3 * 3600_000))).toBe('3 hours ago');
    expect(agoText(at(3 * 86400_000))).toBe('3 days ago');
  });
});
