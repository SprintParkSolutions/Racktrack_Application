# Ground Truth

**Feature Reference** · *Technicians tell us the real identity of each device the model detected, so we can find where detection is wrong and teach the model to do better.*

**Category:** Owner feature — model quality & training data · **Audience:** Platform owners (for now) · **Document date:** 24 July 2026 · Part of the RackTrack documentation set.

---

## On this page

1. In simple terms
2. At a glance
3. How it works — step by step
4. Where the input comes from
5. What it produces (output)
6. What you see on screen
7. The logic behind it
8. Detailed technical explanation
9. Real data vs. synthetic
10. Who can use it, and how to open it up later
11. Use cases

---

## 1. In simple terms

Our model looks at a rack photo and guesses what each device is — "that's a switch," "that's a patch panel." It is right most of the time, but not always. The problem is that **we don't know which guesses are the wrong ones**, and we can't fix what we can't see.

Ground Truth solves that. It shows a real technician the exact device the model was unsure about, asks a simple question — *"We think this is a Patch Panel. Is that right?"* — and records the honest answer. Technicians know their own kit, so their answer is the **truth**. Every answer either confirms the model was right or corrects it, and both are useful: confirmations build confidence, corrections become training examples that make the model smarter next time.

It is a two-part screen. A **Worklist** hands you the devices most likely to be wrong, one at a time, so you can clear them fast. A **Browse** view lets you open any past scan and check every device in it. Either way, the goal is the same: turn "we think" into "we know."

## 2. At a glance

| | |
|---|---|
| **Category** | Owner tool for measuring and improving model accuracy. |
| **Who uses it** | Platform owners today. Built so it can be opened to any technician later with a one-line change. |
| **Where input comes from** | Every rack scan already on the platform, plus the technician's confirm/correct answers. |
| **What it outputs** | Verified device labels ("ground truth"), a live accuracy score, and labelled training data for retraining. |
| **Data source** | REAL — the model's own detections and a human's verified answer about real equipment. |

## 3. How it works — step by step

```
Model scans racks            →   every device gets a class + a confidence score
        ↓
Ground Truth gathers them    →   the still-unverified devices, least-confident first
        ↓
Technician sees one device   →   the cropped photo, the model's guess, its confidence
        ↓
Confirm  or  Correct         →   "Correct"  ·  or  "Not this" → pick the real type
        ↓
Answer is saved as truth     →   confirmation or correction, tied to that exact device
        ↓
Accuracy updates + training  →   the score moves; corrections feed the retraining loop
```

**Walkthrough (Worklist)**

1. Open **Ground Truth** from the sidebar (owner-only) and stay on the **Worklist** tab.
2. The top strip shows the score so far: how many devices still need truth, how many you've done, and the current model accuracy.
3. One device is shown at a time: a tight crop of the real device from the photo, the model's guess (e.g. "Patch Panel"), and a colour-coded confidence chip.
4. If the guess is right, press **Correct**. If it's wrong, press **Not this**, choose the real device type from the list, and press **Save truth**.
5. The card advances to the next device — always the least-confident one still unverified — so you spend your time where the model is weakest.
6. When the batch is clear, load the next one, or switch to Browse.

**Walkthrough (Browse)**

1. Switch to the **Browse scans** tab.
2. Pick any scan from the grid — each card shows a thumbnail and a progress bar of how much of that rack has been truthed.
3. Inside a scan you see the rack image and a row per device. Confirm or correct any of them in place; a device you've already ruled on shows a **Confirmed** or **Corrected → X** badge, with a **Change** link if you need to revisit it.

## 4. Where the input comes from

- **The scans themselves** — Ground Truth reads the devices the model already detected in every rack scan on the platform. Nothing new is scanned; it works on what you already have.
- **The confidence score** — every detected device carries a number from the model saying how sure it was. Ground Truth uses this to decide what to show first.
- **The original photo** — used to cut a close-up crop of the one device in question, so the technician sees exactly what to identify.
- **The technician's answer** — a Yes/No verdict and, when it's "no", the correct device type chosen from a fixed list.

## 5. What it produces (output)

- **Verified labels ("ground truth")** — a permanent record, per device, of what it really is.
- **A model-vs-truth accuracy score** — how often the model agreed with the human, across everything reviewed.
- **Training data** — every correction is saved with the exact image crop and the model's original guess, ready for the retraining pipeline.
- **A shrinking worklist** — as devices are truthed they leave the queue, so the remaining work is always the unverified, low-confidence tail.

