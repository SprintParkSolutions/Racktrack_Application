/**
 * Deterministic search over the verified knowledge base.
 *
 * This is the accuracy backbone of the whole bot. It generates nothing - it
 * only ranks and returns human-verified answers verbatim. When this path fires,
 * the probability of a hallucinated answer is exactly zero.
 *
 * BM25 with field weighting, plus domain synonym expansion so real user
 * phrasing ("cant log in", "wont sign on") reaches entries written in more
 * formal language. Zero dependencies - runs anywhere Node runs, including
 * bundled into the mobile client for fully offline support.
 *
 * Every signal this file produces describes the words the user actually typed.
 * Nothing here is ever inferred or fabricated: see docs/ROUTING-CONTRACT.md §6.
 */

/**
 * Words carrying no retrieval signal.
 *
 * Directional particles are deliberately NOT here. In this product "sign out",
 * "sign in" and "sign up" are three different answers, and the only thing
 * telling them apart is the particle: dropping it made every sign-out question
 * tokenize identically to every sign-in question, and the right entry became
 * unreachable from its own wording. They are rare enough across the corpus to
 * carry real IDF, so they discriminate rather than add noise.
 */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
  'do', 'does', 'did', 'doing', 'have', 'has', 'had', 'having', 'i', 'me',
  'my', 'we', 'our', 'you', 'your', 'it', 'its', 'this', 'that', 'these',
  'those', 'and', 'or', 'but', 'if', 'then', 'so', 'of', 'at', 'by', 'for',
  'with', 'about', 'to', 'from', 'as', 'not',
  'please', 'help', 'hi', 'hello', 'hey', 'thanks', 'thank',
])

/**
 * Domain synonyms. Each group is mutually expanding: any term in the group
 * pulls in the whole group at reduced weight. Written from how technicians
 * actually type, not from how documentation is written.
 */
const SYNONYM_GROUPS = [
  // Product vocabulary. Users say "tenant", "company", "team"; the UI says
  // "organization"; the codebase says tenant_id. These are the same thing, and
  // a question phrased in one vocabulary must reach an entry written in
  // another — that mismatch is invisible to word-overlap scoring and was
  // sending "create an account as a tenant" to the create-a-new-org answer.
  ['tenant', 'organization', 'organisation', 'org', 'company', 'team', 'workspace'],
  ['join', 'invite', 'invitation', 'onboard', 'add'],
  ['member', 'technician', 'user', 'colleague', 'staff'],
  ['site', 'location', 'branch', 'facility'],
  // Splitting these was tried and reverted: separating login from password
  // broke more queries than it fixed ("cant log in keeps saying wrong" started
  // matching a port change-log entry). Keeping them together is not ideal —
  // "why am I signed out" still reaches the password entry — but it is the
  // better of the two measured options. Revisit with the eval, not by intuition.
  // The log-in / log-out spellings are handled by PHRASES above, not here: as a
  // bare word "log" means a log file, and pulling the whole authentication
  // vocabulary in behind it sent "how do I clear the log" to the sign-in
  // throttling answer.
  ['signin', 'signout', 'sign', 'authenticate', 'auth', 'password', 'credential'],
  ['scan', 'scanning', 'scanned', 'capture', 'photo', 'picture', 'camera', 'image', 'shot'],
  ['report', 'reporting', 'export', 'download', 'csv', 'pdf', 'spreadsheet'],
  ['rack', 'cabinet', 'enclosure'],
  ['switch', 'device', 'hardware', 'equipment', 'appliance'],
  ['port', 'ports', 'interface', 'socket'],
  ['cable', 'cabling', 'wire', 'patch', 'lead'],
  ['error', 'fail', 'failed', 'failure', 'broken', 'wrong', 'issue', 'problem', 'bug', 'crash'],
  ['slow', 'lag', 'hang', 'freeze', 'stuck', 'timeout', 'timedout'],
  ['offline', 'disconnected', 'network', 'connection', 'internet', 'wifi', 'signal'],
  ['sync', 'syncing', 'synced', 'upload', 'save', 'saved'],
  ['install', 'update', 'upgrade', 'version', 'app'],
  ['audit', 'auditing', 'check', 'verify', 'inspect'],
  // The documentation says "recognise", users say "identify", and the model
  // internals say "detect" — three vocabularies for one action. Asked "what
  // devices can RackTrack identify", the entry that lists all twelve of them
  // ranked sixteenth; asked with "recognise" it ranked first.
  ['identify', 'identification', 'recognise', 'recognize', 'recognition', 'detect', 'detection', 'classify', 'classification'],
  ['missing', 'gone', 'disappeared', 'lost', 'empty', 'blank', 'nothing'],
  ['permission', 'access', 'denied', 'forbidden', 'unauthorized', 'role', 'admin'],
]

