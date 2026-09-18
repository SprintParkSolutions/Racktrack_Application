/**
 * Working out what is behind an address, and refusing the addresses we must
 * never connect to.
 *
 * A customer types the address of their OWN NetBox or ServiceNow and this
 * server connects to it. That is the definition of server side request forgery,
 * so the address checks below are not hygiene, they are the feature working
 * safely. The two classic mistakes are both covered: judging only the address
 * that was typed and not the one it redirects to, and trusting a name instead
 * of the addresses it resolves to.
 *
 * `fetch` is stubbed throughout. Nothing here opens a socket.
 */
const test = require('node:test');
const assert = require('node:assert');

const safe = require('../../lib/safe_address');
const detect = require('../../lib/netbox/connectors/detect');

// A resolver that never touches DNS.
const RESOLVE = {
  'netbox.acme.test': ['93.184.216.34'],
  'acme.service-now.com': ['93.184.216.35'],
  'sneaky.acme.test': ['169.254.169.254'],
  'rebind.acme.test': ['93.184.216.34', '10.0.0.5'],
  'nb.internal.test': ['10.0.0.9'],
};
const resolve = async (name) => RESOLVE[name] || ['93.184.216.34'];

/** Stand in for one HTTP answer. */
const reply = (status, { body = null, headers = {} } = {}) => ({
  status,
  headers: { get: (k) => headers[String(k).toLowerCase()] ?? null },
  json: async () => { if (body === null) throw new Error('not json'); return body; },
});

function stubFetch(routes) {
  const seen = [];
  global.fetch = async (url) => {
    seen.push(String(url));
    for (const [match, answer] of routes) {
      if (String(url).includes(match)) return answer;
    }
    return reply(404, { body: {} });
  };
  return seen;
}

const realFetch = global.fetch;
test.afterEach(() => { global.fetch = realFetch; });

// -- what is behind the address ------------------------------------------

test('a NetBox is known by its guarded status endpoint, with no login', () => {
  const guarded = [['/api/status/', reply(403, { body: {} })]];
  stubFetch(guarded);
  return detect.probe('https://netbox.acme.test', { resolve }).then((out) => {
    assert.equal(out.type, 'netbox');
    // 403 is the tell, not a failure: only something that HAS that endpoint
    // bothers to guard it.
    assert.match(out.why, /NetBox/);
  });
});

test('a NetBox that answers openly is known by its version field', async () => {
  stubFetch([['/api/status/', reply(200, { body: { 'netbox-version': '4.1.0' } })]]);
  const out = await detect.probe('https://netbox.acme.test', { resolve });
  assert.equal(out.type, 'netbox');
});

test('a ServiceNow is known by its own name in the challenge it sends back', async () => {
  stubFetch([['/api/now/table/sys_user', reply(401, {
    headers: { 'www-authenticate': 'Basic realm="Service-now"' },
  })]]);
  const out = await detect.probe('https://cmdb.acme.test', { resolve });
  assert.equal(out.type, 'servicenow');
});

test('a ServiceNow is known by its hostname before anything is asked at all', async () => {
  const seen = stubFetch([]);
  const out = await detect.probe('https://acme.service-now.com', { resolve });
  assert.equal(out.type, 'servicenow');
  assert.equal(seen.length, 0, 'the hostname settled it, so nothing was asked');
});

test('anything else is a REST CMDB, and that guess is made last', async () => {
  stubFetch([]);   // everything 404s
  const out = await detect.probe('https://something.acme.test', { resolve });
  assert.equal(out.type, 'rest');
  // The order matters: rest accepts almost any JSON API, so trying it earlier
  // would swallow a NetBox or a ServiceNow that was simply misread.
  assert.deepEqual(detect.ORDER, ['netbox', 'servicenow', 'rest']);
});

// -- the scheme is chosen the safe way round ------------------------------

test('a public address is only ever tried over https, and never falls back', () => {
  assert.deepEqual(safe.urlCandidates('netbox.acme.test'), ['https://netbox.acme.test']);
  // A certificate that cannot be verified is a reason to stop, not a reason to
  // send the same password again unencrypted.
  assert.equal(safe.urlCandidates('netbox.acme.test').some((u) => u.startsWith('http://')), false);
});

test('a lab address may be plain http, because on a lab network it usually is', () => {
  assert.deepEqual(safe.urlCandidates('10.0.0.9:8000'),
    ['http://10.0.0.9:8000', 'https://10.0.0.9:8000']);
  assert.deepEqual(safe.urlCandidates('localhost:8000'),
    ['http://localhost:8000', 'https://localhost:8000']);
});

