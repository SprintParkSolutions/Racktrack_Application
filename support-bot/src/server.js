/**
 * Standalone test server. Deliberately NOT wired into the RackTrack app.
 *
 * Run it, talk to it, break it, check the eval numbers. Only once the ship
 * gate in `npm run eval` passes should any of this move into server/.
 *
 * Note on tier: it comes from a query param here purely so you can test both
 * sides easily. When this integrates, tier MUST be derived from the
 * authenticated session server-side and never from anything the client sends.
 */

import express from 'express'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { ask, warmup, THRESHOLDS } from './bot.js'
import * as llm from './llm.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 4545

app.use(express.json({ limit: '64kb' }))
app.use(express.static(join(HERE, '..', 'public')))

app.get('/api/health', async (_req, res) => {
  const model = await llm.isAvailable({ recheck: true })
  res.json({
    ok: true,
    knowledgeBase: warmup(),
    thresholds: THRESHOLDS,
    localModel: model,
  })
})

app.post('/api/chat', async (req, res) => {
  const { message, history = [] } = req.body || {}
  // TEST ONLY - see note above.
  const tier = req.query.tier === 'admin' ? 'admin' : 'end-user'

  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required' })
  }

  const started = Date.now()
  try {
    const result = await ask(message, { tier, history: Array.isArray(history) ? history.slice(-6) : [] })
    res.json({ ...result, tier, ms: Date.now() - started })
  } catch (err) {
    console.error('[chat]', err)
    res.status(500).json({ error: 'internal error', detail: err.message })
  }
})

const counts = warmup()
app.listen(PORT, () => {
  console.log(`\n  RackTrack support bot (standalone test harness)`)
  console.log(`  http://localhost:${PORT}\n`)
  console.log(`  Knowledge base: ${Object.entries(counts).map(([t, n]) => `${t}=${n} entries`).join(', ')}`)
  llm.isAvailable().then((m) => {
    console.log(
      m.ok
        ? `  Local model:    ${m.model}`
        : `  Local model:    unavailable - running search-only\n                  ${m.reason}`,
    )
    console.log(`\n  Run "npm run eval" before considering integration.\n`)
  })
})
