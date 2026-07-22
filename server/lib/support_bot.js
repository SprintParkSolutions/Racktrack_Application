/**
 * Support bot engine — grounded answers from a verified knowledge base.
 *
 * Three routes, in descending order of safety:
 *   verbatim  — search is confident; return the verified answer word for word.
 *               Generates nothing, so it cannot hallucinate.
 *   grounded  — relevant but ambiguous; a local model (Ollama, optional)
 *               phrases an answer using ONLY the matched entries, and the
 *               output is validated before the user sees it.
 *   refusal   — nothing relevant matched. Say so. Never guess.
 *
 * Costs nothing to run: BM25 search is local and dependency-free, and the
 * optional model runs on our own hardware. If Ollama is absent the bot falls
 * back to search-only and keeps working.
 *
 * Tier isolation is structural: entries above a caller's clearance are removed
 * from the index at load time, not hidden behind a prompt instruction. Content
 * that was never loaded cannot be leaked.
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('./observability');
const { buildAssociations, expandWithAssociations } = require('./support_associations');

const KB_PATH = process.env.SUPPORT_KB_PATH || path.join(__dirname, '..', 'data', 'support-kb.json');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b';
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 20000);
const OLLAMA_ENABLED = process.env.SUPPORT_BOT_LLM !== 'off';

// ── One bot, one corpus ──────────────────────────────────────────────
// There used to be two tiers, and the same question got different answers
// depending on who asked: "How do I create a RackTrack account?" returned the
// verified answer to a member and a list of guesses to an owner, because the
// larger admin corpus diluted the score. Support that answers differently by
// rank is worse than support that answers the same thing to everyone.
//
// `internal-only` is excluded from ALL answers. Those entries quote server
// source paths and line numbers; they exist to help write the KB, not to be
// read out to a user, whatever their role.
const ANSWERABLE_AUDIENCES = ['end-user', 'admin'];
const SINGLE_TIER = 'all';
const TIER_AUDIENCES = {
  [SINGLE_TIER]: ANSWERABLE_AUDIENCES,
};

/** Kept so callers need not change; every role now gets the same bot. */
function tierForRole(_role) {
  return SINGLE_TIER;
}

// ── Routing thresholds ───────────────────────────────────────────────
// Re-tune with support-bot/eval/tune.js whenever the KB changes size: IDF and
// score distributions shift with the corpus.
const THRESHOLDS = {
  /** At or above this, answer verbatim. No model involved. */
  DIRECT: Number(process.env.SUPPORT_T_DIRECT || 0.68),
  /** Between GROUNDED and DIRECT, let the model phrase from matched entries. */
  GROUNDED: Number(process.env.SUPPORT_T_GROUNDED || 0.45),
  /** Minimum fraction of query *information* that must be found. */
  MIN_COVERAGE: Number(process.env.SUPPORT_T_COVERAGE || 0.33),
  /** Absolute score floor, independent of normalization. */
  MIN_SCORE: Number(process.env.SUPPORT_T_SCORE || 4.0),
  /**
   * Distinct typed terms required before answering verbatim. One matching word
   * is never enough to know which of ~200 entries someone means — "its broken"
   * matches "broken" perfectly and tells us nothing.
   */
  MIN_TERMS_FOR_DIRECT: Number(process.env.SUPPORT_T_MIN_TERMS || 2),
  /**
   * How far the top match must beat the runner-up before answering verbatim.
   * Word overlap cannot separate near-ties — "where did my old scans go" ranks
   * a TestFlight entry at 0.74 and the correct history entry at 0.66. Both look
   * confident; only one is right. Below this gap the question goes to the
   * model, which reads both and picks.
   */
  MIN_MARGIN_FOR_DIRECT: Number(process.env.SUPPORT_T_MARGIN || 0.18),
  /**
   * Maximum fraction of query vocabulary absent from the whole knowledge base.
   * Above this, the question is about something we do not cover, however well
   * individual words happen to match.
   */
  MAX_UNKNOWN: Number(process.env.SUPPORT_T_MAX_UNKNOWN || 0.3),
};

// ── Tokenizer ────────────────────────────────────────────────────────
const STOPWORDS = new Set([
  'a','an','the','is','are','was','were','be','been','being','am','do','does','did','doing',
  'have','has','had','having','i','me','my','we','our','you','your','it','its','this','that',
  'these','those','and','or','but','if','then','so','of','at','by','for','with','about','to',
  'from','in','on','out','up','down','as','please','help','hi','hello','hey','thanks','thank',
]);

