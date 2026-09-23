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
import { useApprovalsCan } from '../hooks/useApprovalsCan.js';
import { useAppView, roleOfUser } from '../hooks/useAppView.js';
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
export const PortsIcon = () => (
  <svg {...s}><rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 11v2"/><path d="M11 11v2"/><path d="M15 11v2"/></svg>
);
export const LabIcon = () => (
  <svg {...s}><path d="M9 3v6.5L4.5 18A2 2 0 006.3 21h11.4a2 2 0 001.8-3L15 9.5V3"/><path d="M8 3h8"/><path d="M7.5 14h9"/></svg>
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
   in the sidebar and the Menu. `inBar` marks the ones that get a permanent
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
  // Whether this account is the single point of contact of a Site, which is
  // the server's answer and not something a role implies.
  const can = useApprovalsCan();
  /* What this person is doing today, not only what they are. An admin or a
     single point of contact who has shifted the toggle on Home to Employee is
     given the employee's app - the camera, two racks, their scan history -
     because that is the job they said they are doing. In their own view none
     of that appears: an admin's app is the organisation, the Desk and their
     data sources, which is what the owner asked for on 23 September 2026 -
     "keep it admin level, not employee or technician level".  */
  const { view } = useAppView(roleOfUser(user, can), user && user.id);
  const asEmployee = view === 'employee';
  const isSpoc = Boolean(can && can.spoc) && !asEmployee;
  const runsTheEstate = (isAdmin || Boolean(can && can.spoc)) && !asEmployee;

  /* Whether we yet KNOW which app this person gets.
     `can` is null until GET /api/approvals/me answers, and a technician who
     is a Site's contact is only a SPOC because that answer says so. Treating
     "not answered yet" as "not a SPOC" gave a single point of contact the
     employee's navigation - Scan a rack, Two racks, Scan history, Tickets,
     Port history - until the request landed, and left it there for good if
     the request failed. The owner saw Port history in a SPOC's sidebar on
     23 September 2026, and that is what it was.

     Two people do not have to wait: an admin is an admin by their own role,
     and anybody who has shifted the toggle to Employee has said which app
     they want. Everybody else gets the entries that belong to no role until
     the server has answered, and never the wrong ones. */
  const settled = can !== null || isAdmin || asEmployee;
  /* The employee's own work: only when we know this person is not running
     the estate. */
  const employeeWork = settled && !runsTheEstate;

  return [
    // ── Rack work. Home is first: "/" is the app's landing screen again, so
    // the bar needs a way back to it. `end` is true because every other route
    // starts with "/" and Home would otherwise read as active on all of them.
    // A hint that only rewords the label above it is a second line for nothing, so
    // Home, Scan, Scan history, Contact support and Profile carry none. The hints
    // that survive all say something the label does not.
    { group: 'work', to: '/', label: 'Home', icon: <HomeIcon />, end: true,
      inBar: true, barLabel: 'Home' },
    // Scan is the bar's raised centre action (BottomNav), so it takes no slot
    // in the row of four beside it.
    ...(employeeWork ? [{ group: 'work', to: '/scan', label: 'Scan a rack', icon: <ScanIcon />, end: false }] : []),
    // The bar carries four tabs around the raised Scan: two on each side. An
    // odd number leaves the centre off-centre, which is what a technician had
    // once the Desk came off their bar - the owner's words on 22 Sep 2026,
    // "keep 3 or 5 when there is a centre button".
    //
    // So the fourth tab differs by who is looking. Somebody who decides gets
    // the Desk (below); everybody else gets their own racks, which is what a
    // technician opens next most often. Two racks as one job is a rarer piece
    // of work and waits in the Menu for them.
    // Two racks as one job, and the history of what this person scanned, are
    // both the employee's work. Neither is offered to somebody running the
    // estate: they did not take those photographs.
    ...(employeeWork ? [{ group: 'work', to: '/multi-rack/new', label: 'Two racks',
      icon: <TwoRackIcon />, end: false, inBar: true, barLabel: '2 Racks',
      hint: 'Two racks as one job' }] : []),
    ...(employeeWork ? [{ group: 'work', to: '/history', label: 'Scan history',
      icon: <HistoryIcon />, end: false, inBar: true, barLabel: 'Racks' }] : []),
    /* What somebody has asked this person to go and look at. The second
       workflow starts here rather than at a rack (23 September 2026). */
    /* Tickets are the one piece of the employee's app a single point of
       contact keeps: they decide checks for their site AND can be asked to go
       and look at a rack (the owner, 23 September 2026). An admin who is not
       a SPOC does not get it - their app is the estate. */
    ...(employeeWork || isSpoc ? [{ group: 'work', to: '/tasks', label: 'Tickets for you',
      icon: <InboxIcon />, end: false, hint: 'What you have been asked to look at' }] : []),
    // The technician's fourth tab. A person who has just checked a rack looks
    // a port up next more often than they do anything else, and for somebody
    // who decides that slot is the Desk instead.
    /* What this person raised, and what became of it. The other half of a
       technician's own work: Tickets for you is what is coming towards them,
       this is what they sent (the owner, 23 September 2026). */
    ...(employeeWork ? [{ group: 'work', to: '/my-incidents', label: 'Incidents you raised',
      icon: <InboxIcon />, end: false, hint: 'What you sent, and where it stands' }] : []),
    ...(employeeWork ? [{ group: 'work', to: '/port-history', label: 'Port history',
      icon: <PortsIcon />, end: false, hint: 'What changed on a port' }] : []),
    // Approvals is its own application on its own address, so this entry
    // carries `href` instead of `to`: the bar, the Menu and the sidebar draw
    // it as a link that leaves the app (components/ExternalLink.jsx).
    //
    // Who sees it: an organisation admin, and whoever is a Site's single
    // point of contact. Not a technician. The owner's direction on 22 Sep
    // 2026 - a technician does not run a drift dashboard, they check a rack
    // and then follow the one check they sent, which the drift screen's
    // "Track this check" gives them. Deciding by `can.spoc` rather than by
    // role is the point: a technician who is a Site's contact does hold
    // checks, and does get the Desk.
    /* Your checks is in the Menu, not on the bar. A single point of contact's
       bar is Home, Drift and Menu - three things (the owner, 23 September
       2026) - because the Desk is where the checks are read and a second tab
       into the same work is a second door to one room. */
    ...(runsTheEstate && isSpoc ? [{ group: 'work', to: '/my-checks', label: 'Your checks',
      icon: <InboxIcon />, end: false,
      hint: 'The checks waiting on you' }] : []),
    ...(runsTheEstate ? [{ group: 'work', href: APPROVALS_URL, label: 'Drift Desk', icon: <InboxIcon />,
      inBar: true, barLabel: 'Drift',
      hint: isAdmin ? 'Opens RackTrack Drift Desk' : 'The checks that are with you' }] : []),

    // ── Organization: owners and organisation admins.
    ...(isAdmin ? [{ group: 'org', to: '/organizations', label: 'Organizations', icon: <OrgIcon />, end: false,
      ...(runsTheEstate ? { inBar: true, barLabel: 'Org' } : {}),
      hint: 'Sites, members, invites' }] : []),
    // Organization settings (sites, their SPOCs, the rules) is reached from the
    // Profile page and the organisation console, not from the rail.
    ...(isAdmin ? [{ group: 'org', to: '/connections', label: 'Data sources', icon: <DataSourcesIcon />, end: false,
      ...(runsTheEstate && !isSpoc ? { inBar: true, barLabel: 'Sources' } : {}),
      hint: 'NetBox and ServiceNow' }] : []),
    // Marketplace and Lab are not linked from anywhere for now, on the
    // owner's direction of 22 Sep 2026. Their routes and their screens are
    // untouched, so putting either back is one line here.

    // ── Platform: the owner's tools.
    ...(isOwner ? [{ group: 'platform', to: '/dashboard', label: 'Console', icon: <DashboardIcon />, end: false,
      hint: 'Live operations and logs' }] : []),

    // ── Help
    { group: 'help', to: '/help', label: 'Ask DOT', icon: <HelpIcon />, end: false,
      hint: 'Answers from the docs' },
    { group: 'help', to: '/contact', label: 'Contact support', icon: <ContactIcon />, end: false },

    // ── Account. Not in the phone bar: the Menu ends with it, next to Sign out.
    { group: 'account', to: '/profile', label: 'Profile', icon: <ProfileIcon />, end: false },
  ];
}
