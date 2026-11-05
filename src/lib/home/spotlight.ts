import { consumption, heMonthName, int, monthYear, price, shekel } from "../format";
import type { MaintenancePlan } from "../maintenance/model";
import type { OutboxOperation } from "../outbox";
import { officialPriceFor, type RegulatedPriceConfig } from "../prices/regulated";
import { isTankCapacityTrusted, monthKey, type Stats, type Vehicle } from "../stats";
import type { LedgerRow, MileageEvidence } from "../vehicle/derived";
import type { Fillup } from "../stats";
import { groupedReminderSpotlights } from "./groupedReminders";
import { paidPriceSpotlight } from "./paidPriceInsight";
import { sustainedConsumptionSpotlight } from "./sustainedConsumption";

export interface SpotlightItem {
  id: string;
  tone: "info" | "warn" | "danger" | "better";
  icon: "alert" | "wrench" | "chart" | "coin" | "doc" | "shield";
  title: string;
  body: string;
  sticky?: boolean;
  /** Dismissing a group also dismisses these individual calendar occurrences. */
  dismisses?: readonly string[];
  target: { kind: "route"; to: string } | { kind: "segment"; endId: string } | { kind: "price" };
}

export interface ReminderInput {
  plan: MaintenancePlan;
  due: { day?: string | null; odometer: number | null; completed: boolean; needsMileage?: boolean };
  occurrence: string;
}

export interface SpotlightInput {
  now: number;
  today: string;
  vehicle: Vehicle | null;
  units: "kmPerLiter" | "litersPer100";
  stats: Stats;
  ledger: readonly LedgerRow[];
  outbox: readonly Pick<OutboxOperation, "status">[];
  storageUnknown: boolean;
  reminders: readonly ReminderInput[];
  mileage: (MileageEvidence & { ambiguous: boolean }) | null;
  prices: RegulatedPriceConfig | null;
  /** Known unreadable records must not turn a partial history into a record claim. */
  historyComplete?: boolean;
  /** Stage 5 supplies typed document occurrences at their reserved priority. */
  documents?: readonly SpotlightItem[];
  ownerId?: string | null;
  fillups?: readonly Fillup[];
  dismissedIds?: readonly string[];
}