/**
 * Synonyms are keyed by STEM, not by surface form.
 *
 * Queries are stemmed before expansion, so a map keyed by surface forms silently
 * never fires for any word the stemmer changes: "scanning" stems to "scan" and
 * would miss a "scanning" key, "ports" stems to "port", and so on. Keying and
 * storing both sides as stems is what makes expansion actually reachable.
 */
const SYNONYM_MAP = (() => {
  const map = new Map()
  for (const group of SYNONYM_GROUPS) {
    const stems = [...new Set(group.map(stem))]
    for (const term of stems) {
      const others = stems.filter((t) => t !== term)
      const existing = map.get(term) || []
      map.set(term, [...new Set([...existing, ...others])])
    }
  }
  return map
})()

/**
 * Phrases normalised to the product's own vocabulary before anything else runs.
 *
 * "Log out", "logout", "log off" and "sign out" are one action with four names,
 * and users type all of them. Handling that as a word-level synonym does not
 * work: the bare word "log" also means a log file, so making it a synonym of
 * the whole authentication vocabulary sent "how do I clear the log" to the
 * sign-in throttling answer, and removing it stranded "how to log out".
 *
 * The phrase is what disambiguates, so the phrase is what gets rewritten. Both
 * questions and entries pass through here, so the two always meet.
 */
const PHRASES = [
  [/\blogg?ed[\s-]*out\b/g, ' signout '],
  [/\blogg?ed[\s-]*in\b/g, ' signin '],
  [/\blog[\s-]*out\b/g, ' signout '],
  [/\blog[\s-]*off\b/g, ' signout '],
  [/\blog[\s-]*in(?:to)?\b/g, ' signin '],
  [/\blog[\s-]*on\b/g, ' signin '],
  // The product's own spelling is normalised too, so a question and the entry
  // answering it always reduce to the same tokens. Rewriting only one side left
  // "signout" as a term the corpus had never seen, which made it look like
  // unmatched vocabulary and dragged the right answer down.
  [/\bsigned?[\s-]*out\b/g, ' signout '],
  [/\bsigned?[\s-]*in(?:to)?\b/g, ' signin '],
  [/\bsign[\s-]*on\b/g, ' signin '],
]

/**
 * Number words folded to digits, in both the question and the entry.
 *
 * The documentation writes "recognises twelve classes" and users type "what are
 * the 12 classes". Neither can match the other as text, and normalising one side
 * only would swap which of them fails.
 */
const NUMBER_WORDS = new Map(Object.entries({
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7',
  eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12', thirteen: '13',
  fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17', eighteen: '18',
  nineteen: '19', twenty: '20', thirty: '30', forty: '40', fifty: '50',
}))

/** Lowercase, normalise phrases, strip punctuation, drop stopwords, light stemming. */
export function tokenize(text) {
  let normalised = String(text || '').toLowerCase().replace(/['']/g, '')
  for (const [re, replacement] of PHRASES) normalised = normalised.replace(re, replacement)

  const raw = normalised
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))

  // Users type compound words without the space ("signout", "logoff"). Split
  // the ones we know about so they reach entries written with the space.
  const expanded = []
  for (const t of raw) {
    expanded.push(NUMBER_WORDS.get(t) || t)
    for (const part of splitCompound(t)) {
      if (part.length > 1 && !STOPWORDS.has(part)) expanded.push(part)
    }
  }

  return expanded.map(stem)
}

/**
 * Compound words users run together, as an explicit dictionary.
 *
 * The previous rule — "split anything starting with sign/log/rack/time/pass" —
 * shredded ordinary words: "password" became pass+word, "signal" became
 * sign+al, "passport" became pass+port. Those fragments then matched login and
 * networking entries at full weight, so a question about a signal strength
 * scored against the sign-out answer. A dictionary cannot do that.
 */
