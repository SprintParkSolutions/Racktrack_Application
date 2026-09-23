import { useMemo } from 'react';
import styles from './EstateMap.module.css';

/**
 * The estate, drawn as a floor you can look at.
 *
 * Built on 23 September 2026. The owner showed two phone screens they liked -
 * a factory whose plant is drawn as a floor with a figure floating over each
 * zone, and a services app whose way in is a grid of the things people press
 * most - and asked for Home to read like that, with a datacenter where the
 * factory is. This is that floor.
 *
 * Nothing on it is invented. Every cabinet is a rack the server already
 * knows: /api/scan-sites answers with each Site, the racks set up in it and
 * the spaces they stand in, and /api/approvals/plans says what the newest
 * check of each rack found. A rack is drawn in the colour of its own state
 * and opens its own page. A room's figure is the share of its racks that
 * match the records, counted here and fetched from nowhere.
 *
 * The drawing is one projection throughout. A cell on the floor is (x, y),
 * height is z, and iso() is the only place those become pixels, so the floor,
 * the cabinets, the room labels and the light all sit on the same ground.
 *
 * Class names avoid card / tile / panel / hero / chip / badge / pill /
 * banner / header: index.css re-tones and re-shadows anything whose class
 * contains those words.
 */

/* One floor cell, in pixels. A cabinet stands on one cell; the rows are
   spaced by ROW so there is an aisle to walk down between them. */
const TW = 30;
const TH = 15;
const ROW = 1.55;
const AISLE = 0.9;      // the gap between one room's rows and the next
const HEIGHT = 44;            // how tall a cabinet stands
const FOOT_X = 0.38;          // half its footprint, across
const FOOT_Y = 0.30;          // and back

/* The floor is drawn into a picture of this shape whatever it holds, so a
   Site with three racks and one with thirty both give a band the page can
   keep room for. */
const ASPECT = 1.62;
const PAD = 16;

/* Past this many, a phone is drawing dots rather than a floor. The rest are
   counted in the words under the map, never dropped silently. */
export const DRAWN_MAX = 24;

const iso = (x, y, z = 0) => [(x - y) * TW, (x + y) * TH - z];
const pts = (list) => list.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

/** How many cabinets stand in a row, by how many there are to stand. */
export function columnsFor(n) {
  if (n <= 3) return Math.max(1, n);
  if (n <= 6) return 3;
  if (n <= 12) return 4;
  if (n <= 20) return 5;
  return 6;
}

/* The states a rack can be in, in the colours Home already uses for them:
   `top` is the lid, `face` the front, `side` the shaded cheek. */
export const TONES = {
  matched:   { top: '#3FA97A', face: '#188054', side: '#0E5B3B' },
  written:   { top: '#3FA97A', face: '#188054', side: '#0E5B3B' },
  spoc:      { top: '#5E93DA', face: '#2A62B4', side: '#1C4886' },
  unmatched: { top: '#E8A951', face: '#B4690E', side: '#8A5009' },
  unchecked: { top: '#CBD1DA', face: '#A8B0BC', side: '#8C95A3' },
};

/** What the legend under the floor says, in the order a rack passes through. */
export const LEGEND = [
  { key: 'matched', label: 'Matches' },
  { key: 'unmatched', label: 'Unmatched' },
  { key: 'spoc', label: 'With the SPOC' },
  { key: 'unchecked', label: 'Not checked' },
];

/**
 * Where every cabinet stands, which room each belongs to, and the picture
 * they all fit in.
 *
 * `racks` arrive in the order the Site lists them; they are laid left to
 * right and front to back, and kept in their rooms so a room's cabinets
 * stand together and its label has somewhere honest to point.
 */
