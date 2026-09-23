/**
 * What a ticket is actually claiming, and whether the photograph agrees.
 *
 * The second workflow starts at a ticket somebody wrote in their own words:
 *
 *   "SP-HYB-RM01-R01-R1: core router is on U22, record says U20"
 *   "Port 14 on SW02 is dead - rack RK-5B81BE87"
 *   "Please confirm the patch panel in SP-HYB-RM01-R01-R2"
 *
 * Nothing in there is a field. This module reads such a sentence for the few
 * things RackTrack can check against a photograph - which rack, which shelf,
 * which device, which port - and then answers the claim against what a scan
 * found. It is deliberately conservative: a claim it cannot read is `null`,
 * and an answer it cannot give is "the photograph does not settle this",
 * because a wrong answer here sends somebody to the wrong rack.
 *
 * Written 23 September 2026, for the flow the owner described: a ticket is
 * raised, the technician photographs the rack it names, and RackTrack says
 * what the ticket claims and what is physically there.
 */

/* A scan's own id: the hash of a photograph. */
const RACK_ID = /\bRK-[0-9A-F]{6,}\b/i;
/* A rack as a data centre names it: letters, digits and hyphens, at least
   three groups, which is what every naming convention we have seen produces
   (SP-HYB-RM01-R01-R1, DC1-A-12, LON-R04-R2). Two groups is too loose: it
   matches "port-14" and half the words in a sentence. */
const RACK_NAME = /\b([A-Z][A-Z0-9]*(?:-[A-Z0-9]+){2,})\b/;
/* A shelf, written the way a rack is labelled. */
const UNIT = /\b(?:U|RU|unit\s*)(\d{1,2})\b/i;
/* A port, and never a unit: "port 14", "interface 3", "Gi1/0/14". */
const PORT = /\b(?:port|interface|if|eth|gi)\s*#?\s*(\d{1,3})\b/i;
/* What somebody is likely to be pointing at. */
const DEVICE_WORDS = [
  ['router', /\brouters?\b/i],
  ['switch', /\bswitch(?:es)?\b|\bsw\d*\b/i],
  ['patch panel', /\bpatch\s*panels?\b|\bpp\d*\b/i],
  ['firewall', /\bfirewalls?\b/i],
  ['server', /\bservers?\b/i],
  ['pdu', /\bpdus?\b/i],
];
/* What the ticket wants done, when it says so plainly. */
const ASKS = [
  ['confirm', /\bconfirm\b|\bverify\b|\bcheck\b|\bplease look\b/i],
  ['moved', /\bmoved?\b|\bwrong shelf\b|\bshould be on\b|\bis on\b/i],
  ['missing', /\bmissing\b|\bnot there\b|\bcannot find\b|\bremoved\b/i],
  ['added', /\bnew\b|\badded\b|\binstalled\b/i],
  ['down', /\bdown\b|\bdead\b|\bno link\b|\bnot working\b|\bfaulty\b/i],
];

const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

/**
 * Read a ticket's words for what can be checked against a photograph.
 *
 * Returns null when there is nothing to check - which is most tickets, and is
 * the honest answer. When it does return something, every field is one the
 * photograph can speak to.
 */
function decode(text) {
  const t = clean(text);
  if (!t) return null;

  const rackId = (t.match(RACK_ID) || [])[0] || null;
  // A rack id is itself a hyphenated word, so it is taken out before looking
  // for a name, or every scan id reads as a rack name.
  const withoutId = rackId ? t.replace(RACK_ID, ' ') : t;
  const rackName = (withoutId.toUpperCase().match(RACK_NAME) || [])[1] || null;

  const unitRaw = t.match(UNIT);
  const portRaw = t.match(PORT);
  // "U20" inside a name like SP-R1-U20-ACT is the name, not a claim.
  const unit = unitRaw && !(rackName && rackName.includes(`U${unitRaw[1]}`))
    ? Number(unitRaw[1]) : null;
  const port = portRaw ? Number(portRaw[1]) : null;

  const device = (DEVICE_WORDS.find(([, re]) => re.test(t)) || [])[0] || null;
  const asks = ASKS.filter(([, re]) => re.test(t)).map(([k]) => k);

  const has = rackId || rackName || unit != null || port != null || device;
  if (!has) return null;
  return {
    rackId: rackId ? rackId.toUpperCase() : null,
    rackName,
    unit,
    port,
    device,
    // The first thing it asks for, of the ones we know how to answer.
    asks: asks[0] || null,
    text: t,
  };
}