const COMPOUNDS = new Map([
  ['signout', ['sign', 'out']],
  ['signin', ['sign', 'in']],
  ['signup', ['sign', 'up']],
  ['rackscan', ['rack', 'scan']],
  ['rescan', ['scan']],
  ['multirack', ['multi', 'rack']],
  ['screenshot', ['screen', 'shot']],
  ['timeout', ['time', 'out']],
  ['timedout', ['time', 'out']],
  ['setup', ['set', 'up']],
  ['backup', ['back', 'up']],
  ['checkin', ['check', 'in']],
  ['checkout', ['check', 'out']],
  ['signedout', ['sign', 'out']],
  ['signedin', ['sign', 'in']],
])

/** Parts of a known compound word, or an empty list. */
export function splitCompound(token) {
  return COMPOUNDS.get(token) || []
}

/**
 * Deliberately conservative stemmer.
 *
 * The one property that matters is CONSISTENCY: every member of a word family
 * must reduce to the same stem, or the family silently splits into terms that
 * cannot match each other. "share/shares" reducing to `share` while
 * "shared/sharing" reduced to `shar` meant an entry saying "shared" was
 * unreachable from a question saying "share".
 *
 * Order: plural -> ing/ed -> silent e -> doubled final consonant. Every rule is
 * applied to every token, including base forms, so the family converges. Rules
 * are skipped when they would leave a stem under three characters, since very
 * short stems collide across unrelated words.
 */
function stem(token) {
  if (token.length <= 3) return token
  let t = token

  if (t.endsWith('ies') && t.length > 4) t = `${t.slice(0, -3)}y`
  else if (t.endsWith('sses')) t = t.slice(0, -2)
  else if (t.endsWith('s') && !t.endsWith('ss') && !t.endsWith('us')) t = t.slice(0, -1)

  if (t.endsWith('ing') && t.length - 3 >= 3) t = t.slice(0, -3)
  else if (t.endsWith('ed') && t.length - 2 >= 3) t = t.slice(0, -2)

  if (t.endsWith('e') && t.length - 1 >= 3) t = t.slice(0, -1)

  // "scanned" -> "scann" -> "scan", so it meets "scan". Applied to every token
  // (not only stripped ones) so base forms converge to the same place.
  if (t.length > 3 && t[t.length - 1] === t[t.length - 2] && /[a-z]/.test(t[t.length - 1])) {
    t = t.slice(0, -1)
  }

  return t.length >= 3 ? t : token
}

export { stem }

/**
 * An entry written as a problem report rather than an explanation.
 *
 * Most of this corpus is troubleshooting, so these dominate it, and they share
 * vocabulary with the capability questions users actually open with. Asked "what
 * devices will RackTrack identify", word overlap picked the entry headed 'The
 * switch card says "We couldn't identify this device" — what do I do?' and quoted
 * it, which answers the opposite of what was asked. Knowing which kind of
 * question an entry answers is enough to stop that.
 */
