import { useCallback, useMemo, useRef, useState } from 'react';
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
const HEIGHT = 34;            // how tall a cabinet stands
const FOOT_X = 0.40;          // half its footprint, across
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

/**
 * One room's label: its name, and the share of its checked racks that match
 * the records. A room nothing has been checked in says so rather than
 * printing a nought per cent at somebody.
 *
 * The label stands over the first row of the room's own cabinets, and every
 * other one is shifted along the row, so two rooms one aisle apart never
 * write over each other.
 */
export function roomsOf(placed, blocks) {
  const by = new Map();
  for (const r of placed) {
    const key = r.room || '';
    if (!by.has(key)) by.set(key, []);
    by.get(key).push(r);
  }
  return blocks.map((b, i) => {
    const list = by.get(b.room || '') || [];
    const checked = list.filter((r) => r.state !== 'unchecked');
    const good = checked.filter((r) => r.state === 'matched' || r.state === 'written');
    // Over the room's own first row, and alternately along it.
    const x = (b.wide - 1) * (i % 2 === 0 ? 0.32 : 0.68);
    const at = iso(x, b.row * ROW, HEIGHT + 16);
    return {
      key: b.room || `floor${i}`,
      name: b.room || null,
      count: list.length,
      figure: checked.length ? Math.round((good.length / checked.length) * 100) : null,
      at,
    };
  });
}

/* How far in a press of the control moves, and how far it may go. */
const STEP = 1.35;
const MIN_Z = 1;
const MAX_Z = 2.6;

export default function EstateMap({ racks = [], where = null, onRack = null, cut = 0 }) {
  const stage = useRef(null);
  const drag = useRef(null);
  const [z, setZ] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const floor = useMemo(() => floorOf(racks), [racks]);
  const rooms = useMemo(() => roomsOf(floor.placed, floor.blocks), [floor]);
  const { view } = floor;

  // A point in the drawing, as a share of the picture: what a label floating
  // over the floor is positioned by.
  const share = useCallback(([x, y]) => ({
    left: `${((x - view.x) / view.w) * 100}%`,
    top: `${((y - view.y) / view.h) * 100}%`,
  }), [view]);

  const zoom = useCallback((by) => {
    setZ((old) => {
      const next = Math.min(MAX_Z, Math.max(MIN_Z, old * by));
      if (next === MIN_Z) setPan({ x: 0, y: 0 });
      return next;
    });
  }, []);
  const recentre = useCallback(() => { setZ(1); setPan({ x: 0, y: 0 }); }, []);

  /* Dragging is only for a floor that has been moved in on: at rest the map
     is whole, and a swipe over it has to scroll the page like anywhere else.
     Once it is zoomed the stage takes the gesture, which is the only time it
     is worth taking. */
  const down = useCallback((e) => {
    if (z <= MIN_Z) return;
    drag.current = { x: e.clientX, y: e.clientY, from: pan };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not a real pointer */ }
  }, [z, pan]);
  const move = useCallback((e) => {
    const d = drag.current;
    if (!d) return;
    setPan({ x: d.from.x + (e.clientX - d.x), y: d.from.y + (e.clientY - d.y) });
  }, []);
  const up = useCallback(() => { drag.current = null; }, []);

  if (!floor.placed.length) return null;

  const left = cut || floor.cut;

  return (
    <div className={styles.map}>
      <div
        ref={stage}
        className={styles.stage}
        style={{ aspectRatio: `${ASPECT}`, touchAction: z > MIN_Z ? 'none' : 'pan-y' }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        <div
          className={styles.moves}
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${z})` }}
        >
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
            </defs>

            {/* the light the floor stands in */}
            <ellipse
              cx={(floor.plate[0][0] + floor.plate[2][0]) / 2}
              cy={(floor.plate[0][1] + floor.plate[2][1]) / 2}
              rx={view.w * 0.52} ry={view.h * 0.52}
              fill="url(#em-glow)"
            />

            {/* the floor itself, and the tiles on it */}
            <polygon points={pts(floor.plate)} fill="url(#em-plate)" stroke="#C8D4E4" strokeWidth="1.2" strokeLinejoin="round" />
            <g clipPath="url(#em-plate-clip)" stroke="#CBD7E7" strokeWidth=".7" opacity=".85">
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
                  {/* the equipment behind the door, three shelves of it */}
                  {[0.26, 0.48, 0.70].map((v) => {
                    const a = f(-FOOT_X * 0.72, FOOT_Y, HEIGHT * (1 - v));
                    const b = f(FOOT_X * 0.72, FOOT_Y, HEIGHT * (1 - v));
                    return <line key={v} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#FFFFFF" strokeWidth="1.6" opacity=".38" strokeLinecap="round" />;
                  })}
                  {/* a rack with differences on it keeps a light on */}
                  {r.state === 'unmatched' && (
                    <circle className="em-alive" cx={iso(r.x, r.y, HEIGHT + 11)[0]} cy={iso(r.x, r.y, HEIGHT + 11)[1]} r="3.4" fill="#B4690E" />
                  )}
                </g>
              );
            })}
          </svg>

          {/* What each room holds, floating over the cabinets it names - the
              shape the owner pointed at on 23 Sep 2026. The figure is the
              share of that room's checked racks that match the records. */}
          {rooms.map((room) => (
            <span key={room.key} className={styles.room} style={share(room.at)}>
              <span className={styles.roomName}>{room.name || where || 'This site'}</span>
              <span className={styles.roomFigure}>
                {room.figure === null ? 'Not checked' : `${room.figure}% match`}
              </span>
            </span>
          ))}
        </div>

        {/* Move in, move out, put it back. The glyphs are drawn rather than
            typed, so no sign leaks into the page's words. */}
        <div className={styles.controls}>
          <button type="button" className={styles.control} onClick={() => zoom(STEP)} aria-label="Move in">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M12 6v12M6 12h12" />
            </svg>
          </button>
          <button type="button" className={styles.control} onClick={() => zoom(1 / STEP)} aria-label="Move out">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 12h12" />
            </svg>
          </button>
          <button type="button" className={styles.control} onClick={recentre} aria-label="Put the floor back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="4.4" /><path d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21" />
            </svg>
          </button>
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