const SYNONYM_GROUPS = [
  // Product vocabulary. Users say "tenant", "company", "team"; the UI says
  // "organization"; the codebase says tenant_id. A question phrased in one
  // vocabulary must reach an entry written in another — that mismatch is
  // invisible to word-overlap scoring.
  ['tenant','organization','organisation','org','company','team','workspace'],
  ['join','invite','invitation','onboard','add'],
  ['member','technician','user','colleague','staff'],
  ['site','location','branch','facility'],
  // Signing in and passwords are related but NOT interchangeable. Merging them
  // is what sent "why do I keep getting signed out" to the password-rules
  // answer. Splitting them failed on its own earlier because nothing replaced
  // the lost connections — the learned associations below now do, measured from
  // the corpus rather than guessed.
  ['login','log','signin','sign','logon','authenticate','auth'],
  ['password','passphrase','credential','passcode'],
  ['scan','scanning','scanned','capture','photo','picture','camera','image','shot'],
  ['report','reporting','export','download','csv','pdf','spreadsheet'],
  ['rack','cabinet','enclosure'],
  ['switch','device','hardware','equipment','appliance'],
  ['port','ports','interface','socket'],
  ['cable','cabling','wire','patch','lead'],
['error','fail','failed','failure','broken','wrong','issue','problem','bug','crash'],
  ['slow','lag','hang','freeze','stuck','timeout','timedout'],
  ['offline','disconnected','network','connection','internet','wifi','signal'],
  ['sync','syncing','synced','upload','save','saved'],
  ['install','update','upgrade','version','app'],
  ['audit','auditing','check','verify','inspect'],
  ['missing','gone','disappeared','lost','empty','blank','nothing'],
  ['permission','access','denied','forbidden','unauthorized','role','admin'],
];

const SYNONYM_MAP = (() => {
  const m = new Map();
  for (const g of SYNONYM_GROUPS) {
    for (const t of g) m.set(t, (m.get(t) || []).concat(g.filter((x) => x !== t)));
  }
  return m;
})();

