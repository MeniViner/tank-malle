/**
 * Energy wording for read-only screens (Stage 7 D2).
 *
 * Production has no charge/kWh record model: an EV's records are stored as
 * fill-ups with litres and a price per litre. Money totals, counts and
 * distances stay valid, so they keep showing with energy-neutral or electric
 * labels. Per-litre consumption and per-litre price are not meaningful for an
 * EV, so screens show "—" with `EV_MEASUREMENT_PENDING` instead of a litre unit.
 * A fuel car always gets the original fuel wording, unchanged.
 */
export interface EnergyCopy {
  /** Cost-category / chart-series name: "דלק" or "חשמל". */
  energy: string;
  /** Plural record noun: "תדלוקים" or "טעינות". */
  fills: string;
  /** Purchases of the energy: "רכישות דלק" or "טעינות". */
  purchases: string;
  /** "ב" + plural record noun ("בתדלוקים" / "בטעינות"). */
  inFills: string;
}

export const FUEL_COPY: EnergyCopy = { energy: "דלק", fills: "תדלוקים", purchases: "רכישות דלק", inFills: "בתדלוקים" };
export const EV_COPY: EnergyCopy = { energy: "חשמל", fills: "טעינות", purchases: "טעינות", inFills: "בטעינות" };

export const energyCopy = (ev: boolean): EnergyCopy => ev ? EV_COPY : FUEL_COPY;

/** One-line note shown instead of a per-litre figure on an EV. */
export const EV_MEASUREMENT_PENDING = "מעקב צריכת חשמל יגיע בהמשך";

/** The same note for the per-litre price on an EV. */
export const EV_PRICE_PENDING = "מעקב מחיר החשמל לקוט״ש יגיע בהמשך";
