import { CareConflictDetails } from "../components/maintenance/CareConflictDetails";
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../context/DataContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useAccountScope } from "../components/account/useAccountScope";
import { ScreenHeader } from "../components/AppHeader";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { ConfirmDialog } from "../components/Sheet";
import { Num } from "../components/Num";
import { NumericText, Percent } from "../components/Fmt";
import { ChevronDown, WarningIcon } from "../components/icons";
import { fullDate, num, price, shekel, time } from "../lib/format";
import { vehicleMoney } from "../lib/vehicle/format";
import { fillupFromPayload } from "../lib/fillupSerializer";
import { exportOperations, outboxStatusText, type OutboxOperation } from "../lib/outbox";
import { exportFilename } from "../lib/exportFilename";
import { MUTATION_LABELS, describeError } from "../lib/writes";
import { outboxDay, outboxFieldText, presentOutboxOperation } from '../lib/outboxPresentation';
import "../secondary-design.css";

/**
 * "לא סונכרן" — every write the server has not acknowledged, with the user's
 * original input and something to DO about it.
 *
 * A tooltip on a header badge was the whole failure UI before. A rejected
 * fill-up now stays here, exactly as typed, until it is retried successfully,
 * edited and re-sent, exported, or discarded on purpose.
 */
export function Unsynced() {
  const { user } = useAuth();
  return <AccountUnsynced key={user?.uid ?? "signed-out"} />;
}

