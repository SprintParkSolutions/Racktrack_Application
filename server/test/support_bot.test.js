// Support bot regression tests.
//
// The tests that matter here are the safety ones: tier isolation, refusing
// rather than guessing, and the credential guard. A support bot that gives a
// confident wrong answer costs a technician an hour in a datacenter, so those
// three are treated as correctness bugs, not nice-to-haves.
//
// Run: node --test test/support_bot.test.js

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Use the synthetic fixture so these tests do not depend on the real knowledge
// base, which changes as the product does.
process.env.SUPPORT_KB_PATH = path.join(
  __dirname, '..', '..', 'support-bot', 'kb', 'FIXTURE-synthetic-smoke-test.json'
);
// Deterministic: never let a locally-running model change test outcomes.
process.env.SUPPORT_BOT_LLM = 'off';

const bot = require('../lib/support_bot');

// Routes shift as the knowledge base grows (a question unambiguous among 9
// entries may be ambiguous among 350), so tests assert the safety PROPERTY —
// every answer is traceable, every decline cites nothing — rather than a
// specific route, which is an implementation detail.
const ANSWERING_ROUTES = ['verbatim', 'grounded', 'suggestions'];
const DECLINING_ROUTES = ['refusal', 'out-of-scope', 'needs-access'];
const { detectCredential, detectOutOfScope, validate, tokenize } = bot._internals;

// The end-user/admin tier split was removed: every role now gets the same bot.
// These tests were written against the old two-tier model and are re-pointed at
// the invariant that survived it — `internal-only` knowledge is answerable to
// NOBODY, which is now a structural property rather than a per-role one.

test('every role maps to the single knowledge tier', () => {
  for (const role of ['member', undefined, 'nonsense', 'org_admin', 'site_manager', 'owner']) {
    assert.equal(bot.tierForRole(role), 'all', `role ${role} must map to the single tier`);
  }
});

test('internal-only entries are absent from the answering index', () => {
  const counts = bot.warmup();
  // The fixture holds 9 entries, one of them audience "internal-only".
  assert.equal(counts.all, 8, 'the answering index must exclude internal-only entries');
});

test('internal-only knowledge is unreachable for every caller', async () => {
  const q = 'How is the ServiceNow integration credential configured on the server?';
  const r = await bot.ask(q);

  // The security property is that no restricted CONTENT reaches the caller —
  // "that needs admin access" is a better answer than a bare refusal, and
  // naming the area leaks nothing the user could not see in the navigation.
  assert.ok(
    DECLINING_ROUTES.includes(r.route),
    `expected a declining route, got ${r.route}`
  );
  assert.deepEqual(r.sources, [], 'a declined answer must cite nothing');
  assert.ok(
    !/api[_ -]?key|token|password|process\.env/i.test(r.answer),
    'must not describe the credential mechanism'
  );
  assert.ok(!r.sources.includes('INT-001'), 'the internal entry must never be cited');
});

// Routes shift as the knowledge base grows (a question that is unambiguous
// among 9 entries may be ambiguous among 200), so these assert the safety
// property — "every answer is traceable to a verified entry" — rather than a
// specific route, which is an implementation detail.

test('a real question is answered from the knowledge base, with sources', async () => {
  const r = await bot.ask('why does the app say my password is wrong');
  assert.ok(ANSWERING_ROUTES.includes(r.route), `unexpected route ${r.route}`);
  assert.ok(r.sources.length > 0, 'a substantive answer must cite a source');
});

test('declines rather than guessing when nothing matches', async () => {
  for (const q of [
    'How much does RackTrack cost per user?',
    'How do I configure a BGP session on a Cisco 9300?',
    'How do I turn on the automatic thermal mapping overlay?',
  ]) {
    const r = await bot.ask(q);
    assert.ok(DECLINING_ROUTES.includes(r.route), `should have declined (${r.route}): ${q}`);
    // The property that matters: nothing was invented, so nothing is cited.
    assert.deepEqual(r.sources, [], `declined but cited sources: ${q}`);
  }
});

test('questions this KB structurally cannot answer are caught by intent', async () => {
  // Roadmap, pricing and competitor questions are not gaps to fill later —
  // source code never contains those facts. They must not reach retrieval,
  // where a superficially similar entry would look like a confident match.
  const cases = [
    'When will you add support for Juniper switches?',
    'Is RackTrack better than NetBox?',
    'What is the price per user?',
  ];
  for (const q of cases) {
    const r = await bot.ask(q);
    assert.equal(r.route, 'out-of-scope', `expected out-of-scope for: ${q}`);
    assert.deepEqual(r.sources, []);
  }
});

