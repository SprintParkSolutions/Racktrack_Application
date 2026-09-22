import { describe, test, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

/* Home - the app's landing screen, rebuilt on 22 September 2026.
 *
 * What is load-bearing, and so is tested here:
 *   the picture     the page leads with the person's own newest rack, and a
 *                   rack with no photograph never leaves a broken frame
 *   the role        the filled control says a different true thing to a
 *                   technician, a single point of contact and an admin
 *   the figures     every one comes from a request the server already
 *                   answers, and one that has not arrived is left out
 *   the empty state a new account gets the same block, drawn, and what the
 *                   first scan does - never a grid of zeroes
 *
 * Every request is stubbed by path, so a page that starts asking for
 * something new fails here rather than quietly showing a made-up number.
 */

const { answers, asked, opened } = vi.hoisted(() => ({
  answers: { current: {} },
  asked: { paths: [] },
  opened: { calls: [] },
}));

vi.mock('../utils/api', () => ({
  apiUrl: (p) => p,
  // What AssetImg needs to put a photograph on the screen. The token dance is
  // its own business and is tested with it, not here.
  ensureFreshAssetToken: async () => 'tok',
  assetTokenGeneration: () => 1,
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

import HomePage, {
  roleOf, actionsFor, bannerFor, waysFor,
  greetingAt, initialsOf, placeLine, stateOf,
} from './HomePage.jsx';

const DAY = 86400000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();

const SCANS = {
  scans: [
    { rackId: 'RK-5B81BE87', timestamp: ago(2 * 3600000), image: '/outputs/RK-5B81BE87/original_image.jpg' },
    { rackId: 'RK-A31AE2E7', timestamp: ago(3 * DAY), image: '/outputs/RK-A31AE2E7/original_image.jpg' },
    // A rack read before the app kept the original photograph: no picture,
    // and the row must still draw.
    { rackId: 'RK-0000AAAA', timestamp: ago(9 * DAY), image: null },
    { rackId: 'RK-0000BBBB', timestamp: ago(40 * DAY), image: null },
    { rackId: 'RK-0000CCCC', timestamp: ago(90 * DAY), image: null },
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
    // More with this person, so the "and n more" line has something.
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
  test('the line says the hour, the name, and what this person is here', async () => {
    mount();
    expect(screen.getByText(/^Good (morning|afternoon|evening)$/)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'sp.tech' })).toBeTruthy();
    expect(screen.getByText('Technician · DC-007 · DC-007 Bengaluru')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Your racks' })).toBeTruthy());
  });

  /* The main thing on the page is a design, not the person's own scan. Their
     photographs are on the racks below, where they belong. */
  test('the page leads with the drawn rack, not with somebody photograph', async () => {
    mount();
    expect(screen.getByRole('img', { name: /A rack, drawn/ })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Ready to scan a rack' })).toBeTruthy());
    expect(screen.getByText(
      'One photo and RackTrack reads the rack, then checks it against your records.',
    )).toBeTruthy();
    // And no row of counts on the way in: the owner took those off.
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Your racks' })).toBeTruthy());
    expect(screen.queryByText(/racks read/)).toBeNull();
    expect(screen.queryByText(/differences waiting/)).toBeNull();
    expect(screen.queryByText('Sites')).toBeNull();
    // No photograph is on the banner itself.
    expect(screen.queryByAltText(/as it was photographed/)).toBeNull();
  });

  test('every figure is one the server answered, and nothing is asked for twice', async () => {
    mount();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Needs you' })).toBeTruthy());
    // The one count on the page: how many checks are with this person, beside
    // the name of the list that holds them.
    const needs = within(screen.getByRole('heading', { name: 'Needs you' }).closest('section'));
    expect(needs.getByText('4')).toBeTruthy();

    // The dashboard is not asked for at all now: the figure it fed came off
    // the page with the rest of the counts.
    expect(asked.paths).toEqual([
      '/api/scan-sites',
      '/api/scans',
      '/api/approvals/plans?limit=100',
      '/api/approvals/me',
    ]);
  });

  test('a plan list the server refuses costs the page nothing', async () => {
    answers.current['/api/approvals/plans'] = 'refused';
    mount();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Your racks' })).toBeTruthy());
    expect(screen.queryByRole('heading', { name: 'Needs you' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Ready to scan a rack' })).toBeTruthy();
  });

  test('the racks are a list with the photographs in it, and they open', async () => {
    mount();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Your racks' })).toBeTruthy());
    const racks = within(screen.getByRole('heading', { name: 'Your racks' }).closest('section'));

    // Three rows, the newest first, each named from /api/scan-sites.
    expect(racks.getAllByRole('button').filter((b) => b.textContent !== 'See all')).toHaveLength(3);
    expect(racks.getByText('SP-HYB-RM01-R01-R2')).toBeTruthy();
    // A rack named after its own hash has no name a person can read, and the
    // hash is never printed.
    expect(racks.getByText('Rack not identified yet')).toBeTruthy();
    expect(screen.queryByText(/RK-0000AAAA/)).toBeNull();
    // The fifth scan is not on a landing screen; See all is.
    expect(screen.queryByText('RK-0000CCCC')).toBeNull();

    // The photographs are here, on the racks they belong to: two of the four
    // rows in the stub have one, and the other two draw a mark instead.
    expect(racks.getAllByRole('presentation').length).toBe(2);

    // The states, in the words the rest of the app uses.
    expect(racks.getByText('Written')).toBeTruthy();
    expect(racks.getByText('Matches your records')).toBeTruthy();

    fireEvent.click(racks.getByText('SP-HYB-RM01-R01-R2').closest('button'));
    expect(screen.getByTestId('where').textContent).toBe('/results/RK-A31AE2E7');
  });

  test('See all goes to the archive', async () => {
    mount();
    await waitFor(() => expect(screen.getByRole('button', { name: 'See all' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'See all' }));
    expect(screen.getByTestId('where').textContent).toBe('/history');
  });

  test('what needs this person names the incident and the rack, and opens the check', async () => {
    mount();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Needs you' })).toBeTruthy());
    expect(screen.getByText('INC0012345')).toBeTruthy();
    expect(screen.getByText('INC0012346')).toBeTruthy();
    expect(screen.getByText('INC0012347')).toBeTruthy();
    // Four are with this person and three are shown.
    expect(screen.getByText('and 1 more with you')).toBeTruthy();

    fireEvent.click(screen.getByText('INC0012345').closest('button'));
    expect(opened.calls).toEqual(['/approvals/drifts/140']);
  });

  test('a rack with no name says so in the needs list too, never its hash', async () => {
    mount();
    await waitFor(() => expect(screen.getByText('INC0012346')).toBeTruthy());
    const row = screen.getByText('INC0012346').parentElement;
    expect(row.lastChild.textContent).toBe('Rack not identified yet');
    expect(screen.queryByText(/RK-0000CCCC/)).toBeNull();
  });

  test('nothing needs this person when nothing is held, and the section is gone', async () => {
    answers.current['/api/approvals/plans'] = {
      ok: true,
      plans: PLANS.plans.map((p) => ({ ...p, holder: null })),
    };
    mount();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Your racks' })).toBeTruthy());
    expect(screen.queryByRole('heading', { name: 'Needs you' })).toBeNull();
  });

  test('a rack with no check of its own says it has not been checked', async () => {
    answers.current['/api/approvals/plans'] = { ok: true, plans: [] };
    mount();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Your racks' })).toBeTruthy());
    expect(screen.getAllByText('Not checked')).toHaveLength(3);
    expect(screen.queryByRole('heading', { name: 'Needs you' })).toBeNull();
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

  test('the same banner, and what a first scan does - never a grid of zeroes', async () => {
    mount();
    await waitFor(() => expect(
      screen.getByRole('heading', { name: 'Scan your first rack' }),
    ).toBeTruthy());

    expect(screen.getByText('Take one photo of the rack.')).toBeTruthy();
    expect(screen.getByText('RackTrack reads the equipment mounted in it.')).toBeTruthy();
    expect(screen.getByText(
      'Whatever does not match your records is shown as a difference.',
    )).toBeTruthy();

    expect(screen.getByText(/^Good (morning|afternoon|evening)$/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Scan a rack/ })).toBeTruthy();

    // No sections and no zeroes.
    expect(screen.queryByRole('heading', { name: 'Your racks' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Needs you' })).toBeNull();
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.queryByText(/differences waiting/)).toBeNull();

    // One thing to do, and the four ways on. Nothing else to press, and no
    // list of racks that do not exist yet.
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Scan a rack', 'Port history', 'Switches', 'How it works', 'Your account',
    ]);
  });

  test('a scan list that could not be loaded says so rather than claiming none', async () => {
    answers.current['/api/scans'] = 'refused';
    mount();
    await waitFor(() => expect(
      screen.getByRole('heading', { name: 'Your racks could not be loaded just now' }),
    ).toBeTruthy());
    expect(screen.getByText('Pull up again in a moment.')).toBeTruthy();
    expect(screen.queryByText('Take one photo of the rack.')).toBeNull();
  });
});

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

  test('a technician is told to scan, and nothing else', async () => {
    mount();
    const go = await screen.findByRole('button', { name: /Scan a rack/ });
    expect(screen.queryByRole('button', { name: 'Open this rack' })).toBeNull();
    fireEvent.click(go);
    expect(screen.getByTestId('where').textContent).toBe('/scan');
  });

  /* The banner says a different true thing to each person, and says nothing
     the server has not answered. */
  test('the banner is the role, in words', () => {
    expect(bannerFor({ role: 'admin', triage: 2, racks: 4 }).title).toBe('2 checks have nobody');
    expect(bannerFor({ role: 'admin', triage: 0, racks: 4 }).title).toBe('Your estate is covered');
    // And no button anywhere in it that opens a console.
    expect(bannerFor({ role: 'spoc', waiting: 1, racks: 4 }).title).toBe('A check is waiting for you');
    expect(bannerFor({ role: 'tech', racks: 4 }).title).toBe('Ready to scan a rack');
    expect(bannerFor({ role: 'tech', racks: 0 }).steps).toHaveLength(3);
    expect(bannerFor({ role: 'tech', racks: 4 }).steps).toEqual([]);
    expect(bannerFor({ role: 'tech', failed: true }).title)
      .toBe('Your racks could not be loaded just now');
    // Nothing has answered yet: no figure, and no claim that there are none.
    expect(bannerFor({ role: 'tech', racks: 0, loading: true }).title).toBe('Ready to scan a rack');
  });

  test('a single point of contact is sent to the checks that are with them', async () => {
    answers.current['/api/approvals/me'] = { ok: true, can: { spoc: true } };
    mount();
    await waitFor(() => expect(screen.getByText(/^Single point of contact/)).toBeTruthy());
    // Four checks are held by sp.tech in the stub, and scanning stays beside it.
    expect(screen.getByRole('button', { name: 'Scan a rack' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Read 4 checks waiting for you/ }));
    expect(screen.getByTestId('where').textContent).toBe('/results/RK-5B81BE87/drift');
  });

  test('an admin is told what has nobody, and is still sent to scan', async () => {
    answers.current['/api/approvals/me'] = { ok: true, can: { admin: true } };
    mount();
    await waitFor(() => expect(screen.getByText(/^Organization admin/)).toBeTruthy());
    // One check is in triage in the stub, and the banner says so in words.
    expect(screen.getByRole('heading', { name: 'One check has nobody' })).toBeTruthy();
    // No console button on the way in: the owner took it off.
    expect(screen.queryByRole('button', { name: /console/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Scan a rack/ }));
    expect(screen.getByTestId('where').textContent).toBe('/scan');
  });

  test('scanning is the one control for everybody who is not holding checks', () => {
    for (const role of ['admin', 'spoc', 'tech', 'manager']) {
      expect(actionsFor({ role, waiting: 0 }).lead.text).toBe('Scan a rack');
      expect(actionsFor({ role, waiting: 0 }).alt).toBe(null);
    }
    // Somebody holding checks is told to read them: that is work only they
    // can do, and scanning moves beside it.
    expect(actionsFor({ role: 'spoc', waiting: 1, newest: 'RK-1' }).lead.text)
      .toBe('Read the check waiting for you');
    expect(actionsFor({ role: 'spoc', waiting: 4, newest: 'RK-1' }).alt.text).toBe('Scan a rack');
  });

  test('the greeting is true at the hour it is read, and the mark is the account letters', () => {
    expect(greetingAt(new Date('2026-09-22T08:00:00'))).toBe('Good morning');
    expect(greetingAt(new Date('2026-09-22T14:00:00'))).toBe('Good afternoon');
    expect(greetingAt(new Date('2026-09-22T20:00:00'))).toBe('Good evening');
    expect(initialsOf({ username: 'sp.tech' })).toBe('ST');
    expect(initialsOf({ username: 'owner' })).toBe('OW');
    expect(initialsOf({})).toBe('?');
  });

  test('the place line leaves out what the account does not have', () => {
    expect(placeLine({ word: 'Technician' }, null, null)).toBe('Technician');
    expect(placeLine({ word: 'Technician' }, 'DC-007', null)).toBe('Technician · DC-007');
  });

  test('a rack state is the words the rest of the app uses', () => {
    expect(stateOf(null).label).toBe('Not checked');
    expect(stateOf({ status: 'written' }).label).toBe('Written');
    expect(stateOf({ status: 'assigned', summary: { decidable: 0 } }).label).toBe('Matches your records');
    expect(stateOf({ status: 'draft', summary: { decidable: 2 } }).label).toBe('Unmatched');
    expect(stateOf({ status: 'assigned', summary: { decidable: 2 } }).label).toBe('With the SPOC');
  });
});

/* A landing screen that only lists what this person photographed says nothing
   about the work. These are the parts that answer "how do things stand" and
   "what else can I do". */
describe('<HomePage> beyond the racks', () => {
  test('no row of counts on the way in', async () => {
    mount();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Your racks' })).toBeTruthy());
    for (const word of ['Sites', 'Site', 'Racks read', 'Rack read', 'Differences waiting']) {
      expect(screen.queryByText(word)).toBeNull();
    }
  });

  test('the ways on repeat nothing the bar or the page already offers', () => {
    expect(waysFor('tech').map((w) => w.to))
      .toEqual(['/port-history', '/switch-info', '/help', '/profile']);
    expect(waysFor('admin').map((w) => w.to))
      .toEqual(['/port-history', '/switch-info', '/organizations', '/profile']);
    for (const role of ['tech', 'admin']) {
      expect(waysFor(role).map((w) => w.to)).not.toContain('/scan');
    }
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
