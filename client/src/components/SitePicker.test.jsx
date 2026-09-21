import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import SitePicker, { rackLine, siteMatches } from './SitePicker.jsx';

/* The site a scan is for: stated when there is one, searched when there are
   several, and absent when the server has none to offer. */

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
const rowNames = () => screen.queryAllByRole('button').map((b) => b.textContent);

afterEach(cleanup);

describe('<SitePicker>', () => {
  test('one site is stated, not offered: no search, nothing to press', () => {
    render(<Held sites={[OFFICE]} initial="32" />);
    expect(screen.getByText('Site 32 - Office-Sprintpark - 1 rack')).toBeTruthy();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryAllByRole('button')).toEqual([]);
    // Nothing to fill in, so nothing is marked as mandatory.
    expect(document.body.textContent).not.toContain('*');
  });

  test('several sites are searched by number and by name, and the choice is handed up as a string', () => {
    const onChange = vi.fn();
    render(<Held sites={[OFFICE, HARBOUR, NORTH]} onChange={onChange} />);
    const box = screen.getByPlaceholderText('Search by site number or name');
    expect(screen.getByLabelText(/^Site/, { selector: 'input' })).toBe(box);
    expect(rowNames()).toHaveLength(3);

    // By number. "32" is also inside 132, and both are honest answers.
    fireEvent.change(box, { target: { value: '32' } });
    expect(rowNames().map((n) => n.slice(0, 8))).toEqual(['Site 32 ', 'Site 132']);
    // By the words on the row, in any case.
    fireEvent.change(box, { target: { value: 'site 7' } });
    expect(rowNames()).toHaveLength(1);
    // By name.
    fireEvent.change(box, { target: { value: 'HARB' } });
    expect(rowNames()).toEqual(['Site 7 - Harbour DCA1, A2, A3 and 2 more']);
    fireEvent.change(box, { target: { value: 'nowhere' } });
    expect(rowNames()).toEqual([]);
    expect(screen.getByText('No site matches that.')).toBeTruthy();

    fireEvent.change(box, { target: { value: 'harbour' } });
    fireEvent.click(screen.getByRole('button', { name: /Site 7 - Harbour DC/ }));
    expect(onChange).toHaveBeenCalledWith('7');
    // Chosen: the list folds away to the answer and a way back to it.
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.getByText('Site 7 - Harbour DC')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(screen.getByRole('searchbox').value).toBe('');
    expect(rowNames()).toHaveLength(3);
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
