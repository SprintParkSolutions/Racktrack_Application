import { useAuth } from '../AuthContext.jsx';
import { useApprovalsCan } from '../hooks/useApprovalsCan.js';
import { useAppView, roleOfUser } from '../hooks/useAppView.js';
import { VIEW_LABEL } from '../utils/appView.js';
import styles from './ViewToggle.module.css';

/**
 * Which pair of eyes the app is in.
 *
 * An admin or a single point of contact can also be asked to walk to a rack,
 * so they may shift the whole app to the employee's - the camera, two racks,
 * their scan history. An employee has one job and no toggle: a row of one is a
 * label pretending to be a choice.
 *
 * It sat at the top of Home. The owner moved it on 23 September 2026 into the
 * Menu and the sidebar, which is where the rest of the app's own controls are,
 * and one component draws it in both so the two can never disagree about what
 * it says or which view is lit.
 *
 * It draws nothing at all when there is nothing to shift to.
 */
export default function ViewToggle({ onShift = null, className = '' }) {
  const { user } = useAuth();
  const can = useApprovalsCan();
  const { view, views, shift } = useAppView(roleOfUser(user, can), user && user.id);
  if (!views || views.length < 2) return null;
  return (
    <div className={`${styles.wrap} ${className}`}>
      <p className={styles.title}>How you are working today</p>
      <div className={styles.views} role="tablist" aria-label="How you are working today">
        {views.map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            className={`${styles.tab} ${view === v ? styles.on : ''}`}
            onClick={() => { shift(v); if (onShift) onShift(v); }}
          >
            {VIEW_LABEL[v]}
          </button>
        ))}
      </div>
    </div>
  );
}
