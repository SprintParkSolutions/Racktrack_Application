/**
 * The tables, and the JSON plans coming into them.
 *
 * Everything here runs against a throwaway database (RACKTRACK_APPROVALS_DB),
 * never the real auth.db, so nothing this file does can reach a person's data.
 *
 * What it pins:
 *   - the tables exist and a plan round trips with its JSON columns intact
 *   - every write to a plan bumps its version
 *   - approval_events is append only, held by a trigger, not by a promise
 *   - the migration imports a real plan file, twice safely, and carries the
 *     grouping through: an interface keeps parentUid, following and
 *     decidable exactly as the file had them, and a field the format never
 *     knew about is not dropped
 *   - one unreadable file does not stop the rest
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, describe, it } = require('node:test');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-approvals-store-'));
process.env.RACKTRACK_APPROVALS_DB = path.join(tmp, 'approvals.db');

const store = require('../../lib/approvals/store');
const shape = require('../../lib/approvals/shape');
const service = require('../../lib/approvals/service');
const migrate = require('../../lib/approvals/migrate');

after(() => { store._reset(); fs.rmSync(tmp, { recursive: true, force: true }); });

/**
 * The plan files this run imports.
 *
 * test/fixtures/netbox-plans/37.json is a real file, written by the plan
 * module as it stood before plans moved into SQLite - 191 items, 170 of them
 * interfaces following 9 devices, which is the grouping that turns 191
 * questions into 9. On a machine that has real plans on disk
 * (server/data/netbox/plans, the demo server) those are imported beside it, so
 * the test covers that server's own data and not only the fixture.
 */
const FIXTURES = path.join(__dirname, '..', 'fixtures', 'netbox-plans');
const LIVE = path.join(__dirname, '..', '..', 'data', 'netbox', 'plans');

let dir;
let live = [];
before(() => {
  dir = path.join(tmp, 'plans');
  fs.mkdirSync(dir, { recursive: true });
  for (const name of fs.readdirSync(FIXTURES)) {
    fs.copyFileSync(path.join(FIXTURES, name), path.join(dir, name));
  }
  try {
    live = fs.readdirSync(LIVE).filter((n) => /^\d+\.json$/.test(n) && n !== '37.json');
    for (const name of live) fs.copyFileSync(path.join(LIVE, name), path.join(dir, name));
  } catch { live = []; }
});

