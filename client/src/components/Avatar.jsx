import { AVATARS, resolveAvatarIndex, avatarInitial } from '../utils/avatars';

/* A preset profile picture, drawn rather than fetched.
 *
 * Eight portraits, one per slot in utils/avatars.js. They are drawn here so
 * they cost no request, work offline and can never come back broken. One
 * projection for all of them: the disc, the shoulders, the neck, the head,
 * then the hair over it, so every face sits in the same place and a row of
 * eight reads as one set.
 *
 * `user` picks their chosen (or auto-assigned) slot; `index` forces one,
 * which is what the picker previews use.
 */

const HEAD = { cx: 50, cy: 43, r: 18.5 };

/* The hair, over the head, by cut. Each is drawn in the same 100x100 space
   as the head above, so they interchange. */
function Hair({ cut, colour }) {
  const c = { fill: colour };
  switch (cut) {
    case 'bun':
      return (
        <g {...c}>
          <circle cx="50" cy="19.5" r="6.2" />
          <path d="M50 24.5c-10.4 0-18.8 8-18.8 17.9 0 1.6.2 3.1.6 4.6 1-7.9 3.9-11.2 8.7-12 4.1-.7 6.2 1.2 9.5 1.2 6.8 0 10.2 2.7 10.7 10.8.4-1.5.6-3 .6-4.6 0-9.9-8.4-17.9-18.8-17.9z" />
        </g>
      );
    case 'wavy':
      return (
        <g {...c}>
          <path d="M50 23c-11 0-19.8 8.3-19.8 18.6 0 2 .3 3.9.9 5.7.6-8.4 3.8-11.9 8.9-12.7 4.3-.7 6.5 1.3 9.9 1.3 7.2 0 10.8 2.9 11.3 11.4.6-1.8.9-3.7.9-5.7C62.1 31.3 61 23 50 23z" />
          <path d="M30.6 41c-2.4 2.6-3.4 6.3-2.7 9.8.5 2.5 1.9 4.4 3.6 5.2-1.2-4.6-1.4-9.8-.9-15zM69.4 41c2.4 2.6 3.4 6.3 2.7 9.8-.5 2.5-1.9 4.4-3.6 5.2 1.2-4.6 1.4-9.8.9-15z" />
        </g>
      );
    case 'curls':
      return (
        <g {...c}>
          <circle cx="36" cy="30" r="7" /><circle cx="50" cy="25.5" r="7.6" />
          <circle cx="64" cy="30" r="7" /><circle cx="31.5" cy="39.5" r="6" />
          <circle cx="68.5" cy="39.5" r="6" />
          <path d="M50 26c-9.8 0-17.8 7-17.8 15.6 0 1.4.2 2.8.5 4.1 1-7 3.7-9.9 8.2-10.6 3.9-.6 5.9 1 9.1 1 6.5 0 9.7 2.4 10.2 9.6.3-1.3.5-2.7.5-4.1C60.7 33 59.8 26 50 26z" />
        </g>
      );
    case 'long':
      return (
        <g {...c}>
          <path d="M29 44c0-11.6 9.4-21 21-21s21 9.4 21 21v22c0 2-1.6 3.6-3.6 3.6h-2.6V44c0-3.5-1.4-5.7-4.2-6.9-3.3-1.4-6.4.4-10.6.4-5.3 0-8.1-1.6-11.4-.1-2.9 1.3-4.3 3.5-4.3 6.6v25.6h-1.7c-2 0-3.6-1.6-3.6-3.6z" />
        </g>
      );
    case 'short':
    default:
      return (
        <path
          {...c}
          d="M50 23c-11.2 0-20.3 8.5-20.3 19 0 2.1.4 4.2 1.1 6.1.6-8.7 3.9-12.3 9.1-13.1 4.4-.7 6.7 1.3 10.1 1.3 7.4 0 11 2.9 11.6 11.8.7-1.9 1.1-4 1.1-6.1 0-10.5-9.1-19-20.3-19z"
        />
      );
  }
}

export default function Avatar({
  user, index, initial, size = 96, ring = false, style, className, onClick, title,
}) {
  const idx = Number.isInteger(index) ? index : resolveAvatarIndex(user);
  const a = AVATARS[idx] || AVATARS[0];
  // Kept for the callers that still pass one, and for the label a screen
  // reader hears: a drawn face is not a name.
  const who = initial != null ? initial : avatarInitial(user);
  return (
    <div
      className={className}
      onClick={onClick}
      title={title}
      role={onClick ? 'button' : undefined}
      style={{
        width: size, height: size, flex: '0 0 auto',
        borderRadius: '50%',
        overflow: 'hidden',
        background: a.ground,
        boxShadow: ring
          ? '0 0 0 3px rgba(255,255,255,0.95), 0 6px 18px rgba(16,32,60,0.22)'
          : '0 4px 14px rgba(16,32,60,0.14)',
        cursor: onClick ? 'pointer' : 'default',
        ...style,
      }}
    >
      <svg viewBox="0 0 100 100" width="100%" height="100%" role="img" aria-label={`Profile picture ${who}`}>
        {/* the shoulders */}
        <path d="M50 62c-14.9 0-27 10.6-27 23.7V100h54V85.7C77 72.6 64.9 62 50 62z" fill={a.shirt} />
        {/* the collar, so the shirt is a shirt and not a block */}
        <path d="M43.5 63.4 50 72l6.5-8.6-3.1-1.1a12 12 0 0 0-6.8 0z" fill="#FFFFFF" opacity=".92" />
        {/* the neck, then the head over it */}
        <path d="M43 53h14v10.5a7 7 0 0 1-14 0z" fill={a.skin} />
        <path d="M43 57.5c2.2 2 4.6 3 7 3s4.8-1 7-3V53H43z" fill="#000000" opacity=".08" />
        <circle cx={HEAD.cx} cy={HEAD.cy} r={HEAD.r} fill={a.skin} />
        {/* the eyes and the mouth, at the size they read at 48px */}
        <circle cx="43.4" cy="43.5" r="1.7" fill="#2A2320" opacity=".85" />
        <circle cx="56.6" cy="43.5" r="1.7" fill="#2A2320" opacity=".85" />
        <path d="M45.6 51.4a6 6 0 0 0 8.8 0" stroke="#2A2320" strokeWidth="1.6" strokeLinecap="round" fill="none" opacity=".6" />
        <Hair cut={a.cut} colour={a.hair} />
        {a.glasses ? (
          <g stroke="#3A3F47" strokeWidth="1.5" fill="none" opacity=".8">
            <circle cx="43.4" cy="43.6" r="5.2" />
            <circle cx="56.6" cy="43.6" r="5.2" />
            <path d="M48.6 43.6h2.8M38.2 43.6 34 42.6M61.8 43.6l4.2-1" strokeLinecap="round" />
          </g>
        ) : null}
      </svg>
    </div>
  );
}