/** What the scan holds, as the few facts a claim can be answered from. */
function factsOf(scan) {
  const devices = Array.isArray(scan && scan.devices) ? scan.devices : [];
  return devices.map((d) => ({
    name: clean(d.label || d.name || d.class_name || 'device'),
    kind: clean(d.class_name || d.type || '').toLowerCase(),
    unit: Number(d.unit ?? d.position ?? d.u ?? NaN),
    ports: Number(d.port_count ?? (Array.isArray(d.ports) ? d.ports.length : NaN)),
  })).filter((d) => d.name);
}

const kindMatches = (kind, word) => {
  if (!word) return false;
  const k = String(kind || '').toLowerCase().replace(/[_-]/g, ' ');
  if (word === 'patch panel') return /patch\s*panel/.test(k);
  return k.includes(word);
};

/**
 * Answer the claim with what the photograph found.
 *
 * Returns { verdict, says, found } where verdict is one of:
 *   'agrees'    the rack is as the ticket describes it
 *   'differs'   the rack is not as the ticket describes it, and here is how
 *   'unsure'    the photograph does not settle this
 *
 * `says` and `found` are sentences for a person standing at the rack, not
 * field names: they are read on a phone, once, with a rack in front of them.
 */
function answer(claim, scan) {
  if (!claim) return { verdict: 'unsure', says: null, found: 'There is nothing in the ticket a photograph can settle.' };
  const facts = factsOf(scan);
  if (!facts.length) {
    return { verdict: 'unsure', says: claim.text, found: 'The photograph has not been read yet.' };
  }

  // A shelf is claimed: is anything on it, and is it the kind of thing named?
  if (claim.unit != null) {
    const onIt = facts.filter((d) => d.unit === claim.unit);
    const named = claim.device ? facts.filter((d) => kindMatches(d.kind, claim.device)) : [];
    if (onIt.length) {
      const what = onIt.map((d) => d.name).join(', ');
      if (!claim.device || onIt.some((d) => kindMatches(d.kind, claim.device))) {
        return { verdict: 'agrees', says: `The ticket says U${claim.unit}.`,
          found: `The photograph shows ${what} on U${claim.unit}.` };
      }
      return { verdict: 'differs', says: `The ticket says the ${claim.device} is on U${claim.unit}.`,
        found: `The photograph shows ${what} on U${claim.unit}${named.length
          ? `, and the ${claim.device} on U${named[0].unit}` : `, and no ${claim.device} there`}.` };
    }
    if (named.length) {
      return { verdict: 'differs', says: `The ticket says the ${claim.device} is on U${claim.unit}.`,
        found: `U${claim.unit} is empty in the photograph. The ${claim.device} is on U${named[0].unit}.` };
    }
    return { verdict: 'differs', says: `The ticket says U${claim.unit}.`,
      found: `Nothing is on U${claim.unit} in the photograph.` };
  }

  // A port is claimed: a photograph shows the ports a device has, and not
  // whether one of them is passing traffic. Saying so is the honest answer,
  // and it is the answer whether or not the ticket also names the device.
  if (claim.port != null) {
    const on = claim.device ? factsOf(scan).filter((d) => kindMatches(d.kind, claim.device)) : [];
    const has = on.find((d) => Number.isFinite(d.ports));
    return {
      verdict: 'unsure',
      says: `The ticket names port ${claim.port}.`,
      found: has
        ? `The photograph shows ${has.name} with ${has.ports} ports, but not whether port ${claim.port} is passing traffic. Read the switch to answer that.`
        : 'A photograph shows the ports a device has, not whether one is passing traffic. Read the switch to answer that.',
    };
  }

  // A device is named with no shelf: say where it is.
  if (claim.device) {
    const named = facts.filter((d) => kindMatches(d.kind, claim.device));
    if (!named.length) {
      return { verdict: 'differs', says: `The ticket names a ${claim.device}.`,
        found: `The photograph shows no ${claim.device} in this rack.` };
    }
    const where = named.map((d) => (Number.isFinite(d.unit) ? `${d.name} on U${d.unit}` : d.name)).join(', ');
    return { verdict: 'agrees', says: `The ticket names a ${claim.device}.`,
      found: `The photograph shows ${where}.` };
  }

  return { verdict: 'unsure', says: claim.text, found: 'The photograph does not settle this.' };
}

module.exports = { decode, answer, factsOf, _RACK_NAME: RACK_NAME };
