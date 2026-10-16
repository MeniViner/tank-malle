import { useRef } from "react";
import { CheckIcon } from "./icons";

/** The export's sheet choices: one group, with keyboard radio navigation. */
export function ChoiceList<T extends string>({ value, options, onChange, ariaLabel }: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return <div className="tm-choice-list" role="radiogroup" aria-label={ariaLabel}>
    {options.map((option, index) => <button key={option.value} type="button"
      ref={node => { refs.current[index] = node; }}
      role="radio" aria-checked={option.value === value} tabIndex={option.value === value ? 0 : -1}
      onClick={() => onChange(option.value)}
      onKeyDown={event => {
        const next = event.key === "ArrowDown" || event.key === "ArrowLeft" ? (index + 1) % options.length
          : event.key === "ArrowUp" || event.key === "ArrowRight" ? (index + options.length - 1) % options.length
          : event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : null;
        if (next === null) return;
        event.preventDefault(); onChange(options[next].value); refs.current[next]?.focus();
      }}
      className={`flex min-h-[54px] w-full items-center justify-between gap-3 px-4 text-start text-[15.5px] font-semibold active:bg-surface-2 ${option.value === value ? "text-accent" : "text-ink"}`}>
      {option.label}{option.value === value ? <CheckIcon size={18} /> : null}
    </button>)}
  </div>;
}
