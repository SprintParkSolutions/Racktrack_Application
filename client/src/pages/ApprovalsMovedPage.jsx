import ExternalLink from '../components/ExternalLink.jsx';
import { APPROVALS_URL } from '../utils/approvals.js';
import styles from './ApprovalsMovedPage.module.css';

/**
 * Approvals has moved.
 *
 * Deciding on drift checks used to be two screens in this app. It is now
 * RackTrack Approvals, its own application on its own address. Old
 * bookmarks and old links in emails still land on the in-app paths, so those
 * paths show this page instead of a blank one: what happened, and one way on.
 */
export default function ApprovalsMovedPage() {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Approvals has moved</h1>
      <p className={styles.text}>
        Drift checks are now reviewed, assigned and written to NetBox in RackTrack Approvals.
        Sign in there with the same account.
      </p>
      <ExternalLink href={APPROVALS_URL} className={styles.primary}>
        Open Approvals
      </ExternalLink>
    </div>
  );
}