const PROBLEM_SHAPED = /(?:\bcan'?t\b|\bcannot\b|\bcould ?n'?t\b|\bwo ?n'?t\b|\bfail(?:s|ed|ing)?\b|\berror\b|\bwrong\b|\bmissing\b|\bempty\b|\bblank\b|\bbroken\b|\bstuck\b|\bnothing\b|\bincorrect(?:ly)?\b|\bdisappear(?:ed|s)?\b|what do i do\b)/i

/** A question about what the product is or does, rather than about a fault. */
const CAPABILITY_QUERY = /^(?:what|which|who|does|can)\b/i

/** Confidence multiplier when the two disagree. Enough to keep a problem entry
 *  out of verbatim while leaving it visible as a candidate. */
const KIND_MISMATCH = 0.7

/** Field weights: a hit in the question text means far more than one in the body. */
export const FIELD_WEIGHTS = {
  question: 3.0,
  symptoms: 2.5,
  answer: 1.0,
  rootCause: 0.8,
}

const K1 = 1.5 // BM25 term-frequency saturation
const B = 0.75 // BM25 length normalization
const SYNONYM_WEIGHT = 0.45 // an expanded term counts less than one the user typed

/** Build a searchable index. Do this once at startup, not per query. */
export function buildIndex(entries) {
  const docs = entries.map((entry) => {
    const fields = {
      question: tokenize(entry.question),
      symptoms: tokenize((entry.symptoms || []).join(' ')),
      answer: tokenize(entry.answer),
      rootCause: tokenize(entry.rootCause),
    }

    // Weighted term frequencies across all fields.
    const tf = new Map()
    let length = 0
    for (const [field, tokens] of Object.entries(fields)) {
      const weight = FIELD_WEIGHTS[field]
      for (const token of tokens) {
        tf.set(token, (tf.get(token) || 0) + weight)
        length += weight
      }
    }

    // Kept separately from the merged bag of terms: matching an entry's own
    // QUESTION is far stronger evidence than matching words scattered through
    // its answer. Without this, a long entry that happens to contain every word
    // somewhere outranked the entry that literally asks what the user asked.
    return {
      entry,
      tf,
      length,
      terms: new Set(tf.keys()),
      // Question terms are the question's own words. Folding symptoms in here was
      // measured and rejected: it cost four points of self-retrieval and started
      // answering "forgot my password" from an unrelated entry.
      questionTerms: new Set(fields.question),
      problemShaped: PROBLEM_SHAPED.test(entry.question || ''),
    }
  })

  const avgLength = docs.reduce((sum, d) => sum + d.length, 0) / (docs.length || 1)

  // Document frequency per term, for IDF.
  const df = new Map()
  for (const doc of docs) {
    for (const term of doc.terms) df.set(term, (df.get(term) || 0) + 1)
  }

  const idf = new Map()
  const N = docs.length
  let maxIdf = 0
  for (const [term, count] of df) {
    // BM25 IDF, floored so very common terms contribute a little rather than going negative.
    const v = Math.max(0.05, Math.log(1 + (N - count + 0.5) / (count + 0.5)))
    idf.set(term, v)
    if (v > maxIdf) maxIdf = v
  }

  // The corpus vocabulary doubles as a spelling dictionary. Only terms long
  // enough to correct safely are kept.
  const vocabulary = [...idf.keys()].filter((t) => t.length >= 4)

  return { docs, avgLength, idf, maxIdf, vocabulary, size: entries.length }
}

/**
 * Optimal string alignment distance — Levenshtein plus adjacent transposition,
 * abandoned as soon as it exceeds `max`.
 *
 * Transposition has to count as one edit rather than two, because it is the most
 * common typing mistake there is: "rakctrack", "detceted", "identiofy".
 */
function editDistance(a, b, max) {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1

  let prev2 = null
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = new Array(b.length + 1)
    row[0] = i
    let best = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1)
      }
      row[j] = v
      if (v < best) best = v
    }
    if (best > max) return max + 1
    prev2 = prev
    prev = row
  }
  return prev[b.length]
}

/**
 * Replace query terms the corpus has never seen with the nearest term it has.
 *
 * Technicians type fast and on phones. "forgot my paswword", "how do i instal on
 * android", "what will be detceted" and "rakctrack" all failed outright: the
 * misspelled word was unknown vocabulary, which both lost its matches and pushed
 * the unknown-ratio gate over its limit, so a routine question was refused or
 * sent away as off-topic.
 *
 * The tolerance is tight and scales with length, because short words are close
 * to each other by accident: "ulcer" is two edits from "user" and must not be
 * corrected into it, while "paswword" is one edit from "password" and should be.
 * A word with no near neighbour is left alone, so genuinely foreign vocabulary
 * still reads as foreign — which is what keeps off-topic questions out.
 */
function correctTerm(term, index) {
  if (index.idf.has(term)) return term
  if (term.length < 5 || !index.vocabulary) return term

  const max = term.length >= 7 ? 2 : 1
  let best = null
  let bestDistance = max + 1
  for (const candidate of index.vocabulary) {
    if (Math.abs(candidate.length - term.length) > max) continue
    const d = editDistance(term, candidate, max)
    if (d < bestDistance) {
      bestDistance = d
      best = candidate
      if (d === 1) break
    }
  }
  return bestDistance <= max ? best : term
}

/** Expand a query into [term, weight] pairs, including synonyms. */
export function expandQuery(queryTokens) {
  const weights = new Map()
  for (const token of queryTokens) {
    weights.set(token, Math.max(weights.get(token) || 0, 1.0))
    for (const syn of SYNONYM_MAP.get(token) || []) {
      weights.set(syn, Math.max(weights.get(syn) || 0, SYNONYM_WEIGHT))
    }
  }
  return weights
}

