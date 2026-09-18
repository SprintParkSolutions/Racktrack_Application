import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

/* The old in-app approvals paths land here. The page says where approvals went
   and offers one way on: a plain new-tab link on the web build, the system
   browser through the Capacitor Browser plugin on the phone. */

const { native, open } = vi.hoisted(() => ({ native: { current: false }, open: vi.fn(async () => {}) }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.current } }));
vi.mock('@capacitor/browser', () => ({ Browser: { open } }));

import ApprovalsMovedPage from './ApprovalsMovedPage.jsx';

const URL = '/approvals/';

afterEach(() => { cleanup(); open.mockClear(); native.current = false; });

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

  test('web build: the anchor does the work, the Browser plugin is not called', () => {
    render(<ApprovalsMovedPage />);
    const notPrevented = fireEvent.click(screen.getByRole('link', { name: 'Open Approvals' }));
    expect(notPrevented).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });

  test('native build: the same URL goes to the Capacitor Browser plugin', () => {
    native.current = true;
    render(<ApprovalsMovedPage />);
    const notPrevented = fireEvent.click(screen.getByRole('link', { name: 'Open Approvals' }));
    expect(notPrevented).toBe(false);
    expect(open).toHaveBeenCalledWith({ url: URL });
  });
});
