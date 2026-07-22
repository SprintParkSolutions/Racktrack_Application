# Support Assistant

Grounded in-app help for RackTrack. Answers only from a verified knowledge base, and declines rather than guessing.

**Runs at zero cost** — no API key, no external service, no per-message charge.

---

## How it decides what to say

```
question
   │
   ├─ credential guard ──► user pasted a secret? tell them to rotate it
   ├─ out-of-scope     ──► roadmap / pricing / competitor? route to a person
   │
   └─ search the verified knowledge base
        │
        ├─ clear winner   ──► VERBATIM   return the verified answer word for word
        ├─ near-tie       ──► GROUNDED   local model reads the candidates and picks
        ├─ restricted     ──► NEEDS-ACCESS  "that's an admin screen"
        └─ nothing useful ──► REFUSAL    "I don't know" + escalation
```

Most traffic lands on **verbatim**, where the bot generates nothing and therefore
cannot be wrong. Routing is decided by retrieval score **and margin** — not by the
model — so it stays deterministic and testable. The model is consulted only when
the top two candidates are too close for word overlap to separate.

### Why not "always right"?

Verbatim and refusal are 100% safe by construction — one returns human-verified text, the other says nothing. The grounded path is the only place risk lives, and it is fenced three ways: the model sees only the matched entries, its output is validated before display, and anything failing validation falls back to the verified answer.

The target is **never confidently wrong**, not "never wrong."

---

## Files

| File | Role |
|---|---|
| `lib/support_bot.js` | Engine — search, routing, guards, validation |
| `support_routes.js` | `/api/support/*`, auth, rate limiting, refusal logging |
| `data/support-kb.json` | The knowledge base |
| `test/support_bot.test.js` | Regression tests (`node --test`) |
| `../client/src/components/SupportBot.jsx` | In-app help panel |
| `../support-bot/` | Standalone test console + eval harness |

Mounted in `app.js` beside the other routers. **No new npm dependencies.**

---

## API

Both routes require auth.

```
POST /api/support/ask     { message, history? } → { answer, sources, route, ms }
GET  /api/support/status                       → { ok, tier, entries, mode }
```

`matches` and `warnings` are deliberately **not** returned to the client — they expose entry ids and internal state. They stay in the server log.

---

## Security properties

**Tier is derived from the session, never the client.** `owner` / `org_admin` / `site_manager` → `admin`; everything else → `end-user`. Unknown or missing roles fail closed.

**Tier isolation is structural, not instructional.** Restricted entries are removed from the end-user index at load time. They are not hidden behind a "don't mention this" instruction — a prompt instruction can be talked around, but content that was never loaded cannot be leaked. Verified end-to-end: an internal-only question returns `OPS-010` for an admin and never reaches a member.

**Model output is validated, not trusted.** Before any generated answer is shown, the server checks that every cited source was actually supplied, that a substantive answer cites something, and that no prompt scaffolding leaked. Failures fall back to the verified answer.

**Credentials are never accepted quietly.** A stated secret ("my password is Summer2026!") triggers a rotate-it warning. A merely mentioned one ("my password is wrong") is treated as the ordinary support question it is.

---

## Operating it

### Refusal log — your knowledge-base backlog

`data/support-refusals.jsonl` records every question the bot could not answer. This is the most valuable output of the whole system: real questions from real users, and the list of what to document next, ranked by frequency.

```bash
# What are people asking that we cannot answer?
jq -r .question data/support-refusals.jsonl | sort | uniq -c | sort -rn | head -20
```

### The local model

See **The local model** at the end of this document — it covers why the model
matters, how to install it, and how its output is fenced.

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `SUPPORT_KB_PATH` | `data/support-kb.json` | Knowledge base location |
| `SUPPORT_BOT_LLM` | on | `off` disables the model, forcing search-only |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Model host |
| `OLLAMA_MODEL` | `llama3.2:3b` | Model name |
| `SUPPORT_T_MARGIN` | `0.18` | How far the top match must beat the runner-up to skip the model |
| `SUPPORT_T_DIRECT` | `0.68` | Verbatim threshold |
| `SUPPORT_T_GROUNDED` | `0.45` | Refusal floor |
| `SUPPORT_T_COVERAGE` | `0.33` | Min fraction of query *information* matched |
| `SUPPORT_T_MAX_UNKNOWN` | `0.30` | Max fraction of query words unknown to the KB |

