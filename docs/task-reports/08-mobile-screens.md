# The app's screens on a phone

**SPRTMS-1639** · Sprintpark Rack Track Management System

_Three screens reshaped around the job, rather than around the order they happened to be built in._

## How it was before

The same complaint arrived from three directions during the tester round, and it took a while to see that it was one complaint.

A switch read over the network and a device seen in the rack photograph were two unrelated things, so the app knew a switch existed and knew a device sat at U15 and could not connect the two.

The report's actions sat at the bottom of a long document and were split across a second screen, so finishing a report meant scrolling past everything and then navigating away.

The side menu had grown past the height of a phone. The last entries could only be reached by scrolling a list that did not look like it scrolled, which means for most people they did not exist.

## What we decided, and why

Put each screen in the order the work actually happens, and make sure the last thing you need is not off the bottom.

That principle decided all three: the match belongs where the switch was read, the actions belong at the top of the report, and a menu must fit the device it is on.

## What we built

**Putting a switch where it physically sits**

A switch read over the network can be matched to the device in the rack photograph, either by choosing from a list of the rack's devices or by tapping the unit on the photo itself. Where only one device could possibly fit, the app takes the match without asking, because asking a question with one answer is not a choice. The placement survives a reload, including a deliberate decision that a switch is not in this rack, and saving reports back in words: Sw1 went to U15, Sw2 to U14.

**The report's actions, at the top**

Download, Export and Share sit above the report, each opening its own choices underneath. Download offers CSV, JSON or PDF. Export goes to NetBox. Share sends by Teams, by email, or as a link that opens without an account. The separate export screen is gone.

**Five steps for a rack**

Overview, Network, Topology, Switches and Report, in the order a person walks them, with Drift behind More.

**A menu that fits**

The side menu spreads across whatever height the screen has, so no entry needs scrolling. History sits under Support, and the person's name and role show beside their avatar.

**Buttons that stay above the keyboard**

The app now shrinks when the keyboard opens. Any sheet that takes typing keeps its own button in view.

## How it works

The match is proposed by the server, which compares what the switch says about itself against what the camera found: port counts, position, make and model. Where exactly one device fits, the proposal is accepted automatically.

A placement made by hand is stored as the truth and is never overwritten by a later proposal, including a deliberate 'not in this rack'.

The keyboard fix is at the application level rather than per screen, so the same trap cannot reappear on a screen built next month.

## How to check it yourself

1. Read a switch, then save its place. The message should name where each switch went, not just say saved.
2. Set a switch to 'not in this rack', reload, and check it stayed that way.
3. Open a report. Download, Export and Share should be the first thing you see.
4. Open Share and choose Teams. There should be one field and one Send button, both visible with the keyboard open.
5. Open the menu on a small phone. Every entry should be visible without scrolling.

## Where it lives

- Choosing a place: client/src/components/PlacePicker.jsx
- The report's actions: client/src/pages/ReportPage.jsx
- Sending: client/src/components/ShareSheet.jsx
- The menu: client/src/nav/navLinks.jsx
- The tab bar: client/src/components/ScanTabBar.jsx

## What is not done

Nothing outstanding.
