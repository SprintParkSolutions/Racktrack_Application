import { useMemo } from 'react';
import styles from './RackPicture.module.css';

/**
 * The rack, drawn top down, one row per shelf.
 *
 * A dropdown that says "U14 - switch (24p)" only helps somebody who already
 * knows which shelf is which. A picture of the rack is the thing a person
 * standing in front of it can compare with, so this draws every shelf from the
 * top down, puts each device in its own shelf, and can lift one device out of
 * the rest by dimming everything else.
 *
 * The drawing follows the ruler-and-column layout and the category colours of
 * the rack planning guide in docs/reference, rewritten as a component: a ruler
 * of unit numbers down the left, a column of shelves beside it, colour by what
 * kind of box it is, and the name and port count written in the shelf so the
 * colour is never the only thing carrying the meaning.
 *
 * Nothing here states more than was recorded. A rack whose height nobody wrote
 * down is drawn to the tallest box the camera saw and labelled as that, never
 * as the height of the rack, and a shelf with no box detected says so rather
 * than calling itself empty.
 *
 * Props
 *   devices   the camera's devices: { uid, name, position, portCount, cvClass }
 *   size      how many shelves the rack has, or null when nobody recorded it
 *   highlight the uid to lift out of the rest, or null for none
 *   onPick    called with a uid when a shelf is chosen; omit for a flat picture
 */

/** The six kinds of box the picture colours, and what falls in each. */
const CATEGORY = [
  ['network', /switch|router|firewall|gateway|wireless|access point|wlc|load balancer/i],
  ['cabling', /patch|cable|fibre|fiber|odf/i],
  ['compute', /server|blade|compute|host|appliance/i],
  ['storage', /storage|nas|san|disk|tape|array/i],
  ['power', /pdu|ups|power|socket|rail/i],
];

/** Which colour a box gets. Anything unrecognised is support, never a guess. */
export function categoryOf(device) {
  const text = `${(device && device.cvClass) || ''} ${(device && device.name) || ''}`;
  for (const [name, test] of CATEGORY) if (test.test(text)) return name;
  return 'support';
}

/** What the legend says, in the order the rack tends to be built. */
const LEGEND = [
  ['network', 'Network'],
  ['cabling', 'Cabling'],
  ['compute', 'Compute'],
  ['storage', 'Storage'],
  ['power', 'Power'],
  ['support', 'Other'],
];

/** Every shelf a device sits on, from whatever the scan recorded about it. */
function unitsOf(device) {
  const raw = Array.isArray(device && device.units) ? device.units : null;
  if (raw && raw.length) {
    const nums = raw
      .map((u) => Number(String(u).replace(/\D/g, '')))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (nums.length) return nums;
  }
  const start = Number(device && device.position);
  if (!Number.isFinite(start) || start <= 0) return [];
  const height = Math.max(1, Math.min(12, Number(device.ru || device.uHeight || device.size || 1) || 1));
  const out = [];
  for (let i = 0; i < height; i += 1) out.push(start + i);
  return out;
}

const MAX_SHELVES = 60;   // a picture, not a wall chart: enough for any real rack

