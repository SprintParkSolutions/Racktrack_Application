/* Inline icon set.
 *
 * These used to be Material Symbols ligatures: <span class="material-symbols-
 * outlined">logout</span>, which renders the WORD "logout" until the icon font
 * loads. That failed twice in production for two different reasons — first the
 * font-family rule was dropped when the Google stylesheet was removed, then the
 * self-hosted subset that replaced it shipped with 43 glyphs and no ligatures at
 * all (.notdef, space, underscore). Both times the build, the linter and the
 * tests passed and testers saw "arrow_forward" printed on the primary button.
 *
 * Inline SVG removes the failure mode rather than fixing this instance of it:
 * there is no font to load, so there is nothing to fall back FROM. Unknown names
 * render nothing instead of leaking text.
 *
 * Sized in `em` so every existing rule that sets font-size on
 * .material-symbols-outlined (or an inline fontSize) keeps working untouched.
 */

const P = {
  arrow_back: <><path d="M19 12H5" /><path d="M12 19l-7-7 7-7" /></>,
  arrow_forward: <><path d="M5 12h14" /><path d="M12 5l7 7-7 7" /></>,
  chevron_right: <path d="M9 5l7 7-7 7" />,
  chevron_left: <path d="M15 5l-7 7 7 7" />,
  expand_more: <path d="M5 9l7 7 7-7" />,

  search: <>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5" />
  </>,

  close: <path d="M6 6l12 12M18 6L6 18" />,

  history: <>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
    <path d="M3 4v4h4" />
    <path d="M12 7.5V12l3 2" />
  </>,

  /* A rack, drawn — the placeholder when a scan has no thumbnail. Nested
     slots rather than lines: three bars inside a frame read as mounted
     equipment, where evenly spaced rules read as a document. */
  rack: <>
    <rect x="4.5" y="3" width="15" height="18" rx="1.8" />
    <rect x="7.2" y="6.1" width="9.6" height="2.7" rx="0.7" />
    <rect x="7.2" y="10.7" width="9.6" height="2.7" rx="0.7" />
    <rect x="7.2" y="15.3" width="9.6" height="2.7" rx="0.7" />
  </>,

  dns: <>
    <rect x="3" y="4" width="18" height="6" rx="2" />
    <rect x="3" y="14" width="18" height="6" rx="2" />
    <path d="M7 7h.01M7 17h.01" />
  </>,

  edit: <>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
  </>,

  filter_center_focus: <>
    <path d="M5 8V6a1 1 0 0 1 1-1h2" />
    <path d="M16 5h2a1 1 0 0 1 1 1v2" />
    <path d="M19 16v2a1 1 0 0 1-1 1h-2" />
    <path d="M8 19H6a1 1 0 0 1-1-1v-2" />
    <circle cx="12" cy="12" r="2.5" />
  </>,

  logout: <>
    <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
    <path d="M10 17l5-5-5-5" />
    <path d="M15 12H3" />
  </>,

  space_dashboard: <>
    <rect x="3" y="3" width="7" height="18" rx="1.5" />
    <rect x="13" y="3" width="8" height="7" rx="1.5" />
    <rect x="13" y="13" width="8" height="8" rx="1.5" />
  </>,

  terminal: <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M7 9.5l3 2.5-3 2.5" />
    <path d="M12.5 15H17" />
  </>,

  videocam: <>
    <rect x="3" y="6" width="13" height="12" rx="2" />
    <path d="M16 10.5l5-3v9l-5-3z" />
  </>,

  apartment: <>
    <path d="M4 21V4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v17" />
    <path d="M14 10h5a1 1 0 0 1 1 1v10" />
    <path d="M3 21h18" />
    <path d="M7 7h.01M11 7h.01M7 11h.01M11 11h.01M7 15h.01M11 15h.01M17 14h.01M17 17.5h.01" />
  </>,

  group: <>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3 20a6 6 0 0 1 12 0" />
    <path d="M16.2 5.4a3.2 3.2 0 0 1 0 5.9" />
    <path d="M17.3 14.4A6 6 0 0 1 21 20" />
  </>,

  location_on: <>
    <path d="M12 21.5s7-6.4 7-11.5a7 7 0 1 0-14 0c0 5.1 7 11.5 7 11.5z" />
    <circle cx="12" cy="10" r="2.5" />
  </>,

  person_check: <>
    <circle cx="10" cy="8" r="3.2" />
    <path d="M3.5 20a7 7 0 0 1 11-5.7" />
    <path d="M15.5 17.8l2 2 4-4" />
  </>,

  qr_code_scanner: <>
    <path d="M4 8V5a1 1 0 0 1 1-1h3" />
    <path d="M16 4h3a1 1 0 0 1 1 1v3" />
    <path d="M20 16v3a1 1 0 0 1-1 1h-3" />
    <path d="M8 20H5a1 1 0 0 1-1-1v-3" />
    <rect x="8" y="8" width="3.2" height="3.2" rx="0.6" />
    <path d="M14.5 8.5h1.5M15.5 12.5h.5M8.5 15.5h1.5M13 15.5h3" />
  </>,

  /* Support surfaces. Added for the Contact page rather than inlined there,
     so the one icon set stays the single place a glyph is defined and the
     "unknown name renders nothing" guarantee above keeps holding. */
  mail: <>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3.6 6.7l8.4 5.8 8.4-5.8" />
  </>,

  chat: <path d="M20 11.7a7.4 7.4 0 0 1-10.9 6.6L4 19.6l1.4-4.1A7.4 7.4 0 1 1 20 11.7z" />,

  book: <>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
    <path d="M9 13h6M9 17h4" />
  </>,

  shield: <path d="M12 3.2l7 2.9v5.6c0 4.3-2.9 7.5-7 9-4.1-1.5-7-4.7-7-9V6.1z" />,

  clock: <>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M12 7v5.2l3.4 2" />
  </>,

  paperclip: <path d="M21.2 11.3l-9.1 9.1a5.8 5.8 0 0 1-8.2-8.2l9.1-9.1a3.9 3.9 0 0 1 5.5 5.5l-9.1 9.1a1.9 1.9 0 0 1-2.7-2.7l8.2-8.2" />,

  copy: <>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </>,

  check: <path d="M20 6L9 17l-5-5" />,
};

/** Names this set covers — used by the test that guards against typos. */
export const ICON_NAMES = Object.keys(P);

export default function Icon({ name, className = '', style, ...rest }) {
  const path = P[name];
  if (!path) return null;   // never leak the name as text
  return (
    <svg
      className={`appIcon ${className}`.trim()}
      style={style}
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {path}
    </svg>
  );
}
