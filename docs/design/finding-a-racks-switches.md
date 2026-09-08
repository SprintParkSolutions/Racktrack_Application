# Finding a rack's switches

*Design note, 8 September 2026.*

## The problem

A customer has five hundred switches. An engineer photographs one rack and needs
to know which switches are in it.

Two things stop us today.

You have to type in every switch by hand, address by address. That is five
hundred entries, and it assumes the engineer already knows which addresses are
in front of them, which is the thing they opened the app to find out.

Then we match switches to boxes in the photo mostly by counting ports, because
the camera can rarely read a model off a faceplate. In a lab with three
switches that works. In an estate with sixty identical forty-eight port
switches it tells us nothing, and we still show an answer.

## The answer

Read the label on the rack and compare it to the name the switch calls itself.

Our own labels read `SP-RI-U15-SW04`. Every managed switch reports a name. If
they match, that is the switch, and the label even tells us the shelf it sits
on.

We already read both. The label comes off the photograph, the name comes off
the switch, and they sit in the same place in our code without ever being
compared.

## Where the list of five hundred comes from

Either NetBox already holds the estate, in which case we simply read it, or we
find the switches ourselves: start from one address, ask it which switches it
can see, ask those the same, and keep going. Either way it is done once in the
background, not by a person standing at a rack.

## When the label does not settle it

Try the serial number, if NetBox holds it or a close-up caught the sticker.

Then use the fact that switches in one rack are almost always cabled to each
other. Once one switch in the photo is certain, its neighbours are very likely
the rest.

Port counts come last, to break a tie. Never on their own.

And when we are unsure, say so, and say why we think what we think. With five
hundred candidates a confident wrong answer is worse than no answer.

## What to do first

Compare the label to the switch's name, and pick the best set of matches for
the rack as a whole rather than taking the best single match first.

That is a small change, needs no new storage and no new service, and it makes
every properly labelled rack identify itself. Everything else can follow.

## Honesty

None of this is built yet. The first step is small. Moving the switch list out
from under the rack, and running discovery as a service, are bigger and need
proper planning.
