import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import SitePicker, { rackLine, siteMatches } from './SitePicker.jsx';

/* The site a scan is for: a dropdown like the Space picker - already chosen
   when there is one site, waiting for a choice when there are several, and
   absent when the server has none to offer. */

const OFFICE = {
  id: 32, siteId: 'Site 32', name: 'Office-Sprintpark', rackCount: 1,
  racks: [{ rackId: 'RK-5B81BE87', name: 'SP-HYB-RM01-R01-R1', spaceId: 26 }],
  spaces: [{ id: 26, name: 'RM01', depth: 0 }], hasSpoc: true,
};
const HARBOUR = {
  id: 7, siteId: 'Site 7', name: 'Harbour DC', rackCount: 5,
  racks: ['A1', 'A2', 'A3', 'A4', 'A5'].map((n, i) => ({ rackId: `RK-0000000${i}`, name: n, spaceId: null })),
  spaces: [], hasSpoc: false,
};
const NORTH = { id: 132, siteId: 'Site 132', name: 'North Annex', rackCount: 0, racks: [], spaces: [] };

// The page owns the value; this stands in for it.
function Held({ sites, initial = '', onChange = () => {} }) {
  const [value, setValue] = useState(initial);
  return <SitePicker sites={sites} value={value} onChange={(id) => { setValue(id); onChange(id); }} />;
}
const pick = () => screen.getByLabelText(/^Site/);
const optionNames = () => [...pick().options].map((o) => o.textContent);

afterEach(cleanup);

describe('<SitePicker>', () => {
  test('one site: the dropdown holds it, already chosen, with its racks under it', () => {
    render(<Held sites={[OFFICE]} />);
    expect(pick().tagName).toBe('SELECT');
    expect(pick().value).toBe('32');
    expect(optionNames()).toEqual(['Site 32 - Office-Sprintpark']);
    expect(screen.getByText('SP-HYB-RM01-R01-R1')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toEqual([]);
    // Nothing to fill in, so nothing is marked as mandatory.
    expect(document.body.textContent).not.toContain('*');
  });

  test('several sites: the dropdown lists them by number and name, and the choice is handed up as a string', () => {
    const onChange = vi.fn();
    render(<Held sites={[OFFICE, HARBOUR, NORTH]} onChange={onChange} />);
    expect(pick().value).toBe('');
    expect(optionNames()).toEqual(['Choose a site', 'Site 32 - Office-Sprintpark', 'Site 7 - Harbour DC', 'Site 132 - North Annex']);

    fireEvent.change(pick(), { target: { value: '7' } });
    expect(onChange).toHaveBeenCalledWith('7');
    expect(pick().value).toBe('7');
    // Chosen: its racks are named under it, and it can be changed in place.
    expect(screen.getByText('A1, A2, A3 and 2 more')).toBeTruthy();
    fireEvent.change(pick(), { target: { value: '132' } });
    expect(onChange).toHaveBeenLastCalledWith('132');
    expect(screen.getByText('No racks yet')).toBeTruthy();
  });

  test('the mandatory mark is a lone asterisk, and only while there is a choice to make', () => {
    render(<Held sites={[OFFICE, HARBOUR]} />);
    expect(screen.getByText('*').getAttribute('aria-hidden')).toBe('true');
    expect(document.body.textContent).not.toMatch(/required|optional/i);
  });

  test('no sites: nothing is drawn', () => {
    const { container } = render(<Held sites={[]} />);
    expect(container.innerHTML).toBe('');
  });

  test('a rack is named by its name, never by its internal id, and nothing is a plus button', () => {
    const unnamed = { id: 9, name: 'Depot', rackCount: 2, racks: [{ rackId: 'RK-AAAAAAAA', name: 'RK-AAAAAAAA' }, { rackId: 'RK-BBBBBBBB', name: '' }] };
    expect(rackLine(unnamed)).toBe('2 racks');
    expect(rackLine(NORTH)).toBe('No racks yet');
    expect(rackLine(OFFICE)).toBe('SP-HYB-RM01-R01-R1');
    expect(rackLine(HARBOUR)).toBe('A1, A2, A3 and 2 more');
    // A server that sends no ready-made "Site 9" is still sending the number.
    expect(siteMatches(unnamed, 'site 9')).toBe(true);
    render(<Held sites={[OFFICE, unnamed]} />);
    expect(document.body.textContent).not.toMatch(/RK-|[\u2013\u2014]|\+/);
  });
});