/**
 * Score every entry against the query.
 * Returns results sorted best-first with a normalized 0-1 confidence.
 */
export function search(index, query, { limit = 5 } = {}) {
  const typed = tokenize(query)
  if (typed.length === 0) return []
  // Spelling is corrected against the corpus before scoring, so a typo costs the
  // user nothing. Anything without a near neighbour is left as it was typed.
  const queryTokens = typed.map((t) => correctTerm(t, index))

  const expanded = expandQuery(queryTokens)
  // Total "information mass" of the query: the sum of IDF across the terms the
  // user actually typed. Matching 2 of 3 words means very different things
  // depending on WHICH two, so coverage is measured in information, not words.
  //
  // An unknown term (absent from the whole corpus) still counts toward the
  // denominator at the maximum observed IDF. That is deliberate: a question
  // full of words we have never seen ("BGP", "Juniper", "thermal mapping")
  // should score as largely unmatched rather than being quietly ignored.
  let queryMass = 0
  let unknownTerms = 0
  const uniqueTerms = new Set(queryTokens)
  const maxIdf = index.maxIdf || 1
  for (const term of uniqueTerms) {
    if (index.idf.has(term)) {
      queryMass += index.idf.get(term)
    } else {
      queryMass += maxIdf
      unknownTerms += 1
    }
  }
  if (queryMass <= 0) return []

  // Fraction of the query's vocabulary that does not appear ANYWHERE in the
  // knowledge base. This is the one signal that reliably separates "a question
  // about our product, phrased oddly" from "a question about something else".
  //
  // It is what catches the hard case lexical overlap cannot: "how do I
  // configure a BGP session on a Cisco 9300" matches login entries on the word
  // "session", but bgp / cisco / 9300 are words this corpus has never seen, and
  // that is decisive.
  const unknownRatio = unknownTerms / uniqueTerms.size

  // A capability question that itself describes no fault. When the query already
  // mentions a symptom, a problem entry is exactly what should match it, so the
  // penalty below must not apply.
  const askingWhatItDoes = CAPABILITY_QUERY.test(query.trim()) && !PROBLEM_SHAPED.test(query)

  const results = []

  for (const doc of index.docs) {
    let score = 0
    let matchedMass = 0
    let matchedTerms = 0
    let questionMass = 0

    for (const [term, queryWeight] of expanded) {
      const freq = doc.tf.get(term)
      if (!freq) continue

      const idf = index.idf.get(term) || 0
      const norm = freq * (K1 + 1) / (freq + K1 * (1 - B + B * (doc.length / index.avgLength)))

      score += idf * norm * queryWeight

      // Only terms the user actually typed count toward coverage. A synonym
      // match is useful for ranking but is not evidence that we understood
      // what they asked. Crediting synonyms here was measured and rejected: it
      // did not reach the entries it was meant to, and it started answering
      // "scan is not working" confidently, which is exactly the failure the
      // typed-words rule exists to prevent.
      if (queryWeight === 1.0) {
        matchedMass += idf
        matchedTerms += 1
        if (doc.questionTerms.has(term)) questionMass += idf
      }
    }

    if (score <= 0) continue

    // How much of the ENTRY's question the query accounts for — the reverse of
    // coverage. It answers "does this entry ask anything beyond what was asked?"
    // and it is what separates entries that all contain the query. Asked "what
    // is RackTrack", four entries contain both words; only one of them asks
    // nothing else, and the other three are about the marketplace, the quality
    // gate and verifying an install.
    let docQuestionMass = 0
    for (const term of doc.questionTerms) docQuestionMass += index.idf.get(term) || 0

    results.push({
      entry: doc.entry,
      rawScore: score,
      questionPrecision: docQuestionMass > 0 ? Math.min(1, questionMass / docQuestionMass) : 0,
      // Fraction of the query's information that was actually found.
      coverage: Math.min(1, matchedMass / queryMass),
      // Fraction of it found in the entry's own question — "is this entry
      // asking what the user is asking?", which is a different question from
      // "does this entry mention the same words somewhere?".
      questionOverlap: Math.min(1, questionMass / queryMass),
      // Absolute information matched. Guards against a short vague query
      // ("its broken") reaching coverage 1.0 by matching its single common word.
      matchedMass,
      matchedTerms,
      unknownRatio,
      problemShaped: doc.problemShaped,
      askingWhatItDoes,
    })
  }

  if (results.length === 0) return []

  results.sort((a, b) => b.rawScore - a.rawScore)
  const pool = results.slice(0, Math.max(limit, 8))
  const best = pool[0].rawScore

  // Confidence, not raw score, is what routing gates on, so it is also what the
  // ranking must be ordered by. Ordering by raw score and gating on confidence
  // meant the entry we answered from was sometimes not the entry with the
  // highest confidence in the list.
  const scored = pool
    .map((r) => ({
      entry: r.entry,
      score: r.rawScore,
      coverage: r.coverage,
      questionOverlap: r.questionOverlap,
      questionPrecision: r.questionPrecision,
      matchedMass: r.matchedMass,
      matchedTerms: r.matchedTerms,
      unknownRatio: r.unknownRatio,
      confidence: computeConfidence(r, best, kindMismatch(r)),
    }))
    .sort((a, b) => b.confidence - a.confidence || b.score - a.score)
    .slice(0, limit)

  // How clearly the top hit beat the runner-up, in the same units we gate on.
  // A near-tie means lexical scoring cannot be trusted to have picked right.
  const topConf = scored[0].confidence
  const runnerUp = scored.length > 1 ? scored[1].confidence : 0
  const margin = topConf > 0 ? (topConf - runnerUp) / topConf : 1

  // How much more completely the winner asks the user's question than the
  // runner-up does. When several entries cover neighbouring problems their
  // scores sit close together, and the one that literally asks what the user
  // asked would otherwise be withheld as a "near-tie" and offered as a menu
  // item alongside the entries it plainly beats.
  const questionLead = scored[0].questionOverlap - (scored.length > 1 ? scored[1].questionOverlap : 0)
  const precisionLead = scored[0].questionPrecision - (scored.length > 1 ? scored[1].questionPrecision : 0)

  return scored.map((r, i) => ({
    ...r,
    margin: i === 0 ? margin : 0,
    questionLead: i === 0 ? questionLead : 0,
    precisionLead: i === 0 ? precisionLead : 0,
    rank: i + 1,
  }))
}

