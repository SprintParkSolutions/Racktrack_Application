/**
 * Which pair of eyes the app is being looked through.
 *
 * An account has one role, but two jobs can sit behind it. An organisation
 * admin runs the estate and also, now and then, walks to a rack; a single
 * point of contact decides on checks and also, now and then, walks to a rack.
 * The owner asked on 23 September 2026 for a toggle at the top of the screen
 * so those people can shift, and for scanning to belong to one view only:
 *
 *   an admin      shifts between Admin and Employee
 *   a SPOC        shifts between SPOC and Employee
 *   an employee   has no toggle: there is nothing to shift to
 *
 * The employee view is the one that carries the camera. In the Admin and SPOC
 * views there is no Scan anywhere - not on Home, not on the bar, not by typing
 * the address - because neither of those people is being asked to photograph a
 * rack. Choosing Employee is how they say that today they are.
 *
 * The choice is kept on the device, not on the account: it is about what this
 * person is doing this morning, not about what they are allowed to do. What
 * they are allowed to do is the role, and that is the server's answer.
 */

const KEY = 'rt.view';

/** The views this role may look through, the role's own view first. */
export function viewsFor(role) {
  if (role === 'admin' || role === 'manager') return ['admin', 'employee'];
  if (role === 'spoc') return ['spoc', 'employee'];
  return ['employee'];
}

/** What each view is called on the toggle. */
export const VIEW_LABEL = { admin: 'Admin', spoc: 'SPOC', employee: 'Employee' };

/** The view in force for this role: the stored one if it is still allowed. */
export function viewFor(role) {
  const allowed = viewsFor(role);
  let stored = null;
  try { stored = localStorage.getItem(KEY); } catch { /* private window */ }
  return allowed.includes(stored) ? stored : allowed[0];
}

/** Remember the view this person shifted to. */
export function setView(view) {
  try { localStorage.setItem(KEY, view); } catch { /* private window */ }
  // Same-tab listeners: the storage event only fires in other tabs.
  window.dispatchEvent(new CustomEvent('rt-view', { detail: view }));
}

/** Whether the camera belongs to this view. Only the employee is asked to scan. */
export const canScanIn = (view) => view === 'employee';
