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
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            id={`${groupId}-${option.value}`}
            onClick={() => onChange(option.value)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-pill font-semibold transition-[background-color,color,box-shadow,scale] duration-200 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.97] ${
              size === "sm" ? "min-h-[36px] text-[13px]" : "min-h-[42px] text-[14px]"
            } ${
              selected
                ? "bg-surface text-ink shadow-[0_1px_1px_rgb(13_35_28/0.04),0_2px_6px_-2px_rgb(13_35_28/0.10)]"
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
      className={`relative h-[31px] w-[51px] flex-none rounded-pill transition-[background-color,scale] duration-200 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.96] ${
        checked ? "bg-accent" : "border border-line bg-surface-2"
      }`}
    >
      <span
        className={`absolute top-1/2 size-[27px] -translate-y-1/2 rounded-full bg-white shadow-[0_1px_1px_rgb(13_35_28/0.10),0_2px_5px_rgb(13_35_28/0.22)] transition-[inset-inline-start] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          checked ? "start-[22px]" : "start-[2px]"
        }`}
      />
    </button>
  );
}
