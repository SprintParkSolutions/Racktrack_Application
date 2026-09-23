/* The banner at the top of Profile: a datacenter aisle, drawn.
 *
 * It was a photograph, and three of them in turn: a near-black tangle of
 * patch leads, a white aisle cropped to a slice, an AV rack lit orange. The
 * owner asked on 23 September 2026 for something realistic, creative and
 * attractive, and a band 148 pixels tall cut out of a tall photograph is
 * none of those - you see a stripe of somebody else's room.
 *
 * So it is drawn, in the same language as the floor on Home: one projection,
 * the product's own palette, light that falls rather than a filter. It is
 * sharp at every width, weighs nothing, needs no request, and it is OUR
 * datacenter rather than a stock one.
 *
 * The geometry is one perspective. The aisle runs to a vanishing point at
 * VP; a cabinet at depth t has its face between the floor line and the
 * ceiling line at that depth, so the rows close in as they recede and the
 * whole thing reads as a room instead of a row of boxes.
 */

const W = 1200;
const H = 300;
const VPX = W * 0.5;     // where the aisle goes
const VPY = H * 0.52;

/* A point on the left or right wall at depth t (0 near, 1 at the vanishing
   point) and height h (0 floor, 1 ceiling). Perspective is the same simple
   lerp towards VP on both axes, which is enough at this size and keeps every
   edge of every cabinet on one set of lines. */
const near = (side) => (side < 0 ? -W * 0.06 : W * 1.06);
const wall = (side, t, h) => {
  const x = near(side) + (VPX - near(side)) * t;
  const floorY = H * 1.06 + (VPY - H * 1.06) * t;
  const ceilY = -H * 0.28 + (VPY + H * 0.28 - -H * 0.28) * t * 0.92;
  return [x, floorY + (ceilY - floorY) * h];
};
const pts = (list) => list.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

/* One cabinet on one side, standing between depth a and depth b. `lit` is how
   many of its shelves have their lights on, which is the only thing on this
   drawing that is not architecture. */
function Cabinet({ side, a, b, lit = 3, tone }) {
  const TOP = 0.86;
  const face = [wall(side, a, 0), wall(side, b, 0), wall(side, b, TOP), wall(side, a, TOP)];
  const depth = (a + b) / 2;
  // Further away is dimmer: one multiplier, applied to the fill and to the
  // lights, so distance is the only thing that changes down the row.
  const far = 1 - depth * 0.55;

  const shelves = [];
  const rows = 7;
  for (let i = 0; i < rows; i += 1) {
    const h0 = 0.08 + (i * (TOP - 0.12)) / rows;
    const h1 = h0 + (TOP - 0.12) / rows * 0.62;
    const on = i < lit;
    shelves.push(
      <polygon
        key={i}
        points={pts([wall(side, a + (b - a) * 0.12, h0), wall(side, b - (b - a) * 0.12, h0),
          wall(side, b - (b - a) * 0.12, h1), wall(side, a + (b - a) * 0.12, h1)])}
        fill={on ? tone.lit : tone.shelf}
        opacity={on ? 0.85 * far + 0.15 : 0.5 * far + 0.2}
      />,
    );
  }
  return (
    <g>
      <polygon points={pts(face)} fill={tone.face} opacity={far} />
      {shelves}
      {/* the glass door catching the ceiling light */}
      <polygon points={pts(face)} fill="url(#ai-glass)" opacity={0.5 * far + 0.15} />
      {/* the upright between this cabinet and the next. Without it the row
          is one long panel rather than a row of cabinets. */}
      <line
        x1={wall(side, b, 0)[0]} y1={wall(side, b, 0)[1]}
        x2={wall(side, b, TOP)[0]} y2={wall(side, b, TOP)[1]}
        stroke="#0A1119" strokeWidth={Math.max(0.8, 2.4 * far)} opacity={0.55 * far + 0.2}
      />
      {/* its lid, catching the ceiling light, which is what gives the row
          its edge along the top */}
      <line
        x1={wall(side, a, TOP)[0]} y1={wall(side, a, TOP)[1]}
        x2={wall(side, b, TOP)[0]} y2={wall(side, b, TOP)[1]}
        stroke="#7E93AE" strokeWidth={Math.max(0.8, 2 * far)} opacity={0.5 * far}
      />
    </g>
  );
}