### Failure behavior

A missing or malformed knowledge base disables **only** the support routes (503 with a reason). The rest of RackTrack is unaffected — verified by booting with no KB present.

---

## Maintaining the knowledge base

Entries carry `evidence` (source file + line range), an `audience`, and an honest `confidence`. Current corpus: **351 entries** — 231 end-user, 69 admin, 51 internal-only, across 17 categories.

Each entry survived independent review by three skeptical verifiers checking cited evidence, technical accuracy, and end-user usefulness; entries refuted by two or more were discarded (61 were, across two mining rounds). Every cited file was then confirmed to exist, catching fabricated citations mechanically.

Discarded material is kept in `../support-bot/kb/` — `dropped-as-refuted.json` and `unverified-pending.json` (65 entries mined but never verified, parked deliberately rather than shipped).

### It will drift

The KB is mined from the codebase, so it goes stale as the code changes. Two habits:

1. Entries cite real file paths — a CI check flagging entries whose cited files changed tells you what to re-verify.
2. Watch the refusal log. It is the empirical list of gaps.

### Re-tune after changing the KB

**Thresholds are corpus-size dependent.** IDF and score distributions shift as entries are added, so thresholds tuned on 10 entries are wrong at 200.

```bash
cd ../support-bot
KB_PATH=../server/data/support-kb.json node eval/tune.js   # score distributions
KB_PATH=../server/data/support-kb.json npm run eval        # full suite + ship gate
cd ../server && node --test test/support_bot.test.js
```

The eval ship gate requires zero critical failures, ≥95% retrieval, ≥90% overall. Current: **98.1%** (1,191/1,214) with the model active, zero critical failures.

---

## Known limits

**Lexical search cannot do semantics.** "How do I configure a BGP session?" matches login entries on the word *session*. Three signals catch this — unknown-word ratio, information coverage, and an explicit out-of-scope intent check — but the general problem is real. The grounded route exists for exactly this ambiguous band.

**A code-mined KB cannot answer roadmap, pricing, or competitor questions.** Those facts do not live in source code. They are caught by intent and routed to a person rather than left to retrieval, which would otherwise find a superficially similar entry and look confident.

**One matched word is never enough.** A vague query ("its broken") is never answered verbatim — it asks what is broken instead.

---

## The local model

The `grounded` route needs a local model. Without one the bot still works — it
falls back to returning the best verified match — but it cannot **judge**, and
judgement is what separates a good answer from a plausible one.

### Why it matters

Word overlap cannot separate near-ties. A real example from this knowledge base:

```
"i cant find where my old scans went"
  APP-003   TestFlight invitation                 0.74   ← word overlap picks this
  HIST-001  "Where do I find racks I scanned?"    0.66   ← actually correct
```

Both look confident; only one is right. So routing works on the **margin**, not
just the score: a clear winner is returned verbatim (fast, free, cannot
hallucinate), and a near-tie goes to the model, which reads both candidates and
picks. That is the one job a model does better than lexical scoring, and it is
the only job it is given here.

### Install

```bash
curl -fsSL -o ollama.tgz https://ollama.com/download/ollama-darwin.tgz   # macOS
tar -xzf ollama.tgz -C /usr/local/
ollama serve &
ollama pull llama3.2:3b
```

Windows/Linux: see ollama.com/download. **The model must run on the RackTrack
server**, not on a technician's device.

`llama3.2:3b` is ~1.9 GB and needs roughly 4 GB RAM — deliberately the small
model. The 8B is better at phrasing but the job here is narrow (pick between
supplied candidates, or decline), and the 3B does it well. Set `OLLAMA_MODEL` to
use a different one.

### It is still fenced

The model never sees the whole knowledge base — only the entries retrieval
matched. Its output is validated before display: every cited id must be one that
was supplied, a substantive answer must cite something, and prompt scaffolding
must not leak. Anything failing falls back to the verified text. A model
declining is reported as `refusal`, not `grounded`, so the route always names the
outcome rather than the machinery.

### Turning it off

`SUPPORT_BOT_LLM=off` disables it entirely. Everything keeps working at
search-only quality, which is the correct behaviour if the model host is down.
