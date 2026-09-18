/**
 * Turning a match into words a person can check.
 *
 * The server proposes which switch is which box in the rack and hands back the
 * evidence it used. This file is the only place that decides how that evidence
 * reads on screen, so the Review screen, the report and the Switches tab all
 * say the same thing about the same match.
 *
 * Two rules run through every function here:
 *
 *   1. No field names and no numbers out of the scoring engine ever reach the
 *      screen. "serial" becomes "the serial number"; a rank is an ordering
 *      instruction, not a sentence.
 *   2. An older server sends none of this. Every reader below treats a missing
 *      field as "nothing is known" and never as "nothing matched", so a screen
 *      built on it behaves exactly as it did before the evidence existed.
 */

/**
 * A long dash out of an older server, made into the plain hyphen the house uses.
 *
 * The four characters are written as codes rather than typed, so that the rule
 * "plain hyphen only, anywhere" holds for this file as well: figure dash, en
 * dash, em dash, horizontal bar.
 */
const LONG_DASHES = new RegExp(`[${String.fromCharCode(8210, 8211, 8212, 8213)}]`, 'g');

export function plainDashes(text) {
  return String(text == null ? '' : text).replace(LONG_DASHES, '-');
}

/**
 * What each kind of evidence is, in words.
 *
 * Read as a subject: "the serial number" plus "matches" makes the sentence, so
 * two or three of them can share one verb rather than repeating it.
 */
const SUBJECT = {
  serial: 'the serial number',
  chassis: 'the chassis number',
  bridge: 'the hardware address the switch reports',
  mac: 'a hardware address on the box',
  sysname: 'the name the switch gives itself',
  host: 'the address used to reach it',
  model: 'the model',
  vendor: 'the make',
  ports: 'the number of ports',
  size: 'the space it takes in the rack',
};

/**
 * Strongest first, by what the evidence is rather than by the number beside it.
 *
 * The server sends a rank, but a rank only orders evidence of the same kind:
 * whether 1 means strongest or weakest is the engine's business, and a screen
 * that guesses wrong puts the weakest reason at the top. The kind is the thing
 * both sides agree on, so the kind decides the order and the rank breaks ties
 * inside one kind.
 */
const STRENGTH = ['serial', 'chassis', 'bridge', 'mac', 'sysname', 'host', 'model', 'vendor', 'ports', 'size'];

/** Evidence that, on its own, proves very little: a lot of boxes have 24 ports. */
const WEAK = new Set(['ports', 'size', 'vendor']);

const NUMBER_WORD = ['no', 'one', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];

/** "Two", "Three", ... and the numeral once counting stops being useful. */
function countWord(n) {
  const i = Number(n);
  return Number.isInteger(i) && i >= 2 && i < NUMBER_WORD.length ? NUMBER_WORD[i] : String(n);
}

const capitalise = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * The evidence the server sent for one switch, cleaned up and put in order.
 *
 * One entry per kind. The rank orders entries of the same kind, so a switch
 * with two hardware addresses arrives as two `mac` entries, and a sentence
 * built from the list straight would say "a hardware address on the box, a
 * hardware address on the box and the number of ports match". The best-ranked
 * entry of each kind is the one kept.
 */
export function orderedEvidence(reason) {
  const list = Array.isArray(reason && reason.evidence) ? reason.evidence : [];
  const best = new Map();
  for (const e of list) {
    const kind = String((e && e.kind) || '').toLowerCase();
    if (!SUBJECT[kind]) continue;
    const rank = Number.isFinite(Number(e.rank)) ? Number(e.rank) : Number.MAX_SAFE_INTEGER;
    const seen = best.get(kind);
    if (seen && seen.rank <= rank) continue;
    best.set(kind, { kind, rank, detail: plainDashes(e.detail || '').trim() });
  }
  return [...best.values()]
    .sort((a, b) => (STRENGTH.indexOf(a.kind) - STRENGTH.indexOf(b.kind)) || (a.rank - b.rank));
}

/**
 * One plain sentence for why this box was proposed, strongest reason first.
 *
 * Nothing at all to go on reads as exactly that, rather than as silence. A
 * match that rests only on weak evidence says so in the same breath, because
 * "the number of ports matches" on its own sounds like a finding when it is a
 * coincidence waiting to be checked.
 */
