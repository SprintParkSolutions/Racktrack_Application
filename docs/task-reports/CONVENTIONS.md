# How we write these tickets

The shape every RackTrack ticket follows in Jira project SPRTMS, written down so
the next batch matches this one.

## The nine tasks in this batch

| Ticket | Title | Points | Sub-tasks |
|---|---|---|---|
| SPRTMS-1632 | Network: read live switches over SNMP from the mobile device | 8 | 3 |
| SPRTMS-1633 | SNMP read: ports, VLANs, neighbours, MAC and ARP tables, vendor MIBs | 8 | 3 |
| SPRTMS-1634 | Network page: per-switch cards with a two-row port faceplate | 5 | 2 |
| SPRTMS-1635 | Scan report: summary-first layout with populated fields only | 5 | 3 |
| SPRTMS-1636 | NetBox export: background comparison, object list and write confirmation | 8 | 3 |
| SPRTMS-1637 | Device identity: manual make and model precedence, vendor firmware lookup | 8 | 2 |
| SPRTMS-1638 | Drift: multi-switch polling, change log and per-port history | 5 | 4 |
| SPRTMS-1639 | Mobile UI: rack navigation, report actions and switch placement | 8 | 3 |
| SPRTMS-1640 | Sign-in: rebuilt layout, new tagline and flat styling | 3 | 0 |

Nine tasks, twenty-three sub-tasks, thirty-two issues, fifty-eight points on the
parents.

## The second batch, 15 September 2026

| Ticket | Title | Points | Sub-tasks |
|---|---|---|---|
| SPRTMS-1666 | Portal: first-run onboarding flow and organisation settings | 8 | 5 |
| SPRTMS-1667 | Rack Book: enter one rack in NetBox's own fields and export it for the end-to-end test | 8 | 3 |
| SPRTMS-1676 | Application: first-time setup screens, the Being set up hold, and the space picker on Scan | 5 | 0 |

Documents 10 to 12 in this folder; design documents are linked from each ticket's first comment, since the connector cannot attach files.

## Structure

- **Task** is the parent. **Sub-task** sits beneath it. We do not use Epics for
  this kind of work.
- A parent is one body of work a person could describe in a sentence.
- A sub-task is a piece someone could pick up on its own and finish.
- Something too small to stand alone becomes a sub-task rather than a thin
  parent. Something that is a whole screen or a whole subsystem stays a parent
  even if it is related to another one.
- A parent with no natural division has no sub-tasks at all. That is allowed and
  is better than inventing three.

## People

- **Assignee: Aasritha** on every issue, parents and sub-tasks alike.
- **Reporter: Mandar** on every issue.
- Priority is left at the default, Medium. No epic link, no sprint. New work sits
  in the backlog until someone puts it in a sprint deliberately.

## Status

Everything is created in Requirements and moved straight to **Development
Started**, because these tickets record work that is already built.

The workflow path, with the transition numbers:

| To | Transition |
|---|---|
| Development Started | 11 |
| Review | 41 |
| Ready for Acceptance | 51 |

Status is moved per batch, when someone decides the batch has reached that stage.
Nothing advances itself.

## Story points

- Fibonacci: 1, 2, 3, 5, 8.
- Parents run 3 to 8. Sub-tasks run 1 to 5.
- A parent is roughly the sum of its children, not more.
- Points are written to **both** point fields the board carries, Story Points and
  Story point estimate, so whichever one the board is configured to read shows a
  value.

## Title

Component first, then the specific change.

    Network page: per-switch cards with a two-row port faceplate
    TP-Link and D-Link firmware lookup by hardware revision
    Suppress empty fields from the report output

Not this:

    The report as a summary
    Call a router a router
    Make it better

A title should let someone scanning the board know which part of the product is
affected and what changed, without opening it.

## Description

Written as **instructions**. What to do, in the imperative. Never what we thought,
never what we did — those belong in the comments.

Shape: one opening line stating the requirement, then bullets for the specifics.

    Show each switch on the Network page as its own numbered card carrying its
    name, model, address and how many ports are up.

    - Draw the faceplate to the width of the screen, in two rows of numbered ports.
    - Put a switch's actions behind a menu on its own card, and allow it to be
      edited where it sits.
    - Keep the full detail behind Read more.
    - Leave every field empty when a switch is added.

## Comments

Two comments per parent, in this order.

**First: what was done, in a human voice.** One short paragraph, first person,
saying what actually happened and why. It reads like a person reporting back, not
like a changelog.

    This screen had grown into a wall of text. It is one card per switch now:
    the name, the model, the ports that are up and the numbered faceplate, with
    everything else under Read more. Adding a switch no longer pre-fills
    anything, because a guessed address that half works is worse than an empty
    field.

**Second: the build note.** The full document for that task, matching the file in
this directory. Its sections are fixed:

    How it was before
    What we decided, and why
    What we built
    How it works
    The rule we hold to        (only where there is one)
    An example                 (only where one helps)
    What we found on the office rack   (only where we measured something)
    Measured                   (only where there are figures)
    How to check it yourself
    Where it lives
    What is not done

## Documents

- One markdown file per task in `docs/task-reports/`, named by number and slug.
- `README.md` in the same directory indexes them.
- The same text is posted as the second Jira comment, so the ticket is readable
  without the repository and the repository is readable without Jira.
- Figures are measured, never estimated. If we did not measure it, it does not
  appear.
- "What is not done" is filled in honestly. A task with a real gap says so rather
  than rounding up to complete.

## Before creating anything

Search Jira for existing tickets covering the same ground and comment on those
instead of creating duplicates. For this batch the matches were the older
proof-of-concept work, all closed, so nothing was duplicated.
