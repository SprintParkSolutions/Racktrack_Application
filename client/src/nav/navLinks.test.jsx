import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

/* The app's one list of destinations, and who sees what.
 *
 * Two rules are load-bearing here, both the owner's:
 *
 *   the Desk is for the people who decide - an organisation admin, and
 *   whoever is a Site's single point of contact. A technician checks a rack
 *   and then follows the one check they sent, which is a page in the app.
 *
 *   the phone's bar carries FOUR tabs around the raised Scan, whoever is
 *   looking: "keep 3 or 5 when there is a centre button". A technician had
 *   three once the Desk came off, which left the centre off-centre.
 */

const who = { current: { role: 'member' } };
const can = { current: {} };
vi.mock('../AuthContext.jsx', () => ({ useAuth: () => ({ user: who.current }) }));
vi.mock('../hooks/useApprovalsCan.js', () => ({ useApprovalsCan: () => can.current }));
vi.mock('../utils/approvals.js', () => ({ APPROVALS_URL: '/approvals/' }));

import { usePrimaryNav } from './navLinks.jsx';

const nav = () => renderHook(() => usePrimaryNav()).result.current;
const inBar = () => nav().filter((l) => l.inBar).map((l) => l.barLabel || l.label);
const labels = () => nav().map((l) => l.label);

beforeEach(() => { who.current = { role: 'member' }; can.current = {}; });

describe('the phone bar', () => {
  test('a technician gets four tabs, and none of them is the Desk', () => {
    expect(inBar()).toEqual(['Home', 'Racks', 'Ports']);
    expect(labels()).not.toContain('Drift Desk');
  });

  test('an organisation admin gets four tabs, one of them the Desk', () => {
    who.current = { role: 'org_admin' };
    expect(inBar()).toEqual(['Home', '2 Racks', 'Drift']);
  });

  test('a technician who is a Site contact is a SPOC, and gets the Desk', () => {
    can.current = { spoc: true };
    expect(labels()).toContain('Drift Desk');
    expect(inBar()).toEqual(['Home', '2 Racks', 'Drift']);
  });

  /* Menu is added by the bar itself from everything not in it, so the row is
     the tabs above plus Menu: four either way, two each side of the centre. */
  test('every role ends with four tabs once Menu is counted', () => {
    for (const [user, cap] of [[{ role: 'member' }, {}], [{ role: 'org_admin' }, {}],
      [{ role: 'owner' }, {}], [{ role: 'member' }, { spoc: true }]]) {
      who.current = user; can.current = cap;
      expect(inBar().length + 1).toBe(4);
    }
  });
});

describe('what is not linked', () => {
  test('Marketplace and Lab are reachable from nowhere', () => {
    for (const role of ['member', 'org_admin', 'owner']) {
      who.current = { role };
      expect(labels()).not.toContain('Marketplace');
      expect(labels()).not.toContain('Lab');
    }
  });

  test('two racks as one job stays for a technician, in the Menu', () => {
    const two = nav().find((l) => l.label === 'Two racks');
    expect(two).toBeTruthy();
    expect(two.inBar).toBeUndefined();
  });
});
