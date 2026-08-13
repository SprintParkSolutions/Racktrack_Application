#!/usr/bin/env node
/**
 * One command to take harvested knowledge through to both live surfaces.
 *
 *   node publish.js            # dry run — shows every step, changes nothing
 *   node publish.js --write    # apply
 *
 * Order matters, and each step gates the next:
 *
 *   1. merge      fold verified harvest into the knowledge base (secret gate,
 *                 evidence gate, duplicate gate)
 *   2. shorten    add the short answer every entry leads with
 *   3. tune       report retrieval score distributions for the NEW corpus size
 *   4. eval       full suite + ship gate — ABORTS the publish if it fails
 *   5. test       server-side regression tests
 *   6. artifact   rebuild the shareable page (internal tier excluded)
 *   7. reload     restart the local test console against the new base
 *
 * Step 4 is the point of the whole script. Thresholds are corpus-size
 * dependent, so growing the knowledge base can silently degrade retrieval —
 * publishing without re-running the gate is how a regression reaches users.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const KB = join(REPO, 'server', 'data', 'support-kb.json')
const HARVEST = join(HERE, 'kb', 'harvest')

const WRITE = process.argv.includes('--write')
const SKIP_MERGE = process.argv.includes('--skip-merge')

const C = { r: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m' }

let step = 0
function heading(title) {
  step += 1
  console.log(`\n${C.bold}${step}. ${title}${C.r}`)
  console.log(C.dim + '─'.repeat(58) + C.r)
}

function run(cmd, args, opts = {}) {
  try {
    const out = execFileSync(cmd, args, {
      cwd: HERE,
      encoding: 'utf8',
      env: { ...process.env, KB_PATH: KB, SUPPORT_KB_PATH: KB },
      stdio: ['ignore', 'pipe', 'pipe'],
      ...opts,
    })
    return { ok: true, out }
  } catch (err) {
    return { ok: false, out: `${err.stdout || ''}${err.stderr || ''}`, code: err.status }
  }
}

function tail(text, n = 12) {
  return String(text || '').trimEnd().split('\n').slice(-n).map((l) => `   ${l}`).join('\n')
}

function entryCount() {
  try { return (JSON.parse(readFileSync(KB, 'utf8')).entries || []).length } catch { return 0 }
}

console.log(`${C.bold}RackTrack support — publish${C.r}`)
console.log(`${C.dim}${WRITE ? 'APPLYING CHANGES' : 'dry run (use --write to apply)'}${C.r}`)
console.log(`${C.dim}knowledge base: ${entryCount()} entries${C.r}`)

// ── 1. merge ─────────────────────────────────────────────────────────
if (!SKIP_MERGE) {
  heading('Merge harvested domains')
  const verified = existsSync(HARVEST)
    ? readdirSync(HARVEST).filter((f) => f.endsWith('.json') && !f.startsWith('raw-'))
    : []

  if (verified.length === 0) {
    console.log(`   ${C.yellow}no verified harvest files — nothing to merge${C.r}`)
  } else {
    const res = run('node', ['merge-harvest.js', ...(WRITE ? ['--write'] : [])])
    console.log(tail(res.out, 14))
    if (!res.ok) {
      console.error(`\n${C.red}Merge failed — stopping.${C.r}`)
      process.exit(1)
    }
  }
}

// ── 2. shorten ───────────────────────────────────────────────────────
heading('Add short answers')
{
  const res = run('node', ['shorten.js', ...(WRITE ? ['--write'] : [])])
  console.log(tail(res.out, 5))
  if (!res.ok) { console.error(`\n${C.red}Shorten failed — stopping.${C.r}`); process.exit(1) }
}

// ── 3. tune ──────────────────────────────────────────────────────────
heading('Retrieval score distribution')
{
  const res = run('node', ['eval/tune.js'])
  console.log(tail(res.out, 6))
  console.log(`   ${C.dim}If this reports OVERLAPPING, fix scoring before shipping — no threshold can separate the bands.${C.r}`)
}

// ── 4. eval — the gate ───────────────────────────────────────────────
heading('Evaluation ship gate')
{
  const res = run('node', ['eval/run.js'])
  console.log(tail(res.out, 16))
  if (!res.ok) {
    console.error(`\n${C.red}${C.bold}SHIP GATE FAILED — not publishing.${C.r}`)
    console.error(`${C.dim}The knowledge base on disk has been updated, but neither surface was refreshed.`)
    console.error(`Fix the failures (or re-tune thresholds) and run again.${C.r}`)
    process.exit(1)
  }
  console.log(`   ${C.green}gate passed${C.r}`)
}

// ── 5. server tests ──────────────────────────────────────────────────
heading('Server regression tests')
{
  const res = run('node', ['--test', 'test/support_bot.test.js'], { cwd: join(REPO, 'server') })
  const line = String(res.out).split('\n').filter((l) => /^# (tests|pass|fail)/.test(l)).join('  ')
  console.log(`   ${line || tail(res.out, 4)}`)
  if (!res.ok) { console.error(`\n${C.red}Tests failed — not publishing.${C.r}`); process.exit(1) }
}

// ── 6. artifact ──────────────────────────────────────────────────────
heading('Rebuild shareable page')
{
  const res = run('node', ['build-artifact.js'])
  console.log(tail(res.out, 6))
  if (!res.ok) {
    console.error(`\n${C.red}Artifact build refused — stopping.${C.r}`)
    process.exit(1)
  }
}

// ── 7. reload the local console ──────────────────────────────────────
heading('Local test console')
{
  // The console reads the knowledge base at startup, so it needs a restart to
  // pick up a merge. Only bounce it if it is actually running.
  const probe = run('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', 'http://localhost:4545/api/health'])
  const up = String(probe.out).trim() === '200'
  if (!up) {
    console.log(`   ${C.dim}not running — start it with:${C.r}`)
    console.log(`   KB_PATH=${KB} PORT=4545 node src/server.js`)
  } else if (!WRITE) {
    console.log(`   ${C.dim}running; would restart to pick up the new knowledge base${C.r}`)
  } else {
    run('pkill', ['-f', 'support-bot/src/server.js'])
    console.log(`   restarted — reload http://localhost:4545`)
    console.log(`   ${C.dim}(relaunch in background: KB_PATH=${KB} PORT=4545 node src/server.js &)${C.r}`)
  }
}

console.log(`\n${'─'.repeat(58)}`)
if (WRITE) {
  console.log(`${C.green}${C.bold}Published.${C.r} ${entryCount()} entries.`)
  console.log(`Page rebuilt at ${C.bold}dist/knowledge-base.html${C.r}`)
  console.log(`${C.dim}The hosted artifact is uploaded separately — that file has to be republished by hand.${C.r}`)
} else {
  console.log(`${C.dim}Dry run complete. Nothing changed. Re-run with --write.${C.r}`)
}
