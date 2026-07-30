# Device Classes & Labels

*Every device type RackTrack can recognise, where those types come from, and how each device gets its name and rack position.*

Reference · All users · Last verified: 26 July 2026 against the live code + checkpoint.

---

## 1. In simple terms

When RackTrack looks at a photo of a rack, it does two separate jobs.

First, an AI **shape model** looks at the outline of each piece of equipment and puts it into one of **12 fixed classes** — things like Switch, Server, Firewall, PDU, and so on. This is a guess based purely on what the device *looks like*, before any text on the front is read. That model is the file `Models/devices_seg.pt`, and those 12 classes are the foundation of everything else on the results screen.

Second, RackTrack **reads the text** printed on the front of each device (this is the OCR step). If the text names a brand or contains a recognisable code, RackTrack can **upgrade** the device to a more accurate type — even to a type the shape model does not know about, like Controller or Recorder. This is why you sometimes see a device labelled as something that is not one of the 12 base classes.

So there are three groups of type names you may meet in RackTrack:

- The **12 base classes** the shape model can output.
- A handful of **extra types** that only appear after the text is read (Controller, Recorder, Amplifier, Modem).
- The **correction list** — the 14 types *you* can choose from when you tell RackTrack it got a device wrong.

The rest of this page explains each of these and answers the common questions.

---

## 2. The 12 classes

These are the exact 12 classes stored inside the shape model checkpoint (`Models/devices_seg.pt`). They are, in the model's own order:

| # | Class name | Plain description |
|---|------------|-------------------|
| 0 | **Closed Unit** | A blanking / filler panel, or any sealed-front unit with no visible ports. It fills a rack slot but is not a working networked device. |
| 1 | **Empty** | A rack slot with nothing installed — bare rails and open space. |
| 2 | **Firewall** | A security appliance that controls traffic in and out of the network. |
| 3 | **Gateway** | A device that joins two networks or converts between them (for example a voice or media gateway). |
| 4 | **Load Balancer** | A device that spreads network traffic across several servers so no single one is overloaded. |
| 5 | **PDU** | Power Distribution Unit — the rack power strip that feeds mains power to every device, usually with many outlets. |
| 6 | **Patch Panel** | A passive panel of numbered ports where cables are terminated and organised. It has no electronics of its own. |
| 7 | **Router** | A device that forwards data between different networks and decides the path traffic takes. |
| 8 | **Server** | A computer that runs applications or services — the "workhorse" box in the rack. |
| 9 | **Storage unit** | A disk array or NAS whose job is to store data. |
| 10 | **Switch** | A device with many ports that connects devices inside the same local network. Usually the most common thing in a rack. |
| 11 | **UPS** | Uninterruptible Power Supply — a battery backup that keeps equipment running during a power cut. |

> **A note on one wrong comment in the code.** A code comment inside `pipeline/detection.py` (near the seg-model section) lists the 12 classes and mistakenly writes **PSU** where it should say **Load Balancer**. That comment is out of date. The real checkpoint — the file the app actually loads — has **Load Balancer** at position 4 and **no PSU class at all**. When in doubt, trust the checkpoint, not the comment. This page reflects the checkpoint.

The pipeline tidies up the spelling of these names into "Title Case" (for example the checkpoint stores `Storage unit` and the app displays it as `Storage Unit`), but the set of 12 is exactly as above.

---

## 3. How a device gets its class

A device's type is decided in two stages:

1. **Shape first.** The `devices_seg.pt` model looks at each detected device box and assigns one of the 12 classes from Section 2, based only on the device's silhouette. Every device starts life with one of these 12 labels.

2. **Text can upgrade it.** After detection, RackTrack runs OCR on the rack photo (`pipeline/ocr_devices.py`) and reads whatever text sits on each device's face. The server then looks at that text (`server/app.js`) and, if it recognises a brand name or a code, it **reclassifies** the device to a better type. On the results screen this shows up as the device's class changing, and RackTrack quietly remembers what it was changed *from*.

There are two ways the text can change a device's class:

- **Brand-token match.** If the OCR text contains a known brand word, the device is upgraded to the type that brand implies. For example the text "PLANAR" upgrades a device to **Controller**; "SONY" upgrades it to **Recorder**; "TRIPP-LITE" to **PDU**; "APC", "EATON" or "SCHNEIDER" to **UPS**; "PALO ALTO", "FORTIGATE" or "CHECKPOINT" to **Firewall**; "AUDIOCODES", "MEDIAPACK" or "POLYCOM" to **Gateway**; "CISCO", "CATALYST", "NEXUS", "ARUBA", "JUNIPER" or "MERAKI" to **Switch**; "CEDGE" to **Router**. RackTrack also tolerates common OCR misreads of these brand names.

