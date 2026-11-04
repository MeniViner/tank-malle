import { useId, useState } from 'react';
import { Sheet } from './Sheet';
import { CalendarIcon, CheckIcon, ChevronDown } from './icons';
import { NumericText } from './Fmt';

/** One quiet trigger, with full-width choices like the supplied design. */
export function PeriodPicker<T extends string>({ value, options, onChange, label = 'טווח תאריכים', ariaLabel, compact = false }: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  label?: string;
  ariaLabel?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selectionId = useId();
  const selectionLabel = options.find(option => option.value === value)?.label ?? "";
  return <>
    <button type="button" className={"period-trigger" + (compact ? " period-trigger-compact" : "")} aria-label={ariaLabel ?? (compact ? label : undefined)}
      aria-describedby={compact && selectionLabel ? selectionId : undefined}
      aria-haspopup="dialog" aria-expanded={open} onClick={event => { event.currentTarget.focus(); setOpen(true); }}>
      <CalendarIcon size={16}/><span id={selectionId} className={compact ? "sr-only" : undefined}><NumericText>{selectionLabel}</NumericText></span>{compact ? null : <ChevronDown size={14}/>}
    </button>
    <Sheet open={open} onClose={() => setOpen(false)} title={label}>
      <div className="period-choices" aria-label={label}>
        {options.map(option => <button key={option.value} type="button"
          aria-pressed={option.value === value} onClick={() => { if (option.value !== value) onChange(option.value); setOpen(false); }}>
          <span><NumericText>{option.label}</NumericText></span>{option.value === value ? <CheckIcon size={18}/> : <span className="period-choice-dot" aria-hidden="true"/>}
        </button>)}
      </div>
    </Sheet>
  </>;
}
