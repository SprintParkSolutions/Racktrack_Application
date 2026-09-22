import { describe, test, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

/* Home - the app's landing screen.
 *
 * Three things are checked, because three things are load-bearing:
 *   the full state   every figure and every row comes from a request the
 *                    server already answers, and a rack's state is told in the
 *                    words the rest of the app uses
 *   the empty state  a new account gets the greeting, the card, what is
 *                    missing and what a first scan does - never a grid of
 *                    zeroes
 *   the button       the one thing this page is for reaches /scan
 *
 * Every request is stubbed by path, so a page that starts asking for something
 * new fails here rather than quietly showing a made-up number.
 */

const { answers, asked, opened } = vi.hoisted(() => ({
  answers: { current: {} },
  asked: { paths: [] },
  opened: { calls: [] },
}));

vi.mock('../utils/api', () => ({
  apiUrl: (p) => p,
  authFetch: vi.fn(async (url) => {
    asked.paths.push(url);
    const key = Object.keys(answers.current).find((k) => String(url).startsWith(k));
    if (!key) return { ok: false, status: 404, json: async () => ({}) };
    const body = answers.current[key];
    if (body === 'refused') return { ok: false, status: 403, json: async () => ({ error: 'no' }) };
    return { ok: true, status: 200, json: async () => body };
  }),
}));
vi.mock('../utils/approvals', () => ({
  openApprovals: vi.fn(async (path) => { opened.calls.push(path); }),
  APPROVALS_URL: '/approvals/',
}));
// The notices banner owns its own request and its own words; it is not this
// page's job to test it, and it draws nothing when there is nothing.
vi.mock('../components/AssignedNotice.jsx', () => ({ default: () => null }));

const USER = {
  id: 9, username: 'sp.tech', role: 'member',
  organization: { id: 1, name: 'DC-007' },
  tenant: { id: 32, slug: 'dc007', name: 'DC-007 Bengaluru' },
};
const user = { current: USER };
vi.mock('../AuthContext.jsx', () => ({ useAuth: () => ({ user: user.current }) }));

import HomePage, { roleOf, leadFor, greetingAt, initialsOf } from './HomePage.jsx';

const DAY = 86400000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();

const SCANS = {
  scans: [
    { rackId: 'RK-5B81BE87', timestamp: ago(2 * 3600000) },
    { rackId: 'RK-A31AE2E7', timestamp: ago(3 * DAY) },
    { rackId: 'RK-0000AAAA', timestamp: ago(9 * DAY) },
    { rackId: 'RK-0000BBBB', timestamp: ago(40 * DAY) },
    { rackId: 'RK-0000CCCC', timestamp: ago(90 * DAY) },
  ],
};

const SITES = {
  ok: true,
  preselect: 32,
  sites: [{
    id: 32, siteId: 'Site 32', name: 'DC-007 Bengaluru', rackCount: 4, hasSpoc: true,
    spaces: [],
    racks: [
      { rackId: 'RK-5B81BE87', name: 'SP-HYB-RM01-R01-R1', spaceId: 26 },
      { rackId: 'RK-A31AE2E7', name: 'SP-HYB-RM01-R01-R2', spaceId: 26 },
      // Named after its own hash, which is no name at all.
      { rackId: 'RK-0000AAAA', name: 'RK-0000AAAA', spaceId: 26 },
      { rackId: 'RK-0000BBBB', name: 'SP-HYB-RM01-R02-R1', spaceId: 26 },
    ],
  }],
};

const plan = (over) => ({
  id: 1, rackId: 'RK-5B81BE87', rackName: 'SP-HYB-RM01-R01-R1', status: 'assigned',
  summary: { decidable: 3 }, holder: null, siteName: 'DC-007 Bengaluru',
  incidentNumber: null, ...over,
});

const PLANS = {
  ok: true,
  nextCursor: null,
  plans: [
    // Newest first, as the server sends them.
    plan({ id: 140, rackId: 'RK-5B81BE87', status: 'assigned', summary: { decidable: 4 },
      holder: 'sp.tech', incidentNumber: 'INC0012345' }),
    plan({ id: 139, rackId: 'RK-A31AE2E7', rackName: 'SP-HYB-RM01-R01-R2',
      status: 'written', summary: { decidable: 2 } }),
    plan({ id: 138, rackId: 'RK-0000AAAA', rackName: 'RK-0000AAAA',
      status: 'approved', summary: { decidable: 0 } }),
    plan({ id: 137, rackId: 'RK-0000BBBB', rackName: 'SP-HYB-RM01-R02-R1',
      status: 'draft', summary: { decidable: 7 } }),
    // An older check of a rack already listed: the newest one wins, not this.
    plan({ id: 12, rackId: 'RK-5B81BE87', status: 'completed', summary: { decidable: 1 } }),
    // A second one with this person, so the "and n more" line has something.
    plan({ id: 11, rackId: 'RK-0000CCCC', rackName: null, status: 'in_progress',
      summary: { decidable: 1 }, holder: 'sp.tech', incidentNumber: 'INC0012346' }),
    plan({ id: 10, rackId: 'RK-0000CCCC', rackName: null, status: 'triage',
      summary: { decidable: 1 }, holder: 'sp.tech', incidentNumber: 'INC0012347' }),
    plan({ id: 9, rackId: 'RK-0000DDDD', rackName: null, status: 'pending',
      summary: { decidable: 1 }, holder: 'sp.tech', incidentNumber: null }),
  ],
};

const FULL = {
  '/api/scans': SCANS,
  '/api/scan-sites': SITES,
  '/api/approvals/plans': PLANS,
  '/api/approvals/dashboard': { ok: true, total: 21, open: 6 },
  '/api/approvals/me': { ok: true, can: {} },
};

function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname}</p>; }
const mount = () => render(
  <MemoryRouter initialEntries={['/']}>
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="*" element={null} />
    </Routes>
    <Where />
  </MemoryRouter>,
);

