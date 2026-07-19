/* Category glyphs for the marketplace.

   Replaces the emoji set (🔌 🔁 🌐 …) that the listing cards and detail
   modal used to render. Emoji pick up the host OS's colour font, so the
   same listing looked different on macOS / Windows / Android and always
   read as decoration rather than as part of the interface. These are
   flat 24px stroke icons on currentColor, so they inherit the page ink
   and sit at whatever opacity the card gives them.

   Every category in marketplace_routes.js CATEGORIES has an entry; the
   `other` glyph is the fallback for anything unmapped. */

const paths = {
  // Patch cable — a lead with a connector at each end.
  cable: (
    <>
      <path d="M5 9V6.5A2.5 2.5 0 0 1 7.5 4h0A2.5 2.5 0 0 1 10 6.5V9" />
      <rect x="3.5" y="9" width="5" height="4" rx="1" />
      <path d="M19 15v2.5a2.5 2.5 0 0 1-2.5 2.5h0a2.5 2.5 0 0 1-2.5-2.5V15" />
      <rect x="15.5" y="11" width="5" height="4" rx="1" />
      <path d="M6 13v3a3 3 0 0 0 3 3h3" />
    </>
  ),
  // Switch — chassis with port row.
  switch: (
    <>
      <rect x="2.5" y="7" width="19" height="10" rx="1.5" />
      <path d="M6 11.5h1.5M9.5 11.5H11M13 11.5h1.5" />
      <circle cx="18.5" cy="11.5" r="1" />
    </>
  ),
  // Router — chassis with radiating links.
  router: (
    <>
      <rect x="2.5" y="13" width="19" height="7" rx="1.5" />
      <path d="M6 16.5h1.5M10 16.5h1.5" />
      <circle cx="18.5" cy="16.5" r="1" />
      <path d="M12 10V4M12 4 9 7M12 4l3 3" />
    </>
  ),
  // Rack — cabinet with mounted units.
  rack: (
    <>
      <rect x="4" y="2.5" width="16" height="19" rx="1.5" />
      <path d="M4 8h16M4 13.5h16" />
      <path d="M7 5.5h2M7 10.75h2M7 16.25h2" />
    </>
  ),
  // Optic / SFP — transceiver body with fibre pigtail.
  optic: (
    <>
      <rect x="2.5" y="8.5" width="11" height="7" rx="1.5" />
      <path d="M5.5 11v2M8 11v2" />
      <path d="M13.5 12h3.5a4 4 0 0 1 4 4v2" />
      <circle cx="21" cy="19.5" r="1.5" />
    </>
  ),
  // Server — stacked chassis.
  server: (
    <>
      <rect x="3" y="3.5" width="18" height="7" rx="1.5" />
      <rect x="3" y="13.5" width="18" height="7" rx="1.5" />
      <path d="M6.5 7h1.5M6.5 17h1.5" />
      <circle cx="17.5" cy="7" r="1" />
      <circle cx="17.5" cy="17" r="1" />
    </>
  ),
  // PDU — power strip with outlets.
  pdu: (
    <>
      <rect x="2.5" y="9" width="19" height="6" rx="1.5" />
      <circle cx="7" cy="12" r="1.25" />
      <circle cx="12" cy="12" r="1.25" />
      <circle cx="17" cy="12" r="1.25" />
      <path d="M21.5 12H23" />
    </>
  ),
  // Firewall — shield over brickwork.
  firewall: (
    <>
      <path d="M12 2.5 4.5 5.5v6c0 4.5 3.2 8.4 7.5 10 4.3-1.6 7.5-5.5 7.5-10v-6Z" />
      <path d="M4.5 9.5h15M12 5.5v4M8 9.5v4M16 9.5v4M4.5 13.5h15" />
    </>
  ),
  // Patch panel — port field.
  patch_panel: (
    <>
      <rect x="2.5" y="6.5" width="19" height="11" rx="1.5" />
      <path d="M6 10v1.5M9 10v1.5M12 10v1.5M15 10v1.5M18 10v1.5" />
      <path d="M6 14v0.01M9 14v0.01M12 14v0.01M15 14v0.01M18 14v0.01" />
    </>
  ),
  // Other — sealed carton.
  other: (
    <>
      <path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5Z" />
      <path d="m3 7.5 9 4.5 9-4.5M12 12v9" />
    </>
  ),
};

export default function CategoryIcon({ category, size = 24, className }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[category] || paths.other}
    </svg>
  );
}
