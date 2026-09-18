/**
 * Whether we are allowed to send a request to an address, and over what scheme.
 *
 * This exists because of where the product is going: a customer types the
 * address of their OWN NetBox or ServiceNow and we connect to it. A URL typed
 * by a user and fetched by a server is the definition of server side request
 * forgery, and the two classic ways to get it wrong are both covered here.
 *
 * Ported from the on-device CMDB lookup a colleague wrote, keeping its
 * reasoning rather than only its rules.
 *
 *   1. Judging only the address that was typed is not enough. A host that
 *      passed at sign in can answer with a redirect, and the address it
 *      redirects to was judged by nobody. So the check has to run on every hop,
 *      which is why `guardedFetch` re-checks rather than trusting the first URL.
 *   2. A name is not an address. `internal.example.com` can resolve to
 *      169.254.169.254, and it can resolve to something different the second
 *      time it is asked. So the name is resolved and EVERY address it resolves
 *      to is judged.
 *
 * And the scheme is chosen the safe way round. A private address may be plain
 * http, because on a lab network it usually is. A public address is only ever
 * tried over https, and nothing here ever falls back from https to http: a
 * certificate that cannot be verified is a reason to stop, not a reason to send
 * the same password again unencrypted, which is exactly what somebody listening
 * would be hoping for.
 */
const dns = require('node:dns').promises;
const net = require('node:net');

/** Addresses that hand out cloud credentials to anything that asks. */
const METADATA = new Set([
  '169.254.169.254',       // AWS, Azure, GCP, DigitalOcean, Oracle
  'metadata.google.internal',
  '100.100.100.200',       // Alibaba
  'fd00:ec2::254',         // AWS IMDSv2 over IPv6
]);

/** A refusal the caller can show to whoever typed the address. */
class AddressRefused extends Error {
  constructor(message) {
    super(message);
    this.name = 'AddressRefused';
    this.code = 'address_refused';
  }
}

/** Strip a port, brackets and any credentials someone pasted into the host. */
function bareHost(host) {
  let h = String(host || '').trim().toLowerCase();
  const at = h.lastIndexOf('@');
  if (at !== -1) h = h.slice(at + 1);
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    return end === -1 ? h.slice(1) : h.slice(1, end);
  }
  const colon = h.indexOf(':');
  return colon === -1 ? h : h.slice(0, colon);
}

const ip4 = (a) => a.split('.').map(Number);

/**
 * Is this literal address one we must never connect to?
 *
 * Metadata is checked BEFORE private, and the order is the point: the metadata
 * address is link local, and link local counts as private, so asking "is it
 * private?" first would classify the single most dangerous address in cloud
 * hosting as merely private and let a configuration that permits private
 * addresses through. A colleague's comment on the original says the same.
 */
function refuse(address) {
  const a = String(address).toLowerCase();
  if (METADATA.has(a)) return 'it is a cloud metadata address';
  if (net.isIPv4(a)) {
    const [p, q] = ip4(a);
    if (p === 169 && q === 254) return 'it is a link local address';
    if (p === 0 || p === 127) return 'it is a loopback address';
    if (p === 10) return 'it is a private address';
    if (p === 172 && q >= 16 && q <= 31) return 'it is a private address';
    if (p === 192 && q === 168) return 'it is a private address';
    if (p === 100 && q >= 64 && q <= 127) return 'it is a carrier grade NAT address';
    if (p >= 224) return 'it is a multicast or reserved address';
    return null;
  }
  if (net.isIPv6(a)) {
    if (a === '::1' || a === '::') return 'it is a loopback address';
    if (a.startsWith('fe80')) return 'it is a link local address';
    if (a.startsWith('fc') || a.startsWith('fd')) return 'it is a private address';
    // An IPv4 address wearing an IPv6 hat is still that IPv4 address.
    const mapped = a.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return refuse(mapped[1]);
    return null;
  }
  return null;
}

const isLiteral = (h) => net.isIP(h) !== 0;

/** Is this address on this machine or on a private network? */
function isLocal(host) {
  const h = bareHost(host);
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  if (!isLiteral(h)) return false;
  const why = refuse(h);
  return why === 'it is a private address' || why === 'it is a loopback address';
}

/**
 * May we connect to this host?
 *
 * `allowPrivate` is how a self hosted RackTrack sitting inside the customer's
 * own network reaches their NetBox on 10.x, which is a completely normal
 * deployment. It never admits a metadata address: that is refused whatever the
 * setting, because nothing a customer legitimately runs lives there.
 */
