"""Build the Word version of the RackTrack onboarding guide.

A plain, hand-written-looking Word document meant to be emailed to clients.
Deliberately restrained: one accent colour, Calibri throughout, ordinary
headings, numbered steps and ruled tables - nothing that reads as generated.

House rule for this document: no em dashes or en dashes anywhere. A guard at
the bottom fails the build if one slips into the copy.

    python3 docs/user-guide/build-onboarding-docx.py
"""

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

OUT = "docs/user-guide/RackTrack-Onboarding-Guide.docx"

INK = RGBColor(0x14, 0x18, 0x1C)
INK2 = RGBColor(0x3A, 0x44, 0x4E)
MUTED = RGBColor(0x6C, 0x77, 0x82)
ACCENT = RGBColor(0x0E, 0x6E, 0x78)
LINE = "D6DCE0"
HEAD = "EFF3F4"
TINT = "F7FAFA"

BODY = "Calibri"


# --------------------------------------------------------------- helpers
def shade(el, fill):
    s = OxmlElement("w:shd")
    s.set(qn("w:val"), "clear")
    s.set(qn("w:fill"), fill)
    el.append(s)


def cell_borders(cell, color=LINE, sz=6):
    tcPr = cell._tc.get_or_add_tcPr()
    b = OxmlElement("w:tcBorders")
    for edge in ("top", "left", "bottom", "right"):
        e = OxmlElement(f"w:{edge}")
        e.set(qn("w:val"), "single")
        e.set(qn("w:sz"), str(sz))
        e.set(qn("w:color"), color)
        b.append(e)
    tcPr.append(b)


def rule(par, edge="bottom", color=LINE, sz=6, space=6):
    pPr = par._p.get_or_add_pPr()
    bd = pPr.find(qn("w:pBdr"))
    if bd is None:
        bd = OxmlElement("w:pBdr")
        pPr.append(bd)
    e = OxmlElement(f"w:{edge}")
    e.set(qn("w:val"), "single")
    e.set(qn("w:sz"), str(sz))
    e.set(qn("w:space"), str(space))
    e.set(qn("w:color"), color)
    bd.append(e)


def keep_with_next(par):
    pPr = par._p.get_or_add_pPr()
    k = OxmlElement("w:keepNext")
    pPr.append(k)


def fix_width(table, cols):
    """Word autofits to content, which squeezes the narrow columns to nothing.
    Pin the grid so the three-column tables keep their proportions.
    """
    tblPr = table._tbl.tblPr
    for tag in ("w:tblW", "w:tblLayout"):
        for el in tblPr.findall(qn(tag)):
            tblPr.remove(el)
    w = OxmlElement("w:tblW")
    w.set(qn("w:w"), "5000")
    w.set(qn("w:type"), "pct")
    tblPr.append(w)
    lay = OxmlElement("w:tblLayout")
    lay.set(qn("w:type"), "fixed")
    tblPr.append(lay)
    table.autofit = False
    grid = table._tbl.find(qn("w:tblGrid"))
    for gc, twips in zip(grid.findall(qn("w:gridCol")), cols):
        gc.set(qn("w:w"), str(twips))


def emit(par, text, size, color, italic=False, base_bold=False):
    """Write text into a paragraph, honouring **bold** segments."""
    for i, chunk in enumerate(text.split("**")):
        if not chunk:
            continue
        r = par.add_run(chunk)
        r.font.name = BODY
        r.font.size = Pt(size)
        r.font.color.rgb = color
        r.bold = base_bold or (i % 2 == 1)
        r.italic = italic
    return par


def para(
    doc,
    text="",
    size=10.5,
    color=INK2,
    italic=False,
    bold=False,
    before=0,
    after=5,
    spacing=1.16,
    indent=0.0,
):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.space_before = Pt(before)
    pf.space_after = Pt(after)
    pf.line_spacing = spacing
    if indent:
        pf.left_indent = Inches(indent)
    if text:
        emit(p, text, size, color, italic=italic, base_bold=bold)
    return p


def heading(doc, number, title):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(18)
    p.paragraph_format.space_after = Pt(6)
    n = p.add_run(f"{number}.  ")
    n.font.name, n.font.size, n.font.color.rgb, n.bold = BODY, Pt(13), ACCENT, True
    t = p.add_run(title)
    t.font.name, t.font.size, t.font.color.rgb, t.bold = BODY, Pt(13), INK, True
    rule(p)
    keep_with_next(p)
    return p