- **Label-code match.** If OCR reads a proper equipment label that ends in a short type code (for example `RVEW-CORE-SW01`, where `SW` means Switch), and the shape model was *unsure* (it had guessed Empty, Closed Unit, or Unidentified), RackTrack uses the code in the label to set the class. The codes it understands include `SW`→Switch, `PP`→Patch Panel, `FW`→Firewall, `RO`/`RTR`→Router, `SVR`/`SRV`→Server, `LB`→Load Balancer, `GW`/`GT`→Gateway, `MO`/`MDM`→Modem, `CTRL`/`CTL`→Controller, `REC`→Recorder, `AMP`→Amplifier, `PDU`, `PSU`, and `UPS`.

A brand or code upgrade only wins when its confidence is at least as high as any earlier text hit for the same device, and the label-code upgrade only fires on devices the shape model was already unsure about — so a strong, confident shape detection is not overruled by a stray word.

---

## 4. The extra OCR-only types (Controller, Recorder, Amplifier, Modem)

The shape model only knows the 12 classes in Section 2. But real racks contain gear that does not fit any of those 12 — an AV controller, a video recorder, an audio amplifier, a modem. To the shape model these often look like a plain box and get guessed as UPS, Server, Empty, or Closed Unit.

The text-reading step rescues them. When OCR finds the right brand word or label code, RackTrack relabels the device as one of these **four extra types that are not in the 12**:

- **Controller** — e.g. a Planar AV video-wall controller (brand word "PLANAR", or a label code `CTRL`/`CTL`).
- **Recorder** — e.g. a Sony video recorder (brand word "SONY", or a label code `REC`).
- **Amplifier** — an audio amplifier (from a label code `AMP`).
- **Modem** — a modem (from a label code `MO`/`MDM`).

These four appear **only** because the text said so; the shape model can never produce them on its own. That is exactly why you might photograph the same device twice and see it as, say, "UPS" one time (shape only) and "Controller" the next (once the text was read) — the second read found the brand.

Note that **Load Balancer is different**: it *is* one of the 12 shape classes (position 4), so it can be detected from shape alone, and it can also be set from a `LB` label code. It is not an OCR-only type.

---

## 5. Labels & positions (U-codes)

Every device shown on the results screen gets a **name** and a **rack position**.

**Rack position (the U slots).** RackTrack builds a grid of 1U slots down the rack and gives each slot a code like `u01`, `u02`, `u03`. A device that is two or three rack-units tall claims two or three slots. In the main grid builder, numbering follows the standard rack convention — **`u01` is the bottom slot and the numbers increase going up**. Each device records which slot(s) it occupies. On screen and in reports these are shown upper-case and collapsed into ranges, for example `U18` for a single slot or `U18-U19` for a 2U device.

**Device name.** The name is built from the device's rack position plus a short class code and a running number. The class codes are:

`SW` Switch · `PP` Patch Panel · `FW` Firewall · `RO` Router · `SVR` Server · `LB` Load Balancer · `MO` Modem · `CTRL` Controller · `REC` Recorder · `AMP` Amplifier · `GT` Gateway · `PDU` PDU · `PSU` PSU · `UPS` UPS · `EMP` Empty · `CL` Closed Unit.

So the first switch found at U18 becomes something like **`U18-SW01`**, the second switch **`...-SW02`**, and so on.

**When a real naming scheme is on the rack.** If OCR reads a genuine device label with a clear naming pattern (for example `RVEW-CORE-SW01`), RackTrack learns that pattern and mints matching names for the *other* devices in the same rack — so a nearby PDU becomes `RVEW-CORE-PDU01` instead of the plain U-position name. Members of a switch stack that share one printed name get a `/1`, `/2`, `/3` suffix so they stay distinct.

**Port names** follow the device name, e.g. a switch port becomes `<device>-IF-Gi1/0/<n>`, a patch-panel port `<device>-FP-<nn>`, a PDU outlet `<device>-OUT-<nn>`, and a power inlet `<device>-PWR-<nn>`.

The exported reports (HTML, CSV, JSON) use the same class-code scheme on the server side, covering all 16 code entries listed above.

---

## 6. What's hidden and why (Empty / Closed Unit / Unidentified)

Three class names are treated as "not a real, inspectable device" and are **hidden from the annotated results view** and cannot be selected for a closer look:

