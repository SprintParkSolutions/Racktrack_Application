/**
 * Organization settings -  the model, without the screen.
 *
 * The state lives on the server (/api/setup, server/lib/estate.js and the
 * profile sections beside it). What that state MEANS -  which of the ten
 * steps is done, what is still required, what is optional and empty, which
 * step to open first -  is decided here, once, so the first-run flow, the
 * settings view, the review and the tests cannot disagree.
 *
 * The same ten steps, the same mandatory and optional split and the same
 * progress arithmetic as the portal (racktrack_portal/src/lib/setup.js), so
 * an admin who starts on a phone and finishes on a laptop sees one product.
 *
 * A datacentre is a Site: the console calls it a Site, the server calls it
 * a tenant, and this page calls it a datacentre because that is what the
 * person typing its address calls it.
 *
 * model = { org: the organization profile or null, dcs: [datacentre] }
 * datacentre = the GET /api/setup/:id snapshot, flattened by the hook:
 *   { id, name, organization_id, datacentre, spaces, approver, rules,
 *     completeness, profile }
 */

/* -- The three facts the first photo needs, as the server reports them -- */
export const MANDATORY = [
  { key: 'location', step: 'spaces', short: 'Space with racks', need: 'a space with racks' },
  { key: 'approver', step: 'people', short: 'Approver', need: 'an approver' },
  { key: 'rules', step: 'rules', short: 'Rules accepted', need: 'the rules accepted' },
];

/* -- The ten steps, in order ------------------------------------------
   `kind` says what a step is to the flow: mandatory work (required), work
   that can wait (optional), or the review. `needsDc` marks a step with
   nothing to show until a datacentre exists, so it is locked rather than
   opened empty. `lead` is the one help line under the step title. */
export const STEPS = [
  { key: 'org', label: 'Organization', title: 'Organization', kind: 'required', lead: 'Name, short code, time zone and country.' },
  { key: 'datacentres', label: 'Datacentres', title: 'Datacentres', kind: 'required', lead: 'Each building that holds racks. One is enough to start.' },
  { key: 'spaces', label: 'Spaces', title: 'Spaces and racks', kind: 'required', needsDc: true, lead: 'Halls, rooms or floors, and the racks in each.' },
  { key: 'people', label: 'People', title: 'People', kind: 'required', needsDc: true, lead: 'An approver per datacentre, plus contacts and invites.' },
  { key: 'systems', label: 'Systems', title: 'Systems', kind: 'optional', lead: 'Record of truth, ticketing and notifications.' },
  { key: 'vendors', label: 'Vendors', title: 'Vendors', kind: 'optional', lead: 'Makes, models and support contacts.' },
  { key: 'conventions', label: 'Naming', title: 'Naming', kind: 'optional', lead: 'Naming patterns and cable colours.' },
  { key: 'network', label: 'Switch access', title: 'Switch access', kind: 'optional', needsDc: true, lead: 'Management ranges, Wi-Fi and read-only SNMP.' },
  { key: 'rules', label: 'Rules', title: 'Rules', kind: 'required', needsDc: true, lead: 'Four rules that apply to every datacentre.' },
  { key: 'review', label: 'Review', title: 'Review', kind: 'review', lead: 'Check what is set, then finish.' },
];
export const STEP_KEYS = STEPS.map((s) => s.key);
export const stepOf = (key) => STEPS.find((s) => s.key === key) || null;

/* -- What is done ----------------------------------------------------- */
const has = (v) => (typeof v === 'string' ? v.trim().length > 0 : v != null && v !== '');
const nonEmpty = (a) => Array.isArray(a) && a.length > 0;

export const ORG_NEEDED = [
  { key: 'name', label: 'Name' }, { key: 'short_code', label: 'Short code' },
  { key: 'timezone', label: 'Time zone' }, { key: 'country', label: 'Country' },
];
export const orgMissing = (p) => ORG_NEEDED.filter((f) => !has(p?.[f.key]));
export const orgComplete = (p) => orgMissing(p).length === 0;

