/**
 * Reading a rack's photograph again with newer models, without anything filed
 * against the old reading landing on the wrong box.
 *
 * The case that makes this necessary is on the demo rack. The OCR read "D-Link"
 * at U12 and a person corrected U12 to "Dlink DGS-1024C". The trained unit grid
 * numbers that same switch as U18. Re-keyed by U alone, the correction would be
 * applied to whatever box the new grid puts at U12. It is re-keyed by where the
 * box sits on the photograph instead - the one thing a re-read of the same
 * photograph cannot change.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const R = require('../lib/reanalyze');

const dev = (cls, units, box) => ({ class_name: cls, units, box });

// The demo rack's shape: a D-Link switch that was U12 and is now U18, and a
// Router that was U13 and is now U20, over the same pixels.
const OLD = { devices: [
  dev('Switch', ['u13'], [264, 5, 1030, 77]),
  dev('Switch', ['u12'], [264, 158, 1030, 280]),
  dev('Empty', ['u11'], [264, 280, 1030, 300]),
] };
const NEW = { devices: [
  dev('Router', ['u20'], [264, 5, 1030, 78]),
  dev('Empty', ['u19'], [264, 80, 1030, 150]),
  dev('Switch', ['u18'], [264, 160, 1030, 281]),
] };

test('each old box is matched to the new box over the same pixels', () => {
  const { index, u } = R.matchDevices(OLD, NEW);
  assert.equal(index.get(0), 0, 'the Router is still the first device');
  assert.equal(index.get(1), 2, 'the D-Link is now the third');
  assert.equal(u.get('U12'), 'U18');
  assert.equal(u.get('U13'), 'U20');
});

test('an empty slot is never a place a correction moves to', () => {
  const { u } = R.matchDevices(OLD, NEW);
  assert.ok(![...u.values()].includes('U19'));
  assert.ok(!u.has('U11'));
});

test('a person\'s correction moves with its box, not with its number', () => {
  const { u } = R.matchDevices(OLD, NEW);
  const m = R.migrateOverrides({ U12: { make: 'Dlink', model: 'Dgs-1024c' } }, u);
  assert.deepEqual(m.data, { U18: { make: 'Dlink', model: 'Dgs-1024c' } });
  assert.equal(m.moved, 1);
  assert.deepEqual(m.dropped, []);
});

test('the OCR reading moves with its box too', () => {
  const { u } = R.matchDevices(OLD, NEW);
  const m = R.migrateOcr({ devices: [
    { position: 'U12', class_name: 'Switch', make: 'D-Link', model: 'SP-R1-U18-SW04' },
    { position: 'U13', class_name: 'Switch', source: 'ocr_failed' },
  ] }, u);
  assert.deepEqual(m.data.devices.map((r) => r.position), ['U18', 'U20']);
  assert.equal(m.data.devices[0].make, 'D-Link');
});

test('a reading with no box to go to is named, not re-filed under a guess', () => {
  const m = R.migrateOverrides({ U05: { make: 'Cisco' } }, new Map([['U12', 'U18']]));
  assert.deepEqual(m.data, {});
  assert.deepEqual(m.dropped, ['U05']);
});

test('a log names the device by its new number and keeps the old one beside it', () => {
  const { index } = R.matchDevices(OLD, NEW);
  const text = [
    JSON.stringify({ device_index: 1, port: 5 }),
    JSON.stringify({ device_index: 0, port: 2 }),
    '',
  ].join('\n');
  const m = R.migrateIndexLog(text, index);
  const rows = m.text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(rows[0].device_index, 2);
  assert.equal(rows[0].device_index_before_reanalysis, 1);
  assert.equal(rows[1].device_index, 0, 'a device whose number did not change is left alone');
  assert.equal(rows[1].device_index_before_reanalysis, undefined);
  assert.equal(m.moved, 1);
});

// -- the whole run, with the pipeline stood in ----------------------------

function rackFolder() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reanalyze-'));
  const outputsDir = path.join(root, 'outputs');
  const backupsDir = path.join(root, 'backups');
  const dir = path.join(outputsDir, 'RK-TEST0001');
  fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'ports'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'original_image.jpg'), 'jpeg');
  fs.writeFileSync(path.join(dir, 'device_unit_map.json'), JSON.stringify(OLD));
  fs.writeFileSync(path.join(dir, 'device_overrides.json'), JSON.stringify({ U12: { make: 'Dlink' } }));
  fs.writeFileSync(path.join(dir, 'scan_result.json'), '{"stale":true}');
  fs.writeFileSync(path.join(dir, 'report.html'), '<p>old</p>');
  fs.writeFileSync(path.join(dir, 'images', 'old.png'), 'old');
  fs.writeFileSync(path.join(dir, 'ports', 'd1_p2_full.png'), 'old');
  fs.writeFileSync(path.join(dir, 'scan_meta.json'), JSON.stringify({ rackId: 'RK-TEST0001' }));
  return { outputsDir, backupsDir, dir };
}

const pipelineWriting = (map) => async (image, out) => {
  assert.ok(fs.existsSync(image), 'the pipeline is given the photograph');
  fs.mkdirSync(path.join(out, 'images'), { recursive: true });
  fs.writeFileSync(path.join(out, 'images', 'new.png'), 'new');
  fs.writeFileSync(path.join(out, 'device_unit_map.json'), JSON.stringify(map));
};

test('a rack read again gets the new map, carries its corrections, and rebuilds the rest', async () => {
  const f = rackFolder();
  const out = await R.reanalyzeRack({ rackId: 'RK-TEST0001', ...f,
    runPipeline: pipelineWriting(NEW), stamp: 't1' });

  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.dir, 'device_unit_map.json'))), NEW);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.dir, 'device_overrides.json'))), { U18: { make: 'Dlink' } });
  assert.ok(!fs.existsSync(path.join(f.dir, 'scan_result.json')), 'the stale result is left to rebuild');
  assert.ok(!fs.existsSync(path.join(f.dir, 'report.html')));
  assert.ok(!fs.existsSync(path.join(f.dir, 'ports')), 'port crops named by the old numbers are gone');
  assert.ok(fs.existsSync(path.join(f.dir, 'images', 'new.png')));
  assert.ok(!fs.existsSync(path.join(f.dir, 'images', 'old.png')));
  assert.ok(fs.existsSync(path.join(f.dir, 'original_image.jpg')), 'the photograph is never touched');
  assert.deepEqual(out.renumbered.sort(), ['U12 -> U18', 'U13 -> U20']);

  const meta = JSON.parse(fs.readFileSync(path.join(f.dir, 'scan_meta.json')));
  assert.equal(meta.reanalyses.length, 1, 'the rack says it was read again');
  assert.equal(meta.rackId, 'RK-TEST0001', 'and keeps everything it already said');
});

test('the whole folder is kept, exactly as it was, before anything changes', async () => {
  const f = rackFolder();
  const out = await R.reanalyzeRack({ rackId: 'RK-TEST0001', ...f,
    runPipeline: pipelineWriting(NEW), stamp: 't2' });
  const b = out.backup;
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(b, 'device_unit_map.json'))), OLD);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(b, 'device_overrides.json'))), { U12: { make: 'Dlink' } });
  assert.ok(fs.existsSync(path.join(b, 'scan_result.json')));
  assert.ok(!fs.existsSync(`${b}.work`), 'and the working folder is cleaned up');
});

test('a pipeline that fails leaves the rack exactly as it was', async () => {
  const f = rackFolder();
  await assert.rejects(R.reanalyzeRack({ rackId: 'RK-TEST0001', ...f,
    runPipeline: async () => { throw new Error('worker crashed'); }, stamp: 't3' }), /worker crashed/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.dir, 'device_unit_map.json'))), OLD);
  assert.ok(fs.existsSync(path.join(f.dir, 'scan_result.json')));
});

test('a pipeline that produces nothing leaves the rack exactly as it was', async () => {
  const f = rackFolder();
  await assert.rejects(R.reanalyzeRack({ rackId: 'RK-TEST0001', ...f,
    runPipeline: async () => {}, stamp: 't4' }), /left as it was/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.dir, 'device_unit_map.json'))), OLD);
});

test('a rack with no stored photograph says so', async () => {
  const f = rackFolder();
  fs.rmSync(path.join(f.dir, 'original_image.jpg'));
  await assert.rejects(R.reanalyzeRack({ rackId: 'RK-TEST0001', ...f,
    runPipeline: pipelineWriting(NEW) }), /photograph of this rack is not kept/);
});

test('the same rack is not read twice at once', async () => {
  const f = rackFolder();
  let release;
  const slow = (image, out) => new Promise((resolve) => { release = () => pipelineWriting(NEW)(image, out).then(resolve); });
  const first = R.reanalyzeRack({ rackId: 'RK-TEST0001', ...f, runPipeline: slow, stamp: 't5' });
  await new Promise((r) => setImmediate(r));
  await assert.rejects(R.reanalyzeRack({ rackId: 'RK-TEST0001', ...f,
    runPipeline: pipelineWriting(NEW), stamp: 't6' }), /already being read again/);
  release();
  await first;
});
