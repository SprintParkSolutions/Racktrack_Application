#!/usr/bin/env python3
"""Build the demo run book from the screenshots taken off the live demo."""

import base64
import html
import os

SHOTS = "/private/tmp/claude-501/-Volumes-Racktrack-dark-mobile/492fc9ed-827d-4244-9e90-762ddc2e1215/scratchpad/demo2/small"
OUT = "/private/tmp/claude-501/-Volumes-Racktrack-dark-mobile/492fc9ed-827d-4244-9e90-762ddc2e1215/scratchpad/racktrack-demo-run.html"


def img(name):
    p = os.path.join(SHOTS, name + ".jpg")
    with open(p, "rb") as f:
        return "data:image/jpeg;base64," + base64.b64encode(f.read()).decode()


def frame(name, kind, caption):
    if not name:
        return ""
    cls = "phone" if kind == "phone" else "screen"
    return f'''<figure class="shot {cls}">
      <div class="chrome">{'<span class="notch"></span>' if kind == "phone" else '<span class="dots"><i></i><i></i><i></i></span><span class="addr">demo.racktrack.ai</span>'}</div>
      <img src="{img(name)}" alt="{html.escape(caption)}">
      <figcaption>{html.escape(caption)}</figcaption>
    </figure>'''


# actor, minutes, title, beats[(do, say, shot, kind, caption)]
ACTS = [
    (
        "system",
        "0:00",
        "Before anybody speaks",
        [
            (
                "Have three things open and signed in: the phone (or the simulator) as <b>dc007.tech</b>, "
                "a browser tab on <span class='mono'>demo.racktrack.ai</span> as <b>ravi.kumar</b>, and a second "
                "browser tab as <b>Aasritha</b>. Put the rack photograph on your phone's camera roll.",
                "Nothing to say yet. If the room is still settling, this is the moment to say what they are about to watch: "
                "one rack, one photograph, and the four minutes between a technician standing in front of a cabinet and the "
                "record in NetBox being right again.",
                None,
                None,
                "",
            ),
        ],
    ),
    (
        "admin",
        "0:30",
        "What the organisation already knows",
        [
            (
                "Open the admin tab. Home.",
                "This is RackTrack as the person who runs the estate sees it. One organisation - DC-007 - and under it the "
                "sites that actually hold racks. Everything on this screen is theirs: their sites, their racks, their people. "
                "We put nothing in here that they did not give us.",
                "a1-home",
                "phone",
                "The admin opens on the estate, not on a camera",
            ),
            (
                "Tap Organization.",
                "Two sites today. Office-Sprintpark in Kondapur, and Gachibowli. Each site has one person who is responsible "
                "for what is in it - we call them the single point of contact, and everything a technician finds at that site "
                "goes to that person and to nobody else. That is the whole routing rule. There is no queue, no triage desk, "
                "no ticket that sits with 'the team'.",
                "a2-org",
                "phone",
                "Sites, and the person responsible for each",
            ),
            (
                "Tap Data sources.",
                "And this is where the truth is supposed to live. NetBox holds the records - every rack, every device, every "
                "shelf. ServiceNow is where their incidents are raised. RackTrack does not replace either of them. It reads "
                "one and writes to the other, and the customer keeps both.",
                "a3-sources",
                "phone",
                "NetBox for the records, ServiceNow for the incidents",
            ),
        ],
    ),
    (
        "tech",
        "2:00",
        "The technician at the rack",
        [
            (
                "Switch to the phone, signed in as dc007.tech. Stay on Home.",
                "Now the person at the rack. Same product, completely different screen - they do not run an estate, they stand "
                "in front of cabinets. One button: scan a rack. Under it, the tickets somebody has asked them to look at, and "
                "the racks they have already read.",
                "p2-home-employee" if False else "s1-home",
                "phone",
                "The employee app: one job, one button",
            ),
            (
                "Tap Scan a rack and take the photograph - or pick the one on the camera roll.",
                "One photograph of the front of the cabinet. No labels to scan, no spreadsheet to fill in, no clipboard. "
                "The photograph is the input, and the whole of the input.",
                None,
                None,
                "",
            ),
            (
                "Wait for the result. Show the rack overview.",
                "Eleven seconds later the rack is read. Every box in the cabinet, at the shelf it is on. It has recognised "
                "the switches by their port layout, the patch panels, the router, the power strip. And at the top it names "
                "the rack itself - SP-HYB-RM01-R01-R1 - because somebody confirmed, once, which cabinet this is.",
                "p1-rack",
                "phone",
                "What the photograph read, shelf by shelf",
            ),
            (
                "Tap Analyse the network, then the report.",
                "The report is the rack in a document: what is in it, what each switch reports about its own ports, what is "
                "plugged in and what is spare. This is the thing an engineer would otherwise spend an afternoon writing by "
                "hand, and it is one tap.",
                "p2-report",
                "phone",
                "The rack report - and the drift report beside it",
            ),
        ],
    ),
    (
        "tech",
        "5:00",
        "Against the records",
        [
            (
                "Tap Drift check.",
                "And here is the question the whole product exists to answer: does the record match the rack? RackTrack has "
                "read all 296 things NetBox holds for this cabinet and compared them to what it can see in the photograph. "
                "296 match. Two do not. Nine things the record lists were not seen at all.",
                "p3-drift",
                "phone",
                "The comparison, in the technician’s hand",
            ),
            (
                "Read the two differences out.",
                "The router on shelf 20 - the record has it on shelf 22. Somebody moved it and nobody wrote it down. That is "
                "not a fault, it is a Tuesday. The point is that until now, nothing would have caught it until the next audit, "
                "or until an engineer went looking for a device that was not where the record said.",
                None,
                None,
                "",
            ),
            (
                "Tap Send.",
                "The technician does not decide anything. They send what they found. The moment they press this: an incident "
                "is raised in ServiceNow with the drift report attached, and the check goes to the person responsible for that "
                "site. Their part is done - they can walk to the next cabinet.",
                "p4-incidents",
                "phone",
                "And they can follow what they sent, from their own phone",
            ),
        ],
    ),
    (
        "spoc",
        "7:00",
        "The person who decides",
        [
            (
                "Switch to the ravi.kumar tab - or the phone, signed in as ravi.kumar. Show the bell.",
                "Ravi is the contact for Office-Sprintpark. He is not at the rack; he is the person who says yes or no to what "
                "the rack turned out to hold. His phone has just made a sound, and the bell has a number on it.",
                "s1-home",
                "phone",
                "The SPOC’s phone: no camera, no scan history - his checks and the Desk",
            ),
            (
                "Open the bell, tap the notice.",
                "The notice opens as a message first, not as a jump: which incident, which rack, who sent it, and what it says. "
                "Then one button takes him to the drift itself.",
                "s2-checks",
                "phone",
                "What is with him, oldest first",
            ),
            (
                "Open RackTrack Control - the Desk - on the laptop.",
                "And this is the same work on a desk. Thirteen checks with him. Each one is a rack, how many differences it "
                "holds, who sent it, and how long it has been waiting. The colour of the dot is the clock: blue is running, "
                "red has run out.",
                "d2-checks",
                "screen",
                "Your checks: one card per rack, oldest first",
            ),
        ],
    ),
    (
        "spoc",
        "9:30",
        "One decision, and what it writes",
        [
            (
                "Open the drift.",
                "Two differences, and against each one RackTrack has already worked out what it thinks the record should say - "
                "and shows its reasoning. Same device, wrong shelf: move the record from U22 to U20. It is not guessing at the "
                "device; it recognised it. It is proposing the smallest change that makes the record true.",
                "d6-drift-detail",
                "screen",
                "What differs, and what RackTrack proposes about it",
            ),
            (
                "Point at the Why link, then at the tabs.",
                "Every proposal shows its working - press Why and it names the evidence. And the other tabs are the rest of "
                "the answer: 296 things that matched, nine the record lists that the photograph did not see. A person can see "
                "the whole comparison, not only the exceptions.",
                None,
                None,
                "",
            ),
            (
                "Approve, and write.",
                "Ravi approves. RackTrack writes that change into NetBox itself - not a CSV for somebody to import, the record "
                "is updated - the ServiceNow incident is resolved, and the change goes into the registry: what changed, who "
                "decided it, when, and against which photograph.",
                "d3-drifts",
                "screen",
                "Every drift in the organisation, and where each one stands",
            ),
        ],
    ),
    (
        "admin",
        "11:30",
        "What the estate looks like afterwards",
        [
            (
                "Show the Desk dashboard, then Reports.",
                "For whoever runs the estate: how many checks are open, how many were raised today, how many finished, and "
                "what is late. And the reports are the evidence - every drift, every decision, every write, exportable, with "
                "the incident number beside it.",
                "d1-dash",
                "screen",
                "The dashboard: open, raised today, finished today, late",
            ),
            (
                "Close.",
                "So: one photograph, eleven seconds, 296 records checked, two differences found, one decision, and NetBox is "
                "true again - with an incident trail through ServiceNow the whole way. The alternative is an engineer with a "
                "clipboard, twice a year, and a record that everybody privately knows is wrong.",
                "d5-reports",
                "screen",
                "The evidence: every drift, every decision, exportable",
            ),
        ],
    ),
    (
        "system",
        "13:00",
        "If they ask about the second way in",
        [
            (
                "Open Tickets for you on the technician's phone.",
                "The demo you have just seen starts at a rack. There is a second way in that starts at a ticket: somebody "
                "raises one in ServiceNow - 'check the router on SP-HYB-RM01-R01-R1' - it lands here, the technician "
                "photographs that rack, and RackTrack answers the ticket's own claim against what the photograph shows. "
                "Same evidence, opposite direction.",
                "s3-tasks",
                "phone",
                "A ticket that names a rack, waiting for somebody to go and look",
            ),
        ],
    ),
]

