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
 */

const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
  'do', 'does', 'did', 'doing', 'have', 'has', 'had', 'having', 'i', 'me',
  'my', 'we', 'our', 'you', 'your', 'it', 'its', 'this', 'that', 'these',
  'those', 'and', 'or', 'but', 'if', 'then', 'so', 'of', 'at', 'by', 'for',
  'with', 'about', 'to', 'from', 'in', 'on', 'out', 'up', 'down', 'as',
  'please', 'help', 'hi', 'hello', 'hey', 'thanks', 'thank',
])

/**
 * Domain synonyms. Each group is mutually expanding: any term in the group
 * pulls in the whole group at reduced weight. Written from how technicians
 * actually type, not from how documentation is written.
 */
const SYNONYM_GROUPS = [
  ['login', 'log', 'signin', 'sign', 'logon', 'authenticate', 'auth', 'password', 'credential'],
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
  ['missing', 'gone', 'disappeared', 'lost', 'empty', 'blank', 'nothing'],
  ['permission', 'access', 'denied', 'forbidden', 'unauthorized', 'role', 'admin'],
]

const SYNONYM_MAP = (() => {
  const map = new Map()
  for (const group of SYNONYM_GROUPS) {
    for (const term of group) {
      const others = group.filter((t) => t !== term)
      map.set(term, (map.get(term) || []).concat(others))
    }
  }
  return map
})()

/** Lowercase, strip punctuation, drop stopwords, light plural stemming. */
export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem)
}

/** Deliberately conservative stemmer. Aggressive stemming causes false matches. */
function stem(token) {
  if (token.length <= 3) return token
  if (token.endsWith('ies') && token.length > 4) return `${token.slice(0, -3)}y`
  if (token.endsWith('sses')) return token.slice(0, -2)
  if (token.endsWith('s') && !token.endsWith('ss') && !token.endsWith('us')) return token.slice(0, -1)
  if (token.endsWith('ing') && token.length > 5) return token.slice(0, -3)
  if (token.endsWith('ed') && token.length > 4) return token.slice(0, -2)
  return token
}

/** Field weights: a hit in the question text means far more than one in the body. */
const FIELD_WEIGHTS = {
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

    return { entry, tf, length, terms: new Set(tf.keys()) }
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

  return { docs, avgLength, idf, maxIdf, size: entries.length }
}

/** Expand a query into [term, weight] pairs, including synonyms. */
function expandQuery(queryTokens) {
  const weights = new Map()
  for (const token of queryTokens) {
    weights.set(token, Math.max(weights.get(token) || 0, 1.0))
    for (const syn of SYNONYM_MAP.get(token) || []) {
      const stemmed = stem(syn)
      weights.set(stemmed, Math.max(weights.get(stemmed) || 0, SYNONYM_WEIGHT))
    }
  }
  return weights
}

/**
 * Score every entry against the query.
 * Returns results sorted best-first with a normalized 0-1 confidence.
 */
export function search(index, query, { limit = 5 } = {}) {
  const queryTokens = tokenize(query)
  if (queryTokens.length === 0) return []

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

  const results = []

  for (const doc of index.docs) {
    let score = 0
    let matchedMass = 0
    let matchedTerms = 0

    for (const [term, queryWeight] of expanded) {
      const freq = doc.tf.get(term)
      if (!freq) continue

      const idf = index.idf.get(term) || 0
      const norm = freq * (K1 + 1) / (freq + K1 * (1 - B + B * (doc.length / index.avgLength)))
      score += idf * norm * queryWeight

      // Only terms the user actually typed count toward coverage. A synonym
      // match is useful for ranking but is not evidence that we understood
      // what they asked.
      if (queryWeight === 1.0) {
        matchedMass += idf
        matchedTerms += 1
      }
    }

    if (score <= 0) continue

    results.push({
      entry: doc.entry,
      rawScore: score,
      // Fraction of the query's information that was actually found.
      coverage: Math.min(1, matchedMass / queryMass),
      // Absolute information matched. Guards against a short vague query
      // ("its broken") reaching coverage 1.0 by matching its single common word.
      matchedMass,
      matchedTerms,
      unknownRatio,
    })
  }

  results.sort((a, b) => b.rawScore - a.rawScore)
  const top = results.slice(0, limit)
  if (top.length === 0) return []

  // Normalize against the best score so confidence is comparable across queries.
  const best = top[0].rawScore
  return top.map((r) => ({
    entry: r.entry,
    score: r.rawScore,
    coverage: r.coverage,
    matchedMass: r.matchedMass,
    matchedTerms: r.matchedTerms,
    unknownRatio: r.unknownRatio,
    // Confidence blends absolute strength, coverage, and margin over the runner-up.
    confidence: computeConfidence(r, top, best),
  }))
}

function computeConfidence(result, top, best) {
  const relative = result.rawScore / best

  // Margin: how far clear is the top hit from second place? A clear winner is
  // much safer to answer verbatim than a near-tie between two entries.
  const margin = top.length > 1 ? (best - top[1].rawScore) / best : 1.0

  // Absolute strength, saturating. Tuned so a solid multi-term match lands ~0.7+.
  const strength = Math.min(1, result.rawScore / 12)

  // Coverage dominates. It is the only term that answers "did we understand
  // what they asked?" rather than "did we find text that looks similar?" - and
  // on a large corpus, plenty of unrelated text looks similar.
  const raw = relative * (0.25 * strength + 0.60 * result.coverage + 0.15 * margin)
  return Math.round(Math.min(1, Math.max(0, raw)) * 100) / 100
}

/**
 * Routing thresholds. Set these from `node eval/tune.js` output, never by
 * intuition - and RE-TUNE THEM whenever the knowledge base changes size, since
 * IDF and score distributions shift with the corpus.
 *
 * Two independent gates, because each catches what the other misses:
 *
 *   confidence - overall match strength. Catches queries that match a lot of
 *                low-value terms.
 *   coverage   - fraction of the words the user actually typed that were found.
 *                Catches the classic retrieval failure where an off-topic
 *                question ("how much does it cost per user?") hits one
 *                incidental word and scores respectably. Coverage separated the
 *                probe sets more cleanly than confidence did.
 *
 * Both must pass. A query failing either one is refused.
 */
export const THRESHOLDS = {
  /** At or above this, answer verbatim from the entry. No model involved. */
  DIRECT: 0.68,
  /** Between GROUNDED and DIRECT, hand top entries to the model to phrase. */
  GROUNDED: 0.45,
  /** Minimum fraction of query *information* that must be found. Hard gate. */
  MIN_COVERAGE: 0.33,
  /** Absolute score floor, independent of normalization. Hard gate. */
  MIN_SCORE: 4.0,
  /**
   * Distinct query terms that must match before an answer is returned verbatim.
   * One matching word is never enough to be confident which of a few hundred
   * entries someone means - "its broken" matches "broken" perfectly and tells
   * us nothing. Such queries belong in the ambiguous band where we ask.
   */
  MIN_TERMS_FOR_DIRECT: 2,
  /**
   * Maximum fraction of query vocabulary that may be absent from the entire
   * knowledge base. Above this the question is about something we do not
   * cover, however well individual words happen to match.
   */
  MAX_UNKNOWN: 0.30,
}
