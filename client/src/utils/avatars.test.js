// Profile avatar assignment.
//
// The load-bearing fact here is that users.avatar stores an INDEX into the
// AVATARS array. Re-ordering or removing an entry silently reassigns every
// user who ever picked one, and there is no way to detect that after the fact
// — so the first test pins the array's shape, and the rest pin that an
// unchosen user gets the same avatar on every load rather than a new one.

import { describe, test, expect } from 'vitest';
import { AVATARS, autoAvatarIndex, resolveAvatarIndex, avatarInitial } from './avatars';

describe('the AVATARS table', () => {
  test('is append-only: existing entries keep their index', () => {
    // If you are here because this failed: adding to the END is fine, and this
    // assertion just needs the new entries appended too. Anything else has
    // already changed what a stored index means.
    expect(AVATARS.slice(0, 8)).toEqual([
      { from: '#6366f1', to: '#8b5cf6' },
      { from: '#0ea5e9', to: '#06b6d4' },
      { from: '#14b8a6', to: '#22c55e' },
      { from: '#f59e0b', to: '#f97316' },
      { from: '#f43f5e', to: '#ec4899' },
      { from: '#64748b', to: '#334155' },
      { from: '#10b981', to: '#0d9488' },
      { from: '#d946ef', to: '#7c3aed' },
    ]);
  });
});

describe('autoAvatarIndex', () => {
  test('is deterministic and always in range', () => {
    for (const seed of ['alice', 'Bob', '', '?', '   ', 'ø', '1', null, undefined]) {
      const i = autoAvatarIndex(seed);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(AVATARS.length);
      expect(autoAvatarIndex(seed)).toBe(i);
    }
  });

  test('keys off the first character only, after trimming', () => {
    // Two users with the same initial sharing an avatar is intended; a leading
    // space changing the answer is not, because usernames get padded in transit.
    expect(autoAvatarIndex('alice@example.com')).toBe(autoAvatarIndex('anders'));
    expect(autoAvatarIndex('  alice')).toBe(autoAvatarIndex('alice'));
  });
});

describe('resolveAvatarIndex', () => {
  test('an explicit choice wins, including index 0', () => {
    // 0 is a valid stored avatar and a falsy number; a truthiness check here
    // would quietly reassign everyone who picked the first one.
    expect(resolveAvatarIndex({ username: 'zoe', avatar: 0 })).toBe(0);
    expect(resolveAvatarIndex({ username: 'zoe', avatar: 5 })).toBe(5);
  });

  test('a non-integer avatar is ignored in favour of the auto assignment', () => {
    // The column is nullable, and older rows hold strings.
    for (const avatar of [null, undefined, '3', 2.5, NaN]) {
      expect(resolveAvatarIndex({ username: 'zoe', avatar })).toBe(autoAvatarIndex('zoe'));
    }
  });

  test('falls back to email, then to a fixed default', () => {
    expect(resolveAvatarIndex({ email: 'zoe@example.com' })).toBe(autoAvatarIndex('zoe@example.com'));
    expect(resolveAvatarIndex(null)).toBe(autoAvatarIndex('?'));
    expect(resolveAvatarIndex({})).toBe(autoAvatarIndex('?'));
  });
});

describe('avatarInitial', () => {
  test('is a single uppercase character from username, else email', () => {
    expect(avatarInitial({ username: 'alice' })).toBe('A');
    expect(avatarInitial({ email: 'bob@example.com' })).toBe('B');
    expect(avatarInitial({ username: '  carol' })).toBe('C');
  });

  test('never renders as empty', () => {
    // The monogram is drawn on a gradient tile; an empty string leaves a
    // blank chip that reads as a broken image.
    expect(avatarInitial(null)).toBe('?');
    expect(avatarInitial({})).toBe('?');
    expect(avatarInitial({ username: '   ' })).toBe('?');
  });
});
