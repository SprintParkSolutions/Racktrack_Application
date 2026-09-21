import BackButton from './BackButton.jsx';
import styles from './PageHeader.module.css';

/* ──────────────────────────────────────────────────────────────────────
   PageHeader - the bar at the top of a screen. One of them, for every page.

   Twenty-six pages drew their own, under four different class names
   (.header, .topbar, .topBar, .appBar), and between them they set the title
   at eleven different sizes in four weights with tracking anywhere from
   -0.035em to +0.20em. Adjacent screens did not look like the same product,
   which is the whole reason the app read as unfinished.

   Every one of those headers was the same four things in the same order, so
   that is what this takes:

     back      the way out - the app's one back control
     lead      an optional control that belongs beside the title, not after
               it (the tenant map's tree toggle)
     title     the page's own words, unchanged, with an optional eyebrow
               above it and an optional second line under it
     action    whatever that page does from its header - a theme toggle, a
               count, a Live button, a 2D/3D switch

   A page keeps its own words and its own actions. Only the shape and the
   type are shared. Nothing here knows what page it is on.
   ────────────────────────────────────────────────────────────────────── */

export default function PageHeader({
  title,
  // A small line in capitals ABOVE the title: what kind of thing this is.
  eyebrow = null,
  // A second line UNDER the title: the rack, the site, the room, or a word
  // about what the screen is for.
  sub = null,
  // Set `sub` in Geist Mono. Rack ids, shelves, ports and incident numbers
  // are read character by character, so they get the mono.
  mono = false,
  // The back control. Leave it out for the app's smart back (which hides
  // itself on a page you opened directly); pass a function for a page whose
  // back is a state change rather than a navigation; pass false for a page
  // with no way back.
  back,
  backFallback = '/',
  backAlways = false,
  backLabel = 'Back',
  lead = null,
  action = null,
  // Sticks to the top of a scrolling page. Pages whose body scrolls under
  // the header pass this; pages that scroll as a whole do not.
  sticky = false,
  // Drops the bottom hairline, for a header that sits on a coloured band of
  // its own and would otherwise draw two lines.
  plain = false,
  className = '',
  children = null,
}) {
  const backEl = back === false ? null : (
    <BackButton
      fallback={backFallback}
      always={backAlways}
      label={backLabel}
      onBack={typeof back === 'function' ? back : null}
    />
  );

  return (
    <header
      className={[
        styles.header,
        sticky ? styles.sticky : '',
        plain ? styles.plain : '',
        className,
      ].filter(Boolean).join(' ')}
    >
      {backEl}
      {lead}
      {/* data-ph is the hook a page uses when it genuinely has to reach one
          of these lines from its own stylesheet - the marketplace drops its
          subtitle on a narrow screen. It is rare, and it is meant to be. */}
      <div className={styles.text} data-ph="text">
        {eyebrow && <p className={styles.eyebrow} data-ph="eyebrow">{eyebrow}</p>}
        <h1 className={styles.title} data-ph="title" title={typeof title === 'string' ? title : undefined}>{title}</h1>
        {sub && <p className={mono ? styles.subMono : styles.sub} data-ph="sub">{sub}</p>}
      </div>
      {action && <div className={styles.action}>{action}</div>}
      {children}
    </header>
  );
}
