// The support bot is now the vendored DOT engine (server/lib/dot), reached
// through the CJS bridge in server/lib/support_bot.js. These smoke tests assert
// the bridge loads the engine and returns well-formed answers.
const { test } = require('node:test');
const assert = require('node:assert');
const bot = require('../lib/support_bot');

const ROUTES = new Set(['verbatim','grounded','suggestions','refusal','out-of-scope',
  'needs-access','credential-guard','general-fallback','clarify','empty']);

test('engine answers a known question with a valid route', async () => {
  const r = await bot.ask('what is drift', { tier: 'end-user' });
  assert.ok(r && typeof r.answer === 'string' && r.answer.length > 0, 'returns an answer');
  assert.ok(ROUTES.has(r.route), `valid route (got ${r.route})`);
});

test('tierForRole maps roles to engine tiers', () => {
  assert.strictEqual(bot.tierForRole('owner'), 'admin');
  assert.strictEqual(bot.tierForRole('org_admin'), 'admin');
  assert.strictEqual(bot.tierForRole('member'), 'end-user');
});

test('credential guard still fires', async () => {
  const r = await bot.ask('my password is Summer2026! and I cannot sign in', { tier: 'end-user' });
  assert.ok(r && typeof r.answer === 'string');
});
