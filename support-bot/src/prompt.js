/**
 * Prompt construction for the local model.
 *
 * Written for an 8B-class open model, which is a different job from prompting
 * a frontier model. Three rules that matter here:
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
    .map(({ entry }, i) => {
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
4. End your reply with a line: SOURCES: <the exact ID line of the fact you used, e.g. SOURCES: ${matches[0] ? matches[0].entry.id : 'ABC-001'}>
5. If the facts above do not answer the question, do NOT guess. Reply exactly:
   I don't have reliable information about that. I'd rather not guess and send you the wrong way. ${ESCALATION[tier]}
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
      ESCALATION[tier],
    sources: [],
  }
}

/** Split the trailing SOURCES line off a model answer. */
export function parseSources(text) {
  const match = text.match(/^\s*SOURCES:\s*(.*)$/im)
  if (!match) return { answer: text.trim(), sources: [], wellFormed: false }

  const raw = match[1].trim()
  const sources =
    raw.toLowerCase() === 'none'
      ? []
      : raw
          .split(/[,\s]+/)
          .map((s) => s.trim().replace(/[.\]]+$/, ''))
          .filter(Boolean)

  return { answer: text.slice(0, match.index).trim(), sources, wellFormed: true }
}
