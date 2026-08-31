import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../context/DataContext";
import { useTheme } from "../context/ThemeContext";
import { useToast } from "../context/ToastContext";
import { Card, IconTile, Label } from "../components/Card";
import { Segmented } from "../components/Segmented";
import { RowButton } from "../components/Button";
import { Sheet } from "../components/Sheet";
import { Num } from "../components/Num";
import {
  CarIcon,
  CheckIcon,
  ChevronStart,
  DeviceIcon,
  DownloadIcon,
  MoonIcon,
  PaletteIcon,
  PlusIcon,
  SunIcon,
  UserIcon,
} from "../components/icons";
import {
  FUEL_TYPE_SHORT,
  dayMonthShort,
  parseDecimal,
  price,
  shekelSigned,
  vehicleLabel,
} from "../lib/format";
import { downloadFillupsCsv } from "../lib/csv";
import type { ThemeSetting, Units } from "../lib/types";

const THEME_OPTIONS: { value: ThemeSetting; label: string; icon: React.ReactNode }[] = [
  { value: "system", label: "לפי המכשיר", icon: <DeviceIcon size={15} /> },
  { value: "light", label: "בהיר", icon: <SunIcon size={15} /> },
  { value: "dark", label: "כהה", icon: <MoonIcon size={15} /> },
];

const UNIT_OPTIONS: { value: Units; label: string }[] = [
  { value: "kmPerLiter", label: "קמ״ל" },
  { value: "litersPer100", label: "ל׳/100 ק״מ" },
];

