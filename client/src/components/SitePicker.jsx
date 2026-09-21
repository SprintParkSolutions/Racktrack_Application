import { useMemo, useState } from 'react';
import styles from './SitePicker.module.css';

/* Which site this scan is for.
 *
 * The phone used to guess it: it asked for a position when the scan page
 * opened and sent that along with the photo. Indoors a position is wrong by
 * more than a building, and the question it was answering is one the
 * technician can answer in a tap. So the site is chosen here, by its number
 * and its name, and that choice goes with the photo.
 *
 * Three shapes, by how many sites the server says this person may scan for:
 *   none    - nothing is drawn, and the scan goes as it always did. This is
 *             also what a server without the site list looks like.
 *   one     - a line that states it. There is nothing to choose, so there is
 *             no control.
 *   several - a search over the list. The scan waits for a choice, which is
 *             why this is the one field on the screen that carries an asterisk.
 */

/* "Site 32". The server sends it ready made; a server that does not is still
   sending the number. */
export const siteLabel = (s) => String(s?.siteId || `Site ${s?.id}`);

const rackWords = (n) => `${n} ${n === 1 ? 'rack' : 'racks'}`;
const rackTotal = (s) => (Number.isFinite(s?.rackCount) ? s.rackCount : (s?.racks || []).length);

/* A rack nobody has named yet is known only by its internal id, which is not
   something to print. It still counts towards the total. */
const rackName = (r) => {
  const n = String(r?.name || '').trim();
  return n && !/^RK-[0-9A-F]+$/i.test(n) ? n : null;
};

/* The second line of a row: up to three racks by name, then how many more. */
export function rackLine(s) {
  const total = rackTotal(s);
  if (!total) return 'No racks yet';
  const names = (s.racks || []).map(rackName).filter(Boolean).slice(0, 3);
  if (!names.length) return rackWords(total);
  const rest = total - names.length;
  return names.join(', ') + (rest > 0 ? ` and ${rest} more` : '');
}

/* By number ("32"), by the words on the row ("site 32") or by name. */
export function siteMatches(s, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return [String(s.id), siteLabel(s), s.name].some((v) => String(v || '').toLowerCase().includes(q));
}

// Anything else (a data- attribute the page wants on the block) lands on the
// wrapper, so the page never needs a box of its own around a picker that may
// draw nothing.
export default function SitePicker({ sites = [], value = '', onChange, className = '', ...rest }) {
  const [query, setQuery] = useState('');
  // Only ever true because the person asked to change a choice already made.
  // With nothing chosen the list is open regardless.
  const [changing, setChanging] = useState(false);

  const chosen = useMemo(() => sites.find((s) => String(s.id) === String(value)) || null, [sites, value]);
  const shown = useMemo(() => sites.filter((s) => siteMatches(s, query)), [sites, query]);

  if (!sites.length) return null;

  if (sites.length === 1) {
    const only = sites[0];
    return (
      <div className={`${styles.wrap} ${className}`} {...rest}>
        <span className={styles.lbl}>Site</span>
        <p className={styles.one}>{[siteLabel(only), only.name, rackWords(rackTotal(only))].filter(Boolean).join(' - ')}</p>
      </div>
    );
  }

  const pick = (s) => {
    setChanging(false);
    setQuery('');
    onChange?.(String(s.id));
  };

  if (chosen && !changing) {
    return (
      <div className={`${styles.wrap} ${className}`} {...rest}>
        <span className={styles.lbl}>Site<span className={styles.star} aria-hidden="true">*</span></span>
        <div className={styles.chosen}>
          <div className={styles.chosenText}>
            <span className={styles.rowMain}>{[siteLabel(chosen), chosen.name].filter(Boolean).join(' - ')}</span>
            <span className={styles.rowSub}>{rackLine(chosen)}</span>
          </div>
          <button type="button" className={styles.swap} onClick={() => setChanging(true)}>Change</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.wrap} ${className}`} {...rest}>
      <label htmlFor="scan-site" className={styles.lbl}>Site<span className={styles.star} aria-hidden="true">*</span></label>
      <input id="scan-site" type="search" className={styles.find} value={query}
        placeholder="Search by site number or name" aria-required="true"
        autoComplete="off" autoCorrect="off" spellCheck={false}
        onChange={(e) => setQuery(e.target.value)} />
      {shown.length > 0 ? (
        <ul className={styles.rows} aria-label="Sites">
          {shown.map((s) => {
            const on = String(s.id) === String(value);
            return (
              <li key={s.id}>
                <button type="button" className={`${styles.row} ${on ? styles.rowOn : ''}`}
                  aria-pressed={on} onClick={() => pick(s)}>
                  <span className={styles.rowMain}>{[siteLabel(s), s.name].filter(Boolean).join(' - ')}</span>
                  <span className={styles.rowSub}>{rackLine(s)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={styles.none}>No site matches that.</p>
      )}
    </div>
  );
}
