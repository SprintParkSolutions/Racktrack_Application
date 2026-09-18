/**
 * Who may use which /api/nb route.
 *
 * The mount authenticates (auth.requireAuth puts req.user on the request);
 * each route then says, on the route itself, which roles it is for. The list
 * is short and deliberate, from the frozen drift workflow
 * (docs/design/drift-approval-workflow.md):
 *
 *   technician  owner, org_admin, site_manager and member. A member is the
 *               person at the rack: they adopt a scan, compare it to NetBox,
 *               read their own plan and hand it to the admin. Nothing else.
 *   admin       owner, org_admin and site_manager. They assign, decide,
 *               read every plan and ticket in their organisation, and write.
 *
 * A route with no gate is a route a member can reach, so every route under
 * scans, plans and netbox carries one. The tests in test/netbox/rules.test.js
 * check the member's six routes answer and the rest refuse.
 */
const ADMINS = ['owner', 'org_admin', 'site_manager'];
const TECHNICIANS = [...ADMINS, 'member'];

/** A gate that lets `roles` through and answers 403 to everyone else. */
function only(roles, message = 'Insufficient permissions') {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (roles.includes(req.user.role)) return next();
    return res.status(403).json({ error: message });
  };
}

const isAdmin = (req) => ADMINS.includes(req.user?.role);

module.exports = {
  only,
  admin: only(ADMINS),
  technician: only(TECHNICIANS),
  isAdmin,
  ADMINS,
  TECHNICIANS,
};
