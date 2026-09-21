import ExternalLink from '../components/ExternalLink.jsx';
import { APPROVALS_URL } from '../utils/approvals.js';
import styles from './ApprovalsMovedPage.module.css';

/**
 * Deciding has moved out of this app.
 *
 * Deciding on drift checks used to be two screens here. It is now RackTrack
 * Changes, its own application. Old bookmarks and old links in emails still
 * land on the in-app paths, so those paths show this page instead of a blank
 * one: what happened, and one way on.
 */
export default function ApprovalsMovedPage() {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>This has moved to RackTrack Drift Desk</h1>
      <p className={styles.text}>
        Drift checks are now reviewed, assigned and written to NetBox in RackTrack Drift Desk.
        It opens signed in, on this same account.
      </p>
      <ExternalLink href={APPROVALS_URL} className={styles.primary}>
        Open Drift Desk
      </ExternalLink>
    </div>
  );
}
