import type { odometerBounds } from "../../lib/stats";
import { num } from "../../lib/format";
import { Sheet } from "../Sheet";
import { DateTimePicker } from "../DateTimePicker";
import { InfoStrip } from "../Field";
import { Num } from "../Num";

export function DateSheet({
  open,
  onClose,
  value,
  maxDate,
  bounds,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  value: number;
  maxDate: number;
  bounds: ReturnType<typeof odometerBounds>;
  onChange: (value: number) => void;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="תאריך ושעה"
    >
      <div className="flex flex-col gap-3">
        <DateTimePicker value={value} onChange={onChange} maxDate={maxDate} />

        {bounds.min !== null || bounds.max !== null ? (
          <InfoStrip>
            טווח קילומטראז׳ מותר לתאריך זה:{" "}
            <Num>
              {bounds.min !== null ? num(bounds.min, 0) : "—"} –{" "}
              {bounds.max !== null ? num(bounds.max, 0) : "∞"}
            </Num>
          </InfoStrip>
        ) : null}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onChange(Date.now())}
            className="min-h-[46px] flex-1 rounded-pill bg-surface-2 text-[14px] font-semibold text-ink transition-[background-color,scale] duration-200 active:scale-[0.97]"
          >
            עכשיו
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[46px] flex-1 rounded-pill bg-accent text-[14px] font-bold text-accent-contrast transition-[filter,scale] duration-200 active:scale-[0.97] active:brightness-[0.97]"
          >
            אישור
          </button>
        </div>
      </div>
    </Sheet>
  );
}
