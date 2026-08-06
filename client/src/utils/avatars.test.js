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
    //
    // The palette was re-toned from a colour ramp to a graphite one when the
    // app moved to white + white-shades with subtle black accents, and re-toned
    // again when the neutrals were flattened to TRUE greyscale (the graphite
    // ramp above was blue-tinted: #3A3F47 is not R=G=B). Both are VALUE
    // changes, not shape changes: there are still eight entries in the same
    // eight slots, so every stored users.avatar index still resolves to the
    // slot it always did — those users simply render monochrome now.
    expect(AVATARS.slice(0, 8)).toEqual([
      { from: '#3f3f3f', to: '#171717' },
      { from: '#4f4f4f', to: '#262626' },
      { from: '#2f2f2f', to: '#000000' },
      { from: '#606060', to: '#323232' },
      { from: '#474747', to: '#1c1c1c' },
      { from: '#6a6a6a', to: '#3d3d3d' },
      { from: '#373737', to: '#121212' },
      { from: '#595959', to: '#2c2c2c' },
    ]);
  });

  test('keeps its length, so no stored index can fall out of range', () => {
    expect(AVATARS).toHaveLength(8);
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
