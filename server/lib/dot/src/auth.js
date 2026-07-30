/**
 * Bearer-token authentication and tier derivation.
 *
 * Contract §5: "Tier is derived from the authenticated session server-side.
 * `?tier=` is honoured only when `ALLOW_TIER_OVERRIDE=true` (development),
 * which is never set in production." Tier isolation is the whole security
 * model — everything above end-user, including entries that name credential
 * file paths, is reachable only through a configured token.
 *
 * Tokens are compared as SHA-256 digests with timingSafeEqual, and every
 * configured digest is compared on every attempt: no early exit, so response
 * time carries no information about how much of a guess was right.
 */

import { createHash, timingSafeEqual } from 'node:crypto'
import { config } from './config.js'

/**
 * Pull a bearer token out of the Authorization header.
 *
 * Three outcomes, and the middle one is the point: a header that is present but
 * is not a well-formed Bearer credential is a rejection, not an anonymous
 * request. Falling through to the anonymous path would let a truncated token, a
 * duplicated header or the wrong scheme quietly answer at end-user tier instead
 * of telling the caller the credential was not accepted.
 *
 * A header that is empty or whitespace-only counts as absent — proxies emit
 * that — but anything with content in it has to parse.
 */
function bearerFrom(req) {
  const header = req.headers?.authorization
  if (typeof header !== 'string' || !header.trim()) return { present: false, token: null }
  const m = /^Bearer[ ]+(\S+)$/i.exec(header.trim())
  return m ? { present: true, token: m[1] } : { present: true, token: null }
}

/**
 * Resolve a presented token to its configured entry.
 * Returns null for "no match" without revealing which token was close.
 */
function lookup(token) {
  const presented = createHash('sha256').update(token).digest()
  let hit = null
  for (const entry of config.tokens) {
    // Digests are always 32 bytes, so timingSafeEqual can never throw here.
    if (timingSafeEqual(presented, entry.digest)) hit = entry
  }
  return hit
}

/**
 * Work out who is calling, without touching the response.
 *
 * Two tiers are tracked and they are not interchangeable. `credentialTier` is
 * what the presented token grants and never moves; `tier` is what the request
 * is scored against and is the only one a development `?tier=` override may
 * touch. Admin-only endpoints test `credentialTier`, so widening KB visibility
 * for the console can never also hand out the operator dashboard.
 *
 * @returns {{ok: true, auth: object} | {ok: false, status: number, error: string, challenge?: string}}
 */
export function resolveAuth(req) {
  const { present, token } = bearerFrom(req)
  let auth

  if (present) {
    const entry = token ? lookup(token) : null
    if (!entry) {
      return { ok: false, status: 401, error: 'unauthorized', challenge: 'Bearer realm="racktrack", error="invalid_token"' }
    }
    auth = { tier: entry.tier, credentialTier: entry.tier, credentialed: true, tokenId: entry.id }
  } else if (config.allowAnonymous) {
    // Anonymous callers are end-user and nothing else, ever.
    auth = { tier: config.anonymousTier, credentialTier: null, credentialed: false, tokenId: null }
  } else {
    return { ok: false, status: 401, error: 'unauthorized', challenge: 'Bearer realm="racktrack"' }
  }

  if (config.allowTierOverride) {
    const wanted = req.query?.tier
    if (typeof wanted === 'string' && wanted) {
      if (!config.callerTiers.includes(wanted)) {
        return { ok: false, status: 400, error: 'invalid tier' }
      }
      // Retrieval tier only. credentialTier is deliberately left alone.
      auth = { ...auth, tier: wanted, overridden: true }
    }
  }

  return { ok: true, auth }
}

/** Express middleware: attach `req.auth` or reject. */
export function authenticate(req, res, next) {
  const outcome = resolveAuth(req)
  if (!outcome.ok) {
    if (outcome.challenge) res.set('WWW-Authenticate', outcome.challenge)
    return res.status(outcome.status).json({ error: outcome.error, requestId: req.id })
  }
  req.auth = outcome.auth
  next()
}

/** Express middleware: admin token required — never satisfied by a tier override. */
export function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next()
  if (!req.auth?.credentialed) {
    res.set('WWW-Authenticate', 'Bearer realm="racktrack"')
    return res.status(401).json({ error: 'admin credential required', requestId: req.id })
  }
  return res.status(403).json({ error: 'forbidden', requestId: req.id })
}

/**
 * True when the caller holds an admin *token*.
 *
 * Deliberately reads `credentialTier` rather than `tier`: with
 * ALLOW_TIER_OVERRIDE=true a holder of any valid token can ask for `?tier=admin`,
 * and that must widen retrieval only. Testing `tier` here would turn the
 * development switch into a promotion to the operator dashboard.
 */
export function isAdmin(req) {
  return Boolean(req.auth?.credentialed && req.auth.credentialTier === 'admin')
}
