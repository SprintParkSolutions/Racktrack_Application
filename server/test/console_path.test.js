/**
 * The console-transcript write path must not escape its rack.
 *
 * This pins a critical that shipped inside a FIX: an earlier hardening pass
 * validated scanId (which reaches the rack directory) but not device_index and
 * port, which are interpolated straight into the filename. So a value like
 * "../../OTHER-RACK/console/d0" walked the write into another tenant's rack —
 * or, with enough "../", out of the outputs tree entirely. Proven live by an
 * adversarial reviewer before this test existed.
 *
 * Exercised against the REAL consoleLogPath, not a copy.
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.PORT = process.env.PORT || '0';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'console-path-test';
process.env.RACKTRACK_SKIP_WORKER_POOL = '1';

after(() => { setImmediate(() => process.exit(0)); });

const { _internals } = require('../app');
const { consoleLogPath, outputsDir } = _internals;
const rackDir = path.join(outputsDir, 'RK-TESTRACK1');
const contained = (p) => !!p && path.resolve(p).startsWith(path.resolve(outputsDir) + path.sep);

test('a traversal in device_index cannot escape the rack', () => {
  assert.equal(consoleLogPath(rackDir, '../../../../RK-VICTIM/console/dX', '9'), null);
  assert.equal(consoleLogPath(rackDir, '../../../../../ROOT_ESCAPE', '9'), null);
  assert.equal(consoleLogPath(rackDir, '0', '../../../etc/x'), null, 'port must be guarded too');
});

test('non-integer device_index/port is refused', () => {
  assert.equal(consoleLogPath(rackDir, '1.5', '2'), null, 'float');
  assert.equal(consoleLogPath(rackDir, '-1', '2'), null, 'negative');
  assert.equal(consoleLogPath(rackDir, 'abc', '2'), null, 'non-numeric');
  assert.equal(consoleLogPath(rackDir, '0', 'NaN'), null);
});

test('legitimate integer indices produce a path inside the rack', () => {
  const p = consoleLogPath(rackDir, 0, 1);
  assert.ok(p, 'valid indices must produce a path');
  assert.ok(contained(p), 'the path must stay inside outputs/');
  assert.match(p, /RK-TESTRACK1[/\\]console[/\\]d0_p1\.json$/);

  // String integers coerce — the client sometimes sends them as strings.
  const p2 = consoleLogPath(rackDir, '3', '4');
  assert.ok(contained(p2));
  assert.match(p2, /d3_p4\.json$/);
});

test('saveConsoleTranscript refuses a traversal even with a valid owned scanId', () => {
  const { saveConsoleTranscript } = _internals;
  // scanId is a real, shape-valid rack the caller owns; the attack rides
  // device_index. The write must not happen.
  const result = saveConsoleTranscript({
    scanId: 'RK-TESTRACK1',
    device_index: '../../../../RK-VICTIM/console/d0',
    port: '9',
    host: '10.0.0.1',
    entries: [{ cmd: 'INJECTED' }],
  });
  assert.equal(result, null, 'a traversal write must return null, not a path');
});
