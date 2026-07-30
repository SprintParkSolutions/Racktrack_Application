# Multi-Rack Scans (Two Racks)

*Capture two racks in one go — RackTrack analyses each, links them together, and shows them side by side with the uplink cabling that runs between them.*

Feature · Field technicians · Last verified: 26 July 2026 against the live code.

---

## 1. In simple terms

Most of the time you scan one rack and get one report. But racks rarely live alone. In a real aisle you usually have two racks sitting next to each other, wired together — one rack's switches uplink across to the other rack. If you scanned each rack on its own, you would get two separate reports and nothing that shows how they relate. **Multi-Rack Scans (Two Racks)** fixes that: you capture two racks together, and RackTrack keeps them as a pair.

Here is the whole idea in one sentence: you give RackTrack two racks — either **one photo of each** or **one video that pans across both** — and it detects each rack separately, then ties the two together into a single "group" you can flip between and view in one combined picture.

Why bother pairing them instead of scanning each alone? Because of the cabling *between* them. Two racks in the same row almost always share uplinks — the connections that carry traffic from one rack over to the other. When the two racks are grouped, RackTrack can draw those crossing cables for you, so you can see at a glance which switch in Rack 1 reaches across to which switch in Rack 2. That between-rack view is the main thing the pairing gives you that two separate scans never could.

Everything else stays exactly as you already know it. Each rack in the pair is still a complete, normal scan — it has its own devices, its own ports, its own topology, its own report. Grouping does not change how a single rack is analysed. It just adds a thin layer on top that remembers "these two were captured together," lets you switch between them with a tap, and offers a combined view of the two racks together.

## 2. At a glance

| | |
|---|---|
| **What it is** | Capture two racks together as one linked pair (a "group"). |
| **Who uses it** | Field technicians documenting two racks that sit and cable together. |
| **Two ways in** | **Two photos** (one photo per rack) or **One video** (pan across both racks). |
| **Where you start** | The "Scan two racks" screen. |
| **What you get** | Each rack analysed in full, plus a combined view with the cabling that runs *between* the two racks. |
| **How you move between racks** | A "Rack 1 / Rack 2" toggle at the top of the results, shown one rack at a time. |
| **Data source** | REAL photos/frames and REAL per-rack analysis; the grouping, labels and the cross-rack uplink cables are generated. |

## 3. How it works — step by step

You open the flow, pick a capture mode at the top ("Two photos" or "One video"), give RackTrack what it asks for, and tap **Build combined view**. From there the two modes work slightly differently under the surface.

### Photos mode ("Two photos")

1. You see two dashed boxes, one labelled **Rack 1** and one labelled **Rack 2**. Tap a box and your phone offers its normal chooser — **Take Photo** or **Photo Library** — so you can shoot the rack right there or pick an existing photo. Do the same for the second box.
2. Tap **Build combined view**. The button is greyed out until *both* boxes have a photo.
3. RackTrack analyses the first photo (progress reads *"Analyzing rack 1…"*), then the second (*"Analyzing rack 2…"*). Each photo runs the exact same analysis a normal single-rack scan does, so each rack comes out with its full device list, ports and topology.
4. It links the two racks together (*"Linking the two racks…"*).
5. It opens the results (*"Opening results…"*), landing you on the first rack's report with a rack toggle across the top and the combined view a tap away.

### Video mode ("One video")

1. You see one dashed box that says **Add a rack video**. Tap it to record or pick a clip, and pan slowly across both racks so each one is clearly in view for a moment.
2. Tap **Build combined view**. The button is greyed out until a video is chosen.
3. RackTrack processes the clip (progress reads *"Detecting racks in the video…"*). It splits the video into the best single frame of each rack it can find, analyses each frame as its own rack, and links them into a group.
4. It opens the results (*"Opening results…"*), landing you on the first rack with the rack toggle and combined view available.

In both modes the end state is the same: two racks, each fully analysed, tied together so you can flip between them and see the cabling that crosses from one to the other.

## 4. What you see on screen

**The "Scan two racks" screen.** At the top is a short line explaining the feature. Below that is a **Capture mode** toggle with two pills: **Two photos** and **One video**. Whichever you pick changes what appears underneath.

