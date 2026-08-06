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
  { from: '#3f3f3f', to: '#171717' },  // 0 graphite
  { from: '#4f4f4f', to: '#262626' },  // 1 slate
  { from: '#2f2f2f', to: '#000000' },  // 2 near-black
  { from: '#606060', to: '#323232' },  // 3 steel
  { from: '#474747', to: '#1c1c1c' },  // 4 iron
  { from: '#6a6a6a', to: '#3d3d3d' },  // 5 ash
  { from: '#373737', to: '#121212' },  // 6 charcoal
  { from: '#595959', to: '#2c2c2c' },  // 7 gunmetal
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
