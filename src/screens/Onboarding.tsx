import { useEffect, useRef, useState } from "react";
import { Button } from "../components/Button";
import { NumericText } from "../components/Fmt";
import { OnboardingArt } from "../components/entry/OnboardingArt";
import "../entry-design.css";

/** Design v3 §7.3: car-cost management, not only fuel. The copy promises only what the app does today. */
const SLIDES = [
  { title: "כמה הרכב באמת עולה לך", body: "דלק או חשמל, טיפולים, ביטוח, טסט ואגרה. סכום אחד בחודש, מחולק לקטגוריות: כל ההוצאות של הרכב במקום אחד." },
  { title: "כל רישום ב־15 שניות", body: "תדלוק: סכום וקילומטראז׳. טיפול או הוצאה: סכום ותאריך. את מה שכבר ידוע, נמלא בשבילכם." },
  { title: "צריכה אמיתית, לא הבטחות", body: "בין שני מילויים עד הסוף: כמה נסעתם על ליטר, כמה עולה כל ק״מ, ואיך זה ביחס לרגיל שלכם ולנהגים עם אותו רכב." },
  { title: "שום דבר לא נופל בין הכיסאות", body: "טסט, ביטוח חובה ומקיף, טיפול תקופתי ותקלות פתוחות: תזכורות לפי תאריך או קילומטראז׳, ותחזית מתי לתדלק." },
];

/** The illustrations are the app's own TCO card, pump display, consumption figure, spotlight and next-refuel card, fed with demo data. */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (index > 0) heading.current?.focus(); }, [index]);
  const slide = SLIDES[index];
  return <main className="entry-page entry-onboarding" data-testid="onboarding">
    <header className="entry-onboarding-top">
      <div className="entry-steps" role="progressbar" aria-label="היכרות עם טנק מלא"
        aria-valuemin={1} aria-valuemax={SLIDES.length} aria-valuenow={index + 1}>
        {SLIDES.map((item, position) => <span key={item.title} data-active={position <= index}/>)}
      </div>
      <button type="button" className="entry-text-action" aria-label="דלג" data-testid="onboarding-skip" onClick={onDone}>דילוג</button>
    </header>
    <section data-testid="onboarding-slide" data-slide={index + 1} className="entry-slide">
      <OnboardingArt index={index}/>
      <h1 ref={heading} tabIndex={-1} className="entry-onboarding-title"><NumericText>{slide.title}</NumericText></h1>
      <p className="entry-intro">{slide.body}</p>
    </section>
    <div className="entry-onboarding-footer">
      <Button full data-testid="onboarding-next" onClick={() => index === SLIDES.length - 1 ? onDone() : setIndex(current => current + 1)}>
        {index === SLIDES.length - 1 ? "מתחילים" : "הבא"}
      </Button>
    </div>
  </main>;
}
