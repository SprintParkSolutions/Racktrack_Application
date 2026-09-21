/**
 * What RackTrack would suggest about a drift check, as one pure function: no
 * database, no network, no clock, nothing to stub.
 *
 * A suggestion is a rule that held, the sentences that made it hold, and one
 * word: confirmed, likely or no action. It is never a number and never a
 * guess. The danger of a suggestion is not that it fails to fire - a person
 * still reads the item and decides - it is that it fires when it should not,
 * and a person in a hurry accepts it. So every rule here is a list of things
 * that must ALL be true, and the file is mostly the ways each one says no:
 *
 *   - the camera reads a box one shelf off often enough that a difference of
 *     one unit means nothing, so a move is never proposed across one unit
 *   - a box is as tall as its units say, so "empty" is asked of every shelf a
 *     2U box or record covers, not of the one it starts on
 *   - cv.js mints a Router from a Switch by counting ports, so the two are one
 *     family here and never a disagreement
 *   - a NetBox role is free text. It is looked up whole in a closed map, never
 *     searched for a word: a "KVM Switch" is not a switch. A role outside the
 *     map has no class, no rule that compares classes fires, and the person is
 *     told so
 *   - when two records fit, nothing is picked: the card says "No suggestion"
 *     and names them both
 *
 * The input is what the check has persisted (items, orphans, findings and
 * evidence), the organization's live exceptions, and the other open checks of
 * the rack. Only the state of a suggestion (accepted, dismissed, by whom) is
 * stored; the suggestions themselves are worked out again on every read.
 */
const identity = require('../netbox/identity');
const { OPEN } = require('./machine');
const { stable } = require('./shape');

const NOTE_NO_EVIDENCE = 'This check was filed before suggestions existed. '
  + 'Compare the rack again to get them.';

// -- The class families ---------------------------------------------------
/**
 * The closed map from what a record or the camera calls a box to its family.
 *
 * Keys are whole names in comparable form (lower case, anything that is not a
 * letter or a digit read as a space), so a role's name and its slug land on
 * the same key. There is no partial match on purpose.
 */
const FAMILIES = {
  network: [
    'switch', 'network switch', 'ethernet switch', 'access switch', 'core switch',
    'distribution switch', 'aggregation switch', 'edge switch', 'leaf switch', 'spine switch',
    'leaf', 'spine', 'tor switch', 'top of rack switch', 'management switch', 'l2 switch',
    'l3 switch', 'layer 2 switch', 'layer 3 switch', 'router', 'network router', 'core router',
    'edge router', 'wan router', 'access router', 'branch router',
  ],
  firewall: ['firewall', 'network firewall', 'perimeter firewall', 'edge firewall'],
  server: [
    'server', 'rack server', 'compute', 'compute server', 'compute node', 'hypervisor',
    'application server', 'database server', 'web server', 'host',
  ],
  storage: [
    'storage', 'storage system', 'storage array', 'disk array', 'disk shelf', 'san', 'nas',
    'san storage', 'nas storage',
  ],
  patch_panel: ['patch panel', 'patchpanel', 'fiber patch panel', 'fibre patch panel', 'copper patch panel'],
  pdu: ['pdu', 'power distribution unit', 'rack pdu'],
  ups: ['ups', 'uninterruptible power supply'],
  cable_manager: ['cable manager', 'cable management', 'cable organiser', 'cable organizer'],
  blank: ['blank', 'blank panel', 'blanking panel', 'filler panel', 'empty'],
};
const FAMILY_OF = new Map(Object.entries(FAMILIES)
  .flatMap(([family, names]) => names.map((n) => [n, family])));

/** Families a front photograph cannot speak for: no ports, no face to read. */
const PASSIVE = new Set(['patch_panel', 'pdu', 'ups', 'cable_manager', 'blank']);

