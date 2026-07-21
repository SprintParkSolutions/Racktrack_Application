/**
 * The hybrid router.
 *
 * Three routes, in descending order of safety:
 *
 *   verbatim  - search is confident. Return the verified answer word for word.
 *               Zero hallucination risk. Costs nothing. Most traffic lands here.
 *   grounded  - search found relevant entries but no clear winner. The local
 *               model phrases an answer using ONLY those entries, and the
 *               output is validated before the user sees it.
 *   refusal   - nothing relevant matched. Say so and escalate. Never guess.
 *
 * Route selection is by search confidence, not by model judgment, so it is
 * deterministic and testable.
 */

import { loadKB, filterByTier } from './kb.js'
import { buildIndex, search, THRESHOLDS } from './search.js'
import { buildSystem, verbatimAnswer, refusal, parseSources } from './prompt.js'
import * as llm from './llm.js'

const indexes = new Map()

/** Build (once) and return the tier-scoped search index. */
function getIndex(tier) {
  if (!indexes.has(tier)) {
    const kb = loadKB()
    const visible = filterByTier(kb.entries, tier)
    indexes.set(tier, { index: buildIndex(visible), count: visible.length })
  }
  return indexes.get(tier)
}

/** Warm indexes for every tier at startup so the first user request is fast. */
export function warmup() {
  const out = {}
  for (const tier of ['end-user', 'admin']) out[tier] = getIndex(tier).count
  return out
}

/**
 * Answer one question.
 *
 * @param {string} question
 * @param {object} opts
 * @param {'end-user'|'admin'} opts.tier
 * @param {Array<{role,content}>} opts.history - prior turns, for follow-ups
 * @returns {Promise<{answer, sources, route, confidence, matches, warnings}>}
 */
export async function ask(question, { tier = 'end-user', history = [] } = {}) {
  const q = String(question || '').trim()
  if (!q) {
    return { answer: 'What can I help you with?', sources: [], route: 'empty', confidence: 0, matches: [], warnings: [] }
  }

  // Safety guard, before anything else. Users in a hurry paste credentials into
  // support chats constantly. Never let that pass silently - the message is
  // already logged by the time we see it, so the honest response is to tell
  // them to rotate it.
  const credential = detectCredential(q)
  if (credential) {
    return {
      answer:
        `Before anything else: it looks like you included ${credential} in that message. ` +
        `Please change it now, and don't share it in a support chat - I don't need it and it may be stored in this conversation.\n\n` +
        `Once you've changed it, describe the problem again without the ${credential} and I'll help.`,
      sources: [],
      route: 'credential-guard',
      confidence: 0,
      matches: [],
      warnings: ['user shared a credential'],
    }
  }

  // Some questions are outside what this knowledge base can EVER answer, no
  // matter how well the words happen to match. The KB is mined from source
  // code, so it describes what the product does today - it cannot know
  // roadmap, pricing, or how we compare to a competitor. Lexical search will
  // happily match "Juniper switches" against switch entries and look
  // confident, so these are caught by intent before scoring runs.
  const outOfScope = detectOutOfScope(q)
  if (outOfScope) {
    return {
      answer: outOfScope.reply,
      sources: [],
      route: 'out-of-scope',
      confidence: 0,
      matches: [],
      warnings: [`out of scope: ${outOfScope.kind}`],
    }
  }

  const { index } = getIndex(tier)

  // Follow-ups ("why?", "it still doesn't work") carry no searchable terms of
  // their own. Blend in the previous user turn so search has something to work with.
  const lastUser = [...history].reverse().find((m) => m.role === 'user')
  const searchQuery = q.split(/\s+/).length <= 4 && lastUser ? `${lastUser.content} ${q}` : q

  const matches = search(index, searchQuery, { limit: 4 })
  const top = matches[0]
  const confidence = top?.confidence ?? 0
  const warnings = []

  // --- Route 1: nothing relevant. Refuse. -------------------------------
  // Three independent gates. Search always returns *something*, so a single
  // relative-score threshold is not enough - an off-topic question that hits
  // one incidental word can still rank first among weak options. Coverage and
  // the absolute floor catch exactly that case.
  const gated =
    !top ||
    confidence < THRESHOLDS.GROUNDED ||
    top.coverage < THRESHOLDS.MIN_COVERAGE ||
    top.score < THRESHOLDS.MIN_SCORE ||
    top.unknownRatio > THRESHOLDS.MAX_UNKNOWN

  if (gated) {
    return { ...refusal(tier), route: 'refusal', confidence, matches: [], warnings }
  }

  // --- Route 2: confident single match. Answer verbatim, no model. ------
  if (confidence >= THRESHOLDS.DIRECT && top.matchedTerms >= THRESHOLDS.MIN_TERMS_FOR_DIRECT) {
    return {
      ...verbatimAnswer(top.entry),
      route: 'verbatim',
      confidence,
      matches: summarize(matches),
      warnings,
    }
  }

  // --- Route 3: relevant but ambiguous. Ground the model in the matches. -
  const availability = await llm.isAvailable()

  if (!availability.ok) {
    // No model. Rather than guessing or failing, offer the candidate entries
    // and let the user pick. Still zero hallucination risk.
    warnings.push(`local model unavailable: ${availability.reason}`)
    return {
      answer: buildSuggestionAnswer(matches, tier),
      sources: matches.map((m) => m.entry.id),
      route: 'suggestions',
      confidence,
      matches: summarize(matches),
      warnings,
    }
  }

  try {
    const system = buildSystem(matches, tier)
    const turns = [...history.slice(-4), { role: 'user', content: q }]
    const { text } = await llm.generate(system, turns)
    const parsed = parseSources(text)

    const validation = validate(parsed, matches)
    if (!validation.ok) {
      // The model went off-script. Do not show the user unvalidated output -
      // fall back to the verified text of the best match instead.
      warnings.push(`model output rejected: ${validation.reason}`)
      return {
        ...verbatimAnswer(top.entry),
        route: 'grounded-rejected',
        confidence,
        matches: summarize(matches),
        warnings,
      }
    }

    return {
      answer: parsed.answer,
      sources: parsed.sources,
      route: 'grounded',
      confidence,
      matches: summarize(matches),
      warnings,
    }
  } catch (err) {
    warnings.push(`model error: ${err.message}`)
    return {
      ...verbatimAnswer(top.entry),
      route: 'grounded-error',
      confidence,
      matches: summarize(matches),
      warnings,
    }
  }
}

