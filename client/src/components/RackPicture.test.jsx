import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import RackPicture, { categoryOf } from './RackPicture.jsx';

afterEach(cleanup);

const devices = [
  { uid: 'd1', name: 'Core switch', position: 12, portCount: 24, cvClass: 'Switch' },
  { uid: 'd2', name: 'Patch panel', position: 11, portCount: 24, cvClass: 'Patch Panel' },
  { uid: 'd3', name: 'Loose box', position: null, portCount: 8, cvClass: 'Switch' },
];

describe('categoryOf', () => {
  test('sorts a box into one of the six kinds, and never guesses', () => {
    expect(categoryOf({ cvClass: 'Switch' })).toBe('network');
    expect(categoryOf({ cvClass: 'Patch Panel' })).toBe('cabling');
    expect(categoryOf({ cvClass: 'PDU' })).toBe('power');
    expect(categoryOf({ cvClass: 'Server' })).toBe('compute');
    expect(categoryOf({ cvClass: 'Storage array' })).toBe('storage');
    expect(categoryOf({ cvClass: 'Something nobody named' })).toBe('support');
    expect(categoryOf(null)).toBe('support');
  });
});

describe('RackPicture', () => {
  test('draws every shelf the rack has, with each device in its own', () => {
    const { container } = render(<RackPicture devices={devices} size={12} />);
    // Twelve shelves drawn, and the rack says how tall it is.
    expect(screen.getByText('12U rack')).toBeTruthy();
    expect(container.querySelectorAll('[title$="is empty"]').length).toBe(10);
    expect(screen.getByTitle('U12, Core switch, 24 ports')).toBeTruthy();
    expect(screen.getByTitle('U11, Patch panel, 24 ports')).toBeTruthy();
  });

  test('a rack height nobody recorded still fits the boxes that were seen', () => {
    render(<RackPicture devices={devices} size={null} />);
    expect(screen.getByText('12U rack')).toBeTruthy();
  });

  test('one device can be lifted out of the rest', () => {
    render(<RackPicture devices={devices} size={12} highlight="d1" onPick={() => {}} />);
    expect(screen.getByRole('button', { name: 'U12, Core switch, 24 ports' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'U11, Patch panel, 24 ports' }).getAttribute('aria-pressed')).toBe('false');
  });

  test('choosing a shelf hands back the device on it', () => {
    const onPick = vi.fn();
    render(<RackPicture devices={devices} size={12} onPick={onPick} />);
    screen.getByRole('button', { name: 'U11, Patch panel, 24 ports' }).click();
    expect(onPick).toHaveBeenCalledWith('d2');
  });

  test('a box with no shelf is still shown, and still offered', () => {
    const onPick = vi.fn();
    render(<RackPicture devices={devices} size={12} onPick={onPick} />);
    expect(screen.getByText('Seen in the photo but not on a shelf')).toBeTruthy();
    screen.getByRole('button', { name: /Loose box/ }).click();
    expect(onPick).toHaveBeenCalledWith('d3');
  });

  test('without onPick it is a picture, not a picker', () => {
    render(<RackPicture devices={devices} size={12} />);
    expect(screen.queryAllByRole('button').length).toBe(0);
  });

  test('no devices at all draws a rack rather than failing', () => {
    render(<RackPicture devices={[]} size={6} />);
    expect(screen.getByText('6U rack')).toBeTruthy();
  });
});
