import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarIcon, ChevronEnd, ChevronStart, ClockIcon } from "./icons";
import { Num } from "./Num";
import { heMonthName, parseTypedTime } from "../lib/format";
// The same date parser the importer uses. One implementation, so what the user
// can type into this field and what a CSV may contain never drift apart.
import { parseDate } from "../lib/import/normalize";

/**
 * Hebrew date + time picker — hybrid, with three ways in.
 *
 * The calendar grid replaces `<input type="datetime-local">`, which renders
 * inconsistently on mobile Safari (often collapsing to a half-height row) and
 * offers no control over RTL or Hebrew month names. That layout is preserved.
 *
 * What it adds, because month-by-month paging is unusable for a record from
 * two years ago:
 *
 *   1. Type the date directly — DD/MM/YYYY or YYYY-MM-DD.
 *   2. Jump straight to any month and year from two selects.
 *   3. Open the operating system's own picker.
 *
 * And for time: type HH:MM at one-minute precision, or open the OS time
 * picker. Those two are the whole time story — the hour/minute steppers that
 * used to sit under the calendar duplicated both, at the cost of a taller
 * sheet, and could not express 18:47 in fewer than nine taps.
 *
 * A typed value that does not parse leaves what the user typed alone and shows
 * why, rather than snapping the field back and losing their work.
 */

const WEEKDAYS = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];