export function evidenceSentence(reason) {
  const ev = orderedEvidence(reason);

  if (ev.length === 0) {
    const why = plainDashes((reason && reason.why) || '').trim();
    if (why) return capitalise(why.replace(/\.$/, '')) + '.';
    return 'Nothing about this box has been checked against the switch yet.';
  }

  const subjects = ev.map((e) => SUBJECT[e.kind]);
  let sentence;
  if (subjects.length === 1) {
    sentence = `${capitalise(subjects[0])} matches`;
  } else if (subjects.length === 2) {
    sentence = `${capitalise(subjects[0])} and ${subjects[1]} match`;
  } else if (subjects.length === 3) {
    sentence = `${capitalise(subjects[0])}, ${subjects[1]} and ${subjects[2]} match`;
  } else {
    const rest = subjects.length - 2;
    sentence = `${capitalise(subjects[0])}, ${subjects[1]} and ${rest} more details match`;
  }

  if (ev.every((e) => WEAK.has(e.kind))) sentence += ', and nothing else matches';
  return `${sentence}.`;
}

/**
 * The strongest piece of evidence spelled out, for someone who wants to check
 * it against the label on the box. Empty when the server sent no detail.
 */
export function evidenceDetail(reason) {
  const top = orderedEvidence(reason)[0];
  if (!top || !top.detail || top.detail.length > 60) return '';
  return `${capitalise(SUBJECT[top.kind])}: ${top.detail}`;
}

/**
 * How sure the match is, as a word and a tone.
 *
 * `confirmed`, `probable`, `possible` and `unidentified` are the words the
 * scoring engine uses. "Confirmed" is not one of the words this file may put
 * on screen: on these screens it means a person looked at the box and said
 * yes, and printing it for a machine's own certainty makes the strongest word
 * on the card the one word reserved for the person. The engine's top certainty
 * reads as "Almost certain"; only `matchConfirmation` and `confirmedLine`
 * below ever say confirmed.
 */
export function confidenceWord(reason, hasMatch) {
  const c = String((reason && reason.confidence) || '').toLowerCase();
  if (c === 'confirmed') return { word: 'Almost certain', tone: 'sure', mark: 'check' };
  if (c === 'probable' || c === 'high') return { word: 'Probably', tone: 'likely', mark: 'near' };
  if (c === 'possible' || c === 'medium' || c === 'low') return { word: 'Possibly', tone: 'maybe', mark: 'half' };
  if (c === 'unidentified') return { word: 'Not identified', tone: 'none', mark: 'query' };
  // Nothing said. A match with no confidence beside it is a proposal like any
  // other; no match at all is nothing identified.
  return hasMatch
    ? { word: 'Possibly', tone: 'maybe', mark: 'half' }
    : { word: 'Not identified', tone: 'none', mark: 'query' };
}

/**
 * What would settle an unclear match, in words a person at the rack can act on.
 *
 * Returns an empty string when the match is clear enough to leave alone.
 */
export function settleAdvice(reason, hasMatch) {
  const c = String((reason && reason.confidence) || '').toLowerCase();
  const count = Number((reason && reason.candidateCount) ?? NaN);
  const margin = Number((reason && reason.margin) ?? NaN);
  const tie = Number.isFinite(count) && count >= 2 && Number.isFinite(margin) && margin <= 0;
  const unclear = c === 'unidentified' || !hasMatch || tie;
  if (!unclear) return '';

  // Only a real tie gets the tie sentence. "Four boxes here look the same" is
  // the opposite of what a margin of 12 says, and an unmatched switch with
  // several candidates is the common way to reach this line.
  if (tie) {
    return `${countWord(count)} boxes here look the same. Read the serial number off the label on one of them to tell them apart.`;
  }
  if (Number.isFinite(count) && count === 0) {
    return 'Nothing in the photo looks like this switch. Check it is in this rack, or choose the box yourself.';
  }
  if (Number.isFinite(count) && count === 1 && c === 'unidentified') {
    return 'One box could be this switch. Read the serial off its label to be sure.';
  }
  return 'Choose the box this switch is, or mark it not in this rack.';
}

/**
 * Is this proposal too unclear to put in front of somebody as a choice already
 * made?
 *
 * True when the engine could not identify the box, and true on a tie: two boxes
 * scoring the same is not a match with a caveat, it is two matches, and the
 * screen must not pick one of them on the operator's behalf.
 */
export function unclearMatch(reason) {
  if (!reason || typeof reason !== 'object') return false;
  const c = String(reason.confidence || '').toLowerCase();
  if (c === 'unidentified') return true;
  const count = Number(reason.candidateCount ?? NaN);
  const margin = Number(reason.margin ?? NaN);
  return Number.isFinite(count) && count >= 2 && Number.isFinite(margin) && margin <= 0;
}

