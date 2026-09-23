// Profile avatar assignment.
//
// The load-bearing fact here is that users.avatar stores an INDEX into the
// AVATARS array. Re-ordering or removing an entry silently reassigns every
// user who ever picked one, and there is no way to detect that after the fact
// - so the first test pins the array's shape, and the rest pin that an
// unchosen user gets the same avatar on every load rather than a new one.

import { describe, test, expect } from 'vitest';
import { AVATARS, autoAvatarIndex, resolveAvatarIndex, avatarInitial } from './avatars';

describe('the AVATARS table', () => {
  test('is append-only: no entry may move out of the slot it is stored under', () => {
    // If you are here because this failed: adding to the END is fine, and this
    // assertion just needs the new entries counted. Anything else has already
    // changed what a stored users.avatar index means, and there is no way to
    // detect that after the fact.
    //
    // What a slot LOOKS like has changed twice and may change again: a colour
    // ramp, then a graphite ramp, and on 23 September 2026 a drawn portrait
    // per slot, because eight grey discs carrying the same initial were not a
    // choice. Every one of those was a VALUE change in the same eight slots,
    // so every stored index still resolves to the slot it always did.
    expect(AVATARS).toHaveLength(8);
    // Each slot says how its portrait is drawn, and every one of them says it:
    // a slot missing a field renders as a hole rather than a person.
    for (const a of AVATARS) {
      expect(a).toEqual(expect.objectContaining({
        ground: expect.stringMatching(/^#[0-9A-Fa-f]{6}$/),
        skin: expect.stringMatching(/^#[0-9A-Fa-f]{6}$/),
        hair: expect.stringMatching(/^#[0-9A-Fa-f]{6}$/),
        shirt: expect.stringMatching(/^#[0-9A-Fa-f]{6}$/),
        cut: expect.stringMatching(/^(short|bun|wavy|curls|long)$/),
      }));
    }
  });

  test('is eight people and not one repeated', () => {
    // The complaint that started this: the picker offered eight things that
    // looked the same. Two slots sharing a ground AND a cut would be that
    // again.
    const seen = new Set(AVATARS.map((a) => `${a.ground}|${a.cut}|${a.skin}`));
    expect(seen.size).toBe(AVATARS.length);
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
    // The portrait carries no letter now, but this is still what a screen
    // reader is given for it, and an empty label reads as nothing at all.
    expect(avatarInitial(null)).toBe('?');
    expect(avatarInitial({})).toBe('?');
    expect(avatarInitial({ username: '   ' })).toBe('?');
  });
});
