import { useState } from 'react';
import { Sheet } from './Sheet';
import { CalendarIcon, CheckIcon, ChevronDown } from './icons';

/** One quiet trigger, with full-width choices like the supplied design. */
export function PeriodPicker<T extends string>({ value, options, onChange, label = 'טווח תאריכים', ariaLabel }: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  label?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="period-trigger" aria-label={ariaLabel}
      aria-haspopup="dialog" aria-expanded={open} onClick={event => { event.currentTarget.focus(); setOpen(true); }}>
      <CalendarIcon size={16}/><span>{options.find(option => option.value === value)?.label}</span><ChevronDown size={14}/>
    </button>
    <Sheet open={open} onClose={() => setOpen(false)} title={<h2 className="text-lg font-semibold">{label}</h2>}>
      <div className="period-choices" aria-label={label}>
        {options.map(option => <button key={option.value} type="button"
          aria-pressed={option.value === value} onClick={() => { if (option.value !== value) onChange(option.value); setOpen(false); }}>
          <span>{option.label}</span>{option.value === value ? <CheckIcon size={18}/> : <span className="period-choice-dot" aria-hidden="true"/>}
        </button>)}
      </div>
    </Sheet>
  </>;
}
