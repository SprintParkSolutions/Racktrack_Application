# RackTrack — Master Client Demo Script

**Format:** Live demo, ~40 minutes + 10 minutes Q&A (a 20-minute cut is in Appendix C)
**Audience:** Data center / infrastructure operators — ops leads, network engineers, procurement, compliance, and the budget owner

**How to use this script:** Speak it, don't read it. Every spoken line is marked **SAY**. Every action in the product is marked **DO**. Anything in **[square brackets]** is a placeholder — fill it with a real, verified number before you present. Never guess a metric on stage; if you don't have it, cut the line.

---

## Pre-Demo Checklist (T-minus 30 minutes)

1. **Demo rack photos loaded** — one clean rack for Scene 1, and one messy real-world rack held in reserve (it's your credibility weapon in Q&A).
2. **ServiceNow sandbox connected** and seeded with 2–3 deliberate mismatches, so the reconciliation in Scene 4 visibly *catches* something. A reconciliation that finds nothing is a dead demo.
3. **Procurement/marketplace demo account** logged in, cart empty.
4. **Cross-rack topology map** pre-populated with the demo site so Scene 5 opens instantly.
5. **Backup screen recording of every scene** — if the network dies, you keep presenting (recovery lines in Appendix D).
6. **Know the client's numbers before you walk in:** rack count, number of sites, team size, CMDB system, and how long their last audit took. You will say these numbers back to them twice — in the ROI math and in the close.
7. **Know the room.** Ops lead cares about accuracy and effort. Procurement cares about over-buying. Compliance cares about audit evidence. The exec cares about the math in Act 4. Make eye contact with each one when their scene lands.

---

## Timing at a Glance

| Segment | Time | Purpose |
|---|---|---|
| Act 0 — Cold open | 0:00–2:00 | Earn attention, make it about them |
| Act 1 — The five problems | 2:00–6:00 | Frame the scorecard for the whole demo |
| Act 2 — Why nobody solved this | 6:00–8:00 | The data moat — why RackTrack, why now |
| Act 3 — The demo (5 scenes) | 8:00–30:00 | One photo closes all five problems |
| Act 4 — The math | 30:00–33:00 | ROI in their numbers |
| Act 5 — Objections | 33:00–37:00 | Answer doubts before they're asked |
| Act 6 — Close & next step | 37:00–40:00 | Recap five-for-five, propose the pilot |

---

## ACT 0 — Cold Open (0:00–2:00)

**Goal:** In 60 seconds, make this their problem, not your pitch.

**SAY:** "Quick question before I show you anything. If I asked you, right now, exactly what's in rack 14 — every device, every port, every cable — how close would your records be to the truth?"

**[PAUSE. Let someone answer. Do not fill the silence. Whatever they say — honest, defensive, or a laugh — you're in.]**

**SAY:** "That gap — between what the records say and what's actually in the rack — is what today is about."

**SAY:** "Everyone is racing to build AI infrastructure, and data centers are growing faster than the teams who run them can keep up. But the gear inside — every cable, port, and device — is still tracked by hand. People use spreadsheets, they rely on memory, and they walk the floor to check. That makes buying new parts slow, it leaves the records full of errors, and it turns every audit into a long, painful job. And every new rack makes the pile bigger."

**SAY:** "RackTrack replaces all of that with one reliable source of truth for your physical infrastructure — so your team can track every asset, map every cable and port, plan what to buy, and audit any time they want."

**SAY (the demo promise):** "Here's my promise for the next thirty minutes: you'll watch a single photo of a rack become a complete inventory, a full port map, a buy-list, and a finished audit. And I'll keep score out loud against the five problems you live with every day."

> **Why this works:** You've opened with a question (engagement), named the pain in their words (relevance), and made a concrete, checkable promise (tension). The rest of the demo is you keeping that promise.

---

## ACT 1 — The Five Problems (2:00–6:00)

**Goal:** Build the scorecard. Every scene later will explicitly close one of these five.

**SAY:** "Before I show you a single feature, let me name what actually hurts in a data center today — five problems every operator lives with."

**SAY:** "One — asset tracking. Nobody has an accurate, current list of what's really in each rack."

**SAY:** "Two — cabling. Which ports are used, what's plugged in, and where each cable goes lives in people's heads."

**SAY:** "Three — procurement. Teams over-buy, or buy the wrong part, because they can't see what they already have."

**SAY:** "Four — auditing. Proving the rack matches the records is a slow, manual, error-prone job."

**SAY:** "And five — doing all of this at AI scale. Every new rack multiplies the pile faster than any team can keep up."

**DO:** Show the mapping slide:

| The problem | RackTrack's answer | Demo steps |
|---|---|---|
| Asset tracking | Rack scanning + device detection | Scene 1 |
| Cabling | Cable classifier + port detection | Scene 2 (Steps 12, 18–20) |
| Procurement | SFP procurement advisor + marketplace | Scene 3 (Steps 12, 23) |
| Auditing | CMDB reconciliation + port history & drift | Scene 4 (Steps 15, 17, 24) |
| AI-scale operations | Cross-rack topology & network map | Scene 5 (Step 13) |

**SAY:** "Hold those five in mind. Everything I show you today maps straight back to them — and I'll call it out each time we close one."

### Discovery moment — personalize before the pain

**SAY:** "Before I go on — [Name], roughly how many racks are you running today? … And when was your last full audit? How long did it take?"

**[WRITE THE ANSWERS DOWN, visibly. You will use them in Act 4 and Act 6.]**

### The problem up close

**SAY:** "Let me show you the problem at ground level. To document just one rack today, a technician reads every label by hand, counts the ports one at a time, looks up the firmware for each device, and checks it all against the records in ServiceNow. That's fifteen to twenty minutes per rack, it takes a networking expert, and it's easy to get wrong."

**SAY (do the math in their numbers):** "Now picture it at your scale — [their number] racks. At fifteen minutes each, that's [X] hours of skilled work for a single pass. Call it [Y] weeks of an engineer's time spent just typing things in. And the records start going stale the moment you finish typing."

---

## ACT 2 — Why Nobody Solved This Before (6:00–8:00)

**Goal:** Answer the silent question in the room — "Why hasn't someone already done this?" — and plant the moat.

**SAY:** "So why hasn't AI already fixed this? Because the data to train it never existed. Nobody — not anywhere online, not in research — had ever built a labeled dataset of racks, switches, and ports at this level of detail."

**SAY:** "So we built our own. **[N]** annotated images, across **[N]** device families, with **[N]** individually labeled ports and cables. It's ours alone — and it's exactly what lets RackTrack turn a single photo of a rack into a complete, accurate record."

**SAY:** "That dataset is also why what you're about to see is hard to copy. The model is only as good as the data behind it, and this data doesn't exist anywhere else."

**[TRANSITION]** **SAY:** "Enough setup. Let's take the photo."

---

## ACT 3 — The Demo (8:00–30:00)

**Presenter rules for every scene:**
- **Narrate outcomes, not the UI.** Never say "now I click on…" Say what the customer just gained.
- **One wow per scene.** Don't stack features; close the problem and move on.
- **End every scene with the scoreboard line:** "That's problem [n] — closed."

---

### Scene 1 — Asset Tracking (8:00–13:00)
*Closes Problem 1 · Rack scanning + device detection*

**SAY (setup):** "Let's start where every audit starts: what's actually in the rack. Today that's a clipboard job. Watch what it becomes."

**DO:** Take (or upload) the photo of the demo rack. Start the scan.

**[SILENCE while it runs. Do not narrate. Let the room watch the boxes appear. The quiet IS the demo.]**

**SAY (when results land):** "That's every device in the rack — make, model, and rack position, detected from one photo. Serial numbers read where they're visible. Firmware looked up automatically for each device. What took a technician fifteen to twenty minutes and a networking background just took one photo and **[X]** seconds."

**SAY (build trust proactively):** "And notice what it does when it *isn't* sure. Anything below our confidence threshold gets flagged for a human look — it's never silently guessed. You correct it once, and the system learns."

**DO:** Click one flagged/low-confidence item and confirm or correct it, to show the human-in-the-loop flow.

**SAY (scoreboard):** "That's problem one — asset tracking — closed. You now have an accurate, current list of what's really in the rack, and anyone with a phone can produce it."

---

### Scene 2 — Cabling (13:00–18:00)
*Closes Problem 2 · Port detection + cable classifier · Steps 12, 18–20*

**SAY (setup):** "Now the part that lives in people's heads: which ports are used, what's plugged into them, and where every cable goes."

**DO:** Zoom into a switch from the same scan. Show the port detection overlay — occupied vs. free, port by port.

**SAY:** "Every port on this switch, detected and counted. Green is free, occupied is mapped. Nobody counted anything."

**DO:** Click an occupied port. Show cable type classification and what's connected on the other end.

**SAY:** "For each occupied port, RackTrack classifies the cable — fiber, copper, DAC — and reads what it's connected to. This is the knowledge that used to walk out the door when your senior engineer took a vacation. It's now in the record, automatically, on every scan."

**SAY (scoreboard):** "That's problem two — cabling — closed. The tribal knowledge is retired."

---

### Scene 3 — Procurement (18:00–22:00)
*Closes Problem 3 · SFP procurement advisor + marketplace · Steps 12, 23*

**SAY (setup):** "Here's where detection turns into money. Once the system can see your ports, it can tell you exactly what to buy — and what not to."

**DO:** Open the SFP procurement advisor. Show free ports by type, the recommended transceivers/parts with compatibility, and generate the buy-list.

**SAY:** "This buy-list wasn't typed by anyone. It comes from what the camera saw — free ports, port speeds, compatible optics — not from a spreadsheet somebody updated last quarter. So you stop over-buying parts you already have, and you stop ordering the wrong SFP for the switch."

**DO:** Push the buy-list into the marketplace — show it becoming a quote/cart in one step.

**SAY:** "From photo to purchase order, with nothing re-typed in between."

**SAY (scoreboard):** "That's problem three — procurement — closed. You buy from reality, not from memory."

---

### Scene 4 — Auditing (22:00–27:00)
*Closes Problem 4 · CMDB reconciliation + port history & drift · Steps 15, 17, 24*

**SAY (setup):** "Now the one your audit and compliance team will love. Today, proving the rack matches the records means walking the floor with a checklist. Watch."

**DO:** Run the reconciliation against the ServiceNow sandbox. Let it surface the seeded mismatches.

**SAY:** "RackTrack just compared the scan against your CMDB automatically. Everything that matches is confirmed. Everything that doesn't is flagged — with photo evidence attached. Here: ServiceNow thinks this slot holds a [device]; the photo shows it doesn't. That's the kind of drift that used to surface six months later, during an outage."

**DO:** Open the port history / timeline view for one port. Show the drift alert.

**SAY:** "And because every scan is timestamped, you get history. You can see exactly when this port changed, and you can prove the state of any rack on any date. Drift gets caught the day it happens — not the quarter after."

**SAY (the line to land hard):** "An audit stops being a project. It becomes a photo."

**SAY (scoreboard):** "That's problem four — auditing — closed."

---

### Scene 5 — AI-Scale Operations (27:00–30:00)
*Closes Problem 5 · Cross-rack topology & network map · Step 13*

**SAY (setup):** "Last one. Everything so far was one rack. But you don't run one rack — you run [their number]. And you told me that number is growing."

**DO:** Open the cross-rack topology / network map. Trace one connection end-to-end across racks. Filter or zoom by row/site.

**SAY:** "Every rack you scan joins one live map of how everything connects — across racks, across rows, across the site. Trace any link end to end. And here's the part that matters at AI scale: when you stand up ten new racks next month, the map grows with a photo per rack — not with another spreadsheet, another walkthrough, and another week of an engineer's time."

**SAY (scoreboard):** "That's problem five — scale — closed. Five for five."

---

## ACT 4 — The Math (30:00–33:00)

**Goal:** Convert the demo into a number the budget owner will repeat internally.

**DO:** Show the ROI slide, then fill it live with *their* numbers from Act 1.

**SAY:** "Let's put your numbers on it. You said [N] racks and an audit that took [their answer]. At fifteen minutes a rack, one manual pass is [N × 0.25] hours. If you audit [Q] times a year, that's [total] hours of skilled engineering time — just for documentation that's stale on arrival."

**SAY:** "With RackTrack, a rack is a photo and **[X]** seconds. The same pass takes [tiny number] hours, it doesn't need a networking expert, and the record is current every time you scan."

**SAY (the second-order savings):** "And that's only the labor. The errors are where the real money hides: the wrong SFP ordered, the duplicate parts bought because nobody could see the spares, the outage extended because the cable map in someone's head was wrong. Every one of those comes out of the same root cause — records that don't match reality — and that's the thing we just removed."

**[If you have a verified customer proof point, place it here: "At [customer/pilot], that translated to [metric]." If you don't have one, skip — never invent it.]**

---

## ACT 5 — Objections, Answered Before They're Asked (33:00–37:00)

Raise the top two or three yourself — it signals confidence. Keep the rest ready for Q&A (cheat sheet in Appendix B).

**"How accurate is it, really?"**
**SAY:** "On [our benchmark set / pilot racks], detection runs at **[verified %]**. But the honest answer is the design, not the number: anything below the confidence threshold is flagged for human review, never silently guessed. You always know which records are machine-confirmed and which are human-confirmed — and every correction makes the model better on *your* gear."

**"Photos of our racks are sensitive. Where does this data go?"**
**SAY:** "Agreed — a photo of your infrastructure is a map of your infrastructure. **[State your verified deployment and data-handling terms here: on-prem / private cloud / VPC options, encryption, retention, and whether client images are used for training. Confirm each claim with your team before the demo — do not improvise security answers.]**"

**"Our racks are messy. Yours was clean."**
**SAY:** "Fair — demo racks are always suspiciously tidy." **DO:** Pull up the messy real-world rack scan you held in reserve. **SAY:** "This is what the dataset was built for. And better: bring me a photo of your ugliest rack, and we'll run it in the pilot. If RackTrack can't read your worst rack, you should know that before you buy — and so should we."

**"We already have a CMDB / DCIM."**
**SAY:** "Keep it. RackTrack isn't replacing ServiceNow — it's the thing that finally makes ServiceNow *true*. We feed it, reconcile against it, and flag where it drifts from reality. Your system of record stays; it just stops lying to you."

**"Who on my team has time to learn this?"**
**SAY:** "The person doing the scan needs a phone and thirty seconds of instruction. The expertise moved into the model — that's the entire point. Your engineers stop transcribing and go back to engineering."

---

## ACT 6 — Close & Next Step (37:00–40:00)

**SAY (recap on the scoreboard):** "You walked in with five problems. You watched one photo close all five: an accurate inventory — problem one. A complete port and cable map — problem two. A buy-list generated from reality — problem three. An audit with evidence, done automatically — problem four. And a live map that scales with a photo, not a headcount — problem five."

**SAY (the pilot ask):** "Here's what I'd like to do next: prove it on *your* gear, not mine. Pick ten racks — and please include the ugliest one you've got. We scan them together in under an hour, and within [a week] you're holding the inventory, the full port map, and a reconciliation report against your ServiceNow. If it doesn't hold up on your racks, you'll know fast and it cost you an hour. If it does — you've just seen exactly what the other [N] racks will look like."

**SAY (ask for the date):** "Who's the right person to walk the floor with us — and does [specific week] work?"

**[STOP TALKING. The next voice you hear should be theirs.]**
