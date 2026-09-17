# Help-bot discovery — question list

Build-ready source for the same form in Microsoft Forms / Google Forms, when you
want answers collected centrally instead of mailed back. Numbering matches
`racktrack-bot-feedback-form.html`.

**Form title:** If RackTrack had a help bot, what would you ask it?

**Form description:**
> RackTrack has no help bot today. We're deciding whether to build one, and we'd
> rather hear what you want from it than guess. Your answers go straight into what
> does or doesn't get built. Answer in your own words — rough notes and complaints
> are more useful to us than polished sentences. Five questions, about three
> minutes. None of them are required.

Keep the framing "there is no bot" even though `racktrack-support-bot/` exists in
the repo. Anyone told a bot already exists answers about *that* bot instead of
about their own problem.

---

## 1 — Who you are

1. **Your name** — short text, optional

## 2 — The main question
*The part we care about most. Take your time over these two.*

2. **If there were a support bot inside RackTrack, what problem would you expect it to solve for you?** — long text
   *Help text: The thing you currently ask a colleague about, hunt through a document for, or give up on.*
   *Example answer (show it beside the field, or in the help text): "Half my time on site goes on working out whether the scan is wrong or the rack actually changed. I want to point at a result and ask why it thinks there's a switch in U12, and get a straight answer instead of re-scanning three times."*
3. **Write five questions you'd actually type into it.** — five short-text questions (3a–3e)
   *Help text: As you would actually type them, mid-job. Don't clean them up.*
   *Example answers: (1) why is this scan still processing (2) what was in rack 4 last month (3) how do I add Ravi to the Bangalore site (4) any free ports left on sw-03 (5) who changed the firmware last week*

## 3 — Where you actually get stuck
*One concrete example tells us more than ten feature requests.*

4. **Think of the last time RackTrack left you stuck or irritated. What were you trying to do?** — long text
   *Help text: Where you were, what you expected to happen, what happened instead. Be blunt.*
   *Example answer: "Tuesday, DC2 cold aisle. Trying to finish a multi-rack scan on the phone with gloves on, and it kept losing the site every time I came back from the camera. Did rack 3 twice, gave up, wrote it on paper and typed it in at my desk that evening."*
5. **Which parts of RackTrack do you end up with questions about?** — multi-select: Scanning a rack with the camera · Scan results & device detection · Multi-rack scans · Ports & available ports · Connections & integrations · Network view / live discovery · Firmware checks · Rack topology · Switch info & specs · Marketplace / buying SFPs · Scan history · Accounts, invites & permissions · Organisation admin · Signing in / installing / updates · Other (free text)
   *Example answer: "Ticked scan results and ports. Never opened Marketplace. If I could tick one of them twice it would be device detection — that's where the time goes."*

---

**Every free-text question carries a worked example.** They do more than the help
text does — they set the length, the voice and how specific to be, which is what
people are actually unsure about. Each one is deliberately somebody else's job at
somebody else's rack (DC2, sw-03, Bangalore), so it can't be copied as an answer.
Keep that property if you rewrite them.

## Reading the results

- **Q2 vs Q4.** Q2 is what people *say* they want; Q4 is what actually cost them
  time. Where the two disagree, Q4 is the truer signal.
- **Q3 verbatim.** These are your real evaluation set — the questions the bot has to
  answer on day one. Keep the phrasing exactly as typed, including the typos.
- **Q5 concentration.** If one area takes most of the ticks, that's the first
  knowledge base to write, whatever the free-text answers say.

**One caveat on this cut of the form.** There is no question asking who the
respondent is or what they do, so every answer arrives unlabelled. You will be
reading one undifferentiated pile rather than comparing field engineers against
developers against owners — and with twenty-odd responses, one loud voice reads as
consensus. If you want the comparison back, the cheapest fix is a single
question after Q1: *Which of these is closest to you?* — On-site / field engineer ·
Tester · Developer / integrator · Manager or owner · Sales / pre-sales ·
Data-centre operations · Other. One tick, and every other answer becomes sliceable.
