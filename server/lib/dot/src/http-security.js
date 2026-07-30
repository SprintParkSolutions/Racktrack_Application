/**
 * Response hardening: CSP, the rest of the header set, and CORS posture.
 *
 * Contract §8: "Security headers (CSP, nosniff, frame-deny, referrer policy)
 * on every response." The consoles are single-file pages, so their one <style>
 * and one <script> block carry a per-request nonce that the server stamps into
 * the HTML as it is served. That keeps script-src free of 'unsafe-inline',
 * which matters because the dashboard renders operator-visible strings that a
 * stranger typed into the chat box.
 *
 * The nonce is per request and unguessable, so an injected <script> without it
 * does not execute even if an escaping mistake ever gets one into the DOM.
 */

import { randomBytes } from 'node:crypto'
import { config } from './config.js'

const PERMISSIONS_POLICY = [
  'accelerometer=()',
  'camera=()',
  'geolocation=()',
  'gyroscope=()',
  'magnetometer=()',
  'microphone=()',
  'payment=()',
  'usb=()',
  'interest-cohort=()',
].join(', ')

/**
 * Directives that hold for every response. `default-src 'none'` means anything
 * the pages need must be named explicitly below, so a future <img src=http://…>
 * or a fetch to a third party fails loudly in development rather than silently
 * exfiltrating in production.
 */
function policy(nonce) {
  return [
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}'`,
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
  ].join('; ')
}

export function securityHeaders(req, res, next) {
  const nonce = randomBytes(16).toString('base64')
  res.locals.cspNonce = nonce

  res.set('Content-Security-Policy', policy(nonce))
  res.set('X-Content-Type-Options', 'nosniff')
  res.set('X-Frame-Options', 'DENY')
  res.set('Referrer-Policy', 'no-referrer')
  res.set('Permissions-Policy', PERMISSIONS_POLICY)
  res.set('Cross-Origin-Opener-Policy', 'same-origin')
  res.set('Cross-Origin-Resource-Policy', 'same-origin')
  res.set('X-Permitted-Cross-Domain-Policies', 'none')
  res.set('Origin-Agent-Cluster', '?1')
  // Only meaningful behind TLS, and pinning it by accident on plain HTTP
  // makes a host unreachable, so it stays opt-in.
  if (config.enableHsts) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')

  next()
}

/**
 * Same-origin by default: no Access-Control-Allow-Origin header at all unless
 * the operator listed an origin in CORS_ORIGINS. Credentials are bearer
 * tokens rather than cookies, so Access-Control-Allow-Credentials is never
 * sent and a browser cannot be tricked into attaching ambient authority.
 */
export function cors(req, res, next) {
  const origin = req.headers.origin
  const allowed = origin && config.corsOrigins.includes(origin)

  if (config.corsOrigins.length) res.set('Vary', 'Origin')

  if (allowed) {
    res.set('Access-Control-Allow-Origin', origin)
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.set('Access-Control-Allow-Headers', 'authorization, content-type')
    res.set('Access-Control-Max-Age', '600')
  }

  if (req.method === 'OPTIONS') {
    // A preflight from an origin we do not serve gets nothing useful.
    return res.status(allowed ? 204 : 403).end()
  }

  next()
}

/** API payloads are per-caller and tier-scoped: never let a cache hold one. */
export function noStore(_req, res, next) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  res.set('Pragma', 'no-cache')
  next()
}