def step(doc, n, text, last=False):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.left_indent = Inches(0.34)
    pf.first_line_indent = Inches(-0.34)
    pf.space_before = Pt(0)
    pf.space_after = Pt(9 if last else 5)
    pf.line_spacing = 1.16
    r = p.add_run(f"{n}.  ")
    r.font.name, r.font.size, r.font.color.rgb, r.bold = BODY, Pt(10.5), ACCENT, True
    emit(p, text, 10.5, INK2)
    return p


def callout(doc, label, text):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.left_indent = Inches(0.12)
    pf.space_before = Pt(2)
    pf.space_after = Pt(10)
    pf.line_spacing = 1.16
    r = p.add_run(f"{label}  ")
    r.font.name, r.font.size, r.font.color.rgb, r.bold = BODY, Pt(10), ACCENT, True
    emit(p, text, 10, INK2)
    rule(p, edge="left", sz=12, space=8, color="9EC2C6")
    return p


def table(doc, headers, rows, widths):
    t = doc.add_table(rows=1, cols=len(headers))
    t.alignment = WD_TABLE_ALIGNMENT.LEFT
    fix_width(t, widths)
    for cell, text in zip(t.rows[0].cells, headers):
        cell_borders(cell)
        shade(cell._tc.get_or_add_tcPr(), HEAD)
        p = cell.paragraphs[0]
        p.paragraph_format.space_before = Pt(3)
        p.paragraph_format.space_after = Pt(3)
        emit(p, text, 9.5, INK, base_bold=True)
    for i, row in enumerate(rows):
        cells = t.add_row().cells
        for j, (cell, text) in enumerate(zip(cells, row)):
            cell_borders(cell)
            if i % 2:
                shade(cell._tc.get_or_add_tcPr(), TINT)
            p = cell.paragraphs[0]
            p.paragraph_format.space_before = Pt(3)
            p.paragraph_format.space_after = Pt(3)
            p.paragraph_format.line_spacing = 1.12
            emit(p, text, 9.5, INK if j == 0 else INK2)
    doc.add_paragraph().paragraph_format.space_after = Pt(4)
    return t


# --------------------------------------------------------------- document
doc = Document()
normal = doc.styles["Normal"]
normal.font.name = BODY
normal.font.size = Pt(10.5)
normal.element.rPr.rFonts.set(qn("w:eastAsia"), BODY)

sec = doc.sections[0]
sec.top_margin = sec.bottom_margin = Inches(0.8)
sec.left_margin = sec.right_margin = Inches(0.85)

title = doc.add_paragraph()
title.paragraph_format.space_after = Pt(2)
r = title.add_run("RackTrack")
r.font.name, r.font.size, r.font.color.rgb, r.bold = BODY, Pt(12), ACCENT, True

h = doc.add_paragraph()
h.paragraph_format.space_after = Pt(6)
r = h.add_run("Getting Started")
r.font.name, r.font.size, r.font.color.rgb, r.bold = BODY, Pt(24), INK, True

sub = para(doc, "How to sign in for the first time", size=12.5, color=MUTED, after=8)
meta = para(doc, "For new users  |  2 September 2026", size=9.5, color=MUTED, after=10)
rule(meta)

para(
    doc,
    "This guide takes you from nothing to your first screen inside RackTrack. It takes about "
    "five minutes. Please read section 1 first: those three points are what stop most people. "
    "Section 7 explains the roles and what each one is allowed to do.",
    size=11,
    color=INK2,
    after=4,
)

# ---------------------------------------------------------------- 1
heading(doc, 1, "Before you begin")

para(doc, "**Check which email address you will use.**", size=10.5, color=INK, after=2)
para(
    doc,
    "Only a Gmail address, one ending in @gmail.com, can create a brand new account on its own. "
    "If you use a work address such as name@yourcompany.com, the sign-up screen will not accept "
    "it. That is normal and nothing is broken. It means you should be **invited** by your "
    "administrator instead, and an invitation accepts any email address, work addresses included.",
    after=9,
)

para(doc, "**Keep your inbox open.**", size=10.5, color=INK, after=2)
para(
    doc,
    "RackTrack emails you a six digit code, and that code is valid for **one minute only**. Open "
    "your inbox before you ask for the code, so you can read it the moment it arrives. If the "
    "minute runs out, tap Resend and use the new code straight away.",
    after=9,
)

