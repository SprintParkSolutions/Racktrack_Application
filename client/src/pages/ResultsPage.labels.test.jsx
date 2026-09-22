import { describe, test, expect } from 'vitest';
import { buildDeviceLabels, headerWhereLines } from './ResultsPage.jsx';

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
      'SP-R1-U15-SW02', 'SP-R1-U13-SW01', 'SP-R1-U10-U11-PP02', 'SP-R1-U01-U02-PP01',
    ]);
    // The shelf the sticker happened to be on is not stamped on everything.
    expect(out.filter((n) => n.includes('U15'))).toHaveLength(1);
  });

  test('a box across two shelves carries both', () => {
    // The office rack's panels are 2U: the bottom one is U01-U02.
    const out = buildDeviceLabels([dev('Patch Panel', 1, 2), dev('Patch Panel', 4, 5)], [], SP);
    expect(out).toEqual(['SP-R1-U01-U02-PP01', 'SP-R1-U04-U05-PP02']);
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

/* Under the rack's name the header says the Site the scan belongs to, never
   where the phone stood: no coordinates, no site worked out from them, no
   distance. The Site the scan carries is a record; a position is not. */
describe('headerWhereLines', () => {
  const OLD_BUILD_SCAN = {
    spaceName: 'RM01',
    evidence: { location: { verdict: 'away', site: 'Office-Sprintpark', distanceM: 412, accuracyM: 18,
      at: { lat: 17.4474, lng: 78.3762 }, note: 'The photo was taken 412 m from Office-Sprintpark.' } },
  };

  test('the Site is said, and nothing a position would give', () => {
    const lines = headerWhereLines({ name: 'R1', also: 'SP-HYB-RM01-R01-R1', confirmed: true },
      { ...OLD_BUILD_SCAN, siteName: 'DC-007 Hyderabad' });
    expect(lines).toEqual(['SP-HYB-RM01-R01-R1', 'DC-007 Hyderabad']);
    expect(lines.join(' ')).not.toMatch(/412|17\.4474|78\.3762/);
  });

  test('the Site the app itself knows wins over whatever the scan carries', () => {
    const lines = headerWhereLines({ name: 'R1', also: null },
      { ...OLD_BUILD_SCAN, siteName: 'An older answer' }, 'DC-007 Bengaluru');
    expect(lines).toEqual(['DC-007 Bengaluru']);
  });

  test('a scan with no Site falls back to its room', () => {
    const lines = headerWhereLines({ name: 'R1', also: 'SP-HYB-RM01-R01-R1', confirmed: true }, OLD_BUILD_SCAN);
    expect(lines).toEqual(['SP-HYB-RM01-R01-R1', 'RM01']);
  });

  test('a scan with neither, and no second name, says nothing', () => {
    expect(headerWhereLines(null, { evidence: OLD_BUILD_SCAN.evidence })).toEqual([]);
    expect(headerWhereLines(null, null)).toEqual([]);
  });
});

/* A ladder that collapsed labelled a rack u01..u4015, and the app printed the
   number into the device's name: SP-RI-4015-PP1. No rack is that tall, so a
   shelf over 58 is not a shelf, and the name simply leaves it out. */
describe('a shelf nobody can stand on', () => {
  test('an impossible unit is not printed as one', () => {
    expect(buildDeviceLabels([dev('Patch Panel', 4015)], ['u4015'])).toEqual(['U01-PP01']);
  });

  test('and a real shelf still is', () => {
    expect(buildDeviceLabels([dev('Patch Panel', 12)], ['u12'])).toEqual(['U12-PP01']);
  });
});