- **Empty** — an open slot. There is nothing there to inspect.
- **Closed Unit** — a blank/filler panel or sealed unit with no ports. There is nothing to click into.
- **Unidentified** — a placeholder RackTrack adds for a rack slot that clearly holds *something* but that no detection claimed. RackTrack deliberately calls it "Unidentified" rather than "Empty", because a rack row almost always contains a device; calling it "Empty" would be a false certainty.

Hiding these keeps the picture clean: the overlay draws boxes and names only for the equipment worth looking at, and the device dropdown only offers real, port-bearing gear. (`Unidentified` and `Closed Unit` are still fed through the OCR step, because those hard-to-classify boxes are often exactly the unusual chassis where reading the text helps most.)

---

## 7. The correction list vs the model classes (why PSU / Modem / etc. are choosable but not auto-detected)

When RackTrack gets a device type wrong, you can correct it. The correction picker — the same list on both the **Results** page and the **Ground Truth** page — offers **14 types**:

**Switch, Patch Panel, Firewall, Router, Server, Load Balancer, Modem, Controller, Recorder, Amplifier, Gateway, PDU, PSU, UPS.**

This list is deliberately **different** from the 12 shape-model classes, because it is a list of what a *human* might sensibly call a device, not a list of what the AI can guess:

- **In both lists (9):** Switch, Patch Panel, Firewall, Router, Server, Load Balancer, Gateway, PDU, UPS.
- **Model-only, not offered as a correction (3):** Closed Unit, Empty, Storage unit. (You would not "correct" a device *to* Empty, and pure storage is rarely something a user needs to relabel.)
- **Correction-only, never auto-detected (5):** Modem, Controller, Recorder, Amplifier, and **PSU**.

So **PSU is a label you can choose by hand, but the shape model will never output it** — there is no PSU class in the checkpoint. It exists in the correction list (and as a class code `PSU`) so you can hand-label a power-supply unit, and it can also be set from a `PSU` code inside an OCR'd label, but it is not one of the 12 auto-detected classes. The same is true of Modem, Controller, Recorder, and Amplifier as *user* choices: they are always either your correction or an OCR upgrade, never a raw shape guess.

Picking a correction here writes a feedback record that trains RackTrack over time — the choice you make on Results and the truth you give on Ground Truth produce identical records.

---

## 8. Common questions

**Q: What are the 12 classes?**
A: Closed Unit, Empty, Firewall, Gateway, Load Balancer, PDU, Patch Panel, Router, Server, Storage unit, Switch, and UPS. These are the classes stored in the shape model `Models/devices_seg.pt`.

**Q: What are the 12 base classes?**
A: The same 12: Closed Unit, Empty, Firewall, Gateway, Load Balancer, PDU, Patch Panel, Router, Server, Storage unit, Switch, UPS. "Base classes" means the types the shape AI can output before any text is read.

**Q: Which devices does RackTrack identify?**
A: From shape alone it identifies these 12: Closed Unit, Empty, Firewall, Gateway, Load Balancer, PDU, Patch Panel, Router, Server, Storage unit, Switch, UPS. After reading the text it can also mark a device as Controller, Recorder, Amplifier, or Modem.

**Q: What devices can it detect?**
A: The 12 shape classes above. Reading the front-panel text can additionally upgrade a device to Controller, Recorder, Amplifier, or Modem.

**Q: What device types does it recognise?**
A: Twelve by shape (Closed Unit, Empty, Firewall, Gateway, Load Balancer, PDU, Patch Panel, Router, Server, Storage unit, Switch, UPS) plus four more that only come from reading text (Controller, Recorder, Amplifier, Modem).

**Q: Does it detect servers?**
A: Yes. Server is one of the 12 classes, and there is a dedicated detection pass focused on finding servers.

**Q: Can it detect switches?**
A: Yes. Switch is one of the 12 classes and is usually the most common device found in a rack.

**Q: Can it identify a firewall?**
A: Yes. Firewall is one of the 12 shape classes. On top of that, brands like Palo Alto, FortiGate/Fortinet, and Check Point in the front-panel text will confirm a device as a Firewall.

**Q: What is a Closed Unit?**
A: A blanking or filler panel, or any sealed-front unit that has no visible ports. It occupies a rack slot but is not a working networked device, so RackTrack hides it from the results view.

**Q: What is an Empty unit / Empty slot?**
A: A rack slot with nothing installed in it — just the open rails. It is one of the 12 classes but is hidden on the results screen because there is nothing to inspect.

**Q: What is the difference between Empty and Unidentified?**
A: "Empty" means the model is confident the slot is bare. "Unidentified" is a placeholder for a slot that clearly holds something but that nothing managed to classify — RackTrack refuses to call it Empty because that would be a false certainty. Both are hidden from the annotated view.

