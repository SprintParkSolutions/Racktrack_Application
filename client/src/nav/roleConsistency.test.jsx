/* What each role is shown, in the bar, in the Menu and on Home - and that the
 * three agree.
 *
 * The owner, 23 September 2026: "make sure you maintain everything per role -
 * what should be displayed for employee, for admin, for spoc - in nav bars,
 * sidebars, home pages. Maintain that consistency for the professionalism."
 *
 * Two files decide it. nav/navLinks.jsx builds the phone's bottom bar, the
 * phone's Menu and the desktop sidebar from one list; HomePage's waysFor()
 * builds the four marks on Home. Nothing made them agree, and they had
 * drifted: Home offered a single point of contact one set while their own
 * Menu offered another.
 *
 * So this file pins the matrix, and then checks the one rule that matters:
 *
 *   Home may never offer a role a destination that role's own navigation
 *   hides.
 *
 * A destination nobody's navigation carries - Switches, say - is not hidden
 * from anybody and Home may still offer it. What is forbidden is Home handing
 * somebody a door their Menu deliberately took away.
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const who = { current: { id: 1, role: 'member' } };
const can = { current: {} };
const view = { current: 'estate' };

vi.mock('../AuthContext.jsx', () => ({ useAuth: () => ({ user: who.current }) }));
vi.mock('../hooks/useApprovalsCan.js', () => ({ useApprovalsCan: () => can.current }));
vi.mock('../hooks/useAppView.js', () => ({
  useAppView: () => ({ view: view.current, views: ['estate', 'employee'], shift: () => {} }),
  roleOfUser: () => 'tech',
}));
vi.mock('../utils/approvals.js', () => ({ APPROVALS_URL: '/approvals/' }));

import { usePrimaryNav } from './navLinks.jsx';
import { waysFor } from '../pages/HomePage.jsx';

/* The three people the product is for. `can` is what the server answers
   about them, which is the only way a SPOC is known. */
const PEOPLE = {
  employee: { user: { id: 1, role: 'member' }, can: {}, view: 'estate', home: 'tech' },
  spoc: { user: { id: 2, role: 'member' }, can: { spoc: true }, view: 'estate', home: 'spoc' },
  admin: { user: { id: 3, role: 'org_admin' }, can: {}, view: 'estate', home: 'admin' },
};

function navFor(key) {
  const p = PEOPLE[key];
  who.current = p.user; can.current = p.can; view.current = p.view;
  return renderHook(() => usePrimaryNav()).result.current;
}
const goes = (nav) => nav.filter((l) => l.to).map((l) => l.to);
const bar = (nav) => nav.filter((l) => l.inBar).map((l) => l.barLabel || l.label);

beforeEach(() => { who.current = PEOPLE.employee.user; can.current = {}; view.current = 'estate'; });

/* The window between opening the app and the server saying what this account
   may do. It is short and it is where the worst of these bugs live: a SPOC
   read as a technician gets the whole employee app, camera and all. */
describe('before the server has answered', () => {
  test('a member is given nothing role-specific until their capabilities arrive', () => {
    who.current = { id: 2, role: 'member' };
    can.current = null;                    // /api/approvals/me has not answered
    view.current = 'employee';             // and roleOfUser() reads them as a technician
    const to = goes(renderHook(() => usePrimaryNav()).result.current);
    for (const page of ['/scan', '/multi-rack/new', '/history', '/tasks', '/port-history']) {
      expect(to).not.toContain(page);
    }
    // What belongs to no role is still there, so the app is never empty.
    expect(to).toContain('/');
    expect(to).toContain('/help');
    expect(to).toContain('/profile');
  });

  test('an admin does not wait: their own role already says so', () => {
    who.current = { id: 3, role: 'org_admin' };
    can.current = null;
    view.current = 'admin';
    const to = goes(renderHook(() => usePrimaryNav()).result.current);
    expect(to).toContain('/organizations');
    expect(to).not.toContain('/scan');
  });
});

describe('the bar, per role', () => {
  test('an employee works at the rack', () => {
    expect(bar(navFor('employee'))).toEqual(['Home', '2 Racks', 'Racks']);
  });
  test('a single point of contact decides, and is not given a camera', () => {
    expect(bar(navFor('spoc'))).toEqual(['Home', 'Drift']);
  });
  test('an admin runs the estate', () => {
    expect(bar(navFor('admin'))).toEqual(['Home', 'Drift', 'Org', 'Sources']);
  });
});

describe('what each role may reach at all', () => {
  test('the employee has the rack work and none of the estate', () => {
    const to = goes(navFor('employee'));
    for (const page of ['/scan', '/multi-rack/new', '/history', '/tasks', '/port-history',
      // What they raised, and what became of it: the other half of their own
      // work (23 September 2026).
      '/my-incidents']) {
      expect(to).toContain(page);
    }
    for (const page of ['/organizations', '/connections', '/my-checks']) {
      expect(to).not.toContain(page);
    }
  });

  test('the SPOC decides, and keeps tickets and nothing else of the rack work', () => {
    const to = goes(navFor('spoc'));
    expect(to).toContain('/my-checks');
    expect(to).toContain('/tasks');
    for (const page of ['/scan', '/multi-rack/new', '/history', '/port-history', '/my-incidents']) {
      expect(to).not.toContain(page);
    }
  });

  test('the admin has the estate and none of the rack work', () => {
    const to = goes(navFor('admin'));
    expect(to).toContain('/organizations');
    expect(to).toContain('/connections');
    for (const page of ['/scan', '/multi-rack/new', '/history', '/tasks', '/port-history',
      '/my-incidents']) {
      expect(to).not.toContain(page);
    }
  });

  test('everybody can reach help and their own account', () => {
    for (const key of Object.keys(PEOPLE)) {
      const to = goes(navFor(key));
      expect(to).toContain('/');
      expect(to).toContain('/help');
      expect(to).toContain('/contact');
      expect(to).toContain('/profile');
    }
  });
});

describe('Home says the same thing as the navigation', () => {
  /* Every destination any role's navigation carries. A page in this set that
     a role's own navigation leaves out was taken away from them on purpose. */
  const everywhere = () => {
    const all = new Set();
    for (const key of Object.keys(PEOPLE)) for (const to of goes(navFor(key))) all.add(to);
    return all;
  };

  test('Home never offers a role a door its own navigation took away', () => {
    const known = everywhere();
    for (const [key, p] of Object.entries(PEOPLE)) {
      const mine = new Set(goes(navFor(key)));
      for (const way of waysFor(p.home)) {
        if (!known.has(way.to)) continue;   // a page no navigation carries
        expect(`${key}: ${way.to}`).toBe(mine.has(way.to) ? `${key}: ${way.to}` : `${key}: hidden`);
      }
    }
  });

  test('and each role gets four marks on Home, in their own order', () => {
    expect(waysFor('tech').map((w) => w.to))
      .toEqual(['/tasks', '/help', '/history', '/profile']);
    expect(waysFor('spoc').map((w) => w.to))
      .toEqual(['/my-checks', '/help', '/tasks', '/profile']);
    expect(waysFor('admin').map((w) => w.to))
      .toEqual(['/organizations', '/help', '/connections', '/profile']);
    for (const role of ['tech', 'spoc', 'admin']) {
      expect(waysFor(role)).toHaveLength(4);
      // The account is always last, and the assistant always second: the
      // owner's order of 22 September 2026.
      expect(waysFor(role)[1].to).toBe('/help');
      expect(waysFor(role)[3].to).toBe('/profile');
    }
  });
});
