import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../context/DataContext";
import { useToast } from "../context/ToastContext";
import { useTankEstimate } from "../hooks/useTankEstimate";
import { Card, Label, Skeleton } from "./Card";
import { Sheet } from "./Sheet";
import { Num } from "./Num";
import { Field } from "./Field";
import { Button } from "./Button";
import { TankGauge } from "./TankGauge";
import { TankDial } from "./TankDial";
import { CalendarIcon, GaugeIcon, InfoIcon, PumpIcon, WarningIcon } from "./icons";
import { dayMonthShort, num, parseDecimal, timeAgo } from "../lib/format";
import { primaryNote } from "../lib/tank/balance";
import {
  NEXT_UPDATE_TEXT,
  REASON_TEXT,
  fillStyleSentence,
  habitSentence,
  passageText,
} from "../lib/tank/copy";
import { levelLabel } from "../lib/tank/gaugeInteraction";
import { capacityNote } from "../lib/tank/capacity";
import { GAUGE_SD_BY_SOURCE } from "../lib/tank/config";
import type { TankEstimate } from "../lib/tank";

/**
 * "המיכל שלי" — the tank card on Home.
 *
 * One dominant estimate, one personalised sentence, two compact actions, and
 * everything else behind a tap. The states are rendered separately on purpose:
 * unknown has to LOOK unknown, because an empty bar and a bar we cannot draw
 * are very different things to tell somebody about their fuel.
 */
