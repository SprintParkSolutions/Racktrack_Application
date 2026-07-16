import { useNavigate, useLocation } from 'react-router-dom';
import styles from './RackTabs.module.css';
import { useGroupView } from '../hooks/useGroupView';

/**
 * RackTabs — the rack switcher for a two-rack scan on mobile. Shows a clean
 * "Rack 1 | Rack 2" pill toggle (matching the toggle used on Ports / Switches /
 * Network / Drift) plus a small jump to the combined 3D view. Renders nothing
 * for standalone scans, or when the ?group signal isn't present.
 */
export default function RackTabs({ rackId }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { data, loading, isGroup, members, groupParam } = useGroupView(rackId);

  // Only render for an actual two-rack scan the user is viewing AS a group
  // (the ?group signal is present). A single-rack scan — even of a photo that
  // was once part of a group — never shows the rack strip.
  if (loading || !isGroup) return null;
  // Preserve the sub-page suffix + the ?group signal when switching racks.
  //   /results/:rackId             → no suffix (overview)
  //   /results/:rackId/ports       → /ports
  const segments = location.pathname.split('/').filter(Boolean);
  const rest = segments.slice(2).join('/');
  const suffix = rest ? `/${rest}` : '';
  const gq = groupParam ? `?group=${encodeURIComponent(groupParam)}` : '';

  return (
    <nav className={styles.bar} aria-label="Racks in this scan">
      {members.map((m) => {
        const isCurrent = m.rack_id === rackId;
        return (
          <button
            key={m.rack_id}
            role="tab"
            aria-selected={isCurrent}
            className={`${styles.pill} ${isCurrent ? styles.pillOn : ''}`}
            disabled={isCurrent}
            onClick={() => navigate(`/results/${encodeURIComponent(m.rack_id)}${suffix}${gq}`)}
            title={m.rack_id}
          >
            <span className={styles.pos}>#{m.position}</span>
            {m.label || `Rack ${m.position}`}
          </button>
        );
      })}

      {data.group && (
        <button
          className={styles.threeD}
          onClick={() => navigate(`/multi-rack/${encodeURIComponent(data.group.id)}/topology`)}
          title="Open all racks in one 3D scene"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          3D
        </button>
      )}
    </nav>
  );
}