/** Does this entry answer a different kind of question than the one asked? */
function kindMismatch(result) {
  return result.askingWhatItDoes && result.problemShaped ? KIND_MISMATCH : 1
}

/**
 * How much each signal counts toward confidence.
 *
 * Exposed so eval/sweep.mjs can measure a change against the labelled set rather
 * than anyone tuning it by feel. Every value here was chosen by that sweep.
 */
export const CONFIDENCE_WEIGHTS = { strength: 0.15, coverage: 0.35, overlap: 0.35, precision: 0.15 }

/** Used only by the sweep. Production code reads the weights, never writes them. */
export function setConfidenceWeights(next) {
  Object.assign(CONFIDENCE_WEIGHTS, next)
}

function computeConfidence(result, best, kindFactor = 1) {
  const relative = result.rawScore / best

  // Absolute strength, saturating. Tuned so a solid multi-term match lands ~0.7+.
  const strength = Math.min(1, result.rawScore / 12)

  // Coverage answers "did we understand what they asked?" rather than "did we
  // find text that looks similar?" — on a large corpus, plenty of unrelated
  // text looks similar. Question overlap goes further and asks whether this
  // entry is about the same thing, which is what separates a near-tie of four
  // entries mentioning "sign" from the one entry about signing out.
  // Question precision — how much of the ENTRY's question the query accounts for
  // — is what separates entries that all contain the query. Four entries mention
  // signing out; only one asks nothing beyond "how do I sign out", and without
  // this term the longest of the four won on raw score.
  const w = CONFIDENCE_WEIGHTS
  const raw = relative * (
    w.strength * strength +
    w.coverage * result.coverage +
    w.overlap * result.questionOverlap +
    w.precision * (result.questionPrecision || 0)
  ) * kindFactor
  return Math.round(Math.min(1, Math.max(0, raw)) * 100) / 100
}