export function floorOf(racks) {
  const drawn = racks.slice(0, DRAWN_MAX);
  const cols = columnsFor(drawn.length);

  /* A room's cabinets stand together, and the next room starts on a row of
     its own with an aisle between them. Laid any other way a room's label
     has nothing honest to point at, and two labels land on top of each
     other, which is what the first drawing of this did. */
  const order = [];
  const by = new Map();
  for (const r of drawn) {
    const key = r.room || '';
    if (!by.has(key)) { by.set(key, []); order.push(key); }
    by.get(key).push(r);
  }

  const placed = [];
  const blocks = [];
  let row = 0;
  for (const key of order) {
    const list = by.get(key);
    const wide = Math.min(cols, list.length);
    blocks.push({ room: key || null, count: list.length, row, wide });
    list.forEach((r, i) => {
      const x = i % cols;
      const y = (row + Math.floor(i / cols) * 1) * ROW;
      placed.push({ ...r, x, y, at: iso(x, y, HEIGHT) });
    });
    row += Math.ceil(list.length / cols) + AISLE;
  }

  // The floor they stand on, one cell of margin all round.
  const maxX = cols - 1;
  const maxY = Math.max(0, row - AISLE - 1) * ROW;
  const plate = [
    iso(-0.8, -0.8), iso(maxX + 0.8, -0.8),
    iso(maxX + 0.8, maxY + 0.8), iso(-0.8, maxY + 0.8),
  ];

  // Everything the picture has to hold: the plate, the top of the tallest
  // cabinet standing on it, and the room labels floating over both.
  const xs = [...plate.map((p) => p[0]), ...placed.map((p) => p.at[0])];
  const ys = [...plate.map((p) => p[1]), ...placed.map((p) => p.at[1] - 30)];
  const minx = Math.min(...xs, 0) - PAD;
  const maxx = Math.max(...xs, 0) + PAD;
  const miny = Math.min(...ys, 0) - PAD;
  const maxy = Math.max(...ys, 0) + PAD;

  // Grown to one shape, about the middle, so every Site gives the same band.
  let w = maxx - minx;
  let h = maxy - miny;
  let x0 = minx;
  let y0 = miny;
  if (w / h < ASPECT) { const want = h * ASPECT; x0 -= (want - w) / 2; w = want; }
  else { const want = w / ASPECT; y0 -= (want - h) / 2; h = want; }

  return { placed, plate, blocks, cols, view: { x: x0, y: y0, w, h }, cut: racks.length - drawn.length };
}

/* At most this many labels float over one floor. On the demo estate every
   room wanted one and they wrote over each other; the biggest rooms are the
   ones worth naming, and the rest are read by their colour. */
export const LABELS_MAX = 3;
/* And no two labels may sit closer than this share of the picture's height,
   or the one under is unreadable. */
export const LABEL_GAP = 0.15;

/**
 * One room's label: its name, and the share of its checked racks that match
 * the records. A room nothing has been checked in says so rather than
 * printing a nought per cent at somebody.
 *
 * Two blocks that read the same name are one label, not two: a Site whose
 * racks are partly in a named room and partly in none gave the same name
 * twice, one on top of the other. The biggest rooms keep their labels and
 * the rest are read by the colour of their cabinets.
 */
export function roomsOf(placed, blocks, where = null) {
  const by = new Map();
  for (const r of placed) {
    const key = r.room || '';
    if (!by.has(key)) by.set(key, []);
    by.get(key).push(r);
  }
  const marks = [];
  const seen = new Map();
  blocks.forEach((b, i) => {
    const list = by.get(b.room || '') || [];
    /* The name the label will actually carry. Racks in no room at all take
       the Site's own name, which is what the label used to print - so the
       merge has to happen on that name and not on the room, or a Site with
       some racks in a room and some in none writes its own name twice, one
       label under the other. */
    const name = b.room || where || null;
    const already = seen.get(name || '');
    if (already) { already.count += list.length; already.racks.push(...list); return; }
    // Over the room's own first row, and alternately along it.
    const x = (b.wide - 1) * (i % 2 === 0 ? 0.32 : 0.68);
    const mark = {
      key: `${name || 'floor'}-${i}`,
      name,
      count: list.length,
      racks: [...list],
      at: iso(x, b.row * ROW, HEIGHT + 16),
    };
    seen.set(name || '', mark);
    marks.push(mark);
  });
  return marks
    .sort((a, b) => b.count - a.count)
    .slice(0, LABELS_MAX)
    .map((m) => {
      const checked = m.racks.filter((r) => r.state !== 'unchecked');
      const good = checked.filter((r) => r.state === 'matched' || r.state === 'written');
      const off = checked.length - good.length;
      return {
        key: m.key,
        name: m.name,
        count: m.count,
        /* What this room is actually like, in the app's own words.
           It read "0% match" on the real estate, which is true and says
           nothing: every rack there carries a check and not one of them came
           back clean, so the figure was nought everywhere it was drawn. What
           a person wants to know is how many racks are in the room and how
           many of them are not as the records say. */
        word: checked.length === 0 ? 'Not checked yet'
          : off === 0 ? (m.count === 1 ? 'Matches' : `All ${m.count} match`)
            : `${off} unmatched`,
        at: m.at,
      };
    });
}

