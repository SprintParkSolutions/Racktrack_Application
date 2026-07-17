# RackTrack documentation

Everything user-facing lives in this folder.

## User guide

The same guide in three formats, in two editions — one per device. The **content is
identical**; only the screenshots differ.

| | iPhone / Android | iPad (landscape) |
|---|---|---|
| **Word** (print, share, edit) | [RackTrack-User-Guide-iPhone.docx](user-guide/RackTrack-User-Guide-iPhone.docx) | [RackTrack-User-Guide-iPad.docx](user-guide/RackTrack-User-Guide-iPad.docx) |
| **HTML** (self-contained, opens in any browser) | [RackTrack-User-Guide-iPhone.html](user-guide/RackTrack-User-Guide-iPhone.html) | [RackTrack-User-Guide-iPad.html](user-guide/RackTrack-User-Guide-iPad.html) |
| **Markdown** (diff-friendly, for the repo) | [RackTrack-User-Guide-iPhone.md](user-guide/RackTrack-User-Guide-iPhone.md) | [RackTrack-User-Guide-iPad.md](user-guide/RackTrack-User-Guide-iPad.md) |

Which one do I send someone?

- **A technician in the field** — the iPhone edition. The scanning workflow is a phone job.
- **Someone at a desk** — the iPad edition. It shows the sidebar layout, which is also what
  a laptop or desktop browser shows.
- An **upright iPad** shows the phone layout, not the sidebar — so send those users the
  iPhone edition.

The HTML files are self-contained (images are embedded), so they can be emailed or dropped
on a share with nothing else alongside. They also print cleanly — **Print → Save as PDF**
gives one task per page.

### How the guide is organised

It is built around **31 tasks**, not around screens — "Find a specific port", "Find out what
changed, and when", "Scan a rack too tall for one photo". The contents page asks *"What do
you want to do?"* Each task is one card: numbered steps on the left, the screenshot on the
right.

Tasks run in the order you meet them: get in → scan a rack → use the results → go deeper on
the equipment → look things up → your account → administration. Reference material
(troubleshooting by symptom, glossary, limits, and which screens need setting up) is at the back.

## Screenshots

- [screenshots/iPhone/](screenshots/iPhone/) — 30 PNGs, captured at 390×844
- [screenshots/iPad/](screenshots/iPad/) — 30 PNGs, captured at 1194×834 (landscape)

Filenames match one-to-one across the two folders, so `iPhone/netdisco.png` and
`iPad/netdisco.png` are the same screen on the two devices. These are the same images
embedded in the guides, at full 2× resolution — drop them straight into a deck.

Every screenshot was captured from the running application against real scan data
(rack `RK-325D10C3` and the bench TP-Link TL-SG2428P), not mocked up.

## Feature notes

[features/](features/) — one document per feature, written for the team rather than for end
users. Deeper than the user guide, and it assumes you know the product.

## Reference

- [reference/RackTrack_UI_Reference.docx](reference/RackTrack_UI_Reference.docx) — UI reference
- [reference/RackTrack_User_Guide_2026-07-09.docx](reference/RackTrack_User_Guide_2026-07-09.docx) —
  the previous user guide (superseded by `user-guide/` above; kept for reference)
