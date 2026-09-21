import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/* Organization settings has one way in: the popup stepper, one step at a
   time, Back and Next and nothing else, whether it was the route gate or
   Profile > Organization settings that opened it. These tests pin that
   shape, that every step is reachable through Next, and that the last step
   thanks the person and offers one button. */

const { state, navigated } = vi.hoisted(() => ({ state: { current: null }, navigated: [] }));

vi.mock('../hooks/useOrgSettings', () => ({
  useOrgSettings: () => state.current,
  EMPTY_ORG: { name: '', slug: '', short_code: '', timezone: '', country: '', primary_contact_name: '', primary_contact_email: '' },
  EMPTY_PROFILE: { contacts: [], vendors: [], conventions: {}, systems: {}, network: {}, facility: {}, snmp: { configured: false } },
}));
vi.mock('../AuthContext.jsx', () => ({
  useAuth: () => ({ user: { id: 1, role: 'org_admin', setup: { needsSetup: false } }, refreshUser: async () => {}, logout: () => {} }),
}));
vi.mock('../utils/api', () => ({ publicOrigin: () => 'https://demo.example', apiUrl: (p) => p, authFetch: async () => ({ ok: true, json: async () => ({}) }) }));
/* jsdom has no matchMedia, and the shell asks it how wide the viewport is.
   A phone is the answer here: no sidebar, so the page draws its own top bar. */
window.matchMedia = (query) => ({
  matches: false, media: query, onchange: null,
  addEventListener: () => {}, removeEventListener: () => {},
  addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
});
vi.mock('react-router-dom', async () => {
  const real = await vi.importActual('react-router-dom');
  return { ...real, useNavigate: () => (to) => navigated.push(to) };
});

import SetupPage from './SetupPage.jsx';

const site = (over = {}) => ({
  id: 11, name: 'Rotterdam DC1', organization_id: 4,
  datacentre: { address: '12 Harbour Road, Rotterdam, Netherlands', timezone: 'Europe/Amsterdam' },
  spaces: [], approver: { user_id: 5, username: 'priya.nair', email: 'priya@northwind.example' },
  rules: { accepted_at: '2026-09-20 10:00:00' },
  completeness: { mandatory: { location: true, approver: true, rules: true }, canScan: true },
  profile: { contacts: [{ name: 'Priya Nair', role: 'spoc', email: 'priya@northwind.example', phone: null }], facility: { address_line1: '12 Harbour Road', city: 'Rotterdam', country: 'NL' } },
  ...over,
});

function model(over = {}) {
  const dcs = over.dcs || [site()];
  const orgProfile = over.orgProfile || { name: 'Northwind Colocation', short_code: 'NORTHWIN', timezone: 'Europe/Amsterdam', country: 'NL', primary_contact_name: '', primary_contact_email: '' };
  return {
    user: { id: 1, role: 'org_admin' }, orgId: 4, isOwner: false, orgs: [], pickOrg: () => {},
    loading: false, error: null, orgError: null, refresh: () => {},
    model: { org: orgProfile, dcs }, dcs, orgProfile, marks: {},
    saveOrg: async () => {}, addDatacentre: async () => {}, saveDatacentre: async () => {},
    setApprover: async () => {}, createSpocAccount: async () => {}, acceptRules: async () => {}, saveSection: async () => {},
    members: [], loadMembers: () => {}, invite: async () => {},
    ...over,
  };
}

const show = (over) => { state.current = model(over); return render(<MemoryRouter><SetupPage /></MemoryRouter>); };
/* The phone top bar behind the container carries a Back of its own, so the
   step's own two buttons are always looked for inside the dialog. */
const box = () => within(screen.getByRole('dialog'));
const step = () => screen.getByRole('dialog').querySelector('h2').textContent;
const next = () => fireEvent.click(screen.getByTestId('next'));
const back = () => fireEvent.click(box().getByRole('button', { name: 'Back' }));

afterEach(() => { cleanup(); navigated.length = 0; state.current = null; });

describe('<SetupPage>', () => {
  test('opens the popup stepper, not a list of sections', () => {
    show();
    expect(screen.getByTestId('flow')).toBeTruthy();
    // One step on screen, and no second heading from a panel behind it.
    expect(screen.getAllByRole('heading', { level: 2 }).length).toBe(1);
    expect(screen.queryByTestId('remaining')).toBeNull();
  });

  test('a complete organization opens on the review, and Next reaches the thank you', () => {
    show();
    expect(step()).toBe('Review');
    expect(box().getByRole('button', { name: 'Back' })).toBeTruthy();
    next();
    expect(step()).toBe('Thank you');
    expect(screen.getByText(/Setup is done/)).toBeTruthy();
    // The closing step has one button, and it closes.
    expect(box().queryByRole('button', { name: 'Back' })).toBeNull();
    expect(box().queryByRole('button', { name: 'Close' })).toBeNull();
    expect(screen.queryByTestId('next')).toBeNull();
    fireEvent.click(screen.getByTestId('finish'));
    expect(screen.getByTestId('finish')).toBeTruthy();
  });

  test('an organization that still needs something opens on that step and holds Next there', () => {
    show({ orgProfile: { name: 'Northwind Colocation', timezone: 'Europe/Amsterdam', country: '' } });
    expect(step()).toBe('Organization');
    next();
    expect(step()).toBe('Organization');
    expect(screen.getByText('Complete the marked fields to continue.')).toBeTruthy();
  });

  test('every step is reached one at a time, and the sites step lists a site as a row', () => {
    show({ orgProfile: { name: 'Northwind Colocation', timezone: 'Europe/Amsterdam', country: 'NL' } });
    expect(step()).toBe('Review');
    back();
    expect(step()).toBe('Rules');
    back();
    expect(step()).toBe('Sites');
    /* The only site there is opens on arrival; closed, it is one row that
       says where it is and who its SPOC is, and it opens again. */
    expect(screen.getByText('Rotterdam DC1')).toBeTruthy();
    expect(screen.getByLabelText('City')).toBeTruthy();
    expect(screen.getByLabelText('Access notes')).toBeTruthy();
    fireEvent.click(screen.getByTestId('site-close-11'));
    expect(screen.queryByLabelText('City')).toBeNull();
    expect(screen.getByText('12 Harbour Road, Rotterdam, Netherlands')).toBeTruthy();
    expect(screen.getByText('SPOC Priya Nair')).toBeTruthy();
    fireEvent.click(screen.getByTestId('site-open-11'));
    expect(screen.getByLabelText('Access notes')).toBeTruthy();
  });

  test('a site that still needs something is open on arrival', () => {
    show({ dcs: [site({ approver: null, completeness: { mandatory: { location: true, approver: false, rules: true }, canScan: false } })] });
    expect(step()).toBe('Sites');
    expect(screen.getByLabelText('City')).toBeTruthy();
  });

  test('Close goes back to Profile when the gate did not send them here', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(navigated).toContain('/profile');
  });
});