**Q: Why do I see "Controller" or "Recorder" when those aren't in the 12 classes?**
A: Because RackTrack read the text on the device. The shape model guessed one of the 12, then OCR found a brand (for example Planar → Controller, Sony → Recorder) or a label code and upgraded the device to that more accurate type. These four extra types — Controller, Recorder, Amplifier, Modem — only ever come from reading text.

**Q: Why does the same device show as a different type on a second scan?**
A: The first scan may have used the shape guess only, and the second scan managed to read the brand or label text and upgraded the type. Clearer photos give the text step more to work with.

**Q: What is a Load Balancer?**
A: A device that spreads network traffic across several servers so no single server is overloaded. It is one of the 12 shape classes (position 4 in the model) and can also be set from a `LB` code in a device's label.

**Q: Is Load Balancer detected by shape or only by text?**
A: By shape — it is one of the 12 base classes — and it can additionally be confirmed by an `LB` label code. It is not one of the text-only types.

**Q: Does RackTrack detect PSU (power supply unit)?**
A: Not automatically. There is no PSU class in the shape model, so it is never a raw detection. PSU is available as a manual correction label, and it can be applied when an OCR'd label contains a `PSU` code.

**Q: What is a PDU?**
A: A Power Distribution Unit — the rack's power strip that feeds mains power to the other devices, usually with a row of outlets. It is one of the 12 classes and has its own power-outlet view when selected.

**Q: What is the difference between a PDU and a UPS?**
A: A PDU just distributes mains power to outlets. A UPS is a battery backup that keeps equipment running through a power cut. Both are separate classes among the 12.

**Q: What is a Storage unit?**
A: A disk array or NAS whose main job is to store data. It is one of the 12 classes. Note it is *not* offered in the correction picker, so you cannot hand-relabel a device to "Storage unit".

**Q: What's the difference between the model classes and the correction options?**
A: The 12 model classes are what the shape AI can output. The 14 correction options are what *you* can label a device as when you fix a mistake. Nine types are in both. The model also has Closed Unit, Empty, and Storage unit (not in the correction list); the correction list also has Modem, Controller, Recorder, Amplifier, and PSU (which the model never auto-detects).

**Q: Why can I pick PSU or Modem as a correction if RackTrack can't detect them?**
A: The correction list is about what a human might sensibly call a device, not what the AI can guess. Those human labels are still useful — they feed back into training and produce a correct inventory even for gear the shape model has no class for.

**Q: How many device types can I choose from when correcting a device?**
A: Fourteen: Switch, Patch Panel, Firewall, Router, Server, Load Balancer, Modem, Controller, Recorder, Amplifier, Gateway, PDU, PSU, UPS. The same list appears on both the Results page and the Ground Truth page.

**Q: Why isn't "Empty" or "Closed Unit" in the correction list?**
A: Because those are not things you would relabel a real device *to*. The correction list is for naming actual equipment, so the empty/blank/placeholder types are left out.

**Q: What does a device name like U18-SW01 mean?**
A: `U18` is the rack position (unit 18), `SW` is the class code for Switch, and `01` means it is the first switch found. RackTrack builds names from position + class code + a running number.

**Q: What does a name like RVEW-CORE-SW01 mean?**
A: RackTrack read a real label on the rack (`RVEW-CORE-SW01`), recognised the naming pattern, and reused it to name the other devices in that rack — so their names match your existing scheme instead of the plain U-position names.

**Q: What are the U codes (u01, u02...)?**
A: They are the rack-unit slots. RackTrack lays a grid of 1U slots down the rack; a device that is two or three units tall claims that many slots. In the main grid, `u01` is the bottom slot and the numbers increase upward, following the standard rack convention.

**Q: Why are some devices missing from the labelled picture?**
A: Empty slots, Closed Units, and Unidentified placeholders are deliberately hidden from the annotated view and the device picker, because there is nothing useful to inspect on them. They may still be counted internally.

**Q: Which brands upgrade a device's type automatically?**
A: Among others: Planar → Controller; Sony → Recorder; Tripp-Lite → PDU; APC, Eaton, Schneider → UPS; Palo Alto, FortiGate/Fortinet, Check Point → Firewall; Audiocodes, MediaPack, Polycom → Gateway; Cisco, Catalyst, Nexus, Aruba, Juniper, Meraki → Switch; CEdge → Router. RackTrack also allows for common OCR misspellings of these brand names.

**Q: Does the type on screen change what training data RackTrack keeps?**
A: When you confirm or correct a device, RackTrack writes a feedback record and updates its accuracy scoreboard. Corrections you make on Results and truths you give on Ground Truth are stored the same way, so both improve future detections.