- **Two photos mode** shows two dashed containers under the heading *Rack photos*, one for **Rack 1** and one for **Rack 2**. Each empty container shows a camera icon, the words **Add a photo**, the hint *"Tap to take a photo or pick from your gallery,"* and small format pills (**JPG · PNG · HEIC**). Tapping a container opens your phone's native chooser — there are no separate "Camera" and "Gallery" buttons anymore; it is one tap on the box. Once you add a photo, its thumbnail fills the box, and tapping again lets you replace it.
- **One video mode** shows a single dashed container under the heading *Rack video*. Empty, it shows a film-clip icon, the words **Add a rack video**, the hint *"Pan across both racks · or tap to browse,"* and format pills (**MP4 · MOV · WEBM**). Once you pick a clip, the box shows the file name.

**The build button.** A single **Build combined view** button sits below. It stays disabled until you have supplied what the current mode needs (two photos, or one video). While it works, it shows the current step, and a small spinner with the step text appears beneath it. If anything goes wrong, a red message appears explaining what to fix.

**The combined result.** After a successful build you land on the first rack's normal results page, with two extra things:

- **A rack toggle.** A small "Rack 1 / Rack 2" pill switcher sits at the top. Each pill shows the rack's position (`#1`, `#2`) and its label. Tapping the other pill jumps you to that rack — and it keeps you on whatever sub-page you were viewing, so if you are on Ports for Rack 1 you land on Ports for Rack 2. RackTrack deliberately shows **one rack at a time**, not both crammed together, so the page stays readable on a phone and any live probing stays correct.
- **A jump to the combined 3D view.** Next to the rack pills is a small **3D** button. It opens the **Combined topology** screen.

**The combined topology (between-rack) view.** This is the whole point of pairing two racks. It puts both racks in one shared 3D scene, standing side by side on the same floor, and draws the **inter-rack cables** — the handful of uplinks that cross from one rack to the other — as real cables that leave a specific switch in one rack and land on a specific switch in the other. Fibre runs are drawn in amber, direct-attach (DAC) copper in cyan/blue. Beneath the scene there is a strip of quick-jump chips (one per rack, showing its position, label and id) that open that rack's detail, and an **Inter-rack connections** panel that lists each crossing cable in words: its role (for example "Primary uplink"), the rack, device and port it leaves, and the rack, device and port it lands on. The topology screen also offers a **2D / 3D toggle** — 2D lays each rack's flat elevation side by side with a connector rail down the gap between them; 3D shows the shared scene.

## 5. The logic behind it

The feature is built out of three simple moves.

**Analyse each rack on its own.** Whether you gave it two photos or one video, RackTrack ends up with one image per rack and runs the ordinary single-rack analysis on each. Nothing about that per-rack analysis is special or reduced — each rack is exactly the scan it would be if you had scanned it alone. That is deliberate: it means the per-rack report, ports and topology you already trust behave identically inside a pair.

**Link the two into a group.** Once both racks are analysed, RackTrack records a small "group" that remembers the two racks belong together, along with each rack's position in the pair (Rack 1, Rack 2) and a friendly label. This group is metadata only — a note that says "these two go together." It never edits the racks themselves.

**Show the group only when you asked for it.** This is the subtle part worth understanding. A rack is not shown as part of a pair just because it *belongs* to a group. RackTrack only opens the side-by-side / toggle view when the web address carries an explicit **group signal** (`?group=…`) — the signal the two-rack workflow adds when it sends you to the results. The reason is that a rack's identity is a fingerprint of its photo, so if you later re-scanned that same photo on its own, RackTrack must not silently re-open the old pair. The rule the product wants is simple: **you only get the report of what you just uploaded.** Scan one rack, see one report. Do a two-rack scan, see the pair. Belonging to a group in the past never forces the grouped view on you.

## 6. Under the hood

*This section is for readers who want the technical detail. Everything above is enough to use the feature.*

**Photos mode → `/api/analyze` then `/api/rack-groups`.** The "Scan two racks" screen (`client/src/pages/MultiRackNewPage.jsx`) posts each photo to `POST /api/analyze` (form field `image`), which returns that image's `rackId`. Each image container is a single tap-to-open button wired to one hidden file input with `accept="image/*,image/heic,image/heif,.heic,.heif"` and **no `capture` attribute**, so the phone shows its native "Take Photo / Photo Library" chooser and desktop shows a file picker — the earlier design's separate Camera and Gallery buttons were removed. With both rack ids in hand the client calls `POST /api/rack-groups` with `{ rackIds: [id1, id2] }`, receives a `groupId`, and navigates to `/results/<id1>?group=<groupId>`.

