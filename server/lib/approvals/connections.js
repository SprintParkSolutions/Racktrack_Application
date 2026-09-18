/**
 * Which NetBox and which ServiceNow a plan's organization uses.
 *
 * Both logins live where every other data source does - Data Sources
 * (/connections), encrypted, set once by an admin. The organization's own
 * connection comes first; then the acting user's, because an owner account
 * belongs to no organization and a Data Source it saved would otherwise never
 * be consulted; then, for NetBox only, the server env of a single-tenant
 * install. These two functions were in routes/netbox/plans.js; the service and
 * the ServiceNow poller need them without a request in hand.
 */
const cfg = require('../netbox/config');
const profiles = require('../connection_profiles');
const { NetBox } = require('../netbox/netbox');

function credsFor({ orgId = null, userId = null }, type) {
  return (orgId ? profiles.resolveCredsForOrg(orgId, type) : null)
    || (userId ? profiles.resolveCredsForType(userId, type) : null);
}

/** A NetBox client, or null when none is configured anywhere. */
function netboxFor(who = {}) {
  const creds = credsFor(who, 'netbox');
  const url = creds?.secret?.base_url || cfg.NETBOX_URL;
  const token = creds?.secret?.token || cfg.NETBOX_TOKEN;
  return url ? new NetBox(url, token) : null;
}

/**
 * The ServiceNow the admin configured, in the shape lib/netbox/tickets.js
 * wants. Null when nothing is set up, and that is not an error: the ticket
 * still exists here, it simply has no external number.
 */
function serviceNowFor(who = {}) {
  const s = credsFor(who, 'servicenow')?.secret;
  if (!s || !(s.instance || s.instanceUrl)) return null;

  // The connection form stores just the instance name ("dev322173"), or a full
  // URL. Build a real base URL either way: a bare name needs the domain
  // appended, or every call resolves the wrong host.
  const raw = String(s.instanceUrl || s.instance).trim();
  let instanceUrl;
  if (/^https?:\/\//i.test(raw)) instanceUrl = raw.replace(/\/+$/, '');
  else if (raw.includes('.')) instanceUrl = `https://${raw.replace(/\/+$/, '')}`;
  else instanceUrl = `https://${raw}.service-now.com`;
  return {
    instanceUrl,
    username: s.user || s.username || '',
    password: s.password || '',
    incidentTable: s.incidentTable || 'incident',
  };
}

module.exports = { netboxFor, serviceNowFor };