export default function RackPicture({ devices, size, highlight = null, onPick = null }) {
  // One stable list, so the shelves are only worked out again when the devices
  // actually change rather than on every render.
  const list = useMemo(() => (Array.isArray(devices) ? devices : []), [devices]);

  const {
    shelves, byUnit, unplaced, shared, above, height,
  } = useMemo(() => {
    const placed = new Map();     // shelf number -> { device, top }
    const loose = [];             // no shelf recorded at all
    const doubled = [];           // its shelf already belongs to another box
    let tallest = 0;

    for (const d of list) {
      const units = unitsOf(d);
      if (units.length === 0) { loose.push(d); continue; }
      // The whole span is checked before any of it is claimed. Taking the free
      // shelves and then filing the box as unplaced as well drew one device in
      // two places at once, and lit two things up when it was the highlighted
      // one.
      if (units.some((u) => placed.has(u))) { doubled.push(d); continue; }
      const top = Math.max(...units);
      for (const u of units) {
        tallest = Math.max(tallest, u);
        placed.set(u, { device: d, top: u === top });
      }
    }

    const asked = Number(size);
    const known = Number.isFinite(asked) && asked > 0 ? Math.floor(asked) : null;
    const count = Math.min(MAX_SHELVES, Math.max(1, known || 0, tallest));

    // Above the last shelf this picture draws. A box up there used to land in
    // no row and in no list, which is the one thing a picture of a rack must
    // not do, so it is named underneath instead.
    const cut = [];
    for (const [u, at] of [...placed.entries()]) {
      if (u > count) { placed.delete(u); cut.push(at.device); }
    }
    const drawn = new Set([...placed.values()].map((x) => x.device));
    const overflow = cut.filter((d, i) => !drawn.has(d) && cut.indexOf(d) === i);

    const rows = [];
    for (let u = count; u >= 1; u -= 1) rows.push(u);
    return {
      shelves: rows, byUnit: placed, unplaced: loose,
      shared: doubled, above: overflow, height: known,
    };
  }, [list, size]);

  const dimOthers = Boolean(highlight);
  const used = new Set([...byUnit.values()].map((x) => x.device.uid));

  // What the bar over the picture may state. A height nobody recorded is not a
  // measurement of the rack, it is the tallest box the camera happened to see,
  // and "12U rack" printed over a 42U rack tells a technician the rack ends
  // where the picture does.
  const bar = height === null
    ? ['Boxes the camera placed', 'Rack height not recorded']
    : height > shelves.length
      ? [`${height}U rack`, `U1 to U${shelves.length} drawn here`]
      : [`${height}U rack`, `U${shelves.length} at the top, U1 at the bottom`];

  const group = (head, items) => (items.length > 0 ? (
    <div className={styles.loose} key={head}>
      <p className={styles.looseHead}>{head}</p>
      <div className={styles.looseRow}>
        {items.map((d, i) => {
          const on = highlight && d.uid === highlight;
          const cls = [
            styles.chip,
            styles[`cat_${categoryOf(d)}`],
            on ? styles.on : '',
            dimOthers && !on ? styles.dim : '',
          ].join(' ');
          const text = `${d.name || 'Device'}${d.portCount ? ` · ${d.portCount}p` : ''}`;
          return onPick ? (
            <button
              key={d.uid || `${head}${i}`}
              type="button"
              className={cls}
              aria-pressed={Boolean(on)}
              onClick={() => onPick(d.uid)}
            >
              {text}
            </button>
          ) : (
            <span key={d.uid || `${head}${i}`} className={cls}>{text}</span>
          );
        })}
      </div>
    </div>
  ) : null);

  const shelfLabel = (d, u) => `U${u}, ${d.name || 'device'}${d.portCount ? `, ${d.portCount} ports` : ''}`;

  return (
    <div className={styles.wrap}>
      <div className={styles.bar}>
        <b>{bar[0]}</b>
        <span>{bar[1]}</span>
      </div>

      <div className={styles.frame}>
        <div className={styles.ruler} aria-hidden="true">
          {shelves.map((u) => (
            <div key={u} className={`${styles.tick} ${u % 5 === 0 ? styles.tick5 : ''}`}>U{u}</div>
          ))}
        </div>

        <div className={styles.column}>
          {shelves.map((u) => {
            const at = byUnit.get(u);
            if (!at) {
              // The camera saying nothing about a shelf is not the shelf being
              // free: a blank panel, a dark faceplate or a box out of frame all
              // come back as silence. The title says what is known.
              return <div key={u} className={styles.empty} title={`No box detected at U${u}`} />;
            }
            const d = at.device;
            const on = highlight && d.uid === highlight;
            const cls = [
              styles.box,
              styles[`cat_${categoryOf(d)}`],
              at.top ? '' : styles.cont,
              on ? styles.on : '',
              dimOthers && !on ? styles.dim : '',
            ].join(' ');

            if (!onPick) {
              return (
                <div key={u} className={cls} title={shelfLabel(d, u)}>
                  {at.top && <span className={styles.name}>{d.name || 'Device'}</span>}
                  {at.top && d.portCount ? <span className={styles.ports}>{d.portCount}p</span> : null}
                </div>
              );
            }
            return (
              <button
                key={u}
                type="button"
                className={cls}
                aria-pressed={Boolean(on)}
                aria-label={shelfLabel(d, u)}
                title={shelfLabel(d, u)}
                onClick={() => onPick(d.uid)}
              >
                {at.top && <span className={styles.name}>{d.name || 'Device'}</span>}
                {at.top && d.portCount ? <span className={styles.ports}>{d.portCount}p</span> : null}
              </button>
            );
          })}
        </div>
      </div>

      <p className={styles.blankNote}>
        A blank shelf means nothing was detected there.
      </p>

      {group('No shelf recorded', unplaced)}
      {group('Sharing a shelf', shared)}
      {group(`Above U${shelves.length}`, above)}

      <div className={styles.legend}>
        {LEGEND.filter(([cat]) => list.some((d) => categoryOf(d) === cat
          && (used.has(d.uid) || unplaced.includes(d) || shared.includes(d) || above.includes(d))))
          .map(([cat, text]) => (
            <span key={cat}>
              <i className={styles[`cat_${cat}`]} aria-hidden="true" />
              {text}
            </span>
          ))}
      </div>
    </div>
  );
}
