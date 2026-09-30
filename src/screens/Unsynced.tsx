import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../context/DataContext";
import { useToast } from "../context/ToastContext";
import { ScreenHeader } from "../components/AppHeader";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { ConfirmDialog } from "../components/Sheet";
import { Num } from "../components/Num";
import { InfoStrip } from "../components/Field";
import { CloudOffIcon, WarningIcon } from "../components/icons";
import { fullDate, num, shekel, time } from "../lib/format";
import { fillupFromPayload } from "../lib/fillupSerializer";
import { exportOperations, outboxStatusText, type OutboxOperation } from "../lib/outbox";
import { describeError } from "../lib/writes";

/**
 * "לא סונכרן" — every write the server has not acknowledged, with the user's
 * original input and something to DO about it.
 *
 * A tooltip on a header badge was the whole failure UI before. A rejected
 * fill-up now stays here, exactly as typed, until it is retried successfully,
 * edited and re-sent, exported, or discarded on purpose.
 */
export function Unsynced() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { outbox, vehicles, retryOperation, resolveConflict, discardOperation, offline } =
    useData();

  const [busy, setBusy] = useState<string | null>(null);
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

  async function retry(op: OutboxOperation) {
    setBusy(op.opId);
    try {
      await retryOperation(op.opId);
    } finally {
      setBusy(null);
    }
  }

  function exportAll() {
    const text = exportOperations(outbox);
    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `tank-malle-unsynced-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    showToast({ tone: "info", title: "הקובץ מכיל נתונים פרטיים — שמרו אותו במקום בטוח" });
  }

  return (
    <main className="flex min-h-dvh flex-1 flex-col gap-3 bg-bg pb-[104px] pt-safe">
      <ScreenHeader
        title="לא סונכרן"
        onBack={() => navigate(-1)}
        trailing={
          outbox.length > 0 ? (
            <button
              type="button"
              onClick={exportAll}
              className="min-h-[36px] rounded-pill bg-surface-2 px-3 text-[12.5px] font-semibold text-accent"
            >
              ייצוא
            </button>
          ) : null
        }
      />

      <div className="flex flex-col gap-3 px-5">
        <InfoStrip icon={<CloudOffIcon size={16} />}>
          {offline
            ? "אין חיבור. כל מה שנשמר במכשיר יישלח אוטומטית כשהחיבור יחזור."
            : "רשומה נשארת כאן עד שהשרת מאשר אותה. דחייה לא מוחקת כלום — הנתונים שהקלדתם שמורים במכשיר הזה."}
        </InfoStrip>

        {ordered.length === 0 ? (
          <Card className="px-6 py-10 text-center text-[14px] text-muted">
            הכול מסונכרן. אין פעולות ממתינות או שנדחו.
          </Card>
        ) : (
          ordered.map((op) => (
            <OperationCard
              key={op.opId}
              op={op}
              vehicleName={vehicleName(op.vehicleId)}
              busy={busy === op.opId}
              onRetry={() => void retry(op)}
              onEdit={
                op.kind === "fillup.add" || op.kind === "fillup.restore" || op.kind === "fillup.update"
                  ? () =>
                      navigate(
                        op.kind === "fillup.update"
                          ? `/fillup/${op.docId}`
                          : `/fillup/new?op=${encodeURIComponent(op.opId)}`,
                      )
                  : undefined
              }
              onKeepServer={
                op.status === "conflict" ? () => void resolveConflict(op.opId, "keep-server") : undefined
              }
              onOverwrite={
                op.status === "conflict" ? () => void resolveConflict(op.opId, "overwrite") : undefined
              }
              onDiscard={() => setConfirmDiscard(op)}
            />
          ))
        )}

        <p className="px-1 text-[12px] leading-relaxed text-muted/80">
          הרשימה נשמרת באחסון הדפדפן של המכשיר הזה. היא שורדת רענון, סגירה והתנתקות — לא
          ניקוי נתוני אתר או מחיקת הדפדפן. לגיבוי שאינו תלוי במכשיר, השתמשו בייצוא.
        </p>
      </div>

      <ConfirmDialog
        open={confirmDiscard !== null}
        title="למחוק את הרשומה שלא סונכרנה?"
        body="זהו העותק היחיד של מה שהקלדתם. אם תרצו לשמור אותו — ייצאו קודם."
        confirmLabel="מחיקה לצמיתות"
        onConfirm={() => {
          if (confirmDiscard) discardOperation(confirmDiscard.opId);
          setConfirmDiscard(null);
        }}
        onCancel={() => setConfirmDiscard(null)}
      />
    </main>
  );
}

const KIND_LABEL: Record<OutboxOperation["kind"], string> = {
  "fillup.add": "תדלוק חדש",
  "fillup.update": "עריכת תדלוק",
  "fillup.delete": "מחיקת תדלוק",
  "fillup.restore": "שחזור תדלוק",
  "vehicle.delete": "מחיקת רכב",
  "tank.observation": "עדכון מצב המיכל",
  "tank.observation.delete": "מחיקת עדכון מיכל",
};

function OperationCard({
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
  const record =
    op.payload && op.kind !== "vehicle.delete" && !op.kind.startsWith("tank.")
      ? fillupFromPayload(op.docId, op.payload)
      : null;
  const before =
    !record && op.beforeImage && op.kind === "fillup.delete"
      ? fillupFromPayload(op.docId, op.beforeImage)
      : null;
  const shown = record ?? before;

  const tone =
    op.status === "pending"
      ? "bg-surface-2 text-muted"
      : op.status === "conflict"
        ? "bg-warning-soft text-warning-ink"
        : "bg-danger-soft text-danger-ink";

  return (
    <Card className="flex flex-col gap-3 p-4" data-outbox-op={op.opId} data-outbox-status={op.status}>
      <div className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[15px] font-bold text-ink">{KIND_LABEL[op.kind]}</span>
          {vehicleName ? <span className="text-[12.5px] text-muted">{vehicleName}</span> : null}
        </span>
        <span className={`flex-none rounded-pill px-2.5 py-1 text-[11.5px] font-semibold ${tone}`}>
          {outboxStatusText(op.status)}
        </span>
      </div>

      {shown ? (
        <div className="flex flex-col gap-1 rounded-[12px] bg-surface-2 px-3 py-2.5 text-[13.5px] text-ink">
          <span>
            {Number.isFinite(shown.date) ? (
              <>
                {fullDate(shown.date)} · <Num>{time(shown.date)}</Num>
              </>
            ) : (
              "תאריך לא קריא"
            )}
          </span>
          <span>
            <Num>{num(shown.odometer, 0)}</Num> ק״מ · <Num>{num(shown.liters, 2)}</Num> ל׳ ·{" "}
            <Num>{shekel(shown.totalCost, 2)}</Num>
          </span>
          {shown.station?.name ? <span className="text-muted">{shown.station.name}</span> : null}
          {shown.notes ? <span className="text-muted">{shown.notes}</span> : null}
        </div>
      ) : null}

      {op.error ? (
        <div className="flex items-start gap-2 text-[12.5px] leading-relaxed text-danger-ink">
          <WarningIcon size={15} className="mt-px flex-none" />
          <span className="flex min-w-0 flex-col">
            <span className="font-semibold">
              {op.error.code === "unconfirmed" || op.error.code === "conflict"
                ? op.error.message
                : describeError({ code: op.error.code })}
            </span>
            <span className="break-words text-muted" dir="ltr">
              {op.error.code}
              {op.error.message && op.error.code !== "unconfirmed" && op.error.code !== "conflict"
                ? ` · ${op.error.message}`
                : ""}
            </span>
          </span>
        </div>
      ) : null}

      <span className="text-[11.5px] text-muted">
        ניסיונות: <Num>{op.attempts}</Num> · עודכן {fullDate(op.updatedAt)} <Num>{time(op.updatedAt)}</Num> ·
        גרסה <Num>{op.clientVersion}</Num>
      </span>

      <div className="flex flex-wrap gap-2">
        {op.status === "conflict" ? (
          <>
            <Button onClick={onKeepServer} disabled={busy}>
              להשאיר את גרסת השרת
            </Button>
            <Button onClick={onOverwrite} disabled={busy} loading={busy}>
              לדרוס עם הגרסה שלי
            </Button>
          </>
        ) : (
          <Button onClick={onRetry} disabled={busy} loading={busy}>
            {op.status === "pending" ? "שליחה מחדש" : "ניסיון חוזר"}
          </Button>
        )}
        {onEdit ? (
          <button
            type="button"
            onClick={onEdit}
            className="min-h-[44px] rounded-pill border border-line bg-surface px-4 text-[13.5px] font-semibold text-ink"
          >
            עריכה
          </button>
        ) : null}
        <button
          type="button"
          onClick={onDiscard}
          className="min-h-[44px] rounded-pill px-3 text-[13px] font-semibold text-danger"
        >
          מחיקה
        </button>
      </div>
    </Card>
  );
}
