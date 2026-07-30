# Ask DOT — the Support Assistant

*The in-app help assistant that answers only from RackTrack's verified knowledge base — and, when it can't, hands you cleanly to a real person at support@racktrack.ai.*

Feature · All users · Last verified: 26 July 2026 against the live code.

---

## 1. In simple terms

**DOT is the little help assistant built into RackTrack.** You open it, type a problem in your own words — "I can't sign in", "my scan came back empty", "how do I export a report?" — and DOT tries to answer. It is there for the moment you're stuck mid-task and don't want to email anyone or dig through a manual.

What makes DOT different from a normal chatbot is one deliberate design choice: **DOT is not allowed to make things up.** It doesn't answer from a giant model that has "read the internet" and will confidently improvise. Instead, RackTrack keeps a written, verified knowledge base — a big list of real questions with real, checked answers, drawn straight from how the app actually works. When you ask something, DOT searches that list, and everything it tells you has to come from an entry in it. If nothing in the list matches, DOT says so and points you to a person. It never guesses.

The word for this is **grounded**. DOT is "grounded" in the knowledge base the way a witness is asked to stick to what they actually saw. There is a search step, and there is an optional writing step where a language model rephrases a matched answer into a tidy reply — but even that writing step is fenced in: it is only ever shown the handful of entries that matched your question, it is told in plain terms "these are the ONLY facts you know," and its reply is checked before you ever see it. If it drifts off those facts, RackTrack throws its answer away and shows you the plain verified text instead.

So the promise is simple. **If DOT tells you something, it came from a verified answer.** If DOT can't find one, it will admit that rather than invent one — and then it will help you reach a human. That is the whole philosophy: honest silence beats a confident wrong answer, because a support assistant that sounds equally sure whether it knows or not is worse than having no assistant at all.

The assistant's name is **DOT**. On the floating help button inside the app it's also branded **"Assist"**, and the full-screen help page simply shows **"DOT"** at the top — same assistant, two places to reach it.

## 2. At a glance

| | |
|---|---|
| **What it is** | An in-app support assistant that answers from a verified knowledge base and declines instead of guessing. |
| **Who can use it** | Every signed-in RackTrack user. It's behind login, and it answers the same way for everyone. |
| **Where you find it** | The floating **Assist** button (the `SupportBot` panel, available on app screens) and the full-screen **Help / DOT** page. |
| **How it answers** | Three routes: **verbatim** (verified answer, word for word), **grounded** (a model rephrases from matched entries), **refusal** (nothing matched — it says so). |
| **Knowledge base** | 510 entries total; 459 are answerable (372 end-user + 87 admin), and 51 "internal-only" entries are never used to answer anyone. |
| **The writing model** | Optional. Prefers **OpenRouter** (default a free NVIDIA Nemotron model) when a key is set, with a model **fallback chain**; falls back to a local **Ollama** model; falls back again to verbatim-only if neither is up. |
| **Safety guards** | A credential guard (spots secrets you paste and tells you to change them), answers only from the KB, and internal-only content is walled off. |
| **When it can't help** | A **"Contact support"** button appears on any declined reply and opens the **Contact** page, pre-filled with your question → emails **support@racktrack.ai**. |
| **Endpoints** | `POST /api/support/ask`, `GET /api/support/status`, `POST /api/support/contact`. All require login. |
| **Rate limit** | Up to **60 questions per hour** per user, with a burst of 10. |
| **Cost to run** | The search is local and free; the model is optional. RackTrack keeps working with the model switched off. |

## 3. How it answers — the three routes

Every question DOT receives is first run through a local search over the knowledge base, and the result is sorted into one of three routes. They are listed here from safest to least safe, which is also the order DOT prefers.