describe('the tables hold a plan and everything on it', () => {
  it('creates them lazily and round trips the JSON columns', () => {
    for (const table of store.TABLES) {
      assert.ok(store.db().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get(),
        `${table} exists`);
    }
    const plan = store.insertPlan({
      orgId: 3, tenantId: 7, scanId: 412, rackId: 'RK-STORE1', rackName: 'RACK-01',
      status: 'draft', fingerprint: 'abc', counts: { create: 2 }, warnings: ['one'],
      orphans: [{ uid: 'x' }], createdBy: 'ravi', createdAt: store.nowIso(),
    }, [{ uid: 'dev:1', type: 'Device', name: 'SW', action: 'create', decidable: true,
          diff: { position: { from: 1, to: 2 } }, extra: { binding: { via: 'lldp' } } }]);

    const read = store.getPlan(plan.id);
    assert.deepEqual(read.counts, { create: 2 }, 'an object column comes back an object');
    assert.deepEqual(read.warnings, ['one']);
    assert.deepEqual(read.orphans, [{ uid: 'x' }]);
    const item = store.getItem(plan.id, 'dev:1');
    assert.deepEqual(item.diff, { position: { from: 1, to: 2 } });
    assert.equal(item.decidable, true, 'a 0/1 column comes back true or false');
    assert.deepEqual(item.binding, { via: 'lldp' },
      'a field the table has no column for is kept and handed back');
  });

  it('keeps who a check is with, why it waits for an admin, and its incident', () => {
    const cols = (table) => store.db().prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    for (const col of ['spoc_user_id', 'spoc', 'needs_admin', 'incident', 'written_by_id', 'findings',
      'evidence', 'suggestion_state']) {
      assert.ok(cols('approval_plans').includes(col), `approval_plans.${col}`);
    }
    assert.ok(cols('approval_notifications').includes('data'));
    assert.ok(store.db().prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?")
      .get('idx_approval_plans_spoc'));

    const plan = store.insertPlan({ orgId: 3, tenantId: 7, status: 'assigned', createdBy: 'ravi',
      createdAt: store.nowIso() }, []);
    const fresh = store.getPlan(plan.id);
    assert.deepEqual([fresh.spocUserId, fresh.spoc, fresh.needsAdmin, fresh.incident], [null, null, null, null],
      'a check from before the SPOC change has no holder');
    assert.deepEqual([fresh.findings, fresh.evidence, fresh.suggestionState], [[], null, {}]);

    const holder = { userId: 41, username: 'dc007.spoc', email: 'spoc@dc007.example', source: 'site', previous: [] };
    store.updatePlan(plan.id, { spocUserId: 41, spoc: holder, needsAdmin: { why: 'no_spoc', text: 'x', at: 'now' },
      incident: { system: 'none' }, findings: [{ rule: 'wrong_shelf' }], evidence: { seen: 1 } });
    const held = store.getPlan(plan.id);
    assert.equal(held.spocUserId, 41);
    assert.deepEqual(held.spoc, holder);
    assert.deepEqual(held.needsAdmin, { why: 'no_spoc', text: 'x', at: 'now' });
    assert.deepEqual(held.incident, { system: 'none' });
    assert.deepEqual(held.findings, [{ rule: 'wrong_shelf' }]);
    const light = store.getPlan(plan.id, { heavy: false });
    assert.deepEqual([light.findings, light.evidence], [[], null], 'the heavy columns stay home on a light read');
    assert.equal(light.spocUserId, 41, 'and the holder does not');

    // The list filter, and what a technician may see.
    assert.deepEqual(store.listPlans({ spocUserId: 41 }).map((p) => p.id), [plan.id]);
    assert.deepEqual(store.listPlans({ spocUserId: 42 }).map((p) => p.id), []);
    const visibleTo = (userId) => store.listPlans({ ids: [plan.id],
      visibleTo: { role: 'member', username: 'nobody', userId, tenantId: 99 } }).length;
    assert.equal(visibleTo(41), 1, 'a member who holds the check is shown it');
    assert.equal(visibleTo(42), 0);

    // A notification carries what it is about, as fields.
    const row = store.addNotification({ event: 'assigned', planId: plan.id, recipientUserId: 41,
      channel: 'inapp', subject: 's', body: 'b', dedupeKey: `store-test|${plan.id}`,
      data: { planId: plan.id, kind: 'assigned', incidentNumber: null } });
    assert.deepEqual(row.data, { planId: plan.id, kind: 'assigned', incidentNumber: null });
    assert.deepEqual(store.notificationsFor(41)[0].data.kind, 'assigned');
  });

  it('leaves a ticket that only mirrors its check\'s incident out of the ServiceNow poll', () => {
    const plan = store.insertPlan({ orgId: 3, status: 'assigned', createdAt: store.nowIso() },
      [{ uid: 'dev:a', action: 'create', decidable: true }, { uid: 'dev:b', action: 'create', decidable: true }]);
    store.putTicket(plan.id, 'dev:a', { assignee: 'sam', status: 'open',
      external: { system: 'servicenow', sysId: 'own-1', number: 'INC1' } });
    store.putTicket(plan.id, 'dev:b', { assignee: 'sam', status: 'open',
      external: { system: 'servicenow', sysId: 'check-1', number: 'INC2', planLevel: true } });
    const waiting = store.ticketsWaitingOnServiceNow().filter((t) => t.planId === plan.id);
    assert.deepEqual(waiting.map((t) => t.itemUid), ['dev:a']);
  });

  it('bumps the version on every write, and only on a write', () => {
    const plan = store.insertPlan({ orgId: 3, status: 'draft', createdAt: store.nowIso(),
      createdBy: 'ravi' }, [{ uid: 'dev:2', action: 'create', decidable: true }]);
    const start = store.getPlan(plan.id).version;
    store.updatePlan(plan.id, { priority: 'P1' });
    assert.equal(store.getPlan(plan.id).version, start + 1);
    store.updateItem(plan.id, 'dev:2', { decision: 'approved' });
    assert.equal(store.getPlan(plan.id).version, start + 2, 'an item change is a change to the plan');
    store.getPlan(plan.id);
    assert.equal(store.getPlan(plan.id).version, start + 2, 'reading changes nothing');
  });

  it('will not let anything rewrite or erase the history', () => {
    const plan = store.insertPlan({ orgId: 3, status: 'draft', createdAt: store.nowIso() }, []);
    const id = store.addEvent(plan.id, { action: 'create', actorName: 'ravi', toStatus: 'draft' });
    assert.throws(() => store.db().prepare('UPDATE approval_events SET action = ? WHERE id = ?')
      .run('something else', id), /append only/);
    assert.throws(() => store.db().prepare('DELETE FROM approval_events WHERE id = ?').run(id),
      /append only/);
    // The one way out is the whole plan going, which is how an organisation
    // is removed. The rows go with it rather than outliving it.
    store.db().prepare('DELETE FROM approval_plans WHERE id = ?').run(plan.id);
    assert.equal(store.eventsOf(plan.id).length, 0);
  });

  it('takes an organisation out whole', () => {
    const plan = store.insertPlan({ orgId: 4242, status: 'draft', createdAt: store.nowIso() },
      [{ uid: 'dev:9', action: 'create', decidable: true }]);
    store.putTicket(plan.id, 'dev:9', { assignee: 'sam', status: 'open' });
    store.setSetting(4242, 'dual_approval_risks', ['high']);
    const gone = store.purgeOrg(4242);
    assert.equal(gone.plans, 1);
    assert.equal(store.getPlan(plan.id), null);
    assert.equal(store.itemsOf(plan.id).length, 0, 'its items went with it');
    assert.equal(store.getSetting(4242, 'dual_approval_risks'), undefined);
  });
});

