import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../components/Button";
import { FillupPreview, StatsPreview, VehiclePreview } from "../components/Previews";

const SLIDES = [
  {
    title: "רישום תדלוק ב־15 שניות",
    body: "הכול ממולא מראש — תאריך, מחיר ותחנה. נשאר רק להקליד קילומטראז׳ וליטרים.",
    Preview: FillupPreview,
  },
  {
    title: "צריכה אמיתית, לא הבטחות",
    body: "אחרי כל תדלוק תדעו בדיוק כמה קמ״ל אתם עושים באמת, ואיך זה מול הממוצע שלכם ומול היצרן.",
    Preview: StatsPreview,
  },
  {
    title: "מזהים את הרכב לפי הלוחית",
    body: "מספר רישוי אחד מספיק — יצרן, דגם, שנה וצריכה מוצהרת נמשכים ממאגרי משרד התחבורה.",
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
        {/* Keyed so each slide's preview animates in rather than swapping. */}
        <div key={index} className="tm-fade-in flex w-full justify-center">
          <Preview />
        </div>

        <div className="flex flex-col gap-2.5">
          <h1 className="text-[23px] font-bold leading-tight text-ink">{slide.title}</h1>
          <p className="mx-auto max-w-[310px] text-[14.5px] leading-relaxed text-muted">
            {slide.body}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-5">
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

        <p className="text-center text-[11.5px] text-muted/80">
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