/**
 * Categories of question this knowledge base structurally cannot answer.
 *
 * These are not "we happen to be missing an entry" gaps that could be filled
 * later - they are questions about facts that do not live in source code at
 * all. Answering them requires a person, so route straight to one rather than
 * letting retrieval find a superficially-similar entry.
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
      re: /\b(?:better than|worse than|compared? (?:to|with)|versus|\bvs\.?\s|competitor|alternative to)\b/,
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

/**
 * Detect a credential the user has volunteered. Returns a human label for what
 * was spotted, or null.
 *
 * Deliberately tuned to catch the obvious cases without firing on ordinary
 * questions like "I forgot my password". The signal is a credential being
 * *stated*, not *mentioned*.
 */
function detectCredential(text) {
  // Shapes distinctive enough to be conclusive on their own.
  const unambiguous = [
    { re: /\b(?:sk|pk|ghp|gho|xox[bpsa])[-_][A-Za-z0-9]{16,}/, label: 'an API token' },
    { re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, label: 'a session token' },
  ]
  for (const { re, label } of unambiguous) {
    if (re.test(text)) return label
  }

  // Labelled forms: "my password is X". The label alone is not enough - users
  // constantly say "my password is wrong", which mentions a credential without
  // stating one. Only fire when the value itself looks like a secret.
  const labelled = [
    { re: /\b(?:my\s+)?(?:password|passwd|pwd|passphrase)\s*(?:is|:|=)\s*(\S+)/i, label: 'your password' },
    { re: /\b(?:api[\s_-]?key|secret|token|bearer)\s*(?:is|:|=)\s*(\S+)/i, label: 'an API key or token' },
    { re: /\bcommunity\s*(?:string)?\s*(?:is|:|=)\s*(\S+)/i, label: 'an SNMP community string' },
  ]
  for (const { re, label } of labelled) {
    const m = text.match(re)
    if (m && looksLikeSecret(m[1])) return label
  }

  return null
}

/**
 * Does this token look like an actual secret rather than an English word?
 * Real credentials mix character classes; words like "wrong", "expired", or
 * "incorrect" do not.
 */
function looksLikeSecret(value) {
  const v = String(value).replace(/[.,!?;:'"]+$/, '')
  if (v.length < 6) return false

  const hasLetter = /[A-Za-z]/.test(v)
  const hasDigit = /[0-9]/.test(v)
  const hasSymbol = /[^A-Za-z0-9]/.test(v)
  const hasMixedCase = /[a-z]/.test(v) && /[A-Z]/.test(v)

  // Two or more distinguishing signals means it is almost certainly not a word.
  const signals = [hasDigit && hasLetter, hasSymbol, hasMixedCase, v.length >= 16].filter(Boolean).length
  return signals >= 2
}

/**
 * Guardrail on model output. Cheap checks that catch the common small-model
 * failure modes before the user ever sees the text.
 */
function validate(parsed, matches) {
  const validIds = new Set(matches.map((m) => m.entry.id))

  if (!parsed.answer || parsed.answer.length < 2) {
    return { ok: false, reason: 'empty answer' }
  }

  // A cited id that was not in the entries we supplied means the model invented
  // a source, which is a strong signal it invented the content too.
  for (const id of parsed.sources) {
    if (!validIds.has(id)) return { ok: false, reason: `cited unknown source "${id}"` }
  }

  // A substantive answer with no sources at all is ungrounded by definition.
  const isRefusal = /don't have reliable information/i.test(parsed.answer)
  if (!isRefusal && parsed.sources.length === 0) {
    return { ok: false, reason: 'substantive answer with no sources cited' }
  }

  // Small models sometimes leak the scaffolding.
  if (/--- (END )?FACTS ---|^RULES:|system prompt/im.test(parsed.answer)) {
    return { ok: false, reason: 'leaked prompt scaffolding' }
  }

  return { ok: true }
}

/** Menu fallback when there is no model available to disambiguate. */
function buildSuggestionAnswer(matches, tier) {
  const lines = [
    tier === 'admin'
      ? "I found a few things that might be relevant - which one sounds closest?"
      : "I'm not certain which issue you're hitting. Does one of these match?",
    '',
    ...matches.map((m, i) => `${i + 1}. ${m.entry.question}`),
    '',
    'Reply with the number and I\'ll walk you through it.',
  ]
  return lines.join('\n')
}

/** Trim match objects down to what a caller or log actually needs. */
function summarize(matches) {
  return matches.map((m) => ({
    id: m.entry.id,
    question: m.entry.question,
    confidence: m.confidence,
    audience: m.entry.audience,
  }))
}

export { THRESHOLDS }