export function deriveSpotlight(input: SpotlightInput): SpotlightItem[] {
  const { now, today, vehicle, units, stats, ledger, outbox, storageUnknown, reminders, mileage, prices } = input;
  const items: SpotlightItem[] = [];
  const attention = outbox.filter(op => op.status !== "pending");
  if (storageUnknown || attention.length) items.push({
    id: "writes-attention", tone: "danger", icon: "alert", sticky: true,
    title: storageUnknown ? "שמירות דורשות בדיקה" : attention.length === 1 ? "שמירה אחת דורשת בדיקה" : `${int(attention.length)} שמירות דורשות בדיקה`,
    body: storageUnknown ? "לא ניתן לאמת את תור השמירות במכשיר." : "הפרטים נשמרו במכשיר. אפשר לבדוק ולנסות שוב.",
    target: { kind: "route", to: "/settings/unsynced" },
  });
  if (!vehicle) return items;
  const mileageCards: SpotlightItem[] = [];
  const mileageAge = mileage ? (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${mileage.day}T12:00:00Z`)) / 86_400_000 : Infinity;
  if (mileage && !mileage.ambiguous && mileageAge >= 0 && mileageAge <= 30) {
    for (const reminder of reminders) {
      if (!reminder.plan.active || reminder.due.completed || reminder.due.needsMileage || reminder.due.odometer === null) continue;
      const remaining = reminder.due.odometer - mileage.odometer;
      if (remaining > 500) continue;
      mileageCards.push({ id: reminder.occurrence, tone: "warn", icon: "wrench",
        title: remaining < 0 ? `${reminder.plan.title}: הגיע הזמן` : remaining === 0 ? `${reminder.plan.title}: עכשיו` : `${reminder.plan.title} בעוד ${int(remaining)} ק״מ`,
        body: "לפי הקילומטראז׳ האחרון שנרשם.",
        target: { kind: "route", to: `/vehicle/reminders/${encodeURIComponent(reminder.plan.id)}` },
      });
    }
  }
  items.push(...groupedReminderSpotlights({ vehicle, today, reminders, mileageCards,
    documents: input.documents, dismissedIds: input.dismissedIds }));
  const paid = paidPriceSpotlight({ now, ownerId: input.ownerId ?? null, vehicle,
    fillups: input.fillups ?? stats.fillups, prices, historyComplete: input.historyComplete });
  const sustained = sustainedConsumptionSpotlight({ now, stats, units, historyComplete: input.historyComplete });
  if (paid) items.push(paid);
  if (sustained) items.push(sustained);
  const last = stats.lastSegment;
  if (input.historyComplete !== false && last && stats.segments.length >= 3 && !stats.anomalies.some(anomaly => anomaly.fillupId === last.endId)
      && stats.segments.every(segment => segment.endId === last.endId || segment.kmPerLiter < last.kmPerLiter)) {
    const shown = consumption(last.kmPerLiter, units);
    items.push({ id: `best:${last.startId}:${last.endId}:${last.kmPerLiter}`, tone: "better", icon: "chart",
      title: "שיא אישי בצריכה", body: `${shown.value} ${shown.unit} במקטע האחרון. הכי חסכוני עד היום.`,
      target: { kind: "segment", endId: last.endId },
    });
  }
  const date = new Date(now);
  const previousDate = new Date(date.getFullYear(), date.getMonth(), 0, 23, 59, 59, 999);
  const currentMonth = monthKey(now), previousMonth = monthKey(+previousDate);
  if (vehicle.fuelType === "95") {
    const current = officialPriceFor(prices, "95", now), previous = officialPriceFor(prices, "95", +previousDate);
    if (current.isRegulated && previous.isRegulated && current.price !== null && current.price > 0 && previous.price !== null && previous.price > 0
        && current.effectiveMonth === currentMonth && previous.effectiveMonth === previousMonth) {
      const delta = current.price - previous.price;
      if (Math.abs(delta) >= .005) {
        const tankDifference = isTankCapacityTrusted(vehicle) ? Math.abs(delta) * vehicle.tankLiters! : null;
        const tankText = tankDifference === null ? "" : Math.round(tankDifference) === 0
          ? " השינוי למיכל מלא קטן משקל." : ` מיכל מלא ${delta < 0 ? "זול" : "יקר"} בכ-${shekel(tankDifference)}.`;
        items.push({ id: `price:95:${currentMonth}:${current.price}`, tone: "info", icon: "coin",
          title: `בנזין 95 ${delta < 0 ? "ירד" : "עלה"} ב-${price(Math.abs(delta))} לליטר`,
          body: `${price(current.price)} לליטר ב${heMonthName(date.getMonth() + 1)}.${tankText}`,
          target: { kind: "price" },
        });
      }
    }
  }
  if (input.historyComplete !== false && date.getDate() <= 7) {
    const rows = ledger.filter(row => row.day.startsWith(previousMonth) && row.financial);
    const fuel = rows.filter(row => row.kind === "fuel"), services = rows.filter(row => row.kind === "service");
    if (fuel.length) {
      const fuelText = fuel.some(row => row.amountAgorot === null) ? "סכום הדלק חלקי" : `${shekel(fuel.reduce((sum, row) => sum + row.amountAgorot!, 0) / 100)} דלק`;
      const serviceText = !services.length ? "" : services.some(row => row.amountAgorot === null)
        ? " · עלות הטיפולים חלקית" : ` · ${shekel(services.reduce((sum, row) => sum + row.amountAgorot!, 0) / 100)} טיפולים`;
      items.push({ id: `month:${previousMonth}`, tone: "info", icon: "chart", title: `${monthYear(previousMonth)} בסיכום`,
        body: `${fuelText} · ${fuel.length === 1 ? "תדלוק אחד" : `${int(fuel.length)} תדלוקים`}${serviceText}`,
        target: { kind: "route", to: `/stats?tab=spend&month=${previousMonth}` },
      });
    }
  }
  return items;
}

export function visibleSpotlight(items: readonly SpotlightItem[], dismissed: ReadonlySet<string>) {
  return items.filter(item => item.sticky || !dismissed.has(item.id)).slice(0, 4);
}

export function readSpotlightDismissals(raw: string | null): string[] {
  try {
    const value: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && id.length <= 400).slice(-200) : [];
  } catch { return []; }
}
