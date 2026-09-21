import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

/* The guided tour and the site a scan is for. The tour dims everything but the
   control it points at, and Analyze stays shut until a site is chosen - so the
   site is the tour's first step, the list stays live under it, and the step is
   done when a site is chosen, not when the list is tapped. */

const { tour } = vi.hoisted(() => ({ tour: { current: null } }));
vi.mock('../TourContext.jsx', () => ({ useTour: () => tour.current }));

import TourOverlay from './TourOverlay.jsx';
import { TOUR_STEPS } from '../tourSteps.js';

const step = (id) => TOUR_STEPS.find((s) => s.id === id);

// The scan page as the tour sees it: the picker, and the mark the page sets
// once no site is left to choose.
function page({ settled = false } = {}) {
  const root = document.createElement('div');
  root.id = 'scan';
  if (settled) root.setAttribute('data-scan-site', 'settled');
  root.innerHTML = '<div data-tour="site-picker"><input type="search" aria-label="Site" />'
    + '<button type="button">Site 7 - Harbour DC</button></div>';
  document.body.appendChild(root);
  return root;
}

let advance, stopTour;
beforeEach(() => {
  vi.useFakeTimers();
  advance = vi.fn();
  stopTour = vi.fn();
  tour.current = { active: true, currentStep: step('choose-site'), advance, stopTour };
});
afterEach(() => {
  cleanup();
  document.getElementById('scan')?.remove();
  vi.useRealTimers();
});

describe('guided tour - the site step', () => {
  test('the site comes first, before the photo, and points at the picker', () => {
    expect(TOUR_STEPS[0].id).toBe('choose-site');
    expect(TOUR_STEPS[1].id).toBe('select-image');
    expect(TOUR_STEPS[0].target).toBe('site-picker');
    expect(TOUR_STEPS[0].title).toBe('Choose the site');
    expect(TOUR_STEPS[0].optional).toBeUndefined();
  });

  test('no step of the tour is written with a long dash', () => {
    for (const s of TOUR_STEPS) expect(`${s.title} ${s.body}`).not.toMatch(/[\u2013\u2014]/);
  });

  test('a tap on the list neither ends the tour nor moves it on', () => {
    page();
    render(<TourOverlay />);
    expect(screen.getByRole('dialog', { name: 'Choose the site' })).toBeTruthy();
    // The picker is the spotlight, never a hole that ends the walkthrough.
    expect(document.querySelector('[data-tour-bypass]')).toBeNull();
    fireEvent.click(screen.getByLabelText('Site'));
    act(() => { vi.advanceTimersByTime(3000); });
    expect(advance).not.toHaveBeenCalled();
    expect(stopTour).not.toHaveBeenCalled();
  });

  test('choosing a site moves the tour on, after a beat', () => {
    const root = page();
    render(<TourOverlay />);
    act(() => { vi.advanceTimersByTime(500); });
    expect(advance).not.toHaveBeenCalled();
    root.setAttribute('data-scan-site', 'settled');
    act(() => { vi.advanceTimersByTime(1500); });
    expect(advance).toHaveBeenCalledTimes(1);
    expect(stopTour).not.toHaveBeenCalled();
  });

  test('with nothing to choose the step passes without being drawn', () => {
    const root = page({ settled: true });
    root.querySelector('[data-tour="site-picker"]').remove();
    render(<TourOverlay />);
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => { vi.advanceTimersByTime(1500); });
    expect(advance).toHaveBeenCalledTimes(1);
  });
});
