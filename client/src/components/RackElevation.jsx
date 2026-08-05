import { useEffect, useRef, useState } from 'react';
import styles from './RackElevation.module.css';

/**
 * A 42U rack elevation, drawn — not photographed.
 *
 * Every sign-in page in this genre puts a stock photo or a 3D mascot in the
 * left panel. Those are interchangeable: swap the image and it's a different
 * company's page. This is a technical drawing of the exact object RackTrack
 * exists to describe, built from the same U-positions and device tags the app
 * uses everywhere else (U01-SW01, U10-PDU01), so it could not sit on anyone
 * else's site.
 *
 * On mount a scan line sweeps the rack once and each device resolves as the
 * line crosses it — the product's own gesture, not decoration. It runs once,
 * never loops, and does nothing at all under prefers-reduced-motion.
 *
 * Rack convention: U01 is at the BOTTOM. Row 1 of the grid is U42, so a device
 * mounted at U(n) spanning h units starts at grid row 43 - n - (h - 1).
 */

const RACK_U = 42;

// The same rack the rest of the app demonstrates with (see RACKS in HomePage).
const DEVICES = [
  { u: 1,  h: 1, tag: 'SW01',  kind: 'Switch',       ports: 24 },
  { u: 2,  h: 1, tag: 'SW02',  kind: 'Switch',       ports: 12 },
  { u: 5,  h: 1, tag: 'FW01',  kind: 'Firewall',     ports: 8  },
  { u: 7,  h: 1, tag: 'PP01',  kind: 'Patch panel',  ports: 48 },
  { u: 10, h: 2, tag: 'PDU01', kind: 'PDU',          ports: 6, warn: true },
];

const rowStart = (u, h) => RACK_U + 1 - u - (h - 1);

// U-marks every 5 units, the way a real elevation is ruled.
const TICKS = Array.from({ length: RACK_U }, (_, i) => RACK_U - i)
  .filter(u => u === 1 || u % 5 === 0);

export default function RackElevation() {
  const [scanned, setScanned] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setScanned(true);            // straight to the resolved state
      return;
    }
    // One frame's delay so the sweep starts from a painted rack rather than
    // racing the first paint.
    const t = setTimeout(() => setScanned(true), 80);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className={styles.wrap} ref={ref} aria-hidden="true">
      <div className={styles.head}>
        <span className={styles.headId}>Rack R-101</span>
        <span className={styles.headSite}>Chennai-DC1</span>
      </div>

      <div className={`${styles.rack} ${scanned ? styles.scanned : ''}`}>
        {/* Ruler */}
        <div className={styles.rail}>
          {TICKS.map(u => (
            <span key={u} className={styles.tick} style={{ gridRow: rowStart(u, 1) }}>
              {String(u).padStart(2, '0')}
            </span>
          ))}
        </div>

        <div className={styles.slots}>
          {/* Empty U slots — the hairlines that make it read as a drawing. */}
          {Array.from({ length: RACK_U }, (_, i) => (
            <span key={i} className={styles.slot} style={{ gridRow: i + 1 }} />
          ))}

          {DEVICES.map((d, i) => (
            <div
              key={d.tag}
              className={`${styles.dev} ${d.warn ? styles.devWarn : ''}`}
              style={{
                gridRow: `${rowStart(d.u, d.h)} / span ${d.h}`,
                // Each device resolves as the sweep reaches it, so the order
                // follows the line down the rack rather than the array.
                transitionDelay: `${260 + i * 90}ms`,
              }}
            >
              <span className={styles.devTag}>{d.tag}</span>
              <span className={styles.devKind}>{d.kind}</span>
              <span className={styles.devPorts}>{d.ports}p</span>
            </div>
          ))}

          <span className={styles.scanline} />
        </div>
      </div>

      <div className={styles.foot}>
        <span><b>24</b> of 42U mapped</span>
        <span><b>98</b> ports</span>
        <span><b>5</b> devices</span>
      </div>
    </div>
  );
}
