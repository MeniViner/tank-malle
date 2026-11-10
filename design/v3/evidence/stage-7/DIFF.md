# Stage 7: visual review against the prototype (390 px, light and dark)

## How it was done

- **Builds compared**: the "after" set from this stage (`after/`, gallery at `fbc4bf1`), the v2 baseline (`../stage-0/before/`) and the prototype (`../stage-0/prototype/`).
- **Method**: I put the three versions side by side in one image for each screen (top 1,500 px of each). The images were built in a scratch folder and are not committed. I read every pair in light; I also read Home, Journal, Insights spending, Vehicle and the business statement in dark.
- **Data**: the gallery seed differs from the prototype's, so this review ignores numbers and covers layout, type, colour, copy and structure.
- **Verdicts**: **=** matches. **J** differs, justified (the stage DIFF entry is cited). **D** defect (see QA.md).

| Screen | Verdict | Notes |
|---|---|---|
| Home | = / J | The status line, spotlight, facts strip with leaders, TCO card (period chip, full legend) and quiet chart match in both themes. The chip sits at the far end of the number row: J, stage-2 #11. Block rhythm is 26px: J, stage-2 #1. |
| Journal | = / J | The period chip comes first, the fade mask is there, and the summary row has a dotted leader plus "על מה הסכום מבוסס?". The search field is always visible: J, stage-4 layout table. |
| Insights · consumption | J / D-low | The facts strip and best/worst rows match. The chart is still v2's curved (spline) line with a y-axis on the side. The prototype draws a straight polyline with the average dashed and no axis. No stage DIFF covers this; see D6. The segments table stays in "כל המקטעים ופרטיהם": J, stage-3 #2. |
| Insights · price | J | Same chart treatment as the consumption tab (D6). The price-extremes facts and the station card are kept: J, stage-3 #4. |
| Insights · spending | J | The TCO card matches. The monthly chart keeps the production refunds column and axis: J, stage-3 #5–#7. |
| Insights · community | not comparable | The gallery seed has no community pool, so production shows the "waiting for 4 cars" state and the prototype shows a filled cohort. Layout parity is covered only by the e2e specs. |
| Vehicle (hub) | = / D | Plate, odometer drum, the docs rows' "ימים נותרו" countdown and the hairlines match. **D1**: the model name "i20" renders as "20i" in the heading (the prototype shows "i20 Inspire"). This bidi bug is in the v2 baseline too. |
| Vehicle edit | J / D-low | The layout matches. There is no "חשמלי" drivetrain choice for a fuel car (the prototype has one), and "אחר" is kept. No stage DIFF lists this; see D7. Hiding the EV fields is covered by stage-4 "EV". |
| Year screen | J | Title "שנת 2026" plus the "כמה עלה" facts strip and a link to the year's records. The prototype's monthly bars and record list are not in production: J, stage-3 #14. |
| Account | J | The identity button opens a sheet instead of inline facts: J, stage-3 #20. The scanV2 switch row was added (Stage 6 QA). |
| Fill-up (filled) | = / J | The header has receipt and camera icons, plus the ink pump, segmented control and preview. The "עוד פרטים" sub-line differs: J, stage-4 layout. |
| Tank sheet | J | The optional odometer field sits before "עדכון המחוון": J, stage-4 layout. The trip warning is absent because of the data. |
| Measurement sheet | = | The facts strip has dotted leaders and mono values, plus full count, restarts and the open-segment row (stage-4 QA-merged, D1 fix). |
| TCO sheet | = | The order, the colours of the category tiles, and the segmented control match. |
| Car switcher | = / D | The layout matches. D1 shows here too: the sub-line reads "יונדאי 20i · 2019". |
| Station sheet | J | Production groups and the sort select replace the prototype tabs: J, stage-4 layout. |
| Reminder detail | J | Production uses a page route; the prototype uses a sheet. Under the HANDOFF §6 policy, production's IA wins (stage-0 vehicle.md). The ".ics" and snooze rows are present. Not itemised in a stage DIFF. |
| Issue detail | J | Production page, v3 look. |
| Service form (step 1) | = / J | The tile borders are darker than the prototype's hairline. This is the `--line-control` contrast fix for WCAG 1.4.11: J, stage-4 accessibility notes. |
| Expense details | = | The "לכלול בעלות הרכב" toggle with its ⓘ, the date field and the draft footer. |
| Exclude explainer | J | The primary accent button replaces the prototype's ink button: J, stage-4 layout. |
| Journal info sheet | = | |
| Snooze sheet | = | The preset rows have chevrons and full month names (stage-4 D2 fix). Production keeps the extra date field and confirm button. |
| Doc (test) sheet | = | |
| Business statement | J | The month chips cover months that have records, the details are saved by an explicit button, and "CSV ל-Excel" is a button: J, stage-3 #25–#28. |
| Notifications | J | v3 look only. The prototype's action-rich cards and new/read groups are not in production: J, stage-3 "Notifications". |
| Unsynced | J | The prototype's offline demo toggle and stepper are not in production: J, stage-3, and stage-0 README #8/#22. |
| Import | J | No tabs and no sample-file link: J, stage-3. |
| Vehicles | = | |
| Wizard (plate) | = | |
| Onboarding 1 | = / J | Real `TcoCard` artwork: J, stage-5 DIFF. |
| Sign-in | J | Trust-line copy kept: J, stage-5 DIFF. |

## Gaps in the gallery seed

The gallery does not seed an EV vehicle, an excluded expense or a community pool. I covered EV and the excluded expense with the Stage 7 smoke walk (`smoke/ev-*`, `smoke/journal-excluded-*`, `smoke/statement-*`); see QA.md. EV screens were **not** compared side by side with `prototype/ev-*.png`, because the gallery has no EV capture. I did check the smoke-walk EV screenshots against the brief's rule (see QA.md D2–D4).
