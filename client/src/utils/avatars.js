/* Preset profile pictures.
 *
 * These were eight two-stop GREY gradients with the person's initial printed
 * on them. Eight of them, all graphite, all carrying the same letter: the
 * picker offered a choice between eight things that looked identical. The
 * owner asked on 23 September 2026 for real pictures to choose from, so each
 * slot is now a drawn portrait - a different person, not a different shade.
 *
 * Bundled and drawn in the browser, so they work offline, cost no request and
 * never come back as a broken image.
 *
 * KEEP THIS LIST APPEND-ONLY. The stored value is an INDEX into this array
 * (server column users.avatar), so re-ordering it would silently give every
 * person somebody else's face. Changing what a slot LOOKS like is fine - that
 * is what this change is - but a slot may never move.
 *
 * Each entry says how its portrait is drawn:
 *   ground  the disc behind the person
 *   skin    the face and the neck
 *   hair    and how it is cut, by `cut`
 *   shirt   the shoulders
 *   glasses whether they wear any
 */
export const AVATARS = [
  { ground: '#E8F0FC', skin: '#F1C9A5', hair: '#2E2A26', shirt: '#23548E', cut: 'short' },
  { ground: '#E3F1F4', skin: '#CE9063', hair: '#1E1A17', shirt: '#16606F', cut: 'bun', glasses: true },
  { ground: '#F7EFE6', skin: '#F6D8BE', hair: '#A45B2A', shirt: '#7C5528', cut: 'wavy' },
  { ground: '#F1EEFA', skin: '#90603F', hair: '#17120F', shirt: '#4C3F7C', cut: 'curls' },
  { ground: '#EAF3EC', skin: '#F2CBA8', hair: '#8D8A86', shirt: '#1F6B4A', cut: 'short', glasses: true },
  { ground: '#FBEDEF', skin: '#E2AC80', hair: '#24201D', shirt: '#9B3B4E', cut: 'long' },
  { ground: '#ECEFF4', skin: '#66402A', hair: '#12100E', shirt: '#2F3A46', cut: 'bun' },
  { ground: '#FDF3E3', skin: '#FADCC1', hair: '#C79A4B', shirt: '#A9761E', cut: 'wavy' },
];

// Deterministic pick from a seed (username/email) so an un-chosen user always
// gets the same picture rather than a new one each load.
export function autoAvatarIndex(seed = '') {
  const s = String(seed || '?').trim();
  const code = s.charCodeAt(0) || 63;   // '?' fallback
  return ((code % AVATARS.length) + AVATARS.length) % AVATARS.length;
}

// The picture a user should display: their explicit choice, else auto-assigned.
export function resolveAvatarIndex(user) {
  if (user && Number.isInteger(user.avatar)) return user.avatar;
  return autoAvatarIndex(user?.username || user?.email || '?');
}

export function avatarInitial(user, fallback = '?') {
  const s = user?.username || user?.email || fallback;
  return String(s).trim().charAt(0).toUpperCase() || fallback;
}
