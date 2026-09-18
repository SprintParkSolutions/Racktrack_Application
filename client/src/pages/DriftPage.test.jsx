import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/* The technician's screen: it compares and sends, and that is all. Nothing on
   it approves, assigns or writes, whatever the caller's role. */

const { routes } = vi.hoisted(() => ({ routes: { current: {} } }));
vi.mock('../utils/api', () => ({
  apiUrl: (p) => p,
  authFetch: vi.fn(async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    const h = routes.current[`${method} ${url}`];
    if (!h) return { ok: false, status: 404, json: async () => ({ error: `no stub for ${method} ${url}` }) };
    const status = h.status || 200;
    return { ok: status < 400, status, json: async () => h.body };
  }),
}));

import DriftPage from './DriftPage.jsx';

const DEV = 'dev:RK-1:u16';
const plan = (status) => ({
  id: 7, rackId: 'RK-1', scanId: 3, status,
  submittedBy: status === 'submitted' ? 'ravi' : null,
  submittedAt: status === 'submitted' ? new Date().toISOString() : null,
  items: [{ uid: DEV, type: 'Device', name: 'SW-16', action: 'create', decidable: true, decision: 'pending' }],
});
function stub(status, contacts = { body: { spoc: null } }) {
  routes.current = {
    'POST /api/nb/scans/adopt/RK-1': { body: { id: 3 } },
    'POST /api/nb/netbox/3/preview': { body: { planId: 7 } },
    'GET /api/nb/plans/7': { body: plan(status) },
    'GET /api/nb/plans/7/contacts': contacts,
    'GET /api/nb/scans/rack/RK-1/name': { body: { name: '' } },
  };
}
const mount = () => render(
  <MemoryRouter initialEntries={['/results/RK-1/drift']}>
    <Routes><Route path="/results/:rackId/drift" element={<DriftPage />} /></Routes>
  </MemoryRouter>,
);
const buttonNames = () => screen.queryAllByRole('button').map((b) => b.textContent.trim().toLowerCase());
const FORBIDDEN = /approve|reject|assign|write|export/;

afterEach(cleanup);

describe('<DriftPage>', () => {
  test('before sending: one button, Send to the admin, and nothing that decides or writes', async () => {
    stub('open');
    mount();
    await screen.findByText('SW-16');
    expect(screen.getByRole('button', { name: 'Send to the admin' })).toBeTruthy();
    expect(buttonNames().filter((n) => FORBIDDEN.test(n))).toEqual([]);
    expect(document.body.textContent).not.toMatch(/Write the approved|Assign to|Approve\b/);
    // Nothing to track until it has been sent.
    expect(screen.queryByRole('link', { name: 'Track this check' })).toBeNull();
  });

  test('after sending: watches only, still nothing that decides or writes', async () => {
    stub('submitted');
    mount();
    await screen.findByText('Sent to the admin');
    expect(screen.queryByRole('button', { name: 'Send to the admin' })).toBeNull();
    expect(buttonNames().filter((n) => FORBIDDEN.test(n))).toEqual([]);
    expect(screen.getByText('Waiting on the admin')).toBeTruthy();
    // One link out: this check, in RackTrack Approvals.
    const track = screen.getAllByRole('link', { name: 'Track this check' });
    expect(track).toHaveLength(1);
    expect(track[0].getAttribute('href')).toBe('/approvals/drifts/7');
    expect(track[0].getAttribute('target')).toBe('_blank');
  });

  test('a member whom the contacts route turns away still gets the page', async () => {
    stub('open', { status: 403, body: { error: 'admins only' } });
    mount();
    await screen.findByText('SW-16');
    expect(screen.getByRole('button', { name: 'Send to the admin' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
