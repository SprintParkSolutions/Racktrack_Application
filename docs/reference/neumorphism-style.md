# Slight neumorphism — the style, as a reusable prompt

**Category:** Reference — interface & design system · **Audience:** The team ·
**Document date:** 31 July 2026 · Part of the RackTrack documentation set.

The look used on the help-bot feedback form
(`docs/handouts/racktrack-bot-feedback-form.html`), written down so it can be
applied to the app. See also [ui-reference-developers.md](ui-reference-developers.md)
for the design system this has to live inside.

---

## 1. The one idea

Put a single light source at the top-left, then give every surface **two**
shadows instead of one — a dark one bottom-right where light doesn't reach, and
a **white** one top-left where it does.

The white shadow is the entire trick. Without it you have an ordinary drop
shadow. With it, the surface reads as carved from the same material as the page
rather than floating above it.

Two states carry all the meaning:

| State | Shadow | Means |
| --- | --- | --- |
| Raised | outer | you can act on this — cards, buttons, unselected options |
| Recessed | `inset` | something goes in here, or is already set — inputs, selected options, summary panels |

---

## 2. The prompt

Paste this when you want the style applied to something new.

```
Style the UI with restrained neumorphism — soft, not skeuomorphic, and never
glossy.

GROUND. The page background must be a mid-tone, never pure white — around
#E9ECF1, a grey with a faint blue bias. Raised surfaces are LIGHTER than the
ground (#F2F4F8). Recessed surfaces are DARKER (#E4E8EE). That lightness
relationship does more work than the shadows do; get it right first.

LIGHT. One source, top-left. Every surface gets two shadows:
  raised:   4px 4px 10px rgba(14,17,20,.07), -4px -4px 10px rgba(255,255,255,.9)
  recessed: inset 2px 2px 5px rgba(14,17,20,.08), inset -2px -2px 5px rgba(255,255,255,.85)
Keep blur small and opacity low. Large soft shadows read as a consumer app.
The dark shadow's hue must match the ground's hue — a tinted shadow on a
neutral grey looks like a smudge, and a neutral shadow on a tinted ground
looks dead.

APPLY IT. Cards, buttons and unselected options are raised. Text inputs,
selected options and summary panels are recessed. Use the same two shadows to
say something true about the page — e.g. questions rise, the summary at the
end sinks — not as decoration on everything.

RADII. 12px on containers, 9px on controls. Not pills; pills read as consumer.

COLOUR. Near-black ink (#0E1114), one muted accent (#2E5F8F) used ONLY for
state — focus rings, active numbers, progress. Everything else is greys.

NEVER let a shadow be the only signal. A recessed "selected" option must also
change something non-shadow: a filled dot, a weight change. Focus rings are
hard, never blurred: box-shadow: <the inset>, 0 0 0 2px <accent>.

Type: one display face for headings, one text face for body, one mono for
labels and numbers. Uppercase mono labels at ~9.5px with .13em tracking.
```

---

## 3. The tokens

```css
:root{
  --ground:#E9ECF1;   /* page. mid-tone, never white */
  --raised:#F2F4F8;   /* lighter than ground */
  --sunken:#E4E8EE;   /* darker than ground */

  --ink:#0E1114;  --ink-2:#333B45;  --muted:#6E7783;  --faint:#98A1AD;
  --line:#D3D9E2; --accent:#2E5F8F;

  --hi:rgba(255,255,255,.9);
  --lo:rgba(14,17,20,.07);

  --lift:       4px 4px 10px var(--lo), -4px -4px 10px var(--hi);
  --lift-sm:    2px 2px 5px rgba(14,17,20,.06), -2px -2px 5px rgba(255,255,255,.85);
  --press:      inset 2px 2px 5px rgba(14,17,20,.08), inset -2px -2px 5px rgba(255,255,255,.85);
  --press-deep: inset 3px 3px 7px rgba(14,17,20,.11), inset -2px -2px 5px rgba(255,255,255,.7);

  --r:12px; --r-sm:9px;
}
```

