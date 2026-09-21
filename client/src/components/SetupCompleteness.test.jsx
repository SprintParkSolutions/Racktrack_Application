import { describe, test, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { completenessSummary, CompletenessFlags, CompletenessLine, MANDATORY } from './SetupCompleteness.jsx';

afterEach(cleanup);

const full = { mandatory: { location: true, approver: true, rules: true }, canScan: true };
const partial = { mandatory: { location: true, approver: false, rules: false }, canScan: false };
const none = { mandatory: { location: false, approver: false, rules: false }, canScan: false };

describe('completenessSummary', () => {
  test('all three facts present reads as ready', () => {
    const s = completenessSummary(full);
    expect(s.done).toBe(true);
    expect(s.missing).toEqual([]);
    expect(s.text).toBe('Ready to scan');
  });

  test('names what is missing, in the order the screens ask for it', () => {
    const s = completenessSummary(partial);
    expect(s.done).toBe(false);
    expect(s.missing.map((f) => f.key)).toEqual(['approver', 'rules']);
    expect(s.text).toBe('Needs a SPOC with an account, the rules accepted');
    expect(completenessSummary(none).text).toBe('Needs a location, a SPOC with an account, the rules accepted');
  });

  test('no completeness at all is "not set up yet", with everything missing', () => {
    for (const c of [null, undefined, {}, { mandatory: null }]) {
      const s = completenessSummary(c);
      expect(s.done).toBe(false);
      expect(s.missing.length).toBe(MANDATORY.length);
      expect(s.text).toBe('Not set up yet');
    }
  });
});

describe('<CompletenessFlags>', () => {
  test('renders one mark per mandatory fact and marks the done ones', () => {
    render(<CompletenessFlags completeness={partial} />);
    expect(screen.getByTestId('flag-location').dataset.ok).toBe('1');
    expect(screen.getByTestId('flag-approver').dataset.ok).toBe('0');
    expect(screen.getByTestId('flag-rules').dataset.ok).toBe('0');
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  test('says "done" or "missing" for a screen reader', () => {
    render(<CompletenessFlags completeness={full} />);
    expect(screen.getByTestId('flag-rules').textContent).toContain('done');
    cleanup();
    render(<CompletenessFlags completeness={none} />);
    expect(screen.getByTestId('flag-rules').textContent).toContain('missing');
  });

  test('survives a missing completeness object', () => {
    render(<CompletenessFlags completeness={null} />);
    expect(screen.getByTestId('flag-location').dataset.ok).toBe('0');
  });
});

describe('<CompletenessLine>', () => {
  test('one line: ready, or what is still needed', () => {
    render(<CompletenessLine completeness={full} />);
    expect(screen.getByTestId('completeness-line').textContent).toBe('Ready to scan');
    expect(screen.getByTestId('completeness-line').dataset.done).toBe('1');
    cleanup();
    render(<CompletenessLine completeness={partial} />);
    expect(screen.getByTestId('completeness-line').textContent).toBe('Needs a SPOC with an account, the rules accepted');
    expect(screen.getByTestId('completeness-line').dataset.done).toBe('0');
  });
});
