import type { OutboxPayload } from '../../lib/outbox';
import { outboxDifferences, outboxFieldText } from '../../lib/outboxPresentation';
import { NumericText } from '../Fmt';
import { Num } from '../Num';

const labels: Record<string, string> = {
  title: 'שם', day: 'תאריך ביצוע', odometer: 'קילומטראז׳', costAgorot: 'עלות', jobs: 'עבודות', garage: 'מוסך',
  notes: 'הערות', dueDay: 'תאריך יעד', dueOdometer: 'יעד ק״מ', intervalKm: 'מרווח ק״מ', intervalMonths: 'מרווח חודשים',
  active: 'תזכורת פעילה', source: 'מקור', basis: 'חישוב מועד', category: 'סוג הוצאה', job: 'סוג טיפול',
  completedPlanIds: 'תזכורות שהושלמו', symptoms: 'תיאור התקלה', importance: 'חשיבות', status: 'מצב התקלה',
  serviceEventIds: 'טיפולים קשורים', history: 'היסטוריית התקלה', occurrence: 'התראה', read: 'נקראה', archived: 'בארכיון',
  snoozeUntilDay: 'דחייה עד', deleted: 'הוסרה', schemaVersion: 'גרסת המבנה', version: 'גרסת הרשומה',
  observedAt: 'מועד הקריאה', recordedAt: 'מועד הרישום', kind: 'סוג הקריאה', level: 'חלק המיכל',
  levelUncertainty: 'אי־ודאות בקריאה', levelSource: 'מקור הקריאה', confirmed: 'אושרה', fillupId: 'תדלוק קשור', phase: 'מועד ביחס לתדלוק',
  vehicleId: 'רכב', stationId: 'מזהה התחנה', stationName: 'תחנה', fuelType: 'סוג דלק',
  discountPerLiter: 'הנחה אישית לליטר', fixedPricePerLiter: 'מחיר אישי לליטר', label: 'תיאור',
  expiresAt: 'בתוקף עד', reviewed: 'נבדק', legacy: 'כלל ישן', migratedAt: 'מועד העברה',
  due: 'בתוקף עד', insurer: 'חברת הביטוח', cost: 'עלות שנתית', type: 'סוג הכיסוי',
  activeVehicleId: 'הרכב הפעיל', documentPresence: 'מצב המסמך',
};

function Value({ field, input, present }: { field: string; input: unknown; present: boolean }) {
  const text = outboxFieldText(field, input, present);
  return typeof input === 'number' && ['costAgorot', 'discountPerLiter', 'fixedPricePerLiter'].includes(field)
    ? <Num>{text}</Num> : <NumericText>{text}</NumericText>;
}

export function CareConflictDetails({ mine, server }: { mine: OutboxPayload | null; server: OutboxPayload | null }) {
  if (!server) return <p className="text-sm">הרשומה נמחקה בשרת. העותק המקומי נשמר בייצוא הפעולות.</p>;
  const differences = outboxDifferences(mine, server);
  return <div className="flex flex-col gap-3 text-sm" data-testid="outbox-conflict-details">
    <p className="font-semibold">ההבדלים לבדיקה לפני בחירת הגרסה</p>
    {differences.length === 0 ? <p>לא נמצאו הבדלים בתמונות הרשומה השמורות.</p> : differences.map(row =>
      <div className="rounded-lg bg-surface-2 p-3" key={row.key} data-testid={`outbox-conflict-${row.key}`} data-outbox-field={row.key}>
        <b><NumericText>{labels[row.key] ?? row.key}</NumericText></b>
        <p className="break-words whitespace-pre-wrap" data-testid="outbox-value-mine">שלי: <Value field={row.key} input={row.mine} present={row.minePresent} /></p>
        <p className="break-words whitespace-pre-wrap" data-testid="outbox-value-server">בשרת: <Value field={row.key} input={row.server} present={row.serverPresent} /></p>
        {row.beyondDisplayPrecision ? <p className="text-muted" data-testid="outbox-display-precision">הערכים שונים מעבר לדיוק התצוגה</p> : null}
      </div>)}
  </div>;
}
