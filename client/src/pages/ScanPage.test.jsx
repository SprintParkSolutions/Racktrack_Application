import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/* The scan screen and the site a scan is for: the choice goes with every
   upload, the phone is never asked where it is, and a server that has no site
   list yet gets the scan it always got. */

const { routes, posts, tour } = vi.hoisted(() => ({ routes: { current: {} }, posts: [], tour: { current: null } }));
vi.mock('../utils/api', () => ({
  apiUrl: (p) => p,
  authFetch: vi.fn(async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    if (method === 'POST') posts.push({ url, body: init.body });
    const h = routes.current[`${method} ${url}`];
    if (!h) return { ok: false, status: 404, json: async () => ({ error: `no stub for ${method} ${url}` }) };
    const status = h.status || 200;
    return { ok: status < 400, status, json: async () => h.body };
  }),
}));
vi.mock('../AuthContext.jsx', () => ({ useAuth: () => ({ user: { id: 935, tenant_id: 32, role: 'member' } }) }));
vi.mock('../TourContext.jsx', () => ({ useTour: () => tour.current }));
vi.mock('../components/AssignedNotice.jsx', () => ({ default: () => null }));
vi.mock('../hooks/useIsDesktop', () => ({ useIsDesktop: () => false, useHasSidebar: () => false }));
// The photo checks need a real decoder; what is under test is where it goes.
vi.mock('../utils/validateMedia', () => ({ validateMedia: async () => ({ ok: true }) }));
vi.mock('../utils/scanPrefetch', () => ({ prefetchScan: () => {} }));

import ScanPage from './ScanPage.jsx';
import { TOUR_STEPS } from '../tourSteps.js';

// The site is a dropdown, the only picker on the scan page.
const sitePick = () => screen.getByLabelText(/^Site/);
const siteIs = (id) => waitFor(() => expect(sitePick().value).toBe(String(id)));
const chooseSite = (id) => fireEvent.change(sitePick(), { target: { value: String(id) } });

const OFFICE = {
  id: 32, siteId: 'Site 32', name: 'Office-Sprintpark', rackCount: 1,
  racks: [{ rackId: 'RK-5B81BE87', name: 'SP-HYB-RM01-R01-R1', spaceId: 26 }],
  spaces: [{ id: 26, name: 'RM01', depth: 0 }], hasSpoc: true,
};
const HARBOUR = { id: 7, siteId: 'Site 7', name: 'Harbour DC', rackCount: 0, racks: [], spaces: [], hasSpoc: false };

function stub(scanSites, extra = {}) {
  routes.current = {
    ...(scanSites ? { 'GET /api/scan-sites': scanSites } : {}),
    'POST /api/analyze': { body: { rackId: 'RK-1' } },
    'POST /api/stitch': { body: { rackId: 'RK-1' } },
    ...extra,
  };
}
const mount = () => render(<MemoryRouter><ScanPage /></MemoryRouter>);
const photo = (name = 'rack.jpg') => new File(['x'], name, { type: 'image/jpeg' });
const fileInput = () => document.querySelector('input[type="file"]');
const addPhoto = () => fireEvent.change(fileInput(), { target: { files: [photo()] } });
const analyzeButton = () => screen.getByRole('button', { name: /Analyze Rack/i });
const sent = (url) => posts.find((p) => p.url === url)?.body;
const NO_POSITION = ['lat', 'lng', 'accuracy', 'locatedAt', 'here'];

let geo;
beforeEach(() => {
  posts.length = 0;
  tour.current = null;
  window.localStorage.clear();
  // The first-scan sheet is a modal over the page; this device has seen it.
  window.localStorage.setItem('racktrack.scan.tipsSeen', '1');
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
  geo = { getCurrentPosition: vi.fn(), watchPosition: vi.fn() };
  Object.defineProperty(window.navigator, 'geolocation', { value: geo, configurable: true });
});
afterEach(cleanup);