para(doc, "**Nothing happens automatically.**", size=10.5, color=INK, after=2)
para(
    doc,
    "RackTrack does not send invitation emails, and nobody is alerted when a new company signs up. "
    "A person has to send you the link, and a person has to approve a new company. So if you are "
    "waiting, send them a message. That is almost always the whole fix.",
    after=4,
)

# ---------------------------------------------------------------- 2
heading(doc, 2, "Where to open RackTrack")
table(
    doc,
    ["Your device", "What to do"],
    [
        [
            "Any laptop or phone",
            "Open **https://demo.racktrack.ai** in your web browser. There is nothing to install, and "
            "it works the same on a laptop and on a phone. This is the quickest way to start.",
        ],
        [
            "iPhone or iPad",
            "Install Apple's free **TestFlight** app from the App Store, then install RackTrack from "
            "the TestFlight invitation the RackTrack team sends you.",
        ],
        [
            "Android phone",
            "The RackTrack team sends you an installation file ending in .apk. Open the file and allow "
            "the installation when your phone asks.",
        ],
    ],
    widths=[2100, 7100],
)

# ---------------------------------------------------------------- 3
heading(doc, 3, "Which route is yours")
para(
    doc,
    "There are only two ways into RackTrack. Find yourself in the table below and follow that "
    "route. You do not need to read the other one.",
    after=6,
)
table(
    doc,
    ["Your situation", "Follow"],
    [
        ["Someone sent you an invitation link", "**Route 1** (section 4)"],
        ["You are the first person from your company to use RackTrack", "**Route 2** (section 5)"],
    ],
    widths=[6600, 2600],
)

# ---------------------------------------------------------------- 4
heading(doc, 4, "Route 1: you received an invitation link")
para(
    doc,
    "This is how nearly everyone joins, including managers and directors using a work email "
    "address. There is no code to enter and no waiting.",
    size=10,
    color=MUTED,
    italic=True,
    after=8,
)
step(
    doc,
    1,
    "Open the link that was sent to you. The top of the page tells you what you are joining, for "
    "example **Join Acme - London as Member**. Check that the team and the role are right.",
)
step(
    doc,
    2,
    "Your email address is already filled in and cannot be changed. The invitation was issued to "
    "that exact address, which is how RackTrack knows the link belongs to you.",
)
step(
    doc,
    3,
    "Choose a **username** and a **password**. The password needs all five of these at once: at "
    "least 8 characters, one capital letter, one small letter, one number, and one special "
    "character such as ! or #. The meter under the box tells you the one thing still missing.",
)
step(
    doc,
    4,
    "Tap **Join**. You are signed in immediately and taken straight to the scan screen.",
    last=True,
)
callout(
    doc,
    "Quicker still:",
    "If your invitation was sent to a Gmail address, tap **Continue with Google** on the same "
    "page. It does steps 2 to 4 in a single tap, as long as the Google account you choose is "
    "the same address the invitation was sent to.",
)
callout(
    doc,
    "Please note:",
    "An invitation link works **once**, and it stops working **seven days** after it was "
    "created. A link that has been used or has expired cannot be revived, so ask your "
    "administrator for a fresh one.",
)

# ---------------------------------------------------------------- 5
heading(doc, 5, "Route 2: you are the first person from your company")
para(
    doc,
    "This is done once per company. Everyone who joins after you uses an invitation, not this "
    "screen.",
    size=10,
    color=MUTED,
    italic=True,
    after=8,
)
step(doc, 1, "Open RackTrack and tap **Get Started**.")
step(
    doc,
    2,
    "Fill in a **@gmail.com** email address, a **username**, your **Organization** name (this is "
    "your company, and it is what your colleagues will see), and a **password**, which you type "
    "twice so a typing slip cannot lock you out.",
)
step(doc, 3, "Tap **Continue**. A six digit code is sent to that inbox.")
step(
    doc,
    4,
    "Type the code into the six boxes and tap **Verify**. Remember the code expires after one "
    "minute. If you miss it, tap **Resend** and use the new code at once.",
)
step(
    doc,
    5,
    "You will land on a screen that says **Waiting for approval**. Your company account now "
    "exists, but it cannot scan yet.",
)
step(
    doc,
    6,
    "**Message the RackTrack team and ask them to approve it.** Then leave the screen open. It "
    "checks by itself every few seconds and lets you through the moment you are approved.",
    last=True,
)
callout(
    doc,
    "Why people get stuck here:",
    "Nobody is emailed when you sign up. The approval screen is not a queue that somebody is "
    "watching. The RackTrack team only sees you by opening their console and looking, so one "
    "short message from you is usually all it takes.",
)

