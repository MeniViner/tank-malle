import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../components/Button";
import { FillupPreview, StatsPreview, VehiclePreview } from "../components/Previews";

const SLIDES = [
  {
    kicker: "מהיר",
    title: "רישום תדלוק ב־15 שניות",
    body: "הכול ממולא מראש — תאריך, מחיר ותחנה. נשאר רק להקליד קילומטראז׳ וליטרים.",
    Preview: FillupPreview,
  },
  {
    kicker: "מדויק",
    title: "צריכה אמיתית, לא הבטחות",
    body: "אחרי כל תדלוק תדעו כמה קמ״ל אתם עושים באמת, ואיך זה מול הממוצע שלכם ומול היצרן.",
    Preview: StatsPreview,
  },
  {
    kicker: "אוטומטי",
    title: "מזהים את הרכב לפי הלוחית",
    body: "מזינים מספר רכב, והפרטים הזמינים מתמלאים ממאגרי משרד התחבורה.",
    Preview: VehiclePreview,
  },
];

/** Onboarding carousel — each slide previews the actual screen it describes. */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const slide = SLIDES[index];
  const isLast = index === SLIDES.length - 1;
  const { Preview } = slide;

  return (
    <div className="relative mx-auto flex min-h-dvh w-full max-w-[430px] flex-col overflow-hidden bg-bg px-6 pb-8 pt-safe">
      <header className="relative flex items-center justify-between pt-3">
        <span className="num text-[12px] font-semibold tracking-wide text-muted/70">
          {index + 1} / {SLIDES.length}
        </span>
        <button
          type="button"
          onClick={onDone}
          className="-me-2 min-h-[44px] rounded-pill px-3 text-[14px] font-semibold text-muted transition-[color,scale] duration-200 active:scale-[0.96] active:text-ink"
        >
          דלג
        </button>
      </header>
      <div className="tm-steps mt-3" aria-label={`שלב ${index + 1} מתוך ${SLIDES.length}`}>
        {SLIDES.map((item, i) => <span key={item.title} data-active={i <= index} />)}
      </div>

      <div className="relative flex flex-1 flex-col items-center justify-center gap-7 py-6 text-start">
        {/* Keyed so every slide re-runs its own staggered entrance. */}
        <div key={index} className="flex w-full flex-col items-center gap-7">
          <div className="relative flex w-full justify-center">
            <div className="tm-rise relative w-full">
              <Preview />
            </div>
          </div>

          <div className="flex w-full flex-col items-start gap-2.5">
            <h1
              className="tm-rise max-w-[320px] font-display text-[30px] font-bold leading-[1.15] tracking-tight text-ink"
              style={{ animationDelay: "150ms" }}
            >
              {slide.title}
            </h1>
            <p
              className="tm-rise max-w-[342px] text-[16px] leading-relaxed text-muted"
              style={{ animationDelay: "220ms" }}
            >
              {slide.body}
            </p>
          </div>
        </div>
      </div>

      <div className="relative flex flex-col gap-5">
        <Button full onClick={() => (isLast ? onDone() : setIndex(index + 1))}>
          {isLast ? "מתחילים" : "הבא"}
        </Button>

        <p className="text-center text-[13px] leading-relaxed text-muted/80">
          בהמשך תתבקשו להתחבר. קראו את{" "}
          <Link to="/legal/terms" className="font-semibold text-accent">
            תנאי השימוש
          </Link>{" "}
          ואת{" "}
          <Link to="/legal/privacy" className="font-semibold text-accent">
            מדיניות הפרטיות
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
