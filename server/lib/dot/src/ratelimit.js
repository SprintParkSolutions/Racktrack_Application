/**
 * Hand-rolled per-caller token bucket. No dependency, no shared store.
 *
 * A bucket holds `burst` tokens and refills at `perMin`/60 per second, so a
 * short burst is fine and a sustained flood is not. `/api/chat` gets the
 * tightest budget because every call can spend a paid LLM key (contract §8).
 *
 * The map is swept on an unref'd interval: a full bucket is indistinguishable
 * from no bucket at all, so idle entries are dropped and one request per
 * spoofed source address cannot grow memory without bound. The timer being
 * unref'd is what lets the process still exit on its own.
 */

import { config } from './config.js'
import { log } from './logger.js'

const limiters = new Set()
let sweeper = null

/** Stable key for the caller: a credential if there is one, else the peer address. */
export function clientKey(req) {
  if (req.auth?.credentialed && req.auth.tokenId) return `tok:${req.auth.tokenId}`
  return `ip:${clientIp(req)}`
}

/**
 * Peer address. X-Forwarded-For is only consulted when TRUST_PROXY says
 * something in front sets it — otherwise any client can mint a fresh identity
 * per request just by varying a header.
 */
export function clientIp(req) {
  if (config.trustProxy) {
    const fwd = req.headers['x-forwarded-for']
    if (typeof fwd === 'string' && fwd.trim()) return normalize(fwd.split(',')[0].trim())
  }
  return normalize(req.socket?.remoteAddress || req.ip || 'unknown')
}

function normalize(addr) {
  // ::ffff:127.0.0.1 and 127.0.0.1 are the same caller; keep one bucket.
  return addr.startsWith('::ffff:') ? addr.slice(7) : addr
}

function startSweeper() {
  if (sweeper) return
  sweeper = setInterval(() => {
    const now = Date.now()
    for (const limiter of limiters) limiter.sweep(now)
  }, config.rate.sweepMs)
  sweeper.unref()
}

/**
 * @param {object} opts
 * @param {string} opts.name      - shows up in the 429 log line
 * @param {number} opts.burst     - bucket size
 * @param {number} opts.perMin    - sustained refill rate per minute
 * @param {(req) => string} [opts.key]
 * @returns {import('express').RequestHandler}
 */
export function createRateLimiter({ name, burst, perMin, key = clientKey }) {
  const buckets = new Map()
  const refillPerMs = perMin / 60000

  const limiter = {
    name,
    buckets,
    sweep(now) {
      for (const [k, b] of buckets) {
        const tokens = Math.min(burst, b.tokens + (now - b.ts) * refillPerMs)
        if (tokens >= burst) buckets.delete(k)
      }
    },
  }
  limiters.add(limiter)
  startSweeper()

  return function rateLimit(req, res, next) {
    const now = Date.now()
    const k = key(req)
    const bucket = buckets.get(k) || { tokens: burst, ts: now }
    bucket.tokens = Math.min(burst, bucket.tokens + (now - bucket.ts) * refillPerMs)
    bucket.ts = now

    if (bucket.tokens < 1) {
      const waitMs = (1 - bucket.tokens) / refillPerMs
      buckets.set(k, bucket)
      res.set('Retry-After', String(Math.max(1, Math.ceil(waitMs / 1000))))
      res.set('RateLimit-Limit', String(burst))
      res.set('RateLimit-Remaining', '0')
      log.warn('rate limited', { reqId: req.id, limiter: name, caller: k, path: req.path })
      return res.status(429).json({ error: 'rate limited', requestId: req.id })
    }

    bucket.tokens -= 1
    buckets.set(k, bucket)
    res.set('RateLimit-Limit', String(burst))
    res.set('RateLimit-Remaining', String(Math.floor(bucket.tokens)))
    next()
  }
}

/** Release the shared timer so a graceful shutdown has nothing left pending. */
export function stopRateLimiters() {
  if (sweeper) clearInterval(sweeper)
  sweeper = null
  for (const limiter of limiters) limiter.buckets.clear()
  limiters.clear()
}
