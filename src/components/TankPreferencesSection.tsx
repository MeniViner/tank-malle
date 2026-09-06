import { useState } from "react";
import { useData } from "../context/DataContext";
import { useToast } from "../context/ToastContext";
import { useTankEstimate } from "../hooks/useTankEstimate";
import { Card, IconTile, Label } from "./Card";
import { RowButton } from "./Button";
import { Sheet, ConfirmDialog } from "./Sheet";
import { Toggle } from "./Segmented";
import { TankGauge } from "./TankGauge";
import { GaugeIcon, RestoreIcon } from "./icons";
import { levelLabel } from "../lib/tank/gaugeInteraction";

/**
 * Tank preferences.
 *
 * Three separate things, kept separate on purpose:
 *
 *   the RESERVE — a safety policy the user sets, which learning never touches;
 *   the HABIT — learned automatically, and the point of the feature;
 *   an OVERRIDE — a preference that replaces the learned habit when the user
 *   would rather decide for themselves.
 *
 * Automatic learning is the default. Turning the override on is a choice, and
 * turning it back off returns to learning without losing anything.
 */
export function TankPreferencesSection() {
  const { activeVehicle, tankPreferences, updateTankPreferences } = useData();
  const { showToast } = useToast();
  const { estimate } = useTankEstimate();

  const [reserveOpen, setReserveOpen] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  if (!activeVehicle || !estimate.available) return null;

  const overridden = tankPreferences.refuelLevelOverride !== null;
  const habit = estimate.habit;

  return (
    <section className="flex flex-col gap-2">
      <Label>מעקב מיכל</Label>
      <Card className="overflow-hidden">
        <RowButton
          icon={
            <IconTile tone="muted">
              <GaugeIcon size={18} />
            </IconTile>
          }
          title="רזרבה — מתי להתריע"
          subtitle={`המלצה לתדלק כשנשאר ${levelLabel(tankPreferences.reserveFraction)}`}
          trailing={
            <span className="text-[13.5px] font-semibold text-accent">שינוי</span>
          }
          onClick={() => setReserveOpen(true)}
        />

        <div className="flex items-center gap-2 p-4 pe-3">
          <span className="flex flex-1 flex-col gap-0.5">
            <span className="text-[15px] font-semibold text-ink">
              התאמה אישית אוטומטית
            </span>
            <span className="text-[12.5px] leading-relaxed text-muted">
              {overridden
                ? `כרגע מוגדר ידנית: ${levelLabel(tankPreferences.refuelLevelOverride ?? 0)}`
                : habit.canClaim
                  ? `נלמד מהתדלוקים שלך: ${levelLabel(habit.typicalLevel)}`
                  : "עדיין נלמד. עד אז משתמשים בברירת מחדל."}
            </span>
          </span>
          <Toggle
            checked={!overridden}
            ariaLabel="התאמה אישית אוטומטית"
            onChange={(automatic) => {
              if (automatic) {
                void updateTankPreferences({ refuelLevelOverride: null });
              } else {
                setOverrideOpen(true);
              }
            }}
          />
        </div>

        <RowButton
          icon={
            <IconTile tone="muted">
              <RestoreIcon size={18} />
            </IconTile>
          }
          title="איפוס פרופיל ההרגלים"
          subtitle="התדלוקים נשמרים — רק הלמידה מתחילה מחדש"
          onClick={() => setConfirmReset(true)}
        />
      </Card>

      {/* Mounted only while open, so the gauge always starts from the stored
          value rather than from whatever was last dragged and abandoned. */}
      {reserveOpen ? (
      <LevelSheet
        onClose={() => setReserveOpen(false)}
        title="רזרבה"
        description="הרמה שממנה כדאי כבר לתדלק. זו העדפה אישית לנוחות — לא נפח הרזרבה של היצרן ולא נורית הדלק."
        initial={tankPreferences.reserveFraction}
        onSave={(level) => {
          void updateTankPreferences({ reserveFraction: level });
          showToast({ tone: "success", title: "הרזרבה עודכנה" });
        }}
      />
      ) : null}

      {overrideOpen ? (
      <LevelSheet
        onClose={() => setOverrideOpen(false)}
        title="רמת תדלוק מועדפת"
        description="קביעה ידנית מחליפה את הלמידה האוטומטית. אפשר לחזור ללמידה בכל רגע."
        initial={tankPreferences.refuelLevelOverride ?? habit.typicalLevel}
        onSave={(level) => {
          void updateTankPreferences({ refuelLevelOverride: level });
          showToast({ tone: "success", title: "ההעדפה נשמרה" });
        }}
      />
      ) : null}

      <ConfirmDialog
        open={confirmReset}
        tone="accent"
        title="לאפס את פרופיל ההרגלים?"
        body="הלמידה של מתי אתם נוהגים לתדלק תתחיל מחדש. אף תדלוק לא יימחק, וההוצאות והצריכה לא ישתנו."
        confirmLabel="איפוס"
        onConfirm={() => {
          setConfirmReset(false);
          void updateTankPreferences({ habitResetAt: Date.now() });
          showToast({ tone: "success", title: "פרופיל ההרגלים אופס" });
        }}
        onCancel={() => setConfirmReset(false)}
      />
    </section>
  );
}

/** Picking a level with the same gauge the rest of the feature uses. */
function LevelSheet({
  onClose,
  title,
  description,
  initial,
  onSave,
}: {
  onClose: () => void;
  title: string;
  description: string;
  initial: number;
  onSave: (level: number) => void;
}) {
  const [level, setLevel] = useState(initial);

  return (
    <Sheet
      open
      onClose={onClose}
      title={<h2 className="text-[17px] font-bold text-ink">{title}</h2>}
    >
      <div className="flex flex-col items-center gap-4 px-1">
        <p className="text-[13px] leading-relaxed text-muted">{description}</p>
        <TankGauge label={title} ariaLabel={title} level={level} onChange={setLevel} />
        <button
          type="button"
          onClick={() => {
            onSave(level);
            onClose();
          }}
          className="min-h-[52px] w-full rounded-pill bg-accent text-[16px] font-bold text-accent-contrast transition-[filter,scale] duration-200 active:scale-[0.97]"
        >
          שמירה
        </button>
      </div>
    </Sheet>
  );
}