beforeEach(() => {
  answers.current = { ...FULL };
  user.current = USER;
  asked.paths.length = 0;
  opened.calls.length = 0;
});
afterEach(cleanup);

describe('<HomePage> with work behind it', () => {
  test('greets the person, names where they work, and leads with the scan card', async () => {
    mount();
    expect(screen.getByText(/^Good (morning|afternoon|evening)$/)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'sp.tech' })).toBeTruthy();
    // The organization and the Site, quietly, under the name.
    const place = screen.getByText('Technician').closest('p');
    expect(place.textContent).toContain('DC-007');
    expect(place.textContent).toContain('DC-007 Bengaluru');

    expect(screen.getByRole('heading', { level: 2, name: 'Ready to scan a rack' })).toBeTruthy();
    expect(screen.getByText(
      'One photo and RackTrack reads the rack, then checks it against your records.',
    )).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start a scan' })).toBeTruthy();
    // The greeting and the card are painted before anything has answered; let
    // the requests land so the run is not noisy about state arriving later.
    await waitFor(() => expect(screen.getByText('Racks scanned')).toBeTruthy());
  });

  test('every figure is one the server answered', async () => {
    mount();
    // Five scans, six open checks from the dashboard, and three distinct
    // incident numbers on the checks that are with this person.
    await waitFor(() => expect(screen.getByText('Racks scanned')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('Differences waiting')).toBeTruthy());

    // The figure that matters is carried inside the dark card, with the one
    // action. The other two are a pair underneath it, not in it.
    const card = screen.getByRole('heading', { name: 'Ready to scan a rack' }).closest('section');
    expect(within(card).getByText('Racks scanned')).toBeTruthy();
    expect(within(card).getByText('5')).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Start a scan' })).toBeTruthy();
    expect(within(card).queryByText('Differences waiting')).toBeNull();
    expect(within(card).queryByText('Incidents with you')).toBeNull();

    const figure = (label) => screen.getByText(label).parentElement.firstChild.textContent;
    expect(figure('Racks scanned')).toBe('5');
    expect(figure('Differences waiting')).toBe('6');
    expect(figure('Incidents with you')).toBe('3');

    // No route was invented and nothing was asked for twice.
    expect(asked.paths).toEqual([
      '/api/scan-sites',
      '/api/scans',
      '/api/approvals/plans?limit=100',
      '/api/approvals/dashboard',
      '/api/approvals/me',
    ]);
  });

  test('a figure the server cannot give is left out, not guessed', async () => {
    answers.current['/api/approvals/dashboard'] = 'refused';
    mount();
    await waitFor(() => expect(screen.getByText('Racks scanned')).toBeTruthy());
    expect(screen.queryByText('Differences waiting')).toBeNull();
  });

  test('the recent racks read by name, place and state, and open the rack', async () => {
    mount();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Your racks' })).toBeTruthy());
    const racks = within(screen.getByRole('heading', { name: 'Your racks' }).closest('section'));

    // Four rows, the newest first, each named from /api/scan-sites.
    expect(racks.getAllByRole('button').filter((b) => b.textContent !== 'See all')).toHaveLength(4);
    expect(racks.getByText('SP-HYB-RM01-R01-R1')).toBeTruthy();
    expect(racks.getByText('SP-HYB-RM01-R01-R2')).toBeTruthy();
    expect(racks.getByText('SP-HYB-RM01-R02-R1')).toBeTruthy();
    // A rack named after its own hash has no name a person can read, and the
    // hash is never printed.
    expect(racks.getByText('Rack not identified yet')).toBeTruthy();
    expect(screen.queryByText(/RK-0000AAAA/)).toBeNull();
    // The fifth scan is not on a landing screen; See all is.
    expect(screen.queryByText('RK-0000CCCC')).toBeNull();

    // The site and how long ago it was read.
    const meta = racks.getByText('SP-HYB-RM01-R01-R1').parentElement.lastChild.textContent;
    expect(meta).toContain('DC-007 Bengaluru');
    expect(meta).toContain('2h ago');

    // The states, in the words the rest of the app uses.
    expect(racks.getByText('With the SPOC')).toBeTruthy();
    expect(racks.getByText('Written')).toBeTruthy();
    expect(racks.getByText('Matches your records')).toBeTruthy();
    expect(racks.getByText('Unmatched')).toBeTruthy();
    // Told by a dot and a word rather than a boxed label, and the dot is
    // never read out.
    const dot = racks.getByText('With the SPOC').firstElementChild;
    expect(dot.tagName).toBe('SPAN');
    expect(dot.getAttribute('aria-hidden')).toBe('true');

    fireEvent.click(racks.getByText('SP-HYB-RM01-R01-R1').closest('button'));
    expect(screen.getByTestId('where').textContent).toBe('/results/RK-5B81BE87');
  });

  test('See all goes to the archive', async () => {
    mount();
    await waitFor(() => expect(screen.getByRole('button', { name: 'See all' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'See all' }));
    expect(screen.getByTestId('where').textContent).toBe('/history');
  });

  test('what is with this person names the incident and the rack, and opens the check', async () => {
    mount();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Waiting on you' })).toBeTruthy());
    // Four are held by this person, and the section says so beside its
    // heading before it names the three it has room for.
    const held = within(screen.getByRole('heading', { name: 'Waiting on you' }).closest('section'));
    expect(held.getByText('4')).toBeTruthy();
    expect(screen.getByText('INC0012345')).toBeTruthy();
    expect(screen.getByText('INC0012346')).toBeTruthy();
    expect(screen.getByText('INC0012347')).toBeTruthy();
    // Four are with this person and three are shown.
    expect(screen.getByText('and 1 more with you')).toBeTruthy();

    fireEvent.click(screen.getByText('INC0012345').closest('button'));
    expect(opened.calls).toEqual(['/approvals/drifts/140']);
  });

  test('a rack with no name says so in the waiting list too, never its hash', async () => {
    mount();
    await waitFor(() => expect(screen.getByText('INC0012346')).toBeTruthy());
    const row = screen.getByText('INC0012346').parentElement;
    expect(row.lastChild.textContent).toBe('Rack not identified yet');
    expect(screen.queryByText(/RK-0000CCCC/)).toBeNull();
  });

  test('nothing is waiting when nothing is held, and the section is gone', async () => {
    answers.current['/api/approvals/plans'] = {
      ok: true,
      plans: PLANS.plans.map((p) => ({ ...p, holder: null })),
    };
    mount();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Your racks' })).toBeTruthy());
    expect(screen.queryByRole('heading', { name: 'Waiting on you' })).toBeNull();
    expect(screen.queryByText('Incidents with you')).toBeNull();
  });

  test('a rack with no check of its own says it has not been checked', async () => {
    answers.current['/api/approvals/plans'] = { ok: true, plans: [] };
    mount();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Your racks' })).toBeTruthy());
    expect(screen.getAllByText('Not checked')).toHaveLength(4);
    expect(screen.queryByRole('heading', { name: 'Waiting on you' })).toBeNull();
  });
});

