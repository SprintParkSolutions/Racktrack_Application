/**
 * Who a check goes to: the SPOC of the Site it was scanned under.
 *
 * Setup names one person per Site (tenants.approver_user_id, or an email while
 * that person has no account yet), and a check sent from the phone goes
 * straight to them. This module answers one question - is there somebody
 * valid to give this check to, and if not, why not - and nothing else. It
 * writes nothing and emits nothing: service.submit() acts on the answer.
 *
 * A SPOC is valid when the account exists, is active, belongs to the
 * organization that raised the check, is not an auditor (an auditor writes
 * nothing, so cannot decide), and is an admin or sits on the check's own Site:
 * the drift report is authorised by rack, so somebody homed on another Site
 * could not open what the decision rests on. Setup checks the Site when it
 * saves a user id, but an email is saved for anybody and a person can be moved
 * later. And never the person who sent the check: nobody
 * decides their own. Each "no" has a word and a sentence, because the check
 * then waits for an admin and the admin has to be told why.
 *
 * The Site's record is estate.js's. It is read through one lookup, which a
 * test replaces; on a throwaway test database there is no estate to read, so
 * the answer there is "no SPOC" until a test says otherwise.
 */
const store = require('./store');
const machine = require('./machine');

let _lookup = null;

/** Tests: fn(tenantId) -> { user_id, email, username } | null. Null restores the real one. */
function _setLookup(fn) { _lookup = typeof fn === 'function' ? fn : null; }

function approverOf(tenantId) {
  try {
    if (_lookup) return _lookup(tenantId) || null;
    if (store.isolated()) return null;
    return require('../estate').getApprover(tenantId) || null;
  } catch { return null; }   // no such Site, or no such table yet: no SPOC
}

const siteOf = (tenantId) => {
  const t = tenantId != null ? store.tenantById(tenantId) : null;
  return { id: tenantId ?? null, name: (t && t.name) || null };
};
const siteWords = (site) => site.name || (site.id != null ? `Site ${site.id}` : 'This site');

/** May this account hold a check of this organization at all? */
const mayHold = (user, orgId) => Boolean(user && user.active
  && Number(user.orgId) === Number(orgId) && user.role !== 'auditor');

/** Can this account open the drift report of a check on this Site? */
const onSite = (user, plan) => machine.isAdmin(user)
  || (plan.tenantId != null && Number(user.tenantId) === Number(plan.tenantId));

const no = (why, text, site) => ({ ok: false, why, text, site });

/**
 * sync. -> { ok: true, holder: { userId, username, email, role, tenantId }, site: { id, name } }
 *       or { ok: false, why: 'no_site'|'no_spoc'|'spoc_invalid'|'spoc_is_sender', text, site }
 *
 * `sender` is whoever is sending, for a plan that has not been stamped yet.
 */
function resolve(plan, { sender = null } = {}) {
  if (!plan || plan.tenantId == null) {
    return no('no_site', 'This check is not tied to a site, so it has no SPOC.', siteOf(null));
  }
  const site = siteOf(plan.tenantId);
  if (plan.orgId == null) {
    return no('no_site', 'This check was sent from an account that belongs to no organization, '
      + 'so it has no SPOC.', site);
  }
  const named = approverOf(plan.tenantId);
  if (!named || (named.user_id == null && !named.email)) {
    return no('no_spoc', `${siteWords(site)} has no SPOC yet.`, site);
  }
  const user = named.user_id != null ? store.userById(named.user_id)
    : store.userByEmail(plan.orgId, named.email);
  if (!mayHold(user, plan.orgId)) {
    return no('spoc_invalid', `The SPOC of ${siteWords(site)} is no longer an active account.`, site);
  }
  if (!onSite(user, plan)) {
    return no('spoc_invalid', `${user.username} is named as the SPOC of ${siteWords(site)} `
      + 'but is not on this site.', site);
  }
  const sentBy = { submittedById: plan.submittedById ?? (sender && sender.id) ?? null,
    submittedBy: plan.submittedBy ?? (sender && sender.username) ?? null };
  if (machine.isSender(sentBy, user)) {
    return no('spoc_is_sender', `${user.username} is the SPOC of ${siteWords(site)} and also sent this check, `
      + 'so somebody else has to decide it.', site);
  }
  return { ok: true, site,
    holder: { userId: user.id, username: user.username, email: user.email ?? null,
              role: user.role, tenantId: user.tenantId ?? null } };
}

/**
 * The SPOC setup names for the check's Site, as a screen shows them, whether or
 * not the check can go to them: `valid` says if the account may hold a check at
 * all. Null when the check has no Site, the Site names nobody, or it names an
 * account of another organization: that person's name and email are not this
 * organization's to read.
 */
function ofSite(plan) {
  if (!plan || plan.tenantId == null) return null;
  const named = approverOf(plan.tenantId);
  if (!named || (named.user_id == null && !named.email)) return null;
  const site = siteOf(plan.tenantId);
  const user = named.user_id != null ? store.userById(named.user_id)
    : store.userByEmail(plan.orgId, named.email);
  if (user && Number(user.orgId) !== Number(plan.orgId)) return null;
  return { userId: user ? user.id : named.user_id ?? null,
    username: (user && user.username) || named.username || null,
    email: (user && user.email) || named.email || null,
    siteId: site.id, siteLabel: `Site ${site.id}`, siteName: site.name,
    valid: mayHold(user, plan.orgId) && onSite(user, plan) };
}

/**
 * Who an admin may give this check to: an active user of its organization who
 * is an owner, an org admin, or sits on the check's own Site - the drift report
 * is authorised by rack, so somebody homed on another Site could not open it.
 * Never an auditor, and never the person who sent it.
 */
function assignableUsers(plan) {
  if (!plan || plan.orgId == null) return [];
  return store.usersOfOrg(plan.orgId)
    .filter((u) => mayHold(u, plan.orgId))
    .filter((u) => onSite(u, plan))
    .filter((u) => !machine.isSender(plan, u))
    .map((u) => ({ id: u.id, username: u.username, email: u.email ?? null, role: u.role,
                   tenantId: u.tenantId ?? null, tenantName: u.tenantName ?? null }));
}

module.exports = { resolve, ofSite, assignableUsers, _setLookup };