function AccountUnsynced() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { user } = useAuth();
  const captureScope = useAccountScope(user?.uid);
  const {
    outbox,
    vehicles,
    retryOperation,
    resolveConflict,
    discardOperation,
    offline,
    outboxHealth,
    outboxReady,
    captureAccountAction,
  } = useData();
  const healthOk = outboxReady && outboxHealth.state === "ok";

  const inFlight = useRef(new Set<string>());
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [confirmDiscard, setConfirmDiscard] = useState<OutboxOperation | null>(null);

  const ordered = useMemo(
    () =>
      [...outbox].sort((a, b) => {
        const rank = (op: OutboxOperation) =>
          op.status === "conflict" ? 0 : op.status === "failed" ? 1 : 2;
        return rank(a) - rank(b) || b.updatedAt - a.updatedAt;
      }),
    [outbox],
  );

  const vehicleName = (vehicleId: string | null) => {
    const vehicle = vehicles.find((entry) => entry.id === vehicleId);
    return vehicle ? `${vehicle.make} ${vehicle.model}` : null;
  };

  async function runOperation(opId: string, action: () => Promise<unknown>) {
    const accountCurrent = captureAccountAction();
    const mounted = captureScope();
    const stillCurrent = () => accountCurrent() && mounted();
    if (!stillCurrent() || inFlight.current.has(opId)) return;
    inFlight.current.add(opId);
    setBusy(new Set(inFlight.current));
    try {
      await action();
    } catch (error) {
      if (stillCurrent()) showToast({ tone: "error", title: error instanceof Error ? error.message : describeError(error) });
    } finally {
      inFlight.current.delete(opId);
      if (stillCurrent()) setBusy(new Set(inFlight.current));
    }
  }

  function exportAll() {
    if (!captureAccountAction()() || !captureScope()()) return;
    const now = new Date();
    const text = exportOperations(outbox, now);
    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = exportFilename("tank-malle-unsynced.json", now);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    showToast({ tone: "info", title: "הקובץ מכיל נתונים פרטיים — שמרו אותו במקום בטוח" });
  }

  return (
    <main className="tm-secondary-page" data-testid="unsynced-page">
      <ScreenHeader
        title="סנכרון"
        onBack={() => navigate(-1)}
        trailing={
          outbox.length > 0 ? (
            <button
              type="button"
              onClick={exportAll}
              className="tm-secondary-link"
            >
              ייצוא
            </button>
          ) : null
        }
      />

      <div className="tm-secondary-body">
        <h2 className="tm-secondary-title">{!outboxReady ? "בודקים את השינויים" : !healthOk ? "לא הצלחנו לבדוק את הסנכרון" : ordered.length ? "שינויים שעוד לא עלו לענן" : "הכל מעודכן"}</h2>
        {offline && ordered.length ? <p className="tm-secondary-notice tm-secondary-notice-info">
          אין חיבור. פעולות ממתינות יישלחו כשהחיבור יחזור; לפעולות שנכשלו אפשר לנסות שוב.
        </p> : null}

        {outboxReady && outboxHealth.state !== "ok" ? (
          <div role="alert" className="tm-secondary-notice tm-secondary-notice-error" data-outbox-health={outboxHealth.state}>
            <WarningIcon size={17} className="mt-px flex-none" />
            <span className="flex flex-col gap-0.5">
              <span className="font-bold">
                {outboxHealth.state === "unavailable"
                  ? "אחסון הפעולות המקומי אינו זמין"
                  : "חלק מהרשומות המקומיות לא ניתנות לקריאה"}
              </span>
              <span className="text-[14px] text-muted">
                {outboxHealth.message ?? ""} הרשימה למטה עשויה להיות חלקית; אין לראות בה אישור
                שהכול סונכרן.
              </span>
            </span>
          </div>
        ) : null}

        {!outboxReady ? (
          <p role="status" className="tm-secondary-copy">טוענים את השינויים השמורים במכשיר…</p>
        ) : ordered.length === 0 ? (
          <p className="tm-secondary-copy">
            {healthOk
              ? "אין במכשיר הזה שינויים שממתינים לאישור."
              : "לא נמצאו פעולות ברשימה — אבל מצב האחסון לא מאפשר לומר שהכול סונכרן."}
          </p>
        ) : (
          ordered.map((op) => (
            <OperationCard
              key={op.opId}
              op={op}
              vehicleName={vehicleName(op.vehicleId)}
              busy={busy.has(op.opId)}
              onRetry={() => void runOperation(op.opId, () => retryOperation(op.opId))}
              onEdit={
                op.kind === "fillup.add" ||
                op.kind === "fillup.restore" ||
                op.kind === "fillup.update" ||
                op.kind === "import.batch"
                  ? () =>
                      // Bound to the OPERATION, not to whatever the server
                      // holds under that id: the editor opens the rejected
                      // input and re-sends under the same op.
                      navigate(
                        op.kind === "fillup.update"
                          ? `/fillup/${op.docId}?op=${encodeURIComponent(op.opId)}`
                          : `/fillup/new?op=${encodeURIComponent(op.opId)}`,
                      )
                  : undefined
              }
              onKeepServer={
                op.status === "conflict" ? () => void runOperation(op.opId, () => resolveConflict(op.opId, "keep-server")) : undefined
              }
              onOverwrite={
                op.status === "conflict" ? () => void runOperation(op.opId, () => resolveConflict(op.opId, "overwrite", op)) : undefined
              }
              onDiscard={() => setConfirmDiscard(op)}
            />
          ))
        )}

        <details className="tm-secondary-disclosure">
          <summary>איך נשמרים השינויים?<ChevronDown size={18} /></summary>
          <div className="tm-secondary-disclosure-content tm-secondary-note">
            <ol className="tm-sync-steps" aria-label="שלבי הסנכרון">
              <li><span><b>נשמר במכשיר</b><span className="block">הקלט נשאר כאן גם אחרי רענון.</span></span></li>
              <li><span><b>נשלח לשרת</b><span className="block">פעולות ממתינות נשלחות כשהחיבור זמין. פעולה שנכשלה דורשת ניסיון חוזר.</span></span></li>
              <li><span><b>אושר וסונכרן</b><span className="block">רק אחרי האישור הפעולה יוצאת מהרשימה.</span></span></li>
            </ol>
            <p>הרשימה נשמרת במכשיר הזה ושורדת רענון, סגירה והתנתקות. ניקוי נתוני האתר או מחיקת הדפדפן מוחקים גם אותה. לשמירת עותק נוסף, השתמשו בייצוא.</p>
          </div>
        </details>
      </div>

      <ConfirmDialog
        open={confirmDiscard !== null}
        title={
          confirmDiscard?.status === "pending"
            ? "להסיר את הרשומה מהמעקב?"
            : "למחוק את הרשומה שלא סונכרנה?"
        }
        body={
          confirmDiscard?.status === "pending"
            ? "הפעולה עדיין ממתינה בתור השליחה של המכשיר. הסרה מהרשימה לא מבטלת אותה — הכתיבה עצמה עדיין עשויה להגיע לשרת. יוסר רק העותק שנשמר לתיקון."
            : "זהו העותק היחיד של מה שהקלדתם. אם תרצו לשמור אותו — ייצאו קודם."
        }
        confirmLabel={confirmDiscard?.status === "pending" ? "הסרה מהמעקב" : "מחיקה לצמיתות"}
        onConfirm={() => {
          if (confirmDiscard) {
            const opId = confirmDiscard.opId;
            void runOperation(opId, () => discardOperation(opId));
          }
          setConfirmDiscard(null);
        }}
        onCancel={() => setConfirmDiscard(null)}
      />
    </main>
  );
}

