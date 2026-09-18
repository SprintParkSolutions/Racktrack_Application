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
 * Props
 *   devices   the camera's devices: { uid, name, position, portCount, cvClass }
 *   size      how many shelves the rack has
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

  const { shelves, byUnit, unplaced } = useMemo(() => {
    const placed = new Map();     // shelf number -> { device, top }
    const loose = [];
    let tallest = 0;

    for (const d of list) {
      const units = unitsOf(d);
      if (units.length === 0) { loose.push(d); continue; }
      const top = Math.max(...units);
      for (const u of units) {
        tallest = Math.max(tallest, u);
        // Two boxes claiming one shelf is the camera's business, not ours: the
        // first one drawn keeps the shelf and the second is shown underneath as
        // unplaced, so nothing is dropped and nothing is drawn twice.
        if (placed.has(u)) { loose.push(d); break; }
        placed.set(u, { device: d, top: u === top });
      }
    }

    const asked = Number(size);
    const count = Math.min(
      MAX_SHELVES,
      Math.max(1, Number.isFinite(asked) && asked > 0 ? asked : 0, tallest),
    );
    const rows = [];
    for (let u = count; u >= 1; u -= 1) rows.push(u);
    return { shelves: rows, byUnit: placed, unplaced: loose };
  }, [list, size]);

  const dimOthers = Boolean(highlight);
  const used = new Set([...byUnit.values()].map((x) => x.device.uid));

  const shelfLabel = (d, u) => `U${u}, ${d.name || 'device'}${d.portCount ? `, ${d.portCount} ports` : ''}`;

  return (
    <div className={styles.wrap}>
      <div className={styles.bar}>
        <b>{shelves.length}U rack</b>
        <span>U{shelves.length} at the top, U1 at the bottom</span>
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
              return <div key={u} className={styles.empty} title={`U${u} is empty`} />;
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

      {unplaced.length > 0 && (
        <div className={styles.loose}>
          <p className={styles.looseHead}>
            Seen in the photo but not on a shelf
          </p>
          <div className={styles.looseRow}>
            {unplaced.map((d, i) => {
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
                  key={d.uid || `loose${i}`}
                  type="button"
                  className={cls}
                  aria-pressed={Boolean(on)}
                  onClick={() => onPick(d.uid)}
                >
                  {text}
                </button>
              ) : (
                <span key={d.uid || `loose${i}`} className={cls}>{text}</span>
              );
            })}
          </div>
        </div>
      )}

      <div className={styles.legend}>
        {LEGEND.filter(([cat]) => list.some((d) => categoryOf(d) === cat && (used.has(d.uid) || unplaced.includes(d))))
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
