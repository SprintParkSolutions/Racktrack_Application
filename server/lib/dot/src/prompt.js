/**
 * Prompt construction for the answering model.
 *
 * Written for a small open model, which is a different job from prompting a
 * frontier model. Three rules that matter here:
 *
 *  1. Short and blunt. Long nuanced prompts degrade small models badly.
 *  2. Only the matched entries go in, never the whole knowledge base. Small
 *     models lose the thread in long contexts and start blending entries.
 *  3. The refusal instruction is repeated and placed last, because recency
 *     wins in small models and refusing correctly is the behavior we most
 *     need to hold under pressure.
 */

const TIER_VOICE = {
  'end-user':
    'You are talking to a datacenter technician using the app. Use plain language. No technical jargon. Never discuss servers, code, or internal systems.',
  admin:
    'You are talking to a RackTrack administrator. You may use technical terms and reference admin settings and configuration screens.',
}

const ESCALATION = {
  'end-user': 'Contact your RackTrack administrator with what you were doing when this happened.',
  admin: 'Capture the exact error text and steps to reproduce, then escalate to the engineering team.',
}

/**
 * Build the system prompt for a grounded answer over `matches`.
 * @param {Array} matches - search results, best first
 * @param {'end-user'|'admin'} tier
 */
export function buildSystem(matches, tier) {
  const voice = TIER_VOICE[tier]
  if (!voice) throw new Error(`No prompt configured for tier "${tier}"`)

  const facts = matches
    .map(({ entry }) => {
      const parts = [`ID: ${entry.id}`, `Question: ${entry.question}`, `Answer: ${entry.short || entry.answer}`]
      if (entry.symptoms?.length) parts.push(`Symptoms: ${entry.symptoms.join('; ')}`)
      return parts.join('\n')
    })
    .join('\n\n')

  return `You are the RackTrack support assistant. RackTrack is an app technicians use to identify and audit datacenter racks.

${voice}

Below are the ONLY facts you know. You have no other knowledge about RackTrack.

--- FACTS ---
${facts}
--- END FACTS ---

RULES:
1. Answer using ONLY the facts above. Nothing else.
2. Never invent a number, button name, screen name, error message, or setting that is not written above.
3. Keep it under 60 words. Lead with what to do. Numbered steps if there is more than one.
4. End your reply with a line: SOURCES: <the exact ID of the fact you used, copied character for character, e.g. SOURCES: ${matches[0] ? matches[0].entry.id : 'ABC-001'}>
5. If the facts above do not answer the question, do NOT guess. Reply exactly:
   ${REFUSAL_SENTINEL}
   SOURCES: none

Rule 5 is the most important rule. Saying you don't know is always better than guessing.`
}

/**
 * A verbatim answer, used when search confidence is high enough that the model
 * is not involved at all. This path cannot hallucinate - the text is exactly
 * what a human verified.
 */
export function verbatimAnswer(entry) {
  // Lead with the short answer; keep the full text available behind `detail`.
  const short = entry.short && entry.short.trim()
  return {
    answer: short || entry.answer,
    detail: short && short !== entry.answer ? entry.answer : null,
    sources: [entry.id],
  }
}

/** Refusal used when nothing in the knowledge base matches. */
export function refusal(tier) {
  return {
    answer:
      `I don't have reliable information about that. I'd rather not guess and send you the wrong way. ` +
      ESCALATION[tier] ,
    sources: [],
  }
}

/** Escalation sentence for a tier, for callers composing their own replies. */
export function escalationFor(tier) {
  return ESCALATION[tier] || ESCALATION['end-user']
}

/**
 * Label prefixed to every answer that did not come from the knowledge base.
 *
 * A general answer and a verified answer look identical in a chat window, and
 * users reasonably assume a support bot speaks for the product. Saying which is
 * which is the whole reason the general route is safe to offer at all.
 */
export const GENERAL_LABEL = "That's outside the RackTrack knowledge base, so here's a general answer rather than a verified one:"

/**
 * System prompt for general questions that fall outside the knowledge base.
 *
 * The model answers from its own knowledge, but it is fenced away from the
 * product: anything about RackTrack must come from verified entries, never from
 * a model's impression of what a rack-auditing app probably does
 * (docs/ROUTING-CONTRACT.md §4).
 */
export function buildGeneralSystem(tier) {
  const voice = TIER_VOICE[tier] || TIER_VOICE['end-user']
  return `You are the RackTrack support assistant. The user has asked something that is NOT about RackTrack, and you are also a helpful general assistant.

${voice}

RULES:
1. Answer the question directly, accurately and concisely — under 150 words unless the topic truly needs more.
2. You know NOTHING about RackTrack in this reply. Never state, guess, or imply any RackTrack feature, price, setting, screen, button, limit or release plan. If answering would require a RackTrack fact, say that you'd need to check the product documentation and suggest they ask their RackTrack administrator.
3. Never describe configuration steps for specific network hardware or third-party systems. Point them at that vendor's documentation instead — wrong steps in a live datacenter are expensive.
4. If you are not confident of a fact, say so plainly.
5. Do NOT end with a SOURCES line — this is a general answer, not from the knowledge base.`
}

/** Sentinel token the model outputs when context is insufficient. */
export const REFUSAL_SENTINEL = 'INSUFFICIENT_CONTEXT'

/**
 * Split the trailing SOURCES line off a model answer.
 *
 * The id shape must match every id the knowledge base actually mints, including
 * the `PREFIX-D###` series: a stricter pattern silently discarded correct
 * citations for 159 entries, which then looked like uncited answers to
 * validation and were thrown away.
 */
const ID_PATTERN = /^[A-Z]{2,}-D?\d+$/i

export function parseSources(text) {
  const raw = String(text || '')
  const match = raw.match(/^[ \t]*SOURCES:[ \t]*(.*)$/im)
  if (!match) return { answer: raw.trim(), sources: [], wellFormed: false }

  const listed = match[1].trim()
  const sources =
    listed.toLowerCase() === 'none'
      ? []
      : listed
          .replace(/\bID:\s*/gi, '')
          .split(/[,\s]+/)
          // Small models wrap the list in brackets and end it with a full stop.
          .map((s) => s.trim().replace(/^[[(]+/, '').replace(/[.,;\])]+$/, ''))
          .filter((s) => s && ID_PATTERN.test(s))

  // Remove the SOURCES line wherever it appears rather than truncating at it.
  // A model that leads with its citation used to have its entire answer cut.
  const answer = raw
    .split('\n')
    .filter((line) => !/^[ \t]*SOURCES:/i.test(line))
    .join('\n')
    .trim()

  return { answer, sources, wellFormed: true }
}

export { ID_PATTERN }