# ---------------------------------------------------------------- 6
heading(doc, 6, "Signing in from then on")
step(
    doc,
    1,
    "Leave the first box, **Organization**, **empty**. It is marked optional, and you only fill "
    "it in on the rare occasion that the same username exists in two companies and RackTrack "
    "needs you to say which one you mean.",
)
step(doc, 2, "Enter your **username or email address**, then your **password**.")
step(
    doc,
    3,
    "Tap **Sign in**. Administrators land on the Organizations console. Everybody else lands on "
    "the scan screen.",
    last=True,
)
callout(
    doc,
    "Good to know:",
    "You stay signed in for **30 days**, so you will not be typing your password on every "
    "visit. Losing signal does not sign you out either. RackTrack keeps working in the parts "
    "of a data center with no reception and catches up once you have a connection again.",
)

# ---------------------------------------------------------------- 7
doc.add_page_break()
heading(doc, 7, "Roles: who can do what")
para(
    doc,
    "Everybody in RackTrack has one role. It decides what appears in your menu and which scans "
    "you are allowed to see. You can check your own role at any time: open **Profile**, and it is "
    "listed there.",
    after=8,
)
table(
    doc,
    ["Role", "Who this usually is", "What they can do"],
    [
        [
            "Member",
            "Most of your team. The people who go to the rack and scan it.",
            "Scan racks, read the results and correct them, reopen earlier scans, look up switch and "
            "firmware details, ask DOT for help, and edit their own profile.",
        ],
        [
            "Site Manager",
            "The person who runs one building or site.",
            "Everything a Member can do, and they also look after the people at their own site: invite "
            "someone new, add an account by hand, switch a person off, or reset a person's password.",
        ],
        [
            "Org Admin",
            "The person who looks after your company's RackTrack account.",
            "Everything above, across every site in the company. They also create sites, connect your "
            "Data Sources such as a CMDB, and use the Marketplace.",
        ],
        [
            "Owner",
            "The RackTrack team, not somebody at your company.",
            "Runs the platform. Approves new companies and supports every organization.",
        ],
    ],
    widths=[1400, 2700, 5100],
)

para(doc, "**Which scans each role can see**", size=10.5, color=INK, before=6, after=5)
table(
    doc,
    ["Role", "Scans visible to them"],
    [
        ["Member", "Their own site only."],
        ["Site Manager", "Their own site only. The same scans a Member at that site sees."],
        ["Org Admin", "Every site in their own company."],
        ["Owner", "Everything on the platform. This is the RackTrack team."],
    ],
    widths=[2000, 7200],
)

callout(
    doc,
    "What you see in the menu:",
    "Everybody gets Home, Scan, 2 Racks, Ask DOT, Contact and Profile. An **Org Admin** also "
    "gets Organizations, Data Sources and Marketplace. The Owner additionally gets Console and "
    "Lab. So if a colleague has menu items you do not have, it is because their role differs "
    "from yours, not because anything is broken.",
)
callout(
    doc,
    "What a Site Manager cannot do:",
    "Within their own site a Site Manager may switch a Member on or off and reset that "
    "Member's password. They cannot change a Member's username, email address, role or site, "
    "and they cannot manage another Site Manager.",
)
callout(
    doc,
    "One rule about Org Admins:",
    "Only the Owner can change an Org Admin account. One Org Admin cannot edit another, which "
    "keeps two administrators from locking each other out.",
)

