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
 *
 * A person who chose a photograph of their own out of the phone's gallery has
 * it on the account (users.avatar_photo), and it wins: the drawn portraits are
 * what the product offers when somebody has not brought their own face. The
 * photograph is a small square thumbnail, so it is set as the disc's own
 * background and cropped to fill it rather than squeezed into it.
 */

const HEAD = { cx: 50, cy: 43, r: 18.5 };

/* The hair, over the head, by cut.
 *
 * Every cut is built on ONE cap, because the fault they all had was the same:
 * each silhouette was drawn free-hand and none of them was symmetric, so the
 * head - a circle of radius 18.5 at (50,43) - came out from under the hair on
 * the right of every face, which reads as a bald patch (the owner, 23
 * September 2026, "hair is not covering complete head").
 *
 * So the cap is an arc of radius 20.5 about the same centre: two units proud
 * of the skull the whole way round, ear to ear, with the hairline across the
 * forehead. A cut then adds only what makes it that cut - a bun, curls, waves,
 * a curtain down each side - and can never uncover the head again.
 */
const CAP = 'M29.5 43A20.5 20.5 0 0 1 70.5 43L70.5 48.6C69.6 38.7 65.6 35.3 58.6 35.3'
  + ' 54.6 35.3 52.8 33.7 50 33.7 47.2 33.7 45.4 35.3 41.4 35.3 34.4 35.3 30.4 38.7 29.5 48.6Z';

function Hair({ cut, colour }) {
  const c = { fill: colour };
  switch (cut) {
    case 'bun':
      return (
        <g {...c}>
          <circle cx="50" cy="18.6" r="6.4" />
          <path d="M50 22.6c-4.6 0-8.3 2.6-8.3 5.8h16.6c0-3.2-3.7-5.8-8.3-5.8z" />
          <path d={CAP} />
        </g>
      );
    case 'wavy':
      return (
        <g {...c}>
          <path d={CAP} />
          {/* the waves, one each side, in the same place on both */}
          <path d="M29.6 44.2c-2.5 2.7-3.5 6.5-2.8 10 .5 2.5 1.9 4.4 3.6 5.2-1.2-4.6-1.4-9.9-.8-15.2z" />
          <path d="M70.4 44.2c2.5 2.7 3.5 6.5 2.8 10-.5 2.5-1.9 4.4-3.6 5.2 1.2-4.6 1.4-9.9.8-15.2z" />
        </g>
      );
    case 'curls':
      return (
        <g {...c}>
          <circle cx="50" cy="23.6" r="8" />
          <circle cx="36.6" cy="28.4" r="7.4" />
          <circle cx="63.4" cy="28.4" r="7.4" />
          <circle cx="30.4" cy="38.6" r="6.6" />
          <circle cx="69.6" cy="38.6" r="6.6" />
          <path d={CAP} />
        </g>
      );
    case 'long':
      return (
        <g {...c}>
          <path d={CAP} />
          {/* the curtains: the same length and width on both sides */}
          <path d="M29.5 43h5.6v27h-2.6a3 3 0 0 1-3-3z" />
          <path d="M70.5 43h-5.6v27h2.6a3 3 0 0 0 3-3z" />
        </g>
      );
    case 'short':
    default:
      return <path {...c} d={CAP} />;
  }
}

export default function Avatar({
  user, index, initial, size = 96, ring = false, style, className, onClick, title,
  photo = null,
}) {
  const idx = Number.isInteger(index) ? index : resolveAvatarIndex(user);
  /* Their own photograph, where there is one and no slot was forced (a picker
     preview forces a slot, and must keep showing that slot). */
  const shot = photo || (!Number.isInteger(index) && user && user.avatarPhoto) || null;
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
      {shot ? (
        <img
          src={shot}
          alt={`Profile picture ${who}`}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
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
      )}
    </div>
  );
}
