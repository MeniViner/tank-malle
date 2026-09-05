import { useRef, useState } from "react";
import { CalendarIcon, ClockIcon } from "./icons";
import { parseTypedTime } from "../lib/format";
// The same date parser the importer uses. One implementation, so what the user
// can type into this field and what a CSV may contain never drift apart.
import { parseDate } from "../lib/import/normalize";

/**
 * Date + time entry. Two fields, nothing else.
 *
 * Both default to now, which is what almost every fill-up is, so the common
 * case needs no interaction at all. Beyond that there are exactly two ways in,
 * and they cover everything the month grid used to:
 *
 *   1. type it — 05/09/26, 05/09/2026 or 2026-09-05, and 18:57 for the time;
 *   2. the icon opens the device's own picker, which is what most people
 *      reach for by reflex and what handles "some Tuesday in March".
 *
 * The calendar grid it replaces cost a third of the sheet to page through one
 * month at a time, and a record from two years back took twenty-four taps.
 *
 * A typed value that does not parse leaves what the user typed alone and says
 * why, rather than snapping the field back and losing their work.
 */

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

const pad = (n: number) => String(n).padStart(2, "0");

export function DateTimePicker({
  value,
  onChange,
  maxDate,
  minDate,
}: {
  value: number;
  onChange: (value: number) => void;
  maxDate?: number;
  minDate?: number;
}) {
  const selected = new Date(value);

  const [typedDate, setTypedDate] = useState("");
  const [dateError, setDateError] = useState<string | null>(null);
  const [typedTime, setTypedTime] = useState("");
  const [timeError, setTimeError] = useState<string | null>(null);

  const nativeDateRef = useRef<HTMLInputElement>(null);
  const nativeTimeRef = useRef<HTMLInputElement>(null);

  const isoDate = `${selected.getFullYear()}-${pad(selected.getMonth() + 1)}-${pad(selected.getDate())}`;
  const isoTime = `${pad(selected.getHours())}:${pad(selected.getMinutes())}`;
  // Shown the way it is written here, not the way a machine stores it.
  const shownDate = `${pad(selected.getDate())}/${pad(selected.getMonth() + 1)}/${selected.getFullYear()}`;

  // The field mirrors the selection until the user starts typing in it.
  const dateFieldValue = typedDate || shownDate;
  const timeFieldValue = typedTime || isoTime;

  function commitTypedDate(raw: string) {
    const text = raw.trim();
    if (text === "") {
      setTypedDate("");
      setDateError(null);
      return;
    }

    const parsed = parseDate(text);
    if (!parsed) {
      // Keep what they typed; tell them what shapes work.
      setDateError("תאריך לא תקין — נסו 05/09/2026");
      return;
    }

    const next = new Date(parsed);
    next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);

    if (minDate && next.getTime() < minDate) {
      setDateError("התאריך מוקדם מהמותר");
      return;
    }
    if (maxDate && startOfDay(next) > startOfDay(new Date(maxDate))) {
      setDateError("לא ניתן להזין תאריך עתידי");
      return;
    }

    setDateError(null);
    setTypedDate("");
    // A future time on today's date is clamped, not rejected.
    onChange(maxDate && next.getTime() > maxDate ? maxDate : next.getTime());
  }

  function commitTypedTime(raw: string) {
    const text = raw.trim();
    if (text === "") {
      setTypedTime("");
      setTimeError(null);
      return;
    }

    const parsed = parseTypedTime(text);
    if (!parsed) {
      setTimeError("שעה לא תקינה — נסו 18:57");
      return;
    }

    const next = new Date(selected);
    next.setHours(parsed.hours, parsed.minutes, 0, 0);
    if (maxDate && next.getTime() > maxDate) {
      setTimeError("לא ניתן להזין שעה עתידית");
      return;
    }

    setTimeError(null);
    setTypedTime("");
    onChange(next.getTime());
  }

  return (
    <div className="flex flex-col gap-2">
      <EntryRow
        label="תאריך"
        icon={<CalendarIcon size={17} />}
        pickerLabel="פתיחת לוח השנה"
        inputRef={nativeDateRef}
        native={
          <input
            ref={nativeDateRef}
            type="date"
            aria-label="בחירת תאריך מהמכשיר"
            value={isoDate}
            min={minDate ? toIso(new Date(minDate)) : undefined}
            max={maxDate ? toIso(new Date(maxDate)) : undefined}
            onChange={(event) => commitTypedDate(event.target.value)}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        }
      >
        <input
          dir="ltr"
          inputMode="numeric"
          autoComplete="off"
          placeholder="DD/MM/YYYY"
          aria-label="תאריך — הקלדה ידנית"
          aria-invalid={dateError !== null}
          value={dateFieldValue}
          onChange={(event) => {
            setTypedDate(event.target.value);
            setDateError(null);
          }}
          onBlur={(event) => commitTypedDate(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitTypedDate((event.target as HTMLInputElement).value);
            }
          }}
          className="num w-full bg-transparent text-[16px] font-semibold text-ink outline-none"
        />
      </EntryRow>

      <EntryRow
        label="שעה"
        icon={<ClockIcon size={17} />}
        pickerLabel="פתיחת בורר השעה"
        inputRef={nativeTimeRef}
        native={
          <input
            ref={nativeTimeRef}
            type="time"
            step={60}
            aria-label="בחירת שעה מהמכשיר"
            value={isoTime}
            onChange={(event) => commitTypedTime(event.target.value)}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        }
      >
        <input
          dir="ltr"
          inputMode="numeric"
          autoComplete="off"
          placeholder="HH:MM"
          aria-label="שעה — הקלדה ידנית"
          aria-invalid={timeError !== null}
          value={timeFieldValue}
          onChange={(event) => {
            setTypedTime(event.target.value);
            setTimeError(null);
          }}
          onBlur={(event) => commitTypedTime(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitTypedTime((event.target as HTMLInputElement).value);
            }
          }}
          className="num w-full bg-transparent text-[16px] font-semibold text-ink outline-none"
        />
      </EntryRow>

      {dateError || timeError ? (
        <span className="text-[12.5px] text-danger-ink">{dateError ?? timeError}</span>
      ) : null}
    </div>
  );
}

/**
 * One row: a label, the typed value, and the button onto the OS picker.
 *
 * `showPicker()` is the reliable route where it exists; the transparent native
 * input layered over the button is the fallback for browsers without it, and
 * it keeps the control keyboard-reachable either way.
 */
function EntryRow({
  label,
  icon,
  pickerLabel,
  inputRef,
  native,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  pickerLabel: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  native: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[56px] items-center gap-3 rounded-[14px] border border-line bg-surface px-3.5 transition-[border-color,box-shadow] duration-200 focus-within:border-accent focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_14%,transparent)]">
      <span className="w-[46px] flex-none text-[13px] font-semibold text-muted">
        {label}
      </span>

      <span className="min-w-0 flex-1">{children}</span>

      <span className="relative flex-none">
        <button
          type="button"
          aria-label={pickerLabel}
          onClick={() => {
            const element = inputRef.current;
            if (!element) return;
            const withPicker = element as HTMLInputElement & { showPicker?: () => void };
            if (typeof withPicker.showPicker === "function") withPicker.showPicker();
            else element.click();
          }}
          className="flex size-9 items-center justify-center rounded-tile bg-accent-soft text-accent transition-[background-color,scale] duration-200 active:scale-[0.94]"
        >
          {icon}
        </button>
        {native}
      </span>
    </div>
  );
}

function toIso(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
