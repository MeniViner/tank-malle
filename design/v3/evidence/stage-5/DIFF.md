# Stage 5 UI (5c onboarding / sign-in, 5d EV wizard) — diff vs prototype

Compared `after/*-390-{light,dark}.png` (this stage, production build in e2e mode) with `../stage-0/prototype/{onboarding,signin,wizard}-390-{light,dark}.png` and `proto/screens2.js` (`Onboard`, `SignIn`, `Wizard`).

## Onboarding (4 slides)

| Difference | Why |
|---|---|
| Slide 2 shows chips תדלוק / טיפול / הוצאה; the prototype also has "טעינה", and its body says "טעינה: אחוז לפני ואחרי". | Production has no charge record or SoC form (EV-AUDIT.md; fills are litres + ₪/L). Onboarding must not promise a flow that does not exist. Re-add when a charge record ships. |
| Slide 3 body drops "(או טעינה) … kWh". | Same reason: no kWh records. |
| Slide 1 TCO legend splits "ביטוח" into ביטוח חובה + ביטוח מקיף, labels "טיפולים ותיקונים", "טסט ואגרת רישוי", "חניה, אגרות ושאר", and shows the period chip and "כ־21,324 ₪ בשנה · 1.46 ₪ לק״מ" sub-line. | The artwork is the real `TcoCard` (extracted from `TcoBlock`) with the engine's own part labels; the prototype card is a hand-drawn mock. |
| Slide 3 per-km reads "0.68 ₪ לק״מ" (not "68 אג׳ לק״מ"). | Production formats per-km with `price()` (two decimals, as on the TCO card); AGENTS.md forbids local formats. |
| Slide 4 next-refuel card is the real `TankHero` (gauge with labelled habit line, "במיכל כ־45% · כ־210 ק״מ עד לרזרבה", source line, "עדכון ›") rather than the prototype's ticks-only card. | Real component, static demo estimate. |
| Artwork sits in the existing v2 framed panel with "נתונים לדוגמה". | Kept from production (checklist item 10). |
| Title size 52px (was 58) to fit the longer v3 titles; prototype uses 52. | Matches prototype. |

All artwork is `aria-hidden` + `inert` with a Hebrew `sr-only` text alternative per slide; reduced motion disables any animation/transition inside it.

## Sign-in

| Difference | Why |
|---|---|
| Headline "כל מה שהרכב עולה. במקום אחד." at 72px; intro copied from the prototype. | As specified. |
| Trust line stays "הנתונים נשמרים בחשבון שלכם." (prototype: "…בחשבון שלך ורק אצלך."). | Production copy (checklist: auth copy must not change); "ורק אצלך" is not accurate for opt-in community sharing. |
| Consent links on two lines, Google button style. | Production v2 layout (44px targets), unchanged. |

## Wizard

| Difference | Why |
|---|---|
| Confirm step for an EV: rows יצרן/דגם/שנה/הנעה "חשמלי", הספק מנוע (registry `koah_sus` → kW, "מאתרים…" while loading, else "לא ידוע"); **battery kWh and WLTP range are editable inputs** (prototype shows read-only rows "ממאגר משרד התחבורה"). | The registers carry no kWh or range (EV-AUDIT.md; `EV_BATTERY_SPECS` is empty). The prototype's claim "ממאגר משרד התחבורה" would be false; the note says so and the owner may fill them (optional, 0.1–500 kWh, 1–2,000 km, exact values stored). |
| Manual mode fuel control has a fifth option "חשמלי" (prototype: 95/98/סולר/חשמלי, no "אחר"). | "אחר" is kept (production; LPG etc.); "חשמלי" stores `fuelType: other` + `powertrain: ev`. |
| Extras step for an EV: title "עוד פרט אחד", only the nickname (prototype re-asks battery/range there). | Battery figures live on the confirm step; no tank / km-per-litre fields for an EV (§7.4). |
| Plate step, keypad, back button: unchanged from production (prototype's 7–8 digit rule vs production's 5–8 kept). | Production wins (HANDOFF §6 policy). |

Not changed, noted: the FAB/fill entry label is unchanged for EVs; no charge/kWh records were invented.
