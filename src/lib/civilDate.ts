import { validDay } from "./maintenance/model";

/** Typed calendar dates are civil days, never instants or spreadsheet serials. */
export function parseCivilDay(draftText: string): string | null {
  const text = draftText.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const dayFirst = iso ? null : /^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/.exec(text);
  if (!iso && !dayFirst) return null;
  const day = Number(iso ? iso[3] : dayFirst![1]);
  const month = Number(iso ? iso[2] : dayFirst![2]);
  let year = Number(iso ? iso[1] : dayFirst![3]);
  if (dayFirst?.[3].length === 2) year += year >= 70 ? 1900 : 2000;
  const value = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return validDay(value) ? value : null;
}

/** Formatting never parses through Date, so the selected day cannot shift zones. */
export function formatCivilDay(value: string | null | undefined): string {
  if (!validDay(value)) return "";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}
