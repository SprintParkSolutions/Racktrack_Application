/**
 * Structured JSON logging with a correlation id per request.
 *
 * One line of JSON per event, on stdout for info/debug and stderr for
 * warn/error, so a log shipper needs no parser and a human can still pipe it
 * through jq. Every request-scoped line carries `reqId`, which is also the
 * only detail an error response gives the client — that is what makes an
 * opaque 500 debuggable (contract §8).
 *
 * The question-text policy lives here because it is a logging decision, not a
 * routing one: LOG_QUESTIONS=redacted (default) records a stable hash and a
 * length so repeat questions can be correlated without storing what anyone
 * typed. Nothing else in the server is allowed to write raw question text.
 */

import { createHash, randomUUID } from 'node:crypto'
import { config } from './config.js'

const LEVELS = { error: 10, warn: 20, info: 30, debug: 40 }
const threshold = LEVELS[config.logLevel] ?? LEVELS.info

function emit(level, msg, fields) {
  if (LEVELS[level] > threshold) return
  const line = { ts: new Date().toISOString(), level, msg, ...fields }
  // Values that JSON.stringify cannot represent (Error, BigInt, cycles) must
  // never take the process down from inside a log call.
  let text
  try {
    text = JSON.stringify(line)
  } catch {
    text = JSON.stringify({ ts: line.ts, level, msg, logError: 'unserializable fields' })
  }
  if (level === 'error' || level === 'warn') process.stderr.write(text + '\n')
  else process.stdout.write(text + '\n')
}

export const log = {
  error: (msg, fields) => emit('error', msg, fields),
  warn: (msg, fields) => emit('warn', msg, fields),
  info: (msg, fields) => emit('info', msg, fields),
  debug: (msg, fields) => emit('debug', msg, fields),
}

/** Fresh correlation id; returned to the client and stamped on every log line. */
export function newRequestId() {
  return randomUUID()
}

/**
 * Reduce an Error to loggable fields. Stacks are server-side only — they name
 * file paths and are never part of a response body.
 */
export function errorFields(err) {
  if (!(err instanceof Error)) return { err: String(err) }
  return { err: err.message, errType: err.name, stack: err.stack }
}

/**
 * Apply the LOG_QUESTIONS policy to one piece of user text.
 *
 * Returns null when nothing may be retained, otherwise a display string that
 * is safe to keep in memory, write to a log, or show on the dashboard.
 * `force` = 'off' is used for the credential-guard route, where the raw text
 * is known to contain a secret and must not be stored under any setting
 * (contract §8).
 */
export function redactQuestion(text, { force } = {}) {
  const mode = force || config.logQuestions
  if (mode === 'off') return null
  const s = String(text ?? '')
  if (mode === 'full') return s.slice(0, 500)
  if (!s) return null
  return `#${createHash('sha256').update(s).digest('hex').slice(0, 10)} (${s.length} chars)`
}