ACTOR = {
    "tech": ("Technician", "#1F6B4A", "#E9F2EC"),
    "spoc": ("SPOC", "#2349C4", "#EAF0FD"),
    "admin": ("Admin", "#8A5A12", "#F8F0DF"),
    "system": ("You", "#5B4A7A", "#EFEBF6"),
}

acts_html = []
for i, (actor, at, title, beats) in enumerate(ACTS, 1):
    name, ink, soft = ACTOR[actor]
    rows = []
    for do, say, shot, kind, cap in beats:
        rows.append(f"""<div class="beat">
          <div class="words">
            <p class="do"><span class="doTag">Do</span>{do}</p>
            <blockquote class="say">{say}</blockquote>
          </div>
          {frame(shot, kind, cap)}
        </div>""")
    acts_html.append(f"""<section class="act" id="act{i}">
      <header class="actHead" style="--ink:{ink};--soft:{soft}">
        <span class="at">{at}</span>
        <span class="actor">{name}</span>
        <h2>{html.escape(title)}</h2>
      </header>
      {"".join(rows)}
    </section>""")

page = f"""<title>Office Rack Demo Run</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&family=Source+Sans+3:wght@400;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
  :root {{
    color-scheme: light;
    --paper: #F7F7F4;
    --card: #FFFFFF;
    --ink: #14181E;
    --ink-2: #555D68;
    --ink-3: #8B8F98;
    --line: #E5E5DF;
    --line-soft: #F0F0EB;
    --display: 'Newsreader', Georgia, serif;
    --body: 'Source Sans 3', -apple-system, BlinkMacSystemFont, sans-serif;
    --mono: 'IBM Plex Mono', ui-monospace, Menlo, monospace;
  }}
  body {{ margin: 0; background: var(--paper); color: var(--ink); font-family: var(--body); font-size: 16px; line-height: 1.6; -webkit-font-smoothing: antialiased; }}
  .wrap {{ max-width: 1120px; margin: 0 auto; padding-inline: 16px; padding-block: 34px 80px; }}

  header.top {{ margin-bottom: 30px; border-bottom: 1px solid var(--line); padding-bottom: 24px; }}
  .kicker {{ font-size: 11.5px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; color: var(--ink-3); margin: 0 0 10px; }}
  h1 {{ font-family: var(--display); font-size: clamp(30px, 5.6vw, 46px); font-weight: 500; letter-spacing: -.022em; line-height: 1.08; margin: 0 0 12px; text-wrap: balance; }}
  .stand {{ margin: 0; max-width: 68ch; font-size: 17.5px; color: var(--ink-2); }}
  .facts {{ display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }}
  .fact {{ background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 8px 12px; font-size: 13.5px; color: var(--ink-2); }}
  .fact b {{ color: var(--ink); font-weight: 700; }}
  .fact .mono, .mono {{ font-family: var(--mono); font-size: .93em; }}

  .act {{ margin-top: 40px; }}
  .actHead {{ display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 18px; padding-bottom: 10px; border-bottom: 1px solid var(--line); }}
  .at {{ font-family: var(--mono); font-size: 13px; color: var(--ink-3); font-variant-numeric: tabular-nums; }}
  .actor {{ font-size: 11.5px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--ink); background: var(--soft); border-radius: 999px; padding: 3px 10px; }}
  .actHead h2 {{ font-family: var(--display); font-size: clamp(22px, 3.4vw, 30px); font-weight: 600; letter-spacing: -.015em; margin: 0; color: var(--ink); flex: 1 1 100%; }}
  .actHead h2::before {{ content: ''; display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--ink); margin-right: 10px; vertical-align: middle; }}

  .beat {{ display: grid; gap: 20px; align-items: start; padding: 18px 0; border-bottom: 1px solid var(--line-soft); }}
  .beat:last-child {{ border-bottom: 0; }}
  @media (min-width: 880px) {{ .beat {{ grid-template-columns: minmax(0, 1fr) minmax(0, 0.92fr); }} }}
  .words {{ min-width: 0; }}
  .do {{ margin: 0 0 12px; font-size: 15px; color: var(--ink-2); }}
  .doTag {{ display: inline-block; margin-right: 8px; font-size: 10.5px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: #8A5A12; background: #F8F0DF; border-radius: 5px; padding: 2px 7px; vertical-align: 2px; }}
  .do b {{ color: var(--ink); }}
  .say {{ margin: 0; padding: 14px 16px 14px 18px; background: var(--card); border: 1px solid var(--line); border-left: 3px solid var(--ink); border-radius: 10px; font-family: var(--display); font-size: 18.5px; line-height: 1.62; color: var(--ink); }}

  .shot {{ margin: 0; min-width: 0; }}
  .shot img {{ display: block; width: 100%; height: auto; }}
  .shot.phone {{ max-width: 300px; }}
  .shot.phone img {{ border-radius: 0 0 18px 18px; }}
  .chrome {{ background: #1A1D22; border-radius: 18px 18px 0 0; padding: 7px 10px; display: flex; align-items: center; gap: 8px; }}
  .notch {{ display: block; width: 74px; height: 6px; border-radius: 99px; background: #40454E; margin: 0 auto; }}
  .dots {{ display: inline-flex; gap: 5px; }}
  .dots i {{ width: 9px; height: 9px; border-radius: 50%; background: #40454E; }}
  .addr {{ font-family: var(--mono); font-size: 11px; color: #9AA0AA; background: #24282F; border-radius: 6px; padding: 2px 10px; }}
  .shot figcaption {{ margin-top: 8px; font-size: 13px; color: var(--ink-3); line-height: 1.45; }}
  .shot.screen img {{ border: 1px solid var(--line); border-top: 0; }}

  .tail {{ margin-top: 44px; padding-top: 22px; border-top: 1px solid var(--line); }}
  .tail h2 {{ font-family: var(--display); font-size: 24px; font-weight: 600; margin: 0 0 12px; }}
  .tail ul {{ margin: 0 0 18px; padding-left: 20px; color: var(--ink-2); }}
  .tail li {{ margin-bottom: 7px; }}
  .tail li b {{ color: var(--ink); }}
  footer.foot {{ margin-top: 26px; font-size: 13px; color: var(--ink-3); }}
</style>

<div class="wrap">
  <header class="top">
    <p class="kicker">RackTrack &middot; demonstration run book &middot; 23 September 2026</p>
    <h1>One rack, one photograph, four minutes</h1>
    <p class="stand">
      Every screen in here was taken off <span class="mono">demo.racktrack.ai</span> today, from the build the
      testers have. Read the words in the boxes out loud as they are written; they are timed to the screen beside
      them. The whole run is about thirteen minutes, and it stops cleanly at nine if the room is busy.
    </p>
    <div class="facts">
      <span class="fact"><b>Organisation</b> DC-007</span>
      <span class="fact"><b>Rack</b> <span class="mono">SP-HYB-RM01-R01-R1</span></span>
      <span class="fact"><b>Technician</b> <span class="mono">dc007.tech</span></span>
      <span class="fact"><b>Contact for the site</b> <span class="mono">ravi.kumar</span></span>
      <span class="fact"><b>Admin</b> <span class="mono">Aasritha</span></span>
      <span class="fact"><b>Records</b> NetBox &middot; 296 for this rack</span>
    </div>
  </header>

  {"".join(acts_html)}

  <section class="tail">
    <h2>If something goes wrong</h2>
    <ul>
      <li><b>The photograph takes longer than usual.</b> Keep talking - say what it is doing: reading the cabinet,
        naming each box, working out which shelf it is on. It has never taken more than about thirty seconds.</li>
      <li><b>The drift comes back with nothing to decide.</b> That means the record already matches. Open an earlier
        check from Your checks instead - there are thirteen of them - and run the decision from there.</li>
      <li><b>NetBox is slow to answer.</b> The comparison says so plainly rather than pretending. Say that out loud:
        it will not invent a record it could not read.</li>
      <li><b>Somebody asks what happens when RackTrack is wrong.</b> Nothing is written without a person. Every
        proposal shows its evidence behind Why, and the record only changes when the site's contact approves it.</li>
    </ul>
    <h2>The three questions that always come</h2>
    <ul>
      <li><b>"Does it need our NetBox?"</b> It reads whatever CMDB they have - NetBox today, and the same comparison
        runs against their own database. It never becomes the system of record itself.</li>
      <li><b>"What about racks we have not photographed?"</b> Nothing is claimed about them. A rack enters the
        picture the first time somebody stands in front of it with a phone.</li>
      <li><b>"Who can approve?"</b> The person named for that site, and an organisation admin. Never the person who
        sent it - the one who found it is not the one who signs it off.</li>
    </ul>
  </section>

  <footer class="foot">
    Screens captured from demo.racktrack.ai on 23 September 2026, from Android 1.1 (82) and iOS 1.1 (4).
    Re-run the captures after any release that changes the navigation, the Desk or the report.
  </footer>
</div>
"""

with open(OUT, "w") as f:
    f.write(page)
print("wrote", OUT, os.path.getsize(OUT) // 1024, "KB")
