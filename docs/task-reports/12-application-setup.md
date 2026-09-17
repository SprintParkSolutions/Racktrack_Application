# Application: Organization settings, the first-run container, and the space picker on Scan

Ticket SPRTMS-1676, no sub-tasks. First cut built 11 September 2026; rebuilt to the owner's direction on 15 September 2026 and live on demo.racktrack.ai the same day.

## How it was before

After sign-in an admin landed on the console and a technician on Scan. Nothing asked where the racks are or who approves a change, so every scan started from the whole estate, and an admin whose only device was the phone had no way to set the organization up at all. The first cut of 11 September added a full-page Setup with a step bar across the top (Where, Who, Rules, Review) and a "Being set up" hold for technicians. The owner rejected both: the step bar and the full page, and any screen shown to a technician.

## What we decided, and why

- The setup is a popup container over the application, one step at a time, with only Back and Next at the bottom. No step bar, no tabs, no numbered circles. The container is full screen on a phone and a centred card of about 660 px on a desktop.
- It carries the same ten sections as the portal, read from the same server state: Organization, Datacentres, Spaces and racks, People, Systems, Vendors, Naming, Switch access, Rules, Review. Flat, enterprise-grade forms (owner, 15 September afternoon: no neumorphism, less text, better English): white fields with a hairline border, a red star after each mandatory label and nothing on optional fields, one "* Required" line per step, one short help line per step and no explanatory paragraphs. The last step lists what is still needed and what is not filled yet.
- Only an org admin sees it, opened on first sign-in while setup is needed. Afterwards it lives under Profile > Organization settings, where every section is editable in place and the container can be walked through again. It is never called "Setup" in the product.
- A technician is never gated. The admin finishes setup when the organization is created and invites people afterwards, so the "Being set up" page was removed and the server answers blocked:false for everyone.
- The Scan page asks which space the technician is standing in and sends it with the photo, so the rack is bound to a space from its first scan.

## What we built

- `client/src/pages/SetupPage.jsx`: decides once on load whether to open the container (first run) or the settings view; `FlowModal` is the portalled container with the step title, one help line, the section, and Back / Next (Finish on the last step); `Settings` is the panel view with a section index, a progress pane and the Remaining list.
- `client/src/components/orgsettings/`: `Fields.jsx` (the flat control kit: fields with the star marker, inputs, selects, buttons, save marks, pickers, secrets), `SectionsEstate.jsx` (organization, datacentres as a facility record, spaces with kind / floor / room / row, people with four named contact slots and the approver, rules, review), `SectionsProfile.jsx` (systems, vendors, conventions, network and SNMP).
- `client/src/utils/orgSettings.js`: the step list, what counts as done, progress and the Remaining list, short-code proposal, validators; `client/src/hooks/useOrgSettings.js`: loads state and profiles, writes each section, refreshes the user after every write so the first-run gate lifts without a re-login.
- `client/src/utils/setupGuard.js`: an owner or org admin with needsSetup goes to the container; everyone else passes. `client/src/pages/BeingSetUpPage.jsx` deleted.
- Server (shared with the portal): profile section `facility` per datacentre, `primary_contact_name` and `primary_contact_email` on the organization profile, `kind`, `floor`, `room`, `row` on spaces; members never blocked. See `docs/features/organisation-setup-developers.md`.
- On Scan, a picker of the caller's site spaces that remembers the last choice and appends the space to the photo upload.

## The rule we hold to

Scanning is never blocked on the picker or on setup: a site with no spaces gets no picker and nothing is sent. The platform owner is never redirected. A member is never held. Nothing is guessed on the admin's behalf.

## An example

The toat admin signs in on the phone. The container opens on Your organization with the short code proposed and the time zone filled from the phone; they press Next through Datacentres (address, city, country, provider), Spaces (Hall 1, six racks), People (themselves as approver), skip the optional sections, accept the rules, and press Finish on the review step. They land on Scan, where the picker offers Hall 1. A technician invited the same afternoon signs in and opens Scan directly.

## What we found

- The step counter "Step n of 10" was left in the container header by the builder; removed, since the owner asked for no progress marker of any kind.
- Duplicate ids and a double arrival save while the container was open over the settings panels; the panels now unmount while the flow is open.
- The product tour prompt opened over the container; it is held back on the settings route.
- The review rows were mis-placed by grid auto-placement; fixed.
- Two apostrophe string literals were broken by the long-dash sweep; fixed.
- The owner's Remove on an organization failed with an internal error once a Site had any setup data: the new tables and the approver reference Sites and members, foreign keys are on, and the delete rolled back whole. The delete now clears the setup rows, refresh tokens and every "who did it" reference first; verified live by removing Demo Kestrel Networks. Test: `server/test/org_remove.test.js`.
- The simulator ran a web bundle with no server address for an hour: a plain `npm run build` had rebuilt dist between the phone build and the copy into the iOS project, so the sign-in never reached the server. The phone build now stamps `dist/.api-base` and `cap copy` refuses a bundle without it.

## Measured

- Client tests: 136 pass, 1 skipped, of which 11 cover the step model and 7 the gate decision; production build clean. After the restyle: the same counts, no Required / Optional words and no long dashes left in the setup files.
- Browser drive at 390 px and 1280 px against a stub API: an admin with needsSetup redirected from Scan to the container; Next on an unfinished required step shows the field messages; all ten steps driven; Finish lands on Scan; the settings view reopens and closes the container; no element past the viewport edge at 390 px.
- Live: demo rebuilt at 08:35 UTC on 15 September and again at 13:26 UTC with the restyle; the iOS simulator app rebuilt against demo.racktrack.ai; a Sprintpark HQ technician who saw "Being set up" that morning now opens on Scan. Two fresh organizations walked the restyled setup live at 390 px and 1280 px with no errors and were removed afterwards.

## How to check it yourself

Sign in on demo.racktrack.ai as the toat admin: the container opens on Your organization. Press Next and Back through the steps; close it from the last step. Open Profile > Organization settings: every section is editable there and "Walk through again" reopens the container. Sign in as a technician of any organization: Scan opens directly.

## Where it lives

`client/src/pages/SetupPage.jsx` and `SetupPage.module.css`, `client/src/components/orgsettings/`, `client/src/utils/orgSettings.js` and its test, `client/src/hooks/useOrgSettings.js`, `client/src/utils/setupGuard.js` and its test, `client/src/App.jsx` (the gate), `client/src/pages/ProfilePage.jsx` (the entry), `client/src/pages/ScanPage.jsx` (the picker). Server: `server/lib/estate.js`, `server/lib/estate_profile.js`, `server/routes/setup.js`.

## What is not done

- The native builds need a location permission entry (iOS Info.plist, Android manifest) before Use my location works; it works in the browser.
- The drive against the real server covered the owner's settings view only; an org admin's first run on the live server is for the owner to try.
- Nothing is committed.
