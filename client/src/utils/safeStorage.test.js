// Regression tests for the storage guard.
//
// The bug these exist for: an unguarded localStorage call inside a React
// effect white-screened the entire product on any browser with site data
// blocked, and again on any device whose origin quota was full. Both failure
// modes are invisible in normal development — localStorage works fine on a
// developer's machine — so nothing but a test that *makes* storage throw can
// keep the guard honest.

import { describe, test, expect, afterEach } from 'vitest';
import { getItem, setItem, removeItem, getJSON, setJSON } from './safeStorage';

const realLocal = window.localStorage;
const realSession = window.sessionStorage;

/** Install a stand-in for window.localStorage / sessionStorage. */
function install(fake, which = 'localStorage') {
  Object.defineProperty(window, which, { value: fake, configurable: true, writable: true });
}

/** Storage that throws on every operation — "Block All Cookies" in Safari. */
function blockedStorage() {
  const err = new DOMException('The operation is insecure.', 'SecurityError');
  return {
    getItem() { throw err; },
    setItem() { throw err; },
    removeItem() { throw err; },
  };
}

/**
 * Storage with a byte budget, like a real origin near its quota. Writes over
 * `budget` characters throw QuotaExceededError; everything else persists.
 */
function quotaStorage(budget) {
  const data = new Map();
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem(k, v) {
      if (String(v).length > budget) {
        throw new DOMException('quota exceeded', 'QuotaExceededError');
      }
      data.set(k, String(v));
    },
    removeItem: (k) => void data.delete(k),
  };
}

afterEach(() => {
  install(realLocal, 'localStorage');
  install(realSession, 'sessionStorage');
  realLocal.clear();
});

describe('a storage that throws on every call', () => {
  test('every entry point returns instead of throwing', () => {
    install(blockedStorage());

    // The whole contract in one place: nothing here may escape to a caller,
    // because every one of these used to run inside an effect.
    expect(() => getItem('k')).not.toThrow();
    expect(getItem('k')).toBe(null);
    expect(setItem('k', 'v')).toBe(false);
    expect(removeItem('k')).toBe(false);
    expect(getJSON('k', { fallback: true })).toEqual({ fallback: true });
    expect(setJSON('k', [1, 2, 3])).toBe(false);
  });

  test('a blocked sessionStorage is guarded on the same terms', () => {
    // The `storage` argument is a separate code path through pick(); a guard
    // that only covered localStorage would still crash the session-scoped
    // callers.
    install(blockedStorage(), 'sessionStorage');
    expect(getItem('k', 'session')).toBe(null);
    expect(setItem('k', 'v', 'session')).toBe(false);
    expect(setJSON('k', { a: 1 }, 'session')).toBe(false);
  });
});

describe('reads', () => {
  test('getItem/setItem/removeItem round-trip through real storage', () => {
    expect(setItem('k', 'v')).toBe(true);
    expect(getItem('k')).toBe('v');
    expect(removeItem('k')).toBe(true);
    expect(getItem('k')).toBe(null);
  });

  test('getJSON returns the fallback for malformed JSON rather than throwing', () => {
    // Half-written values are real: a tab killed mid-write, or an older build
    // that stored a bare string under the same key.
    window.localStorage.setItem('k', '{"a":1,');
    expect(getJSON('k', 'fallback')).toBe('fallback');
  });

  test('getJSON distinguishes a missing key from a stored null', () => {
    expect(getJSON('absent', 'fallback')).toBe('fallback');
    setJSON('present', null);
    expect(getJSON('present', 'fallback')).toBe(null);
  });

  test('getJSON parses what setJSON wrote', () => {
    setJSON('k', { a: [1, 2], b: 'x' });
    expect(getJSON('k')).toEqual({ a: [1, 2], b: 'x' });
  });
});

describe('setJSON under a full quota', () => {
  test('a newest-first array keeps its NEWEST entries', () => {
    const store = quotaStorage(12);
    install(store);

    // This is the shape the only real caller produces: ResultsPage builds its
    // history with unshift, so index 0 is the scan that just finished. The
    // first version of setJSON kept the TAIL, which meant the scan the user
    // had just waited through was the one thrown away while a week-old entry
    // survived. Default is newest-first for exactly that reason.
    const newestFirst = ['newest', 'b', 'c', 'd', 'e', 'f', 'oldest'];
    expect(setJSON('hist', newestFirst)).toBe(true);

    const kept = JSON.parse(store.data.get('hist'));
    expect(kept.length).toBeLessThan(newestFirst.length);
    expect(kept).toEqual(newestFirst.slice(0, kept.length));
    expect(kept[0]).toBe('newest');
    expect(kept).not.toContain('oldest');
  });

  test('an append-ordered array can opt into keeping its TAIL', () => {
    const store = quotaStorage(12);
    install(store);

    const oldestFirst = ['oldest', 'b', 'c', 'd', 'e', 'f', 'newest'];
    expect(setJSON('hist', oldestFirst, 'local', { newestFirst: false })).toBe(true);

    const kept = JSON.parse(store.data.get('hist'));
    expect(kept).toEqual(oldestFirst.slice(oldestFirst.length - kept.length));
    expect(kept).toContain('newest');
    expect(kept).not.toContain('oldest');
  });

  test('a non-array value is not silently truncated', () => {
    // There is no safe way to shrink an object, so the only correct outcome is
    // to report failure and leave no half-written value behind.
    const store = quotaStorage(5);
    install(store);
    expect(setJSON('obj', { big: 'x'.repeat(100) })).toBe(false);
    expect(store.data.has('obj')).toBe(false);
  });

  test('a failed write leaves the previously stored value intact', () => {
    const store = quotaStorage(2);
    install(store);
    store.data.set('hist', '["earlier","scans"]');

    expect(setJSON('hist', ['aaaa', 'bbbb', 'cccc'])).toBe(false);
    // This used to delete the key on ANY failure, including a quota exhausted
    // by unrelated keys — so one failed write destroyed a perfectly good
    // stored history. Stale data beats data loss the user never asked for.
    expect(store.data.get('hist')).toBe('["earlier","scans"]');
  });

  test('an unserialisable value is reported, not thrown', () => {
    // JSON.stringify sat outside the guard, so the one promise this module
    // makes — never throw — was untrue of its main entry point.
    const store = quotaStorage(1000);
    install(store);
    const circular = { name: 'loop' };
    circular.self = circular;
    expect(() => setJSON('k', circular)).not.toThrow();
    expect(setJSON('k', circular)).toBe(false);
    expect(store.data.has('k')).toBe(false);
  });

  test('a value that fits is written whole, with no trimming', () => {
    const store = quotaStorage(1000);
    install(store);
    expect(setJSON('hist', [1, 2, 3, 4])).toBe(true);
    expect(JSON.parse(store.data.get('hist'))).toEqual([1, 2, 3, 4]);
  });
});