function stem(t) {
  if (t.length <= 3) return t;
  if (t.endsWith('ies') && t.length > 4) return `${t.slice(0, -3)}y`;
  if (t.endsWith('sses')) return t.slice(0, -2);
  if (t.endsWith('s') && !t.endsWith('ss') && !t.endsWith('us')) return t.slice(0, -1);
  if (t.endsWith('ing') && t.length > 5) return t.slice(0, -3);
  if (t.endsWith('ed') && t.length > 4) return t.slice(0, -2);
  return t;
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/['‘’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem);
}

// ── Index ────────────────────────────────────────────────────────────
const FIELD_WEIGHTS = { question: 3.0, symptoms: 2.5, answer: 1.0, rootCause: 0.8 };
const K1 = 1.5;
const B = 0.75;
const SYNONYM_WEIGHT = 0.45;

function buildIndex(entries) {
  const docs = entries.map((entry) => {
    const fields = {
      question: tokenize(entry.question),
      symptoms: tokenize((entry.symptoms || []).join(' ')),
      answer: tokenize(entry.answer),
      rootCause: tokenize(entry.rootCause),
    };
    const tf = new Map();
    let length = 0;
    for (const [field, tokens] of Object.entries(fields)) {
      const w = FIELD_WEIGHTS[field];
      for (const tok of tokens) {
        tf.set(tok, (tf.get(tok) || 0) + w);
        length += w;
      }
    }
    return { entry, tf, length, terms: new Set(tf.keys()) };
  });

  const avgLength = docs.reduce((s, d) => s + d.length, 0) / (docs.length || 1);
  const df = new Map();
  for (const d of docs) for (const t of d.terms) df.set(t, (df.get(t) || 0) + 1);

  const idf = new Map();
  const N = docs.length;
  let maxIdf = 0;
  for (const [t, c] of df) {
    const v = Math.max(0.05, Math.log(1 + (N - c + 0.5) / (c + 0.5)));
    idf.set(t, v);
    if (v > maxIdf) maxIdf = v;
  }

  // Learn which terms travel together in THIS product's language. This is what
  // lets a question about being "signed out" reach an answer about sessions
  // expiring, without an embedding model and without a hand-written synonym
  // list that someone has to keep correct.
  const associations = buildAssociations(docs);

  return { docs, avgLength, idf, maxIdf, associations, size: entries.length };
}

function search(index, query, limit = 4) {
  const qTokens = tokenize(query);
  if (!qTokens.length) return [];

  const weights = new Map();
  for (const t of qTokens) {
    weights.set(t, Math.max(weights.get(t) || 0, 1.0));
    for (const syn of SYNONYM_MAP.get(t) || []) {
      const s = stem(syn);
      weights.set(s, Math.max(weights.get(s) || 0, SYNONYM_WEIGHT));
    }
  }

  // Then widen with what the corpus itself says goes together. The hand-written
  // list above covers vocabulary we anticipated; this covers the rest.
  if (index.associations) expandWithAssociations(weights, index.associations);

  // Total "information mass" of the query: the sum of IDF across the terms the
  // user actually typed. Matching 2 of 3 words means very different things
  // depending on WHICH two, so coverage is measured in information, not words.
  //
  // An unknown term (absent from the whole corpus) still counts toward the
  // denominator at the maximum observed IDF. That is deliberate: a question
  // full of words we have never seen ("BGP", "Juniper", "thermal mapping")
  // should score as largely unmatched rather than being quietly ignored.
  let queryMass = 0;
  let unknownTerms = 0;
  const uniqueTerms = new Set(qTokens);
  const maxIdf = index.maxIdf || 1;
  for (const term of uniqueTerms) {
    if (index.idf.has(term)) {
      queryMass += index.idf.get(term);
    } else {
      queryMass += maxIdf;
      unknownTerms += 1;
    }
  }
  if (queryMass <= 0) return [];

  // Fraction of the query's vocabulary that does not appear ANYWHERE in the
  // knowledge base. This is the one signal that reliably separates "a question
  // about our product, phrased oddly" from "a question about something else".
  //
  // It is what catches the hard case lexical overlap cannot: "how do I
  // configure a BGP session on a Cisco 9300" matches login entries on the word
  // "session", but bgp / cisco / 9300 are words this corpus has never seen, and
  // that is decisive.
  const unknownRatio = unknownTerms / uniqueTerms.size;

  const results = [];
  for (const doc of index.docs) {
    let score = 0;
    let matchedMass = 0;
    let matchedTerms = 0;
    for (const [term, qw] of weights) {
      const freq = doc.tf.get(term);
      if (!freq) continue;
      const idf = index.idf.get(term) || 0;
      const norm = (freq * (K1 + 1)) / (freq + K1 * (1 - B + B * (doc.length / index.avgLength)));
      score += idf * norm * qw;
      // Only terms the user actually typed count toward coverage. A synonym
      // match helps ranking but is not evidence we understood the question.
      if (qw === 1.0) {
        matchedMass += idf;
        matchedTerms += 1;
      }
    }
    if (score <= 0) continue;
    results.push({
      entry: doc.entry,
      rawScore: score,
      coverage: Math.min(1, matchedMass / queryMass),
      matchedMass,
      matchedTerms,
      unknownRatio,
    });
  }

  results.sort((a, b) => b.rawScore - a.rawScore);
  const top = results.slice(0, limit);
  if (!top.length) return [];

  const best = top[0].rawScore;
  const runnerUp = top.length > 1 ? top[1].rawScore : 0;
  return top.map((r) => {
    const relative = r.rawScore / best;
    const margin = top.length > 1 ? (best - top[1].rawScore) / best : 1.0;
    const strength = Math.min(1, r.rawScore / 12);
    // Coverage dominates: it is the only term answering "did we understand
    // the question?" rather than "did we find similar-looking text?".
    const conf = relative * (0.25 * strength + 0.6 * r.coverage + 0.15 * margin);
    return {
      entry: r.entry,
      score: r.rawScore,
      coverage: r.coverage,
      // How clearly this beat the runner-up. A near-tie means word overlap
      // cannot be trusted to have picked the right entry.
      margin: best > 0 ? (best - runnerUp) / best : 1,
      matchedTerms: r.matchedTerms,
      unknownRatio: r.unknownRatio,
      confidence: Math.round(Math.min(1, Math.max(0, conf)) * 100) / 100,
    };
  });
}

// ── Knowledge base ───────────────────────────────────────────────────
let _kb = null;
const _indexes = new Map();

/**
 * The `short` field is what the bot actually shows as its answer, and in most
 * entries it is corrupted: a truncated opening followed by the whole answer
 * again, so the reply reads "…tap Get Started. 2. 1. On the welcome screen tap
 * Get Started. 2. Fill in…". It was generated by prepending a slice of the
 * answer to the answer itself.
 *
 * Detect that — the answer's first line reappearing inside a `short` that is
 * meaningfully longer than it — and fall back to the answer, which is always
 * the verified text. Worst case a reply is longer than intended; that is much
 * better than one that visibly repeats itself.
 */
function cleanShort(short, answer) {
  const s = String(short || '').trim();
  const a = String(answer || '').trim();
  if (!s || !a || s === a) return s || undefined;
  const firstLine = a.split('\n')[0].trim();
  if (firstLine.length >= 12 && s.includes(firstLine) && s.length > firstLine.length + 15) {
    return undefined;   // contaminated — callers fall through to `answer`
  }
  return s;
}

function loadKB() {
  if (_kb) return _kb;
  if (!fs.existsSync(KB_PATH)) {
    throw new Error(
      `Support bot knowledge base missing at ${KB_PATH}. ` +
        `The bot refuses to start ungrounded — an ungrounded support bot is worse than none.`
    );
  }
  const raw = JSON.parse(fs.readFileSync(KB_PATH, 'utf8'));
  const entries = (raw.entries || []).map((e, i) => ({
    ...e,
    id: e.id || `${String(e.domain || 'gen').toUpperCase().replace(/[^A-Z0-9]/g, '')}-${String(i + 1).padStart(3, '0')}`,
    short: cleanShort(e.short, e.answer),
  }));
  _kb = { ...raw, entries };
  return _kb;
}

function getIndex(tier) {
  if (!_indexes.has(tier)) {
    const allowed = TIER_AUDIENCES[tier];
    if (!allowed) throw new Error(`Unknown support tier "${tier}"`);
    // Structural isolation: restricted entries never enter this index.
    const visible = loadKB().entries.filter((e) => allowed.includes(e.audience));
    _indexes.set(tier, { index: buildIndex(visible), count: visible.length });
  }
  return _indexes.get(tier);
}

/**
 * Index over EVERY entry regardless of tier. Never used to answer — only to
 * detect that a good answer exists above the caller's clearance, so we can say
 * so instead of substituting an unrelated entry.
 */
let _fullIndex = null;
function getFullIndex() {
  if (!_fullIndex) _fullIndex = buildIndex(loadKB().entries);
  return _fullIndex;
}

/** Build every tier index up front so the first user request is not slow. */
function warmup() {
  const out = {};
  for (const tier of Object.keys(TIER_AUDIENCES)) out[tier] = getIndex(tier).count;
  return out;
}

// ── Out-of-scope intents ─────────────────────────────────────────────
// Products we might be measured against, and which this KB knows nothing
// about. A comparison is only unanswerable when the OTHER side of it is outside
// RackTrack — comparing two racks, or two scans of one rack, is a documented
// RackTrack feature, so the comparison verbs alone cannot be the signal.
// Integration partners (ServiceNow, Netdisco) are deliberately absent: those
// are things we connect to and do have entries about.
const COMPETITOR_NAMES =
  /\b(?:netbox|device\s?42|nlyte|sunbird|dcim\s+tools?|racktables|opendcim|netterrain|hyperview|patchmanager|rackmonkey)\b/;

/**
 * Categories of question this knowledge base structurally cannot answer.
 *
 * These are not "we happen to be missing an entry" gaps that could be filled
 * later - they are questions about facts that do not live in source code at
 * all. Answering them requires a person, so route to one - unless retrieval
 * found a verified entry that plainly answers the question, which is the caller's
 * check to make (see `ask`), not this function's.
 */
function detectOutOfScope(text) {
  const t = text.toLowerCase()

  const rules = [
    {
      kind: 'roadmap',
      // Future tense about capability. Code says what is, never what will be.
      re: /\b(?:when (?:will|are|is|do) (?:you|it|they|we)|will (?:you|it|there) (?:be|ever|add|support)|do you plan|any plans|planning to|on the roadmap|roadmap|upcoming (?:release|feature|version)|future (?:release|version|plan)|coming soon|eta\b)/,
      reply:
        "I can only tell you how RackTrack works today - I don't have anything about future plans or release timing. " +
        'Your RackTrack administrator can raise a feature request with the product team.',
    },
    {
      kind: 'commercial',
      re: /\b(?:how much (?:does|is|would|will).{0,24}(?:cost|charge)|what.{0,12}(?:the )?(?:price|pricing|cost)\b|price per|cost per|per (?:user|seat|device|month|year) (?:cost|price|fee)|licen[cs]e (?:fee|cost|price)|subscription (?:cost|price|fee)|discount|quote\b|invoice|refund|billing)/,
      reply:
        "I only cover how to use RackTrack, so I don't have anything on pricing or billing. " +
        'Your RackTrack administrator or account manager can help with that.',
    },
    {
      kind: 'comparison',
      // Anchored to an out-of-product object, never to a comparison verb: a
      // technician asking "how do I compare the two racks" is asking about
      // RACK-004, and telling them we can't compare ourselves to competitors is
      // a confidently wrong answer to a documented workflow.
      re: new RegExp(
        [
          COMPETITOR_NAMES.source,
          '\\bcompetitors?\\b',
          '\\b(?:compare|compares|comparing|compared) (?:racktrack|this app|this product|it) (?:to|with|against|versus|vs\\.?)\\b',
          '\\b(?:racktrack|this app|this product) (?:is |was )?(?:better|worse) than\\b',
          '\\balternatives? to (?:racktrack|this app|this product)\\b',
        ].join('|')
      ),
      reply:
        "I can explain what RackTrack does, but I can't compare it to other products - I don't have reliable information about them. " +
        'Happy to answer anything about using RackTrack itself.',
    },
  ]

  for (const rule of rules) {
    if (rule.re.test(t)) return rule
  }
  return null
}

// ── Credential guard ─────────────────────────────────────────────────
function looksLikeSecret(value) {
  const v = String(value).replace(/[.,!?;:'"]+$/, '');
  if (v.length < 6) return false;
  const signals = [
    /[0-9]/.test(v) && /[A-Za-z]/.test(v),
    /[^A-Za-z0-9]/.test(v),
    /[a-z]/.test(v) && /[A-Z]/.test(v),
    v.length >= 16,
  ].filter(Boolean).length;
  return signals >= 2;
}

/**
 * Spot a credential the user volunteered. Distinguishes a secret being *stated*
 * ("my password is Summer2026!") from one merely *mentioned* ("my password is
 * wrong") — the latter is an ordinary support question.
 */
function detectCredential(text) {
  const unambiguous = [
    { re: /\b(?:sk|pk|ghp|gho|xox[bpsa])[-_][A-Za-z0-9]{16,}/, label: 'an API token' },
    { re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, label: 'a session token' },
  ];
  for (const { re, label } of unambiguous) if (re.test(text)) return label;

  const labelled = [
    { re: /\b(?:my\s+)?(?:password|passwd|pwd|passphrase)\s*(?:is|:|=)\s*(\S+)/i, label: 'your password' },
    { re: /\b(?:api[\s_-]?key|secret|token|bearer)\s*(?:is|:|=)\s*(\S+)/i, label: 'an API key or token' },
    { re: /\bcommunity\s*(?:string)?\s*(?:is|:|=)\s*(\S+)/i, label: 'an SNMP community string' },
  ];
  for (const { re, label } of labelled) {
    const m = text.match(re);
    if (m && looksLikeSecret(m[1])) return label;
  }
  return null;
}

// ── Local model (optional) ───────────────────────────────────────────
let _llmState = null;
let _llmStateAt = 0;

/**
 * How long a NEGATIVE probe result is trusted. A success is cached for the life
 * of the process (Ollama does not disappear mid-run in practice), but a single
 * failed probe used to be cached the same way — so one restart of Ollama, one
 * slow first response, one blip, and the bot sat in search-only mode until the
 * server was restarted, silently and with nothing to tell an operator why.
 * Short enough to heal within a conversation, long enough that a genuinely
 * absent Ollama is probed once a minute rather than once a question.
 */
const LLM_PROBE_RETRY_MS = Number(process.env.SUPPORT_LLM_PROBE_TTL_MS || 60_000);

async function llmAvailable(recheck = false) {
  if (!OLLAMA_ENABLED) return { ok: false, reason: 'disabled via SUPPORT_BOT_LLM=off' };
  const stale = !_llmState?.ok && Date.now() - _llmStateAt >= LLM_PROBE_RETRY_MS;
  if (_llmState && !recheck && !stale) return _llmState;
  // Stamped before the probe, not after: concurrent questions during a probe
  // then keep the last known state instead of each firing their own request.
  _llmStateAt = Date.now();
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) {
      _llmState = { ok: false, reason: `Ollama HTTP ${res.status}` };
      return _llmState;
    }
    const body = await res.json();
    const names = (body.models || []).map((m) => m.name);
    const has = names.some((n) => n === OLLAMA_MODEL || n.startsWith(`${OLLAMA_MODEL.split(':')[0]}:`));
    _llmState = has
      ? { ok: true, model: OLLAMA_MODEL }
      : { ok: false, reason: `model "${OLLAMA_MODEL}" not pulled` };
  } catch (err) {
    _llmState = { ok: false, reason: `unreachable at ${OLLAMA_URL} (${err.message})` };
  }
  return _llmState;
}

// One escalation line, because there is one bot. It has to work whether the
// reader is a technician or the person who runs the platform.
const ESCALATION_TEXT =
  'Note what you were doing when it happened and any exact error text, and pass that to the RackTrack team.';
const ESCALATION = new Proxy({}, { get: () => ESCALATION_TEXT });

function buildPrompt(matches, tier) {
  const voice =
    false
      ? 'You are talking to a RackTrack administrator. You may use technical terms.'
      : 'You are talking to a datacenter technician using the app. Plain language, no jargon. Never discuss servers, code, or internal systems.';

  const facts = matches
    .map(({ entry }, i) => {
      const p = [`[${i + 1}] (id: ${entry.id})`, `Question: ${entry.question}`, `Answer: ${entry.short || entry.answer}`];
      if (entry.symptoms && entry.symptoms.length) p.push(`Symptoms: ${entry.symptoms.join('; ')}`);
      return p.join('\n');
    })
    .join('\n\n');

  return `You are the RackTrack support assistant. RackTrack is an app technicians use to identify and audit datacenter racks.

${voice}

Below are the ONLY facts you know. You have no other knowledge about RackTrack.

--- FACTS ---
${facts}
--- END FACTS ---

RULES:
1. Answer using ONLY the facts above. Nothing else.
2. Never invent a number, button name, screen name, error message, or setting not written above.
3. Keep it short. Lead with what to do. Use numbered steps.
4. End your reply with a line: SOURCES: <the id or ids you used>
5. If the facts above do not answer the question, do NOT guess. Reply exactly:
   I don't have reliable information about that. I'd rather not guess and send you the wrong way. ${ESCALATION[tier]}
   SOURCES: none

Rule 5 is the most important rule. Saying you don't know is always better than guessing.`;
}

function parseSources(text) {
  const m = text.match(/^\s*SOURCES:\s*(.*)$/im);
  if (!m) return { answer: text.trim(), sources: [], wellFormed: false };
  const raw = m[1].trim();
  const sources =
    raw.toLowerCase() === 'none'
      ? []
      : raw.split(/[,\s]+/).map((s) => s.trim().replace(/[.\]]+$/, '')).filter(Boolean);
  return { answer: text.slice(0, m.index).trim(), sources, wellFormed: true };
}

