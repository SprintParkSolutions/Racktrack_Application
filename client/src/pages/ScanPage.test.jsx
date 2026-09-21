import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/* The scan screen and the site a scan is for: the choice goes with every
   upload, the phone is never asked where it is, and a server that has no site
   list yet gets the scan it always got. */

const { routes, posts } = vi.hoisted(() => ({ routes: { current: {} }, posts: [] }));
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
vi.mock('../components/AssignedNotice.jsx', () => ({ default: () => null }));
vi.mock('../hooks/useIsDesktop', () => ({ useIsDesktop: () => false, useHasSidebar: () => false }));
// The photo checks need a real decoder; what is under test is where it goes.
vi.mock('../utils/validateMedia', () => ({ validateMedia: async () => ({ ok: true }) }));
vi.mock('../utils/scanPrefetch', () => ({ prefetchScan: () => {} }));

import ScanPage from './ScanPage.jsx';

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
  test('a technician with one site sees it stated, cannot change it, and it goes with the photo', async () => {
    stub({ body: { ok: true, preselect: 32, sites: [OFFICE] } });
    // Something left behind by an older choice does not outrank the only site.
    window.localStorage.setItem('rt.scan.site.935', '7');
    mount();
    await screen.findByText('Site 32 - Office-Sprintpark - 1 rack');
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull();
    // The spaces are the chosen site's own.
    expect(screen.getByLabelText('Space').textContent).toContain('RM01');

    addPhoto();
    await waitFor(() => expect(analyzeButton().disabled).toBe(false));
    fireEvent.click(analyzeButton());
    await waitFor(() => expect(sent('/api/analyze')).toBeTruthy());
    expect(sent('/api/analyze').get('siteId')).toBe('32');
  });

  test('several sites: Analyze waits for a choice, the choice is searchable, sent and remembered', async () => {
    stub({ body: { ok: true, preselect: null, sites: [OFFICE, HARBOUR] } });
    mount();
    const box = await screen.findByPlaceholderText('Search by site number or name');
    addPhoto();
    expect(analyzeButton().disabled).toBe(true);
    expect(screen.getByText('Choose the site first.')).toBeTruthy();

    fireEvent.change(box, { target: { value: 'harb' } });
    expect(screen.queryByRole('button', { name: /Office-Sprintpark/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Site 7 - Harbour DC/ }));
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
    await screen.findByText('Site 7 - Harbour DC');
    cleanup();

    window.localStorage.setItem('rt.scan.site.935', '999');
    mount();
    await screen.findByText('Site 32 - Office-Sprintpark');
    expect(screen.getByRole('button', { name: 'Change' })).toBeTruthy();
  });

  test('a tall rack set carries the site too', async () => {
    stub({ body: { ok: true, preselect: 32, sites: [OFFICE, HARBOUR] } });
    mount();
    await screen.findByText('Site 32 - Office-Sprintpark');
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
    await screen.findByText('Site 32 - Office-Sprintpark - 1 rack');
    addPhoto();
    await waitFor(() => expect(analyzeButton().disabled).toBe(false));
    fireEvent.click(analyzeButton());
    await waitFor(() => expect(sent('/api/analyze')).toBeTruthy());
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
    expect(geo.watchPosition).not.toHaveBeenCalled();
    for (const k of NO_POSITION) expect(sent('/api/analyze').has(k)).toBe(false);
    expect(document.body.textContent).not.toMatch(/latitude|longitude|coordinates|\d+\.\d{3,}\s*,\s*-?\d+\.\d{3,}/i);
  });

  test('a site the server refuses is said in words a person can act on', async () => {
    stub({ body: { ok: true, preselect: 32, sites: [OFFICE, HARBOUR] } },
      { 'POST /api/analyze': { status: 404, body: { error: 'Site not found' } } });
    mount();
    await screen.findByText('Site 32 - Office-Sprintpark');
    addPhoto();
    await waitFor(() => expect(analyzeButton().disabled).toBe(false));
    fireEvent.click(analyzeButton());
    await screen.findByText('That site is not one you can scan for. Choose another.');
    expect(screen.getByRole('button', { name: 'Change' })).toBeTruthy();
  });
});
