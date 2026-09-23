# What has shipped

Every build that went to a tester, newest first. Each platform counts on its
own: the next iOS build is the last iOS build plus one, and the same for
Android. Nothing shared, so one platform can never drag the other's number.

Written by `scripts/shipped.mjs`, which `ship-apk.sh` and `ship-ipa.sh` call
on a successful upload. Add a row by hand only if you shipped by hand.

| Date | Platform | Version | Build | To | What went in it |
| --- | --- | --- | --- | --- | --- |
| 2026-09-23 | ios | 1.1 | 5 | TestFlight | • The Admin / SPOC / Employee toggle moved into the Menu and the sidebar • An admin's Home card now introduces what RackTrack does, instead of reporting an empty state • A notice's facts no longer leave blank cells on the row • Once a rack is identified, a switch that answers with the serial the record holds - or at the address it gives - is placed on that shelf |
| 2026-09-23 | android | 1.1 | 83 | Firebase App Distribution | The toggle that shifts between Admin, SPOC and Employee moved into the Menu and the sidebar. An admin's Home card now introduces what RackTrack does instead of reporting an empty state. A notice's facts no longer leave blank cells. The photo-to-switch join: once a rack is identified, a switch that answers with the serial the record holds, or at the address it gives, is placed on that shelf. |
| 2026-09-23 | ios | 1.1 | 4 | TestFlight | • Same build as 83, shipped again as 4 so the iOS count follows 1, 2, 3 • Roles stay in their own area; a rack somebody confirmed is called by its name • Notifications make a sound and open as a message before the drift • The port page shows one card of only what was found |
| 2026-09-23 | ios | 1.1 | 83 | TestFlight | • Roles stay in their own area: a SPOC's bar is Home, Drift and Menu; Port history is off every menu and Organization settings joins the admin's • A rack somebody confirmed is called by its name - on Home, in the report, and on every check • Notifications make a sound and post a notice on the phone; the permission is asked on your Profile • A notice opens as a message first, then one button takes you to its drift • The port page: one card of only what was found, the port type in the line with the number, and View, Share, Another device and New scan on one row • Your picture can be a photo from your gallery, and the drawn faces have their hair fixed • Sign out asks one question |
| 2026-09-23 | ios | 1.1 | 82 | TestFlight | Home rebuilt with the datacenter floor, the notifications bell, the new Profile and its eight pictures, buttons that look like buttons, no truncated text, the SPOC navigation fix |
| 2026-09-23 | android | 1.1 | 82 | Firebase App Distribution | Roles kept straight everywhere: the SPOC's bar is Home, Drift and Menu, and Port history is off every menu while Organization settings joins the admin's. A rack that somebody confirmed is called by its name, on Home, in the report and on every check. Notifications make a sound and post a notice, with the permission asked on your Profile - and a notice opens as a message before it takes you to its drift. The port page: one card of only what was found, the port type in the line with the number, and View, Share, Another device and New scan on one row. Your picture can be a photo from your gallery. Sign out asks one question. |
| 2026-09-23 | android | 1.1 | 81 | Firebase App Distribution | The same. SHIPPED TWICE AS 81 - see the note below |
| 2026-09-23 | android | 1.1 | 81 | Firebase App Distribution | Shipped earlier the same day from the other session |
| 2026-09-23 | android | 1.1 | 80 | Firebase App Distribution | - |
| 2026-09-23 | android | 1.1 | 79 | Firebase App Distribution | - |
| 2026-09-23 | android | 1.1 | 78 | Firebase App Distribution | - |
| 2026-09-22 | android | 1.1 | 77 | Firebase App Distribution | - |
| 2026-09-22 | ios | 1.1 | 3 | TestFlight | The last iOS build before the numbering was put right |

## The iOS list under 1.1 reads 1, 2, 3, 82, 83, 4

The owner asked on 23 September 2026 for iOS to go back to 4 and keep counting
from there. I said Apple would refuse a build lower than one already uploaded
under the same version. **That was wrong**, and the upload proves it: 1.1 (4)
was accepted and came out VALID with 83 already there.

What is actually true:

- **TestFlight** wants the build to be UNIQUE within the version, not higher.
  A number below one already uploaded goes through.
- **App Review** is where the higher-than rule bites: the build submitted for
  release must be above every build released under that version. That matters
  the day RackTrack is submitted, not while it is being tested.
- **Android** is stricter in the other direction: a phone refuses to install a
  lower version code over the one it has, so Android keeps counting up.

So iOS follows its own line - 1, 2, 3, 4, and on from there - and Android
follows its own. The two are not related and are never made to match.

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
