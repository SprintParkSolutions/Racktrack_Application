// Preset profile avatars — professional gradient "monograms" (the user's
// initial on a tasteful gradient). Bundled, so they work offline with no
// upload. A user is auto-assigned one from their initial and can change it.
//
// Each entry is a two-stop gradient. Keep this list append-only-ish: the
// stored value is an INDEX into this array (server column users.avatar), so
// re-ordering would remap everyone's choice.
export const AVATARS = [
  { from: '#6366f1', to: '#8b5cf6' },  // 0 indigo → violet
  { from: '#0ea5e9', to: '#06b6d4' },  // 1 sky → cyan
  { from: '#14b8a6', to: '#22c55e' },  // 2 teal → green
  { from: '#f59e0b', to: '#f97316' },  // 3 amber → orange
  { from: '#f43f5e', to: '#ec4899' },  // 4 rose → pink
  { from: '#64748b', to: '#334155' },  // 5 slate (neutral)
  { from: '#10b981', to: '#0d9488' },  // 6 emerald → teal
  { from: '#d946ef', to: '#7c3aed' },  // 7 fuchsia → purple
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
