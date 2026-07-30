/**
 * Boot-time environment parsing for the HTTP layer.
 *
 * Every security-relevant decision the server makes is resolved once, here, so
 * a misconfiguration is a loud boot failure instead of a request that quietly
 * runs under weaker rules than the operator believes. Nothing else in the
 * server reads process.env at request time.
 *
 * Parsing never throws: problems accumulate in `config.errors` and the entry
 * point decides how to die. That keeps the failure message complete (all
 * problems at once) rather than one-per-restart.
 */

import { randomBytes, createHash } from 'node:crypto'
import { TIERS } from './kb.js'

const CALLER_TIERS = Object.keys(TIERS)
const LOG_LEVELS = ['error', 'warn', 'info', 'debug']
const QUESTION_MODES = ['off', 'redacted', 'full']

const errors = []
const warnings = []

/** Truthy env parsing that is explicit about what counts as "on". */
function bool(name, fallback) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const v = String(raw).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(v)) return true
  if (['0', 'false', 'no', 'off'].includes(v)) return false
  errors.push(`${name} must be true or false (got "${raw}")`)
  return fallback
}

function int(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) {
    errors.push(`${name} must be an integer between ${min} and ${max} (got "${raw}")`)
    return fallback
  }
  return n
}

function oneOf(name, fallback, allowed) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const v = String(raw).trim().toLowerCase()
  if (!allowed.includes(v)) {
    errors.push(`${name} must be one of ${allowed.join('|')} (got "${raw}")`)
    return fallback
  }
  return v
}

/**
 * AUTH_TOKENS="tok1:admin,tok2:end-user".
 *
 * Tokens are kept as SHA-256 digests only: the plaintext is not retained
 * anywhere in the process, so a heap dump or an accidental config log cannot
 * hand out live credentials. Lookup hashes the presented token and compares
 * digests, which is also why comparison can be constant-time (see auth.js).
 */
function parseAuthTokens() {
  const raw = process.env.AUTH_TOKENS || ''
  const out = []
  if (!raw.trim()) return out

  raw.split(',').forEach((pair, i) => {
    const text = pair.trim()
    if (!text) return
    const sep = text.lastIndexOf(':')
    if (sep < 1) {
      errors.push(`AUTH_TOKENS entry ${i + 1} is not "token:tier"`)
      return
    }
    const token = text.slice(0, sep).trim()
    const tier = text.slice(sep + 1).trim()
    if (token.length < 16) {
      errors.push(`AUTH_TOKENS entry ${i + 1} has a token shorter than 16 characters`)
      return
    }
    if (!CALLER_TIERS.includes(tier)) {
      errors.push(`AUTH_TOKENS entry ${i + 1} has tier "${tier}"; expected one of ${CALLER_TIERS.join('|')}`)
      return
    }
    out.push({
      // Short, non-reversible label for logs and metrics.
      id: createHash('sha256').update(token).digest('hex').slice(0, 8),
      digest: createHash('sha256').update(token).digest(),
      tier,
    })
  })
  return out
}

function parseOrigins() {
  const raw = process.env.CORS_ORIGINS || ''
  if (!raw.trim()) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((origin) => {
      try {
        const u = new URL(origin)
        if (u.origin !== origin) throw new Error('not a bare origin')
        return true
      } catch {
        errors.push(`CORS_ORIGINS contains "${origin}", which is not a bare origin like https://ops.example.com`)
        return false
      }
    })
}

const nodeEnv = (process.env.NODE_ENV || 'development').trim().toLowerCase()
const isProduction = nodeEnv === 'production'

// Bind loopback unless the operator opts in (contract §8). A test harness that
// defaults to 0.0.0.0 is an accidental public service.
const host = process.env.HOST || '127.0.0.1'
const isLoopback = host === '127.0.0.1' || host === 'localhost' || host === '::1'

const tokens = parseAuthTokens()
// Contract §8 opens with "Auth required on every endpoint except /api/health",
// so anonymous access is a local-demo affordance and the default has to flip
// with the environment rather than be remembered by the operator.
const allowAnonymous = bool('ALLOW_ANONYMOUS', !isProduction)
const allowTierOverride = bool('ALLOW_TIER_OVERRIDE', false)

