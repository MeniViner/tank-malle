import { int } from "../format";
import { civilDaysBetween, VEHICLE_DOC_TITLES } from "../vehicle/documents";
import { vehicleDocumentOccurrences, vehicleDocumentSpotlights } from "../vehicle/documentNotifications";
import { vehicleDay } from "../vehicle/format";
import type { Vehicle } from "../stats";
import type { ReminderInput, SpotlightItem } from "./spotlight";

interface CalendarItem { item: SpotlightItem; day: string; label: string }

/** A bounded, deterministic dismissal key, including every constituent occurrence. */
function groupIdentity(ids: readonly string[]): string {
  let hash = 0xcbf29ce484222325n;
  for (const character of JSON.stringify([...ids].sort())) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(character.codePointAt(0)!)) * 0x100000001b3n);
  }
  return `upcoming:${ids.length}:${hash.toString(16)}`;
}

/**
 * Group known calendar deadlines, preserving independently urgent dates and
 * mileage triggers. Stored insurance/test costs describe past records and
 * never enter this forward-looking reminder.
 */
export function groupedReminderSpotlights(input: {
  vehicle: Vehicle;
  today: string;
  reminders: readonly ReminderInput[];
  mileageCards: readonly SpotlightItem[];
  documents?: readonly SpotlightItem[];
  dismissedIds?: readonly string[];
}): SpotlightItem[] {
  const occurrences = vehicleDocumentOccurrences(input.vehicle, input.today);
  const documents = input.documents ?? vehicleDocumentSpotlights(occurrences);
  const dismissed = new Set(input.dismissedIds ?? []);
  const mileageIds = new Set(input.mileageCards.map(item => item.id));
  const urgentDateIds = new Set<string>();
  const dateCards: SpotlightItem[] = [];
  const candidates: CalendarItem[] = [];
  for (const occurrence of occurrences) {
    const item = documents.find(card => card.id === occurrence.occurrence);
    if (item && !item.sticky && !occurrence.urgent && !dismissed.has(item.id)) {
      candidates.push({ item, day: occurrence.due, label: VEHICLE_DOC_TITLES[occurrence.key] });
    }
  }
  for (const reminder of input.reminders) {
    if (!reminder.plan.active || reminder.due.completed || !reminder.due.day) continue;
    const days = civilDaysBetween(input.today, reminder.due.day);
    if (days === null || days > 30) continue;
    const urgent = days < 7;
    if (!urgent && mileageIds.has(reminder.occurrence)) continue;
    if (urgent) urgentDateIds.add(reminder.occurrence);
    const mileage = input.mileageCards.find(card => card.id === reminder.occurrence);
    const suffix = days < 0 ? "המועד עבר" : days === 0 ? "היום" : days === 1 ? "מחר" : `בעוד ${int(days)} ימים`;
    const item: SpotlightItem = {
      id: reminder.occurrence, tone: urgent ? "danger" : "warn", icon: "wrench", sticky: urgent,
      title: `${reminder.plan.title} · ${suffix}`,
      body: `המועד שנקבע: ${vehicleDay(reminder.due.day)}${mileage ? ` · ${mileage.title}` : ""}`,
      target: { kind: "route", to: `/vehicle/reminders/${encodeURIComponent(reminder.plan.id)}` },
    };
    dateCards.push(item);
    if (!urgent && !dismissed.has(item.id)) candidates.push({ item, day: reminder.due.day, label: reminder.plan.title });
  }
  candidates.sort((a, b) => a.day.localeCompare(b.day) || a.item.id.localeCompare(b.item.id));
  const urgent = [...documents.filter(item => item.sticky), ...dateCards.filter(item => item.sticky),
    ...input.mileageCards.filter(item => !urgentDateIds.has(item.id))];
  const ordinary = [...documents.filter(item => !item.sticky), ...dateCards.filter(item => !item.sticky)];
  if (candidates.length < 2) return [...urgent, ...ordinary];
  const memberIds = candidates.map(candidate => candidate.item.id);
  const members = new Set(memberIds);
  const labels = candidates.slice(0, 3).map(candidate => `${candidate.label}: ${vehicleDay(candidate.day)}`).join(" · ");
  const remainder = candidates.length > 3 ? ` · ועוד ${int(candidates.length - 3)}` : "";
  return [...urgent, {
    id: groupIdentity(memberIds), tone: "warn", icon: "doc",
    title: `${int(candidates.length)} תזכורות ב-30 הימים הקרובים`, body: labels + remainder,
    dismisses: memberIds,
    target: { kind: "route", to: "/vehicle?tab=due" },
  }, ...ordinary.filter(item => !members.has(item.id))];
}
