import { useEffect, useMemo, useState } from "react";
import { ChevronEnd, ChevronStart } from "./icons";
import { Num } from "./Num";
import { heMonthName } from "../lib/format";

/**
 * Hebrew date + time picker.
 *
 * Replaces `<input type="datetime-local">`, which renders inconsistently on
 * mobile Safari (often collapsing to a half-height row) and offers no control
 * over RTL or Hebrew month names. This is a plain grid, so it looks and
 * behaves identically everywhere.
 */

const WEEKDAYS = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];

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

  // Follow the selection when it jumps to another month (e.g. via "היום").
  useEffect(() => {
    setViewMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
  }, [selected]);

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

  const setTime = (hours: number, minutes: number) => {
    const next = new Date(selected);
    next.setHours(hours, minutes, 0, 0);
    if (maxDate && next.getTime() > maxDate) onChange(maxDate);
    else onChange(next.getTime());
  };

  const canGoPrev = !min || viewMonth > new Date(min.getFullYear(), min.getMonth(), 1);
  const canGoNext = !max || viewMonth < new Date(max.getFullYear(), max.getMonth(), 1);

  return (
    <div className="flex flex-col gap-3">
      {/* Month navigation. In RTL the "previous" chevron points right. */}
      <div className="flex items-center justify-between">
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
      </div>

      <TimeRow
        hours={selected.getHours()}
        minutes={selected.getMinutes()}
        onChange={setTime}
      />
    </div>
  );
}

/** Two steppers rather than a dropdown — faster with a thumb, and no bidi risk. */
function TimeRow({
  hours,
  minutes,
  onChange,
}: {
  hours: number;
  minutes: number;
  onChange: (hours: number, minutes: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[14px] bg-surface-2 px-4 py-3">
      <span className="text-[14px] font-semibold text-ink">שעה</span>

      <div dir="ltr" className="flex items-center gap-1">
        <Stepper
          label="שעות"
          value={hours}
          onChange={(next) => onChange((next + 24) % 24, minutes)}
        />
        <span className="px-0.5 text-[18px] font-bold text-muted">:</span>
        <Stepper
          label="דקות"
          value={minutes}
          step={5}
          max={60}
          onChange={(next) => onChange(hours, (next + 60) % 60)}
        />
      </div>
    </div>
  );
}

function Stepper({
  label,
  value,
  onChange,
  step = 1,
  max = 24,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  max?: number;
}) {
  return (
    <span className="flex flex-col items-center">
      <button
        type="button"
        aria-label={`${label} — הגדלה`}
        onClick={() => onChange(value + step >= max ? 0 : value + step)}
        className="flex h-8 w-12 items-center justify-center rounded-t-[10px] text-muted transition-[background-color,scale] duration-150 active:scale-[0.92] active:bg-surface"
      >
        <Caret up />
      </button>
      <span className="num w-12 text-center text-[20px] font-bold text-ink">
        {String(value).padStart(2, "0")}
      </span>
      <button
        type="button"
        aria-label={`${label} — הקטנה`}
        onClick={() => onChange(value - step < 0 ? max - step : value - step)}
        className="flex h-8 w-12 items-center justify-center rounded-b-[10px] text-muted transition-[background-color,scale] duration-150 active:scale-[0.92] active:bg-surface"
      >
        <Caret />
      </button>
    </span>
  );
}

function Caret({ up = false }: { up?: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={up ? "" : "rotate-180"}
    >
      <path
        d="M6 15l6-6 6 6"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