describe('<HomePage> on a new account', () => {
  beforeEach(() => {
    answers.current = {
      ...FULL,
      '/api/scans': { scans: [] },
      '/api/approvals/plans': { ok: true, plans: [] },
      '/api/approvals/dashboard': { ok: true, total: 0, open: 0 },
    };
  });

  test('the greeting, the card, and what a first scan does - never a grid of zeroes', async () => {
    mount();
    await waitFor(() => expect(
      screen.getByText('Your racks will appear here after the first scan.'),
    ).toBeTruthy());

    // What is missing, said plainly, and the three things a first scan does.
    expect(screen.getByText('No racks yet')).toBeTruthy();
    expect(screen.getByText('Take one photo of the rack.')).toBeTruthy();
    expect(screen.getByText('RackTrack reads the equipment mounted in it.')).toBeTruthy();
    expect(screen.getByText(
      'Whatever does not match your records is shown as a difference.',
    )).toBeTruthy();

    expect(screen.getByText(/^Good (morning|afternoon|evening)$/)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Ready to scan a rack' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start a scan' })).toBeTruthy();

    // No figures, no sections, no zeroes.
    expect(screen.queryByText('Racks scanned')).toBeNull();
    expect(screen.queryByText('Differences waiting')).toBeNull();
    expect(screen.queryByText('Incidents with you')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Your racks' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Waiting on you' })).toBeNull();
    expect(screen.queryByText('0')).toBeNull();

    // And the way on is still there.
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  test('a scan list that could not be loaded says so rather than claiming none', async () => {
    answers.current['/api/scans'] = 'refused';
    mount();
    await waitFor(() => expect(
      screen.getByText('Your racks could not be loaded just now'),
    ).toBeTruthy());
    expect(screen.getByText('Pull up again in a moment.')).toBeTruthy();
    expect(screen.queryByText('Racks scanned')).toBeNull();
    // A failure is not the place to teach somebody what a scan does.
    expect(screen.queryByText('Take one photo of the rack.')).toBeNull();
    expect(screen.queryByText('No racks yet')).toBeNull();
  });
});