Component recipes, all of them one line of shadow:

```css
.card   { background:var(--raised); border-radius:var(--r);    box-shadow:var(--lift); }
.input  { background:var(--sunken); border-radius:var(--r-sm); box-shadow:var(--press); border:0; }
.button { background:var(--raised); border-radius:var(--r-sm); box-shadow:var(--lift-sm); }
.button:active            { box-shadow:var(--press); }
.option                   { background:var(--raised); box-shadow:var(--lift-sm); }
.option:has(:checked)     { box-shadow:var(--press); font-weight:600; }   /* + a filled dot */
.panel  { background:var(--ground); border-radius:var(--r);    box-shadow:var(--press); }
:focus-visible            { outline:none; box-shadow:var(--press), 0 0 0 2px var(--accent); }
```

---

## 4. Reconciling with what the app already has

`client/src/index.css` already defines this vocabulary, used 21 times across the
client (4 raised, 17 inset):

```css
--shadow-neu:       5px 5px 12px rgba(163,163,168,.28), -5px -5px 12px rgba(255,255,255,.90);
--shadow-neu-inset: inset 2px 2px 5px rgba(163,163,168,.32), inset -2px -2px 5px rgba(255,255,255,.92);
```

**Use those, not the form's, when working in the app.** Two things differ, and
both are consequences of one decision:

1. **The app's ground is #FAFAFA — near-white.** On a near-white canvas the
   white half of the shadow has almost nowhere to go, so the effect leans
   entirely on the grey half. That is exactly why `--shadow-neu` uses a much
   heavier grey (`rgba(163,163,168,.28)`) than the form does
   (`rgba(14,17,20,.07)`) — it is compensating for a ground that is too light
   for the technique. If you ever want the form's softer look in the app, the
   canvas has to come down toward #EEF0F3 first; strengthening the shadows
   instead just makes them dirty.

2. **The app's shadow is neutral grey, the form's is slightly blue.** The
   comment in `index.css` — a tinted neu shadow "reads as a dirty smudge" — is
   correct *for that ramp*, which is hueless (#FAFAFA → #FFFFFF → #F0F0F0). The
   form's ground is blue-biased, so its shadow is blue-biased to match. The rule
   underneath both: **the shadow's hue must match the ground's hue.** Mismatch
   in either direction is what looks dirty.

---

## 5. Rules worth keeping

- **Never let a shadow be the only signal.** A recessed "selected" state is
  invisible to some users and gone entirely in forced-colours mode. Always pair
  it with a filled marker and a weight change.
- **Focus rings are hard, not soft.** Stack a solid ring on top of the soft
  shadows. A blurred focus indicator fails accessibility checks.
- **Small blur, low opacity.** 7–8% black at 10px reads considered; 12%+ at
  20px reads like a phone game.
- **Don't shadow everything.** If every element is raised, nothing is. Reserve
  it for things you can act on.
- **Text never gets it.** No shadow on type, ever.

---

## 6. Dark mode

There is no working dark mode today — `client/src/ThemeContext.jsx` hardcodes
`'light'`, `toggleTheme` is a no-op, and the `[data-theme='dark']` selectors in
`index.css` resolve to the same white tokens. So this is not a live concern; it
is a note for whenever dark mode is actually built.

**The light tokens cannot simply be inverted.** In dark mode the "light" side of
the shadow is not white — it is a barely-there `rgba(255,255,255,.04)`, and the
dark side goes to roughly 50% black. The whole effect gets subtler and the
surface ramp has to be rebuilt (a dark ground around #22252A, raised slightly
lighter, recessed slightly darker). Plan on authoring the dark tokens by hand;
a naive flip produces muddy, shadowless boxes.

The feedback form sidesteps this by pinning `[data-theme="dark"]` back to the
light values — it is a document that gets printed and read on a phone in a
bright hall, so it commits to one theme deliberately.