export const dcAddressed = (dc) => has(dc?.datacentre?.address) && has(dc?.datacentre?.timezone);
export const dcHasSpace = (dc) => !!dc?.completeness?.mandatory?.location || (dc?.spaces || []).some((s) => Number(s.rack_count) > 0);
export const dcHasApprover = (dc) => !!dc?.completeness?.mandatory?.approver || !!dc?.approver;
export const dcRulesAccepted = (dc) => !!dc?.completeness?.mandatory?.rules || !!dc?.rules?.accepted_at;

/** Whether an optional section holds anything yet. */
export function sectionFilled(section, p) {
  if (!p) return false;
  switch (section) {
    case 'contacts': return nonEmpty(p.contacts);
    case 'vendors': return nonEmpty(p.vendors);
    case 'conventions': {
      const c = p.conventions || {};
      return ['rack_pattern', 'device_pattern', 'asset_pattern', 'port_pattern'].some((k) => has(c[k])) || nonEmpty(c.cable_colours);
    }
    case 'systems': {
      const s = p.systems || {};
      return (has(s.record) && s.record !== 'none') || (has(s.ticketing) && s.ticketing !== 'none') || nonEmpty(s.notifications);
    }
    case 'network': {
      const n = p.network || {};
      return nonEmpty(n.management_ranges) || has(n.wifi_ssid) || nonEmpty(n.unmanaged_makes) || has(n.notes);
    }
    case 'snmp': return !!p.snmp?.configured;
    default: return false;
  }
}

/* Systems, vendors and conventions are organization-wide: read from the
   first datacentre, written to every one, so a customer with three
   buildings types the vendor list once. */
export const ORG_WIDE = new Set(['systems', 'vendors', 'conventions']);
export const orgWideProfile = (dcs) => dcs?.[0]?.profile || null;

export function stepDone(step, model) {
  const dcs = model?.dcs || []; const any = dcs.length > 0;
  switch (step) {
    case 'org': return orgComplete(model?.org);
    case 'datacentres': return any && dcs.every(dcAddressed);
    case 'spaces': return any && dcs.every(dcHasSpace);
    case 'people': return any && dcs.every(dcHasApprover);
    case 'rules': return any && dcs.every(dcRulesAccepted);
    case 'systems': return sectionFilled('systems', orgWideProfile(dcs));
    case 'vendors': return sectionFilled('vendors', orgWideProfile(dcs));
    case 'conventions': return sectionFilled('conventions', orgWideProfile(dcs));
    case 'network': return dcs.some((d) => sectionFilled('network', d.profile) || sectionFilled('snmp', d.profile));
    case 'review': { const p = progress(model); return p.required.done === p.required.total; }
    default: return false;
  }
}
export const stepLocked = (step, model) => !!stepOf(step)?.needsDc && !(model?.dcs || []).length;

/** The mandatory and the optional items, each with what is done. */
export function progress(model) {
  const dcs = model?.dcs || []; const any = dcs.length > 0;
  const each = (label) => (dcs.length > 1 ? `${label} in every datacentre` : label);
  const required = [
    { key: 'org', step: 'org', label: 'Organization profile', done: orgComplete(model?.org) },
    { key: 'datacentres', step: 'datacentres', label: 'A datacentre with an address and time zone', done: any && dcs.every(dcAddressed) },
    { key: 'spaces', step: 'spaces', label: each('A space with racks'), done: any && dcs.every(dcHasSpace) },
    { key: 'people', step: 'people', label: each('An approver'), done: any && dcs.every(dcHasApprover) },
    { key: 'rules', step: 'rules', label: each('Rules accepted'), done: any && dcs.every(dcRulesAccepted) },
  ];
  const wide = orgWideProfile(dcs);
  const optional = [
    { key: 'contacts', step: 'people', label: 'Contacts', done: dcs.some((d) => sectionFilled('contacts', d.profile)) },
    { key: 'systems', step: 'systems', label: 'Systems', done: sectionFilled('systems', wide) },
    { key: 'vendors', step: 'vendors', label: 'Vendors', done: sectionFilled('vendors', wide) },
    { key: 'conventions', step: 'conventions', label: 'Naming', done: sectionFilled('conventions', wide) },
    { key: 'network', step: 'network', label: 'Switch access', done: dcs.some((d) => sectionFilled('network', d.profile) || sectionFilled('snmp', d.profile)) },
  ];
  const count = (xs) => ({ items: xs, done: xs.filter((x) => x.done).length, total: xs.length });
  return { required: count(required), optional: count(optional) };
}

