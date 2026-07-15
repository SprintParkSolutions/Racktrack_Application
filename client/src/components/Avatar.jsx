import { AVATARS, resolveAvatarIndex, avatarInitial } from '../utils/avatars';

// Renders a preset avatar (gradient + initial). Pass a `user` (uses their
// chosen/auto index) or an explicit `index` (for the picker previews).
export default function Avatar({ user, index, initial, size = 96, ring = false, style, className, onClick, title }) {
  const idx = Number.isInteger(index) ? index : resolveAvatarIndex(user);
  const a = AVATARS[idx] || AVATARS[0];
  const ch = initial != null ? initial : avatarInitial(user);
  return (
    <div
      className={className}
      onClick={onClick}
      title={title}
      role={onClick ? 'button' : undefined}
      style={{
        width: size, height: size, flex: '0 0 auto',
        borderRadius: '50%',
        background: `linear-gradient(135deg, ${a.from}, ${a.to})`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontWeight: 700, fontSize: Math.round(size * 0.42), lineHeight: 1,
        letterSpacing: '-0.02em', userSelect: 'none',
        boxShadow: ring ? '0 0 0 3px rgba(255,255,255,0.9), 0 4px 14px rgba(0,0,0,0.18)' : '0 4px 14px rgba(0,0,0,0.14)',
        cursor: onClick ? 'pointer' : 'default',
        ...style,
      }}
    >
      {ch}
    </div>
  );
}
