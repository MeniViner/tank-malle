/**
 * Hebrew copy for the tank model's structured outputs.
 *
 * Kept apart from the components so a reason code has exactly one wording, and
 * so the engine can stay in codes — which survive reordering and re-rendering —
 * rather than carrying sentences around.
 *
 * The tone rule throughout: neutral and factual. The app does not congratulate
 * anyone for refuelling early or tut at them for running it low, and it never
 * says "AI", "confidence" or a coefficient out loud.
 */

import type { HabitProfile } from "./habits";
import { claimsFillsToFull, claimsPartialTopUps } from "./habits";
import { levelLabel } from "./gaugeInteraction";
import type { NextUpdateKind, PassageResult, ReasonCode } from "./types";

export const REASON_TEXT: Record<ReasonCode, string> = {
  recentConfirmedFullAnchor: "מבוסס על תדלוק אחרון מיכל מלא",
  recentGaugeObservation: "מבוסס על עדכון מד הדלק האחרון",
  recentOdometer: "הקילומטראז׳ עדכני",
  travelForecastFromHistory: "קצב הנסיעה נלמד מההיסטוריה שלך",
  consumptionFromHistory: "הצריכה נמדדה מהתדלוקים שלך",
  consumptionFromDeclaredPrior: "הצריכה לפי נתוני היצרן — עדיין אין מספיק מדידות",
  habitFromObservations: "הרגלי התדלוק נלמדו מהתדלוקים שלך",
  habitFromPrior: "עדיין משתמשים בברירת מחדל, לא בהרגל שלך",
  explicitPreferenceOverride: "לפי ההעדפה שהגדרת",
  upcomingTripRequiresEarlierRefuel: "יש נסיעה מתוכננת שדורשת להקדים",
  weakGaugeEstimate: "ההערכה מבוססת על חישוב, לא על מדידה",
  insufficientRoutineSamples: "עדיין אין מספיק תדלוקים כדי ללמוד הרגל",
  insufficientTravelHistory: "עדיין אין מספיק היסטוריה כדי להעריך קצב נסיעה",
  untrustedCapacity: "נפח המיכל לא אושר — אי אפשר להציג ליטרים או טווח",
  historyBreak: "יש תקופה שלא תועדה, החישוב מתחיל מחדש אחריה",
  staleAnchor: "העדכון האחרון ישן — כדאי לרענן",
  conflictingObservations: "יש דיווחים שלא מסתדרים זה עם זה",
  overCapacityResidual: "החישוב יוצא גדול מנפח המיכל",
  capacitySuspect: "לפי התדלוקים, נפח המיכל כנראה גדול מההערכה — כדאי לאשר אותו",
  negativeResidual: "החישוב יורד מתחת לאפס — כנראה חסר תדלוק",
  unsupportedFuelType: "מעקב מיכל לא נתמך לסוג הדלק הזה",
};

export const NEXT_UPDATE_TEXT: Record<
  Exclude<NextUpdateKind, "none">,
  { title: string; action: string }
> = {
  confirmCapacity: {
    title: "מה נפח המיכל של הרכב?",
    action: "הוספת נפח מיכל",
  },
  updateGauge: {
    title: "כמה דלק יש עכשיו במיכל?",
    action: "עדכון מד הדלק",
  },
  updateOdometer: {
    title: "מה הקילומטראז׳ הנוכחי?",
    action: "עדכון קילומטראז׳",
  },
  confirmFullEndpoints: {
    title: "סימון תדלוק מיכל מלא משפר את חישוב הצריכה",
    action: "הבנתי",
  },
  recordPreFillLevel: {
    title: "בתדלוק הבא, כמה נשאר לפני שמילאתם?",
    action: "הבנתי",
  },
};

/** "בעוד 3–5 ימים" / "בעוד כ־4 ימים" / null when nothing is supportable. */
export function passageText(passage: PassageResult): string | null {
  if (passage.status === "reached") return "כבר עכשיו";
  if (passage.status !== "withinHorizon" || passage.days === null) return null;

  const low = passage.daysLow;
  const high = passage.daysHigh;
  const round = (value: number) => Math.max(0, Math.round(value));

  // A band is only shown when it is actually a band. Rounding 3.2–3.4 to
  // "3–3 days" would be a precision claim dressed up as a range.
  if (low !== null && high !== null && round(high) - round(low) >= 1) {
    return `בעוד ${round(low)}–${round(high)} ימים`;
  }
  const days = round(passage.days);
  if (days === 0) return "היום";
  if (days === 1) return "מחר";
  return `בעוד כ־${days} ימים`;
}

/**
 * The single personalised sentence on the card.
 *
 * Only produced when there is evidence for it. Until then the copy says what is
 * actually true — that the app is still learning — rather than dressing the
 * product default up as this person's habit.
 */
export function habitSentence(
  habit: HabitProfile,
  expected: PassageResult,
): { text: string; personalised: boolean } {
  if (habit.overridden) {
    return {
      text: `לפי ההעדפה שהגדרת, כדאי לתדלק סביב ${levelLabel(habit.typicalLevel)}.`,
      personalised: true,
    };
  }

  if (!habit.canClaim) {
    return {
      text: "עוד לא למדנו את ההרגל שלך. כמה עדכונים של מצב המיכל וזה יתחיל להתאים אישית.",
      personalised: false,
    };
  }

  // A genuinely mixed routine is shown as a range. Averaging two distinct
  // habits into a midpoint nobody practises would read as precision and be wrong.
  const level = habit.mixed
    ? `בין ${levelLabel(habit.low)} ל־${levelLabel(habit.high)}`
    : levelLabel(habit.typicalLevel);

  const timing = passageText(expected);
  const base = `בדרך כלל אתה מתדלק כשנשאר ${level}.`;
  return {
    text: timing ? `${base} לפי ההרגל שלך, התדלוק הבא צפוי ${timing}.` : base,
    personalised: true,
  };
}

/** How much is normally added, when there is enough evidence to say. */
export function fillStyleSentence(habit: HabitProfile): string | null {
  if (claimsFillsToFull(habit)) return "ברוב התדלוקים אתה ממלא מיכל מלא.";
  if (claimsPartialTopUps(habit) && habit.typicalPurchaseFraction !== null) {
    return `בדרך כלל אתה מוסיף בערך ${levelLabel(habit.typicalPurchaseFraction)} מיכל ולא ממלא עד הסוף.`;
  }
  return null;
}