/** Settings (designs 18 / 24). */
export function Settings() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { theme, setTheme, accent, accentId, accents, setAccent } = useTheme();
  const {
    settings,
    updateSettings,
    activeVehicles,
    activeVehicle,
    setActiveVehicle,
    updateVehicle,
    prices,
    fillups,
  } = useData();

  const [accentSheetOpen, setAccentSheetOpen] = useState(false);
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  const [manualPriceOpen, setManualPriceOpen] = useState(false);

  return (
    <main className="flex flex-1 flex-col gap-4 pb-[104px] pt-safe">
      <header className="flex-none px-5 pb-1 pt-4">
        <h1 className="text-[22px] font-bold text-ink">הגדרות</h1>
      </header>

      <div className="flex flex-col gap-4 px-5">
        {/* Vehicles */}
        <section className="flex flex-col gap-2">
          <Label>רכבים</Label>
          <Card className="overflow-hidden">
            {activeVehicles.map((vehicle, index) => (
              <button
                key={vehicle.id}
                type="button"
                onClick={() => void setActiveVehicle(vehicle.id)}
                className={`flex min-h-[58px] w-full items-center gap-3 px-4 py-3 text-start active:bg-surface-2 ${
                  index > 0 ? "border-t border-line" : ""
                }`}
              >
                <IconTile tone={vehicle.id === activeVehicle?.id ? "accent" : "muted"}>
                  <CarIcon size={18} />
                </IconTile>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[15px] font-semibold text-ink">
                    {vehicleLabel(vehicle)}
                  </span>
                  <span className="text-[12.5px] text-muted">
                    {FUEL_TYPE_SHORT[vehicle.fuelType]}
                  </span>
                </span>
                {vehicle.id === activeVehicle?.id ? (
                  <span className="flex-none rounded-pill bg-accent-soft px-2.5 py-1 text-[12px] font-semibold text-accent">
                    פעיל
                  </span>
                ) : null}
              </button>
            ))}

            <RowButton
              icon={
                <IconTile tone="muted">
                  <PlusIcon size={18} />
                </IconTile>
              }
              title={<span className="text-accent">הוספת רכב</span>}
              onClick={() => navigate("/vehicles/new")}
            />
            <RowButton
              icon={
                <IconTile tone="muted">
                  <ChevronStart size={18} />
                </IconTile>
              }
              title="ניהול רכבים וארכיון"
              onClick={() => navigate("/settings/vehicles")}
            />
          </Card>
        </section>

        {/* Fuel price */}
        <section className="flex flex-col gap-2">
          <Label>מחיר דלק</Label>
          <Card className="overflow-hidden">
            <div className="flex min-h-[58px] items-center gap-3 px-4 py-3">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[15px] font-semibold text-ink">מחיר רשמי נוכחי</span>
                <span className="truncate text-[12.5px] text-muted">
                  בנזין 95 ·{" "}
                  {prices?.current?.updatedAt
                    ? `עודכן ${dayMonthShort(prices.current.updatedAt)}`
                    : "טרם עודכן"}
                </span>
              </span>
              <Num className="flex-none text-[17px] font-bold text-ink">
                {prices?.current ? price(prices.current.pricePerLiter) : "—"}
              </Num>
            </div>

            <RowButton
              title="התאמה אישית"
              subtitle="הנחה קבועה בתחנה שלכם"
              trailing={
                <Num className="text-[15px] font-bold text-ink">
                  {shekelSigned(activeVehicle?.priceAdjustment ?? 0)}
                </Num>
              }
              onClick={() => setAdjustmentOpen(true)}
              disabled={!activeVehicle}
            />

            <RowButton
              title="עדכון ידני"
              subtitle="עקיפת המחיר האוטומטי"
              trailing={
                <Num className="text-[15px] font-bold text-ink">
                  {activeVehicle?.manualPricePerLiter
                    ? price(activeVehicle.manualPricePerLiter)
                    : "כבוי"}
                </Num>
              }
              onClick={() => setManualPriceOpen(true)}
              disabled={!activeVehicle}
            />
          </Card>
        </section>

        {/* Appearance */}
        <section className="flex flex-col gap-2">
          <Label>מראה</Label>
          <Card className="flex flex-col gap-4 p-4">
            <div className="flex flex-col gap-2">
              <span className="text-[14px] font-semibold text-ink">ערכת נושא</span>
              <Segmented
                value={theme}
                options={THEME_OPTIONS}
                onChange={(value) => {
                  setTheme(value);
                  void updateSettings({ theme: value });
                }}
                ariaLabel="ערכת נושא"
              />
            </div>

            <button
              type="button"
              onClick={() => setAccentSheetOpen(true)}
              className="flex min-h-[48px] items-center gap-3 text-start"
            >
              <IconTile>
                <PaletteIcon size={18} />
              </IconTile>
              <span className="flex flex-1 flex-col gap-0.5">
                <span className="text-[14px] font-semibold text-ink">צבע הדגשה</span>
                <span className="text-[12.5px] text-muted">{accent.label}</span>
              </span>
              <span
                className="size-7 flex-none rounded-full border border-line"
                style={{ background: "var(--accent)" }}
              />
            </button>
          </Card>
        </section>

        {/* Units */}
        <section className="flex flex-col gap-2">
          <Label>יחידות</Label>
          <Card className="flex flex-col gap-2 p-4">
            <span className="text-[14px] font-semibold text-ink">יחידת צריכה</span>
            <Segmented
              value={settings.units}
              options={UNIT_OPTIONS}
              onChange={(value) => void updateSettings({ units: value })}
              ariaLabel="יחידת צריכה"
            />
          </Card>
        </section>

        {/* Data & account */}
        <section className="flex flex-col gap-2">
          <Label>נתונים וחשבון</Label>
          <Card className="overflow-hidden">
            <RowButton
              icon={
                <IconTile tone="muted">
                  <DownloadIcon size={18} />
                </IconTile>
              }
              title="ייצוא הנתונים שלי"
              subtitle="קובץ CSV עם כל התדלוקים"
              onClick={() => {
                if (fillups.length === 0) {
                  showToast({ tone: "info", title: "אין עדיין תדלוקים לייצוא" });
                  return;
                }
                downloadFillupsCsv(fillups, activeVehicle);
                showToast({ tone: "success", title: "הקובץ הורד" });
              }}
            />
            <RowButton
              icon={
                <IconTile tone="muted">
                  <UserIcon size={18} />
                </IconTile>
              }
              title="פרופיל וחשבון"
              onClick={() => navigate("/settings/profile")}
            />
          </Card>
        </section>

        <p className="pb-2 text-center text-[12px] text-muted/70">
          טנק מלא · גרסה <Num>1.0.0</Num>
        </p>
      </div>

      {/* Accent picker */}
      <Sheet
        open={accentSheetOpen}
        onClose={() => setAccentSheetOpen(false)}
        title={<h2 className="text-[17px] font-bold text-ink">צבע הדגשה</h2>}
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-4 gap-3">
            {accents.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  setAccent(option.id);
                  void updateSettings({ accentColor: option.id });
                }}
                className="flex flex-col items-center gap-1.5"
              >
                <span
                  className="flex size-12 items-center justify-center rounded-full border-2 transition-transform active:scale-95"
                  style={{
                    background: option.light,
                    borderColor: accentId === option.id ? "var(--ink)" : "transparent",
                  }}
                >
                  {accentId === option.id ? (
                    <CheckIcon size={20} className="text-white" />
                  ) : null}
                </span>
                <span className="text-center text-[11px] leading-tight text-muted">
                  {option.label}
                </span>
              </button>
            ))}
          </div>

          <label className="flex min-h-[52px] items-center gap-3 rounded-[14px] bg-surface-2 px-4">
            <span className="flex-1 text-[14px] font-semibold text-ink">צבע מותאם אישית</span>
            <input
              type="color"
              aria-label="צבע מותאם אישית"
              defaultValue={accent.light}
              onChange={(event) => {
                setAccent("custom", event.target.value);
                void updateSettings({
                  accentColor: "custom",
                  customAccent: event.target.value,
                });
              }}
              className="size-9 cursor-pointer rounded-full border border-line bg-transparent"
            />
          </label>
        </div>
      </Sheet>

      {/* Per-vehicle price adjustment */}
      <NumberSheet
        open={adjustmentOpen}
        onClose={() => setAdjustmentOpen(false)}
        title="התאמה אישית למחיר"
        description="הפרש קבוע בשקלים לליטר מול המחיר הרשמי. הנחה מוזנת כמספר שלילי, למשל 0.05-."
        suffix="₪ לליטר"
        initial={String(activeVehicle?.priceAdjustment ?? 0)}
        allowNegative
        onSave={(value) => {
          if (activeVehicle) void updateVehicle(activeVehicle.id, { priceAdjustment: value });
        }}
      />

      {/* Per-vehicle manual override */}
      <NumberSheet
        open={manualPriceOpen}
        onClose={() => setManualPriceOpen(false)}
        title="עדכון מחיר ידני"
        description="מחיר קבוע לליטר שיעקוף את המחיר הרשמי ואת ההתאמה האישית. נדרש לסולר ולבנזין 98."
        suffix="₪ לליטר"
        initial={
          activeVehicle?.manualPricePerLiter ? String(activeVehicle.manualPricePerLiter) : ""
        }
        clearable
        onSave={(value) => {
          if (activeVehicle) {
            void updateVehicle(activeVehicle.id, {
              manualPricePerLiter: value > 0 ? value : null,
            });
          }
        }}
      />
    </main>
  );
}

