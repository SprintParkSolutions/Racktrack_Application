/**
 * A non-owner must not be able to send an arbitrary command to a switch.
 *
 * /api/switch/console/run is requireAuth, not requireRole, and it takes its
 * command string from the request body — so before the allowlist, any approved
 * member could POST {"host":"...","command":"configure terminal"} and drive real
 * network equipment into config mode. That is a latent problem on the office
 * deployment and an acute one on a public demo, where "member" means whoever we
 * handed a login to.
 *
 * These tests pin both halves of the gate:
 *   - the allowlist accepts every command the product's own UI can produce, so
 *     hardening it did not quietly break the console, the probe, or the audit;
 *   - it refuses writes, chained commands, and anything smuggled through an
 *     {iface} substitution.
 *
 * Exercised against the REAL isAllowedConsoleCommand the route calls, not a copy.
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.PORT = process.env.PORT || '0';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'console-allowlist-test';
process.env.RACKTRACK_SKIP_WORKER_POOL = '1';

after(() => { setImmediate(() => process.exit(0)); });

const { _internals } = require('../app');
const { isAllowedConsoleCommand, consoleCommandTemplates } = _internals;

// ── The commands the product itself sends ──────────────────────────

test('every curated template is allowed once {iface} is substituted', () => {
  const templates = [...consoleCommandTemplates()];
  assert.ok(templates.length > 20, `expected the curated set, got ${templates.length}`);
  for (const tmpl of templates) {
    const concrete = tmpl.replace(/\{iface\}/g, '1/0/5');
    assert.equal(isAllowedConsoleCommand(concrete), true,
      `curated command rejected: ${concrete}`);
  }
});

test('the client callers that exist today still pass', () => {
  // portsProbe.js — the port-probe utility.
  assert.equal(isAllowedConsoleCommand('show interface status'), true);
  // SWITCH_INFO_CMD, all three vendors (ResultsPage Switch Info modal).
  assert.equal(isAllowedConsoleCommand('show version'), true);
  assert.equal(isAllowedConsoleCommand('show system-info'), true);
  assert.equal(isAllowedConsoleCommand('show switch'), true);
  // A substituted intent, in each vendor's interface dialect.
  assert.equal(isAllowedConsoleCommand('show ports 1/0/5'), true);
  assert.equal(isAllowedConsoleCommand('show interfaces Et0/3 status'), true);
  assert.equal(isAllowedConsoleCommand('show lldp neighbors Gi1/0/28 detail'), true);
});

test('case and whitespace are normalized, not grounds for refusal', () => {
  assert.equal(isAllowedConsoleCommand('SHOW VERSION'), true);
  assert.equal(isAllowedConsoleCommand('  show    version  '), true);
});

// ── What it must refuse ────────────────────────────────────────────

test('config-mode and write commands are refused', () => {
  for (const cmd of [
    'configure terminal',
    'conf t',
    'write memory',
    'copy running-config startup-config',
    'erase startup-config',
    'reload',
    'delete flash:/config.text',
    'interface Et0/1',
    'no shutdown',
    'shutdown',
  ]) {
    assert.equal(isAllowedConsoleCommand(cmd), false, `should refuse: ${cmd}`);
  }
});

test('a read verb alone is not enough — it must also be a curated command', () => {
  // Passes the shape gate, fails the allowlist. This is the half that stops
  // read commands we never vetted (and vendor commands that page or hang).
  assert.equal(isAllowedConsoleCommand('show running-config'), false);
  assert.equal(isAllowedConsoleCommand('show tech-support'), false);
  assert.equal(isAllowedConsoleCommand('show startup-config'), false);
});

test('a write cannot be chained onto an allowed read', () => {
  for (const cmd of [
    'show version; configure terminal',
    'show version | configure terminal',
    'show version && reload',
    'show version\nconfigure terminal',
    'show version\r\nreload',
  ]) {
    assert.equal(isAllowedConsoleCommand(cmd), false, `should refuse chained: ${cmd}`);
  }
});

test('an {iface} substitution cannot smuggle a second command', () => {
  // The interface token deliberately excludes whitespace and CLI separators, so
  // a hostile `interface` value cannot widen a pattern that matched the prefix.
  for (const iface of [
    '1/0/5; reload',
    '1/0/5 | configure terminal',
    '1/0/5 && write memory',
    '1/0/5\nreload',
  ]) {
    assert.equal(isAllowedConsoleCommand(`show ports ${iface}`), false,
      `should refuse smuggled iface: ${iface}`);
  }
});

test('an unsubstituted placeholder is refused rather than sent literally', () => {
  assert.equal(isAllowedConsoleCommand('show ports {iface}'), false);
});

test('empty and non-string input is refused', () => {
  for (const cmd of ['', '   ', null, undefined, 0, {}, []]) {
    assert.equal(isAllowedConsoleCommand(cmd), false, `should refuse: ${JSON.stringify(cmd)}`);
  }
});
