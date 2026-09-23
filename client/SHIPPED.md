# What has shipped

Every build that went to a tester, newest first. Each platform counts on its
own: the next iOS build is the last iOS build plus one, and the same for
Android. Nothing shared, so one platform can never drag the other's number.

Written by `scripts/shipped.mjs`, which `ship-apk.sh` and `ship-ipa.sh` call
on a successful upload. Add a row by hand only if you shipped by hand.

| Date | Platform | Version | Build | To | What went in it |
| --- | --- | --- | --- | --- | --- |
| 2026-09-23 | ios | 1.1 | 82 | TestFlight | Home rebuilt with the datacenter floor, the notifications bell, the new Profile and its eight pictures, buttons that look like buttons, no truncated text, the SPOC navigation fix |
| 2026-09-23 | android | 1.1 | 81 | Firebase App Distribution | The same. SHIPPED TWICE AS 81 - see the note below |
| 2026-09-23 | android | 1.1 | 81 | Firebase App Distribution | Shipped earlier the same day from the other session |
| 2026-09-23 | android | 1.1 | 80 | Firebase App Distribution | - |
| 2026-09-23 | android | 1.1 | 79 | Firebase App Distribution | - |
| 2026-09-23 | android | 1.1 | 78 | Firebase App Distribution | - |
| 2026-09-22 | android | 1.1 | 77 | Firebase App Distribution | - |
| 2026-09-22 | ios | 1.1 | 3 | TestFlight | The last iOS build before the numbering was put right |

## Two things this file exists to stop

**Build 81 went out twice on 23 September 2026.** `ship-apk.sh` did not touch
`versionCode` at all - it built whatever `build.gradle` happened to say - so
two ships in a row sent the same number. Firebase takes a duplicate without
complaining and testers see the same version twice, with no way to tell which
one they have. `ship-apk.sh` now bumps from the last row in this file, so it
cannot happen again.

**iOS jumped from 3 to 82 the same day.** The build number used to be one
counter shared by both platforms - `make-ipa.sh` took `max(iOS, Android) + 1`
and wrote it to both project files. The iOS project had drifted back to 3
while Android went on shipping, so the next TestFlight build had to clear 81.
Correct, and impossible to explain to anybody reading the two numbers. Each
platform counts on its own now.