describe('<HomePage> and the scan', () => {
  test('the card button reaches /scan', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Start a scan' }));
    expect(screen.getByTestId('where').textContent).toBe('/scan');
  });

  test('it reaches /scan from the empty state too', async () => {
    answers.current['/api/scans'] = { scans: [] };
    mount();
    await waitFor(() => expect(
      screen.getByText('Your racks will appear here after the first scan.'),
    ).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Start a scan' }));
    expect(screen.getByTestId('where').textContent).toBe('/scan');
  });
});

describe('<HomePage> words', () => {
  test('no long dash anywhere a person reads, and no internal id', async () => {
    const { container } = mount();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Your racks' })).toBeTruthy());
    const words = container.textContent;
    expect(words).not.toMatch(/[–—]/);
    expect(words).not.toMatch(/RK-[0-9A-F]{6,}/);
    expect(words).not.toMatch(/racktrack_uid|recordId|nb:device:/);
    expect(words).not.toContain('+');
  });
});

/* One home, four kinds of person. The card is the part that changes: what it
   counts, what it says about it, and where its control goes. Nothing else on
   the page moves, so the app still looks like one product to two people
   standing next to each other. */
describe('<HomePage> by role', () => {
  test('the role is what the server says this account may do, not a guess at a name', () => {
    expect(roleOf({ role: 'member' }, {}).key).toBe('tech');
    expect(roleOf({ role: 'member' }, { spoc: true }).key).toBe('spoc');
    expect(roleOf({ role: 'member' }, { admin: true }).key).toBe('admin');
    expect(roleOf({ role: 'org_admin' }, null).key).toBe('admin');
    expect(roleOf({ role: 'owner' }, null).word).toBe('Platform owner');
    // A SPOC is a SPOC whatever their role, which is the point of the work.
    expect(roleOf({ role: 'site_manager' }, { spoc: true }).word).toBe('Single point of contact');
  });

  test('a single point of contact is led to the checks that are with them', async () => {
    answers.current['/api/approvals/me'] = { ok: true, can: { spoc: true } };
    mount();
    await waitFor(() => expect(screen.getByText('Single point of contact')).toBeTruthy());
    const card = screen.getByRole('heading', { name: 'Checks are waiting for you' }).closest('section');
    // Four checks are held by sp.tech in the stub.
    expect(within(card).getByText('Checks with you')).toBeTruthy();
    expect(within(card).getByText('4')).toBeTruthy();
    // Scanning is still one tap away, whatever the card leads with.
    expect(within(card).getByRole('button', { name: 'Start a scan' })).toBeTruthy();
    // And the control opens the newest check, inside the app.
    fireEvent.click(within(card).getByRole('button', { name: 'Open the newest' }));
    expect(screen.getByTestId('where').textContent).toBe('/results/RK-5B81BE87/drift');
  });

  test('an admin is led to the checks that have nobody', async () => {
    answers.current['/api/approvals/me'] = { ok: true, can: { admin: true } };
    mount();
    await waitFor(() => expect(screen.getByText('Organization admin')).toBeTruthy());
    const card = screen.getByRole('heading', { name: 'Somebody has to say who these go to' }).closest('section');
    expect(within(card).getByText('Check with nobody yet')).toBeTruthy();
    expect(within(card).getByText('1')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Open the console' }));
    expect(screen.getByTestId('where').textContent).toBe('/dashboard');
  });

  test('with nothing waiting, each role still gets a true card', () => {
    const none = { scanned: 12, waiting: 0, triage: 0, sites: 2 };
    expect(leadFor({ role: 'admin', ...none }).title).toBe('Your estate, across 2 sites');
    expect(leadFor({ role: 'spoc', ...none }).title).toBe('Nothing is with you');
    expect(leadFor({ role: 'tech', ...none }).title).toBe('Ready to scan a rack');
    // A figure nobody has answered yet is left out rather than shown as zero.
    expect(leadFor({ role: 'tech', scanned: null }).figure).toBe(null);
    // One of a thing is one, not "1 checks".
    expect(leadFor({ role: 'spoc', scanned: 1, waiting: 1 }).label).toBe('Check with you');
    expect(leadFor({ role: 'admin', scanned: 1, triage: 2 }).label).toBe('Checks with nobody yet');
  });

  test('the greeting is true at the hour it is read, and the mark is the account letters', () => {
    expect(greetingAt(new Date('2026-09-22T08:00:00'))).toBe('Good morning');
    expect(greetingAt(new Date('2026-09-22T14:00:00'))).toBe('Good afternoon');
    expect(greetingAt(new Date('2026-09-22T20:00:00'))).toBe('Good evening');
    expect(initialsOf({ username: 'sp.tech' })).toBe('ST');
    expect(initialsOf({ username: 'owner' })).toBe('OW');
    expect(initialsOf({})).toBe('?');
  });
});
