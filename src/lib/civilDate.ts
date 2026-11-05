import { validDay } from "./maintenance/model";

/** Typed calendar dates are civil days, never instants or spreadsheet serials. */
export function parseCivilDay(draftText: string): string | null {
  const trimmed = draftText.trim();
  const text = /^\d{8}$/.test(trimmed)
    ? `${trimmed.slice(0, 2)}/${trimmed.slice(2, 4)}/${trimmed.slice(4)}` : trimmed;
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

/**
 * Mask a manual civil-date edit without discarding invalid drafts. Full compact
 * pastes and digits appended to a date get separators; edits inside an existing
 * segment keep the other segments in place, including incomplete ones.
 */
export function editCivilDateDraft(previous: string, raw: string, start: number, end = start, inputType = "") {
  const unchanged = { text: raw, start, end };
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? parseCivilDay(raw) : null;
  if (iso) {
    const text = formatCivilDay(iso);
    return { text, start: text.length, end: text.length };
  }

  // Backspace/delete at a separator should edit the adjacent digit, not make
  // the mask reinsert the same separator and trap the caret there.
  if (start === end && previous.length === raw.length + 1 && previous[start] === "/"
    && raw === previous.slice(0, start) + previous.slice(start + 1)) {
    if (inputType === "deleteContentBackward" && /\d/.test(previous[start - 1] ?? "")) {
      return { text: previous.slice(0, start - 1) + previous.slice(start), start: start - 1, end: start - 1 };
    }
    if (inputType === "deleteContentForward" && /\d/.test(previous[start + 1] ?? "")) {
      return { text: previous.slice(0, start + 1) + previous.slice(start + 2), start: start + 1, end: start + 1 };
    }
  }

  const compact = /^\d{0,8}$/.test(raw);
  const appendingDigits = raw.startsWith(previous) && /^\d+$/.test(raw.slice(previous.length))
    && /^(?:\d{0,2}|\d{2}\/\d{0,2}|\d{2}\/\d{2}\/\d{0,4})$/.test(previous);
  if (!compact && !appendingDigits) return unchanged;
  const digits = raw.replace(/\//g, "");
  if (!/^\d{0,8}$/.test(digits)) return unchanged;
  const text = digits.slice(0, 2) + (digits.length > 2 ? `/${digits.slice(2, 4)}` : "")
    + (digits.length > 4 ? `/${digits.slice(4)}` : "");
  const caret = (position: number) => {
    const count = raw.slice(0, position).replace(/\//g, "").length;
    return count + (count > 2 ? 1 : 0) + (count > 4 ? 1 : 0);
  };
  return { text, start: caret(start), end: caret(end) };
}

/** Interpret an accepted civil day in local time, preserving the chosen clock. */
export function civilDayAtTime(day: string, clock: Date): Date | null {
  const parsed = parseCivilDay(day);
  if (!parsed) return null;
  const [year, month, date] = parsed.split("-").map(Number);
  return new Date(year, month - 1, date, clock.getHours(), clock.getMinutes(), 0, 0);
}