# ---------------------------------------------------------------- 8
doc.add_page_break()
heading(doc, 8, "If something does not work")
para(
    doc,
    "Find the words you can see on your screen in the left column.",
    size=10,
    color=MUTED,
    italic=True,
    after=7,
)
table(
    doc,
    ["What you see", "What it means", "What to do"],
    [
        [
            "Please use a @gmail.com email address to create an account",
            "You are on the sign-up screen with a work email address. Only Gmail addresses can create "
            "an account unaided.",
            "Ask your administrator to **invite** your work address instead. Invitations accept any "
            "email address.",
        ],
        [
            "Waiting for approval",
            "Your company account was created, but nobody has approved it yet, and nobody was told you "
            "are there.",
            "Message the RackTrack team. Leave the screen open. It lets you in by itself once you are "
            "approved.",
        ],
        [
            "Request not approved, or Organization deactivated",
            "Somebody declined the request, or switched off a company account that was active before.",
            "Contact the RackTrack team to discuss it. Nothing you tap in the app will change this.",
        ],
        [
            "The code never arrives, or it is refused",
            "The code is only valid for one minute. It may also be sitting in your spam folder, or the "
            "email address was mistyped.",
            "Check the spam folder, confirm the address is right, tap **Resend**, and enter the new "
            "code immediately.",
        ],
        [
            "This invite has already been used, or This invite has expired",
            "Invitation links can be used once, and they stop working after seven days.",
            "Ask your administrator for a brand new link. The old one cannot be brought back.",
        ],
        [
            "This invite was sent to one address, but your Google account uses another",
            "You tapped **Continue with Google** and chose a different Google account from the one the "
            "invitation was sent to.",
            "Choose the Google account matching the invited address, or set a username and password on "
            "the page instead.",
        ],
        [
            "No RackTrack account uses this email",
            "You tapped **Continue with Google** without having an account yet. Google can sign you in "
            "or open an invitation, but it cannot create a new company account.",
            "Open an invitation link, or follow Route 2 with an email address and a password.",
        ],
        [
            "A message about too many attempts, or the words rate_limited",
            "You have tried to sign in too many times in quick succession. Nothing is broken and your "
            "account is not locked.",
            "Wait a full minute, then try once more.",
        ],
        [
            "You have simply forgotten your password",
            "You do not need an administrator for this. The sign-in screen handles it.",
            "Tap **Forgot password?**, enter your email, type the code, then choose **No, take me to "
            "the app** to get straight in without inventing a new password.",
        ],
    ],
    widths=[2500, 3200, 3500],
)

# ---------------------------------------------------------------- 8
heading(doc, 9, "For administrators: adding your team")
step(doc, 1, "Open the console, find the **Site** the person belongs to, and tap **Invite**.")
step(
    doc,
    2,
    "Enter their email address and choose a role: **Member** or **Site Manager**. Section 7 "
    "explains what each one can do. If you are a Site Manager yourself, every invitation you "
    "create is a Member, because only an Org Admin can appoint a Site Manager.",
)
step(doc, 3, "Tap **Create invite link**, then tap **Copy**.")
step(
    doc,
    4,
    "**Send them the link yourself**, by email or chat, or however you normally reach them.",
    last=True,
)
callout(
    doc,
    "The two rules that matter:",
    "RackTrack does **not** send the invitation for you. If you do not copy the link and send "
    "it, nothing reaches the person. And every link works once and expires after seven days.",
)
callout(
    doc,
    "Two other cases:",
    "For a shared account, a contractor, or somebody with no reachable email, use **+ Add "
    "member** instead. You set their username and password and hand them over. And if you see "
    "**Someone with that email already has an account**, that person is already registered, so "
    "send them to the sign-in screen or to Forgot password rather than issuing an invitation.",
)

# ---------------------------------------------------------------- 9
heading(doc, 10, "Still stuck?")
para(
    doc,
    "Contact the person who sent you this guide, or open **Help** or **Contact** inside RackTrack "
    "once you are signed in. When you write, please tell us the exact words on your screen and "
    "the email address you were using. That is usually enough for us to answer in one reply.",
    after=10,
)

foot = para(
    doc,
    "RackTrack Getting Started guide  |  Prepared 2 September 2026  |  "
    "Everything here describes the current release at demo.racktrack.ai. Anything not "
    "covered is in the full RackTrack User Guide.",
    size=8.5,
    color=MUTED,
    after=0,
)
rule(foot, edge="top")

doc.save(OUT)

# ---------------------------------------------------- guard: no long dashes
bad = []
for p in doc.paragraphs:
    for ch in ("—", "–"):
        if ch in p.text:
            bad.append(p.text)
for t in doc.tables:
    for row in t.rows:
        for c in row.cells:
            for ch in ("—", "–"):
                if ch in c.text:
                    bad.append(c.text)
if bad:
    raise SystemExit("Long dash found in copy:\n" + "\n".join(bad[:5]))

print(f"Wrote {OUT}")
print(f"Paragraphs: {len(doc.paragraphs)}   Tables: {len(doc.tables)}   No long dashes.")