describe('the change registry only ever grows', () => {
  const row = (planId, over = {}) => ({ orgId: 4343, tenantId: 9, planId, attempt: 1, rackId: 'RK-REG1',
    rackName: 'RACK-REG', itemUid: 'dev:reg:u20', objectType: 'Device', objectName: 'SW-20', netboxId: 199,
    netboxUrl: 'http://netbox.test/dcim/devices/199/', action: 'update', field: 'position', before: 22,
    after: 20, result: 'written', approvedBy: 'spoc', approvedById: 41, approvedAt: store.nowIso(),
    writtenBy: 'system', writtenAt: store.nowIso(), incidentNumber: 'INC0010042', ...over });

  it('round trips a row, with before and after as the values they were', () => {
    const plan = store.insertPlan({ orgId: 4343, tenantId: 9, status: 'written', createdAt: store.nowIso(),
      incident: { system: 'servicenow', number: 'INC0010042', url: 'https://sn.test/INC0010042' } }, []);
    store.addChange(row(plan.id));
    store.addChange(row(plan.id, { field: 'racktrack_uid', before: null, after: 'dev:reg:u20', internal: true }));
    store.addChange(row(plan.id, { itemUid: 'dev:reg:u21', action: 'create', field: '*', before: null,
      after: { name: 'SW-21', position: 21 }, netboxId: 200 }));
    const all = store.changesOf(plan.id);
    assert.equal(all.length, 3, 'changesOf keeps the link fields in');
    assert.equal(all[0].before, 22);
    assert.equal(all[0].after, 20);
    assert.deepEqual(all[2].after, { name: 'SW-21', position: 21 });

    const listed = store.listChanges({ seenBy: { orgId: 4343, userId: 1, username: 'x' } });
    assert.deepEqual(listed.map((c) => c.field), ['*', 'position'], 'newest first, link fields hidden');
    assert.equal(listed[0].incidentUrl, 'https://sn.test/INC0010042', 'the link is read off the plan');
    assert.equal(store.listChanges({ seenBy: { orgId: 4343 }, internal: 1 }).length, 3);
    assert.equal(store.listChanges({ seenBy: { orgId: 9999 } }).length, 0, 'another organization sees none');
    assert.deepEqual(store.listChanges({ seenBy: { orgId: 4343 }, field: 'position' }).map((c) => c.after), [20]);
    assert.deepEqual(store.listChanges({ seenBy: { orgId: 4343 }, q: 'SW-21' }).map((c) => c.netboxId), [200]);
    assert.equal(store.listChanges({ seenBy: { orgId: 4343 }, tenantIds: [8], planIds: [] }).length, 0);
    assert.equal(store.listChanges({ seenBy: { orgId: 4343 }, tenantIds: [8], planIds: [plan.id] }).length, 2);
    const page = store.listChanges({ seenBy: { orgId: 4343 }, limit: 1 });
    assert.equal(page.length, 1);
    assert.deepEqual(store.listChanges({ seenBy: { orgId: 4343 }, cursor: page[0].id }).map((c) => c.field),
      ['position']);
  });

  it('finds the checks a person holds or held', () => {
    const mine = store.insertPlan({ orgId: 4343, status: 'assigned', createdAt: store.nowIso(), spocUserId: 41,
      spoc: { userId: 41, username: 'now', previous: [{ userId: 40, username: 'before' }] } }, []);
    store.insertPlan({ orgId: 4343, status: 'assigned', createdAt: store.nowIso(), spocUserId: 42 }, []);
    assert.deepEqual(store.plansHeldBy(41, { orgId: 4343 }), [mine.id]);
    assert.deepEqual(store.plansHeldBy(40, { orgId: 4343 }), [mine.id], 'the one it was taken from still reads it');
    assert.deepEqual(store.plansHeldBy(41, { orgId: 9999 }), [], 'inside their own organization only');
    assert.deepEqual(store.plansHeldBy(null), []);
  });

  it('will not let a row be rewritten or erased while its check exists', () => {
    const plan = store.insertPlan({ orgId: 4343, status: 'written', createdAt: store.nowIso() }, []);
    const id = store.addChange(row(plan.id));
    assert.throws(() => store.db().prepare('UPDATE approval_changes SET after = ? WHERE id = ?').run('19', id),
      /append only/);
    assert.throws(() => store.db().prepare('DELETE FROM approval_changes WHERE id = ?').run(id),
      /append only/);
  });

  it('goes when its organization goes, after the plans and not before', () => {
    const other = store.insertPlan({ orgId: 4344, status: 'written', createdAt: store.nowIso() }, []);
    store.addChange(row(other.id, { orgId: 4344 }));
    assert.ok(store.listChanges({ seenBy: { orgId: 4343 } }).length > 0);
    store.purgeOrg(4343);
    assert.equal(store.db().prepare('SELECT COUNT(*) AS n FROM approval_changes WHERE org_id = 4343').get().n, 0);
    assert.equal(store.changesOf(other.id).length, 1, 'another organization keeps its own');
    store.purgeOrg(4344);
  });
});