/**
 * Which box a proposal is about, whatever shape the server named it in.
 *
 * The evidence and the confidence beside it describe one box. Once somebody
 * chooses a different one, that evidence is about a box nobody is looking at
 * any more, so every screen has to be able to ask which box it was for.
 * Null means the server did not say.
 */
export function reasonDevice(reason) {
  if (!reason || typeof reason !== 'object') return null;
  const uid = reason.deviceUid ?? reason.uid ?? reason.device ?? null;
  return uid === null || uid === undefined || uid === '' ? null : String(uid);
}

/** A date from the server, written the way a person writes one. Never throws. */
export function whenText(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return d.toLocaleString(undefined, {
      day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return d.toISOString().slice(0, 16).replace('T', ' ');
  }
}

/** A name out of whatever shape the server put it in. */
function nameOf(who) {
  if (!who) return '';
  if (typeof who === 'string') return who.trim();
  if (typeof who === 'object') {
    return String(who.name || who.fullName || who.displayName || who.email || who.username || '').trim();
  }
  return '';
}

/**
 * Whether a person has confirmed this switch's match, and when.
 *
 * The server contract fixes the evidence but not where a confirmation is
 * reported, so every plausible place is read: the switch entry, its reason,
 * and a confirmations map beside them. Nothing found means nothing is claimed.
 */
export function matchConfirmation(view, sw) {
  const id = sw && sw.id;
  const reason = (view && view.reasons && id != null) ? view.reasons[id] : null;
  const fromMaps = [view && view.confirmations, view && view.confirmed]
    .map((m) => (m && typeof m === 'object' && id != null ? m[id] : undefined));

  const holders = [sw, reason, ...fromMaps].filter((x) => x && typeof x === 'object');
  const fromBinding = holders.some((h) => h.fromBinding === true);
  const flagged = holders.find((h) => h.confirmed === true || h.confirmedAt || h.confirmedBy) || null;
  const plainTrue = fromMaps.some((x) => x === true);

  if (!flagged && !plainTrue) return { confirmed: false, fromBinding, at: '', by: '' };

  const src = flagged || {};
  return {
    confirmed: true,
    fromBinding,
    at: String(src.confirmedAt || src.at || src.when || ''),
    by: nameOf(src.confirmedBy || src.by || src.who || src.user),
  };
}

/** "Jane Patel confirmed this on 18 September 2026 at 14:03." */
export function confirmedLine(confirmation) {
  if (!confirmation || !confirmation.confirmed) return '';
  const who = confirmation.by || 'A person';
  const when = whenText(confirmation.at);
  return when ? `${who} confirmed this on ${when}.` : `${who} confirmed this match.`;
}

/**
 * Whether this server reports confirmations at all.
 *
 * Screens that label an unconfirmed match as a proposal have to know the
 * difference between "nobody has confirmed it" and "this server cannot say".
 * An older server answers the second, and those screens then read exactly as
 * they did before.
 */
export function serverReportsConfirmations(view) {
  if (!view || typeof view !== 'object') return false;
  if (view.confirmations && typeof view.confirmations === 'object') return true;
  const reasons = view.reasons && typeof view.reasons === 'object' ? Object.values(view.reasons) : [];
  const newWords = new Set(['confirmed', 'probable', 'possible', 'unidentified']);
  for (const r of reasons) {
    if (!r || typeof r !== 'object') continue;
    if (Array.isArray(r.evidence)) return true;
    if ('fromBinding' in r || 'candidateCount' in r || 'confirmedAt' in r) return true;
    if (newWords.has(String(r.confidence || '').toLowerCase())) return true;
  }
  for (const s of Array.isArray(view.switches) ? view.switches : []) {
    if (s && typeof s === 'object' && ('confirmedAt' in s || 'confirmedBy' in s || 'confirmed' in s)) return true;
  }
  return false;
}

/**
 * Does this switch's match stand on a person's word?
 *
 * True when somebody confirmed it, or when it came from a match somebody
 * confirmed before. True as well on a server that cannot say, because a screen
 * must not invent doubt it has no evidence for.
 */
export function matchIsTrusted(view, sw) {
  if (!serverReportsConfirmations(view)) return true;
  const c = matchConfirmation(view, sw);
  return c.confirmed || c.fromBinding;
}