test("comparing two racks is a RackTrack feature, not a competitor question", async () => {
  // The comparison guard used to fire on the verbs alone, so the most natural
  // phrasing of a documented workflow (RACK-004, HIST-009) was answered with
  // "I can't compare RackTrack to other products" — confidently wrong about a
  // feature we ship. The signal has to be the OTHER product, not the verb.
  for (const q of [
    'how do I compare the two racks',
    'how do I actually compare the two racks against each other',
    'can I put two past scans of the same rack side by side',
    'compare this scan with the previous one',
  ]) {
    assert.equal(detectOutOfScope(q), null, `must not read as a competitor question: ${q}`);
    const r = await bot.ask(q);
    assert.notEqual(r.route, 'out-of-scope', `must not be turned away as out of scope: ${q}`);
  }

  // ...while a question about an actual competitor still is out of scope.
  for (const q of [
    'Is RackTrack better than NetBox?',
    'how does racktrack compare to device42',
    'is there an alternative to RackTrack we should look at',
    'who are your competitors',
  ]) {
    assert.equal(detectOutOfScope(q)?.kind, 'comparison', `expected a comparison refusal: ${q}`);
  }
});

test('the rack-comparison question reaches the real knowledge base', async () => {
  // The fixture has no comparison entry, so reaching the ENTRY this fix is
  // about has to be checked against the shipped KB — in a child process,
  // because the KB path is read once at module load.
  const realKb = path.join(__dirname, '..', 'data', 'support-kb.json');
  if (!fs.existsSync(realKb)) return;   // KB not present in this checkout

  const script = `
    process.env.SUPPORT_KB_PATH = ${JSON.stringify(realKb)};
    process.env.SUPPORT_BOT_LLM = 'off';
    require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'support_bot.js'))})
      .ask('how do I compare the two racks against each other')
      .then((r) => console.log(JSON.stringify({ route: r.route, sources: r.sources })));
  `;
  const out = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  const r = JSON.parse(out.trim().split('\n').pop());

  assert.notEqual(r.route, 'out-of-scope', 'a documented feature must not be refused as out of scope');
  assert.ok(ANSWERING_ROUTES.includes(r.route), `expected an answering route, got ${r.route}`);
  assert.ok(r.sources.length > 0, 'the answer must cite the entry it came from');
});

test('a vague one-word question is never answered confidently', async () => {
  // One matching word cannot identify which entry someone means.
  const r = await bot.ask('its broken');
  assert.notEqual(r.route, 'verbatim', 'must not answer a vague query verbatim');
});

test('credential guard fires on a stated secret', async () => {
  const r = await bot.ask("My password is Summer2026! and it still won't log me in");
  assert.equal(r.route, 'credential-guard');
  assert.match(r.answer, /change it now/i);
});

test('credential guard does NOT fire on merely mentioning a password', () => {
  // The distinction that matters: a secret being *stated* vs *mentioned*.
  assert.equal(detectCredential('my password is wrong'), null);
  assert.equal(detectCredential('I forgot my password'), null);
  assert.equal(detectCredential('the password field is greyed out'), null);

  assert.ok(detectCredential('my password is Summer2026!'));
  assert.ok(detectCredential('token: ghp_abcdefghijklmnopqrstuvwxyz0123'));
});

test('model output citing an unknown source is rejected', () => {
  const matches = [{ entry: { id: 'AUTH-001' } }];
  assert.equal(validate({ answer: 'Try this.', sources: ['AUTH-001'] }, matches).ok, true);
  assert.equal(validate({ answer: 'Try this.', sources: ['MADE-UP-999'] }, matches).ok, false);
  assert.equal(validate({ answer: 'Try this.', sources: [] }, matches).ok, false);
  assert.equal(validate({ answer: '--- FACTS --- leaked', sources: ['AUTH-001'] }, matches).ok, false);
});

test('empty and junk input do not throw', async () => {
  for (const q of ['', '   ', '???', ' ']) {
    const r = await bot.ask(q);
    assert.ok(typeof r.answer === 'string' && r.answer.length > 0);
  }
});

test('tokenizer drops stopwords and stems conservatively', () => {
  assert.deepEqual(tokenize('the scanning is broken'), ['scann', 'broken']);
  assert.deepEqual(tokenize(''), []);
});

test('a named competitor is never answered from an adjacent entry', () => {
  // The out-of-scope guard could be overridden by a well-matched entry, so
  // "how do I export ... to netbox" came back as a cited, authoritative answer
  // about our export formats — implying an integration that does not exist.
  // Roadmap and pricing phrasing can still lose to a genuinely good match; a
  // named competitor cannot.
  const { detectOutOfScope } = bot._internals;
  for (const q of [
    'how do I export my rack inventory to netbox',
    'is RackTrack better than NetBox?',
    'racktrack compared to device42',
  ]) {
    const r = detectOutOfScope(q);
    assert.ok(r, `expected an out-of-scope signal for: ${q}`);
    assert.equal(r.kind, 'comparison', `${q} must classify as a competitor question`);
  }
});
