import { Card, Label } from "./Card";
import { Num } from "./Num";
import { SignedPercent } from "./Fmt";
import { ArrowUp, CalendarIcon, CarIcon, CheckIcon, PinIcon } from "./icons";

/**
 * Miniature, non-interactive previews of the real screens.
 *
 * These reuse the app's own tokens and components rather than being flat
 * images, so they can never drift out of step with the product — and they
 * follow the user's theme and accent on the sign-in screen too.
 */

export function FillupPreview() {
  return (
    <Preview>
      <div className="flex items-center justify-between">
        <Label className="text-[11px]">תדלוק חדש</Label>
        <span className="rounded-pill bg-surface-2 px-2 py-0.5 text-[9.5px] font-semibold text-muted">
          מאזדה 3
        </span>
      </div>

      <MiniRow
        icon={<CalendarIcon size={13} />}
        label="תאריך ושעה"
        value={
          <>
            היום · <Num>14:32</Num>
          </>
        }
      />
      <MiniRow
        icon={<PinIcon size={13} />}
        label="תחנה"
        value="דור אלון מסמיה"
        badge="זוהה אוטומטית"
      />
      <MiniRow icon={<span className="text-[11px] font-bold">₪</span>} label="מחיר לליטר" value={<Num>₪7.31</Num>} />

      <div className="flex gap-2 pt-0.5">
        <MiniInput label="קילומטראז׳" value="41,687" />
        <MiniInput label="ליטרים" value="38.2" accent />
      </div>

      <div className="rounded-pill bg-accent py-2 text-center text-[11px] font-bold text-accent-contrast">
        שמירת תדלוק
      </div>
    </Preview>
  );
}

export function StatsPreview() {
  // A believable consumption curve — deliberately not a straight line.
  const points = [11.4, 11.9, 11.6, 12.3, 12.0, 12.8, 12.4, 13.1];
  const max = Math.max(...points);
  const min = Math.min(...points);

  return (
    <Preview>
      <div className="flex items-center justify-between">
        <Label className="text-[11px]">צריכה · קמ״ל</Label>
        <span className="flex items-center gap-1 rounded-pill bg-success-soft px-2 py-0.5 text-[9.5px] font-semibold text-success-ink">
          <ArrowUp size={9} />
          {/* The sign leads. This is the first number a new user ever sees. */}
          <SignedPercent value={5} />
        </span>
      </div>

      <div className="flex items-baseline gap-1.5">
        <Num className="text-[26px] font-bold leading-none text-accent">12.4</Num>
        <span className="text-[11px] text-muted">קמ״ל</span>
      </div>

      {/* Inline sparkline: cheap, crisp, and themed by currentColor. */}
      <svg viewBox="0 0 100 34" className="h-[52px] w-full text-accent" aria-hidden="true">
        <polyline
          points={points
            .map((value, index) => {
              const x = (index / (points.length - 1)) * 100;
              const y = 30 - ((value - min) / (max - min || 1)) * 24;
              return `${x},${y}`;
            })
            .join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <line
          x1="0"
          y1="16"
          x2="100"
          y2="16"
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="3 3"
          opacity=".35"
        />
      </svg>

      <div className="flex gap-2">
        <MiniStat label="החודש" value="₪642" />
        <MiniStat label="טווח" value="620 ק״מ" />
      </div>
    </Preview>
  );
}

export function VehiclePreview() {
  return (
    <Preview>
      <Label className="text-[11px]">נמצא במאגר משרד התחבורה</Label>

      {/* Israeli plate, scaled down. */}
      <div className="flex justify-center py-0.5">
        <div
          dir="ltr"
          className="flex h-9 w-[132px] items-stretch overflow-hidden rounded-[6px] border-2 border-[#1B2A24] bg-[#F4CE2A]"
        >
          <span className="flex w-4 flex-none items-end justify-center bg-[#12408F] pb-0.5 text-[6px] font-bold text-white">
            IL
          </span>
          <span className="num flex flex-1 items-center justify-center text-[15px] font-bold text-[#16211C]">
            312-45-678
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-[10px] bg-surface-2 px-2.5 py-2">
        <CarIcon size={14} className="flex-none text-accent" />
        <span className="flex-1 truncate text-[11.5px] font-semibold text-ink">
          מאזדה 3 · <Num>2018</Num>
        </span>
        <CheckIcon size={13} className="flex-none text-success" />
      </div>

      <div className="flex gap-2">
        <MiniInput label="נפח מיכל" value="51 ל׳" />
        <MiniInput label="צריכה מוצהרת" value="16.2" accent />
      </div>

      <span className="text-[9.5px] leading-relaxed text-muted">
        נתוני היצרן נמשכים אוטומטית לפי מספר הרישוי
      </span>
    </Preview>
  );
}

/* ---------------- shared bits ---------------- */

function Preview({ children }: { children: React.ReactNode }) {
  return (
    <Card className="flex w-full max-w-[268px] flex-col gap-2 rounded-[20px] p-3.5 shadow-[0_18px_40px_-20px_rgb(13_35_28/0.35)]">
      {children}
    </Card>
  );
}

function MiniRow({
  icon,
  label,
  value,
  badge,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  badge?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex size-6 flex-none items-center justify-center rounded-[7px] bg-accent-soft text-accent">
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[9px] font-semibold text-muted">{label}</span>
        <span className="truncate text-[11.5px] font-semibold text-ink">{value}</span>
      </span>
      {badge ? (
        <span className="flex-none text-[9px] font-semibold text-accent">{badge}</span>
      ) : null}
    </div>
  );
}

function MiniInput({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <span className="flex flex-1 flex-col gap-0.5 rounded-[10px] border border-line px-2.5 py-1.5">
      <span className="text-[9px] font-semibold text-muted">{label}</span>
      <Num className={`text-[14px] font-bold ${accent ? "text-accent" : "text-ink"}`}>
        {value}
      </Num>
    </span>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex flex-1 flex-col gap-0.5 rounded-[10px] bg-surface-2 px-2.5 py-1.5">
      <span className="text-[9px] font-semibold text-muted">{label}</span>
      <Num className="text-[12.5px] font-bold text-ink">{value}</Num>
    </span>
  );
}
