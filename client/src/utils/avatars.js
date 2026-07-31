// Preset profile avatars — professional gradient "monograms" (the user's
// initial on a tasteful gradient). Bundled, so they work offline with no
// upload. A user is auto-assigned one from their initial and can change it.
//
// Each entry is a two-stop gradient. Keep this list append-only-ish: the
// stored value is an INDEX into this array (server column users.avatar), so
// re-ordering would remap everyone's choice.
// Monochrome by design: the app is white / white-shades with subtle black
// accents and carries no colour accent, so the avatars are a graphite ramp
// rather than a rainbow. The array is still index-addressed (users.avatar
// stores the INDEX), so the length and order must not change — only the
// values were re-toned.
export const AVATARS = [
  { from: '#3A3F47', to: '#14171B' },  // 0 graphite
  { from: '#4A505A', to: '#22262C' },  // 1 slate
  { from: '#2B2F35', to: '#0C0E11' },  // 2 near-black
  { from: '#5A616C', to: '#2E333A' },  // 3 steel
  { from: '#43484F', to: '#191C21' },  // 4 iron
  { from: '#646B76', to: '#383D45' },  // 5 ash
  { from: '#33373D', to: '#101215' },  // 6 charcoal
  { from: '#545A64', to: '#282C32' },  // 7 gunmetal
];

// Deterministic pick from a seed (username/email) so an un-chosen user always
// gets the same avatar rather than a new one each load.
export function autoAvatarIndex(seed = '') {
  const s = String(seed || '?').trim();
  const code = s.charCodeAt(0) || 63;   // '?' fallback
  return ((code % AVATARS.length) + AVATARS.length) % AVATARS.length;
}

// The avatar a user should display: their explicit choice, else auto-assigned.
export function resolveAvatarIndex(user) {
  if (user && Number.isInteger(user.avatar)) return user.avatar;
  return autoAvatarIndex(user?.username || user?.email || '?');
}

export function avatarInitial(user, fallback = '?') {
  const s = user?.username || user?.email || fallback;
  return String(s).trim().charAt(0).toUpperCase() || fallback;
}