/** The family as it is said inside a sentence. */
const CLASS_WORD = {
  network: 'network', firewall: 'firewall', server: 'server', storage: 'storage',
  patch_panel: 'patch panel', pdu: 'PDU', ups: 'UPS', cable_manager: 'cable manager', blank: 'blank panel',
};

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const keyOf = (v) => text(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * The family of a NetBox role ({name, slug} or its name) or of a camera class.
 * Null when it is not in the map - which is an answer, not a failure.
 */
function classOf(roleOrCvClass) {
  if (roleOrCvClass && typeof roleOrCvClass === 'object') {
    return FAMILY_OF.get(keyOf(roleOrCvClass.name)) || FAMILY_OF.get(keyOf(roleOrCvClass.slug)) || null;
  }
  return FAMILY_OF.get(keyOf(roleOrCvClass)) || null;
}

// -- Small readers --------------------------------------------------------
const roleNameOf = (o) => (o && o.role && typeof o.role === 'object' ? text(o.role.name) : text(o && o.role));
const faceOf = (o) => text(o && o.face && typeof o.face === 'object' ? o.face.value : o && o.face).toLowerCase();

/** A whole shelf number, or null. NetBox hands 22 back as "22.0"; U22.5 is not a shelf a box was read on. */
function shelfOf(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** A height in units when one is stated, else null. */
function heightOf(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Every shelf a box or a record covers: position..position+height-1, one unit when no height is known. */
function covers(position, height) {
  const from = shelfOf(position);
  if (from === null) return [];
  const tall = Math.max(1, Math.ceil(heightOf(height) || 1));
  return Array.from({ length: tall }, (_, i) => from + i);
}

const overlap = (a, b) => a.some((u) => b.includes(u));
const stated = (v) => (identity.isJunkValue(v) ? '' : identity.normalise(v));
/** "a Router", "an Access Switch", "a UPS", "an SFP shelf": initials go by how the first letter is said. */
function article(word) {
  const first = text(word).split(/\s+/)[0] || '';
  if (/^[A-Z0-9]{2,}$/.test(first)) return /^[AEFHILMNORSX]/.test(first) ? 'an' : 'a';
  return /^[aeiou]/i.test(first) && !/^uni(?!n)/i.test(first) ? 'an' : 'a';
}
const aThing = (word) => `${article(word)} ${text(word)}`;
const shelves = (units) => (units.length > 1 ? `U${units[0]} to U${units[units.length - 1]}` : `U${units[0]}`);
const undecided = (item) => item.decision === 'pending' || item.decision === 'ticketed';
const changeKey = (item) => `${item.uid} ${item.action} ${stable(item.diff)}`;

/** An ISO instant as "30 Sep 2026", read off the text so no clock or locale is involved. */
function dayOf(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text(iso));
  if (!m) return null;
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : null;
}

/**
 * The shelf a record's own name states, or null.
 *
 * "SP-R1-U20-ACT" says U20. A name that states two different shelves states
 * neither, and "PDU12" states none: the U has to start a word.
 */
function shelfInName(name) {
  const said = new Set();
  for (const m of text(name).matchAll(/\bU0?(\d{1,2})\b/gi)) said.add(Number(m[1]));
  return said.size === 1 ? [...said][0] : null;
}

/** One suggestion in the shape the Drift Desk reads. State is put on afterwards. */
const card = (rule, { itemUid = null, netboxId = null, ...rest }) => ({
  id: `${rule}|${itemUid || '-'}|${netboxId || '-'}`,
  rule,
  word: null,
  title: '',
  evidence: [],
  itemUid,
  netboxId,
  recordName: null,
  proposes: null,
  candidates: [],
  acceptLabel: null,
  ...rest,
});

const FINDINGS_THAT_ABSTAIN = [
  'record-candidates', 'two-records', 'one-record-two-boxes',
  'binding-not-applied', 'create-held', 'record-not-asked',
];
// A plan carrying one of these has an answer about a record that could not be
// applied. Proposing another answer on top of it would be a second guess.
const FINDINGS_THAT_HOLD_A_MOVE = new Set([
  'binding-not-applied', 'create-held', 'two-records', 'one-record-two-boxes',
]);
const FINDINGS_AGAINST_A_BLANK = new Set(['replaced', 'serial-differs', 'held-back']);
const FILLABLE = { serial: 'serial number', asset_tag: 'asset tag', description: 'description' };
const NOT_IN_SERVICE = new Set(['offline', 'decommissioning', 'failed']);
const EXCEPTION_KIND = { accepted_drift: 'accepted drift', known_exception: 'known exception' };

// -- leave_as_is ----------------------------------------------------------
/** Why a front photograph cannot speak for this record, or null when it can. */
function cannotBeSeen(o) {
  const role = roleNameOf(o);
  if (PASSIVE.has(classOf(o.role))) {
    return `${aThing(role).replace(/^a/, 'A')} has no face a front photograph can read, `
      + 'so not seeing it says nothing about whether it is there.';
  }
  if (o.position === null || o.position === undefined || o.position === '') {
    return 'The record has no shelf in NetBox, so there is no place in the photograph to look for it, '
      + 'and not seeing it says nothing about whether it is there.';
  }
  if (faceOf(o) === 'rear') {
    return 'The record is mounted on the rear of the rack and the photograph shows the front, '
      + 'so not seeing it says nothing about whether it is there.';
  }
  if (heightOf(o.deviceType && o.deviceType.uHeight) === 0) {
    return 'The record takes up no shelf space, so a photograph of the shelves cannot show it, '
      + 'and not seeing it says nothing about whether it is there.';
  }
  return null;
}

// -- exception ------------------------------------------------------------
/**
 * Does this exception cover this item? The same answer exceptions.covers()
 * gives, kept here because that module opens the store and this one must not.
 * suggest.test.js holds the two side by side so they cannot drift apart.
 */
function exceptionCovers(ex, plan, item) {
  if (!ex || !plan || !item || ex.revokedAt) return false;
  if (ex.orgId != null && Number(ex.orgId) !== Number(plan.orgId)) return false;
  if (ex.tenantId != null && Number(ex.tenantId) !== Number(plan.tenantId)) return false;
  if (ex.rackId && String(ex.rackId) !== String(plan.rackId)) return false;
  if (ex.itemType && String(ex.itemType) !== String(item.type)) return false;
  const pattern = text(ex.itemName);
  if (pattern) {
    const name = text(item.name).toLowerCase();
    const hit = pattern.endsWith('*')
      ? name.startsWith(pattern.slice(0, -1).toLowerCase())
      : pattern.toLowerCase() === name;
    if (!hit) return false;
  }
  const attribute = text(ex.attribute);
  if (attribute) {
    // A create changes no field, so an exception about one field never hides a whole new device.
    const diff = item.diff && typeof item.diff === 'object' ? item.diff : null;
    if (!diff || !Object.prototype.hasOwnProperty.call(diff, attribute)) return false;
  }
  return true;
}

// -- The function ---------------------------------------------------------
/**
 * Every suggestion this check supports, in the order a person reads the check:
 * the check itself, a record on the wrong shelf, then each item, then the
 * records the photo did not show.
 *
 * -> { suggestions: [Suggestion], note: string|null }
 */
function suggest({
  plan = null, items = [], orphans = [], findings = [], evidence = null,
  exceptions = [], duplicates = [], state = {},
} = {}) {
  if (evidence === null || evidence === undefined) return { suggestions: [], note: NOTE_NO_EVIDENCE };

  const list = (v) => (Array.isArray(v) ? v : []);
  const boxes = list(evidence.boxes);
  const records = list(evidence.records);
  const allItems = list(items);
  const allFindings = list(findings);
  const unseen = list(orphans).filter((o) => o && o.seen === false);
  const stateOf = (id) => (state && state[id] && state[id].state) || 'open';

  const boxOf = (uid) => boxes.find((b) => b.uid === uid) || null;
  const boxShelves = (b) => covers(b.position, b.span);
  const recordOf = (netboxId) => records.find((r) => Number(r.netboxId) === Number(netboxId)) || null;
  const recordHeight = (o) => heightOf(o.deviceType && o.deviceType.uHeight)
    ?? heightOf((recordOf(o.netboxId) || {}).uHeight);
  const recordShelves = (o) => covers(o.position, recordHeight(o));
  const findingsOn = (uid) => allFindings.filter((f) => f && f.uid === uid);
  const candidateOf = (o) => ({ netboxId: o.netboxId ?? null, name: o.name ?? null, position: shelfOf(o.position) });

  const out = [];

  // -- duplicate, the whole check -----------------------------------------
  // Only an OLDER open check counts: the newer one is the duplicate, and the
  // older one, with its incident, is never the one that closes.
  const older = list(duplicates)
    .map((d) => (d && d.plan ? { ...d.plan, items: d.items } : d))
    .filter((d) => d && d.status !== 'draft' && OPEN.includes(d.status)
      && (!plan || (Number(d.id) !== Number(plan.id) && Number(d.id) < Number(plan.id))))
    .sort((a, b) => Number(b.id) - Number(a.id));
  const heldBy = (d) => {
    const holder = text(d.spoc && d.spoc.username);
    return holder ? `which is with ${holder}` : 'which is waiting for an admin';
  };
  const incidentOf = (d) => text(d.incident && d.incident.number);
  // A check that was changed and compared again signs a new fingerprint, so
  // the one it was FILED with (baseFingerprint, when the check keeps one) is
  // what says two checks are about the same drift.
  const filedAs = (p) => (p && (p.baseFingerprint || p.fingerprint)) || null;
  const sameCheck = filedAs(plan)
    ? older.find((d) => filedAs(d) === filedAs(plan)) : null;
  if (sameCheck) {
    const number = incidentOf(sameCheck);
    out.push(card('duplicate', {
      word: 'confirmed',
      title: `Same as check ${sameCheck.id}, ${heldBy(sameCheck)}${number ? ` (incident ${number})` : ''}`,
      evidence: [
        `Check ${sameCheck.id} on this rack was filed with exactly the same differences.`,
        number ? `Its incident is ${number}, and it stays open.` : null,
        `Closing this check as a duplicate changes nothing on check ${sameCheck.id}.`,
      ].filter(Boolean),
      proposes: { kind: 'duplicate', duplicateOf: sameCheck.id },
      acceptLabel: 'Close as duplicate',
    }));
  }

  // -- wrong_shelf, and the two ways it abstains --------------------------
  const planHoldsAMove = allFindings.some((f) => f && FINDINGS_THAT_HOLD_A_MOVE.has(f.kind));
  // A box the photo added: a Device the plan would create, still to be decided.
  const newBoxes = allItems
    .filter((i) => i && i.type === 'Device' && i.action === 'create' && i.decidable && undecided(i))
    .map((item) => ({ item, box: boxOf(item.uid) }))
    .filter(({ box }) => box && shelfOf(box.position) !== null);
  // leave_as_is records never count as somebody a box could be.
  const missing = unseen.filter((o) => !cannotBeSeen(o));

  /** Everything the pair must pass except the class and the two "only one" tests. */
  function samePair(item, box, o) {
    const at = shelfOf(box.position);
    const was = shelfOf(o.position);
    if (o.ours || was === null || was === at) return false;
    if (NOT_IN_SERVICE.has(text(o.status).toLowerCase())) return false;
    if (box.evidence === 'conflict') return false;
    // No contradiction: a serial, a model read off the faceplate, a height.
    const [serialA, serialB] = [stated(box.serial), stated(o.serial)];
    if (serialA && serialB && serialA !== serialB) return false;
    const [modelA, modelB] = [box.modelIsOcr ? stated(box.model) : '', stated(o.deviceType && o.deviceType.model)];
    if (modelA && modelB && modelA !== modelB) return false;
    const [tallA, tallB] = [heightOf(box.span), recordHeight(o)];
    if (tallA && tallB && tallA !== tallB) return false;
    // The camera's one-unit error: two units apart at least, and no shared shelf.
    const [seenOn, heldOn] = [boxShelves(box), recordShelves(o)];
    if (Math.abs(was - at) < 2 || overlap(seenOn, heldOn)) return false;
    // Something other than the photo has to say the same shelf.
    if (shelfInName(o.name) !== at) return false;
    if (records.some((r) => overlap(covers(r.position, r.uHeight), seenOn))) return false;
    if (boxes.some((b) => overlap(boxShelves(b), heldOn))) return false;
    // Another record already put forward for this box is a second candidate.
    if (findingsOn(item.uid).some((f) => FINDINGS_THAT_ABSTAIN.includes(f.kind)
      || (f.kind === 'record-candidate' && f.netboxId != null && Number(f.netboxId) !== Number(o.netboxId)))) return false;
    return true;
  }

  const movedRecords = new Set();
  const roleAbstained = new Map();   // netboxId -> the item whose move it would have been
  for (const { item, box } of planHoldsAMove ? [] : newBoxes) {
    const family = classOf(box.cvClass);
    if (!family || PASSIVE.has(family)) continue;
    const rivals = newBoxes.filter((n) => classOf(n.box.cvClass) === family);
    const sameFamily = missing.filter((o) => classOf(o.role) === family);
    const fits = sameFamily.filter((o) => samePair(item, box, o));

    if (fits.length === 1 && sameFamily.length === 1 && rivals.length === 1) {
      const o = fits[0];
      const [from, to] = [shelfOf(o.position), shelfOf(box.position)];
      const c = card('wrong_shelf', {
        itemUid: item.uid,
        netboxId: o.netboxId,
        recordName: o.name,
        word: 'likely',
        title: `Same device, wrong shelf: move record ${o.name} from U${from} to U${to}`,
        evidence: [
          `The record's own name says U${to}.`,
          `Same class: the record is ${aThing(roleNameOf(o))} and the photo shows ${aThing(box.cvClass)}.`,
          `It is the only ${CLASS_WORD[family]} record in this rack that the photo did not show.`,
          `${shelves(boxShelves(box))} is empty in NetBox.`,
          `${shelves(recordShelves(o))} is empty in the photo.`,
        ],
        proposes: {
          kind: 'move',
          fields: { position: { from, to } },
          shown: { name: o.name, position: from, serial: o.serial ?? null },
        },
        acceptLabel: 'Move the record',
      });
      out.push(c);
      if (stateOf(c.id) !== 'dismissed') movedRecords.add(Number(o.netboxId));
      continue;
    }

    // It failed ONLY the "only one" test: say so, and name everything that fits.
    if (fits.length >= 1) {
      const many = sameFamily.length > 1;
      out.push(card('abstain', {
        itemUid: item.uid,
        title: 'No suggestion',
        evidence: [many
          ? `${sameFamily.length} records fit and nothing here can tell them apart.`
          : `${rivals.length} boxes in the photo fit the record ${fits[0].name} and nothing here can tell them apart.`],
        candidates: (many ? sameFamily : fits).map(candidateOf),
      }));
      continue;
    }

    // It failed ONLY because the record's role is outside the map.
    if (sameFamily.length === 0 && rivals.length === 1) {
      const unread = missing.filter((o) => classOf(o.role) === null && samePair(item, box, o));
      if (unread.length === 1) roleAbstained.set(Number(unread[0].netboxId), item.uid);
    }
  }

  /** The comparison itself said it could not tell: one card for everything it said about one box. */
  function abstainOn(itemUid, told) {
    const named = (id) => {
      const r = recordOf(id) || list(orphans).find((o) => o && Number(o.netboxId) === Number(id));
      return { netboxId: id ?? null, name: (r && r.name) || null, position: r ? shelfOf(r.position) : null };
    };
    const candidates = [];
    const add = (c) => {
      if (c.netboxId != null && !candidates.some((x) => Number(x.netboxId) === Number(c.netboxId))) candidates.push(c);
    };
    const sentences = told.map((f) => {
      if (f.kind === 'record-candidates') {
        const rows = list(f.candidates);
        rows.forEach((r) => add({ ...named(r.id), name: r.name || named(r.id).name }));
        return `${rows.length} records fit and nothing here can tell them apart.`;
      }
      if (f.kind === 'two-records') {
        [f.netboxId, f.named].forEach((id) => add(named(id)));
        return '2 records fit and nothing here can tell them apart.';
      }
      if (f.kind === 'one-record-two-boxes') {
        add(named(f.netboxId));
        return 'Two boxes in this photo were both said to be the same record, and nothing here can tell which one it is.';
      }
      if (f.kind === 'binding-not-applied') {
        add(named(f.netboxId));
        return 'An earlier answer named a record for a box this photo does not have, so it was applied to nothing.';
      }
      if (f.kind === 'create-held') {
        add(named(f.netboxId));
        return 'This box is held until a person says which box an earlier answer was about.';
      }
      return 'NetBox could not be asked whether it already holds this box.';
    });
    const only = !itemUid && candidates.length === 1 ? candidates[0] : null;
    return card('abstain', {
      itemUid,
      netboxId: only ? only.netboxId : null,
      recordName: only ? only.name : null,
      title: 'No suggestion',
      evidence: [...new Set(sentences)],
      candidates,
    });
  }

  // -- The items, one by one ----------------------------------------------
  for (const item of allItems) {
    if (!item) continue;
    const box = boxOf(item.uid);
    const asked = item.decidable && undecided(item);

    // fills_blank: the switch published a value the record does not have.
    const diff = item.diff && typeof item.diff === 'object' ? item.diff : null;
    const keys = diff ? Object.keys(diff) : [];
    if (asked && item.action === 'update' && keys.length
      && keys.every((k) => Object.prototype.hasOwnProperty.call(FILLABLE, k))
      && keys.every((k) => diff[k] && (diff[k].from === null || diff[k].from === undefined || diff[k].from === ''))
      && keys.every((k) => (k === 'description' ? text(String(diff[k].to ?? '')) : stated(diff[k].to)))
      && box && box.evidence === 'snmp'
      && !findingsOn(item.uid).some((f) => FINDINGS_AGAINST_A_BLANK.has(f.kind))) {
      const values = keys.map((k) => String(diff[k].to).trim());
      out.push(card('fills_blank', {
        itemUid: item.uid,
        netboxId: item.netboxId ?? null,
        recordName: item.name ?? null,
        word: 'confirmed',
        title: 'The switch fills a blank: approve as it stands',
        evidence: [
          ...keys.map((k) => `The record has no ${FILLABLE[k]}.`),
          `The switch itself published ${values.join(' and ')}, and a person confirmed which box that switch is.`,
        ],
        proposes: { kind: 'approve' },
        acceptLabel: 'Approve',
      }));
    }

    // exception: a live exception already covers this question.
    const ex = asked ? list(exceptions).find((e) => exceptionCovers(e, plan, item)) : null;
    if (ex) {
      const until = dayOf(ex.expiresAt);
      const why = text(ex.justification).replace(/[.\s]+$/, '');
      out.push(card('exception', {
        itemUid: item.uid,
        word: 'confirmed',
        title: `Covered by exception ${ex.id}`,
        evidence: [
          `Exception ${ex.id} (${EXCEPTION_KIND[ex.kind] || 'exception'}, `
            + `${until ? `until ${until}` : 'with no end date'})${why ? `: ${why}` : ''}.`,
        ],
        proposes: { kind: 'except', exceptionId: ex.id },
        acceptLabel: 'Set aside',
      }));
    }

    // duplicate, one item: an older open check is already asking this exact question.
    if (asked && !sameCheck) {
      const key = changeKey(item);
      const twin = older.find((d) => list(d.items).some((i) => i
        && ['pending', 'ticketed', 'approved'].includes(i.decision) && changeKey(i) === key));
      if (twin) {
        const number = incidentOf(twin);
        out.push(card('duplicate', {
          itemUid: item.uid,
          word: 'confirmed',
          title: `Same as check ${twin.id}, ${heldBy(twin)}${number ? ` (incident ${number})` : ''}`,
          evidence: [
            `Check ${twin.id} on this rack already holds exactly this change.`,
            number ? `Its incident is ${number}, and it stays open.` : null,
            'Closing the item here leaves it to be decided once, on that check.',
          ].filter(Boolean),
          proposes: { kind: 'duplicate', duplicateOf: twin.id },
          acceptLabel: 'Close the item',
        }));
      }
    }

    // abstain: the comparison already said it could not tell, so say it out loud.
    const told = FINDINGS_THAT_ABSTAIN
      .map((kind) => findingsOn(item.uid).find((f) => f.kind === kind)).filter(Boolean);
    if (told.length) out.push(abstainOn(item.uid, told));
  }
  // An answer about a box this scan does not have sits on no item at all.
  const itemUids = new Set(allItems.filter(Boolean).map((i) => i.uid));
  const loose = new Map();
  for (const f of allFindings) {
    if (!f || !FINDINGS_THAT_ABSTAIN.includes(f.kind) || itemUids.has(f.uid)) continue;
    loose.set(f.uid, [...(loose.get(f.uid) || []), f]);
  }
  for (const told of loose.values()) out.push(abstainOn(null, told));

  // -- The records the photo did not show ---------------------------------
  for (const o of unseen) {
    const why = cannotBeSeen(o);
    if (why) {
      out.push(card('leave_as_is', {
        netboxId: o.netboxId,
        recordName: o.name,
        word: 'no action',
        title: 'Leave as it is: a photograph cannot show this',
        evidence: [why],
        proposes: { kind: 'none' },
        acceptLabel: 'Leave as it is',
      }));
      continue;
    }

    // Everything mark_offline asks for, except a class it can name.
    const family = classOf(o.role);
    const held = recordShelves(o);
    // A new box one shelf away is most likely this very record, read one unit
    // off by the camera. Calling the record gone would be the camera's error twice.
    const nextTo = [...held, held[0] - 1, held[held.length - 1] + 1];
    const readOneOff = newBoxes.some(({ box }) => !PASSIVE.has(classOf(box.cvClass))
      && overlap(boxShelves(box), nextTo));
    const gone = text(o.status).toLowerCase() === 'active' && held.length > 0
      && !boxes.some((b) => overlap(boxShelves(b), held)) && !readOneOff;
    const movedFor = roleAbstained.get(Number(o.netboxId)) || null;
    if (!family) {
      // Only where a rule would have fired: a role nobody can compare is worth a
      // card when it is the one thing standing between the person and a suggestion.
      if (!gone && !movedFor) continue;
      out.push(card('abstain', {
        itemUid: movedFor,
        netboxId: o.netboxId,
        recordName: o.name,
        title: 'No suggestion',
        evidence: [roleNameOf(o)
          ? `The record's role "${roleNameOf(o)}" is not one RackTrack can compare with a photo.`
          : 'The record has no role in NetBox, so RackTrack cannot compare it with a photo.'],
        candidates: [candidateOf(o)],
      }));
      continue;
    }

    if (PASSIVE.has(family) || !gone) continue;
    if (movedRecords.has(Number(o.netboxId))) continue;
    out.push(card('mark_offline', {
      netboxId: o.netboxId,
      recordName: o.name,
      word: 'likely',
      title: `Record not seen: mark ${o.name} offline`,
      evidence: [
        `NetBox lists ${o.name}, ${aThing(roleNameOf(o))}, on ${shelves(held)}.`,
        held.length > 1 ? 'The photo shows those shelves empty.' : 'The photo shows that shelf empty.',
        'Marking it offline keeps the record. Nothing is deleted.',
      ],
      proposes: {
        kind: 'offline',
        fields: { status: { from: 'active', to: 'offline' } },
        shown: { name: o.name, position: shelfOf(o.position), serial: o.serial ?? null },
      },
      acceptLabel: 'Mark offline',
    }));
  }

  // -- What a person has already said about each --------------------------
  // Two findings about one box and one record are one card, not two with one id.
  const byId = new Map();
  for (const s of out) {
    const first = byId.get(s.id);
    if (!first) { byId.set(s.id, s); continue; }
    first.evidence = [...new Set([...first.evidence, ...s.evidence])];
    for (const c of s.candidates) {
      if (!first.candidates.some((x) => Number(x.netboxId) === Number(c.netboxId))) first.candidates.push(c);
    }
  }
  const suggestions = [...byId.values()].map((s) => {
    const said = (state && state[s.id]) || null;
    return {
      ...s,
      state: said && ['accepted', 'dismissed'].includes(said.state) ? said.state : 'open',
      stateBy: (said && said.by) || null,
      stateAt: (said && said.at) || null,
      overrideId: (said && said.overrideId) ?? null,
    };
  });
  return { suggestions, note: null };
}

/**
 * What accepting a suggestion does, in the shape the service acts on. Nothing
 * is done here: this only says which of the existing doors the acceptance goes
 * through, so the rule and the act cannot disagree about a shelf number.
 *
 *   override  -> store.addOverride(planId, override), then a re-plan
 *   decide    -> decideItems(decisions)
 *   except    -> exceptions.applyToPlan(plan.id)
 *   duplicate -> the check moves to `duplicate` with duplicateOf
 *   state     -> only the suggestion's state is written; NetBox and the registry see nothing
 */
function acceptanceOf(s) {
  const p = s && s.proposes;
  if (!p) return null;
  if (p.kind === 'move' || p.kind === 'offline') {
    return {
      does: 'override',
      override: {
        kind: p.kind, itemUid: p.kind === 'move' ? s.itemUid : null,
        netboxId: s.netboxId, recordName: s.recordName,
        fields: p.fields, shown: p.shown || null,
        source: 'suggestion', suggestionId: s.id, rule: s.rule,
      },
    };
  }
  if (p.kind === 'approve') return { does: 'decide', decisions: [{ uid: s.itemUid, decision: 'approved' }] };
  if (p.kind === 'except') return { does: 'except', exceptionId: p.exceptionId };
  if (p.kind === 'duplicate' && s.itemUid) {
    return {
      does: 'decide',
      decisions: [{ uid: s.itemUid, decision: 'not_applicable', note: `${s.title}.` }],
    };
  }
  if (p.kind === 'duplicate') return { does: 'duplicate', duplicateOf: p.duplicateOf };
  return { does: 'state' };
}

module.exports = {
  suggest, classOf, acceptanceOf, shelfInName,
  PASSIVE, NOTE_NO_EVIDENCE,
  _internal: { exceptionCovers, covers },
};
