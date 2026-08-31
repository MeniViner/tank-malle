import { useState } from "react";
import { Button } from "../components/Button";
import { CalendarIcon, ChartIcon, PumpIcon } from "../components/icons";

const SLIDES = [
  {
    Icon: PumpIcon,
    title: "רישום תדלוק ב־15 שניות",
    body: "הכול ממולא מראש — תאריך, מחיר ותחנה. נשאר רק להקליד קילומטראז׳ וליטרים.",
  },
  {
    Icon: ChartIcon,
    title: "חישובי צריכה וגרפים",
    body: "צריכה אמיתית בקמ״ל אחרי כל תדלוק, מגמות לאורך זמן והשוואה לנתוני היצרן.",
  },
  {
    Icon: CalendarIcon,
    title: "מחיר הדלק מתעדכן אוטומטית",
    body: "המחיר הרשמי נטען בתחילת כל חודש, כולל התאמה אישית להנחה בתחנה שלכם.",
  },
];

/** Onboarding carousel (designs 02–04), shown once per device. */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const slide = SLIDES[index];
  const isLast = index === SLIDES.length - 1;
  const { Icon } = slide;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col bg-bg px-6 pb-8 pt-safe">
      <div className="flex justify-start pt-4">
        <button
          type="button"
          onClick={onDone}
          className="min-h-[44px] px-2 text-[14px] font-semibold text-muted"
        >
          דלג
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-7 text-center">
        <span className="flex size-[112px] items-center justify-center rounded-[32px] bg-accent-soft text-accent">
          <Icon size={52} />
        </span>

        <div className="flex flex-col gap-3">
          <h1 className="text-[24px] font-bold leading-tight text-ink">{slide.title}</h1>
          <p className="mx-auto max-w-[300px] text-[15px] leading-relaxed text-muted">
            {slide.body}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-6">
        <div className="flex justify-center gap-2" aria-hidden="true">
          {SLIDES.map((item, i) => (
            <span
              key={item.title}
              className={`h-2 rounded-pill transition-all ${
                i === index ? "w-6 bg-accent" : "w-2 bg-line"
              }`}
            />
          ))}
        </div>

        <Button full onClick={() => (isLast ? onDone() : setIndex(index + 1))}>
          {isLast ? "מתחילים" : "הבא"}
        </Button>
      </div>
    </div>
  );
}
