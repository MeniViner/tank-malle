# Product display rules

- Read-only shekel amounts display as whole shekels, rounded to the nearest
  shekel: totals, costs, differences in totals, spend charts, tooltips,
  notifications, scan results, history, profile and admin views.
- Order (Design v3 §5): the number, a narrow no-break space (U+202F), then the
  symbol: `777 ₪`, signed `−12 ₪` / `+5 ₪`. The formatters produce this; never
  build the string by hand or put ₪ in front of the number.
- **Exception: per-litre fuel prices always show two decimals** (`7.35 ₪`, not `7 ₪`),
  including official/list prices, average price paid, per-litre discounts and
  the price chart. Rounding a fuel price to the shekel makes it meaningless.
- Use `shekel`/`shekelSigned` (totals) or `price` (per litre) from
  `src/lib/format.ts`, the matching components in `src/components/Fmt.tsx`, or
  `vehicleMoney` for integer agorot. Do not add local `toFixed`/`Intl.NumberFormat`
  currency implementations or per-call precision overrides. Spend chart ticks
  must be integers.
- This is a **display** rule. Preserve exact original monetary values in editable
  fields, calculations, validation, persistence, imports and exports. Never round
  stored prices, derive litres from a displayed rounded price, or save a formatted
  display string. An edit form may show its exact decimal value so an unchanged
  save does not silently change the user's data.
- Decimal precision for litres, fuel consumption, distances and percentages is
  independent of the currency display policy and must not change with it.