describe('the five SLA words mean the same thing in SQL and in code', () => {
  /**
   * The list filter and the dashboard counts have to do this in one query, so
   * the rule exists twice: once as SQL in store.planWhere, once as JavaScript
   * in sla.js. This is the test that keeps them saying the same thing - a tile
   * that counts five and a list that shows three is worse than either.
   */
  const sla = require('../../lib/approvals/sla');
  const clock = (over) => ({ clock: 'resolution', startedAt: store.nowIso(),
    targetAt: store.nowIso(), status: 'running', ...over });

  const CASES = {
    breached: [{ status: 'breached', breachedAt: store.nowIso() }],
    at_risk: [{ status: 'running', warnedAt: store.nowIso() }],
    paused: [{ status: 'paused', pausedSince: store.nowIso() }],
    on_track: [{ status: 'running' }],
    none: [{ status: 'met', metAt: store.nowIso() }],
  };

  it('agrees on every one of them, and puts each plan in exactly one', () => {
    const made = {};
    for (const [word, rows] of Object.entries(CASES)) {
      const plan = store.insertPlan({ orgId: 55, status: 'triage', createdAt: store.nowIso(),
        createdBy: 'ravi', rackId: `RK-SLA-${word}` }, []);
      made[word] = plan.id;
      for (const row of rows) {
        const written = store.addSla(plan.id, clock(row));
        store.updateSla(written.id, row);
      }
      assert.equal(sla.planStateOf(plan.id), word, `sla.js calls it ${word}`);
      assert.equal(store.slaStateOf(store.slaOf(plan.id)), word, `and so does the store's own copy`);
    }
    for (const word of Object.keys(CASES)) {
      const found = store.listPlans({ orgId: 55, sla: word, limit: 50 }).map((p) => p.id);
      assert.deepEqual(found, [made[word]], `the ${word} filter finds the ${word} plan and no other`);
    }
    // And the counts add up to the plans, because a plan is in exactly one.
    const counts = store.countPlansBySlaState({ orgId: 55 });
    assert.deepEqual(counts.map((r) => r.key).sort(), Object.keys(CASES).sort());
    assert.equal(counts.reduce((n, r) => n + r.count, 0), Object.keys(CASES).length);
    store.purgeOrg(55);
  });

  it('shows the worst clock when a plan has several', () => {
    const plan = store.insertPlan({ orgId: 56, status: 'triage', createdAt: store.nowIso(),
      createdBy: 'ravi' }, []);
    const a = store.addSla(plan.id, clock({ clock: 'acceptance' }));
    store.addSla(plan.id, clock({ clock: 'resolution', status: 'paused' }));
    assert.equal(sla.planStateOf(plan.id), 'paused', 'on hold beats on track');
    store.updateSla(a.id, { warnedAt: store.nowIso() });
    assert.equal(sla.planStateOf(plan.id), 'at_risk', 'close to the target beats on hold');
    assert.deepEqual(store.listPlans({ orgId: 56, sla: 'at_risk', limit: 5 }).map((p) => p.id), [plan.id]);
    assert.deepEqual(store.listPlans({ orgId: 56, sla: 'paused', limit: 5 }), [],
      'and it is in one list, not two');
    store.purgeOrg(56);
  });
});