/**
 * Routing thresholds. Set these from `node eval/tune.js` output, never by
 * intuition - and RE-TUNE THEM whenever the knowledge base changes size, since
 * IDF and score distributions shift with the corpus.
 *
 * Every gate below is a hard requirement for answering verbatim; see
 * docs/ROUTING-CONTRACT.md §2. They are independent because each catches what
 * the others miss:
 *
 *   confidence - overall match strength.
 *   coverage   - fraction of the words the user actually typed that were found.
 *   margin     - how far clear the winner is of second place.
 *   terms      - how many distinct typed words matched at all.
 *   unknown    - how much of the question is vocabulary we have never seen.
 */
export const THRESHOLDS = {
  /** At or above this, and past every gate below, answer verbatim from the entry. */
  DIRECT: 0.68,
  /** Between GROUNDED and DIRECT, hand the top entries to the model to phrase. */
  GROUNDED: 0.45,
  /** Minimum fraction of query *information* that must be found. Hard gate. */
  MIN_COVERAGE: 0.33,
  /** Absolute score floor, independent of normalization. Hard gate. */
  MIN_SCORE: 4.0,
  /**
   * Absolute information the question must contribute before an entry is quoted.
   *
   * Coverage is a ratio, so a question made of nothing but common words reaches
   * 1.0 by matching all of its own weak vocabulary — "app is not working" scores
   * every gate perfectly on two words worth 2.8 of IDF between them, and then
   * one of a hundred entries wins by a rounding error. A real question carries
   * far more: "how do I log out" is 8.1, and an entry's own wording is higher
   * still. Measured in IDF, so a rare word counts for many common ones.
   */
  MIN_MATCHED_MASS: 4.0,
  /**
   * Distinct query terms that must match before an answer is returned verbatim.
   * One matching word is never enough to be confident which of a few hundred
   * entries someone means - "its broken" matches "broken" perfectly and tells
   * us nothing. Such queries belong in the ambiguous band where we ask.
   */
  MIN_TERMS_FOR_DIRECT: 2,
  /**
   * How far the top match must beat the runner-up to answer it verbatim.
   *
   * Word overlap cannot separate near-ties: "where did my old scans go" scores
   * a TestFlight entry at 0.74 and the correct history entry at 0.66. Both look
   * confident; only one is right. When the gap is this small the question goes
   * to the model, which reads both and picks — that judgement is exactly what a
   * model is good at and lexical scoring is not.
   */
  MIN_MARGIN_FOR_DIRECT: 0.18,
  /**
   * Maximum fraction of query vocabulary that may be absent from the entire
   * knowledge base. Above this the question is about something we do not
   * cover, however well individual words happen to match.
   */
  MAX_UNKNOWN: 0.30,
}

/**
 * What each signal means, in the words the maintainer needs rather than the
 * variable names. Surfaced by the knowledge dashboard so the scoring model is
 * legible to whoever has to tune it next.
 */
export const RETRIEVAL_SIGNALS = [
  { name: 'confidence', what: 'Overall match strength, 0-1. Everything else feeds this.' },
  { name: 'coverage', what: 'Share of the question\'s information found, weighted by word rarity. Counts only words the user actually typed — a synonym helps ranking but is not evidence we understood.' },
  { name: 'questionOverlap', what: 'Share of the question found in the ENTRY\'S OWN question, rather than anywhere in its body. Separates "is about this" from "mentions these words".' },
  { name: 'questionPrecision', what: 'Share of the entry\'s question the query accounts for. Breaks ties between entries that all contain the query: the one asking nothing extra wins.' },
  { name: 'matchedMass', what: 'Absolute information matched. Stops a question made of the corpus\'s commonest words from scoring perfectly on nothing.' },
  { name: 'margin', what: 'How far the winner is clear of second place. A near-tie goes to the menu instead of being asserted.' },
  { name: 'unknownRatio', what: 'Share of the question\'s vocabulary absent from the whole corpus. What separates "our product, phrased oddly" from "something else entirely".' },
  { name: 'spelling', what: 'Unknown words are corrected against the corpus vocabulary (edit distance with transpositions), so a typo costs nothing.' },
  { name: 'kindMismatch', what: 'A capability question ("what can it identify") is penalised against a fault-report entry ("we couldn\'t identify this device"), which answer the opposite thing.' },
]