export const mandatoryDone = (model) => { const p = progress(model); return p.required.done === p.required.total; };

/** What is still to do, by step: the two lists the review and the settings
 *  view show. */
export function remaining(model) {
  const p = progress(model);
  return {
    required: p.required.items.filter((x) => !x.done),
    optional: p.optional.items.filter((x) => !x.done),
  };
}

/* The kinds a space can be, in NetBox terms. */
export const SPACE_KINDS = [
  { key: 'hall', label: 'Hall' }, { key: 'floor', label: 'Floor' }, { key: 'room', label: 'Room' },
  { key: 'row', label: 'Row' }, { key: 'cage', label: 'Cage' },
];
export const spaceKindLabel = (k) => SPACE_KINDS.find((x) => x.key === k)?.label || '';

/* The people a ticket can reach, beyond the approver. The first four are
   offered as named slots; vendor is added by hand. */
export const CONTACT_ROLES = [
  { key: 'on_site', label: 'On-site contact', what: 'Meets the technician at the door' },
  { key: 'escalation', label: 'Escalation', what: 'Called when the on-site contact does not answer' },
  { key: 'facilities', label: 'Facilities', what: 'Power, cooling and the building' },
  { key: 'security', label: 'Security', what: 'Badges and access' },
  { key: 'vendor', label: 'Vendor contact', what: 'A supplier who works on site' },
  { key: 'approver', label: 'Approver', what: 'Also listed as a contact' },
];
export const roleLabel = (k) => CONTACT_ROLES.find((r) => r.key === k)?.label || k;

/* The one-line address the legacy datacentre field holds, composed from
   the facility section so the two never disagree. */
export function composeAddress(f) {
  const parts = [f?.address_line1, f?.address_line2, f?.city, f?.region, f?.postcode, f?.country ? countryName(f.country) : null]
    .map((x) => (x == null ? '' : String(x).trim())).filter(Boolean);
  return parts.join(', ');
}
export const INDUSTRIES = ['Colocation provider', 'Cloud or hosting', 'Enterprise IT', 'Telecom', 'Finance', 'Public sector', 'Healthcare', 'Education', 'Manufacturing', 'Retail', 'Other'];

/** The first step that still has required work; the review when none does. */
export function firstIncompleteStep(model) {
  const s = STEPS.find((x) => x.kind === 'required' && !stepDone(x.key, model));
  return s ? s.key : 'review';
}

/** The state a step is drawn in: on, done, locked, optional, todo. */
export function stepState(step, model, current) {
  if (step === current) return 'on';
  if (stepLocked(step, model)) return 'locked';
  if (stepDone(step, model)) return 'done';
  return stepOf(step)?.kind === 'optional' ? 'optional' : 'todo';
}

/* -- Time zones and countries ---------------------------------------- */
export function browserTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

/* Every zone this browser knows, plus whatever the record already holds:
   the server accepts aliases (Asia/Calcutta) the canonical list leaves out,
   and a select must be able to show the value it was given. */
let zones = null;
export function timezones(...extra) {
  if (!zones) {
    try { zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []; } catch { zones = []; }
  }
  const set = new Set(zones); set.add('UTC'); extra.filter(Boolean).forEach((z) => set.add(z));
  return [...set].sort();
}

/* Every ISO 3166-1 alpha-2 region, named by the browser in English. The code
   is what is stored; the name is only for the select. Never guessed: a
   country is chosen by a person. */
