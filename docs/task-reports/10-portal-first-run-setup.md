# Portal: first-run onboarding container and Organization settings

Ticket SPRTMS-1666, sub-tasks SPRTMS-1668 to 1672. First cut built 11 September 2026; rebuilt to the owner's direction on 15 September 2026 and live on portal.racktrack.ai the same day.

## How it was before

An organization was a name and an admin. A site was a name. Nothing asked where the racks are, who approves a change, who a ticket goes to, which vendors are in use, or how to reach a switch. The first attempt on 11 September was a form inside the portal shell; the owner rejected it. The second was a full-screen flow with a step rail, a "why we ask" panel and a progress meter, plus a "Being set up" page for technicians. On 15 September the owner rejected the rail and the full page ("show as a popup container, one after another flow, don't show the bar, next and back are enough") and the technician hold ("setup will be done by the admin before the technician comes").

## What we decided, and why

- The setup is a centred container over the portal, a 640 px card on a light backdrop, full screen at phone width. One step at a time, a short title and one line of help, then only Back and Next (Finish on the last step). No step bar, no numbering, no progress marker.
- Ten sections: Organization, Datacentres, Spaces and racks, People, Systems, Vendors, Naming, Switch access, Rules, Review. Flat, enterprise-grade forms (owner, 15 September afternoon: no neumorphism, less text, better English): white fields with a hairline border, a red star after each mandatory label and nothing on optional fields, one "* Required" line per step, one short help line per step. The last step lists what is still needed and what is not filled yet, each linking back to its step.
- Enterprise fields: the organization carries a primary contact; a datacentre is a facility record (address lines, city, region, postcode, country, time zone, coordinates, facility code, provider, opening hours, access notes); a space has a kind, floor, room, row, facility ID and rack count.
- It opens by itself for an owner or org admin whose organization still lacks the three required facts, and on demand from Organization settings, where every section is also editable in place.
- Nobody is gated. The "Being set up" page and the blocked state are gone; a technician who signs in lands on the portal. The server answers blocked:false for everyone.
- Nothing is guessed: the browser's time zone and a proposed short code are offered, the country is chosen by a person.

## What we built

Portal: `src/components/setup/SetupModal.jsx` (the container: open or closed from the gate or `?setup=<step>`, step, validity, Back / Next / Finish, Escape, scroll lock), `setup-modal.css`, `fields.jsx` (fields with Required / Optional markers, groups with one lead line), `remaining.jsx` (the Remaining list), `sections-estate.jsx` (organization, datacentre as a facility record, spaces, people, rules, review), `sections-profile.jsx` (systems, vendors, conventions, switches), `src/lib/setup.js` (the step model, what is required, what is done, the remaining list, the gate decision that never returns blocked), `src/lib/useSetup.js` (loading, saving each section, the facility section, re-reading the gate), `src/pages/OrgSettings.jsx` (progress card with meters and the Remaining list, "Open the setup", the editable panels). `/welcome` and `/setup` redirect to Organization settings with the container open. Deleted: `Welcome.jsx`, `BeingSetUp.jsx`.

Server, in the app repository: `server/lib/estate.js` and `server/lib/estate_profile.js` hold the tree, the approver, the rules, the organization profile (now with primary contact name and email) and seven per-datacentre sections (contacts, vendors, conventions, systems, network, facility, SNMP stored encrypted). Spaces carry kind, floor, room and row. `server/routes/setup.js` exposes them under `/api/setup`. `/api/auth/me` carries `setup: {needsSetup, blocked, reason}`, with blocked always false.

## How it works

After sign-in the portal reads `user.setup`. An owner or org admin with `needsSetup` true sees the container over whatever page they opened; it stays until the three required facts are on the server. Every write returns fresh completeness and the client re-reads `/api/auth/me`, so the container closes without a re-login. Finish asks the server once more; if a required item is still missing the card says which. A datacentre counts as addressed only from the structured facility fields; the old one-line address is kept in sync from them.

## The rule we hold to

Nothing invented: a value no person or record stated stays blank. Secrets go in encrypted and never come back out. No vendor, naming convention or rack is special-cased in code. A member is never held.

## An example

The toat admin signs in on the portal for the first time. The container opens on Your organization with the name filled and a short code proposed; they choose the country, add a primary contact and press Next. They add Sprintpark HQ with its address, city, country and time zone, a space Hall 1 of kind hall with six racks, pick themselves as approver, skip the optional sections with Next, accept the rules and press Finish on the review step. The card closes over the Overview page. A technician invited that afternoon signs in and sees the portal.

## What we found

- The settings page rendered the same forms under the container, giving duplicate ids; the panels are hidden while the container is open.
- The browser's time zone was shown for a new datacentre but never saved once the address moved to the facility section; it now rides on the first facility save.
- At phone width the card was pinned to the viewport height and the step spilled under a footer that sat mid-screen; fixed and measured.
- A focus ring on the step body overrode the base rule; fixed.
- The step title said "organisation" while the portal navigation says "organization"; the setup strings now use one spelling.

## Measured

- Portal: lint 0 errors, 3 warnings that were there before in Approvals; build clean, 586 kB JS, 119 kB CSS.
- Browser drive at 1440 px and 390 px against a stub of the server contract: steps 1 to 9 filled, Next held on an incomplete required step, the stub received kind, floor, facility, derived address and time zone, Finish closes the card and the settings page refreshes, reopen and close; no page errors, no horizontal overflow.
- Server suite: 244 tests, 218 pass, 0 fail, 26 skipped.
- Live: bundle deployed to portal.racktrack.ai on 15 September, and again after the restyle; two fresh organizations walked the restyled setup live at 1440 px and 390 px with no errors and were removed afterwards.

## How to check it yourself

Sign in on portal.racktrack.ai as the toat admin: the container opens on Your organization. Press Next and Back through the steps; Finish on the last one. Sign in as the owner, open Organization > Settings: the progress card lists what is still required and "Open the setup" reopens the container. Sign in as a technician of any organization: the portal opens with no hold page.

## Where it lives

Portal repository: `src/components/setup/`, `src/lib/setup.js`, `src/lib/useSetup.js`, `src/pages/OrgSettings.jsx`, `src/App.jsx`, `src/components/shell/Layout.jsx`, `docs/USER-GUIDE.md`, `docs/API-MAPPING.md`. App repository: `server/lib/estate.js`, `server/lib/estate_profile.js`, `server/routes/setup.js`, `server/test/setup*.test.js`, `docs/features/organisation-setup-developers.md`.

## What is not done

- A live drive as an org admin on the real server is for the owner to try; the drive above ran against the stub.
- No guide chapter with screenshots for the container yet.
- Nothing is committed in either repository.
