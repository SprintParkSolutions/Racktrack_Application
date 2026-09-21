import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/* Scan two racks uploads scans too, so the site a scan is for goes with them
   the same way it does from the scan page: the same picker, the same
   remembered choice, and nothing sent to a server that has no site list. */

const { routes, posts } = vi.hoisted(() => ({ routes: { current: {} }, posts: [] }));
vi.mock('../utils/api', () => ({
  apiUrl: (p) => p,
  authFetch: vi.fn(async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    if (method === 'POST') posts.push({ url, body: init.body });
    let h = routes.current[`${method} ${url}`];
    if (typeof h === 'function') h = h();
    if (!h) return { ok: false, status: 404, json: async () => ({ error: `no stub for ${method} ${url}` }) };
    const status = h.status || 200;
    return { ok: status < 400, status, json: async () => h.body };
  }),
}));
vi.mock('../AuthContext.jsx', () => ({ useAuth: () => ({ user: { id: 935, tenant_id: null, role: 'org_admin' } }) }));
// The photo checks need a real decoder; what is under test is where it goes.
vi.mock('../utils/validateMedia', () => ({ validateMedia: async () => ({ ok: true }) }));

import MultiRackNewPage from './MultiRackNewPage.jsx';

// The site is a dropdown, the only picker on the page.
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
  let n = 0;
  routes.current = {
    ...(scanSites ? { 'GET /api/scan-sites': scanSites } : {}),
    // Two different racks, in the order they were sent.
    'POST /api/analyze': () => ({ body: { rackId: `RK-${++n}` } }),
    'POST /api/rack-groups': { body: { groupId: 'G1' } },
    'POST /api/analyze-video': { body: { groupId: 'G1', count: 2, racks: [{ rackId: 'RK-1' }, { rackId: 'RK-2' }] } },
    ...extra,
  };
}
const mount = () => render(<MemoryRouter><MultiRackNewPage /></MemoryRouter>);
const photo = (name) => new File(['x'], name, { type: 'image/jpeg' });
const clip = () => new File(['x'], 'racks.mp4', { type: 'video/mp4' });
const inputs = () => [...document.querySelectorAll('input[type="file"]')];
const build = () => screen.getByRole('button', { name: 'Build combined view' });
const allSent = (url) => posts.filter((p) => p.url === url).map((p) => p.body);
async function addBothPhotos() {
  fireEvent.change(inputs()[0], { target: { files: [photo('a.jpg')] } });
  await screen.findByAltText('Rack 1');
  fireEvent.change(inputs()[1], { target: { files: [photo('b.jpg')] } });
  await screen.findByAltText('Rack 2');
}

beforeEach(() => {
  posts.length = 0;
  window.localStorage.clear();
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

describe('<MultiRackNewPage> site', () => {
  test('several sites: the build waits for a choice, and the choice goes with both photos', async () => {
    stub({ body: { ok: true, preselect: null, sites: [OFFICE, HARBOUR] } });
    mount();
    await screen.findByLabelText(/^Site/);
    await addBothPhotos();
    expect(build().disabled).toBe(true);
    expect(screen.getByText('Choose the site first.')).toBeTruthy();

    chooseSite(32);
    expect(screen.queryByText('Choose the site first.')).toBeNull();
    // One remembered choice for both scan screens.
    expect(window.localStorage.getItem('rt.scan.site.935')).toBe('32');

    fireEvent.click(build());
    await waitFor(() => expect(allSent('/api/analyze')).toHaveLength(2));
    expect(allSent('/api/analyze').map((b) => b.get('siteId'))).toEqual(['32', '32']);
  });

  test('the site chosen on the scan page is the one used here, and it goes with a video', async () => {
    window.localStorage.setItem('rt.scan.site.935', '7');
    stub({ body: { ok: true, preselect: 32, sites: [OFFICE, HARBOUR] } });
    mount();
    await siteIs(7);
    fireEvent.click(screen.getByRole('button', { name: 'One video' }));
    fireEvent.change(inputs()[0], { target: { files: [clip()] } });
    await waitFor(() => expect(build().disabled).toBe(false));
    fireEvent.click(build());
    await waitFor(() => expect(allSent('/api/analyze-video')).toHaveLength(1));
    expect(allSent('/api/analyze-video')[0].get('siteId')).toBe('7');
  });

  test('a server without the site list gets the pair it always got', async () => {
    stub(null);
    mount();
    await addBothPhotos();
    expect(screen.queryByText('Site')).toBeNull();
    await waitFor(() => expect(build().disabled).toBe(false));
    fireEvent.click(build());
    await waitFor(() => expect(allSent('/api/analyze')).toHaveLength(2));
    for (const body of allSent('/api/analyze')) expect(body.has('siteId')).toBe(false);
  });

  test('a site the server refuses is said in words a person can act on', async () => {
    stub({ body: { ok: true, preselect: 32, sites: [OFFICE, HARBOUR] } },
      { 'POST /api/analyze': { status: 404, body: { error: 'Site not found' } } });
    mount();
    await siteIs(32);
    await addBothPhotos();
    fireEvent.click(build());
    await screen.findByText('That site is not one you can scan for. Choose another.');
    expect(screen.queryByText('Site not found')).toBeNull();
  });
});