function NumberSheet({
  open,
  onClose,
  title,
  description,
  suffix,
  initial,
  allowNegative = false,
  clearable = false,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  suffix: string;
  initial: string;
  allowNegative?: boolean;
  clearable?: boolean;
  onSave: (value: number) => void;
}) {
  const [value, setValue] = useState(initial);

  // Re-seed the field each time the sheet opens.
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) setValue(initial);
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={<h2 className="text-[17px] font-bold text-ink">{title}</h2>}
    >
      <div className="flex flex-col gap-3">
        <p className="text-[13px] leading-relaxed text-muted">{description}</p>

        <div className="flex items-center gap-2.5 rounded-[14px] border border-line bg-surface px-3.5">
          <input
            dir="ltr"
            inputMode="decimal"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="0"
            className="num min-h-[56px] min-w-0 flex-1 bg-transparent text-[22px] font-bold outline-none"
          />
          <span className="flex-none text-[13px] font-semibold text-muted">{suffix}</span>
        </div>

        <div className="flex gap-2">
          {clearable ? (
            <button
              type="button"
              onClick={() => {
                onSave(0);
                onClose();
              }}
              className="min-h-[50px] flex-1 rounded-pill bg-surface-2 text-[15px] font-semibold text-muted"
            >
              כיבוי
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              const parsed = parseDecimal(value);
              if (Number.isFinite(parsed) && (allowNegative || parsed >= 0)) onSave(parsed);
              onClose();
            }}
            className="min-h-[50px] flex-1 rounded-pill bg-accent text-[15px] font-bold text-accent-contrast"
          >
            שמירה
          </button>
        </div>
      </div>
    </Sheet>
  );
}
