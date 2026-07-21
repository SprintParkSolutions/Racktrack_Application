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
        ├─ confident      ──► VERBATIM   return the verified answer word for word
        ├─ ambiguous      ──► GROUNDED   local model phrases it, output validated
        └─ nothing useful ──► REFUSAL    "I don't know" + escalation
```

Most traffic lands on **verbatim**, where the bot generates nothing and therefore cannot be wrong. Route selection is by retrieval score, not model judgment, so it is deterministic and testable.

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

### Optional: local model

Everything works without it. Adding it improves handling of unusually phrased questions — the *grounded* route only activates when a model is present; otherwise ambiguous questions show candidate questions to pick from.

```bash
ollama serve && ollama pull llama3.1:8b
```

Needs ~8–16 GB RAM **on the server**, not on the technician's device. Disable entirely with `SUPPORT_BOT_LLM=off`.

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `SUPPORT_KB_PATH` | `data/support-kb.json` | Knowledge base location |
| `SUPPORT_BOT_LLM` | on | `off` disables the model, forcing search-only |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Model host |
| `OLLAMA_MODEL` | `llama3.1:8b` | Model name |
| `SUPPORT_T_DIRECT` | `0.68` | Verbatim threshold |
| `SUPPORT_T_GROUNDED` | `0.45` | Refusal floor |
| `SUPPORT_T_COVERAGE` | `0.33` | Min fraction of query *information* matched |
| `SUPPORT_T_MAX_UNKNOWN` | `0.30` | Max fraction of query words unknown to the KB |

### Failure behavior

A missing or malformed knowledge base disables **only** the support routes (503 with a reason). The rest of RackTrack is unaffected — verified by booting with no KB present.

---

## Maintaining the knowledge base

Entries carry `evidence` (source file + line range), an `audience`, and an honest `confidence`. Current corpus: **182 entries** — 132 end-user, 40 admin, 10 internal-only.

Each entry survived independent review by three skeptical verifiers checking cited evidence, technical accuracy, and end-user usefulness; entries refuted by two or more were discarded (19 were). Every cited file was then confirmed to exist, catching fabricated citations mechanically.

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

The eval ship gate requires zero critical failures, ≥95% retrieval, ≥90% overall. Current: **99.9%** (672/673), zero critical failures.

---

## Known limits

**Lexical search cannot do semantics.** "How do I configure a BGP session?" matches login entries on the word *session*. Three signals catch this — unknown-word ratio, information coverage, and an explicit out-of-scope intent check — but the general problem is real. The grounded route exists for exactly this ambiguous band.

**A code-mined KB cannot answer roadmap, pricing, or competitor questions.** Those facts do not live in source code. They are caught by intent and routed to a person rather than left to retrieval, which would otherwise find a superficially similar entry and look confident.

**One matched word is never enough.** A vague query ("its broken") is never answered verbatim — it asks what is broken instead.