const KIND_LABEL: Record<OutboxOperation["kind"], string> = MUTATION_LABELS;

export function OperationCard({
  op,
  vehicleName,
  busy,
  onRetry,
  onEdit,
  onKeepServer,
  onOverwrite,
  onDiscard,
}: {
  op: OutboxOperation;
  vehicleName: string | null;
  busy: boolean;
  onRetry: () => void;
  onEdit?: () => void;
  onKeepServer?: () => void;
  onOverwrite?: () => void;
  onDiscard: () => void;
}) {
  const presentation = presentOutboxOperation(op);
  const details = presentation.payload ?? presentation.beforeImage;
  const careDay = outboxDay(details?.day ?? details?.dueDay);
  const record =
    !presentation.category && op.payload && op.kind !== "vehicle.delete" && !op.kind.startsWith("tank.") && !op.kind.startsWith("maintenance.") && !op.kind.startsWith('priceRule.')
      ? fillupFromPayload(op.docId, op.payload)
      : null;
  const before =
    !record && op.beforeImage && op.kind === "fillup.delete"
      ? fillupFromPayload(op.docId, op.beforeImage)
      : null;
  const shown = record ?? before;

  return (
    <div className="tm-sync-operation" data-outbox-op={op.opId} data-outbox-status={op.status} data-outbox-images={presentation.state}>
    <Card className="tm-secondary-card">
      <div className="tm-sync-operation-heading">
        <span className="tm-sync-operation-title">
          <b>{KIND_LABEL[op.kind]}</b>
          {vehicleName ? <span className="tm-secondary-note"><NumericText>{vehicleName}</NumericText></span> : null}
        </span>
        <span className="tm-sync-status" data-state={op.status}>
          {outboxStatusText(op.status)}
        </span>
      </div>

      {presentation.state === 'unverified' ? <p role="alert" data-testid="outbox-record-unverified" className="text-sm text-danger-ink">
        לא ניתן לקרוא את תמונת הרשומה. העותק המקורי נשמר לייצוא; החלפת גרסת השרת אינה זמינה.
      </p> : null}

      {presentation.category === 'care' && details ? <div className="rounded-md bg-surface-2 p-3 text-sm" data-testid="outbox-record-summary" data-outbox-record-kind="care">
        <b data-testid="outbox-summary-title"><NumericText>{typeof details.title === 'string' ? details.title : 'עדכון תחזוקת רכב'}</NumericText></b>
        {careDay ? <p data-testid="outbox-summary-day"><NumericText>{careDay}</NumericText></p> : null}
        {typeof details.costAgorot === 'number' && Number.isFinite(details.costAgorot)
          ? <p data-testid="outbox-summary-amount"><Num>{vehicleMoney(details.costAgorot)}</Num></p>
          : Object.hasOwn(details, 'costAgorot') ? <p data-testid="outbox-summary-amount">עלות לא צוינה</p> : null}
        <p className="mt-1 text-muted">הנתונים המלאים כלולים בייצוא השינויים שעוד לא עלו לענן.</p>
      </div> : null}
      {presentation.category === 'observation' && details ? <div className="rounded-md bg-surface-2 p-3 text-sm" data-testid="outbox-record-summary" data-outbox-record-kind="observation">
        <b data-testid="outbox-summary-title">{details.kind === 'odometer' ? 'עדכון קילומטראז׳' : 'עדכון מצב המיכל'}</b>
        <p data-testid="outbox-summary-day"><NumericText>{outboxFieldText('observedAt', details.observedAt, Object.hasOwn(details, 'observedAt'))}</NumericText></p>
        {Object.hasOwn(details, 'odometer') ? <p>קילומטראז׳: {typeof details.odometer === 'number' && Number.isFinite(details.odometer)
          ? <Num>{num(details.odometer, 0)}</Num> : 'לא צוין'}</p> : null}
        {Object.hasOwn(details, 'level') ? <p>מצב המיכל: {typeof details.level === 'number' && Number.isFinite(details.level)
          ? <Percent value={details.level * 100} /> : 'לא צוין'}</p> : null}
      </div> : null}
      {presentation.category === 'priceRule' && details ? <div className="rounded-md bg-surface-2 p-3 text-sm" data-testid="outbox-record-summary" data-outbox-record-kind="priceRule">
        <b data-testid="outbox-summary-title"><NumericText>{typeof details.stationName === 'string' && details.stationName ? details.stationName : 'כלל תמחור אישי'}</NumericText></b>
        {typeof details.label === 'string' && details.label ? <p><NumericText>{details.label}</NumericText></p> : null}
        {typeof details.fuelType === 'string' ? <p>סוג דלק: <NumericText>{({ '95': 'בנזין 95', '98': 'בנזין 98', diesel: 'סולר', other: 'אחר' } as Record<string, string>)[details.fuelType] ?? details.fuelType}</NumericText></p> : null}
        {typeof details.discountPerLiter === 'number' && Number.isFinite(details.discountPerLiter) ? <p data-testid="outbox-summary-amount">
          {details.discountPerLiter < 0 ? 'תוספת אישית לליטר: ' : 'הנחה אישית לליטר: '}<Num>{price(Math.abs(details.discountPerLiter))}</Num>
        </p> : null}
        {typeof details.fixedPricePerLiter === 'number' && Number.isFinite(details.fixedPricePerLiter) ? <p>מחיר אישי לליטר: <Num>{price(details.fixedPricePerLiter)}</Num></p> : null}
      </div> : null}
      {presentation.category === 'vehicleDocument' && details ? <div className="rounded-md bg-surface-2 p-3 text-sm" data-testid="outbox-record-summary" data-outbox-record-kind="vehicleDocument">
        <b data-testid="outbox-summary-title">{presentation.title}</b>
        {Object.hasOwn(details, 'type') ? <p><NumericText>{outboxFieldText('type', details.type)}</NumericText></p> : null}
        {Object.hasOwn(details, 'insurer') ? <p><NumericText>{outboxFieldText('insurer', details.insurer)}</NumericText></p> : null}
        {Object.hasOwn(details, 'due') ? <p data-testid="outbox-summary-day">בתוקף עד <NumericText>{outboxFieldText('due', details.due)}</NumericText></p> : null}
        {Object.hasOwn(details, 'cost') ? <p data-testid="outbox-summary-amount">עלות שנתית: <NumericText>{outboxFieldText('cost', details.cost)}</NumericText></p> : null}
      </div> : null}
      {presentation.category === 'vehicleSelection' && details ? <div className="rounded-md bg-surface-2 p-3 text-sm" data-testid="outbox-record-summary" data-outbox-record-kind="vehicleSelection">
        <b data-testid="outbox-summary-title">{presentation.title}</b>
        <p><NumericText>{outboxFieldText('activeVehicleId', details.activeVehicleId, Object.hasOwn(details, 'activeVehicleId'))}</NumericText></p>
      </div> : null}
      {presentation.category && presentation.state !== 'unverified' && op.status === 'conflict'
        ? <CareConflictDetails mine={details} server={presentation.serverImage} /> : null}
      {shown ? (
        <div className="flex flex-col gap-1 rounded-md bg-surface-2 px-3 py-2.5 text-[14px] text-ink">
          <span>
            {Number.isFinite(shown.date) ? (
              <>
                <NumericText>{fullDate(shown.date)}</NumericText> · <Num>{time(shown.date)}</Num>
              </>
            ) : (
              "תאריך לא קריא"
            )}
          </span>
          <span>
            <Num>{num(shown.odometer, 0)}</Num> ק״מ · <Num>{num(shown.liters, 1)}</Num> ל׳ ·{" "}
            <Num>{shekel(shown.totalCost)}</Num>
          </span>
          {shown.station?.name ? <span className="text-muted"><NumericText>{shown.station.name}</NumericText></span> : null}
          {shown.notes ? <span className="text-muted"><NumericText>{shown.notes}</NumericText></span> : null}
        </div>
      ) : null}

      {op.error ? (
        <div className="flex items-start gap-2 text-[14px] leading-relaxed text-danger-ink">
          <WarningIcon size={15} className="mt-px flex-none" />
          <span className="flex min-w-0 flex-col">
            <span className="font-semibold">
              {op.error.code === "unconfirmed" || op.error.code === "conflict" || op.error.code === "unverified"
                ? op.error.message
                : describeError({ code: op.error.code })}
            </span>
          </span>
        </div>
      ) : null}

      <details className="tm-secondary-disclosure">
        <summary>פרטי הפעולה<ChevronDown size={18} /></summary>
        <div className="tm-secondary-disclosure-content tm-secondary-note">
          <p>ניסיונות: <Num>{op.attempts}</Num> · עודכן <NumericText>{fullDate(op.updatedAt)}</NumericText> <Num>{time(op.updatedAt)}</Num> · גרסה <Num>{op.clientVersion}</Num></p>
          {op.error ? <p dir="ltr">{op.error.code}{op.error.message ? ` · ${op.error.message}` : ""}</p> : null}
        </div>
      </details>

      <div className="tm-sync-operation-actions">
        {op.status === "conflict" ? (
          <>
            <Button onClick={onKeepServer} disabled={busy}>
              להשאיר את גרסת השרת
            </Button>
            <Button onClick={presentation.canOverwrite ? onOverwrite : undefined} disabled={busy || !presentation.canOverwrite} loading={busy} data-testid="outbox-overwrite">
              לדרוס עם הגרסה שלי
            </Button>
          </>
        ) : op.status === "pending" ? (
          // The SDK owns this write; a second competing send is exactly what
          // the outbox exists to avoid. Its fate is settled from the next
          // server-sourced snapshot.
          <span className="self-center text-[14px] text-muted">
            ממתין — יישלח אוטומטית כשהשרת זמין
          </span>
        ) : (
          <Button onClick={onRetry} disabled={busy} loading={busy}>
            ניסיון חוזר
          </Button>
        )}
        {onEdit ? (
          <button
            type="button"
            onClick={onEdit}
            className="min-h-[44px] rounded-pill border border-line bg-surface px-4 text-[14px] font-semibold text-ink"
          >
            עריכה
          </button>
        ) : null}
        <button
          type="button"
          onClick={onDiscard}
          className="min-h-[44px] rounded-pill px-3 text-[13px] font-semibold text-danger"
        >
          {op.status === "pending" ? "הסרה מהמעקב" : "מחיקה"}
        </button>
      </div>
    </Card>
    </div>
  );
}
