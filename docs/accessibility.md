# Accessibility check (T20)

Checked on 4 October 2026 against the web app on `feature/T20_accessibility`, with the
demonstration data, using axe-core 4.13 (the checker behind Lighthouse and the axe browser
extension).

## 1. The checker over every screen

`web/test/every-screen-a11y.test.tsx` runs axe-core over all 21 web screens (14 manager, 6
worker, sign-in) with data on screen, and fails on any serious or critical problem. It runs
with the other web tests on every pull request.

It found problems on 8 screens. All are fixed:

| Screen | Problem | Fix |
|---|---|---|
| All five worker capture forms | Labels were not tied to their fields, so a screen reader announced "combo box" or "edit" with no name | Each label points at its field (`htmlFor` / `id`) |
| Every manager form (T18) | The shared `Field` label was not tied to its control | The label wraps its control |
| Employees, Fuel slips | Filter dropdowns had no name | Named ("Filter by mine", "Filter by shift", "Filter by vehicle") |
| Clients | A hidden `<span>` used as a dialog trigger carried ARIA attributes a span may not have | A dialog the screen opens itself renders no trigger |
| Worker fuel form | The "or type a vehicle" box had only a placeholder | Named |

Not covered by the automated run: the employee detail page and a Reefie conversation, which
need an id in the address. The Reefie conversation had its colours checked in the browser
(section 2); the employee detail page has not been checked yet.

## 2. Colours in the light and the dark theme

axe-core's colour-contrast rule needs real styles, so it was run in a browser on every screen,
signed in as the owner (15 manager screens) and as a worker (6 worker screens), first in the
light theme and then in the dark theme. Every page was confirmed to have loaded with data
before it was checked.

| | Light | Dark |
|---|---|---|
| Manager screens (15) | No problems | 4 screens failed, now fixed |
| Worker screens (6) | No problems | No problems |

The four dark-theme failures were the same thing: white text on the dark theme's light red
(the "Low", "Breakdown" and "No stock" badges and the dashboard's percentage) at 2.76:1, below
the 4.5:1 minimum, on the dashboard, equipment, downtime and inventory screens. The text on
that red is now dark, and all four pass.

Note: the dark theme is defined in the styles but the app has no switch for it yet. It was
tested by turning it on directly.

## 3. One capture form with the keyboard alone

`web/test/keyboard-only.test.tsx` completes the worker's Log production form without a mouse:
Tab to the mine, Enter to open the list, the arrow keys to choose, Enter to pick, Tab to the
tons and type them, Tab to Save, Enter. The entry is sent.

Recording: _to add — a short screen recording of the same steps by hand._

## 4. One capture form read out by a screen reader

_To add — Log production read out with NVDA or Windows Narrator: each field should be
announced with its label ("Mine, combo box", "Tons produced, spin button", "Save, button")._
