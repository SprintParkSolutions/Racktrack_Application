import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

/* The old in-app approvals paths land here. The page says where approvals went
   and offers one way on. Wherever it is pressed, the link goes through the
   sign-in hand-over first, so nobody is asked to sign in again a minute after
   signing in: the server trades this app's credential for a single-use key and
   that key's address is opened. On the phone it opens in our own full-screen
   web view; on the web, a new tab. */

const { native, open, site, fetched } = vi.hoisted(() => ({
  native: { current: false },
  open: vi.fn(async () => {}),
  site: { open: vi.fn(async () => {}), fails: { current: false } },
  fetched: { calls: [] },
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native.current },
  registerPlugin: () => ({
    open: (o) => (site.fails.current ? Promise.reject(new Error('not implemented')) : site.open(o)),
  }),
}));
vi.mock('@capacitor/browser', () => ({ Browser: { open } }));
vi.mock('../utils/api', () => ({
  apiUrl: (p) => p,
  authFetch: vi.fn(async (url, opts) => {
    fetched.calls.push({ url, body: JSON.parse(opts?.body || '{}') });
    return { ok: true, json: async () => ({ url: '/api/auth/handoff/KEY' }) };
  }),
}));
const openedWindows = [];
window.open = (url) => { openedWindows.push(url); return null; };

import ApprovalsMovedPage from './ApprovalsMovedPage.jsx';

const URL = '/approvals/';

afterEach(() => {
  cleanup(); open.mockClear(); site.open.mockClear(); native.current = false;
  site.fails.current = false; fetched.calls.length = 0; openedWindows.length = 0;
});
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('<ApprovalsMovedPage>', () => {
  test('says approvals has moved and offers exactly one way on', () => {
    render(<ApprovalsMovedPage />);
    expect(screen.getByRole('heading', { name: 'This has moved to RackTrack Drift Desk' })).toBeTruthy();
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0].textContent.trim()).toBe('Open Drift Desk');
    expect(links[0].getAttribute('href')).toBe(URL);
    expect(links[0].getAttribute('target')).toBe('_blank');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  test('web build: the hand-over is fetched and its address opens in a tab', async () => {
    render(<ApprovalsMovedPage />);
    fireEvent.click(screen.getByRole('link', { name: 'Open Drift Desk' }));
    await settle();
    expect(fetched.calls).toHaveLength(1);
    expect(fetched.calls[0].url).toBe('/api/auth/handoff');
    // The hand-over carries `in=app`, which tells the Desk it was opened from
    // inside the application and to write its name once rather than twice.
    expect(fetched.calls[0].body).toEqual({ to: `${URL}?in=app` });
    expect(openedWindows).toEqual(['/api/auth/handoff/KEY']);
    expect(open).not.toHaveBeenCalled();
    expect(site.open).not.toHaveBeenCalled();
  });

  test('native build: the hand-over address opens in our own web view, no browser', async () => {
    native.current = true;
    render(<ApprovalsMovedPage />);
    fireEvent.click(screen.getByRole('link', { name: 'Open Drift Desk' }));
    await settle();
    // The hand-over carries `in=app`, which tells the Desk it was opened from
    // inside the application and to write its name once rather than twice.
    expect(fetched.calls[0].body).toEqual({ to: `${URL}?in=app` });
    // Our view: the page's name, a Close button, and no address anywhere. The
    // paths that close it are the ones that mean "take me back to RackTrack".
    expect(site.open).toHaveBeenCalledWith({
      url: '/api/auth/handoff/KEY',
      title: 'RackTrack Drift Desk',
      closeOn: ['/', '/login'],
    });
    expect(open).not.toHaveBeenCalled();
  });

  test('native build without that view: the browser still opens the page', async () => {
    native.current = true;
    site.fails.current = true;
    render(<ApprovalsMovedPage />);
    fireEvent.click(screen.getByRole('link', { name: 'Open Drift Desk' }));
    await settle();
    expect(open).toHaveBeenCalledWith({
      url: '/api/auth/handoff/KEY',
      presentationStyle: 'fullscreen',
      toolbarColor: '#ffffff',
    });
  });
});