/** Years offered in the jump control: a sensible span around today. */
const YEAR_SPAN_BACK = 25;

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

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
  const selected = useMemo(() => new Date(value), [value]);
  const [viewMonth, setViewMonth] = useState(
    () => new Date(selected.getFullYear(), selected.getMonth(), 1),
  );

  // Follow the selection when it moves to another month (e.g. via "היום" or a
  // typed date). Keyed on the month itself so browsing months with the jump
  // controls is not undone on every re-render.
  const selectedMonthKey = `${selected.getFullYear()}-${selected.getMonth()}`;
  useEffect(() => {
    const [year, month] = selectedMonthKey.split("-").map(Number);
    setViewMonth(new Date(year, month, 1));
  }, [selectedMonthKey]);

  const days = useMemo(() => {
    const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
    const daysInMonth = new Date(
      viewMonth.getFullYear(),
      viewMonth.getMonth() + 1,
      0,
    ).getDate();

    const cells: (Date | null)[] = [];
    // Sunday-first, matching the Israeli week.
    for (let i = 0; i < first.getDay(); i += 1) cells.push(null);
    for (let day = 1; day <= daysInMonth; day += 1) {
      cells.push(new Date(viewMonth.getFullYear(), viewMonth.getMonth(), day));
    }
    return cells;
  }, [viewMonth]);

  const min = minDate ? startOfDay(new Date(minDate)) : null;
  const max = maxDate ? startOfDay(new Date(maxDate)) : null;

  const isDisabled = (day: Date) => {
    const start = startOfDay(day);
    if (min && start < min) return true;
    if (max && start > max) return true;
    return false;
  };

  const pickDay = (day: Date) => {
    const next = new Date(day);
    next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
    // Picking "today" must not produce a future time when today is capped.
    if (maxDate && next.getTime() > maxDate) onChange(maxDate);
    else onChange(next.getTime());
  };

  const canGoPrev = !min || viewMonth > new Date(min.getFullYear(), min.getMonth(), 1);
  const canGoNext = !max || viewMonth < new Date(max.getFullYear(), max.getMonth(), 1);

  /* ---------- typed entry ---------- */

  const [typedDate, setTypedDate] = useState("");
  const [dateError, setDateError] = useState<string | null>(null);
  const [typedTime, setTypedTime] = useState("");
  const [timeError, setTimeError] = useState<string | null>(null);

  const nativeDateRef = useRef<HTMLInputElement>(null);
  const nativeTimeRef = useRef<HTMLInputElement>(null);

  const pad = (n: number) => String(n).padStart(2, "0");
  const isoDate = `${selected.getFullYear()}-${pad(selected.getMonth() + 1)}-${pad(selected.getDate())}`;
  const isoTime = `${pad(selected.getHours())}:${pad(selected.getMinutes())}`;

  // The field mirrors the selection until the user starts typing in it.
  const dateFieldValue = typedDate || isoDate;
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
      setDateError("תאריך לא תקין — נסו 24/03/2026 או 2026-03-24");
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
      setTimeError("שעה לא תקינה — נסו 18:47");
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

  /* ---------- month / year jump ---------- */

  const currentYear = new Date().getFullYear();
  const maxYear = max ? max.getFullYear() : currentYear;
  const minYear = min ? min.getFullYear() : maxYear - YEAR_SPAN_BACK;
  const years = Array.from({ length: maxYear - minYear + 1 }, (_, i) => maxYear - i);

  function jumpTo(year: number, month: number) {
    setViewMonth(new Date(year, month, 1));
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Fast paths. Typing beats paging through months for an old record, and
          the OS picker is what many people reach for by reflex. */}
      <div className="flex flex-col gap-2">
        <div className="flex items-stretch gap-2">
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-[12px] font-semibold text-muted">תאריך</span>
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
              className={`num min-h-[44px] rounded-[11px] border bg-surface px-3 text-center text-[15px] font-semibold text-ink outline-none transition-[border-color] duration-200 focus:border-accent ${
                dateError ? "border-danger" : "border-line"
              }`}
            />
          </label>

          <label className="flex w-[104px] flex-col gap-1">
            <span className="text-[12px] font-semibold text-muted">שעה</span>
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
              className={`num min-h-[44px] rounded-[11px] border bg-surface px-2 text-center text-[15px] font-semibold text-ink outline-none transition-[border-color] duration-200 focus:border-accent ${
                timeError ? "border-danger" : "border-line"
              }`}
            />
          </label>
        </div>

        {dateError || timeError ? (
          <span className="text-[12.5px] text-danger-ink">{dateError ?? timeError}</span>
        ) : null}

        {/* The OS pickers. The inputs stay in the layout at zero size so
            showPicker() has a real element to open against, and so a browser
            that ignores showPicker still opens on click. */}
        <div className="flex gap-2">
          <NativeTrigger
            icon={<CalendarIcon size={15} />}
            label="לוח שנה של המכשיר"
            inputRef={nativeDateRef}
          >
            <input
              ref={nativeDateRef}
              type="date"
              aria-label="בחירת תאריך מהמכשיר"
              value={isoDate}
              min={min ? toIso(min) : undefined}
              max={max ? toIso(max) : undefined}
              onChange={(event) => commitTypedDate(event.target.value)}
              className="absolute inset-0 size-full cursor-pointer opacity-0"
            />
          </NativeTrigger>

          <NativeTrigger
            icon={<ClockIcon size={15} />}
            label="שעון של המכשיר"
            inputRef={nativeTimeRef}
          >
            <input
              ref={nativeTimeRef}
              type="time"
              step={60}
              aria-label="בחירת שעה מהמכשיר"
              value={isoTime}
              onChange={(event) => commitTypedTime(event.target.value)}
              className="absolute inset-0 size-full cursor-pointer opacity-0"
            />
          </NativeTrigger>
        </div>
      </div>

      {/* Jump straight to a month and year, instead of paging one at a time. */}
      <div className="flex gap-2">
        <select
          aria-label="חודש"
          value={viewMonth.getMonth()}
          onChange={(event) => jumpTo(viewMonth.getFullYear(), Number(event.target.value))}
          className="min-h-[40px] flex-1 rounded-[11px] border border-line bg-surface px-2 text-[14px] font-semibold text-ink outline-none focus:border-accent"
        >
          {Array.from({ length: 12 }, (_, month) => (
            <option key={month} value={month}>
              {heMonthName(month + 1)}
            </option>
          ))}
        </select>

        <select
          aria-label="שנה"
          value={viewMonth.getFullYear()}
          onChange={(event) => jumpTo(Number(event.target.value), viewMonth.getMonth())}
          className="num min-h-[40px] w-[104px] rounded-[11px] border border-line bg-surface px-2 text-[14px] font-semibold text-ink outline-none focus:border-accent"
        >
          {years.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
      </div>

      {/* Month navigation. In RTL the "previous" chevron points right. */}
      {/* <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="חודש קודם"
          disabled={!canGoPrev}
          onClick={() =>
            setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))
          }
          className="flex size-10 items-center justify-center rounded-full text-muted transition-[background-color,scale] duration-200 active:scale-[0.94] active:bg-surface-2 disabled:pointer-events-none disabled:opacity-30"
        >
          <ChevronEnd size={18} />
        </button>

        <span className="text-[15px] font-bold text-ink">
          {heMonthName(viewMonth.getMonth() + 1)} <Num>{viewMonth.getFullYear()}</Num>
        </span>

        <button
          type="button"
          aria-label="חודש הבא"
          disabled={!canGoNext}
          onClick={() =>
            setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))
          }
          className="flex size-10 items-center justify-center rounded-full text-muted transition-[background-color,scale] duration-200 active:scale-[0.94] active:bg-surface-2 disabled:pointer-events-none disabled:opacity-30"
        >
          <ChevronStart size={18} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((day) => (
          <span
            key={day}
            className="pb-1 text-center text-[11.5px] font-semibold text-muted"
          >
            {day}
          </span>
        ))}

        {days.map((day, index) => {
          if (!day) return <span key={`pad-${index}`} />;
          const isSelected = sameDay(day, selected);
          const isToday = sameDay(day, new Date());
          const disabled = isDisabled(day);

          return (
            <button
              key={day.toISOString()}
              type="button"
              disabled={disabled}
              onClick={() => pickDay(day)}
              aria-pressed={isSelected}
              className={`num flex h-11 items-center justify-center rounded-[12px] text-[15px] transition-[background-color,color,scale] duration-200 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.92] disabled:pointer-events-none disabled:opacity-25 ${
                isSelected
                  ? "bg-accent font-bold text-accent-contrast"
                  : isToday
                    ? "bg-accent-soft font-bold text-accent"
                    : "font-medium text-ink active:bg-surface-2"
              }`}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div> */}
    </div>
  );
}

function toIso(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * A button that opens the OS picker.
 *
 * `showPicker()` is the reliable route where it exists; the transparent native
 * input layered over the button is the fallback for browsers that do not have
 * it, and it keeps the control keyboard-reachable either way.
 */
function NativeTrigger({
  icon,
  label,
  inputRef,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  children: React.ReactNode;
}) {
  return (
    <span className="relative flex flex-1">
      <button
        type="button"
        tabIndex={-1}
        onClick={() => {
          const input = inputRef.current;
          if (!input) return;
          try {
            input.showPicker();
          } catch {
            input.focus();
          }
        }}
        className="flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-[11px] bg-surface-2 text-[13px] font-semibold text-muted transition-[background-color,scale] duration-150 active:scale-[0.97]"
      >
        {icon}
        {label}
      </button>
      {children}
    </span>
  );
}
