import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';

/* The notice a person sees where the app opens: what happened, and a button for
   each thing they can do about it. The SPOC is told a check is theirs, the
   person who sent it is told what became of it, an admin is told when a check
   needs them - and it stays a banner whatever it has to say. */

const { reply, opened, posted, reports } = vi.hoisted(() => ({ reply: { rows: [] }, opened: [], posted: [], reports: [] }));
vi.mock('../utils/api', () => ({
  apiUrl: (p) => p,
  authFetch: vi.fn(async (url, init = {}) => {
    if ((init.method || 'GET') === 'POST') { posted.push(url); return { ok: true, json: async () => ({ ok: true }) }; }
    return { ok: true, json: async () => ({ ok: true, notifications: reply.rows }) };
  }),
}));
vi.mock('../utils/approvals', () => ({
  openApprovals: vi.fn(async (path) => { opened.push(path); }),
  driftReportUrl: vi.fn(async (rackId, planId) => {
    reports.push([rackId, planId]);
    return `/api/scan/${rackId}/drift-report?plan=${planId}&t=tok`;
  }),
  // ExternalLink, which the report's own way out is made of.
  openExternalClick: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
  registerPlugin: () => ({ open: async () => {} }),
}));
vi.mock('@capacitor/browser', () => ({ Browser: { open: vi.fn(async () => {}) } }));

import { Browser } from '@capacitor/browser';
import AssignedNotice, { splitBody } from './AssignedNotice.jsx';

const BODY = [
  'Hello dc007.tech,', '',
  'Aasritha has asked you to check rack SP-HYB-RM01-R01-R1 at Office-Sprintpark.', '',
  'What to check:', '  - Router on shelf U20: it is in the rack, but the record does not list it on that shelf.', '',
  'Aasritha asks: "Is the router on shelf U20?"', '',
  'ServiceNow incident: INC0010007', 'https://dev1.service-now.com/nav_to.do?uri=incident.do?sys_id=abc', '',
  'What to do:', '  1. Open the check and press Accept.', '  2. Go to the rack and look.', '  3. Press Resolve and write what you found.', '',
  'Plan 347 - P3 - assigned', '', '- RackTrack',
].join('\n');
const row = (over = {}) => ({ id: 216, event: 'assigned', planId: 347, readAt: null,
  subject: 'Assigned to you: check rack SP-HYB-RM01-R01-R1', body: BODY, ...over });

// What the server writes for the SPOC flow: the words of notify.js, and `data`.
const SPOC_BODY = [
  'Hello dc007.spoc,', '',
  'dc007.tech sent a drift check on rack SP-HYB-RM01-R01-R1 at Office-Sprintpark. It is yours as the SPOC of this site.', '',
  'What differs:', '  - Router on shelf U20: it is in the rack, but the record does not list it on that shelf.', '',
  'dc007.tech says: "the router is on shelf U20"', '',
  'ServiceNow: INC0010042', 'https://dev1.service-now.com/nav_to.do?uri=incident.do?sys_id=body', '',
  'What to do:', '  1. Open the check. The drift report is beside it.', '  2. Approve, reject or change each difference.',
  '  3. Approve the check. What you approved is written to NetBox at once.', '',
  'Plan 140 - P3 - assigned', '', '- RackTrack',
].join('\n');
const DATA = { planId: 140, rackId: 'RK-5B81BE87', rackName: 'SP-HYB-RM01-R01-R1', siteName: 'Office-Sprintpark',
  incidentNumber: 'INC0010042', incidentUrl: 'https://dev1.service-now.com/incident/from-data', kind: 'assigned' };
const told = (event, kind, subject, over = {}) => row({ id: 300, planId: 140, event, subject,
  body: `Hello dc007.tech,\n\n${subject}.\n\nPlan 140 - P3 - ${event}\n\n- RackTrack`,
  data: { ...DATA, kind }, ...over });

function Landed() { const { rackId } = useParams(); const { search } = useLocation(); return <p>drift check of {rackId}, {search.slice(1)}</p>; }
const mount = () => render(
  <MemoryRouter initialEntries={['/scan']}>
    <Routes>
      <Route path="/scan" element={<AssignedNotice />} />
      <Route path="/results/:rackId/drift" element={<Landed />} />
    </Routes>
  </MemoryRouter>,
);

afterEach(() => { cleanup(); reply.rows = []; opened.length = 0; posted.length = 0; reports.length = 0; });