test('http typed out in full, to a public host, is refused rather than obeyed', () => {
  assert.throws(() => safe.urlCandidates('http://netbox.acme.test'),
    /unencrypted/i, 'it says why, and names the host');
});

// -- the addresses we must never connect to -------------------------------

test('the cloud metadata address is refused, and refused before "is it private"', async () => {
  // It is link local, and link local counts as private, so a check that asked
  // "is it private?" first would classify the most dangerous address in cloud
  // hosting as merely private and let a permissive setting through.
  await assert.rejects(safe.checkHost('169.254.169.254', { resolve }), /not an address/);
  await assert.rejects(safe.checkHost('169.254.169.254', { allowPrivate: true, resolve }),
    /not an address/, 'even where private addresses are allowed');
  await assert.rejects(safe.checkHost('metadata.google.internal', { resolve }), /not an address/);
});

test('a name is judged by what it resolves to, not by how it looks', async () => {
  await assert.rejects(safe.checkHost('sneaky.acme.test', { resolve }),
    /resolves to 169\.254\.169\.254/, 'and it says what it resolved to');
});

test('a name that resolves to several addresses is refused if ANY of them is forbidden', async () => {
  // The DNS rebinding case: one good answer and one bad one.
  await assert.rejects(safe.checkHost('rebind.acme.test', { resolve }), /10\.0\.0\.5/);
});

test('a private address is reachable only where the installation says so', async () => {
  await assert.rejects(safe.checkHost('nb.internal.test', { resolve }), /private address/);
  // RackTrack running inside the customer's own network is a normal deployment.
  await assert.doesNotReject(safe.checkHost('nb.internal.test', { allowPrivate: true, resolve }));
});

test('an allowed list is checked before the name is even looked up', async () => {
  let asked = false;
  const watched = async (n) => { asked = true; return RESOLVE[n] || ['93.184.216.34']; };
  await assert.rejects(
    safe.checkHost('netbox.acme.test', { allowed: ['acme.com'], resolve: watched }),
    /not on the list/);
  assert.equal(asked, false, 'a host nobody may use is not resolved');
  await assert.doesNotReject(
    safe.checkHost('netbox.acme.com', { allowed: ['acme.com'], resolve: watched }));
});

// -- the redirect, which is the hole most implementations leave open -------

test('a redirect to a forbidden address is caught, not followed', async () => {
  global.fetch = async (url) => (String(url).includes('start')
    ? reply(302, { headers: { location: 'http://169.254.169.254/latest/meta-data/' } })
    : reply(200, { body: { ok: true } }));
  await assert.rejects(
    safe.safeFetch('https://netbox.acme.test/start', {}, { resolve }),
    /not an address/,
    'the first URL passing is not enough: every hop is judged');
});

test('a redirect to another origin does not carry the token with it', async () => {
  const sent = [];
  global.fetch = async (url, opts) => {
    sent.push({ url: String(url), auth: (opts.headers || {}).Authorization || null });
    return String(url).includes('start')
      ? reply(302, { headers: { location: 'https://elsewhere.acme.test/taken' } })
      : reply(200, { body: {} });
  };
  await safe.safeFetch('https://netbox.acme.test/start',
    { headers: { Authorization: 'Token secret' } }, { resolve });
  assert.equal(sent[0].auth, 'Token secret', 'the first request carries it');
  assert.equal(sent[1].auth, null, 'the redirect target does not');
});

test('a redirect that stays on the same origin keeps the token', async () => {
  const sent = [];
  global.fetch = async (url, opts) => {
    sent.push((opts.headers || {}).Authorization || null);
    return String(url).includes('start')
      ? reply(302, { headers: { location: 'https://netbox.acme.test/moved' } })
      : reply(200, { body: {} });
  };
  await safe.safeFetch('https://netbox.acme.test/start',
    { headers: { Authorization: 'Token secret' } }, { resolve });
  assert.equal(sent[1], 'Token secret');
});

test('a redirect loop ends, rather than going round for ever', async () => {
  global.fetch = async () => reply(302, { headers: { location: 'https://netbox.acme.test/again' } });
  await assert.rejects(safe.safeFetch('https://netbox.acme.test/a', {}, { resolve }),
    /redirected more than/);
});

// -- what the caller sees -------------------------------------------------

test('a refused address is not reported as a failed guess', async () => {
  stubFetch([]);
  await assert.rejects(detect.detect('169.254.169.254', { resolve }), /not an address/);
});

test('nothing answering says so, and names what was tried', async () => {
  global.fetch = async () => { throw new Error('ECONNREFUSED'); };
  await assert.rejects(detect.detect('netbox.acme.test', { resolve }),
    /Nothing answered at https:\/\/netbox\.acme\.test/);
});