export default function EstateMap({ racks = [], where = null, onRack = null, cut = 0 }) {
  const floor = useMemo(() => floorOf(racks), [racks]);
  const rooms = useMemo(() => roomsOf(floor.placed, floor.blocks, where), [floor, where]);
  const { view } = floor;

  /* Where each label actually lands.
     A point in the drawing is first read as a share of the picture. Then it
     is pulled inside the frame - a label anchored over a cabinet at the left
     edge hung half off it - and pushed down off any label above it. Both were
     wrong on the real estate before this: three labels, one over another, one
     of them cut off by the edge of the floor. */
  const marks = useMemo(() => {
    const list = rooms
      .map((r) => ({
        ...r,
        sx: Math.min(0.82, Math.max(0.18, (r.at[0] - view.x) / view.w)),
        sy: Math.min(0.88, Math.max(0.13, (r.at[1] - view.y) / view.h)),
      }))
      .sort((a, b) => a.sy - b.sy);
    let last = -1;
    return list.filter((m) => {
      if (last >= 0 && m.sy - last < LABEL_GAP) m.sy = last + LABEL_GAP;
      if (m.sy > 0.92) return false;   // no room left for it on the floor
      last = m.sy;
      return true;
    });
  }, [rooms, view]);

  if (!floor.placed.length) return null;

  const left = cut || floor.cut;

  return (
    <div className={styles.map}>
      <div className={styles.stage} style={{ aspectRatio: `${ASPECT}` }}>
        <div className={styles.moves}>
          <svg
            className={styles.art}
            viewBox={`${view.x.toFixed(1)} ${view.y.toFixed(1)} ${view.w.toFixed(1)} ${view.h.toFixed(1)}`}
            role="img"
            aria-label={`The floor of ${where || 'your site'}, with ${floor.placed.length} racks drawn on it`}
          >
            <defs>
              <linearGradient id="em-plate" x1="0" y1="0" x2="0.4" y2="1">
                <stop offset="0%" stopColor="#F2F6FB" />
                <stop offset="60%" stopColor="#E7EEF7" />
                <stop offset="100%" stopColor="#DCE5F1" />
              </linearGradient>
              <radialGradient id="em-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#2B5CE0" stopOpacity=".16" />
                <stop offset="100%" stopColor="#2B5CE0" stopOpacity="0" />
              </radialGradient>
              <linearGradient id="em-sweep" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#3566DF" stopOpacity="0" />
                <stop offset="50%" stopColor="#3566DF" stopOpacity=".5" />
                <stop offset="100%" stopColor="#3566DF" stopOpacity="0" />
              </linearGradient>
              <clipPath id="em-plate-clip"><polygon points={pts(floor.plate)} /></clipPath>
              {/* The floor stops being a floor at the edges rather than
                  ending on a drawn line. A hard diamond with a stroke round
                  it read as a diagram of a room; this reads as a room. */}
              <radialGradient id="em-fade" cx="50%" cy="50%" r="58%">
                <stop offset="46%" stopColor="#FFFFFF" stopOpacity="1" />
                <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
              </radialGradient>
              <mask id="em-floor-mask">
                <rect x={view.x} y={view.y} width={view.w} height={view.h} fill="url(#em-fade)" />
              </mask>
            </defs>

            {/* the light the floor stands in */}
            <ellipse
              cx={(floor.plate[0][0] + floor.plate[2][0]) / 2}
              cy={(floor.plate[0][1] + floor.plate[2][1]) / 2}
              rx={view.w * 0.52} ry={view.h * 0.52}
              fill="url(#em-glow)"
            />

            {/* the floor itself, and the tiles on it */}
            <g mask="url(#em-floor-mask)">
            <polygon points={pts(floor.plate)} fill="url(#em-plate)" />
            <g clipPath="url(#em-plate-clip)" stroke="#C6D3E4" strokeWidth=".7" opacity=".6">
              {Array.from({ length: floor.cols + 3 }, (_, i) => {
                const a = iso(i - 1.2, -1.2);
                const b = iso(i - 1.2, 40);
                return <line key={`a${i}`} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />;
              })}
              {Array.from({ length: 30 }, (_, i) => {
                const a = iso(-1.2, i * 0.775 - 1.2);
                const b = iso(40, i * 0.775 - 1.2);
                return <line key={`b${i}`} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />;
              })}
              {/* the reading passing over the floor, once every few seconds */}
              <rect
                className="em-sweep"
                x={view.x} y={view.y} width={view.w * 0.3} height={view.h}
                fill="url(#em-sweep)"
              />
            </g>
            </g>

            {/* the cabinets, back row first so the front row stands over it */}
            {floor.placed.map((r) => {
              const tone = TONES[r.state] || TONES.unchecked;
              const f = (dx, dy, dz) => iso(r.x + dx, r.y + dy, dz);
              const top = [f(-FOOT_X, -FOOT_Y, HEIGHT), f(FOOT_X, -FOOT_Y, HEIGHT),
                f(FOOT_X, FOOT_Y, HEIGHT), f(-FOOT_X, FOOT_Y, HEIGHT)];
              const face = [f(-FOOT_X, FOOT_Y, HEIGHT), f(FOOT_X, FOOT_Y, HEIGHT),
                f(FOOT_X, FOOT_Y, 0), f(-FOOT_X, FOOT_Y, 0)];
              const side = [f(FOOT_X, FOOT_Y, HEIGHT), f(FOOT_X, -FOOT_Y, HEIGHT),
                f(FOOT_X, -FOOT_Y, 0), f(FOOT_X, FOOT_Y, 0)];
              const foot = iso(r.x, r.y, 0);
              // A cabinet opens only when there is something to open: a rack
              // set up in the estate but never photographed has no page yet.
              const open = onRack && r.rackId && r.open !== false ? () => onRack(r.rackId) : null;
              return (
                <g
                  key={r.key}
                  className={open ? styles.rack : styles.rackFlat}
                  role={open ? 'button' : undefined}
                  tabIndex={open ? 0 : undefined}
                  aria-label={open ? `${r.name || 'A rack not identified yet'}, ${r.word}` : undefined}
                  onClick={open || undefined}
                  onKeyDown={open ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } } : undefined}
                >
                  <ellipse cx={foot[0]} cy={foot[1] + 3} rx={TW * 0.46} ry={TH * 0.46} fill="#0B1524" opacity=".14" />
                  <polygon points={pts(side)} fill={tone.side} />
                  <polygon points={pts(face)} fill={tone.face} />
                  <polygon points={pts(top)} fill={tone.top} />
                  {/* the equipment behind the door, shelf by shelf */}
                  {[0.16, 0.30, 0.44, 0.58, 0.72, 0.86].map((v) => {
                    const a = f(-FOOT_X * 0.72, FOOT_Y, HEIGHT * (1 - v));
                    const b = f(FOOT_X * 0.72, FOOT_Y, HEIGHT * (1 - v));
                    return <line key={v} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#FFFFFF" strokeWidth="1.5" opacity=".3" strokeLinecap="round" />;
                  })}
                  {/* a rack with differences on it keeps a light on */}
                  {r.state === 'unmatched' && (
                    <circle className="em-alive" cx={iso(r.x, r.y, HEIGHT + 11)[0]} cy={iso(r.x, r.y, HEIGHT + 11)[1]} r="3" fill="#B4690E" />
                  )}
                </g>
              );
            })}
          </svg>

          {/* What each room holds, floating over the cabinets it names - the
              shape the owner pointed at on 23 Sep 2026. The figure is the
              share of that room's checked racks that match the records. */}
          {marks.map((room) => (
            <span
              key={room.key}
              className={styles.room}
              style={{ left: `${room.sx * 100}%`, top: `${room.sy * 100}%` }}
            >
              <span className={styles.roomName}>{room.name || 'This site'}</span>
              <span className={styles.roomFigure}>{room.word}</span>
            </span>
          ))}
        </div>

      </div>

      {/* What the colours mean, and anything the floor could not hold. */}
      <div className={styles.legend}>
        {LEGEND.map((l) => (
          <span key={l.key} className={styles.mean}>
            <span className={`${styles.dot} ${styles[l.key]}`} aria-hidden="true" />
            {l.label}
          </span>
        ))}
      </div>
      {left > 0 && (
        <p className={styles.more}>
          {left === 1 ? 'One more rack stands in this site.' : `${left} more racks stand in this site.`}
        </p>
      )}
    </div>
  );
}
