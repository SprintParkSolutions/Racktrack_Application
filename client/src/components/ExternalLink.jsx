import { openExternalClick } from '../utils/approvals.js';

/**
 * A link that leaves the app.
 *
 * Web build: a plain anchor that opens in a new tab. Native build: the same
 * anchor, with the click handed to the Capacitor Browser plugin. One place so
 * every external link behaves the same way.
 */
export default function ExternalLink({ href, onClick, children, ...rest }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      {...rest}
      onClick={(e) => { onClick?.(e); openExternalClick(e, href); }}
    >
      {children}
    </a>
  );
}
