# Stage 1 · Contrast (WCAG 2.x relative luminance)

Computed with the same formula as `src/lib/accents.ts#contrastRatio`. The
assertions that matter are locked in `src/lib/designTokens.test.ts` (reads the
real values from `src/index.css`), so a token change that breaks them fails `npm test`.

Backgrounds: light `--bg #F9F7F2`, `--surface #FFFFFF`; dark `--bg #1E1C18`, `--surface #282520`.

## Light accent `#F3C54B`

| pair | ratio | verdict |
|---|---|---|
| `#F3C54B` text on surface `#FFFFFF` | 1.63 | **fails** text (and 3:1) → never used as text on light surfaces |
| `#F3C54B` text on bg `#F9F7F2` | 1.52 | **fails** → never used as text on light surfaces |
| ink `#111111` text on `#F3C54B` fill | 11.60 | passes AAA |
| ink `#15130F` text on `#F3C54B` fill | 11.40 | passes AAA |
| `#F3C54B` text on readout `#15130F` (tank hero headline) | 11.40 | passes |
| `#F3C54B` text on `#111111` (saved stamp, pump "כן", saved ink button) | 11.60 | passes |
| dark accent `#E6B417` text on readout `#282520` | 7.93 | passes |
| dark accent `#E6B417` text on `#111111` | 9.81 | passes |
| ink `#111111` on dark accent `#E6B417` | 9.81 | passes |
| ink `#15130F` on active tab pill tint (38% accent over bg ≈ `#F7E4B3`) | 14.7 | passes |
| dark ink `#DDD6C7` on dark tab pill tint (≈ `#6A5618`) | 4.91 | passes |
| (reference) v2 `#FFC915` on `#FFFFFF` | 1.54 | the v2 accent had the same constraint |

**How it is handled.** A grep of every `color: var(--accent)` / `text-accent`
use found five, all on dark grounds (`--tm-readout-bg` tank hero, entry
refuel art, and three `#111` blocks on the saved screen). There is no accent-
coloured text on a light surface. Everything placed *on* an accent fill
(primary button, FAB, chips, toast undo, `text-accent-contrast` pills) uses
`--accent-contrast: #111111` (11.6:1). The active tab no longer has a solid
accent pill: it is a 38% tint with ink icon/label.

## Category colours (§4)

Fills, not text. Category icons on the TCO sheet tiles now use dedicated
`--cat-*-on` tokens (light: `#111111` on fuel, `#FFFFFF` on service/ins1/test,
`#15130F` on ins2/other; dark: `#15130F` on all but other, `#FFFFFF` on
other) — all ≥ 4.9:1 against their fill.

### light

| category | fill | vs surface #FFFFFF | vs bg #F9F7F2 | icon colour | icon vs fill |
|---|---|---|---|---|---|
| fuel | `#F3C54B` | 1.63 | 1.52 | `#111111` | 11.60 |
| service | `#15130F` | 18.55 | 17.33 | `#FFFFFF` | 18.55 |
| ins1 | `#2E5C8A` | 6.97 | 6.51 | `#FFFFFF` | 6.97 |
| ins2 | `#86ACCF` | 2.38 | 2.22 | `#15130F` | 7.79 |
| test | `#8C6A3F` | 4.94 | 4.62 | `#FFFFFF` | 4.94 |
| other | `#B9B2A4` | 2.11 | 1.97 | `#15130F` | 8.81 |

Pairwise (two segments next to each other):

| | fuel | service | ins1 | ins2 | test | other |
|---|---|---|---|---|---|---|
| fuel | — | 11.40 | 4.28 | 1.46 | 3.04 | 1.29 |
| service | 11.40 | — | 2.66 | 7.79 | 3.75 | 8.81 |
| ins1 | 4.28 | 2.66 | — | 2.92 | 1.41 | 3.31 |
| ins2 | 1.46 | 7.79 | 2.92 | — | 2.08 | 1.13 |
| test | 3.04 | 3.75 | 1.41 | 2.08 | — | 2.35 |
| other | 1.29 | 8.81 | 3.31 | 1.13 | 2.35 | — |

### dark

| category | fill | vs surface #282520 | vs bg #1E1C18 | icon colour | icon vs fill |
|---|---|---|---|---|---|
| fuel | `#E6B417` | 7.93 | 8.83 | `#111111` | 9.81 |
| service | `#D9D2C3` | 10.15 | 11.31 | `#15130F` | 12.33 |
| ins1 | `#6E9ED4` | 5.45 | 6.08 | `#15130F` | 6.63 |
| ins2 | `#A9C6E4` | 8.64 | 9.63 | `#15130F` | 10.50 |
| test | `#B99263` | 5.35 | 5.96 | `#15130F` | 6.50 |
| other | `#6F685D` | 2.77 | 3.09 | `#FFFFFF` | 5.51 |

| | fuel | service | ins1 | ins2 | test | other |
|---|---|---|---|---|---|---|
| fuel | — | 1.28 | 1.45 | 1.09 | 1.48 | 2.86 |
| service | 1.28 | — | 1.86 | 1.17 | 1.90 | 3.66 |
| ins1 | 1.45 | 1.86 | — | 1.58 | 1.02 | 1.97 |
| ins2 | 1.09 | 1.17 | 1.58 | — | 1.62 | 3.12 |
| test | 1.48 | 1.90 | 1.02 | 1.62 | — | 1.93 |
| other | 2.86 | 3.66 | 1.97 | 3.12 | 1.93 | — |

### Fills below the 3:1 target and what was done

- **Below 3:1 against the card:** light `fuel`, `ins2`, `other`; dark `other`
  (2.77). **Many adjacent pairs are below 3:1**, especially in dark, where
  the spec's five colours are all light-on-dark and close in luminance (they
  differ mainly in hue).
- **Not changed:** the hex values are the spec's (§4 table), and Stage 1 is
  not the place to re-pick a designer palette. Flagged for the design owner.
- **Why it is still usable / what the code does:**
  1. Segments never touch: `.tm-tco-bar` has a 3px gap, so each segment's
     edge is against the card surface, not against a neighbour. Adjacency
     contrast therefore does not decide legibility.
  2. Every segment and legend swatch keeps the existing
     `inset 0 0 0 1px rgb(0 0 0 / .15)` ring, which defines the edge of the
     pale light-mode fills (fuel/ins2/other) on white.
  3. Colour is never the only carrier: the bar is `aria-hidden`; the legend
     prints the label and the amount next to every swatch, and the cost sheet
     lists each category as a row with icon, label and amount. The bar is a
     redundant summary, so WCAG 1.4.11 does not require it to carry the
     information alone.
  4. "Never three greys in one bar" holds: only `other` is a grey.
- Spending chart (Insights) bars use the same tokens. `fuel` and `other`
  keep their `--ink` 0.65px stroke, so they read on white.

## Hairlines (non-text, for the record)

`--line` on its surface is 1.33:1 in both themes. Cards/rows are identified
by layout and copy, not by the rule, so this is the intended v3 look. Inputs
now also use the hairline (prototype `.inp`). Their boundary is below the
WCAG 1.4.11 3:1 target; every input has a visible Hebrew label and a 2px ink
focus outline, so it stays identifiable. **Open question for QA/design:**
whether inputs should keep a stronger border than cards (e.g. `--ink-3`:
5.53:1 light on `#FFFFFF`, 4.06:1 dark on `#282520`). Not changed in Stage 1.