const CODES = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ');
let countryList = null;
export function countries(...extra) {
  if (!countryList) {
    let dn = null;
    try { dn = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], { type: 'region' }) : null; } catch { dn = null; }
    const name = (c) => { try { return (dn && dn.of(c)) || c; } catch { return c; } };
    countryList = CODES.map((code) => ({ code, name: name(code) })).sort((a, b) => a.name.localeCompare(b.name));
  }
  const known = new Set(countryList.map((c) => c.code));
  const more = extra.filter((c) => c && !known.has(c)).map((code) => ({ code, name: code }));
  return more.length ? [...countryList, ...more] : countryList;
}
export const countryName = (code) => (code ? (countries().find((c) => c.code === code)?.name || code) : '');

/* -- Field checks ---------------------------------------------------
   Each returns a message to show beside the field, or null. Empty is fine
   unless the caller says required: the sections decide what is mandatory,
   these decide what is well formed. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CIDR4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/;
const CIDR6 = /^[0-9a-f:]+(?:\/\d{1,3})?$/i;
const CODE = /^[A-Z0-9][A-Z0-9-]{1,15}$/;

export const required = (v, msg = 'This is needed') => (v == null || String(v).trim() === '' ? msg : null);
export const vEmail = (v) => (!v ? null : EMAIL.test(String(v).trim()) ? null : 'Not a valid email address');
export const vUrl = (v) => {
  if (!v) return null;
  try { const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`); return u.hostname.includes('.') ? null : 'Not a valid web address'; } catch { return 'Not a valid web address'; }
};
export const vPhone = (v) => (!v ? null : /^[+\d][\d\s().-]{5,24}$/.test(String(v).trim()) ? null : 'Not a valid phone number');
export const vShortCode = (v) => (!v ? null : CODE.test(String(v).trim()) ? null : '2 to 16 capital letters, digits or dashes');
export const vLat = (v) => (v === '' || v == null ? null : Number.isFinite(Number(v)) && Math.abs(Number(v)) <= 90 ? null : 'Between -90 and 90');
export const vLng = (v) => (v === '' || v == null ? null : Number.isFinite(Number(v)) && Math.abs(Number(v)) <= 180 ? null : 'Between -180 and 180');
export const vCidr = (v) => {
  const s = String(v || '').trim();
  const m = CIDR4.exec(s);
  if (m) {
    if (m.slice(1, 5).some((o) => Number(o) > 255)) return 'An octet is above 255';
    if (m[5] != null && Number(m[5]) > 32) return 'The prefix is above /32';
    return null;
  }
  if (s.includes(':') && CIDR6.test(s)) return null;
  return 'Not a range, for example 10.0.0.0/24';
};
export const vMinLen = (v, n, what = 'It') => (!v ? null : String(v).length >= n ? null : `${what} must be at least ${n} characters`);
export const vCount = (v, max = 100000) => (v === '' || v == null ? null : Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= max ? null : `A whole number up to ${max}`);

/* A short code proposed from a name: the initials of up to four words, or
   the first letters of one word, in capitals. "Northwind Colocation" gives
   NC, "Acme" gives ACME. Offered, never forced: it is saved on arrival only
   when the record has none, and the person can type over it. */
export function proposeCode(name) {
  const words = String(name || '').replace(/[^A-Za-z0-9\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const code = words.length === 1 ? words[0].slice(0, 4) : words.slice(0, 4).map((w) => w[0]).join('');
  return code.toUpperCase();
}

/* A record from the server says null where a field is empty; a controlled
   input wants ''. */
export const blank = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, v === null ? '' : v]));

export const plural = (n, one) => `${Number(n) || 0} ${Number(n) === 1 ? one : `${one}s`}`;

