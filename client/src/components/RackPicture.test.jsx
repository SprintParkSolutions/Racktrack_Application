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
    // A shelf with nothing on it says what is known - that no box was
    // detected there - rather than calling the shelf free.
    expect(container.querySelectorAll('[title^="No box detected at U"]').length).toBe(10);
    expect(container.querySelectorAll('[title$="is empty"]').length).toBe(0);
    expect(screen.getByTitle('U12, Core switch, 24 ports')).toBeTruthy();
    expect(screen.getByTitle('U11, Patch panel, 24 ports')).toBeTruthy();
  });

  test('a rack height nobody recorded is never stated as one', () => {
    render(<RackPicture devices={devices} size={null} />);
    expect(screen.getByText('Boxes the camera placed')).toBeTruthy();
    expect(screen.getByText('Rack height not recorded')).toBeTruthy();
    expect(screen.queryByText('12U rack')).toBe(null);
    // The boxes that were seen are still drawn.
    expect(screen.getByTitle('U12, Core switch, 24 ports')).toBeTruthy();
  });

  test('a rack taller than the picture says how much of it is drawn', () => {
    render(<RackPicture devices={[{ uid: 'd9', name: 'Top box', position: 70, portCount: 8, cvClass: 'Switch' }]} size={80} />);
    expect(screen.getByText('80U rack')).toBeTruthy();
    expect(screen.getByText('U1 to U60 drawn here')).toBeTruthy();
    // The box above the last shelf drawn is named rather than dropped.
    // "Above U60" is the whole heading now: the line above it already says U1 to
    // U60 is what got drawn, so "not drawn here" said it twice.
    expect(screen.getByText('Above U60')).toBeTruthy();
    expect(screen.getByText(/Top box/)).toBeTruthy();
  });

  test('two boxes on one shelf are not filed as unplaced', () => {
    render(<RackPicture
      devices={[
        { uid: 'a', name: 'First', position: 14, portCount: 24, cvClass: 'Switch' },
        { uid: 'b', name: 'Second', position: 14, portCount: 24, cvClass: 'Switch' },
      ]}
      size={20}
    />);
    expect(screen.getByText('Sharing a shelf')).toBeTruthy();
    expect(screen.queryByText('No shelf recorded')).toBe(null);
  });

  test('a tall box whose span is part taken is listed once, not drawn twice', () => {
    const { container } = render(<RackPicture
      devices={[
        { uid: 'a', name: 'Single', position: 15, portCount: 24, cvClass: 'Switch' },
        { uid: 'b', name: 'Tall', units: [14, 15, 16], portCount: 24, cvClass: 'Server' },
      ]}
      size={20}
    />);
    expect(screen.getByText('Sharing a shelf')).toBeTruthy();
    expect(container.querySelectorAll('[title^="U14, Tall"]').length).toBe(0);
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
    expect(screen.getByText('No shelf recorded')).toBeTruthy();
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
