/**
 * The single source of truth for the app's primary destinations.
 *
 * The sidebar (DesktopShell) and the phone's bottom bar used to each keep
 * their own hardcoded list. They drifted: the sidebar grew to eight
 * role-gated destinations while the bottom bar stayed at three constants,
 * so Lab and Marketplace became unreachable by tapping on a phone - the
 * routes worked, nothing linked to them.
 *
 * Both navigations now read this list, so a destination added here shows up
 * everywhere or nowhere. Add new destinations HERE, not in a component.
 */
import { useAuth } from '../AuthContext.jsx';
import { APPROVALS_URL } from '../utils/approvals.js';

/* ── icons ─────────────────────────────────────────────────────────────
   Stroked 24px outlines, sized by the consuming stylesheet. */
const s = {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
};

export const HomeIcon = () => (
  <svg {...s}><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1z"/><path d="M9 21V12h6v9"/></svg>
);
export const ScanIcon = () => (
  <svg {...s}><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
);
export const ProfileIcon = () => (
  <svg {...s}><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
);
export const MarketIcon = () => (
  <svg {...s}><path d="M3 7l1.5-3h15L21 7"/><path d="M3 7v12a1 1 0 001 1h16a1 1 0 001-1V7"/><path d="M8 7v3a4 4 0 008 0V7"/></svg>
);
export const DashboardIcon = () => (
  <svg {...s}><path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 4-6"/></svg>
);
export const DataSourcesIcon = () => (
  <svg {...s}><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5"/><path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"/></svg>
);
export const TwoRackIcon = () => (
  <svg {...s}><rect x="3" y="3" width="7" height="18" rx="1"/><rect x="14" y="3" width="7" height="18" rx="1"/><path d="M10 8h4"/></svg>
);
export const HistoryIcon = () => (
  <svg {...s}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/><path d="M3.5 12H5"/></svg>
);
export const LabIcon = () => (
  <svg {...s}><path d="M9 3v6.5L4.5 18A2 2 0 006.3 21h11.4a2 2 0 001.8-3L15 9.5V3"/><path d="M8 3h8"/><path d="M7.5 14h9"/></svg>
);
export const GroundTruthIcon = () => (
  <svg {...s}><circle cx="12" cy="12" r="9"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg>
);
export const OrgIcon = () => (
  <svg {...s}><path d="M3 21h18"/><path d="M5 21V6a1 1 0 011-1h6a1 1 0 011 1v15"/><path d="M13 21V10a1 1 0 011-1h4a1 1 0 011 1v11"/><path d="M8 9h1M8 13h1M8 17h1M16 13h.5M16 17h.5"/></svg>
);
export const HelpIcon = () => (
  <svg {...s}><circle cx="12" cy="12" r="9"/><path d="M9.2 9a2.9 2.9 0 015.6 1c0 2-2.8 2.6-2.8 4"/><circle cx="12" cy="17.4" r="1" fill="currentColor" stroke="none"/></svg>
);
export const ContactIcon = () => (
  <svg {...s}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 7l8.5 6 8.5-6"/></svg>
);
export const SwitchTestIcon = () => (
  <svg {...s}><rect x="2" y="8" width="20" height="8" rx="2"/><path d="M6 12h.01M10 12h.01M14 12h.01"/><path d="M18 3v3M16.5 4.5h3"/></svg>
);
export const InboxIcon = () => (
  <svg {...s}><path d="M3 12h5l2 3h4l2-3h5"/><path d="M3 12V6a2 2 0 012-2h14a2 2 0 012 2v6"/><path d="M3 12v6a2 2 0 002 2h14a2 2 0 002-2v-6"/></svg>
);
export const SetupIcon = () => (
  <svg {...s}><path d="M9 6h11"/><path d="M9 12h11"/><path d="M9 18h11"/><path d="M4 6l1 1 2-2"/><path d="M4 12l1 1 2-2"/><path d="M4 18l1 1 2-2"/></svg>
);
export const MoreIcon = () => (
  <svg {...s}><circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/></svg>
);

/* ── the destinations ──────────────────────────────────────────────────
   Grouped, in the order a person meets them: the rack work first, then the
   organisation, then the platform (owner only), then help, then the account.
   `group` keys into NAV_GROUPS; the sidebar and the phone's Menu both draw
   headings from it. `hint` is the one-line description shown under the name
   in the sidebar and the Menu. `inBar` marks the four that get a permanent
   slot in the phone's bottom bar; `barLabel` is a shorter name for that slot.
   A destination has either `to` (a page in this app) or `href` (somewhere
   outside it, opened in a new tab or the system browser). */
export const NAV_GROUPS = [
  { key: 'work',     title: 'Rack work' },
  { key: 'org',      title: 'Organization' },
  { key: 'platform', title: 'Platform' },
  { key: 'help',     title: 'Help' },
  { key: 'account',  title: 'Account' },
];

export function usePrimaryNav() {
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';
  const isAdmin = isOwner || user?.role === 'org_admin';

  return [
    // ── Rack work: the app opens on the work, so Scan is first.
    { group: 'work', to: '/scan', label: 'Scan a rack', icon: <ScanIcon />, end: false,
      inBar: true, barLabel: 'Scan',
      hint: 'Photograph a rack' },
    { group: 'work', to: '/multi-rack/new', label: 'Two racks', icon: <TwoRackIcon />, end: false,
      inBar: true, barLabel: '2 Racks',
      hint: 'Two racks as one job' },
    { group: 'work', to: '/history', label: 'Scan history', icon: <HistoryIcon />, end: false,
      hint: 'Past scans and reports' },
    // Approvals is its own application on its own address, so this
    // entry carries `href` instead of `to`: the bar, the Menu and the sidebar
    // draw it as a link that leaves the app (components/ExternalLink.jsx).
    ...(isAdmin ? [{ group: 'work', href: APPROVALS_URL, label: 'Changes', icon: <InboxIcon />,
      inBar: true,
      hint: 'Opens RackTrack Changes' }] : []),

    // ── Organization: owners and organisation admins.
    ...(isAdmin ? [{ group: 'org', to: '/organizations', label: 'Organizations', icon: <OrgIcon />, end: false,
      hint: 'Sites, members, invites' }] : []),
    // Organization settings (datacentres, approvers, rules) is reached from the
    // Profile page and the organisation console, not from the rail.
    ...(isAdmin ? [{ group: 'org', to: '/connections', label: 'Data sources', icon: <DataSourcesIcon />, end: false,
      hint: 'NetBox and ServiceNow' }] : []),
    ...(isAdmin ? [{ group: 'org', to: '/marketplace', label: 'Marketplace', icon: <MarketIcon />, end: false,
      hint: 'Buy and sell hardware' }] : []),

    // ── Platform: the owner's tools.
    ...(isOwner ? [{ group: 'platform', to: '/dashboard', label: 'Console', icon: <DashboardIcon />, end: false,
      hint: 'Live operations and logs' }] : []),
    ...(isOwner ? [{ group: 'platform', to: '/lab', label: 'Lab', icon: <LabIcon />, end: false,
      hint: 'Switches in the test lab' }] : []),

    // ── Help
    { group: 'help', to: '/help', label: 'Ask DOT', icon: <HelpIcon />, end: false,
      hint: 'Answers from the docs' },
    { group: 'help', to: '/contact', label: 'Contact support', icon: <ContactIcon />, end: false,
      hint: 'Email the team' },

    // ── Account. Not in the phone bar: the Menu ends with it, next to Sign out.
    { group: 'account', to: '/profile', label: 'Profile', icon: <ProfileIcon />, end: false,
      hint: 'Account and sign-in' },
  ];
}
