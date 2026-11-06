# Evidence-based home insights

These cards use existing private vehicle records. They do not send push
notifications, ask users to fill missing fields, or reinterpret an old purchase
using a newly changed market price.

## Paid-price comparison

`src/lib/home/paidPriceInsight.ts` compares the latest fill-up, no more than
seven days old, with the recorded official 95 self-service mainland ceiling
that applied on its transaction date.

- Paid price is `totalCost / liters`, not the editable per-litre suggestion.
- The displayed difference is `officialPrice * actualLiters - actualTotal`.
- Both a one-agora/litre gap and a one-shekel total gap are required.
- The official figure must belong to the transaction month and be supported
  by nonmanual history. A later intramonth replacement cannot fill an unknown
  earlier price interval.
- The fill-up's fuel snapshot wins over the vehicle default. Unsupported fuels,
  unknown amounts, invalid records, future/old fills, incomplete history and
  unverified locations silently produce no card.
- Known station coordinates in a conservative mainland area are required;
  Eilat and the far south are excluded. This is an evidence guard, not a legal
  definition of a tax boundary. Manual/imported station names without
  coordinates are not assumed to be mainland stations.
- The text names the self-service benchmark outside Eilat. It does not claim
  that the user selected self-service or found the cheapest station.
- The action opens that receipt with the existing owner and vehicle guards.

For example, 30 litres costing ILS 226.50 against a ceiling of ILS 7.85/litre
produce a difference of ILS 9, using the actual paid unit price of ILS 7.55.
Whole-shekel display rounding never feeds back into the calculation.

## Sustained consumption change

`src/lib/home/sustainedConsumption.ts` compares the last three closed measured
segments with the preceding three, using `sum(km) / sum(litres)` in each window.
The card appears only when the recent window uses at least 15% more fuel per
kilometre and each of its three segments is worse than the baseline.

The six segments must be contiguous within the latest uninterrupted recording
period, with user-confirmed full-tank boundaries and no flagged or malformed
contributors. Each segment needs at least 100 km and 10 litres. The latest
closing measurement must be within 30 days, and the full window within 180
days. Valid partial fills remain included in the measured segments.

The card names both three-segment averages. Its action opens the last measured
segment using the existing detail view. It suggests reviewing driving
conditions; it does not diagnose a mechanical fault.

## Grouped upcoming reminders

`src/lib/home/groupedReminders.ts` combines at least two nonurgent, known
document or maintenance deadlines within 30 calendar days. Maintenance dates
come from the existing recurrence engine, not the original plan date.

- Overdue dates and deadlines less than seven days away remain independent
  sticky cards, before mileage reminders and ordinary insights.
- A date and mileage target are independent triggers. A near mileage target
  cannot conceal an overdue calendar date on the same plan.
- Grouped members do not also appear as individual cards. The group opens the
  existing vehicle page with its document and maintenance sections.
- A group dismissal also records its member occurrence IDs. An individually
  dismissed member cannot reappear through grouping. New deadlines and urgent
  periods can surface again according to the existing occurrence model.
- Past insurance/test costs are never represented as upcoming renewal charges.
  Missing deadlines stay silent.

Write failures retain first priority. Dismissals remain scoped to account and
vehicle, synchronized across tabs, and the home carousel retains its four-card
limit. Regression coverage is in the three helper test files and
`e2e/home-cost-insights.spec.ts`.