describe('<ScanPage> site', () => {
  test('a technician with one site sees it already chosen in the dropdown, and it goes with the photo', async () => {
    stub({ body: { ok: true, preselect: 32, sites: [OFFICE] } });
    // Something left behind by an older choice does not outrank the only site.
    window.localStorage.setItem('rt.scan.site.935', '7');
    mount();
    await siteIs(32);
    expect([...sitePick().options].map((o) => o.textContent)).toEqual(['Site 32 - Office-Sprintpark']);
    // Site is enough: the page has no Space control, and none goes with the photo.
    expect(screen.queryByLabelText('Space')).toBeNull();

    addPhoto();
    await waitFor(() => expect(analyzeButton().disabled).toBe(false));
    fireEvent.click(analyzeButton());
    await waitFor(() => expect(sent('/api/analyze')).toBeTruthy());
    expect(sent('/api/analyze').get('siteId')).toBe('32');
    expect(sent('/api/analyze').has('spaceId')).toBe(false);
  });

  test('several sites: Analyze waits for a choice, the choice is made in the dropdown, sent and remembered', async () => {
    stub({ body: { ok: true, preselect: null, sites: [OFFICE, HARBOUR] } });
    mount();
    await screen.findByLabelText(/^Site/);
    addPhoto();
    expect(analyzeButton().disabled).toBe(true);
    expect(screen.getByText('Choose the site first.')).toBeTruthy();

    chooseSite(7);
    expect(screen.queryByText('Choose the site first.')).toBeNull();
    expect(window.localStorage.getItem('rt.scan.site.935')).toBe('7');

    await waitFor(() => expect(analyzeButton().disabled).toBe(false));
    fireEvent.click(analyzeButton());
    await waitFor(() => expect(sent('/api/analyze')).toBeTruthy());
    expect(sent('/api/analyze').get('siteId')).toBe('7');
  });

  test('the remembered site is used while it is still on the list, else the one the server suggests', async () => {
    window.localStorage.setItem('rt.scan.site.935', '7');
    stub({ body: { ok: true, preselect: 32, sites: [OFFICE, HARBOUR] } });
    mount();
    await siteIs(7);
    cleanup();

    window.localStorage.setItem('rt.scan.site.935', '999');
    mount();
    await siteIs(32);
    expect(sitePick().value).toBe('32');
  });

  test('a tall rack set carries the site too', async () => {
    stub({ body: { ok: true, preselect: 32, sites: [OFFICE, HARBOUR] } });
    mount();
    await siteIs(32);
    fireEvent.click(screen.getByRole('button', { name: 'MULTI' }));
    fireEvent.change(fileInput(), { target: { files: [photo('top.jpg'), photo('bottom.jpg')] } });
    fireEvent.click(await screen.findByRole('button', { name: /Stitch & Analyze \(2\)/i }));
    await waitFor(() => expect(sent('/api/stitch')).toBeTruthy());
    expect(sent('/api/stitch').get('siteId')).toBe('32');
    expect(sent('/api/stitch').getAll('images')).toHaveLength(2);
  });

  test('a server without the site list: no picker, and the scan goes as it always did', async () => {
    stub(null);
    mount();
    addPhoto();
    await waitFor(() => expect(analyzeButton().disabled).toBe(false));
    expect(screen.queryByText(/^Site/)).toBeNull();
    expect(screen.queryByLabelText('Space')).toBeNull();
    expect(screen.queryByText('Choose the site first.')).toBeNull();
    fireEvent.click(analyzeButton());
    await waitFor(() => expect(sent('/api/analyze')).toBeTruthy());
    expect(sent('/api/analyze').has('siteId')).toBe(false);
    expect(sent('/api/analyze').get('image')).toBeTruthy();
  });

  test('an empty list is the same as no list', async () => {
    stub({ body: { ok: true, preselect: null, sites: [] } });
    mount();
    addPhoto();
    await waitFor(() => expect(analyzeButton().disabled).toBe(false));
    expect(screen.queryByText(/^Site/)).toBeNull();
  });

  test('the phone is never asked where it is, sends no position and shows no coordinates', async () => {
    stub({ body: { ok: true, preselect: 32, sites: [OFFICE] } });
    mount();
    await siteIs(32);
    addPhoto();
    await waitFor(() => expect(analyzeButton().disabled).toBe(false));
    fireEvent.click(analyzeButton());
    await waitFor(() => expect(sent('/api/analyze')).toBeTruthy());
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
    expect(geo.watchPosition).not.toHaveBeenCalled();
    for (const k of NO_POSITION) expect(sent('/api/analyze').has(k)).toBe(false);
    expect(document.body.textContent).not.toMatch(/latitude|longitude|coordinates|\d+\.\d{3,}\s*,\s*-?\d+\.\d{3,}/i);
  });

  test('the guided tour asks for the site first, and a tap on the picker chooses it', async () => {
    // The tour dims the page and waits for Analyze to come alive, which it
    // cannot while no site is chosen. So the picker is the tour's own first
    // step: it is the anchor, not a way out, and the page says when it is done.
    const stopTour = vi.fn();
    tour.current = { active: true, currentStep: TOUR_STEPS[0], stopTour, setSuspended: () => {} };
    stub({ body: { ok: true, preselect: null, sites: [OFFICE, HARBOUR] } });
    mount();
    await screen.findByLabelText(/^Site/);
    const block = () => document.querySelector(`[data-tour="${TOUR_STEPS[0].target}"]`);
    const settled = () => document.querySelector(TOUR_STEPS[0].advanceWhenVisible);
    expect(block()).toBeTruthy();
    expect(block().hasAttribute('data-tour-bypass')).toBe(false);
    expect(settled()).toBeNull();
    chooseSite(7);
    expect(settled()).toBeTruthy();
    // Still the anchor for the beat before the tour moves on.
    expect(block().textContent).toContain('Site 7 - Harbour DC');
    expect(stopTour).not.toHaveBeenCalled();
  });

  test('the tour passes the site step for a person with nothing to choose', async () => {
    tour.current = { active: true, currentStep: TOUR_STEPS[0], stopTour: () => {}, setSuspended: () => {} };
    stub({ body: { ok: true, preselect: 32, sites: [OFFICE] } });
    const first = mount();
    await siteIs(32);
    expect(document.querySelector('[data-tour="site-picker"]')).toBeNull();
    expect(document.querySelector(TOUR_STEPS[0].advanceWhenVisible)).toBeTruthy();
    first.unmount();

    // A server without the site list: nothing to wait for once it has answered.
    stub(null);
    mount();
    await waitFor(() => expect(document.querySelector(TOUR_STEPS[0].advanceWhenVisible)).toBeTruthy());
    expect(document.querySelector('[data-tour="site-picker"]')).toBeNull();
  });

  test('somebody who skipped the site step can still leave the tour through the picker', async () => {
    tour.current = { active: true, currentStep: TOUR_STEPS[1], stopTour: () => {}, setSuspended: () => {} };
    stub({ body: { ok: true, preselect: null, sites: [OFFICE, HARBOUR] } });
    mount();
    await screen.findByLabelText(/^Site/);
    const block = () => document.querySelector('[data-tour="site-picker"]');
    expect(block().getAttribute('data-tour-bypass')).toBe('true');
    chooseSite(7);
    expect(block().hasAttribute('data-tour-bypass')).toBe(false);
  });

  test('a site the server refuses is said in words a person can act on', async () => {
    stub({ body: { ok: true, preselect: 32, sites: [OFFICE, HARBOUR] } },
      { 'POST /api/analyze': { status: 404, body: { error: 'Site not found' } } });
    mount();
    await siteIs(32);
    addPhoto();
    await waitFor(() => expect(analyzeButton().disabled).toBe(false));
    fireEvent.click(analyzeButton());
    await screen.findByText('That site is not one you can scan for. Choose another.');
    expect(sitePick().value).toBe('32');
  });
});