export default function AisleArt({ className = '' }) {
  const LEFT = { face: '#1B2430', shelf: '#38465A', lit: '#7FB4FF' };
  const RIGHT = { face: '#151D28', shelf: '#33404F', lit: '#6BA6F5' };
  // Seven cabinets a side, each a little shorter in depth than the last, so
  // they crowd together towards the vanishing point the way a real row does.
  const steps = [0, 0.12, 0.23, 0.33, 0.42, 0.5, 0.57, 0.63, 0.69, 0.74, 0.78];
  const litLeft = [5, 3, 6, 2, 4, 3, 5, 2, 4, 3];
  const litRight = [4, 6, 2, 5, 3, 4, 2, 5, 3, 6];

  return (
    <svg
      className={className}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label="A datacenter aisle, drawn: two rows of cabinets running away under the ceiling lights"
    >
      <defs>
        <linearGradient id="ai-room" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#EEF3FA" />
          <stop offset="46%" stopColor="#F7FAFD" />
          <stop offset="100%" stopColor="#DFE7F1" />
        </linearGradient>
        <linearGradient id="ai-floor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#C9D5E5" />
          <stop offset="100%" stopColor="#EFF4F9" />
        </linearGradient>
        <linearGradient id="ai-glass" x1="0" y1="0" x2="0.7" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity=".3" />
          <stop offset="40%" stopColor="#FFFFFF" stopOpacity=".04" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="ai-end" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#BFD6FF" stopOpacity=".95" />
          <stop offset="55%" stopColor="#DCE8F8" stopOpacity=".5" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="ai-lamp" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity=".95" />
          <stop offset="100%" stopColor="#CFE0F7" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* the room */}
      <rect x="0" y="0" width={W} height={H} fill="url(#ai-room)" />
      {/* the floor, and the light lying on it */}
      <polygon
        points={pts([wall(-1, 0, 0), wall(1, 0, 0), wall(1, 0.72, 0), wall(-1, 0.72, 0)])}
        fill="url(#ai-floor)"
      />
      {/* the light at the end of the aisle, which is what makes it a room */}
      <ellipse cx={VPX} cy={VPY + 8} rx={W * 0.2} ry={H * 0.42} fill="url(#ai-end)" />

      {/* the ceiling lights, running away */}
      {[0.06, 0.2, 0.33, 0.44, 0.53].map((t) => {
        const [lx, ly] = wall(-1, t, 0.98);
        const [rx] = wall(1, t, 0.98);
        const w = (rx - lx) * 0.3;
        return (
          <rect
            key={t}
            x={(lx + rx) / 2 - w / 2}
            y={ly}
            width={w}
            height={Math.max(3, 14 * (1 - t))}
            rx="3"
            fill="url(#ai-lamp)"
            opacity={0.9 - t * 0.6}
          />
        );
      })}

      {/* the two rows. The far ones first, so the near ones stand over them. */}
      {[...steps.keys()].slice(0, -1).reverse().map((i) => (
        <g key={`r${i}`}>
          <Cabinet side={1} a={steps[i]} b={steps[i + 1]} lit={litRight[i]} tone={RIGHT} />
          <Cabinet side={-1} a={steps[i]} b={steps[i + 1]} lit={litLeft[i]} tone={LEFT} />
        </g>
      ))}

      {/* what the rows put back on the floor */}
      <polygon
        points={pts([wall(-1, 0, 0), wall(-1, 0.63, 0), wall(1, 0.63, 0), wall(1, 0, 0)])}
        fill="#0B1524"
        opacity=".06"
      />
    </svg>
  );
}
