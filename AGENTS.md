# Product display rules

- All read-only amounts in Israeli shekels must display as whole shekels, rounded
  to the nearest shekel, with no decimal point or fractional digits. This includes
  totals, unit prices, discounts, differences, charts, tooltips, notifications,
  scan results, history, profile and admin views.
- Use `shekel`, `shekelSigned` or `price` from `src/lib/format.ts`, the matching
  components in `src/components/Fmt.tsx`, or `vehicleMoney` for integer agorot.
  Do not add local `toFixed`/`Intl.NumberFormat` currency implementations or
  per-call precision overrides. Money chart ticks must also be integers.
- This is a **display** rule. Preserve exact original monetary values in editable
  fields, calculations, validation, persistence, imports and exports. Never round
  stored prices, derive litres from a displayed rounded price, or save a formatted
  display string. An edit form may show its exact decimal value so an unchanged
  save does not silently change the user's data.
- Decimal precision for litres, fuel consumption, distances and percentages is
  independent of the currency display policy and must not change with it.
