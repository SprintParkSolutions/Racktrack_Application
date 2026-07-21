# RackTrack Support Bot

A grounded support assistant for RackTrack. **Standalone — deliberately not wired into the app.** Build it, test it, prove it, *then* integrate.

Runs at **$0**. No API keys, no per-message cost, no external service.

---

## The core idea

The thing that makes a support bot expensive is the same thing that makes it lie: the language model. So the model is not the primary path here.

```
User question
     │
     ▼
┌─────────────────────────────────────────┐
│ 1. Search the verified knowledge base   │
└─────────────────────────────────────────┘
     │
     ├── confident match ────►  VERBATIM
     │                          Return the human-verified answer word for word.
     │                          Hallucination risk: zero. Cost: zero.
     │
     ├── relevant, ambiguous ►  GROUNDED
     │                          Local model phrases an answer using only the
     │                          matched entries. Output is validated before
     │                          the user sees it. Cost: zero (runs locally).
     │
     └── nothing relevant ───►  REFUSAL
                                "I don't know, here's who to ask."
                                Never guesses.
```

Most traffic lands on **verbatim**, where the bot is incapable of being wrong — it isn't generating anything, just returning text a human already checked.

### Why not "100% accurate"?

You asked for 100% accurate. Here is the honest version:

- The **verbatim** path *is* 100% accurate, by construction. It can only return verified text.
- The **refusal** path is 100% safe. It says nothing.
- The **grounded** path is where risk lives — and it's fenced in three ways: the model only ever sees the matched entries (never the whole KB, never the internet), its output is validated before display, and anything that fails validation falls back to the verbatim answer.

So the design target isn't "never wrong." It's **never confidently wrong**. Every answer is either verified, validated, or an admission of ignorance.

---

## Quick start

```bash
cd support-bot
npm install
npm start            # http://localhost:4545
```

Open the page and ask it things. Each reply shows which route answered and how confident retrieval was — that transparency is the point of the test harness.

### Optional: add the local model

Everything works without it (search-only). Adding it improves handling of oddly-phrased questions.

```bash
# macOS / Linux
brew install ollama          # or: curl -fsSL https://ollama.com/install.sh | sh
ollama serve
ollama pull llama3.1:8b
```

Needs roughly **8–16 GB RAM** on the machine running it. Configure with `OLLAMA_MODEL` and `OLLAMA_URL` if you want a different model or host.

---

## Evaluating it

**This is the part that matters.** Do not integrate on vibes.

```bash
npm run eval             # full suite + ship gate
npm run eval -- --verbose
node eval/tune.js        # retrieval score distributions, for threshold tuning
```

Two suites:

| Suite | What it is | How it grows |
|---|---|---|
| **AUTO** | Every KB entry becomes a test: ask its question, expect it back. Also tests its symptoms. | Automatically, with the KB |
| **CURATED** | `eval/cases.json` — refusals, tier-leak probes, prompt-injection, messy real phrasing | By hand, every time you find a bug |

Plus **TIER ISOLATION**, which verifies structurally that restricted knowledge is absent from the end-user index — not merely hidden behind an instruction.

### The ship gate

`npm run eval` exits non-zero unless all three pass:

1. **Zero critical failures** — no leaks, no failure to refuse, no successful jailbreak
2. **Retrieval ≥ 95%** — every entry is reachable, or it might as well not exist
3. **Overall ≥ 90%**

Wire it into CI. An unreachable-entry regression is silent otherwise.

### Every check is mechanical

No LLM judge. Substring, regex, route, and source-id assertions only. A suite graded by a model inherits that model's unreliability, and you lose the ability to tell a real regression from judge noise.

---

## Tuning thresholds

`src/search.js` exposes four routing knobs. **Re-tune them whenever the knowledge base changes size** — IDF and score distributions shift with the corpus, so thresholds tuned on 10 entries will be wrong at 150.

```bash
node eval/tune.js
```

It prints scores for two probe sets — questions that *should* be answered and questions that *should* be refused — and tells you whether a threshold can separate them. If it reports `OVERLAPPING`, no threshold will work and the fix belongs in scoring, not thresholds.

Two independent gates must both pass, because each catches what the other misses:

- **confidence** — overall match strength
- **coverage** — fraction of the user's typed words that were found

Coverage is the more useful of the two. It catches the classic retrieval failure where an off-topic question ("how much does it cost per user?") hits one incidental word and still ranks first. That exact case slipped through confidence alone during development.

---

## Architecture

| File | Role |
|---|---|
| `src/kb.js` | Loads the KB; **filters by tier at load time** |
| `src/search.js` | BM25 + synonym expansion. Zero dependencies |
| `src/prompt.js` | Prompts for the local model; verbatim and refusal templates |
| `src/llm.js` | Ollama client. Degrades gracefully when absent |
| `src/bot.js` | Route selection, credential guard, output validation |
| `src/server.js` | Test server (not for production as-is) |
| `eval/` | Test suites, ship gate, threshold tuner |

### Two security properties worth understanding

**Tier isolation is structural.** Internal knowledge is removed from the entry list *before the prompt is built*. It is not hidden behind "don't mention this" instructions. A prompt instruction can be talked around; content that was never loaded cannot be leaked no matter what the user types. `filterByTier` is the whole enforcement mechanism, and the eval verifies it directly.

**Model output is validated, not trusted.** Before any generated answer reaches a user, `validate()` checks that every cited source id was actually supplied, that a substantive answer cites something, and that no prompt scaffolding leaked. Failures fall back to the verified answer rather than showing unvalidated text.

---

## Knowledge base

`kb/knowledge-base.json`. Every entry carries `evidence` — the source files and line ranges that prove the claim — plus an `audience` (`end-user` / `admin` / `internal-only`) and an honest `confidence`.

`kb/FIXTURE-synthetic-smoke-test.json` is **invented test data** for exercising the machinery. It must never be loaded as the real KB. Use it via `KB_PATH=kb/FIXTURE-synthetic-smoke-test.json npm run eval`.

### Keeping it from going stale

The KB is mined from the codebase, so it drifts as the code changes. Two habits:

1. Entry `evidence` records real file paths. A CI check that flags entries whose cited files changed will tell you what to re-verify.
2. Log every **refusal** in production. The refusal log is your KB backlog — it's a list of real questions from real users that you cannot yet answer, ranked by frequency.

---

## Before integrating

- [ ] `npm run eval` passes the ship gate against the **real** KB, not the fixture
- [ ] `node eval/tune.js` re-run and thresholds set for the real KB size
- [ ] Sit with the bot for an hour and try to break it; every success becomes a case in `eval/cases.json`
- [ ] **Tier comes from the authenticated session, server-side.** The `?tier=admin` query param in `server.js` is test-harness only — shipping it as-is means anyone can self-promote to admin
- [ ] Rate-limit the endpoint
- [ ] Decide what gets logged (questions are user data; conversations may contain credentials despite the guard)
- [ ] Add a visible "talk to a human" escape hatch on every response

The bot handles the common questions so a support team doesn't have to. It is not a replacement for the escape hatch.