## 6. What you see on screen

- **Two tabs** — Worklist (the fast, one-at-a-time queue) and Browse scans (open any rack).
- **A stats strip** — Remaining · Truthed · Model accuracy · Scans, so progress is always visible.
- **The device card** — a cropped photo of the device, the model's guess in large type, a confidence chip (green = high, amber = medium, red = low), and the scan it came from.
- **The answer control** — a clear **Correct** / **Not this** choice; choosing "Not this" reveals a device-type picker and a **Save truth** button.
- **Truth badges** (in Browse) — **Confirmed** (green) or **Corrected → Router** (red), each with a **Change** link.
- **Empty states** — "All caught up" when nothing is left to verify, and a gentle "no scans yet" when the platform has none.

## 7. The logic behind it

- **Show the weakest first.** The worklist is sorted by the model's confidence, lowest to highest, with genuinely unrecognised units at the very front. A technician's minute is best spent where the model is least sure, not on devices it already nails.
- **Ask, don't assume.** The model's guess is offered, never forced. The human always has the final word, because the human is the source of truth.
- **One honest question at a time.** Type-only answers ("what kind of device is this?") keep each decision fast and unambiguous, which keeps the data clean.
- **Reuse the proven path.** Saving a truth does not invent new plumbing — it goes through the same, already-trusted correction pipeline the results screen uses, so a truth given here behaves exactly like a correction given there.
- **Every answer counts twice.** A confirmation raises confidence in the model; a correction becomes a labelled training example. Neither is wasted.

## 8. Detailed technical explanation

**The worklist queue.** The server walks every rack scan the caller is allowed to see, reads each detected device and its confidence, and drops the ones already verified. What's left is sorted least-confident-first (unrecognised units, which have no confidence, lead the queue) and returned with platform-wide stats — total devices, how many are truthed, and the running accuracy. The owner sees every scan; the same code is written to respect per-role visibility, so opening the tool to other roles later needs no change to the queries.

**The device crop.** Each device is shown as a tight close-up cut from the original photo on first request and cached, so repeat views are instant. If a crop can't be made, the card falls back to the whole annotated rack image, then to a placeholder — the technician is never left staring at a blank box.

**Saving the truth.** A confirm or a correct reuses the platform's existing device-feedback path. That path does three things at once: it updates the stored detection so re-opening the scan reflects the corrected type; it appends an immutable record — with the original guess, the new answer, a timestamp and the image crop — to the feedback log; and it hands that labelled crop to the active-learning memory so future scans of similar-looking devices can auto-apply the corrected label. A model-vs-truth scoreboard is kept alongside the scan, so accuracy is intrinsic, not computed after the fact.

**Access.** Every Ground Truth endpoint is owner-only on the server. The screen also refuses non-owners, and the navigation entry is hidden from them — three independent gates, so the tool can't be reached by mistake.

## 9. Real data vs. synthetic

| Thing on screen | Real or synthetic |
|---|---|
| The device crops and the model's guesses | **REAL** — straight from the model's detections on your photos. |
| Confidence scores and their ordering | **REAL** — the model's own certainty per device. |
| The accuracy score | **REAL** — the human-verified agreement rate. |
| A verified label ("ground truth") | **REAL** — a technician's answer about real equipment. |
| "Unidentified" units at the front of the queue | REAL devices the model could not classify — surfaced deliberately so a human can name them. |

## 10. Who can use it, and how to open it up later

Ground Truth is **owner-only for now** while we prove it out. When you're ready to let every technician contribute truth, it takes one small change: drop the owner check on the navigation entry and swap the route's owner guard for the normal signed-in guard. The server queries already scope results to what each role is allowed to see, so nothing else needs to change — a member would simply see and truth their own site's scans.

## 11. Use cases

- **Finding where the model is wrong.** Instead of guessing which detections are off, the worklist surfaces the shakiest ones and a human settles them — turning an unknown error rate into a measured one.
- **Building a training set with no extra scanning.** Every correction is a labelled example, gathered from racks you already scanned, at the moment a human notices the mistake.
- **Tracking accuracy over time.** The score is a simple, honest number you can watch move as the model improves.
- **Cleaning up a specific rack.** Browse to one scan and confirm or fix every device in it, so that rack's record is fully human-verified.

---

— Ground Truth —
