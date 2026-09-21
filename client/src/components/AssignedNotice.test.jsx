import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

/* The notice a technician sees where the app opens: what was asked, and a
   button for each thing they can do about it. */

const { reply, opened, posted } = vi.hoisted(() => ({ reply: { rows: [] }, opened: [], posted: [] }));
vi.mock('../utils/api', () => ({
  apiUrl: (p) => p,
  authFetch: vi.fn(async (url, init = {}) => {
    if ((init.method || 'GET') === 'POST') { posted.push(url); return { ok: true, json: async () => ({ ok: true }) }; }
    return { ok: true, json: async () => ({ ok: true, notifications: reply.rows }) };
  }),
}));
vi.mock('../utils/approvals', () => ({ openApprovals: vi.fn(async (path) => { opened.push(path); }) }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('@capacitor/browser', () => ({ Browser: { open: vi.fn(async () => {}) } }));

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

afterEach(() => { cleanup(); reply.rows = []; opened.length = 0; posted.length = 0; });

describe('<AssignedNotice>', () => {
  test('nothing assigned, nothing shown', async () => {
    const { container } = render(<AssignedNotice />);
    await waitFor(() => expect(container.textContent).toBe(''));
  });

  test('says what was asked, and offers the check, the incident and a way to put it away', async () => {
    reply.rows = [row(), row({ id: 200, planId: 332 })];
    render(<AssignedNotice />);
    await screen.findByText('Check rack SP-HYB-RM01-R01-R1');
    expect(screen.getByText(/Aasritha has asked you to check rack/)).toBeTruthy();
    // what to check is there, one tap away, and no address is ever printed
    expect(screen.getByText(/Router on shelf U20/)).toBeTruthy();
    expect(screen.getByText('Details')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/https?:\/\//);
    expect(screen.getByText('and 1 more')).toBeTruthy();
    // the email's greeting, signature and status line are not part of the card
    expect(screen.queryByText(/Hello dc007/)).toBeNull();
    expect(screen.queryByText(/- RackTrack/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open the check' }));
    await waitFor(() => expect(opened).toEqual(['/approvals/drifts/347']));
    const incident = screen.getByRole('link', { name: 'Open in ServiceNow' });
    expect(incident.getAttribute('href')).toBe('https://dev1.service-now.com/nav_to.do?uri=incident.do?sys_id=abc');

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(posted).toEqual(['/api/approvals/notifications/216/read']));
    // the next one takes its place
    await waitFor(() => expect(screen.queryByText('and 1 more')).toBeNull());
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
