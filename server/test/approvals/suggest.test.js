/**
 * The suggestion rules, and above all the ways each one says no.
 *
 * A suggestion that fails to fire costs a person a minute: they read the item
 * and decide it themselves. A suggestion that fires when it should not moves a
 * customer's record to the wrong shelf on the word of a camera. So every rule
 * here has its one firing case and then each thing that must stop it, and the
 * owner's own example - a record named for U20, held on U22, photographed on
 * U20 - is pinned sentence by sentence.
 *
 * Nothing here opens a database: the function takes what a check has
 * persisted, as plain objects, and that is what it is given.
 */
process.env.NODE_ENV = 'test';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const {
  suggest, classOf, acceptanceOf, shelfInName, PASSIVE, NOTE_NO_EVIDENCE, _internal,
} = require('../../lib/approvals/suggest');

// -- What a check holds, built small --------------------------------------
const PLAN = { id: 140, orgId: 1, tenantId: 32, rackId: 'rack-26', fingerprint: 'f-140', status: 'assigned' };

const createItem = (uid, name, extra = {}) => ({
  uid, type: 'Device', name, action: 'create', netboxId: null, diff: null,
  decidable: true, following: false, supporting: false, decision: 'pending', ...extra,
});
const updateItem = (uid, name, diff, extra = {}) => ({
  uid, type: 'Device', name, action: 'update', netboxId: 310, diff,
  decidable: true, following: false, supporting: false, decision: 'pending', ...extra,
});
const box = (uid, position, cvClass = 'Switch', extra = {}) => ({
  uid, name: `${cvClass} U${position}`, position, cvClass, passive: false, portCount: 24,
  model: 'Unidentified Switch (24-port, 1U)', modelIsOcr: false, make: 'Unknown', serial: null,
  span: 1, evidence: 'cv_only', ...extra,
});
const role = (name) => ({ id: 5, name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') });
const orphan = (netboxId, name, position, roleName = 'Switch', extra = {}) => ({
  netboxId, name, uid: null, ours: false, seen: false, position, serial: null, status: 'active',
  role: role(roleName), deviceType: { model: null, manufacturer: null, uHeight: 1 }, assetTag: null, face: 'front',
  whose: 'the customer wrote this record and RackTrack has never touched it', recommendation: 'Review.',
  ...extra,
});
const record = (o) => ({
  netboxId: o.netboxId, name: o.name, position: o.position, uHeight: o.deviceType.uHeight, face: o.face,
  status: o.status, role: o.role, deviceType: o.deviceType, serial: o.serial, assetTag: o.assetTag,
  uid: o.uid, bound: false,
});

/** The owner's example: SP-R1-U20-ACT is held on U22, and the photo shows a network box on U20. */
function demo() {
  const moved = orphan(199, 'SP-R1-U20-ACT', 22);
  return {
    plan: PLAN,
    items: [createItem('dev:SPHYB:u20', 'Switch U20')],
    orphans: [moved],
    findings: [],
    evidence: { records: [record(moved)], boxes: [box('dev:SPHYB:u20', 20)] },
  };
}
const rulesOf = (r) => r.suggestions.map((s) => s.rule);
const only = (r, rule) => {
  const hits = r.suggestions.filter((s) => s.rule === rule);
  assert.equal(hits.length, 1, `expected one ${rule}, got ${JSON.stringify(rulesOf(r))}`);
  return hits[0];
};

/** Nothing a person reads may carry a long dash, a number dressed as confidence, or an internal name. */
function readsPlainly(r) {
  for (const s of r.suggestions) {
    for (const line of [s.title, ...s.evidence, s.acceptLabel || '']) {
      assert.doesNotMatch(line, /[\u2013\u2014]/, `long dash in: ${line}`);
      assert.doesNotMatch(line, /%|\bdev:|\bnb:device:|racktrack_uid|recordId|\bRK-/, `internal or numeric in: ${line}`);
    }
    assert.ok([null, 'confirmed', 'likely', 'no action'].includes(s.word), `word was ${s.word}`);
  }
}

describe('a check filed before suggestions existed', () => {
  it('returns no suggestions and the one note', () => {
    const input = demo();
    assert.deepEqual(suggest({ ...input, evidence: null }), { suggestions: [], note: NOTE_NO_EVIDENCE });
    assert.deepEqual(suggest({ ...input, evidence: undefined }), { suggestions: [], note: NOTE_NO_EVIDENCE });
    assert.equal(NOTE_NO_EVIDENCE,
      'This check was filed before suggestions existed. Compare the rack again to get them.');
  });

  it('says nothing, and no note, about a check that simply has nothing to suggest', () => {
    assert.deepEqual(suggest({ plan: PLAN, items: [], orphans: [], findings: [], evidence: { records: [], boxes: [] } }),
      { suggestions: [], note: null });
  });
});

describe('the class families', () => {
  it('reads a role by its name or its slug, whole, and a camera class the same way', () => {
    assert.equal(classOf('Switch'), 'network');
    assert.equal(classOf({ name: 'Access Switch', slug: 'access-switch' }), 'network');
    assert.equal(classOf({ name: 'Our ToR', slug: 'tor-switch' }), 'network');
    assert.equal(classOf('Firewall'), 'firewall');
    assert.equal(classOf('Rack Server'), 'server');
    assert.equal(classOf('storage_system'), 'storage');
    assert.equal(classOf('Patch Panel'), 'patch_panel');
    assert.equal(classOf('PDU'), 'pdu');
    assert.equal(classOf('UPS'), 'ups');
    assert.equal(classOf('Cable Manager'), 'cable_manager');
    assert.equal(classOf('Empty'), 'blank');
  });

  it('puts the camera\'s Router and Switch in one family, because a Router is a Switch with few ports', () => {
    assert.equal(classOf('Router'), classOf('Switch'));
  });

  it('never finds a family by a word inside a free-text role', () => {
    for (const name of ['KVM Switch', 'Automatic Transfer Switch', 'Console Server', 'Load Balancer', 'Production', '', null, undefined, {}]) {
      assert.equal(classOf(name), null, String(name));
    }
  });

  it('counts as passive exactly the families a front photograph cannot read', () => {
    assert.deepEqual([...PASSIVE].sort(), ['blank', 'cable_manager', 'patch_panel', 'pdu', 'ups']);
  });

  it('reads the shelf a record\'s own name states, and only when it states one', () => {
    assert.equal(shelfInName('SP-R1-U20-ACT'), 20);
    assert.equal(shelfInName('sw-u05'), 5);
    assert.equal(shelfInName('SW U20 / U21'), null);
    assert.equal(shelfInName('PDU12'), null);
    assert.equal(shelfInName('CORE-SW-01'), null);
    assert.equal(shelfInName('RACK-U120'), null);
  });
});

describe('wrong_shelf', () => {
  it('the demo: one suggestion, position 22 -> 20 on that record, with the five sentences exactly', () => {
    const r = suggest(demo());
    assert.equal(r.note, null);
    assert.deepEqual(rulesOf(r), ['wrong_shelf']);
    const [s] = r.suggestions;
    assert.deepEqual(s, {
      id: 'wrong_shelf|dev:SPHYB:u20|199',
      rule: 'wrong_shelf',
      word: 'likely',
      title: 'Same device, wrong shelf: move record SP-R1-U20-ACT from U22 to U20',
      evidence: [
        'The record\'s own name says U20.',
        'Same class: the record is a Switch and the photo shows a Switch.',
        'It is the only network record in this rack that the photo did not show.',
        'U20 is empty in NetBox.',
        'U22 is empty in the photo.',
      ],
      itemUid: 'dev:SPHYB:u20',
      netboxId: 199,
      recordName: 'SP-R1-U20-ACT',
      proposes: {
        kind: 'move',
        fields: { position: { from: 22, to: 20 } },
        shown: { name: 'SP-R1-U20-ACT', position: 22, serial: null },
      },
      candidates: [],
      acceptLabel: 'Move the record',
      state: 'open', stateBy: null, stateAt: null, overrideId: null,
    });
    readsPlainly(r);
  });

  it('accepting it is one move override on that record: position, and nothing else', () => {
    const [s] = suggest(demo()).suggestions;
    assert.deepEqual(acceptanceOf(s), {
      does: 'override',
      override: {
        kind: 'move', itemUid: 'dev:SPHYB:u20', netboxId: 199, recordName: 'SP-R1-U20-ACT',
        fields: { position: { from: 22, to: 20 } },
        shown: { name: 'SP-R1-U20-ACT', position: 22, serial: null },
        source: 'suggestion', suggestionId: 'wrong_shelf|dev:SPHYB:u20|199', rule: 'wrong_shelf',
      },
    });
  });

  it('a Router in the photo and a Switch in the record are one class, not a disagreement', () => {
    const input = demo();
    input.evidence.boxes[0].cvClass = 'Router';
    const s = only(suggest(input), 'wrong_shelf');
    assert.equal(s.evidence[1], 'Same class: the record is a Switch and the photo shows a Router.');
  });

  it('reads NetBox\'s "22.0" as shelf 22, and takes the shelf from the box, never from its uid', () => {
    const input = demo();
    input.orphans[0].position = '22.0';
    input.items[0].uid = 'dev:SPHYB:u31';           // a uid carried over from an earlier reading
    input.evidence.boxes[0].uid = 'dev:SPHYB:u31';
    const s = only(suggest(input), 'wrong_shelf');
    assert.deepEqual(s.proposes.fields, { position: { from: 22, to: 20 } });
  });

  it('still fires on an item that was handed out as a ticket, and on nothing already decided', () => {
    for (const [decision, fires] of [['ticketed', true], ['approved', false], ['rejected', false], ['excepted', false]]) {
      const input = demo();
      input.items[0].decision = decision;
      assert.equal(rulesOf(suggest(input)).includes('wrong_shelf'), fires, decision);
    }
  });

  it('carries what a person already said about it', () => {
    const state = { 'wrong_shelf|dev:SPHYB:u20|199': { state: 'accepted', by: 'dc007.spoc', byId: 41, at: '2026-09-21T15:10:00Z', overrideId: 7 } };
    const [s] = suggest({ ...demo(), state }).suggestions;
    assert.deepEqual([s.state, s.stateBy, s.stateAt, s.overrideId], ['accepted', 'dc007.spoc', '2026-09-21T15:10:00Z', 7]);
  });

  // Each of these is the demo with ONE thing changed, and none may propose a move.
  const NEVER = {
    'one unit off, with nothing else to go on': (i) => {
      i.orphans[0] = orphan(199, 'CORE-SW-01', 21);
      i.evidence.records = [record(i.orphans[0])];
    },
    'one unit off, even when the name agrees with the photo': (i) => {
      i.orphans[0].position = 21; i.evidence.records[0].position = 21;
    },
    'the name does not state the shelf': (i) => { i.orphans[0].name = 'CORE-SW-01'; },
    'the name states a different shelf': (i) => { i.orphans[0].name = 'SP-R1-U19-ACT'; },
    'the name states two shelves': (i) => { i.orphans[0].name = 'SP-U20-U22'; },
    'a 2U record on U21 reaches the shelf next to the box': (i) => {
      i.orphans[0] = orphan(199, 'SP-R1-U20-ACT', 22, 'Switch', { deviceType: { model: null, manufacturer: null, uHeight: 2 } });
      i.evidence.boxes[0].span = 2;   // the box covers U20 and U21
      i.orphans[0].position = 21;     // the record covers U21 and U22
    },
    'the heights are known and different': (i) => { i.evidence.boxes[0].span = 2; },
    'the record is passive': (i) => { i.orphans[0].role = role('Patch Panel'); i.evidence.boxes[0].cvClass = 'Patch Panel'; },
    'the classes differ': (i) => { i.orphans[0].role = role('Server'); },
    'the serials are both stated and differ': (i) => {
      i.orphans[0].serial = 'FOC1234A1BC'; i.evidence.boxes[0].serial = 'FOC9999Z9ZZ';
    },
    'the models are both stated and differ': (i) => {
      i.orphans[0].deviceType.model = 'Catalyst 2960-24';
      Object.assign(i.evidence.boxes[0], { model: 'DGS-1210-28', modelIsOcr: true });
    },
    'NetBox holds another record on the shelf the box was seen on': (i) => {
      i.evidence.records.push(record(orphan(240, 'SP-R1-OTHER', 20)));
    },
    'a 2U record below reaches the shelf the box was seen on': (i) => {
      i.evidence.records.push(record(orphan(240, 'SP-R1-OTHER', 19, 'Server', { deviceType: { model: null, manufacturer: null, uHeight: 2 } })));
    },
    'the photo shows a box on the record\'s shelf': (i) => { i.evidence.boxes.push(box('dev:SPHYB:u22', 22, 'Server')); },
    'a 2U box below reaches the record\'s shelf': (i) => { i.evidence.boxes.push(box('dev:SPHYB:u21', 21, 'Server', { span: 2 })); },
    'the scan did see the record': (i) => { i.orphans[0].seen = true; },
    'RackTrack wrote the record itself': (i) => { i.orphans[0].ours = true; },
    'the record is already offline': (i) => { i.orphans[0].status = 'offline'; },
    'the record is being decommissioned': (i) => { i.orphans[0].status = 'decommissioning'; },
    'the record has no shelf': (i) => { i.orphans[0].position = null; },
    'the record sits on a half shelf': (i) => { i.orphans[0].position = 22.5; },
    'the box was not placed on a shelf': (i) => { i.evidence.boxes[0].position = null; },
    'the box and the switch reading contradict each other': (i) => { i.evidence.boxes[0].evidence = 'conflict'; },
    'the item is not a create': (i) => { i.items[0].action = 'update'; i.items[0].diff = { name: { from: 'a', to: 'b' } }; },
    'the item is not a device': (i) => { i.items[0].type = 'Interface'; },
    'the item is not one a person decides': (i) => { i.items[0].decidable = false; },
    'the photo has no box for the item': (i) => { i.evidence.boxes = []; },
    'the camera class is one nobody can name': (i) => { i.evidence.boxes[0].cvClass = 'Gateway'; },
    'an earlier answer could not be applied anywhere in the check': (i) => {
      i.findings.push({ tier: 'medium', kind: 'binding-not-applied', type: 'Device', uid: 'dev:SPHYB:u09', netboxId: 12 });
    },
    'a create is being held': (i) => { i.findings.push({ tier: 'medium', kind: 'create-held', type: 'Device', uid: 'dev:SPHYB:u09' }); },
    'two records were named for one box': (i) => { i.findings.push({ tier: 'high', kind: 'two-records', type: 'Device', uid: 'dev:SPHYB:u09', netboxId: 3, named: 4 }); },
    'one record was named by two boxes': (i) => { i.findings.push({ tier: 'high', kind: 'one-record-two-boxes', type: 'Device', uid: 'dev:SPHYB:u09', netboxId: 3 }); },
    'the comparison already put a different record forward for this box': (i) => {
      i.findings.push({ tier: 'medium', kind: 'record-candidate', type: 'Device', uid: 'dev:SPHYB:u20', netboxId: 777 });
    },
  };
  for (const [name, change] of Object.entries(NEVER)) {
    it(`never when ${name}`, () => {
      const input = demo();
      change(input);
      const r = suggest(input);
      assert.ok(!rulesOf(r).includes('wrong_shelf'), JSON.stringify(rulesOf(r)));
      assert.ok(!r.suggestions.some((s) => s.proposes && s.proposes.kind === 'move'));
      readsPlainly(r);
    });
  }

  it('one unit off with no corroboration says nothing about the box at all', () => {
    const input = demo();
    input.orphans[0] = orphan(199, 'CORE-SW-01', 21);
    input.evidence.records = [record(input.orphans[0])];
    const r = suggest(input);
    assert.deepEqual(r.suggestions.filter((s) => s.itemUid), []);
    assert.ok(!rulesOf(r).includes('abstain'));
  });

  it('is not held back when the comparison put THIS record forward for the box', () => {
    const input = demo();
    input.findings.push({ tier: 'medium', kind: 'record-candidate', type: 'Device', uid: 'dev:SPHYB:u20', netboxId: 199 });
    only(suggest(input), 'wrong_shelf');
  });

  it('does not count a record a photograph could never show as a second candidate', () => {
    const input = demo();
    input.orphans.push(orphan(205, 'SP-R1-REAR-SW', 30, 'Switch', { face: 'rear' }));
    assert.deepEqual(rulesOf(suggest(input)).sort(), ['leave_as_is', 'wrong_shelf']);
  });
});

describe('abstain', () => {
  it('two records fit: no suggestion, and both are named', () => {
    const input = demo();
    const second = orphan(200, 'SP-R1-SPARE-SW', 30, 'Access Switch');
    input.orphans.push(second);
    input.evidence.records.push(record(second));
    const r = suggest(input);
    assert.ok(!rulesOf(r).includes('wrong_shelf'));
    const s = r.suggestions.find((x) => x.rule === 'abstain' && x.itemUid === 'dev:SPHYB:u20');
    assert.ok(s, JSON.stringify(rulesOf(r)));
    assert.equal(s.id, 'abstain|dev:SPHYB:u20|-');
    assert.equal(s.word, null);
    assert.equal(s.title, 'No suggestion');
    assert.deepEqual(s.evidence, ['2 records fit and nothing here can tell them apart.']);
    assert.deepEqual(s.candidates, [
      { netboxId: 199, name: 'SP-R1-U20-ACT', position: 22 },
      { netboxId: 200, name: 'SP-R1-SPARE-SW', position: 30 },
    ]);
    assert.equal(s.proposes, null);
    assert.equal(s.acceptLabel, null);
    assert.equal(acceptanceOf(s), null);
    readsPlainly(r);
  });

  it('two new boxes of the class fit one record: no suggestion, and the record is named', () => {
    const input = demo();
    input.items.push(createItem('dev:SPHYB:u35', 'Router U35'));
    input.evidence.boxes.push(box('dev:SPHYB:u35', 35, 'Router'));
    const r = suggest(input);
    assert.ok(!rulesOf(r).includes('wrong_shelf'));
    const s = r.suggestions.find((x) => x.rule === 'abstain');
    assert.equal(s.itemUid, 'dev:SPHYB:u20');
    assert.deepEqual(s.evidence, ['2 boxes in the photo fit the record SP-R1-U20-ACT and nothing here can tell them apart.']);
    assert.deepEqual(s.candidates, [{ netboxId: 199, name: 'SP-R1-U20-ACT', position: 22 }]);
    // The box on U35 fits nothing: the record's name does not say U35, so it gets no card.
    assert.ok(!r.suggestions.some((x) => x.itemUid === 'dev:SPHYB:u35'));
  });

  it('does not abstain when the move failed another test as well as the count', () => {
    const input = demo();
    input.orphans[0].name = 'CORE-SW-01';
    input.orphans.push(orphan(200, 'CORE-SW-02', 30));
    assert.ok(!suggest(input).suggestions.some((s) => s.rule === 'abstain'));
  });

  it('a role outside the map: no move, no Mark Offline, and the card says why', () => {
    const input = demo();
    input.orphans[0].role = role('Production Edge');
    const r = suggest(input);
    assert.deepEqual(rulesOf(r), ['abstain']);
    const [s] = r.suggestions;
    assert.equal(s.id, 'abstain|dev:SPHYB:u20|199');
    assert.equal(s.word, null);
    assert.deepEqual(s.evidence, ['The record\'s role "Production Edge" is not one RackTrack can compare with a photo.']);
    assert.deepEqual(s.candidates, [{ netboxId: 199, name: 'SP-R1-U20-ACT', position: 22 }]);
    assert.equal(s.proposes, null);
    readsPlainly(r);
  });

  it('a role outside the map on a record nothing points at still gets the card, on the record alone', () => {
    const lost = orphan(260, 'KVM-01', 12, 'KVM Switch');
    const r = suggest({ plan: PLAN, items: [], orphans: [lost], findings: [], evidence: { records: [record(lost)], boxes: [] } });
    assert.deepEqual(rulesOf(r), ['abstain']);
    assert.equal(r.suggestions[0].id, 'abstain|-|260');
    assert.equal(r.suggestions[0].itemUid, null);
  });

  it('says nothing about a role outside the map when no rule would have fired anyway', () => {
    const lost = orphan(260, 'KVM-01', 12, 'KVM Switch', { status: 'offline' });
    const r = suggest({ plan: PLAN, items: [], orphans: [lost], findings: [], evidence: { records: [record(lost)], boxes: [] } });
    assert.deepEqual(r.suggestions, []);
  });

  it('a record with no role at all is said in words, not as empty quotes', () => {
    const lost = orphan(261, 'UNKNOWN-01', 12, 'x', { role: null });
    const r = suggest({ plan: PLAN, items: [], orphans: [lost], findings: [], evidence: { records: [], boxes: [] } });
    assert.deepEqual(r.suggestions[0].evidence, ['The record has no role in NetBox, so RackTrack cannot compare it with a photo.']);
  });

  it('says out loud what the comparison could not tell, one card per box, never its internal sentence', () => {
    const items = [createItem('dev:SPHYB:u10', 'Switch U10'), { ...createItem('dev:SPHYB:u11', 'Switch U11'), action: 'skip', decidable: false, decision: 'not_applicable' }];
    const findings = [
      { tier: 'medium', kind: 'record-candidates', type: 'Device', uid: 'dev:SPHYB:u10',
        candidates: [{ id: 301, name: 'SW-A', uid: null }, { id: 302, name: 'SW-B', uid: null }],
        why: 'More than one record could be this device: dev:SPHYB:u10 ...' },
      { tier: 'high', kind: 'two-records', type: 'Device', uid: 'dev:SPHYB:u11', netboxId: 303, named: 304, why: 'Device carries dev:SPHYB:u11 on record 303 ...' },
      { tier: 'medium', kind: 'binding-not-applied', type: 'Device', uid: 'dev:SPHYB:u40', netboxId: 305, why: 'The answer naming record 305 ...' },
      { tier: 'medium', kind: 'record-not-asked', type: 'Device', uid: 'dev:SPHYB:u10', why: 'NetBox timed out' },
      { tier: 'medium', kind: 'bind-only', type: 'Device', uid: 'dev:SPHYB:u12', fields: [] },
    ];
    const records = [301, 302, 303, 304, 305].map((id, n) => record(orphan(id, `SW-${id}`, 30 + n)));
    const r = suggest({ plan: PLAN, items, orphans: [], findings, evidence: { records, boxes: [box('dev:SPHYB:u10', 10)] } });
    assert.deepEqual(rulesOf(r), ['abstain', 'abstain', 'abstain']);
    const [a, b, c] = r.suggestions;
    assert.equal(a.id, 'abstain|dev:SPHYB:u10|-');
    assert.deepEqual(a.evidence, [
      '2 records fit and nothing here can tell them apart.',
      'NetBox could not be asked whether it already holds this box.',
    ]);
    assert.deepEqual(a.candidates, [{ netboxId: 301, name: 'SW-A', position: 30 }, { netboxId: 302, name: 'SW-B', position: 31 }]);
    assert.equal(b.itemUid, 'dev:SPHYB:u11');
    assert.deepEqual(b.candidates.map((x) => x.netboxId), [303, 304]);
    // An answer about a box this scan does not have sits on the record, not on an item.
    assert.equal(c.id, 'abstain|-|305');
    assert.equal(c.itemUid, null);
    assert.equal(c.recordName, 'SW-305');
    for (const s of r.suggestions) assert.deepEqual([s.word, s.proposes, s.acceptLabel], [null, null, null]);
    readsPlainly(r);
  });
});

describe('fills_blank', () => {
  const blank = (diff = { serial: { from: null, to: 'FOC1234A1BC' } }, boxExtra = {}) => ({
    plan: PLAN,
    items: [updateItem('dev:SPHYB:u14', 'SP-R1-U14-SW', diff)],
    orphans: [],
    findings: [],
    evidence: { records: [], boxes: [box('dev:SPHYB:u14', 14, 'Switch', { evidence: 'snmp', serial: 'FOC1234A1BC', ...boxExtra })] },
  });

  it('the switch published a serial the record does not have: approve as it stands', () => {
    const r = suggest(blank());
    const s = only(r, 'fills_blank');
    assert.equal(s.id, 'fills_blank|dev:SPHYB:u14|310');
    assert.equal(s.word, 'confirmed');
    assert.equal(s.title, 'The switch fills a blank: approve as it stands');
    assert.deepEqual(s.evidence, [
      'The record has no serial number.',
      'The switch itself published FOC1234A1BC, and a person confirmed which box that switch is.',
    ]);
    assert.deepEqual(s.proposes, { kind: 'approve' });
    assert.deepEqual(acceptanceOf(s), { does: 'decide', decisions: [{ uid: 'dev:SPHYB:u14', decision: 'approved' }] });
    readsPlainly(r);
  });

  it('names every blank it fills', () => {
    const s = only(suggest(blank({ serial: { from: '', to: 'FOC1234A1BC' }, asset_tag: { from: null, to: 'AT-00917' } })), 'fills_blank');
    assert.deepEqual(s.evidence, [
      'The record has no serial number.',
      'The record has no asset tag.',
      'The switch itself published FOC1234A1BC and AT-00917, and a person confirmed which box that switch is.',
    ]);
  });

  const NEVER = {
    'the record already holds a value': (i) => { i.items[0].diff = { serial: { from: 'OLD123456', to: 'FOC1234A1BC' } }; },
    'one of the fields already holds a value': (i) => { i.items[0].diff = { serial: { from: null, to: 'FOC1234A1BC' }, description: { from: 'core', to: 'edge' } }; },
    'the diff touches the shelf as well': (i) => { i.items[0].diff = { serial: { from: null, to: 'FOC1234A1BC' }, position: { from: 14, to: 15 } }; },
    'the diff touches the role': (i) => { i.items[0].diff = { role: { from: null, to: 'Switch' } }; },
    'the value came from the camera alone': (i) => { i.evidence.boxes[0].evidence = 'cv_only'; },
    'the value came from a faceplate read': (i) => { i.evidence.boxes[0].evidence = 'cv_ocr'; },
    'the published value is junk': (i) => { i.items[0].diff = { serial: { from: null, to: 'To Be Filled By O.E.M.' } }; },
    'the item is a create': (i) => { i.items[0].action = 'create'; },
    'the item is already decided': (i) => { i.items[0].decision = 'approved'; },
    'the item follows another': (i) => { i.items[0].decidable = false; },
    'the photo has no box for the item': (i) => { i.evidence.boxes = []; },
    'the comparison found the box was replaced': (i) => { i.findings.push({ kind: 'replaced', uid: 'dev:SPHYB:u14' }); },
    'the comparison found another serial elsewhere': (i) => { i.findings.push({ kind: 'serial-differs', uid: 'dev:SPHYB:u14' }); },
    'the comparison held fields back': (i) => { i.findings.push({ kind: 'held-back', uid: 'dev:SPHYB:u14' }); },
  };
  for (const [name, change] of Object.entries(NEVER)) {
    it(`never when ${name}`, () => {
      const input = blank();
      change(input);
      assert.ok(!rulesOf(suggest(input)).includes('fills_blank'));
    });
  }

  it('a finding about a different box holds nothing back', () => {
    const input = blank();
    input.findings.push({ kind: 'replaced', uid: 'dev:SPHYB:u02' });
    only(suggest(input), 'fills_blank');
  });
});

describe('leave_as_is', () => {
  const unseen = (o) => ({ plan: PLAN, items: [], orphans: [o], findings: [], evidence: { records: [record(o)], boxes: [] } });

  it('a passive record the photo did not show: no action, and never Mark Offline', () => {
    for (const roleName of ['Patch Panel', 'PDU', 'UPS', 'Cable Manager', 'Blank Panel']) {
      const r = suggest(unseen(orphan(210, 'SP-R1-PP-01', 8, roleName)));
      assert.deepEqual(rulesOf(r), ['leave_as_is'], roleName);
      const [s] = r.suggestions;
      assert.equal(s.id, 'leave_as_is|-|210');
      assert.equal(s.word, 'no action');
      assert.equal(s.title, 'Leave as it is: a photograph cannot show this');
      assert.equal(s.itemUid, null);
      assert.equal(s.recordName, 'SP-R1-PP-01');
      assert.deepEqual(s.proposes, { kind: 'none' });
      assert.deepEqual(acceptanceOf(s), { does: 'state' });
      readsPlainly(r);
    }
    assert.deepEqual(suggest(unseen(orphan(210, 'SP-R1-PP-01', 8, 'Patch Panel'))).suggestions[0].evidence, [
      'A Patch Panel has no face a front photograph can read, so not seeing it says nothing about whether it is there.',
    ]);
    assert.match(suggest(unseen(orphan(211, 'SP-R1-UPS', 1, 'UPS'))).suggestions[0].evidence[0], /^A UPS has no face/);
    assert.match(suggest(unseen(orphan(212, 'SP-R1-UPS', 1, 'Uninterruptible Power Supply'))).suggestions[0].evidence[0], /^An Uninterruptible/);
  });

  it('an active record the photo could not have shown: rear, no shelf, no height', () => {
    const cases = [
      [orphan(220, 'SP-R1-SW-REAR', 22, 'Switch', { face: 'rear' }), /mounted on the rear/],
      [orphan(221, 'SP-R1-SW-REAR', 22, 'Switch', { face: { value: 'rear', label: 'Rear' } }), /mounted on the rear/],
      [orphan(222, 'SP-R1-SW-LOOSE', null, 'Switch'), /has no shelf in NetBox/],
      [orphan(223, 'SP-R1-SW-0U', 22, 'Switch', { deviceType: { model: 'x', manufacturer: 'y', uHeight: 0 } }), /takes up no shelf space/],
    ];
    for (const [o, sentence] of cases) {
      const r = suggest(unseen(o));
      assert.deepEqual(rulesOf(r), ['leave_as_is'], o.name);
      assert.match(r.suggestions[0].evidence[0], sentence);
      assert.match(r.suggestions[0].evidence[0], /says nothing about whether it is there\.$/);
      readsPlainly(r);
    }
  });

  it('never for a record the scan did see, and never for an active box on the front', () => {
    assert.deepEqual(suggest(unseen(orphan(230, 'SP-R1-PP-01', 8, 'Patch Panel', { seen: true, matchedBox: 'dev:x', matchedBy: 'a box on shelf U8' }))).suggestions, []);
    assert.ok(!rulesOf(suggest(unseen(orphan(231, 'SP-R1-SW-02', 9, 'Switch')))).includes('leave_as_is'));
  });

  it('never proposes anything that writes', () => {
    const r = suggest(unseen(orphan(210, 'SP-R1-PP-01', 8, 'Patch Panel')));
    assert.ok(r.suggestions.every((s) => !['move', 'offline'].includes(s.proposes.kind)));
  });
});

describe('mark_offline', () => {
  const gone = (o, boxes = []) => ({ plan: PLAN, items: [], orphans: [o], findings: [], evidence: { records: [record(o)], boxes } });

  it('an active switch the photo shows an empty shelf for: Mark Offline, and nothing is deleted', () => {
    const r = suggest(gone(orphan(250, 'SP-R1-U30-SW', 30, 'Access Switch')));
    const s = only(r, 'mark_offline');
    assert.deepEqual(rulesOf(r), ['mark_offline']);
    assert.equal(s.id, 'mark_offline|-|250');
    assert.equal(s.word, 'likely');
    assert.equal(s.title, 'Record not seen: mark SP-R1-U30-SW offline');
    assert.deepEqual(s.evidence, [
      'NetBox lists SP-R1-U30-SW, an Access Switch, on U30.',
      'The photo shows that shelf empty.',
      'Marking it offline keeps the record. Nothing is deleted.',
    ]);
    assert.equal(s.acceptLabel, 'Mark offline');
    assert.deepEqual(s.proposes.fields, { status: { from: 'active', to: 'offline' } });
    assert.deepEqual(acceptanceOf(s), {
      does: 'override',
      override: {
        kind: 'offline', itemUid: null, netboxId: 250, recordName: 'SP-R1-U30-SW',
        fields: { status: { from: 'active', to: 'offline' } },
        shown: { name: 'SP-R1-U30-SW', position: 30, serial: null },
        source: 'suggestion', suggestionId: 'mark_offline|-|250', rule: 'mark_offline',
      },
    });
    readsPlainly(r);
  });

  it('asks about every shelf a 2U record covers', () => {
    const tall = orphan(251, 'SP-R1-SRV-07', 30, 'Server', { deviceType: { model: 'R740', manufacturer: 'Dell', uHeight: 2 } });
    const s = only(suggest(gone(tall)), 'mark_offline');
    assert.deepEqual(s.evidence.slice(0, 2), ['NetBox lists SP-R1-SRV-07, a Server, on U30 to U31.', 'The photo shows those shelves empty.']);
    // A box on the record's SECOND shelf is a box on the record.
    assert.deepEqual(suggest(gone(tall, [box('dev:SPHYB:u31', 31, 'Server')])).suggestions, []);
    // And a 2U box that starts below the record reaches it.
    assert.deepEqual(suggest(gone(tall, [box('dev:SPHYB:u29', 29, 'Server', { span: 2 })])).suggestions, []);
  });

  it('takes the height from the rack\'s records when the orphan row has none', () => {
    const input = gone(orphan(252, 'SP-R1-SRV-08', 30, 'Server'), [box('dev:SPHYB:u31', 31, 'Server')]);
    input.orphans[0].deviceType = null;
    assert.deepEqual(rulesOf(suggest(input)), ['mark_offline']);
    input.evidence.records[0].uHeight = 2;
    assert.deepEqual(suggest(input).suggestions, []);
  });

  it('a passive record is left as it is, never marked offline', () => {
    assert.deepEqual(rulesOf(suggest(gone(orphan(253, 'SP-R1-PDU-A', 40, 'PDU')))), ['leave_as_is']);
  });

  const NEVER = {
    'the record is not active': (o) => { o.status = 'planned'; },
    'the record is already offline': (o) => { o.status = 'offline'; },
    'the scan did see the record': (o) => { o.seen = true; },
    'the record sits on a half shelf': (o) => { o.position = 30.5; },
  };
  for (const [name, change] of Object.entries(NEVER)) {
    it(`never when ${name}`, () => {
      const o = orphan(250, 'SP-R1-U30-SW', 30);
      change(o);
      assert.ok(!rulesOf(suggest(gone(o))).includes('mark_offline'));
    });
  }

  it('never when the photo shows a box on that shelf', () => {
    assert.deepEqual(suggest(gone(orphan(250, 'SP-R1-U30-SW', 30), [box('dev:SPHYB:u30', 30, 'Server')])).suggestions, []);
  });

  it('never delete, never decommission: offline is the only status it ever proposes', () => {
    const r = suggest(gone(orphan(250, 'SP-R1-U30-SW', 30)));
    assert.deepEqual(r.suggestions.map((s) => s.proposes.fields.status.to), ['offline']);
  });

  it('is not offered for the record a move is proposed for, until that move is dismissed', () => {
    assert.deepEqual(rulesOf(suggest(demo())), ['wrong_shelf']);
    const accepted = { 'wrong_shelf|dev:SPHYB:u20|199': { state: 'accepted', by: 'dc007.spoc', at: 't' } };
    assert.deepEqual(rulesOf(suggest({ ...demo(), state: accepted })), ['wrong_shelf']);
    const dismissed = { 'wrong_shelf|dev:SPHYB:u20|199': { state: 'dismissed', by: 'dc007.spoc', at: 't' } };
    const r = suggest({ ...demo(), state: dismissed });
    assert.deepEqual(rulesOf(r), ['wrong_shelf', 'mark_offline']);
    assert.equal(r.suggestions[0].state, 'dismissed');
    assert.equal(r.suggestions[1].netboxId, 199);
  });
});

describe('exception', () => {
  const LIVE = {
    id: 12, kind: 'accepted_drift', orgId: 1, tenantId: 32, rackId: 'rack-26', itemType: 'Device',
    itemName: 'SP-R1-U14-SW', attribute: 'description', justification: 'Descriptions are kept in the asset system.',
    startsAt: '2026-09-01T00:00:00Z', expiresAt: '2026-10-31T00:00:00Z', revokedAt: null,
  };
  const covered = (ex = LIVE, item = updateItem('dev:SPHYB:u14', 'SP-R1-U14-SW', { description: { from: 'core', to: 'edge' } })) => ({
    plan: PLAN, items: [item], orphans: [], findings: [], evidence: { records: [], boxes: [] }, exceptions: [ex],
  });

  it('a live exception covers the item: set it aside under that exception', () => {
    const r = suggest(covered());
    const s = only(r, 'exception');
    assert.equal(s.id, 'exception|dev:SPHYB:u14|-');
    assert.equal(s.word, 'confirmed');
    assert.equal(s.title, 'Covered by exception 12');
    assert.deepEqual(s.evidence, ['Exception 12 (accepted drift, until 31 Oct 2026): Descriptions are kept in the asset system.']);
    assert.deepEqual(s.proposes, { kind: 'except', exceptionId: 12 });
    assert.deepEqual(acceptanceOf(s), { does: 'except', exceptionId: 12 });
    readsPlainly(r);
  });

  it('an exception with no end says so, and a name ending in * covers a prefix', () => {
    const s = only(suggest(covered({ ...LIVE, kind: 'known_exception', itemName: 'SP-R1-*', expiresAt: null })), 'exception');
    assert.deepEqual(s.evidence, ['Exception 12 (known exception, with no end date): Descriptions are kept in the asset system.']);
  });

  const NEVER = {
    'it was revoked': { ...LIVE, revokedAt: '2026-09-20T00:00:00Z' },
    'it is about another organization': { ...LIVE, orgId: 2 },
    'it is about another site': { ...LIVE, tenantId: 31 },
    'it is about another rack': { ...LIVE, rackId: 'rack-27' },
    'it is about another kind of object': { ...LIVE, itemType: 'Interface' },
    'it names another device': { ...LIVE, itemName: 'SP-R1-U15-SW' },
    'it is about a field this item does not change': { ...LIVE, attribute: 'serial' },
  };
  for (const [name, ex] of Object.entries(NEVER)) {
    it(`never when ${name}`, () => {
      assert.deepEqual(suggest(covered(ex)).suggestions, []);
    });
  }

  it('an exception about one field never covers a whole new device', () => {
    assert.ok(!rulesOf(suggest(covered({ ...LIVE, itemName: null }, createItem('dev:SPHYB:u14', 'SP-R1-U14-SW')))).includes('exception'));
  });

  it('never on an item already decided', () => {
    const item = updateItem('dev:SPHYB:u14', 'SP-R1-U14-SW', { description: { from: 'core', to: 'edge' } }, { decision: 'rejected' });
    assert.deepEqual(suggest(covered(LIVE, item)).suggestions, []);
  });

  it('covers exactly what exceptions.covers() covers', () => {
    // The rule keeps its own copy because exceptions.js opens the store. Held
    // side by side here so the copy cannot drift from the original.
    const exceptions = require('../../lib/approvals/exceptions');
    const items = [
      updateItem('dev:SPHYB:u14', 'SP-R1-U14-SW', { description: { from: 'core', to: 'edge' } }),
      updateItem('dev:SPHYB:u15', 'sp-r1-u14-sw', { serial: { from: null, to: 'X' } }),
      createItem('dev:SPHYB:u16', 'SP-R1-U16-SW'),
      { ...createItem('if:dev:SPHYB:u16:1', 'Gi0/1'), type: 'Interface' },
    ];
    const list = [LIVE, ...Object.values(NEVER).filter((e) => !e.revokedAt),
      { ...LIVE, itemName: 'sp-r1-*' }, { ...LIVE, itemName: '', attribute: '' }, { ...LIVE, orgId: null, tenantId: null, rackId: null, itemType: null, itemName: null, attribute: null }];
    for (const ex of list) {
      for (const item of items) {
        assert.equal(_internal.exceptionCovers(ex, PLAN, item), exceptions.covers(ex, PLAN, item), `${JSON.stringify(ex)} on ${item.uid}`);
      }
    }
  });
});

describe('duplicate', () => {
  const holder = { userId: 41, username: 'dc007.spoc' };
  const diff = { description: { from: 'core', to: 'edge' } };
  const mine = () => ({
    plan: PLAN, items: [updateItem('dev:SPHYB:u14', 'SP-R1-U14-SW', diff)], orphans: [], findings: [],
    evidence: { records: [], boxes: [] },
  });
  const otherCheck = (extra = {}) => ({
    id: 139, status: 'assigned', fingerprint: 'f-140', spoc: holder, incident: { number: 'INC0010041' },
    items: [updateItem('dev:SPHYB:u14', 'SP-R1-U14-SW', { description: { to: 'edge', from: 'core' } })], ...extra,
  });

  it('an older open check holds exactly the same differences: close this one as its duplicate', () => {
    const r = suggest({ ...mine(), duplicates: [otherCheck({ id: 120 }), otherCheck()] });
    assert.deepEqual(rulesOf(r), ['duplicate']);
    const [s] = r.suggestions;
    assert.equal(s.id, 'duplicate|-|-');
    assert.equal(s.word, 'confirmed');
    assert.equal(s.title, 'Same as check 139, which is with dc007.spoc (incident INC0010041)');
    assert.deepEqual(s.proposes, { kind: 'duplicate', duplicateOf: 139 });
    assert.deepEqual(acceptanceOf(s), { does: 'duplicate', duplicateOf: 139 });
    readsPlainly(r);
  });

  it('takes the check in the {plan, items} shape as well', () => {
    const { items, ...plan } = otherCheck();
    assert.deepEqual(rulesOf(suggest({ ...mine(), duplicates: [{ plan, items }] })), ['duplicate']);
  });

  it('only part of the check is the same: the item is closed, not the check', () => {
    const r = suggest({ ...mine(), duplicates: [otherCheck({ fingerprint: 'f-other', spoc: null, incident: null })] });
    const s = only(r, 'duplicate');
    assert.equal(s.id, 'duplicate|dev:SPHYB:u14|-');
    assert.equal(s.title, 'Same as check 139, which is waiting for an admin');
    assert.deepEqual(acceptanceOf(s), {
      does: 'decide',
      decisions: [{ uid: 'dev:SPHYB:u14', decision: 'not_applicable', note: 'Same as check 139, which is waiting for an admin.' }],
    });
    readsPlainly(r);
  });

  const NEVER = {
    'the other check is a draft': otherCheck({ status: 'draft' }),
    'the other check is finished': otherCheck({ status: 'completed' }),
    'the other check was rejected': otherCheck({ status: 'rejected' }),
    'the other check was itself closed as a duplicate': otherCheck({ status: 'duplicate' }),
    'the other check is this check': otherCheck({ id: 140 }),
    // The newer check is the duplicate. The older one, with its incident, never closes.
    'the other check is the newer one': otherCheck({ id: 141 }),
    'the other check changes the same field to another value': otherCheck({
      fingerprint: 'f-other', items: [updateItem('dev:SPHYB:u14', 'SP-R1-U14-SW', { description: { from: 'core', to: 'spine' } })],
    }),
    'the other check rejected that change': otherCheck({
      fingerprint: 'f-other', items: [updateItem('dev:SPHYB:u14', 'SP-R1-U14-SW', diff, { decision: 'rejected' })],
    }),
  };
  for (const [name, other] of Object.entries(NEVER)) {
    it(`never when ${name}`, () => {
      assert.deepEqual(suggest({ ...mine(), duplicates: [other] }).suggestions, []);
    });
  }

  it('never on an item already decided', () => {
    const input = mine();
    input.items[0].decision = 'approved';
    assert.deepEqual(suggest({ ...input, duplicates: [otherCheck({ fingerprint: 'f-other' })] }).suggestions, []);
  });
});

describe('every suggestion', () => {
  it('has an id that stays the same from one read to the next, and no two share one', () => {
    const input = demo();
    const pdu = orphan(253, 'SP-R1-PDU-A', 40, 'PDU');
    const gone = orphan(254, 'SP-R1-FW-01', 35, 'Firewall');
    input.orphans.push(pdu, gone);
    input.evidence.records.push(record(pdu), record(gone));
    const first = suggest(input);
    const again = suggest(JSON.parse(JSON.stringify(input)));
    assert.deepEqual(first, again);
    assert.deepEqual(rulesOf(first), ['wrong_shelf', 'leave_as_is', 'mark_offline']);
    const ids = first.suggestions.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const s of first.suggestions) assert.equal(s.id, `${s.rule}|${s.itemUid || '-'}|${s.netboxId || '-'}`);
    readsPlainly(first);
  });

  it('does not change what it was given', () => {
    const input = demo();
    const before = JSON.stringify(input);
    suggest(input);
    assert.equal(JSON.stringify(input), before);
  });

  it('needs no database, no network and no clock: the module loads neither the store nor the service', () => {
    const src = require('node:fs').readFileSync(require.resolve('../../lib/approvals/suggest'), 'utf8');
    const required = [...src.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]).sort();
    assert.deepEqual(required, ['../netbox/identity', './machine', './shape']);
    assert.doesNotMatch(src, /Date\.now|new Date|fetch\(/);
  });
});
