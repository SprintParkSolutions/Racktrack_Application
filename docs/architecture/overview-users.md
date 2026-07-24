# How RackTrack Works

*A plain-language tour of the whole system — no technical background needed. The best page to hand someone new to RackTrack.*

**Audience:** Everyone — users, customers, and anyone who wants the big picture · **Document date:** 24 July 2026 · Part of the RackTrack documentation set. *A developer version with the technical detail lives alongside this one.*

---

## On this page

1. What RackTrack does
2. The main parts, in plain terms
3. What happens when you scan a rack
4. Who can see what
5. How it connects to your other tools
6. How it gets smarter over time
7. How you get it
8. The ideas we built it on
9. Words we use

---

## 1. What RackTrack does

You take **one photo of a server rack** with your phone or tablet. RackTrack looks at that photo and works out what's in the rack — every shelf position, every switch, patch panel, PDU and server, and the ports on each one. It lays that back over your photo so you can see exactly what it found, checks it against your existing records, and turns it into a tidy report you can share.

In short: **point, shoot, and get a documented rack in seconds** — instead of writing it all down by hand.

## 2. The main parts, in plain terms

RackTrack is made of a few pieces that work together. You only ever touch the first one.

- **The app in your hand.** This is what you see and tap — on an iPhone, an Android phone, an iPad, or in a web browser on a laptop. It takes the photo, shows the results, and lets you correct anything that's wrong.
- **The service behind it.** When you take a photo, the app sends it to RackTrack's service, which does the heavy lifting and sends the results back. It also keeps track of who you are, what you're allowed to see, and your history of scans.
- **The "eye" that reads the photo.** Inside the service is a set of trained AI vision models — the part that actually recognises a switch, counts its ports, reads the make and model off the faceplate, and tells a network cable's colour. This is where the photo becomes structured information.
- **The memory that improves it.** Every time you correct something, RackTrack remembers the fix. Later scans of similar-looking equipment can apply what it learned, so the tool gets better at recognising *your* kit over time.

Around these sit connections to your other systems — your records database, your live switches, and more — described further down.

## 3. What happens when you scan a rack

Here is the journey of a single photo, start to finish:

```
You take one photo
        ↓
RackTrack checks the photo is usable   (straight, clear, and actually a rack)
        ↓
The AI reads it                        (finds every device, port and label)
        ↓
You see the result                     (your photo, with everything boxed and named)
        ↓
You confirm or correct                 (a tap to fix anything it got wrong)
        ↓
It's checked and saved                 (compared to your records; kept in your history)
        ↓
You share a report                     (a clean PDF, or straight to Teams / Slack / email)
```

1. **You take the photo.** The app can use the live camera or a picture you already have.
2. **RackTrack checks the photo first.** If it's too tilted, too dark, or the cabling hides too much, you're told why and asked to retake it — or you can choose to proceed anyway. This saves you from getting poor results.
3. **The AI reads the rack.** It finds each device, works out what type it is, counts and identifies the ports, and reads the make and model where the label is legible.
4. **You see it laid over your photo.** Every device gets a labelled box. You can zoom in, pick a device, and drill into a single port.
5. **You confirm or correct.** RackTrack asks simple questions like *"Detected as Switch — right?"* One tap confirms it; if it's wrong, you pick the correct answer. Your fixes stick.
6. **It's saved and can be checked.** The result goes into your scan history and can be compared against your records database to spot anything that doesn't match.
7. **You share it.** Turn the scan into a report and view it, download a PDF, or send it straight to Teams, Slack or email.

## 4. Who can see what

RackTrack keeps every customer's data separate and private. Access follows a simple ladder:

- **A team member** sees the racks for their own site.
- **A site manager** looks after one site.
- **An organization admin** oversees all the sites in their organization.
- **The platform owner** (that's us) can see across the whole platform to support and maintain it.

You only ever see what belongs to you and your team. Nothing crosses between one customer and another.

## 5. How it connects to your other tools

RackTrack is more useful when it talks to the systems you already run. Each of these is optional — RackTrack works fine without them, and simply turns the feature off if it isn't set up:

- **Your records database (CMDB, e.g. ServiceNow).** RackTrack compares what it saw in the photo against what your records *say* is in the rack, flags the differences, and can raise a change for approval — so your records stay honest.
- **Your live switches.** With permission, RackTrack can check a switch directly to see what's really plugged in right now, and can watch over time for ports that change — useful for spotting drift.
- **Your live network map.** RackTrack can line up a scanned rack with what your network can actually see on the wire, matching physical devices to their live network identities.
- **The marketplace.** A place to buy and sell surplus hardware, built into the app.
- **The built-in help assistant ("DOT").** Answers questions from RackTrack's own verified documentation. It's careful by design — if it isn't sure, it says so and points you to support rather than guessing.

## 6. How it gets smarter over time

RackTrack is not frozen. The AI ships already trained, but the real world always has surprises — an unusual switch, an odd label, a device the model hasn't seen much of.

Every correction you make is quietly saved as a teaching example, together with the exact part of the photo it refers to. Two things happen with that:

- **Right away**, a scan of the same rack — or a very similar-looking device — can automatically apply the fix you already made.
- **Over time**, those corrections feed back into training, so the models get better where *your* equipment differs from what they first learned on.

The more you use it, the more it fits your fleet.

## 7. How you get it

RackTrack comes in two forms, from the same product:

- **A mobile app** for iPhone, iPad and Android — the natural choice for someone standing in front of a rack with a camera.
- **A web version** you open in a browser on a laptop or desktop — handy for reviewing results, running reports and administration.

The words and features are the same across all of them; the layout simply adapts to the screen you're on.

## 8. The ideas we built it on

A few principles shape how RackTrack behaves:

- **Trust the photo, ask before touching anything live.** The result reflects what the photo showed. RackTrack only reaches out to a real switch when you specifically ask it to — it never quietly connects to your equipment in the background.
- **Keep every customer separate.** Your data is walled off from everyone else's, and access always fails safe: if in doubt, RackTrack shows *less*, never more.
- **Improve where it matters.** Rather than trying to be perfect everywhere, RackTrack learns from the corrections you actually make, so it improves on the equipment you actually have.
- **Be honest.** When the tool is unsure — a photo it can't read, a question it can't answer — it says so plainly instead of guessing.
- **Keep it clean and simple.** One clear, light, uncluttered look across every screen.

## 9. Words we use

| Term | What it means |
|---|---|
| **Scan** | One photo of a rack, and everything RackTrack worked out from it. |
| **Unit (U)** | One slot in a rack. A device fills one or more units. |
| **Device** | A piece of equipment in the rack — a switch, patch panel, PDU, server, and so on. |
| **Ground truth** | A person confirming what a device really is, so we can measure and improve the AI. |
| **Drift** | A change in a switch's live ports over time — something plugged in or unplugged. |
| **CMDB** | Your records database (e.g. ServiceNow) that says what *should* be in each rack. |
| **Site / Organization** | Your team's location, and the group of locations it belongs to. |

---

— How RackTrack Works —