// Production must not be reachable without a credential, and must not let the
// client pick its own tier — contract §5: "?tier= is honoured only when
// ALLOW_TIER_OVERRIDE=true (development), which is never set in production."
if (isProduction) {
  if (tokens.length === 0) errors.push('AUTH_TOKENS is required when NODE_ENV=production (format: "token:tier,token:tier")')
  if (allowTierOverride) errors.push('ALLOW_TIER_OVERRIDE must not be true when NODE_ENV=production')
  if (allowAnonymous) errors.push('ALLOW_ANONYMOUS must not be true when NODE_ENV=production (contract §8 requires a credential on every endpoint except /api/health)')
} else if (allowAnonymous && !isLoopback) {
  // Off-loopback development is how a demo box ends up on a corporate network
  // answering to anyone; loud enough to notice, not fatal.
  warnings.push(`ALLOW_ANONYMOUS=true with HOST=${host}: the knowledge base answers to the network without a credential`)
}

/**
 * With no AUTH_TOKENS outside production the console still has to be usable,
 * including the admin-only dashboard. A random per-boot admin token is printed
 * to stdout at startup: it grants admin for this process only and cannot be
 * guessed, which is strictly better than the old `?tier=admin`.
 */
const devAdminToken = !isProduction && tokens.length === 0 ? randomBytes(18).toString('base64url') : null
if (devAdminToken) {
  tokens.push({
    id: createHash('sha256').update(devAdminToken).digest('hex').slice(0, 8),
    digest: createHash('sha256').update(devAdminToken).digest(),
    tier: 'admin',
  })
}

export const config = Object.freeze({
  nodeEnv,
  isProduction,
  errors,
  warnings,

  // --- network ---
  host,
  port: int('PORT', 4545, { min: 1, max: 65535 }),
  shutdownTimeoutMs: int('SHUTDOWN_TIMEOUT_MS', 10000, { min: 100, max: 120000 }),
  // Only trust X-Forwarded-For when something in front is known to set it;
  // otherwise a client spoofs the header and each request looks like a new IP.
  trustProxy: bool('TRUST_PROXY', false),

  // --- auth ---
  tokens: Object.freeze(tokens),
  devAdminToken,
  allowAnonymous,
  allowTierOverride,
  anonymousTier: 'end-user',
  callerTiers: Object.freeze(CALLER_TIERS),

  // --- logging ---
  logLevel: oneOf('LOG_LEVEL', 'info', LOG_LEVELS),
  logQuestions: oneOf('LOG_QUESTIONS', 'redacted', QUESTION_MODES),

  // --- headers / CORS ---
  corsOrigins: Object.freeze(parseOrigins()),
  enableHsts: bool('ENABLE_HSTS', false),

  // --- rate limits (token bucket: burst = bucket size, perMin = refill rate) ---
  rate: Object.freeze({
    chat: { burst: int('RATE_LIMIT_CHAT_BURST', 5, { min: 1, max: 10000 }), perMin: int('RATE_LIMIT_CHAT_PER_MIN', 20, { min: 1, max: 100000 }) },
    feedback: { burst: int('RATE_LIMIT_FEEDBACK_BURST', 5, { min: 1, max: 10000 }), perMin: int('RATE_LIMIT_FEEDBACK_PER_MIN', 12, { min: 1, max: 100000 }) },
    global: { burst: int('RATE_LIMIT_GLOBAL_BURST', 60, { min: 1, max: 100000 }), perMin: int('RATE_LIMIT_GLOBAL_PER_MIN', 240, { min: 1, max: 1000000 }) },
    sweepMs: int('RATE_LIMIT_SWEEP_MS', 60000, { min: 1000, max: 3600000 }),
  }),

  // --- request limits ---
  bodyLimitBytes: int('BODY_LIMIT_BYTES', 32 * 1024, { min: 1024, max: 1024 * 1024 }),
  maxMessageChars: int('MAX_MESSAGE_CHARS', 2000, { min: 1, max: 20000 }),
  maxHistoryTurns: int('MAX_HISTORY_TURNS', 6, { min: 0, max: 20 }),
  maxHistoryChars: int('MAX_HISTORY_CHARS', 2000, { min: 1, max: 20000 }),

  // --- feedback log ---
  feedbackEnabled: bool('FEEDBACK_ENABLED', true),
  feedbackMaxBytes: int('FEEDBACK_MAX_BYTES', 5 * 1024 * 1024, { min: 4096 }),
  feedbackMaxQuestionChars: int('FEEDBACK_MAX_QUESTION_CHARS', 500, { min: 1, max: 5000 }),

  // --- observability buffer ---
  recentBufferSize: int('RECENT_BUFFER_SIZE', 50, { min: 0, max: 1000 }),
})