`POST /api/rack-groups` (`server/app.js`) requires at least two and at most eight unique rack ids, and each rack must already be analysed (it checks that `outputs/<rackId>/device_unit_map.json` exists, else returns 404 "analyze it first"). It creates a group, assigns each rack a `position` and a `label` ("Rack 1", "Rack 2", …) pulled with its device count, and returns `{ ok, groupId, count }`. The group id has the form `GRP-` followed by 12 uppercase hex characters. (For the two-photo path the group's content key is recorded as `imgpair-<hash of the sorted rack ids>`, which is why re-pairing the same two racks is stable.)

**Video mode → `/api/analyze-video`.** Here the client posts the clip (form field `video`) to `POST /api/analyze-video`. The server splits the clip into one best frame per rack (a worker call), then runs the same single-rack analysis on each frame in series, creates the group, and adds each detected rack as a member. It responds with `{ ok, groupId, count, durationMs, racks: [{ rackId, position, label, deviceCount, score, cached }] }`. This endpoint requires a tenant (returns 401 otherwise). The client then navigates to `/results/<firstRackId>?group=<groupId>` (falling back to `/multi-rack/<groupId>/topology` if for some reason no first rack id came back).

**Reading a group back.** `GET /api/rack-group/:groupId` returns the group plus its members and is tenant-scoped — a group belonging to another tenant returns 404 (not 403), so cross-tenant existence is never revealed. `GET /api/rack/:rackId/group` answers "is this rack part of a pair?" for the per-rack pages; it honours an explicit `?group=` hint when the rack really is a member of that group (the group you just created), otherwise it falls back to the most recent group for that rack, and returns `{ ok, group: null }` for a standalone rack. `GET /api/rack-groups` lists a tenant's recent multi-rack scans, and `GET /api/rack-group/:groupId/links` returns the synthesized inter-rack uplinks that the combined view draws.

**The group signal.** Whether the grouped UI appears is decided by `client/src/hooks/useGroupView.js`. It reports `isGroup` as true only when the URL carries `?group=<id>`, the fetched group's id equals that value, and the group has at least two members. Membership alone never triggers the grouped view — the `?group=` signal must be present. Every in-group navigation (switching racks, opening the 3D view) carries that signal forward.

**One rack at a time, to keep live probes correct.** The rack toggle is implemented so that only one rack's content is mounted at any moment. On the Switches, Network and Ports pages this is `RackToggle` in `client/src/pages/SideBySideRacks.jsx`, which renders a single member and keys the rendered subtree on the rack id. Keying it that way forces a clean remount when you switch racks, which resets that page's per-rack state — and crucially avoids ever running two live network probes at once (the Ports page probes live), which is exactly why both racks are never rendered simultaneously on those pages. The lightweight pill switcher shown atop the Results / Ports / Topology pages is `RackTabs` (`client/src/components/RackTabs.jsx`), which preserves the current sub-page suffix and the `?group=` signal as you switch. On a wide desktop screen the Overview can instead show both racks in side-by-side columns (`RackResultsRoute.jsx`), but the phone experience is the toggle.

**The combined topology.** `client/src/pages/MultiRackTopologyPage.jsx` fetches the group, then each member's topology in parallel, and renders every rack inside one shared `@react-three/fiber` `<Canvas>` — same floor, same lights, same camera — spaced side by side. Selection is scoped per rack (clicking a switch in Rack 2 does not dim Rack 1). The cross-rack cables come from `/api/rack-group/:groupId/links`; each cable is resolved to an actual port on an actual device face and drawn as a sagging cable with plugs — fibre amber (`#f2c94c`), DAC cyan/blue (`#3b82f6`).

## 7. Edge cases and limits

- **Both photos are actually the same rack.** In photos mode, if both images resolve to the same rack (because they *are* the same rack), RackTrack refuses to make a "group of one." You get: *"Both photos resolved to the same rack — use two different racks."* Point the camera at two genuinely different racks.
- **A photo that is not a rack.** If one of the two photos does not look like a server rack, the build stops with: *"One of the photos doesn't look like a server rack. Point the camera at the front of a rack."* Re-shoot that rack from the front so its devices and ports are visible.
- **Fewer than two racks in a video.** Video mode needs to see at least two racks. If the split finds fewer, you get: *"Only N rack detected — pan across both racks so each is clearly visible."* Re-shoot with a slower, wider pan that lingers on each rack. If the split finds *none*, the server reports "No racks detected in the video. Try a clearer pan."
- **One rack fails during a video scan.** In video mode each rack is analysed independently; if one member rack fails, it is logged and skipped rather than sinking the whole scan — you still get the racks that succeeded (subject to the "at least two" rule above).
- **Group size.** The two-photo pairing endpoint accepts between two and eight racks; this screen is built around exactly two.
- **Sign-in / tenant required.** Multi-rack scans always belong to a tenant. The video endpoint returns "Authentication required" without one.
- **You must build to keep the pairing.** The grouped view only shows up when you arrive with the group signal from the build. Opening one of the racks later on its own shows just that rack's normal report — by design.

## 8. Real vs. synthetic

| What you see | Real or generated |
|---|---|
| Each rack's photo (or the frame chosen from your video) | **REAL** — the image you supplied. |
| Each rack's devices, ports and per-rack topology | **REAL** — identical to a normal single-rack scan. |
| That the two racks are a pair, plus "Rack 1 / Rack 2" labels and order | **GENERATED** — the grouping metadata added on top. |
| The cabling drawn *inside* each rack in the combined view | **SYNTHETIC** — inferred wiring, the same as single-rack topology. |
| The uplink cables that cross *between* the two racks | **GENERATED** — a realistic handful of cross-rack links, not a full mesh. |

## 9. Use cases

- **A cabled pair.** Two racks side by side, one uplinking to the other — capture both, then use the combined view to see exactly which switch crosses to which. This is the case the feature was built for.
- **A fast two-rack survey.** You only have a moment in the aisle: snap one photo of each rack, tap build, and you have both documented and linked in one pass.
- **Video when you can't line up two clean shots.** If it is easier to pan across the two racks than to frame each one, use video mode and let RackTrack pick the best frame of each.
- **Review on the big screen later.** Back at a desk, the combined topology (and the desktop side-by-side Overview) lets you review both racks and their crossing cables together, then jump into either rack's full detail.

## 10. Common questions

**Q: What is the difference between "Two photos" and "One video"?**
A: Two photos means you supply one photo per rack yourself. One video means you pan a single clip across both racks and RackTrack picks the best frame of each. Both end in the same place: two racks analysed and linked.

**Q: Do I still get a full report for each rack?**
A: Yes. Each rack in the pair is a complete, ordinary scan — same devices, ports, topology and report as if you had scanned it alone. Grouping only adds the pairing on top.

**Q: Where did the Camera and Gallery buttons go?**
A: They were replaced by a single tap-to-add box per rack. Tapping the box opens your phone's own chooser, which already offers "Take Photo" and "Photo Library," so there is nothing extra to press.

**Q: Why is the "Build combined view" button greyed out?**
A: It stays disabled until the current mode has what it needs — both photos in Two photos mode, or one clip in One video mode.

**Q: What are the amber and blue cables in the combined view?**
A: Those are the uplink cables that cross *between* the two racks. Amber is fibre, cyan/blue is direct-attach (DAC) copper. Cabling that stays inside a single rack is drawn separately, per rack.

**Q: It says "Both photos resolved to the same rack." What went wrong?**
A: The two photos are of the same rack (RackTrack recognises a rack by its image). It won't make a pair out of one rack — re-shoot so the two photos are of two different racks.

**Q: My video only found one rack. Why?**
A: The pan didn't clearly separate the two racks. Re-record slowly, giving each rack a clear moment on screen. Video mode needs at least two racks to build a pair.

**Q: When I switch racks, why do I only see one rack at a time?**
A: That is intentional. Showing one rack at a time keeps the page readable on a phone and, importantly, avoids running two live network probes at once on the Ports page. Switching racks cleanly resets that rack's page.

**Q: I opened one of the racks later and the pairing was gone. Is that a bug?**
A: No. The paired view only appears when you arrive with the group signal from the scan. Opening a single rack on its own deliberately shows just that rack — "you only get the report of what you uploaded."

**Q: Can a rack be in more than one pair?**
A: Yes. Because a rack is identified by its photo, the same rack can appear in several scans over time. When it matters, RackTrack resolves to the group you just created rather than an older one.

**Q: How do I get to the between-rack 3D view?**
A: From the results, tap the small **3D** button next to the rack toggle. That opens the Combined topology, where both racks share one scene and the crossing cables are drawn and listed.

**Q: Does this work if I'm not signed in?**
A: No. Multi-rack scans always belong to your tenant, so you need to be signed in — the video scan will refuse with "Authentication required" otherwise.

---

*Multi-Rack Scans (Two Racks) — RackTrack feature documentation.*
