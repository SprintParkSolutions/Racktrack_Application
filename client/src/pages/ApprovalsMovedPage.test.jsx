import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

/* The old in-app approvals paths land here. The page says where approvals went
   and offers one way on. Wherever it is pressed, the link goes through the
   sign-in hand-over first, so nobody is asked to sign in again a minute after
   signing in: the server trades this app's credential for a single-use key and
   the browser opens that. On the phone the system browser opens it; on the web
   a new tab. */

const { native, open, fetched } = vi.hoisted(() => ({
  native: { current: false },
  open: vi.fn(async () => {}),
  fetched: { calls: [] },
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.current } }));
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
  cleanup(); open.mockClear(); native.current = false;
  fetched.calls.length = 0; openedWindows.length = 0;
});
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('<ApprovalsMovedPage>', () => {
  test('says approvals has moved and offers exactly one way on', () => {
    render(<ApprovalsMovedPage />);
    expect(screen.getByRole('heading', { name: 'Approvals has moved' })).toBeTruthy();
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0].textContent.trim()).toBe('Open Approvals');
    expect(links[0].getAttribute('href')).toBe(URL);
    expect(links[0].getAttribute('target')).toBe('_blank');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  test('web build: the hand-over is fetched and its address opens in a tab', async () => {
    render(<ApprovalsMovedPage />);
    fireEvent.click(screen.getByRole('link', { name: 'Open Approvals' }));
    await settle();
    expect(fetched.calls).toHaveLength(1);
    expect(fetched.calls[0].url).toBe('/api/auth/handoff');
    expect(fetched.calls[0].body).toEqual({ to: URL });
    expect(openedWindows).toEqual(['/api/auth/handoff/KEY']);
    expect(open).not.toHaveBeenCalled();
  });

  test('native build: the hand-over address opens full screen inside the app', async () => {
    native.current = true;
    render(<ApprovalsMovedPage />);
    fireEvent.click(screen.getByRole('link', { name: 'Open Approvals' }));
    await settle();
    expect(fetched.calls[0].body).toEqual({ to: URL });
    // Full screen in the application's own white, so Approvals reads as part
    // of RackTrack rather than a trip out to a website.
    expect(open).toHaveBeenCalledWith({
      url: '/api/auth/handoff/KEY',
      presentationStyle: 'fullscreen',
      toolbarColor: '#ffffff',
    });
  });
});
