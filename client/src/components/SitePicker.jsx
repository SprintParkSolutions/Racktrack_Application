import styles from './SitePicker.module.css';

/* Which site this scan is for.
 *
 * The phone used to guess it: it asked for a position when the scan page
 * opened and sent that along with the photo. Indoors a position is wrong by
 * more than a building, and the question it was answering is one the
 * technician can answer in a tap. So the site is chosen here, by its number
 * and its name, and that choice goes with the photo.
 *
 * It is a dropdown, and now the only picker on the scan page: the site is
 * enough, so the space that used to sit under it is gone. By how many sites
 * the server says this person may scan for:
 *   none    - nothing is drawn, and the scan goes as it always did. This is
 *             also what a server without the site list looks like.
 *   one     - the dropdown holds that one site, already chosen.
 *   several - the dropdown opens on "Choose a site". The scan waits for a
 *             choice, which is why this is the one field on the screen that
 *             carries an asterisk.
 * Under it, the racks of the chosen site, by name.
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
  if (!sites.length) return null;

  const one = sites.length === 1;
  const current = one ? String(sites[0].id) : String(value || '');
  const chosen = sites.find((s) => String(s.id) === current) || null;

  return (
    <div className={`${styles.wrap} ${className}`} {...rest}>
      <label htmlFor="scan-site" className={styles.lbl}>
        Site{!one && <span className={styles.star} aria-hidden="true">*</span>}
      </label>
      <select id="scan-site" className={styles.siteSelect} value={current}
        aria-required={one ? undefined : 'true'}
        onChange={(e) => onChange?.(String(e.target.value))}>
        {!one && <option value="">Choose a site</option>}
        {sites.map((s) => (
          <option key={s.id} value={String(s.id)}>{[siteLabel(s), s.name].filter(Boolean).join(' - ')}</option>
        ))}
      </select>
      {chosen && <span className={styles.rowSub}>{rackLine(chosen)}</span>}
    </div>
  );
}