**Route 1 — Verbatim (the verified answer).** When the search is confident it has found the one right entry, DOT returns that entry's answer **word for word**. Nothing is generated, rephrased, or summarised on the fly, so there is simply nothing that *can* be hallucinated — the text you read is the exact verified text a human wrote and checked. On screen this is labelled **"Verified answer."** DOT leads with the entry's short version and keeps the full steps one tap away under **"Show the full steps."** A few things always take this fast path: a greeting like "hi" gets a friendly greeting back; asking to "contact support" or "talk to a person" gets the support inbox straight away; and if you type a question that word-for-word matches one already in the KB (which is exactly what happens when you tap one of DOT's own suggestion buttons), it's answered directly from the verified text.

**Route 2 — Grounded (composed from documentation).** Sometimes the search finds relevant entries but can't tell which one you mean — two answers are close, or your wording is ambiguous. Rather than guess, DOT hands the *matched entries only* to a language model and asks it to phrase a short answer using nothing but those facts. The model is told, in the prompt, that these are the only facts it knows, that it must never invent a number or button name or screen name, and that it must end its reply by naming which entry ids it used. That reply is then **validated** before you see it: if it cites an entry that wasn't in the matched set, cites nothing at all for a substantive answer, or leaks any of the prompt's scaffolding, RackTrack rejects it and quietly falls back to the plain verified answer of the top match. On screen a successful grounded answer is labelled **"Composed from documentation."**

**Route 3 — Refusal (an honest "I don't know").** When nothing relevant matches — or what matched is too weak, too thinly covered, or clearly about something RackTrack doesn't cover — DOT refuses. It says, in plain words: *"I don't have reliable information about that. I'd rather not guess and send you the wrong way,"* followed by how to reach a person. It does **not** hand you the closest-looking entry as a consolation prize, because a confident wrong answer is exactly what this whole design exists to prevent. Refusals are the one route that gets logged (see §7), because each one is a real question the KB should probably grow to cover.

Between these, there are a couple of gentler in-between states. If DOT is unsure but has a few candidates, it offers a short **numbered list** ("Does one of these match?") and you tap the one you mean — which then gets answered verbatim. And there are dedicated replies for things the KB can never answer from source code (roadmap, pricing, "how do you compare to NetBox?"), which are politely declined and pointed at your administrator or account manager.

## 4. What you see on screen

DOT lives in two places, and both are intentionally plain.

**The floating Assist panel.** A small **Assist** button sits on the app screens; tapping it opens a chat panel headed *"RackTrack Assist — Answers from verified documentation."* You type what's happening, DOT replies in a bubble, and if there's more detail than the short answer shows, a **"More detail"** toggle reveals the full steps. Importantly, this button only appears when DOT is actually available — if the server reports the assistant is down, the button renders nothing at all, because a help button that can't help is worse than no button.

**The full-screen Help page (DOT).** For when you came specifically to ask something. It opens with *"What are you stuck on?"* and a set of common-question starters ("I can't sign in", "My scan came back empty", "Where did my earlier scans go?", and so on) you can tap to ask instantly. Answers appear as cards.

**The answer badge.** This is the heart of the honesty design. Every reply carries a small label saying how it was produced, so a guess can never be mistaken for a fact:

- **"Verified answer"** — a verbatim answer straight from the knowledge base.
- **"Composed from documentation"** — a grounded answer the model phrased from matched entries.
- **"Not sure yet"** — DOT offered a numbered list and is asking you to pick.
- **"No verified answer"** — a refusal, an out-of-scope decline, or an access decline.
- **"Security notice"** — the credential guard fired (see §5).

**The numbered options.** When DOT is unsure and offers a list, the full-screen Help page renders those options as real tap-able buttons rather than making you type a number on a phone. Tapping one re-asks that exact question, which then matches verbatim.

**The "Contact support" hand-off.** Whenever a reply is a *decline* — a refusal, an out-of-scope answer, or an access decline — a small **"Still stuck? Contact support"** button appears under it. Tapping it takes you to the Contact page with the message box **pre-filled** with the exact question DOT couldn't answer, so you don't have to retype it. This is the bridge from "the bot can't help" to "a human will." It's covered in full in §6.

## 5. The safety guards

DOT has three built-in guards, and they are structural rather than cosmetic — they're built into how it works, not bolted on as warnings.

**The credential guard.** People paste secrets into support chats all the time — "my password is Summer2026!", an API key, a session token. Before your question reaches search or any model, DOT checks whether you've *stated* a credential. It's careful to tell the difference between a secret being **stated** ("my password is `<something that looks like a real password>`") and one merely **mentioned** ("my password is wrong" — that's an ordinary support question and is answered normally). It recognises obvious token shapes (things beginning `sk-`, `pk-`, `ghp_`, `xox…`, and JWT session tokens), and labelled secrets ("password is…", "api key is…", "community string is…") where the value actually looks secret-like — a short heuristic checks for a mix of letters, digits, symbols, or real length before treating it as one. When it fires, DOT stops and gives a **"Security notice"**: it doesn't try to answer, it tells you the secret may now be stored in the conversation, and it asks you to **change it now** and then re-describe the problem without it. It never needs the secret to help.

**Answers only from the knowledge base.** DOT cannot answer from general knowledge. The verbatim route copies verified text; the grounded route is shown only the matched entries and told they are the only facts it has; the refusal route is what happens when neither can produce something grounded. There is no fourth path where DOT just... knows things. This is why it can honestly say it "can't hallucinate" in the way an open-ended chatbot can.

**Content isolation (what's walled off).** The knowledge base includes 51 **internal-only** entries — these quote server source-file paths and line numbers, and exist to help *write and maintain* the KB, not to be read out to any user. Those entries are **never loaded into any index DOT answers from**, so they cannot be leaked to anyone, whatever their role. The isolation is structural: content that was never loaded can't be surfaced by clever phrasing.

> A note on roles, corrected against the current code: RackTrack **used to** run two tiers, so the same question could get a different answer depending on whether a member or an owner asked. That role-based tiering has been **removed** — every signed-in user now gets the *same* single-corpus bot. The 372 end-user and 87 admin entries are all answerable to everyone; only the 51 internal-only entries are excluded. So the meaningful "won't leak" guarantee today is about internal-only source-level content, not about hiding admin answers per role.

## 6. When it can't answer → Contact → support@racktrack.ai

When DOT declines, it never leaves you at a dead end. Here is the full escalation chain, end to end.

1. **DOT declines.** The reply is a refusal (or an out-of-scope / access decline), badged **"No verified answer."** Its own text already names the way out: *note what you were doing and any exact error text, and email it to support@racktrack.ai.*

2. **The "Contact support" button appears.** Under any declined reply, the app shows **"Still stuck? Contact support."** Tapping it opens the **Contact** page and carries your question across as context.

3. **The Contact form is pre-filled.** The message box opens already containing *`I couldn't get an answer to: "<your question>"`*, so you don't retype it. You can add a subject and any extra detail. The page tells you replies come to your account email, and offers a plain **mailto:** link to support@racktrack.ai as a backup.

4. **The message is sent server-side.** Submitting calls `POST /api/support/contact`. The server attaches your identity and context automatically — your role, your organization/site, your user id, and the DOT question that sent you here — so support has the picture without you spelling it out. A short 15-second per-user cooldown blocks accidental double-sends.

5. **It lands in the support inbox.** The server sends the email to **support@racktrack.ai**, preferring the support Microsoft 365 mailbox via Microsoft Graph and falling back to SMTP if Graph isn't configured. Crucially, the email's **Reply-To is set to your address**, so when support replies from their client, it goes straight back to you.

6. **If sending fails**, the server responds with a clear error and the app surfaces the **"Email us directly"** mailto: link to support@racktrack.ai, so you're never actually stuck.

The address is deliberately singular. There is one bot and one support inbox — **support@racktrack.ai** — quoted the same way whether you're a technician or the person who runs the platform, and kept in one place in the code so DOT's spoken address and the Contact form's destination can never drift apart.

## 7. Under the hood

This section is accurate to the current code and is written for engineers.

**The knowledge base.** `server/data/support-kb.json`. The `entries` array holds **510** entries. Each entry carries `question`, `answer`, a `short` (the concise reply DOT leads with — present on 351 entries; where absent, the full `answer` is used), an `id`, a `category`, a `domain`, an `audience`, and a `confidence` label — plus `symptoms`, `rootCause`, `evidence`, and a few maintenance fields. Note two things that surprise people: `confidence` is a **categorical** author label (`certain` / `likely` / `inferred`), *not* the numeric retrieval confidence used for routing; and the JSON's own `counts.total` metadata still reads `351`, which is **stale** — the live `entries` array is the source of truth at 510. `audience` splits into `end-user` (372), `admin` (87), and `internal-only` (51). A defensive `cleanShort()` repairs a class of historically-corrupted `short` fields (a truncated opening followed by the whole answer again) by falling back to the verified `answer`. If the KB file is missing, the bot **refuses to start ungrounded** — an ungrounded support bot is considered worse than none.

**Retrieval.** `server/lib/support_bot.js`. Search is a local, dependency-free **BM25** (k1 = 1.5, b = 0.75) over per-field token sets with field weights (`question` 3.0, `symptoms` 2.5, `answer` 1.0, `rootCause` 0.8). The tokenizer lower-cases, strips punctuation, drops stopwords, and applies a light stemmer. Recall is widened two ways: a hand-written **synonym map** (tenant/org/company, login/signin, scan/photo/camera, and so on, matched at reduced weight) and **learned associations** mined from the corpus itself (`support_associations.js`), so a question about being "signed out" can reach an answer about sessions expiring without an embedding model. The index is built once per tier and cached; a separate full index over every entry exists only to detect that a better answer lives out of reach — it is never used to answer.

**Routing thresholds.** Beyond a raw score, routing uses a computed `confidence`, `coverage` (fraction of the query's *information mass*, measured in IDF, that was matched), a `margin` over the runner-up, `matchedTerms`, and an `unknownRatio` (fraction of query vocabulary absent from the whole KB — the signal that catches "configure a BGP session on a Cisco 9300"). The gates: `DIRECT` 0.68 (answer verbatim), `GROUNDED` 0.45 (let the model phrase it), `MIN_COVERAGE` 0.33, `MIN_SCORE` 4.0, `MIN_TERMS_FOR_DIRECT` 2, `MIN_MARGIN_FOR_DIRECT` 0.18, `MAX_UNKNOWN` 0.3. A question below the grounded/coverage/score bar or above the unknown bar is refused. Out-of-scope intents (roadmap, pricing, competitor comparison) are declined *after* retrieval, and a named competitor ("…to NetBox") can never be overridden by retrieval score.

**The LLM backend and its fallback chain.** The grounded step calls `callChatModel(messages)`, which routes as follows:

- **If `OPENROUTER_API_KEY` is set → OpenRouter is preferred.** Requests go to `OPENROUTER_URL` (OpenAI-style chat, bearer auth), temperature 0, `max_tokens` 500. The default model is `nvidia/nemotron-3-ultra-550b-a55b:free`. Critically, DOT tries a **fallback chain** of models in order — `OPENROUTER_MODELS` (comma-separated) — and a delisted, rate-limited, or down model simply moves to the next. Only when the *entire* chain fails does it throw. This exists because OpenRouter's free catalog is volatile: models get delisted with days' notice, so the chain should be anchored with a reliable paid instruct model.
- **Else → local Ollama fallback.** `POST {OLLAMA_URL}/api/chat` with `OLLAMA_MODEL` (default `llama3.2:3b`), temperature 0, `num_predict` 500.
- **`stripReasoning()`** runs on every completion, removing `<think>…</think>` blocks so a reasoning model's chain-of-thought can't leak into the answer or break source parsing. (A reasoning model is still the *wrong* choice here — this is a backstop, not a substitute for an instruction-following model.)
- **If the whole call throws → graceful degradation.** The caller catches it and returns the verbatim `short`/`answer` of the top match (`grounded-error` route). If the model's output fails validation, same fallback (`grounded-rejected`). So a model outage never breaks DOT — it just narrows it to verbatim answers plus escalation.

**Availability probe.** `llmAvailable()` returns "off" when `SUPPORT_BOT_LLM=off`; returns available immediately (no per-question health check) when an OpenRouter key is present; otherwise probes Ollama's `/api/tags` with a 2.5s timeout and caches a *negative* result for 60s so a transient Ollama blip self-heals within a conversation rather than wedging the bot into search-only until restart.

**Endpoints and auth.** `server/support_routes.js`. `POST /api/support/ask` (message + optional history) and `GET /api/support/status` (returns KB size and `mode: "search+model"` or `"search-only"`) both sit behind `requireAuth`. The knowledge **tier is derived server-side from the verified session role** and never trusted from the request body — though, per §5, that derivation currently returns a single shared tier for everyone. `POST /api/support/contact` (in `server/auth.js`) is the escalation endpoint. The KB is warmed at boot; if it fails to load, the support routes return 503 while the rest of RackTrack keeps serving.

**Rate limit.** 60 questions/hour sustained with a burst of 10, per user. On a 429 the response is rewritten into human terms — the real ceiling and a real "try again in about N seconds/minutes" — rather than the shared limiter's upload-oriented wording.

**Refusal log.** Only the `refusal` route is logged, to `server/data/support-refusals.jsonl` (with rotation). Each line records the timestamp, user id, tier, route, confidence, the question text (truncated), and up to four **near-misses** (id, title, BM25 score, confidence). That log *is* the KB backlog: near-misses tell a maintainer whether the right entry exists and scored just under the bar (fix its wording) or nothing came close (write a new entry).

## 8. Configuration

All configuration is server-side environment; secrets never live in the client or the repo.

| Variable | Purpose | Default |
|---|---|---|
| `OPENROUTER_API_KEY` | If set, the grounded step uses OpenRouter instead of Ollama. Server env only. | *(unset — falls back to Ollama)* |
| `OPENROUTER_MODELS` | Comma-separated **fallback chain**, tried in order. Anchor it with a reliable paid instruct model, e.g. `nvidia/nemotron-…:free,meta-llama/llama-3.1-8b-instruct`. | `OPENROUTER_MODEL` |
| `OPENROUTER_MODEL` | Single default model, used when `OPENROUTER_MODELS` is unset. | `nvidia/nemotron-3-ultra-550b-a55b:free` |
| `OPENROUTER_URL` | OpenRouter chat-completions endpoint. | `https://openrouter.ai/api/v1/chat/completions` |
| `SUPPORT_BOT_LLM` | Set to `off` to disable the model entirely (verbatim + refusal only). | *(on)* |
| `OLLAMA_URL` | Local Ollama endpoint (fallback backend). | `http://127.0.0.1:11434` |
| `OLLAMA_MODEL` | Local model name. | `llama3.2:3b` |
| `OLLAMA_TIMEOUT_MS` | Per-call timeout for *both* backends. | `20000` |
| `SUPPORT_LLM_PROBE_TTL_MS` | How long a failed Ollama probe is cached before re-checking. | `60000` |
| `SUPPORT_KB_PATH` | Override the KB file location. | `server/data/support-kb.json` |
| `SUPPORT_T_DIRECT`, `SUPPORT_T_GROUNDED`, `SUPPORT_T_COVERAGE`, `SUPPORT_T_SCORE`, `SUPPORT_T_MIN_TERMS`, `SUPPORT_T_MARGIN`, `SUPPORT_T_MAX_UNKNOWN` | Routing thresholds (re-tune when the KB changes size). | 0.68 / 0.45 / 0.33 / 4.0 / 2 / 0.18 / 0.3 |

**Recommended production setup.** Because the free OpenRouter instruct tier is now largely delisted, set `OPENROUTER_API_KEY` and put a reliable **paid instruct** model in `OPENROUTER_MODELS` (a free model may lead the chain, but something dependable should anchor it). Avoid pure *reasoning* models — `stripReasoning` cleans up after them, but they aren't good instruction-followers for this job.

## 9. Edge cases and limits

- **Model down, everything else up.** If OpenRouter's whole chain fails and Ollama is absent (or `SUPPORT_BOT_LLM=off`), DOT keeps working in **search-only** mode: verbatim answers and honest refusals, no grounded rephrasing. `GET /api/support/status` reports `mode: "search-only"`. Users still get every verified answer; they just won't get the composed-from-documentation phrasing for ambiguous questions — those become a numbered "Does one of these match?" list instead.
- **Volatile free models.** OpenRouter's free catalog changes without much notice. A single hard-coded model id *will* eventually break; the `OPENROUTER_MODELS` chain exists precisely so that a delisting degrades to the next model rather than to an outage.
- **Reasoning-model caveat.** If a reasoning model sneaks into the chain, `stripReasoning` prevents its `<think>` output from leaking, but such models tend to ignore the strict "answer only from these facts / end with SOURCES" instructions, so their replies are more likely to be *rejected* by validation and fall back to verbatim. Prefer instruction-following models.
- **Ambiguity is answered with a question, not a guess.** Near-ties and thin coverage deliberately do *not* produce a verbatim answer; they produce a clarifying list or a refusal. This is by design — word overlap can't be trusted to have picked the right entry when two score alike.
- **KB gaps show up as refusals.** DOT can only be as complete as the knowledge base. A perfectly reasonable question with no matching entry is refused, logged, and becomes backlog. This is a feature (no guessing), but it means the KB, not the model, is what makes DOT better over time.
- **Follow-ups need context.** A bare "why?" or "still broken" carries no searchable words; DOT blends in your previous turn so retrieval has something to work with. Very short questions lean on history more than long ones.
- **The credential guard is best-effort.** It catches common shapes and labelled secrets, but by the time DOT sees a message it's already in transit — which is exactly why the guard's advice is to *rotate the secret*, not merely to stop.

## 10. Common questions

**Is DOT going to make something up?**
No. Everything it tells you comes from a verified knowledge-base entry — copied word for word, or rephrased by a model that's only allowed to use the matched entries and is checked before you see it. If it can't ground an answer, it refuses.

**What does the "Verified answer" badge mean?**
That the reply is a verbatim, human-checked answer straight from the knowledge base — nothing was generated. "Composed from documentation" means a model tidied up matched entries; "No verified answer" means DOT declined.

**DOT said it doesn't know. Now what?**
Tap **"Contact support"** under the reply. It opens the Contact page pre-filled with your question and emails the RackTrack support team at **support@racktrack.ai**, with your details attached and Reply-To set to you.

**I pasted my password by accident — what happens?**
DOT stops and shows a **"Security notice"** instead of answering. It asks you to **change the password now** (it may be stored in the chat) and then re-describe the problem without it. It never needs your password to help.

**Does DOT work if the AI model is down?**
Yes. It falls back to giving verified answers and honest refusals without the model. You'll still get every documented answer; you just won't get the "composed" phrasing for fuzzy questions.

**Why did DOT give me a numbered list instead of an answer?**
It found a few possible matches but wasn't sure which you meant. Tap the one that fits and it'll answer that from the verified text — better than guessing wrong.

**Can I ask about pricing, the roadmap, or how RackTrack compares to another tool?**
DOT will politely decline those — it only knows how the app works today, not commercial or future plans, and it won't compare RackTrack to other products. It'll point you to your administrator or account manager.

**Will a member see admin-only answers?**
Everyone currently gets the same single knowledge base, which includes admin how-to entries. What's fully walled off is a set of *internal-only* entries (server file paths and line numbers) that exist to maintain the KB and are never used to answer anyone.

**How many questions can I ask?**
Up to 60 an hour, with room for a quick burst of 10. That comfortably covers a whole troubleshooting session; if you somehow hit it, DOT tells you exactly how long to wait.

**Is my question stored anywhere?**
Only when DOT *couldn't* answer it. Refused questions are logged (question text plus the near-miss entries and your user id) so the team can grow the knowledge base to cover the gap. Answered questions aren't stored as a transcript.

**Where does the "Contact support" email actually go?**
To **support@racktrack.ai** — via the support Microsoft 365 mailbox where configured, otherwise over SMTP — with Reply-To set to your email so the reply comes straight back to you.

**Is DOT the same in the floating panel and the Help page?**
Yes — same assistant, same knowledge base, same rules. The floating **Assist** panel is for a quick answer mid-task; the full-screen **DOT / Help** page is for when you came to ask something and want the starters, badges, and tap-able options.
