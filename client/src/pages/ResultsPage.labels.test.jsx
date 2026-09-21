import { describe, test, expect } from 'vitest';
import { buildDeviceLabels } from './ResultsPage.jsx';

/* Names minted for the boxes in a rack. Where a real sticker was read, the
   rack follows its convention - but the shelf in that sticker belongs to the
   device it was read from, not to the rack. */

const dev = (cls, ...units) => ({ class_name: cls, units: units.map((u) => `u${u}`), box: [0, 0, 10, 10] });
const SP = { prefix: 'SP-R1-U15', sep: '-', classTok: 'SW', padding: 2 };

describe('buildDeviceLabels', () => {
  test('a read sticker gives the rack its convention, and each box its own shelf', () => {
    // The office rack, as the camera reads it: the sticker that was legible
    // says SP-R1-U15-SW02, and the names that come out match the ones the
    // customer actually has on the other boxes.
    const devices = [dev('Router', 20), dev('Firewall', 19), dev('Switch', 18),
                     dev('Switch', 17), dev('Switch', 15), dev('Switch', 13),
                     dev('Patch Panel', 10, 11), dev('Patch Panel', 1, 2)];
    const out = buildDeviceLabels(devices, [], SP);
    expect(out).toEqual([
      'SP-R1-U20-RO01', 'SP-R1-U19-FW01', 'SP-R1-U18-SW04', 'SP-R1-U17-SW03',
      'SP-R1-U15-SW02', 'SP-R1-U13-SW01', 'SP-R1-U10-PP02', 'SP-R1-U01-PP01',
    ]);
    // The shelf the sticker happened to be on is not stamped on everything.
    expect(out.filter((n) => n.includes('U15'))).toHaveLength(1);
  });

  test('a box with no shelf keeps the rack part and drops the shelf segment', () => {
    const [name] = buildDeviceLabels([{ class_name: 'Switch', units: [], box: [0, 0, 10, 10] }], [], SP);
    expect(name).toBe('SP-R1-SW01');
  });

  test('a pattern with no shelf in it is left exactly as it was', () => {
    const out = buildDeviceLabels([dev('Switch', 4)], [],
                                  { prefix: 'RVEW-CORE', sep: '-', classTok: 'SW', padding: 2 });
    expect(out).toEqual(['RVEW-CORE-SW01']);
  });

  test('with no sticker read, a name is built from the shelf the box is on', () => {
    expect(buildDeviceLabels([dev('Switch', 13)], ['u13'])).toEqual(['U13-SW01']);
  });
});
