/**
 * Hebrew/RTL-aware formatting.
 *
 * Every numeric string produced here is meant to be rendered inside an
 * element with dir="ltr" (see the <Num> component) so digits, currency signs
 * and separators keep their visual order inside RTL text.
 */

const HE_MONTHS = [
  "ינואר",
  "פברואר",
  "מרץ",
  "אפריל",
  "מאי",
  "יוני",
  "יולי",
  "אוגוסט",
  "ספטמבר",
  "אוקטובר",
  "נובמבר",
  "דצמבר",
];

const HE_MONTHS_SHORT = [
  "ינו׳",
  "פבר׳",
  "מרץ",
  "אפר׳",
  "מאי",
  "יונ׳",
  "יול׳",
  "אוג׳",
  "ספט׳",
  "אוק׳",
  "נוב׳",
  "דצמ׳",
];

const HE_DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

export function heMonthName(month1to12: number): string {
  return HE_MONTHS[month1to12 - 1] ?? "";
}

export function heMonthShort(month1to12: number): string {
  return HE_MONTHS_SHORT[month1to12 - 1] ?? "";
}

export function heDayName(date: Date): string {
  return HE_DAYS[date.getDay()] ?? "";
}

/** 1234.5 → "1,234.5" */
export function num(value: number, digits = 1): string {
  return value.toLocaleString("he-IL", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** 41687 → "41,687" */
export function int(value: number): string {
  return Math.round(value).toLocaleString("he-IL");
}

/** 279.24 → "₪279.24"; whole amounts drop the decimals. */
export function shekel(value: number, digits?: number): string {
  const d = digits ?? (Math.abs(value % 1) < 0.005 ? 0 : 2);
  return `₪${Math.abs(value).toLocaleString("he-IL", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  })}`;
}

/** Signed shekel delta, e.g. "\u2212₪0.05" / "+₪1.20". */
export function shekelSigned(value: number, digits = 2): string {
  const sign = value < 0 ? "\u2212" : value > 0 ? "+" : "";
  return `${sign}${shekel(value, digits)}`;
}

/** 7.31 → "₪7.31" (prices always keep 2 decimals). */
export function price(value: number): string {
  return `₪${value.toLocaleString("he-IL", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * 5.2 → "+5%".
 *
 * The sign LEADS. The previous implementation put it last ("35%+") on the
 * theory that RTL mirroring would move it — it does not, because the whole run
 * is rendered inside an LTR island, where "35%+" stays "35%+". The sign, the
 * digits and the percent symbol are one atomic LTR run; render it through
 * <SignedPercent> (or any dir="ltr" island) and it reads correctly.
 */
export function percent(value: number, digits = 0): string {
  const rounded = Math.abs(value).toLocaleString("he-IL", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  const sign = value > 0 ? "+" : value < 0 ? "\u2212" : "";
  return `${sign}${rounded}%`;
}

/** Unsigned percentage, e.g. "72%". */
export function percentPlain(value: number, digits = 0): string {
  return `${value.toLocaleString("he-IL", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

/** "28 באוג׳" */
export function dayMonthShort(date: Date | number): string {
  const d = new Date(date);
  return `${d.getDate()} ב${HE_MONTHS_SHORT[d.getMonth()]}`;
}

/** "28 באוגוסט 2026" */
export function fullDate(date: Date | number): string {
  const d = new Date(date);
  return `${d.getDate()} ב${HE_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "אוגוסט 2026" */
export function monthYear(key: string): string {
  const [year, month] = key.split("-");
  return `${heMonthName(Number(month))} ${year}`;
}

/** "14:32" */
export function time(date: Date | number): string {
  const d = new Date(date);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Relative day label used in the fill-up form header:
 * "היום, 31 באוג׳" / "אתמול, 30 באוג׳" / "12 באוג׳ 2026"
 */
export function relativeDate(date: Date | number, now: Date | number = Date.now()): string {
  const d = new Date(date);
  const today = new Date(now);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(today) - startOf(d)) / 86_400_000);

  if (diffDays === 0) return `היום, ${dayMonthShort(d)}`;
  if (diffDays === 1) return `אתמול, ${dayMonthShort(d)}`;
  if (d.getFullYear() === today.getFullYear()) return dayMonthShort(d);
  return `${dayMonthShort(d)} ${d.getFullYear()}`;
}

/** "לפני 3 ימים" / "היום" / "לפני חודשיים" */
export function timeAgo(date: Date | number, now: Date | number = Date.now()): string {
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(new Date(now)) - startOf(new Date(date))) / 86_400_000);

  if (days <= 0) return "היום";
  if (days === 1) return "אתמול";
  if (days < 30) return `לפני ${days} ימים`;

  const months = Math.round(days / 30.44);
  if (months === 1) return "לפני חודש";
  if (months === 2) return "לפני חודשיים";
  if (months < 12) return `לפני ${months} חודשים`;

  const years = Math.round(months / 12);
  return years === 1 ? "לפני שנה" : `לפני ${years} שנים`;
}

/**
 * A past login, as a day reference plus a clock time.
 *
 * "היום, 16:42" · "אתמול, 23:18" · "30 באוג׳, 09:11" · "12 בינו׳ 2025, 08:00"
 *
 * Never "עכשיו": this describes the login BEFORE the current session, so a
 * relative phrase that could read as the current one is wrong by construction.
 * Rendered in the device's timezone from a UTC timestamp.
 */
export function loginMoment(date: Date | number, now: Date | number = Date.now()): string {
  const d = new Date(date);
  const today = new Date(now);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  const clock = time(d);

  if (diffDays === 0) return `היום, ${clock}`;
  if (diffDays === 1) return `אתמול, ${clock}`;
  if (d.getFullYear() === today.getFullYear()) return `${dayMonthShort(d)}, ${clock}`;
  return `${dayMonthShort(d)} ${d.getFullYear()}, ${clock}`;
}

/** Consumption formatted in the user's chosen unit. */
export function consumption(
  kmPerLiter: number | null,
  units: "kmPerLiter" | "litersPer100",
): { value: string; unit: string } {
  if (kmPerLiter === null || !Number.isFinite(kmPerLiter)) {
    return { value: "—", unit: units === "kmPerLiter" ? "קמ״ל" : "ל׳/100 ק״מ" };
  }
  if (units === "litersPer100") {
    return { value: num(100 / kmPerLiter, 1), unit: "ל׳/100 ק״מ" };
  }
  return { value: num(kmPerLiter, 1), unit: "קמ״ל" };
}

export const FUEL_TYPE_LABELS: Record<string, string> = {
  "95": "בנזין 95 אוקטן",
  "98": "בנזין 98 אוקטן",
  diesel: "סולר",
  other: "אחר",
};

export const FUEL_TYPE_SHORT: Record<string, string> = {
  "95": "בנזין 95",
  "98": "בנזין 98",
  diesel: "סולר",
  other: "אחר",
};

/** "מאזדה 3 · 2018", preferring the nickname when the user set one. */
export function vehicleLabel(
  vehicle: { make: string; model: string; year?: number | null; nickname?: string | null } | null,
): string {
  if (!vehicle) return "";
  if (vehicle.nickname?.trim()) return vehicle.nickname.trim();
  const base = `${vehicle.make} ${vehicle.model}`.trim();
  return vehicle.year ? `${base} · ${vehicle.year}` : base;
}

export function vehicleShort(
  vehicle: { make: string; model: string; nickname?: string | null } | null,
): string {
  if (!vehicle) return "";
  if (vehicle.nickname?.trim()) return vehicle.nickname.trim();
  return `${vehicle.make} ${vehicle.model}`.trim();
}

/** Israeli plate: 8 digits → "312-45-678", 7 digits → "87-421-53". */
export function formatPlate(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 8) return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
  if (digits.length === 7) return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
  return digits;
}

/** First letter of a display name, for the avatar fallback. */
export function initials(name?: string | null): string {
  const trimmed = name?.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 1);
  return `${parts[0].slice(0, 1)}${parts[1].slice(0, 1)}`;
}

/** Parse a decimal the user typed, tolerating a comma as the separator. */
export function parseDecimal(value: string): number {
  const normalized = value.replace(/,/g, ".").replace(/[^\d.-]/g, "");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/** Value for an <input type="datetime-local">, in local time. */
export function toDateTimeLocal(date: Date | number): string {
  const d = new Date(date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}


/* ------------------------------------------------------------------ *
 * Hebrew unit words
 *
 * Kept OUT of the LTR island: a Hebrew unit inside a dir="ltr" span is
 * reordered against the surrounding text. The number is the LTR run; the unit
 * is ordinary RTL content beside it.
 * ------------------------------------------------------------------ */

export const UNITS = {
  km: "ק״מ",
  liters: "ל׳",
  litersLong: "ליטר",
  kmPerLiter: "קמ״ל",
  litersPer100: "ל׳/100 ק״מ",
  perLiter: "לליטר",
  perKm: "לק״מ",
  days: "ימים",
} as const;