describe('the JSON plans come into the tables', () => {
  let out;
  let planId;
  const KEY = 't7:5';
  const DEV = `dev:${KEY}:u01`;

  it('imports every file, and says how many', () => {
    out = migrate.run({ dir });
    assert.equal(out.failed, 0, JSON.stringify(out.unreadable || []));
    assert.equal(out.imported, 1 + live.length, `imported ${out.imported} of ${out.files}`);
    const plan = store.getPlanByLegacyId(37);
    assert.ok(plan, 'the file kept its number');
    planId = plan.id;
    assert.equal(plan.rackId, 'RK-E909532A');
    assert.equal(plan.createdBy, 'ravi.kumar');
    assert.equal(plan.submittedNote, 'Two of the core switches look wrong to me');
    assert.equal(plan.fingerprint, JSON.parse(
      fs.readFileSync(path.join(dir, '37.json'), 'utf8')).fingerprint,
    'the signature on the list of changes is carried across, not recomputed');
  });

  it('keeps the grouping: 191 rows, 9 questions, 170 ports that follow', () => {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, '37.json'), 'utf8'));
    const rows = store.itemsOf(planId);
    assert.equal(rows.length, raw.items.length, 'every row came across');
    assert.equal(rows.length, 191);

    const before = Object.fromEntries(raw.items.map((i) => [i.uid, i]));
    for (const row of rows) {
      const was = before[row.uid];
      assert.ok(was, `${row.uid} was in the file`);
      assert.equal(row.parentUid, was.parentUid ?? null, `${row.uid}: parentUid`);
      assert.equal(row.following, Boolean(was.following), `${row.uid}: following`);
      assert.equal(row.decidable, Boolean(was.decidable), `${row.uid}: decidable`);
      assert.equal(row.type, was.type);
      assert.equal(row.name, was.name);
      assert.equal(row.action, was.action);
      assert.equal(row.netboxId, was.netboxId ?? null);
      assert.deepEqual(row.diff, was.diff ?? null);
      assert.equal(row.decidedBy, was.decidedBy ?? null);
      assert.equal(row.note, was.note ?? null);
    }
    const ports = rows.filter((i) => i.type === 'Interface');
    assert.equal(ports.length, 170);
    assert.ok(ports.every((i) => i.following === true && i.decidable === false && i.parentUid),
      'every port still follows its device and is not a question of its own');
    assert.equal(rows.filter((i) => i.decidable).length, 9,
      '191 rows, and nine things to decide: one per device');
    assert.equal(shape.summarise(rows).decidable, 9);
    assert.equal(shape.summarise(rows).following, 170);
  });

  it('does not drop a field the file format never knew about', () => {
    const port = store.getItem(planId, `if:${DEV}:1`);
    assert.deepEqual(port.binding, { via: 'lldp', neighbour: 'core-a' });
    assert.equal(store.getItem(planId, `rack:${KEY}`).fromUid, 'rack:RK-E909532A');
  });

  it('reads back the same way the screens read it', () => {
    // What GET /api/approvals/plans/:id answers.
    const full = service.get(planId, service.trustedActor('ravi.kumar'));
    const ports = full.items.filter((i) => i.type === 'Interface');
    assert.equal(ports.length, 170);
    assert.ok(ports.every((i) => i.following && !i.decidable && i.parentUid));
    assert.equal(full.plan.summary.decidable, 9);
    assert.equal(full.plan.summary.following, 170);
    assert.equal(full.plan.summary.ticketed, 1, 'the open ticket came across');
    assert.equal(full.plan.summary.openTickets, 1);
    assert.equal(full.plan.summary.resolved, 1, 'and so did the one that came back');
    assert.deepEqual(full.items.find((i) => i.uid === `if:${DEV}:1`).binding,
      { via: 'lldp', neighbour: 'core-a' });

    // What GET /api/nb/plans/:id answers: the same plan in the shape the
    // phone app has always read.
    const legacy = shape.legacyPlan(full);
    const legacyPorts = legacy.items.filter((i) => i.type === 'Interface');
    assert.equal(legacyPorts.length, 170);
    assert.ok(legacyPorts.every((i) => i.following === true && i.decidable === false));
    assert.equal(legacy.items.find((i) => i.uid === `if:${DEV}:1`).parentUid, DEV);
    assert.equal(legacy.status, 'submitted', 'the word the app knows');
    const dev = legacy.items.find((i) => i.uid === DEV);
    assert.equal(dev.ticket.finding, 'Yes, a C9300-48P. NetBox was wrong.');
    assert.equal(dev.decision, 'pending', 'a resolved ticket is not an approval');
    const still = legacy.items.find((i) => i.uid === `dev:${KEY}:u03`);
    assert.equal(still.ticket.external.number, 'INC0019482');
    assert.equal(still.ticket.status, 'open');
    assert.equal(legacy.items.find((i) => i.uid === `if:${DEV}:1`).ticket.sharedWith, DEV,
      'a port still points at its device ticket');
  });

  it('is safe to run again: nothing is imported twice', () => {
    const before = store.listPlans({ limit: 500 }).length;
    const second = migrate.run({ dir });
    assert.equal(second.imported, 0);
    assert.equal(second.skipped, 1 + live.length);
    assert.equal(store.listPlans({ limit: 500 }).length, before, 'and no duplicate rows');
  });

  it('steps over a file it cannot read, and says which one', () => {
    fs.writeFileSync(path.join(dir, '9001.json'), '{ "id": 9001, "items": [');   // half written
    fs.writeFileSync(path.join(dir, '9002.json'), JSON.stringify({
      id: 9002, status: 'open', createdAt: '2026-09-18T10:00:00Z', createdBy: 'ravi',
      orgId: 3, tenantId: 7, rackId: 'RK-LATER', fingerprint: 'zz', items: [], events: [],
    }));
    const third = migrate.run({ dir });
    assert.equal(third.failed, 1, 'one bad file');
    assert.equal(third.unreadable[0].file, '9001.json', 'named, so somebody can go and look');
    assert.equal(third.imported, 1, 'and the good file after it still came in');
    assert.ok(store.getPlanByLegacyId(9002), 'the plan written after the broken one is in');
  });

  it('puts each old status where the plan would be standing today', () => {
    const at = (status, tickets = []) => migrate.statusOf({ status }, tickets);
    assert.equal(at('open'), 'draft');
    assert.equal(at('submitted'), 'triage', 'nobody assigned yet');
    assert.equal(at('submitted', [{ status: 'open' }]), 'assigned');
    assert.equal(at('submitted', [{ status: 'in_progress' }, { status: 'open' }]), 'assigned',
      'the plan shows the least advanced ticket still open');
    assert.equal(at('submitted', [{ status: 'resolved' }]), 'verification_pending',
      'every ticket back means it waits for the verification scan');
    assert.equal(at('applied'), 'completed');
    assert.equal(at('write_failed'), 'write_failed');
    // And the round trip: the word the app reads is the word it always read.
    assert.equal(shape.legacyStatus(at('open')), 'open');
    assert.equal(shape.legacyStatus(at('submitted')), 'submitted');
    assert.equal(shape.legacyStatus(at('applied')), 'applied');
    assert.equal(shape.legacyStatus(at('write_failed')), 'write_failed');
  });
});
