import { describe, test, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/* The Operations Console, on a phone.
 *
 * What is pinned here is the shape the screen was rebuilt into, because the
 * old one did not fit a 390px screen:
 *
 *   figures    six, not eight - two across, each label on one line, and the
 *              two counts that were dropped (people, organizations) are the
 *              counts on the sections that list those things
 *   controls   the page's own controls are the Live switch in the header and
 *              one row holding the two tabs and Refresh
 *   lists      a list shows its first few rows and offers the rest; a row is
 *              one line, and no label carries a "+"
 */

const { answers, asked } = vi.hoisted(() => ({
  answers: { current: {} },
  asked: { paths: [] },
}));

vi.mock('../utils/api', () => ({
  apiUrl: (p) => p,
  authFetch: vi.fn(async (url) => {
    asked.paths.push(url);
    const key = Object.keys(answers.current).find((k) => String(url).startsWith(k));
    if (!key) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => answers.current[key] };
  }),
}));
// The Logs tab is its own screen with its own requests; this file is about
// the console's shape, so it stands in for itself.
vi.mock('./LogsPage.jsx', () => ({ LogsView: () => <div>Logs stand-in</div> }));

import DashboardPage from './DashboardPage.jsx';

const ago = (s) => new Date(Date.now() - s * 1000).toISOString();

const event = (i, over = {}) => ({
  ts: ago(60 * (i + 1)), username: `tech${i}`, actor_id: `U${i}`, guest: 0,
  action: 'scan.create', status: 'ok', org: 'DC-007', ...over,
});

const DASH = {
  ok: true,
  generatedAt: ago(30),
  totals: {
    users: 3, orgs: 2, scansOk: 148, scansFail: 2, scansToday: 6, activeToday: 4,
    totalEvents: 900, totalFails: 11, successRate: 99,
  },
  feedback: { right: 40, wrong: 5, accuracy: 89 },
  auth: { logins_ok: 60, logins_fail: 3, signups: 5, invites: 2, resets: 1 },
  // Eight events, so the six-row limit has something to hide.
  recent: [
    event(0),
    event(1, { action: 'auth.login', status: 'fail', error: 'bad_credentials', username: 'jane', actor_id: null, guest: 1 }),
    event(2), event(3), event(4), event(5), event(6), event(7),
  ],
  errors: [{ ts: ago(120), username: 'jane', action: 'auth.login', error: 'bad_credentials', org: 'DC-007' }],
  topUsers: [{ username: 'sp.tech', scans: 40 }, { username: 'tech2', scans: 8 }],
  byOrg: [{ org: 'DC-007', scans: 44 }],
  bySite: [{ site: 'DC-007 Bengaluru', scans: 44 }],
  actions: [{ action: 'scan.create', ok: 140, fail: 2 }],
  recentScans: [
    { ts: ago(90), rack: 'RK-5B81BE87', username: 'sp.tech', site: 'DC-007 Bengaluru', org: 'DC-007' },
  ],
  allUsers: [
    { public_id: 'U-1', username: 'sp.tech', role: 'member', org: 'DC-007', scans: 40, events: 90, fails: 0, last_active: ago(300), active: 1 },
    { public_id: 'U-2', username: 'jane', role: 'org_admin', org: 'DC-007', scans: 2, events: 9, fails: 3, last_active: null, active: 0 },
    { public_id: 'U-3', username: 'owner', role: 'owner', org: null, scans: 0, events: 4, fails: 0, last_active: ago(60), active: 1 },
  ],
  allOrgs: [
    { name: 'DC-007', status: 'active', members: 3, scans: 44 },
    { name: 'Meridian', status: 'pending', members: 1, scans: 0 },
  ],
};

const open = () => render(<MemoryRouter><DashboardPage /></MemoryRouter>);
const figures = () => Array.from(document.querySelectorAll('[data-figure]'));

beforeEach(() => { answers.current = { '/api/admin/dashboard': DASH }; asked.paths.length = 0; });
afterEach(() => { cleanup(); });

describe('<DashboardPage> on a phone', () => {
  test('six figures, and the two that went are the counts on their own sections', async () => {
    open();
    await waitFor(() => expect(figures()).toHaveLength(6));
    const labels = figures().map((f) => f.textContent);
    for (const label of ['Scans today', 'Active today', 'Total scans', 'Success rate',
      'Feedback accuracy', 'Failures']) {
      expect(labels.some((t) => t.includes(label))).toBe(true);
    }
    // No box of its own for either count any more.
    expect(labels.some((t) => t.includes('Users'))).toBe(false);
    expect(labels.some((t) => t.includes('Organizations'))).toBe(false);
    // They are read where the people and the organizations are listed.
    expect(screen.getByText('All people').parentElement.textContent).toContain('3 in total');
    expect(screen.getByText('All organizations').parentElement.textContent).toContain('2 in total');
  });

  test('every figure keeps its second fact, which used to be hidden', async () => {
    open();
    await waitFor(() => expect(figures()).toHaveLength(6));
    const note = (label) => figures().find((f) => f.textContent.includes(label)).textContent;
    expect(note('Total scans')).toContain('2 failed');
    expect(note('Feedback accuracy')).toContain('40 right · 5 wrong');
    expect(note('Failures')).toContain('of 900 events');
    expect(note('Active today')).toContain('people');
  });

  test('the controls are the Live switch and one row with the tabs and Refresh', async () => {
    open();
    await waitFor(() => expect(figures()).toHaveLength(6));
    const live = screen.getByRole('button', { name: /^Live$/ });
    expect(live.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(live);
    expect(screen.getByRole('button', { name: /^Paused$/ }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Operations' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Logs' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
    // Nothing on this page asks for a "+".
    for (const b of screen.getAllByRole('button')) expect(b.textContent).not.toContain('+');
  });

  test('live activity shows six of eight events and offers the rest', async () => {
    open();
    await waitFor(() => expect(figures()).toHaveLength(6));
    const card = screen.getByText('Live activity').closest('section');
    const rowsIn = (el) => el.querySelectorAll('[data-row]');
    expect(rowsIn(card)).toHaveLength(6);
    const more = within(card).getByRole('button', { name: 'View all 8 events' });
    fireEvent.click(more);
    expect(rowsIn(card)).toHaveLength(8);
    expect(within(card).getByRole('button', { name: 'Show fewer' })).toBeTruthy();
  });

  test('a failed event says so in plain words, on its own line', async () => {
    open();
    await waitFor(() => expect(figures()).toHaveLength(6));
    const card = screen.getByText('Live activity').closest('section');
    expect(within(card).getByText('Failed')).toBeTruthy();
    expect(within(card).getByText('Wrong username or password')).toBeTruthy();
    expect(within(card).getByText(/not signed in/)).toBeTruthy();
  });

  test('signing in is five lines, not five figures squeezed into a row', async () => {
    open();
    await waitFor(() => expect(figures()).toHaveLength(6));
    const card = screen.getByText('Signing in').closest('section');
    for (const label of ['Sign-ins', 'Failed sign-ins', 'Sign-ups', 'Invites accepted', 'Password resets']) {
      expect(within(card).getByText(label)).toBeTruthy();
    }
  });

  test('a scan row is the rack, then who and where, then when', async () => {
    open();
    await waitFor(() => expect(figures()).toHaveLength(6));
    const card = screen.getByText('Recent scans').closest('section');
    expect(within(card).getByText('RK-5B81BE87')).toBeTruthy();
    expect(within(card).getByText('sp.tech · DC-007 Bengaluru · DC-007')).toBeTruthy();
  });
});