/** Reject model output that drifted off its sources before a user ever sees it. */
function validate(parsed, matches) {
  const valid = new Set(matches.map((m) => m.entry.id));
  if (!parsed.answer || parsed.answer.length < 2) return { ok: false, reason: 'empty answer' };
  for (const id of parsed.sources) {
    if (!valid.has(id)) return { ok: false, reason: `cited unknown source "${id}"` };
  }
  const isRefusal = /don't have reliable information/i.test(parsed.answer);
  if (!isRefusal && parsed.sources.length === 0) {
    return { ok: false, reason: 'substantive answer cites nothing' };
  }
  if (/--- (END )?FACTS ---|^RULES:/im.test(parsed.answer)) {
    return { ok: false, reason: 'leaked prompt scaffolding' };
  }
  return { ok: true };
}

// ── Main entry point ─────────────────────────────────────────────────
/**
 * Answer one support question.
 * @param {string} question
 * @param {{tier:string, history?:Array}} opts
 */
async function ask(question, { tier = SINGLE_TIER, history = [] } = {}) {
  const q = String(question || '').trim();
  if (!q) {
    return { answer: 'What can I help you with?', sources: [], route: 'empty', confidence: 0, matches: [], warnings: [] };
  }

  // ── "Reply with the number" ────────────────────────────────────────
  // The suggestions route tells the user to answer with a number, and until
  // now nothing implemented that: typing "2" fell through to search, matched
  // nothing, and produced a refusal. The bot was breaking a promise it made in
  // its own text, on the single most likely next action a user could take.
  const picked = q.match(/^\s*(?:option\s*)?#?\s*([1-9]\d?)\s*[.)]?\s*$/i);
  if (picked) {
    const lastOffer = [...(history || [])].reverse()
      .find((m) => m && m.role === 'assistant' && Array.isArray(m.sources) && m.sources.length);
    if (lastOffer) {
      const id = lastOffer.sources[Number(picked[1]) - 1];
      const entry = id && loadKB().entries.find((e) => e.id === id
        && ANSWERABLE_AUDIENCES.includes(e.audience));
      if (entry) {
        return {
          answer: entry.short || entry.answer,
          detail: entry.short && entry.short !== entry.answer ? entry.answer : null,
          sources: [entry.id],
          route: 'verbatim',
          confidence: 1,
          matches: [],
          warnings: [],
        };
      }
      return {
        answer: `I only offered ${lastOffer.sources.length} option${lastOffer.sources.length === 1 ? '' : 's'}. ` +
                `Pick a number from that list, or just describe the problem in your own words.`,
        sources: [], route: 'clarify', confidence: 0, matches: [], warnings: [],
      };
    }
    return {
      answer: "I don't have a list open to pick from. Tell me what's happening and I'll help.",
      sources: [], route: 'clarify', confidence: 0, matches: [], warnings: [],
    };
  }

  // ── Exact question match ───────────────────────────────────────────
  // If someone asks a question the KB literally contains — which is exactly
  // what happens when they copy one of our own suggestions — answer it. Word
  // scoring alone got this wrong: an exact match scored below the verbatim
  // threshold purely because a larger corpus dilutes the score, so we offered
  // the user their own question back as a suggestion.
  const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const qn = norm(q);
  if (qn.length >= 8) {
    const exact = loadKB().entries.find(
      (e) => ANSWERABLE_AUDIENCES.includes(e.audience) && norm(e.question) === qn);
    if (exact) {
      return {
        answer: exact.short || exact.answer,
        detail: exact.short && exact.short !== exact.answer ? exact.answer : null,
        sources: [exact.id],
        route: 'verbatim',
        confidence: 1,
        matches: [],
        warnings: [],
      };
    }
  }

  // Safety first. Users paste credentials into support chats constantly, and by
  // the time we see it the message is already in transit — tell them to rotate.
  const credential = detectCredential(q);
  if (credential) {
    return {
      answer:
        `Before anything else: it looks like you included ${credential} in that message. ` +
        `Please change it now, and don't share it in a support chat — I don't need it and it may be stored in this conversation.\n\n` +
        `Once you've changed it, describe the problem again without the ${credential} and I'll help.`,
      sources: [],
      route: 'credential-guard',
      confidence: 0,
      matches: [],
      warnings: ['user shared a credential'],
    };
  }

  const { index } = getIndex(tier);

  // Short follow-ups ("why?", "still broken") carry no searchable terms. Blend
  // in the previous user turn so retrieval has something to work with.
  const lastUser = [...history].reverse().find((m) => m.role === 'user');
  const searchQuery = q.split(/\s+/).length <= 4 && lastUser ? `${lastUser.content} ${q}` : q;

  const matches = search(index, searchQuery, 4);
  const top = matches[0];
  const confidence = top ? top.confidence : 0;
  const warnings = [];

  // Three independent gates. Search always returns *something*, so a single
  // relative threshold is not enough — an off-topic question that hits one
  // incidental word can still rank first among weak options.
  const gated =
    !top ||
    confidence < THRESHOLDS.GROUNDED ||
    top.coverage < THRESHOLDS.MIN_COVERAGE ||
    top.score < THRESHOLDS.MIN_SCORE ||
    top.unknownRatio > THRESHOLDS.MAX_UNKNOWN;

  // Some questions are outside what this knowledge base can EVER answer, no
  // matter how well the words happen to match. The KB is mined from source
  // code, so it describes what the product does today - it cannot know
  // roadmap, pricing, or how we compare to a competitor. Lexical search will
  // happily match "Juniper switches" against switch entries and look
  // confident, so intent still has the final say — but only once retrieval has
  // had its turn. An intent rule works on the shape of a sentence and cannot
  // tell "compare us to NetBox" from "compare these two racks"; a verified
  // entry that clears the verbatim bar can, and it wins.
  const outOfScope = detectOutOfScope(q);
  const documented =
    top &&
    top.confidence >= THRESHOLDS.DIRECT &&
    top.coverage >= THRESHOLDS.MIN_COVERAGE &&
    top.matchedTerms >= THRESHOLDS.MIN_TERMS_FOR_DIRECT &&
    top.unknownRatio <= THRESHOLDS.MAX_UNKNOWN;
  if (outOfScope && !documented) {
    return {
      answer: outOfScope.reply,
      sources: [],
      route: 'out-of-scope',
      confidence: 0,
      matches: [],
      warnings: [`out of scope: ${outOfScope.kind}`],
    };
  }

  // Before refusing — or before answering with a weak match — check whether a
  // GOOD answer exists that this caller simply is not cleared to see. Telling a
  // technician "that is an admin screen" is a real answer; handing them an
  // unrelated entry because it was the best thing in their tier is not.
  if (false) {   // tiering removed — see ANSWERABLE_AUDIENCES
    const full = search(getFullIndex(), searchQuery, 1)[0];
    const bestVisible = top ? top.confidence : 0;
    if (
      full &&
      full.entry.audience !== 'end-user' &&
      full.confidence >= THRESHOLDS.DIRECT &&
      // Same quality bar as answering — otherwise a vague query clears the
      // gap against an even weaker in-tier match and is wrongly told it
      // needs admin access.
      full.coverage >= THRESHOLDS.MIN_COVERAGE &&
      full.matchedTerms >= THRESHOLDS.MIN_TERMS_FOR_DIRECT &&
      full.unknownRatio <= THRESHOLDS.MAX_UNKNOWN &&
      full.confidence - bestVisible >= 0.15
    ) {
      return {
        answer:
          `That's part of ${featureAreaOf(full.entry)}, which needs administrator access — so I can't walk you through it here.\n\n` +
          `Your RackTrack administrator can help, or can give you access if you need it.`,
        sources: [],
        route: 'needs-access',
        confidence: 0,
        matches: [],
        warnings: [`restricted answer exists (${full.entry.id}, conf ${full.confidence})`],
      };
    }
  }

  if (gated) {
    return {
      answer: `I don't have reliable information about that. I'd rather not guess and send you the wrong way. ${ESCALATION[tier]}`,
      sources: [],
      route: 'refusal',
      confidence,
      // Carried even though nothing here is shown to the user: these are the
      // entries that ALMOST answered, and they are the whole value of the
      // refusal log. Callers strip `matches` before responding.
      matches: summarize(matches),
      warnings,
    };
  }

  const clearWinner = (top.margin == null ? 1 : top.margin) >= THRESHOLDS.MIN_MARGIN_FOR_DIRECT;

  if (
    confidence >= THRESHOLDS.DIRECT &&
    top.matchedTerms >= THRESHOLDS.MIN_TERMS_FOR_DIRECT &&
    clearWinner
  ) {
    // Lead with the short answer. A technician on a phone in a cold aisle reads
    // the first line or two; the full text stays available behind `detail` for
    // anyone who taps for more. Both are the same verified text.
    return {
      answer: top.entry.short || top.entry.answer,
      detail: top.entry.short && top.entry.short !== top.entry.answer ? top.entry.answer : null,
      sources: [top.entry.id],
      route: 'verbatim',
      confidence,
      matches: summarize(matches),
      warnings,
    };
  }

  // Ambiguous. Try the local model, grounded strictly in the matched entries.
  const avail = await llmAvailable();
  if (!avail.ok) {
    return {
      answer: [
        "I'm not certain which issue you're hitting. Does one of these match?",
        '',
        ...matches.map((m, i) => `${i + 1}. ${m.entry.question}`),
        '',
        "Reply with the number and I'll walk you through it.",
      ].join('\n'),
      sources: matches.map((m) => m.entry.id),
      route: 'suggestions',
      confidence,
      matches: summarize(matches),
      warnings,
    };
  }

  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [
          { role: 'system', content: buildPrompt(matches, tier) },
          ...history.slice(-4),
          { role: 'user', content: q },
        ],
        stream: false,
        // temperature 0: the same question must give the same answer every
        // time, or the bot is untestable — and untestable means unverifiable.
        options: { temperature: 0, top_p: 1, num_predict: 500, num_ctx: 8192 },
      }),
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);

    const body = await res.json();
    const text = body && body.message && body.message.content ? body.message.content.trim() : '';
    if (!text) throw new Error('empty response');

    const parsed = parseSources(text);
    const check = validate(parsed, matches);
    if (!check.ok) {
      warnings.push(`model output rejected: ${check.reason}`);
      return {
        answer: top.entry.short || top.entry.answer,
        detail: top.entry.short && top.entry.short !== top.entry.answer ? top.entry.answer : null,
        sources: [top.entry.id],
        route: 'grounded-rejected',
        confidence,
        matches: summarize(matches),
        warnings,
      };
    }

    // The model declining is a refusal, whichever route produced it. Report
    // the outcome, not the machinery that reached it.
    const modelRefused = /don't have reliable information/i.test(parsed.answer);

    return {
      answer: parsed.answer,
      sources: parsed.sources,
      route: modelRefused ? 'refusal' : 'grounded',
      confidence,
      matches: summarize(matches),
      warnings,
    };
  } catch (err) {
    warnings.push(`model error: ${err.message}`);
    logger?.warn?.(`[support_bot] model fallback: ${err.message}`);
    return {
      answer: top.entry.short || top.entry.answer,
      detail: top.entry.short && top.entry.short !== top.entry.answer ? top.entry.answer : null,
      sources: [top.entry.id],
      route: 'grounded-error',
      confidence,
      matches: summarize(matches),
      warnings,
    };
  }
}

/** Human-readable feature area for an entry, for access-denied messages. */
function featureAreaOf(entry) {
  if (entry.category) return `the ${entry.category} area`;
  const nice = {
    admin: 'the administration area', integrations: 'connected systems',
    account: 'team and account settings',
  };
  return nice[entry.domain] || 'an administrator-only area';
}

function summarize(matches) {
  return matches.map((m) => ({
    id: m.entry.id,
    question: m.entry.question,
    confidence: m.confidence,
    // Raw BM25 score alongside the normalized confidence: when a refusal is
    // triaged later, "nothing scored above 2" and "three entries scored 11 and
    // still lost on coverage" are different KB problems with different fixes.
    score: Math.round(m.score * 100) / 100,
  }));
}

module.exports = {
  ask,
  warmup,
  tierForRole,
  llmAvailable,
  THRESHOLDS,
  // exported for tests
  _internals: { search, buildIndex, tokenize, detectCredential, detectOutOfScope, validate, parseSources },
};
