import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

/* The app's one list of destinations, and who sees what.
 *
 * Three rules are load-bearing here, all of them the owner's:
 *
 *   the Desk is for the people who decide - an organisation admin, and
 *   whoever is a Site's single point of contact. A technician checks a rack
 *   and then follows the one check they sent, which is a page in the app.
 *
 *   an admin's app is admin level: no scanning, no two-racks job, no scan
 *   history. Those belong to the employee who took the photographs. An admin
 *   or SPOC who means to do that work shifts the toggle on Home to Employee
 *   and gets the whole employee app, this list included (23 Sep 2026).
 *
 *   in the employee's view the bar carries FOUR tabs around the raised Scan:
 *   "keep 3 or 5 when there is a centre button". Outside it there is no
 *   centre button, so the bar is a plain row and the count is free.
 */

const who = { current: { role: 'member' } };
const can = { current: {} };
vi.mock('../AuthContext.jsx', () => ({ useAuth: () => ({ user: who.current }) }));
vi.mock('../hooks/useApprovalsCan.js', () => ({ useApprovalsCan: () => can.current }));
vi.mock('../utils/approvals.js', () => ({ APPROVALS_URL: '/approvals/' }));
// Which view the app is in. The toggle itself is tested with Home; here it is
// the switch that decides whether this is an admin's app or an employee's.
const view = { current: 'admin' };
vi.mock('../hooks/useAppView.js', async () => {
  const real = await vi.importActual('../hooks/useAppView.js');
  return { ...real, useAppView: (role) => ({ view: view.current, views: [], role, shift: () => {} }) };
});

import { usePrimaryNav } from './navLinks.jsx';

const nav = () => renderHook(() => usePrimaryNav()).result.current;
const inBar = () => nav().filter((l) => l.inBar).map((l) => l.barLabel || l.label);
const labels = () => nav().map((l) => l.label);

beforeEach(() => { who.current = { role: 'member' }; can.current = {}; view.current = 'admin'; });

describe('the phone bar', () => {
  test('a technician gets four tabs, and none of them is the Desk', () => {
    // The owner named them on 23 Sep 2026: home, two racks, the camera in the
    // middle, the scan history, and Menu. Port history moved into the Menu.
    expect(inBar()).toEqual(['Home', '2 Racks', 'Racks']);
    expect(labels()).not.toContain('RackTrack Control');
  });

  test("an organisation admin's bar is the estate, not a technician's work", () => {
    who.current = { role: 'org_admin' };
    expect(inBar()).toEqual(['Home', 'Drift', 'Org', 'Sources']);
    // None of the employee's work is offered anywhere, bar or menu.
    expect(labels()).not.toContain('Scan a rack');
    expect(labels()).not.toContain('Two racks');
    expect(labels()).not.toContain('Scan history');
  });

  test('a technician who is a Site contact is a SPOC, and gets the Desk', () => {
    can.current = { spoc: true };
    expect(labels()).toContain('RackTrack Control');
    // Home, the Desk, and the Menu the bar draws itself: three (the owner,
    // 23 September 2026). Their own list of checks is in the Menu - the Desk
    // is where checks are read, and a second tab to the same work is a second
    // door to one room.
    expect(inBar()).toEqual(['Home', 'Drift']);
    expect(labels()).toContain('Your checks');
    expect(labels()).not.toContain('Scan a rack');
    // Nor anything else the employee's app is made of. Looking a port up is
    // what somebody does standing at a rack they have just read; a single
    // point of contact never took the photograph (the owner, 23 Sep 2026).
    expect(labels()).not.toContain('Port history');
    // Tickets are the one piece of the employee's app they keep: a SPOC can
    // be asked to go and look at a rack (the owner, 23 September 2026).
    expect(labels()).toContain('Tickets for you');
  });

  test('an admin who shifts to Employee gets the whole employee app back', () => {
    who.current = { role: 'org_admin' };
    view.current = 'employee';
    expect(inBar()).toEqual(['Home', '2 Racks', 'Racks']);
    expect(labels()).toContain('Scan a rack');
    expect(labels()).toContain('Two racks');
    // And the Desk goes: in the employee's view they are working as one.
    expect(labels()).not.toContain('RackTrack Control');
  });

  /* Menu is added by the bar itself from everything not in it. In the
     employee's view that must come to four, two each side of the raised
     camera; in an admin's view there is no camera and no such rule. */
  test('the employee view ends with four tabs once Menu is counted', () => {
    view.current = 'employee';
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

  test('looking a port up is in nobody\'s navigation', () => {
    /* The owner's own matrix, 23 September 2026: a port is looked up from the
       rack that holds it, which the rack's own workflow offers. The screen and
       its route are untouched - only the Menu row is gone. */
    for (const v of ['employee', 'estate']) {
      view.current = v;
      expect(nav().find((l) => l.label === 'Port history')).toBeUndefined();
    }
  });
});
