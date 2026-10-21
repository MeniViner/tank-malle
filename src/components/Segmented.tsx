import { useId } from "react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
}

/**
 * Pill-track segmented control (theme, units, stats range).
 * Renders as a radiogroup so it is operable from the keyboard and announced
 * correctly by screen readers.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "md",
  ariaLabel,
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  size?: "sm" | "md";
  ariaLabel?: string;
}) {
  const groupId = useId();

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`flex w-full gap-1 rounded-pill bg-surface-2 ${size === "sm" ? "p-[3px]" : "p-1"}`}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected || (!options.some((entry) => entry.value === value) && index === 0) ? 0 : -1}
            onKeyDown={(event) => {
              const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
              const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1
                : event.key === "ArrowLeft" ? (rtl ? 1 : -1) : event.key === "ArrowRight" ? (rtl ? -1 : 1) : 0;
              const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
                : step ? (index + step + options.length) % options.length : null;
              if (next === null) return;
              event.preventDefault();
              onChange(options[next].value);
              document.getElementById(`${groupId}-${options[next].value}`)?.focus();
            }}
            id={`${groupId}-${option.value}`}
            onClick={() => onChange(option.value)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-pill font-semibold transition-[background-color,color,box-shadow,scale] duration-200 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.96] ${
              size === "sm" ? "min-h-[40px] text-[13px]" : "min-h-[42px] text-[14px]"
            } ${
              selected
                ? "bg-surface text-ink"
                : "text-muted"
            }`}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className="tm-switch"
    >
      <span className="tm-switch-track" aria-hidden="true"><span className="tm-switch-thumb"/></span>
    </button>
  );
}