export function MyTankCard() {
  const navigate = useNavigate();
  const { loadingFillups, activeVehicle } = useData();
  const { estimate, dismissPrompt } = useTankEstimate();

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [odometerOpen, setOdometerOpen] = useState(false);
  const [gaugeOpen, setGaugeOpen] = useState(false);
  const [tripOpen, setTripOpen] = useState(false);

  if (loadingFillups) return <Skeleton className="h-[188px] rounded-card" />;
  if (!activeVehicle || !estimate.available) return null;

  const { current, habit } = estimate;
  const note = primaryNote(estimate.activeNotes);
  const conflict =
    note?.state === "conflict" ||
    note?.state === "overCapacity" ||
    note?.state === "negative";

  const habitCopy = habitSentence(habit, estimate.expectedRefuel);
  const recommended = passageText(estimate.recommendedRefuel);

  // The level shown when litres are unavailable: the last thing the user
  // actually reported, clearly labelled as a report rather than an estimate.
  const reportedLevel = estimate.lastLevelReport;

  return (
    <>
      <Card className="tm-rise flex flex-col gap-3 p-[16px_18px]" style={{ animationDelay: "70ms" }}>
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center">
            <Label>המיכל שלי</Label>
            <button
              type="button"
              aria-label="איך המיכל מחושב"
              aria-haspopup="dialog"
              onClick={() => setDetailsOpen(true)}
              className="flex size-9 items-center justify-center rounded-full text-muted/70 transition-[color,scale] duration-200 active:scale-[0.96]"
            >
              <InfoIcon size={15} />
            </button>
          </span>

          {conflict ? (
            <span className="inline-flex items-center gap-1.5 rounded-pill bg-warning-soft px-[11px] py-1 text-[12px] font-semibold text-warning-ink">
              <WarningIcon size={13} />
              צריך בדיקה
            </span>
          ) : current.stale ? (
            <span className="rounded-pill bg-surface-2 px-[11px] py-1 text-[12px] font-semibold text-muted">
              המידע ישן
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          <TankDial
            level={current.level ?? reportedLevel?.level ?? null}
            reserveLevel={estimate.reserveLevel}
            habitLevel={habit.canClaim || habit.overridden ? habit.typicalLevel : null}
            tone={conflict ? "warning" : "accent"}
            caption={
              current.liters !== null
                ? `כ־${num(current.liters, 0)} ליטר`
                : current.level === null && reportedLevel
                  ? "לפי העדכון האחרון"
                  : null
            }
          />

          {/* The legend is what turns two coloured ticks into the feature: the
              level you should act at, and the level you actually act at. */}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            {current.level !== null || reportedLevel ? (
              <>
                <LegendRow
                  color="var(--warning)"
                  label="כדאי לתדלק"
                  value={levelLabel(estimate.reserveLevel)}
                />
                {habit.canClaim || habit.overridden ? (
                  <LegendRow
                    color="var(--accent)"
                    dashed
                    label={habit.overridden ? "ההעדפה שלך" : "ההרגל שלך"}
                    value={levelLabel(habit.typicalLevel)}
                  />
                ) : (
                  <LegendRow
                    color="var(--line)"
                    dashed
                    label="ההרגל שלך"
                    value="עוד נלמד"
                  />
                )}
                {estimate.rangeToReserveKm !== null && estimate.rangeToReserveKm > 0 ? (
                  <span className="text-[12.5px] text-muted">
                    נותרו כ־<Num>{num(estimate.rangeToReserveKm, 0)}</Num> ק״מ עד שם
                  </span>
                ) : reportedLevel ? (
                  <span className="text-[12.5px] text-muted">
                    עודכן {timeAgo(reportedLevel.at)}
                  </span>
                ) : null}
              </>
            ) : (
              /* Unknown has to LOOK unknown. An empty dial with a real
                 invitation, not a zero reading dressed up as a measurement. */
              <>
                <span className="text-[15px] font-bold text-ink">נתחיל למדוד</span>
                <span className="text-[12.5px] leading-relaxed text-muted">
                  עדכון קצר של מד הדלק, ומכאן טנק מלא ילמד מתי בדרך כלל מתדלקים.
                </span>
                <button
                  type="button"
                  onClick={() => setGaugeOpen(true)}
                  className="mt-0.5 inline-flex min-h-[40px] w-fit items-center gap-1.5 rounded-pill bg-accent px-4 text-[13px] font-bold text-accent-contrast transition-[filter,scale] duration-200 active:scale-[0.97]"
                >
                  <PumpIcon size={15} />
                  עדכון מד הדלק
                </button>
              </>
            )}
          </div>
        </div>

        {/* An approximate capacity is usable and says so, with the number to
            confirm right there — a blank field in a settings screen is how it
            stayed unknown for everybody in the first place. */}
        {!estimate.capacityTrusted && estimate.capacity.suggestion !== null ? (
          <CapacityConfirm
            liters={estimate.capacity.suggestion}
            note={capacityNote(estimate.capacity) ?? ""}
          />
        ) : null}

        {/* Exactly one personalised sentence. Everything else is in the sheet. */}
        <p className="text-[13px] leading-relaxed text-ink/85">{habitCopy.text}</p>

        {estimate.tripPullsForward ? (
          <p className="text-[13px] font-semibold text-warning-ink">
            הפעם כדאי להקדים — צפויה נסיעה ארוכה.
          </p>
        ) : null}

        {/* With nothing measured yet the column above already carries a single
            primary invitation; repeating it here as one of two equal-weight
            buttons only makes the first tap harder to find. */}
        {current.level !== null || reportedLevel ? (
          <div className="flex gap-2">
            <CardAction icon={<GaugeIcon size={16} />} onClick={() => setOdometerOpen(true)}>
              עדכון קילומטראז׳
            </CardAction>
            <CardAction icon={<PumpIcon size={16} />} onClick={() => setGaugeOpen(true)}>
              עדכון מד הדלק
            </CardAction>
          </div>
        ) : null}

        {/* At most one request, and only after its cooldown has expired. */}
        {estimate.nextUpdate.kind !== "none" ? (
          <NextUpdatePrompt
            kind={estimate.nextUpdate.kind}
            onAct={() => {
              const kind = estimate.nextUpdate.kind;
              if (kind === "confirmCapacity") navigate("/settings/vehicles");
              else if (kind === "updateGauge") setGaugeOpen(true);
              else if (kind === "updateOdometer") setOdometerOpen(true);
              if (kind !== "none") dismissPrompt(kind);
            }}
            onDismiss={() => {
              if (estimate.nextUpdate.kind !== "none") dismissPrompt(estimate.nextUpdate.kind);
            }}
          />
        ) : null}
      </Card>

      <DetailsSheet
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        estimate={estimate}
        recommended={recommended}
        habitText={habitCopy.text}
        onPlanTrip={() => {
          setDetailsOpen(false);
          setTripOpen(true);
        }}
      />
      <OdometerSheet open={odometerOpen} onClose={() => setOdometerOpen(false)} estimate={estimate} />
      <GaugeSheet open={gaugeOpen} onClose={() => setGaugeOpen(false)} estimate={estimate} />
      <TripSheet open={tripOpen} onClose={() => setTripOpen(false)} />
    </>
  );
}

/** One tick from the dial, named. */
function LegendRow({
  color,
  label,
  value,
  dashed = false,
}: {
  color: string;
  label: string;
  value: string;
  dashed?: boolean;
}) {
  return (
    <span className="flex items-center gap-2 text-[12.5px]">
      <span
        aria-hidden="true"
        className="h-[3px] w-3.5 flex-none rounded-pill"
        style={
          dashed
            ? { backgroundImage: `repeating-linear-gradient(90deg, ${color} 0 3px, transparent 3px 5px)` }
            : { backgroundColor: color }
        }
      />
      <span className="min-w-0 flex-1 truncate text-muted">{label}</span>
      <span className="flex-none font-semibold text-ink">{value}</span>
    </span>
  );
}

/**
 * Confirming an approximate capacity, in one tap.
 *
 * No Israeli dataset publishes tank capacity, so the best the app can do on its
 * own is a body-type approximation or the largest fill on record. Both are
 * genuinely useful and neither is a measurement — so they are shown, labelled,
 * and one tap away from becoming the user's own number.
 */
function CapacityConfirm({ liters, note }: { liters: number; note: string }) {
  const { activeVehicle, updateVehicle } = useData();
  const { showToast } = useToast();
  const navigate = useNavigate();

  if (!activeVehicle) return null;

  return (
    <div className="flex items-center gap-2 rounded-[12px] bg-surface-2 p-2.5">
      <span className="min-w-0 flex-1 text-[12px] leading-relaxed text-muted">
        {note} — <Num>{num(liters, 0)}</Num> ליטר
      </span>
      <button
        type="button"
        onClick={() => {
          void updateVehicle(activeVehicle.id, {
            tankLiters: liters,
            tankLitersSource: "user",
          });
          showToast({ tone: "success", title: "נפח המיכל אושר" });
        }}
        className="min-h-[36px] flex-none rounded-pill px-2.5 text-[12.5px] font-bold text-accent"
      >
        מאשר
      </button>
      <button
        type="button"
        onClick={() => navigate("/settings/vehicles")}
        className="min-h-[36px] flex-none rounded-pill px-2 text-[12.5px] font-semibold text-muted"
      >
        תיקון
      </button>
    </div>
  );
}

function CardAction({
  icon,
  children,
  onClick,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-pill border border-line bg-surface px-3 text-[13px] font-semibold text-ink transition-[background-color,scale] duration-200 active:scale-[0.97] active:bg-surface-2"
    >
      {icon}
      {children}
    </button>
  );
}

function NextUpdatePrompt({
  kind,
  onAct,
  onDismiss,
}: {
  kind: Exclude<TankEstimate["nextUpdate"]["kind"], "none">;
  onAct: () => void;
  onDismiss: () => void;
}) {
  const copy = NEXT_UPDATE_TEXT[kind];
  return (
    <div className="flex items-center gap-2 rounded-[12px] bg-surface-2 p-2.5">
      <span className="flex-1 text-[12.5px] leading-relaxed text-ink/85">{copy.title}</span>
      <button
        type="button"
        onClick={onAct}
        className="min-h-[36px] flex-none rounded-pill px-2.5 text-[12.5px] font-bold text-accent"
      >
        {copy.action}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="לא עכשיו"
        className="min-h-[36px] flex-none rounded-pill px-2 text-[12.5px] font-semibold text-muted"
      >
        לא עכשיו
      </button>
    </div>
  );
}

function DetailsSheet({
  open,
  onClose,
  estimate,
  recommended,
  habitText,
  onPlanTrip,
}: {
  open: boolean;
  onClose: () => void;
  estimate: TankEstimate;
  recommended: string | null;
  habitText: string;
  onPlanTrip: () => void;
}) {
  const { plans, deletePlan } = useData();
  const fillStyle = fillStyleSentence(estimate.habit);
  const scroller = useRef<HTMLDivElement>(null);

  /**
   * Start at the top.
   *
   * The sheet focuses its first button on open, and every button here is
   * inside the scroll area — so the browser helpfully scrolls it into view and
   * the first two rows, which are the ones people opened this for, end up
   * above the fold. Child effects run before the parent's, so resetting here
   * lands after that focus rather than before it.
   */
  useEffect(() => {
    if (open) scroller.current?.scrollTo({ top: 0 });
  }, [open]);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={<h2 className="text-[17px] font-bold text-ink">המיכל שלי</h2>}
    >
      <div
        ref={scroller}
        className="flex max-h-[62vh] flex-col gap-3 overflow-y-auto px-1 pb-1 text-[13.5px] text-ink/85"
      >
        <DetailRow
          label="אחרי התדלוק האחרון"
          value={
            estimate.lastRefuel?.level !== null && estimate.lastRefuel
              ? `${levelLabel(estimate.lastRefuel.level)} · ${dayMonthShort(estimate.lastRefuel.at)}`
              : "לא צוין"
          }
        />
        <DetailRow
          label="משוער עכשיו"
          value={estimate.current.level !== null ? levelLabel(estimate.current.level) : "לא ידוע"}
        />
        <DetailRow label="לפי ההרגל שלך" value={habitText} wrap />
        <DetailRow
          label="כדאי לתדלק עד"
          value={
            recommended
              ? `${recommended} · כשנשאר ${levelLabel(estimate.reserveLevel)}`
              : "אין מספיק מידע לתאריך"
          }
          wrap
        />
        {fillStyle ? <DetailRow label="כמות רגילה" value={fillStyle} wrap /> : null}
        <DetailRow
          label="מדידה אחרונה"
          value={
            estimate.lastLevelReport
              ? `${levelLabel(estimate.lastLevelReport.level)} · ${timeAgo(estimate.lastLevelReport.at)}`
              : "עדיין אין"
          }
        />

        <div className="flex flex-col gap-1.5 border-t border-line pt-3">
          <span className="text-[12.5px] font-semibold text-muted">על מה זה מבוסס</span>
          {estimate.reasons.map((reason) => (
            <span key={reason} className="text-[12.5px] leading-relaxed text-muted">
              · {REASON_TEXT[reason]}
            </span>
          ))}
          <span className="pt-1 text-[12px] leading-relaxed text-muted">
            הטווחים הם תרחישים סבירים, לא הבטחה. החישוב מניח נהיגה רגילה ושלא היו תדלוקים
            שלא נרשמו.
          </span>
        </div>

        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <span className="text-[12.5px] font-semibold text-muted">נסיעות מתוכננות</span>
          {plans.length === 0 ? (
            <span className="text-[12.5px] text-muted">אין נסיעות מתוכננות.</span>
          ) : (
            plans.map((plan) => (
              <div key={plan.id} className="flex items-center gap-2">
                <span className="flex-1 text-[12.5px]">
                  {dayMonthShort(plan.date)} · <Num>{num(plan.distanceKm, 0)}</Num> ק״מ
                  {plan.mode === "replaces" ? " (במקום הנסיעה הרגילה)" : ""}
                </span>
                <button
                  type="button"
                  onClick={() => void deletePlan(plan.id)}
                  className="min-h-[36px] px-2 text-[12.5px] font-semibold text-danger"
                >
                  מחיקה
                </button>
              </div>
            ))
          )}
          <button
            type="button"
            onClick={onPlanTrip}
            className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-pill border border-line text-[13px] font-semibold text-ink"
          >
            <CalendarIcon size={16} />
            יש לי נסיעה מתוכננת
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function DetailRow({
  label,
  value,
  wrap = false,
}: {
  label: string;
  value: string;
  wrap?: boolean;
}) {
  return (
    <div className={`flex gap-2 ${wrap ? "flex-col" : "items-baseline justify-between"}`}>
      <span className="flex-none text-[12.5px] font-semibold text-muted">{label}</span>
      <span className={wrap ? "text-[13px] leading-relaxed" : "text-[13px] font-semibold"}>
        {value}
      </span>
    </div>
  );
}

/** An odometer reading. No cost, no litres — it is not a fill-up. */
function OdometerSheet({
  open,
  onClose,
  estimate,
}: {
  open: boolean;
  onClose: () => void;
  estimate: TankEstimate;
}) {
  const { addObservation } = useData();
  const { showToast } = useToast();
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  const parsed = parseDecimal(value);
  const valid = Number.isFinite(parsed) && parsed > 0;
  const lastOdometer = estimate.lastOdometer;

  async function save() {
    if (!valid) return;
    setSaving(true);
    try {
      await addObservation({
        observedAt: Date.now(),
        kind: "odometer",
        odometer: parsed,
        // An odometer is a reading, and the user typed it.
        confirmed: true,
        phase: "standalone",
      });
      showToast({ tone: "success", title: "הקילומטראז׳ עודכן" });
      setValue("");
      onClose();
    } catch {
      showToast({ tone: "error", title: "העדכון נכשל", detail: "נסו שוב בעוד רגע" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={<h2 className="text-[17px] font-bold text-ink">עדכון קילומטראז׳</h2>}
    >
      <div className="flex flex-col gap-3 px-1">
        <Field
          big
          label="קילומטראז׳ נוכחי"
          inputMode="decimal"
          suffix="ק״מ"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="0"
          hint={
            lastOdometer ? (
              <>
                אחרון: <Num>{num(lastOdometer.value, 0)}</Num> · {timeAgo(lastOdometer.at)}
              </>
            ) : (
              "עדכון בלי תדלוק — לא נוצרת הוצאה ולא נרשמים ליטרים."
            )
          }
        />
        <Button full onClick={() => void save()} disabled={!valid} loading={saving}>
          שמירה
        </Button>
      </div>
    </Sheet>
  );
}

/** A gauge reading. Stored with the resolution of the control that produced it. */
function GaugeSheet({
  open,
  onClose,
  estimate,
}: {
  open: boolean;
  onClose: () => void;
  estimate: TankEstimate;
}) {
  const { addObservation } = useData();
  const { showToast } = useToast();
  const [level, setLevel] = useState<number | null>(null);
  const [odometer, setOdometer] = useState("");
  const [saving, setSaving] = useState(false);

  const parsedOdometer = parseDecimal(odometer);
  const hasOdometer = Number.isFinite(parsedOdometer) && parsedOdometer > 0;

  async function save() {
    if (level === null) return;
    setSaving(true);
    try {
      await addObservation({
        observedAt: Date.now(),
        kind: hasOdometer ? "both" : "level",
        odometer: hasOdometer ? parsedOdometer : null,
        level,
        // Coarse on purpose: dragging to "about a quarter" is not a
        // measurement of 0.250000 of anything.
        levelUncertainty: GAUGE_SD_BY_SOURCE["direct-gauge"],
        levelSource: "direct-gauge",
        confirmed: true,
        phase: "standalone",
      });
      showToast({ tone: "success", title: "מצב המיכל נשמר — התחזית תשתפר" });
      setLevel(null);
      setOdometer("");
      onClose();
    } catch {
      showToast({ tone: "error", title: "העדכון נכשל", detail: "נסו שוב בעוד רגע" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={<h2 className="text-[17px] font-bold text-ink">עדכון מד הדלק</h2>}
    >
      <div className="flex flex-col items-center gap-4 px-1">
        <TankGauge
          label="עכשיו"
          ariaLabel="כמה דלק יש עכשיו במיכל"
          level={level}
          onChange={setLevel}
          caption={
            estimate.capacityLiters && level !== null
              ? `כ־${Math.round(level * estimate.capacityLiters)} ליטר`
              : undefined
          }
        />
        <div className="w-full">
          <Field
            label="קילומטראז׳ (לא חובה)"
            inputMode="decimal"
            suffix="ק״מ"
            value={odometer}
            onChange={(event) => setOdometer(event.target.value)}
            placeholder="0"
          />
        </div>
        <Button full onClick={() => void save()} disabled={level === null} loading={saving}>
          שמירה
        </Button>
      </div>
    </Sheet>
  );
}

/**
 * A planned journey.
 *
 * It moves the forecast and nothing else. It never becomes measured distance or
 * consumed fuel, and a past plan that was never confirmed by an odometer stays
 * a plan.
 */
function TripSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { addPlan } = useData();
  const { showToast } = useToast();
  const [distance, setDistance] = useState("");
  const [buffer, setBuffer] = useState("");
  const [days, setDays] = useState(1);
  const [mode, setMode] = useState<"additional" | "replaces">("additional");
  const [saving, setSaving] = useState(false);

  const parsed = parseDecimal(distance);
  const valid = Number.isFinite(parsed) && parsed > 0;

  async function save() {
    if (!valid) return;
    setSaving(true);
    try {
      const parsedBuffer = parseDecimal(buffer);
      await addPlan({
        date: Date.now() + days * 86_400_000,
        distanceKm: parsed,
        mode,
        bufferKm: Number.isFinite(parsedBuffer) && parsedBuffer > 0 ? parsedBuffer : null,
      });
      showToast({ tone: "success", title: "הנסיעה נשמרה בתחזית" });
      setDistance("");
      setBuffer("");
      onClose();
    } catch {
      showToast({ tone: "error", title: "השמירה נכשלה" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={<h2 className="text-[17px] font-bold text-ink">נסיעה מתוכננת</h2>}
    >
      <div className="flex flex-col gap-3 px-1">
        <Field
          big
          label="מרחק צפוי"
          inputMode="decimal"
          suffix="ק״מ"
          value={distance}
          onChange={(event) => setDistance(event.target.value)}
          placeholder="0"
        />
        <Field
          label="מרווח ביטחון (לא חובה)"
          inputMode="decimal"
          suffix="ק״מ"
          value={buffer}
          onChange={(event) => setBuffer(event.target.value)}
          placeholder="0"
        />

        <div className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-semibold text-muted">מתי</span>
          <div className="flex gap-2">
            {[
              { value: 0, label: "היום" },
              { value: 1, label: "מחר" },
              { value: 3, label: "בעוד 3 ימים" },
              { value: 7, label: "בעוד שבוע" },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={days === option.value}
                onClick={() => setDays(option.value)}
                className={`min-h-[40px] flex-1 rounded-pill px-2 text-[12.5px] font-semibold ${
                  days === option.value
                    ? "bg-accent-soft text-accent"
                    : "border border-line text-muted"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/* Additional or instead-of: without this the commute the trip replaces
            would be counted twice. */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-semibold text-muted">הנסיעה היא</span>
          <div className="flex gap-2">
            <ModeButton
              active={mode === "additional"}
              onClick={() => setMode("additional")}
              label="בנוסף לנהיגה הרגילה"
            />
            <ModeButton
              active={mode === "replaces"}
              onClick={() => setMode("replaces")}
              label="במקום הנהיגה הרגילה"
            />
          </div>
        </div>

        <p className="text-[12px] leading-relaxed text-muted">
          הנסיעה משפיעה על התחזית בלבד. היא לא נרשמת כקילומטראז׳ ולא כדלק שנצרך.
        </p>

        <Button full onClick={() => void save()} disabled={!valid} loading={saving}>
          שמירה
        </Button>
      </div>
    </Sheet>
  );
}

function ModeButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-[44px] flex-1 rounded-[12px] px-3 text-[12.5px] font-semibold ${
        active ? "bg-accent-soft text-accent" : "border border-line text-muted"
      }`}
    >
      {label}
    </button>
  );
}
