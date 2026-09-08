# Sign-in and the front of the app

**SPRTMS-1640** · Sprintpark Rack Track Management System

_The first screen anyone sees, cut back to what it is for._

## How it was before

Sign-in was sized from the browser window rather than from the space it actually occupies. On several phones that put the button below the fold, so the first thing a new person met was a screen that appeared to have no way forward.

The styling was soft and raised, with shadows suggesting depth that is not there. It dated the app and did not match the rest of it.

## What we decided, and why

Reduce it to the four things it needs and size it from its own box.

A sign-in screen has one job. Anything on it that is not the logo, the name, the two fields or the button is in the way.

## What we built

**Four things and nothing else**

A logo, the product name, a username field, a password field, and a button.

**Sized from its own box**

The layout takes its measurements from the container it sits in rather than from the browser window, so the button is on screen on every phone we have tested.

**A line that says what the product is**

Physical Infrastructure Intelligence for Data Centers.

**Flat, and the full width of the device**

The raised, soft-shadowed treatment is gone. The page uses the whole width of the screen rather than a narrow column down the middle.

## How to check it yourself

1. Open the app on the smallest phone you have. The button should be visible without scrolling.
2. Rotate the phone. The button should stay visible.
3. Check the line under the product name reads the new tagline.

## Where it lives

- The screen: client/src/pages/LoginPage.jsx

## What is not done

Nothing outstanding.