describe('<AssignedNotice>', () => {
  test('nothing assigned, nothing shown', async () => {
    const { container } = mount();
    await waitFor(() => expect(container.textContent).toBe(''));
  });

  test('says what was asked, and offers the check, the incident and a way to put it away', async () => {
    reply.rows = [row(), row({ id: 200, planId: 332 })];
    mount();
    await screen.findByText('Check rack SP-HYB-RM01-R01-R1');
    expect(screen.getByText('Assigned to you')).toBeTruthy();
    expect(screen.getByText(/Aasritha has asked you to check rack/)).toBeTruthy();
    // what to check is one tap away, behind a button and not the platform's own marker
    expect(screen.queryByText(/Router on shelf U20/)).toBeNull();
    expect(document.querySelector('details')).toBeNull();
    const details = screen.getByRole('button', { name: 'Details' });
    expect(details.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(details);
    expect(details.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(/Router on shelf U20/)).toBeTruthy();
    // and no address is ever printed
    expect(document.body.textContent).not.toMatch(/https?:\/\//);
    expect(screen.getByText('and 1 more')).toBeTruthy();
    // the email's greeting, signature and status line are not part of the card
    expect(screen.queryByText(/Hello dc007/)).toBeNull();
    expect(screen.queryByText(/- RackTrack/)).toBeNull();

    // The SPOC reads the check beside its drift report, so that is where it opens.
    fireEvent.click(screen.getByRole('button', { name: 'Open the check' }));
    await waitFor(() => expect(opened).toEqual(['/approvals/drifts/347?view=report']));
    // A notice written before notices carried `data`: the incident is the first
    // address in its words, and there is no rack to mint a drift report for.
    const incident = screen.getByRole('link', { name: 'Open in ServiceNow' });
    expect(incident.getAttribute('href')).toBe('https://dev1.service-now.com/nav_to.do?uri=incident.do?sys_id=abc');
    expect(screen.queryByRole('button', { name: 'Drift report' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(posted).toEqual(['/api/approvals/notifications/216/read']));
    // the next one takes its place
    await waitFor(() => expect(screen.queryByText('and 1 more')).toBeNull());
  });

  test('the SPOC is told a check is theirs: the check, the drift report, and the incident taken from data', async () => {
    reply.rows = [row({ id: 301, planId: 140, subject: 'Assigned to you: check rack SP-HYB-RM01-R01-R1', body: SPOC_BODY, data: DATA })];
    mount();
    await screen.findByText('Check rack SP-HYB-RM01-R01-R1');
    expect(screen.getByText(/It is yours as the SPOC of this site\./)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open in ServiceNow' }).getAttribute('href')).toBe(DATA.incidentUrl);
    fireEvent.click(screen.getByRole('button', { name: 'Drift report' }));
    await waitFor(() => expect(reports).toEqual([['RK-5B81BE87', 140]]));
    // It is read here, on the app's own screen. Nothing is handed to a browser.
    const frame = await screen.findByTitle('Drift report');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame.getAttribute('src')).toBe('/api/scan/RK-5B81BE87/drift-report?plan=140&t=tok');
    expect(frame.getAttribute('sandbox')).toBe('allow-same-origin');
    expect(Browser.open).not.toHaveBeenCalled();
    // and the arrow in its header gives the card back
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Drift report' })).getByRole('button', { name: 'Back' }));
    expect(screen.queryByTitle('Drift report')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open the check' }));
    await waitFor(() => expect(opened).toEqual(['/approvals/drifts/140?view=report']));
    // nothing internal and no address reaches the banner
    expect(document.body.textContent).not.toMatch(/https?:\/\/|RK-5B81BE87/);
  });

  test('each kind of notice carries its own label', async () => {
    const cases = [
      ['approved', 'approved', 'RackTrack: your check on rack R1 was approved', 'Your check was approved', 'Your check on rack R1 was approved'],
      ['rejected', 'rejected', 'RackTrack: your check on rack R1 was rejected', 'Your check was rejected', 'Your check on rack R1 was rejected'],
      ['rejected', 'rework', 'RackTrack: your check on rack R1 was sent back', 'Your check was sent back', 'Your check on rack R1 was sent back'],
      ['completed', 'written', 'RackTrack: your check on rack R1 is written', 'Written to NetBox', 'Your check on rack R1 is written'],
      ['write_failed', 'write_failed', 'RackTrack: the write for rack R1 did not finish', 'A write did not finish', 'The write for rack R1 did not finish'],
      ['reassign_needed', 'needs_admin', 'RackTrack: a drift check on rack R1 needs an admin', 'Needs an admin', 'A drift check on rack R1 needs an admin'],
      ['reassigned', 'reassigned', 'RackTrack: rack R1 has gone to somebody else', 'Given to somebody else', 'Rack R1 has gone to somebody else'],
    ];
    for (const [event, kind, subject, label, title] of cases) {
      reply.rows = [told(event, kind, subject)];
      mount();
      await screen.findByText(label);
      // the title is the subject without the sender's name on it
      expect(screen.getByRole('heading', { name: title })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
      cleanup();
    }
  });


  /* A ServiceNow incident that could not be raised is an operator's problem,
     and the person this banner interrupts is a technician at a rack. It goes
     to the Desk and to the email, and not to the phone. */
  test('a ServiceNow incident that needs a look is not put on the phone', async () => {
    reply.rows = [told('incident_failed', 'incident',
      'RackTrack: the ServiceNow incident for rack R1 needs a look')];
    const { container } = mount();
    await waitFor(() => expect(container.textContent).not.toContain('ServiceNow'));
    expect(screen.queryByText('ServiceNow needs a look')).toBeNull();
    expect(container.textContent).toBe('');
  });

  test('a row written before notices carried data is shown only when it is an assignment', async () => {
    // Older servers sent approved / rejected / completed to the sender, the
    // holder and every admin alike, and no phone ever showed or dismissed them.
    reply.rows = [
      row({ id: 9, event: 'sla_warn', subject: 'RackTrack: a check is running late' }),
      row({ id: 8, event: 'completed', planId: 140, subject: 'RackTrack: your check on rack R1 is written', data: undefined }),
      row({ id: 6, event: 'approved', planId: 139, subject: 'RackTrack: plan 139 was approved', data: null }),
      row({ id: 5, event: 'rejected', planId: 138, subject: 'RackTrack: plan 138 was sent back for rework', data: null }),
      row({ id: 4, event: 'write_failed', planId: 137, subject: 'RackTrack: the write for plan 137 failed', data: null }),
      row({ id: 3, event: 'assigned', data: null }),
      row({ id: 7, event: 'assigned', readAt: '2026-09-21T10:00:00Z' }),
    ];
    mount();
    await screen.findByText('Assigned to you');
    expect(screen.queryByText(/running late|was approved|sent back|is written|failed/)).toBeNull();
    expect(screen.queryByText(/and \d+ more/)).toBeNull();
  });

  test('a row that carries data is shown whatever its event', async () => {
    reply.rows = [told('approved', 'approved', 'RackTrack: your check on rack R1 was approved', { data: JSON.stringify({ ...DATA, kind: 'approved' }) })];
    mount();
    await screen.findByText('Your check was approved');
  });

  test('the person who sent it opens their own drift check; whoever has to act opens Drift Desk', async () => {
    reply.rows = [told('approved', 'approved', 'RackTrack: your check on rack R1 was approved')];
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Open the check' }));
    // the check is named, so the screen shows that one and does not compare again
    await screen.findByText('drift check of RK-5B81BE87, plan=140');
    expect(opened).toEqual([]);
    cleanup();

    reply.rows = [told('rejected', 'rejected', 'RackTrack: your check on rack R1 was rejected')];
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Open the check' }));
    await screen.findByText('drift check of RK-5B81BE87, plan=140');
    cleanup();

    // no rack on the notice: the check in Drift Desk is the way in
    reply.rows = [told('completed', 'written', 'RackTrack: your check on rack R1 is written', { data: { ...DATA, kind: 'written', rackId: null } })];
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Open the check' }));
    await waitFor(() => expect(opened).toEqual(['/approvals/drifts/140']));
    cleanup(); opened.length = 0;

    reply.rows = [told('reassign_needed', 'needs_admin', 'RackTrack: a drift check on rack R1 needs an admin')];
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Open the check' }));
    await waitFor(() => expect(opened).toEqual(['/approvals/drifts/140']));
    cleanup();

    // handed to somebody else: there is nothing left to open
    reply.rows = [told('reassigned', 'reassigned', 'RackTrack: rack R1 has gone to somebody else')];
    mount();
    await screen.findByText('Given to somebody else');
    expect(screen.queryByRole('button', { name: 'Open the check' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Drift report' })).toBeNull();
  });

  test('the newest notice is the one shown, with a count of the rest', async () => {
    reply.rows = [
      told('approved', 'approved', 'RackTrack: your check on rack R1 was approved', { id: 1, createdAt: '2026-09-21T09:00:00Z' }),
      told('completed', 'written', 'RackTrack: your check on rack R1 is written', { id: 2, createdAt: '2026-09-21T09:05:00Z' }),
    ];
    mount();
    await screen.findByText('Written to NetBox');
    expect(screen.getByText('and 1 more')).toBeTruthy();
  });

  test('other events are not this card\'s business, and the steps are kept apart from the ask', () => {
    const parts = splitBody(BODY);
    expect(parts.lead).toBe('Aasritha has asked you to check rack SP-HYB-RM01-R01-R1 at Office-Sprintpark.');
    expect(parts.details).toMatch(/^What to check:/);
    expect(parts.details).not.toMatch(/What to do/);
    expect(parts.steps).toMatch(/^1\. Open the check/);
    expect(parts.url).toMatch(/^https:\/\/dev1\.service-now\.com/);
    // several incidents, several addresses: one button, and none of them printed
    const many = splitBody(`${BODY}\nhttps://dev1.service-now.com/two\nhttps://dev1.service-now.com/three`);
    expect(`${many.lead}${many.details}${many.steps}`).not.toMatch(/https?:/);
  });
});