export function fmtDate(s) {
  if (!s) return '';
  try {
    const d = typeof s === 'number' ? new Date(s) : new Date(String(s).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(s)) ? '' : 'Z'));
    if (Number.isNaN(d.getTime())) return String(s);
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return String(s); }
}
export function fmtTime(d) {
  try { return new Date(d).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
}

/* -- The review's one line per step --------------------------------- */
const LABELS = { netbox: 'NetBox', servicenow: 'ServiceNow', both: 'NetBox and ServiceNow', none: 'None', jira: 'Jira', email: 'Email', teams: 'Teams', outlook: 'Outlook' };
export const labelOf = (k) => LABELS[k] || k;

export function summaryOf(key, model) {
  const org = model?.org || {}; const dcs = model?.dcs || []; const wide = orgWideProfile(dcs) || {};
  const names = (xs) => xs.map((d) => d.name).join(', ');
  switch (key) {
    case 'org': {
      const miss = orgMissing(org);
      return miss.length ? `Missing ${miss.map((m) => m.label.toLowerCase()).join(', ')}` : [org.name, org.short_code, countryName(org.country), org.timezone].filter(Boolean).join(', ');
    }
    case 'datacentres': {
      if (!dcs.length) return 'None';
      const bad = dcs.filter((d) => !dcAddressed(d));
      return bad.length ? `${names(dcs)}. ${names(bad)} still ${bad.length === 1 ? 'needs' : 'need'} an address` : names(dcs);
    }
    case 'spaces': {
      if (!dcs.length) return 'No datacentre yet';
      return dcs.map((d) => { const k = d.completeness?.counts; return `${d.name}: ${k ? `${plural(k.spaces, 'space')}, ${plural(k.racksTyped, 'rack')}` : dcHasSpace(d) ? 'done' : 'none'}`; }).join('; ');
    }
    case 'people': {
      if (!dcs.length) return 'No datacentre yet';
      return dcs.map((d) => `${d.name}: ${d.approver ? (d.approver.username || d.approver.email) : 'no approver'}${d.profile?.contacts?.length ? `, ${plural(d.profile.contacts.length, 'contact')}` : ''}`).join('; ');
    }
    case 'systems': {
      const x = wide.systems || {};
      if (!sectionFilled('systems', wide)) return 'Not set';
      return [x.record && x.record !== 'none' ? `Record: ${labelOf(x.record)}` : null, x.ticketing && x.ticketing !== 'none' ? `Tickets: ${labelOf(x.ticketing)}` : null, x.notifications?.length ? `Notify: ${x.notifications.map(labelOf).join(', ')}` : null].filter(Boolean).join(', ');
    }
    case 'vendors': {
      const v = wide.vendors || [];
      return v.length ? v.map((x) => `${x.name}${x.models?.length ? ` (${plural(x.models.length, 'model')})` : ''}`).join(', ') : 'None';
    }
    case 'conventions': {
      const c = wide.conventions || {};
      if (!sectionFilled('conventions', wide)) return 'None';
      const pats = ['rack_pattern', 'device_pattern', 'asset_pattern', 'port_pattern'].filter((k) => c[k]);
      return [pats.length ? plural(pats.length, 'pattern') : null, c.cable_colours?.length ? plural(c.cable_colours.length, 'cable colour') : null, c.u_from_bottom === false ? 'U counted from the top' : null].filter(Boolean).join(', ');
    }
    case 'network': {
      if (!dcs.length) return 'No datacentre yet';
      return dcs.map((d) => {
        const n = d.profile?.network || {};
        const parts = [n.management_ranges?.length ? plural(n.management_ranges.length, 'range') : null, n.wifi_ssid ? `Wi-Fi ${n.wifi_ssid}` : null, d.profile?.snmp?.configured ? `SNMP ${d.profile.snmp.version || ''} read only` : null].filter(Boolean);
        return `${d.name}: ${parts.length ? parts.join(', ') : 'not set'}`;
      }).join('; ');
    }
    case 'rules': {
      if (!dcs.length) return 'No datacentre yet';
      const bad = dcs.filter((d) => !dcRulesAccepted(d));
      return bad.length ? `Not accepted for ${names(bad)}` : 'Accepted';
    }
    default: return '';
  }
}
