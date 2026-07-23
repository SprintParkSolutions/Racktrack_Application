import { createContext, useContext, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * One header, everywhere. DesktopShell draws a single top bar — [back] [Title]
 * on the left, an actions slot on the right — and every page uses it instead of
 * drawing its own. Pages only ever contribute two things to that header:
 *
 *   • right-side actions (List an item, Live/Refresh, …) via <HeaderActions>
 *   • an optional custom back handler (e.g. the org console's org→list) via
 *     useHeaderBack()
 *
 * The title itself comes from the route (see DesktopShell's PAGE_TITLE), so the
 * header is identical page to page — same position, font, size, back button —
 * and only the title text differs.
 *
 * On a phone there is no shell, so the context value is null: <HeaderActions>
 * renders nothing and pages fall back to their own mobile headers, unchanged.
 */
export const ShellHeaderContext = createContext(null);

export function useShellHeader() {
  return useContext(ShellHeaderContext);
}

// Portals its children into the shell's right-hand actions slot. No-op off-shell.
export function HeaderActions({ children }) {
  const ctx = useContext(ShellHeaderContext);
  if (!ctx || !ctx.actionsEl) return null;
  return createPortal(children, ctx.actionsEl);
}

// Override the shell back button's behaviour for as long as the page is mounted
// (e.g. the org console clears the active org instead of navigating). Passing a
// falsy handler restores the default (history back).
//
// The latest handler is kept in a ref so we can register a STABLE wrapper with
// the shell once — depending on the handler's identity would re-run the effect
// every render, and since it calls setState in the shell that would loop.
export function useHeaderBack(handler) {
  const ctx = useContext(ShellHeaderContext);
  const setBack = ctx && ctx.setBackHandler;
  const ref = useRef(handler);
  ref.current = handler;
  const active = !!handler;
  useEffect(() => {
    if (!setBack) return undefined;
    if (!active) { setBack(null); return undefined; }
    const wrapper = () => { if (ref.current) ref.current(); };
    setBack(() => wrapper);
    return () => setBack(null);
  }, [setBack, active]);
}