async function checkHost(host, { allowPrivate = false, allowed = null, resolve = null } = {}) {
  const h = bareHost(host);
  if (!h) throw new AddressRefused('Enter the address of your system.');
  if (METADATA.has(h) || h.endsWith('.metadata.google.internal')) {
    throw new AddressRefused(`${h} is not an address this can be pointed at.`);
  }

  // The permitted list is checked before the name is looked up, so a host
  // nobody may use is not even resolved.
  if (Array.isArray(allowed) && allowed.length) {
    const ok = allowed.some((e) => h === e || h.endsWith(`.${String(e).replace(/^\./, '')}`));
    if (!ok) {
      throw new AddressRefused(
        `${h} is not on the list of systems this installation may connect to. `
        + 'Ask whoever runs it to add it.');
    }
  }

  const addresses = isLiteral(h)
    ? [h]
    : await (resolve || ((name) => dns.lookup(name, { all: true, verbatim: true })
      .then((rs) => rs.map((r) => r.address))))(h);

  for (const address of addresses) {
    const why = refuse(address);
    if (!why) continue;
    if (allowPrivate && (why === 'it is a private address' || why === 'it is a loopback address')) continue;
    const where = String(address) === h ? '' : ` (it resolves to ${address})`;
    throw new AddressRefused(`${h} cannot be reached from here${where}: ${why}.`);
  }
  return h;
}

/** The same judgement, on a whole URL. Used on every redirect hop. */
async function checkUrl(url, opts = {}) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new AddressRefused(`${url} is not a valid address.`); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AddressRefused(`${parsed.protocol.replace(':', '')} is not a scheme this can use.`);
  }
  await checkHost(parsed.hostname, opts);
  return parsed;
}

/**
 * What somebody typed, turned into the URLs worth trying, best guess first.
 *
 * People type "netbox.acme.com" or "10.0.0.5:8000", not a full URL, so the
 * scheme is chosen for them - the safe way round, and never falling back from
 * https to http.
 */
function urlCandidates(raw, { allowPlainHttp = false } = {}) {
  const text = String(raw || '').trim().replace(/\/+$/, '');
  if (!text) throw new AddressRefused('Enter the address of your system.');

  if (/^https?:\/\//i.test(text)) {
    const parsed = new URL(text);
    if (parsed.protocol === 'http:' && !isLocal(parsed.hostname) && !allowPlainHttp) {
      throw new AddressRefused(
        `Refusing to send your password to ${bareHost(parsed.hostname)} unencrypted. `
        + 'Use https:// instead.');
    }
    return [text];
  }

  const host = text.split('/')[0];
  // A lab machine is usually plain http, so try that first and https second.
  if (isLocal(host)) return [`http://${text}`, `https://${text}`];
  // A public address is https, and stays https even when https fails.
  return allowPlainHttp ? [`https://${text}`, `http://${text}`] : [`https://${text}`];
}

/** How many redirects to follow before calling it a loop. */
const MAX_HOPS = 5;

/**
 * fetch, with every hop judged.
 *
 * Node follows redirects itself, which is exactly the problem: the address it
 * follows to is never seen by us. So redirects are taken manually and each new
 * address goes through checkUrl before a single byte is sent to it. A host that
 * passed at sign in cannot hand us to 169.254.169.254 afterwards.
 *
 * The Authorization header is dropped when a redirect crosses to another
 * origin, for the same reason a browser does it: a token issued for the
 * customer's NetBox must not be handed to whoever their DNS points at next.
 */
async function safeFetch(url, options = {}, guard = {}) {
  let current = String(url);
  const headers = { ...(options.headers || {}) };
  const origin = (u) => { const p = new URL(u); return `${p.protocol}//${p.host}`; };
  const first = await checkUrl(current, guard);
  let from = `${first.protocol}//${first.host}`;

  for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
    const res = await fetch(current, { ...options, headers, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(res.status)) return res;
    const location = res.headers.get('location');
    if (!location) return res;
    const next = new URL(location, current).toString();
    await checkUrl(next, guard);
    if (origin(next) !== from) {
      delete headers.Authorization;
      delete headers.authorization;
      from = origin(next);
    }
    current = next;
  }
  throw new AddressRefused(`${url} redirected more than ${MAX_HOPS} times.`);
}

module.exports = {
  AddressRefused, bareHost, refuse, isLocal, checkHost, checkUrl, urlCandidates,
  safeFetch, METADATA, MAX_HOPS,
};
