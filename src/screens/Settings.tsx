import { FuelDiscountSheet } from '../components/FuelDiscountSheet';
import { vehicleDiscount, discountLabel } from '../lib/prices/discount';
import { useMemo, useState } from "react";
import { describeOfficialPrice, officialPriceFor } from "../lib/prices/regulated";
import { useNavigate } from "react-router-dom";
import { useData } from "../context/DataContext";
import { useTheme } from "../context/ThemeContext";
import { useToast } from "../context/ToastContext";
import { Card, IconTile, Label, ListCard, Skeleton } from "../components/Card";
import { Toggle } from "../components/Segmented";
import { ChoiceList } from "../components/ChoiceList";
import { RowButton } from "../components/Button";
import { Sheet } from "../components/Sheet";
import { Avatar } from "../components/Avatar";
import { InfoTip } from "../components/InfoTip";
import { Num } from "../components/Num";
import {
  CarIcon,
  CheckIcon,
  ChevronStart,
  DeviceIcon,
  MoonIcon,
  PaletteIcon,
  CopyIcon,
  MessageIcon,
  PhoneIcon,
  PlusIcon,
  ShareIcon,
  ShieldIcon,
  SunIcon,
} from "../components/icons";
import { useAuth } from "../context/AuthContext";
import { useInstallPrompt } from "../hooks/useInstallPrompt";
import {
  FUEL_TYPE_SHORT,
  dayMonthShort,
  price,
  vehicleLabel,
} from "../lib/format";
import { TankPreferencesSection } from "../components/TankPreferencesSection";
import {
  APP_SHARE_URL,
  browserShareDeps,
  buildSharePayload,
  shareApp,
} from "../lib/share";
import { APP_VERSION } from "../lib/version";
import type { ThemeSetting, Units } from "../lib/types";

const THEME_OPTIONS: { value: ThemeSetting; label: string; icon: React.ReactNode }[] = [
  // "לפי המכשיר" wrapped onto two lines inside a third of a 360px screen.
  { value: "system", label: "אוטומטי", icon: <DeviceIcon size={15} /> },
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
  const { user, isAdmin } = useAuth();
  const { theme, setTheme, accent, accentId, accents, setAccent } = useTheme();
  const {
    settings,
    updateSettings,
    activeVehicles,
    activeVehicle,
    setActiveVehicle,
    prices,
    ready,
    benchmarkWithdrawal,
    retryBenchmarkWithdrawal,
  } = useData();

  // The official figure for THIS vehicle's fuel type, today — the same
  // resolver the fill-up form and the home card use.
  const [today] = useState(() => Date.now());
  const officialToday = useMemo(
    () => officialPriceFor(prices, activeVehicle?.fuelType ?? "95", today),
    [prices, activeVehicle?.fuelType, today],
  );

  const [themeOpen, setThemeOpen] = useState(false);
  const [unitsOpen, setUnitsOpen] = useState(false);
  const [accentSheetOpen, setAccentSheetOpen] = useState(false);
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);

  return (
    <main className="flex flex-1 flex-col gap-5 pb-[104px] pt-safe">
      <header className="px-5 pb-1 pt-5">
        <h1 className="font-display text-[30px] font-bold leading-[1.15] text-ink">הגדרות</h1>
      </header>
      <div className="flex flex-col gap-6 px-5">
        <ListCard>
          <button type="button" onClick={() => navigate("/settings/profile")} className="flex min-h-[76px] w-full items-center gap-3 px-4 py-3 text-start active:bg-surface-2">
            <Avatar name={user?.displayName} photoURL={user?.photoURL} size={42} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[17px] font-bold text-ink">{user?.displayName ?? "פרופיל וחשבון"}</span>
              <span dir="ltr" className="truncate text-start text-[13px] text-muted">{user?.email}</span>
            </span>
            <ChevronStart size={17} className="text-muted" />
          </button>
          {isAdmin ? <RowButton icon={<ShieldIcon size={19} className="text-muted" />} title="לוח בקרה" subtitle="משתמשים, מחירי דלק ומשוב" trailing={<ChevronStart size={17} className="text-muted" />} onClick={() => navigate("/admin")} /> : null}
        </ListCard>
        <section className="flex flex-col gap-2">
          <Label>רכב</Label>
          <ListCard>
            {!ready && !activeVehicles.length ? <div className="p-4"><Skeleton className="h-9 w-full" /></div> : null}
            {activeVehicles.length > 1 ? activeVehicles.map((vehicle) => (
              <RowButton key={vehicle.id} icon={<CarIcon size={18} className="text-muted" />} title={vehicleLabel(vehicle)} value={vehicle.id === activeVehicle?.id ? "פעיל" : FUEL_TYPE_SHORT[vehicle.fuelType]} onClick={() => void setActiveVehicle(vehicle.id)} />
            )) : null}
            <RowButton icon={<CarIcon size={19} className="text-muted" />} title="תחזוקת הרכב והוצאות" onClick={() => navigate("/vehicle")} />
            <RowButton icon={<CarIcon size={19} className="text-muted" />} title="רכבים וארכיון" value={activeVehicle ? vehicleLabel(activeVehicle) : undefined} trailing={<ChevronStart size={17} className="text-muted" />} onClick={() => navigate("/settings/vehicles")} />
            <RowButton icon={<PlusIcon size={19} className="text-muted" />} title="הוספת רכב" onClick={() => navigate("/vehicles/new")} />
            <TankPreferencesSection embedded />
          </ListCard>
        </section>
        {/* Fuel price */}
        <section className="flex flex-col gap-2">
          <Label>מחיר דלק</Label>
          <ListCard>
            {/* The same resolver the fill-up form uses, for THIS vehicle's
                fuel type and today — so the two screens cannot disagree, and a
                manual admin entry is named as such rather than as "מפוקח". */}
            <div className="flex min-h-[58px] items-center gap-3 px-4 py-3">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[15px] font-semibold text-ink">מחיר רשמי נוכחי</span>
                <span className="truncate text-[14px] text-muted">
                  {FUEL_TYPE_SHORT[activeVehicle?.fuelType ?? "95"]} ·{" "}
                  {officialToday.price === null
                    ? "אין מחיר רשמי לסוג דלק זה"
                    : `${describeOfficialPrice(officialToday)}${
                        officialToday.updatedAt
                          ? ` · עודכן ${dayMonthShort(officialToday.updatedAt)}`
                          : ""
                      }`}
                </span>
              </span>
              <Num className="flex-none text-[18px] font-semibold text-ink">
                {officialToday.price !== null ? price(officialToday.price) : "—"}
              </Num>
            </div>

            {activeVehicle?.fuelType === '95' ? <RowButton
              title="הנחה מהמחיר הרשמי"
              value={discountLabel(vehicleDiscount(activeVehicle))}
              trailing={<ChevronStart size={17} className="text-muted" />}
              onClick={() => setAdjustmentOpen(true)}
            /> : <p className="px-4 pb-4 text-[14px] text-muted">לסוג הדלק הזה מזינים את מחיר המשאבה בכל תדלוק.</p>}
          </ListCard>
        </section>

        <section className="flex flex-col gap-2">
          <Label>תצוגה</Label>
          <ListCard>
            <RowButton icon={<DeviceIcon size={19} className="text-muted" />} title="ערכת נושא" value={THEME_OPTIONS.find((option) => option.value === theme)?.label} trailing={<ChevronStart size={17} className="text-muted" />} onClick={() => setThemeOpen(true)} />
            <RowButton icon={<PaletteIcon size={19} className="text-muted" />} title="צבע הדגשה" value={accent.label} trailing={<span className="size-4 flex-none rounded-full" style={{ background: "var(--accent)" }} />} onClick={() => setAccentSheetOpen(true)} />
            <RowButton title="יחידת צריכה" value={UNIT_OPTIONS.find((option) => option.value === settings.units)?.label} trailing={<ChevronStart size={17} className="text-muted" />} onClick={() => setUnitsOpen(true)} />
          </ListCard>
        </section>
        {/* Peer comparison — optional comparison sharing, opt-out at any time. */}
        <section className="flex flex-col gap-2">
          <Label>קהילה</Label>
          <Card className="flex items-center gap-2 p-4 pe-3">
            <span className="flex flex-1 flex-col gap-0.5">
              <span className="flex items-center gap-0.5">
                <span className="text-[15px] font-semibold text-ink">שיתוף נתוני השוואה</span>
                <InfoTip label="שיתוף נתוני השוואה">
                  <p>השוואת הצריכה שלכם לנהגים עם רכב דומה.</p>
                  <span>
                    <b className="text-ink">משותף:</b> דגם ושנה, סוג דלק, ממוצע צריכה.
                  </span>
                  <span>
                    <b className="text-ink">לא משותף:</b> שם, מייל, מספר רישוי,
                    קילומטראז׳, תאריכים, תחנה ומיקום.
                  </span>
                </InfoTip>
              </span>
            </span>
            <Toggle
              checked={settings.shareBenchmarks !== false}
              onChange={(next) => void updateSettings({ shareBenchmarks: next }).catch(() => showToast({ tone: "error", title: "שינוי השיתוף לא נשמר", detail: "בדקו את החיבור ונסו שוב" }))}
              ariaLabel="שיתוף נתוני השוואה"
            />
          </Card>
          {settings.shareBenchmarks === false ? (
            <p role="status" className="px-2 text-[13px] leading-relaxed text-muted">
              {benchmarkWithdrawal === "done" ? "השיתוף כבוי. נתוני ההשוואה שלכם הוסרו מהשרת."
                : benchmarkWithdrawal === "error" ? "הסרת נתוני ההשוואה עדיין לא אושרה. נדרש חיבור לשרת."
                : "ממתינים לאישור הסרת נתוני ההשוואה מהשרת…"}
              {benchmarkWithdrawal === "error" ? <button type="button" className="min-h-10 px-2 font-bold text-primary underline" onClick={retryBenchmarkWithdrawal}>ניסיון חוזר</button> : null}
            </p>
          ) : null}
        </section>

        <section className="flex flex-col gap-2">
          <Label>אודות</Label>
          <ListCard>
            <RowButton icon={<MessageIcon size={19} className="text-muted" />} title="שליחת משוב" trailing={<ChevronStart size={17} className="text-muted" />} onClick={() => navigate("/feedback")} />
            <ShareSection />
            <InstallSection />
            <RowButton title="תנאי שימוש" trailing={<ChevronStart size={17} className="text-muted" />} onClick={() => navigate("/legal/terms")} />
            <RowButton title="מדיניות פרטיות" trailing={<ChevronStart size={17} className="text-muted" />} onClick={() => navigate("/legal/privacy")} />
          </ListCard>
          <p className="py-2 text-center text-[12px] text-muted">טנק מלא · גרסה <Num>{APP_VERSION}</Num></p>
        </section>
      </div>
      <Sheet open={themeOpen} onClose={() => setThemeOpen(false)} title={<h2 className="text-[18px] font-bold">ערכת נושא</h2>}>
        <ChoiceList value={theme} options={THEME_OPTIONS} ariaLabel="ערכת נושא" onChange={(value) => { setTheme(value); void updateSettings({ theme: value }); }} />
      </Sheet>
      <Sheet open={unitsOpen} onClose={() => setUnitsOpen(false)} title={<h2 className="text-[18px] font-bold">יחידת צריכה</h2>}>
        <ChoiceList value={settings.units} options={UNIT_OPTIONS} ariaLabel="יחידת צריכה" onChange={(value) => void updateSettings({ units: value })} />
      </Sheet>

      {/* Accent picker */}
      <Sheet
        open={accentSheetOpen}
        onClose={() => setAccentSheetOpen(false)}
        title={<h2 className="text-[18px] font-semibold text-ink">צבע הדגשה</h2>}
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
                className="flex flex-col items-center gap-1.5 transition-transform duration-200 active:scale-[0.96]"
              >
                <span
                  className="flex size-12 items-center justify-center rounded-full border-2 transition-[border-color] duration-200"
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

      {adjustmentOpen && activeVehicle ? <FuelDiscountSheet
        key={activeVehicle.id} vehicle={activeVehicle} official={officialToday.price}
        onClose={() => setAdjustmentOpen(false)} /> : null}
    </main>
  );
}

/**
 * Sharing the app.
 *
 * What leaves the device is the product name, a one-line description and the
 * canonical root URL — never the current route, which is usually a fill-up id,
 * and never the vehicle, the statistics or the account. A dismissed share sheet
 * is somebody changing their mind, so it says nothing at all.
 */
function ShareSection() {
  const { showToast } = useToast();
  const [manualOpen, setManualOpen] = useState(false);

  async function share() {
    const outcome = await shareApp(browserShareDeps());
    if (outcome === "copied") showToast({ tone: "success", title: "הקישור הועתק" });
    else if (outcome === "manual") setManualOpen(true);
    // "shared" needs no toast — the platform already showed one — and
    // "cancelled" is not a failure.
  }

  return (
    <>
        <RowButton
          icon={
            <IconTile>
              <ShareIcon size={18} />
            </IconTile>
          }
          title="שיתוף האפליקציה"
          trailing={<ChevronStart size={17} className="text-muted" />}
          onClick={() => void share()}
        />

      <Sheet
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        title={<h2 className="text-[18px] font-semibold text-ink">שיתוף האפליקציה</h2>}
      >
        <div className="flex flex-col gap-3 px-1">
          <p className="text-[14px] leading-relaxed text-ink/85">
            {buildSharePayload().text}
          </p>
          <div className="flex items-center gap-2 rounded-[14px] border border-line bg-bg px-3.5 py-3">
            <span dir="ltr" className="num min-w-0 flex-1 truncate text-[14px] text-ink">
              {APP_SHARE_URL}
            </span>
            <button
              type="button"
              aria-label="העתקת הקישור"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(APP_SHARE_URL)
                  .then(() => showToast({ tone: "success", title: "הקישור הועתק" }))
                  .catch(() => undefined);
              }}
              className="flex size-10 flex-none items-center justify-center rounded-full text-accent"
            >
              <CopyIcon size={18} />
            </button>
          </div>
          <p className="text-[12px] text-muted">
            הקישור הוא לעמוד הראשי בלבד — הוא לא כולל את הנתונים או הרכב שלך.
          </p>
        </div>
      </Sheet>
    </>
  );
}

/**
 * Installing the app onto the device.
 *
 * Three honest states: already installed (a plain confirmation, no button),
 * a real deferred prompt (a button that opens it), or a browser with no
 * install API — where the only useful thing is the actual gesture, so that is
 * what it says instead of a button that would silently do nothing.
 */
function InstallSection() {
  const { state, install } = useInstallPrompt();
  const { showToast } = useToast();

  const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

  return (
    <>
        <RowButton
          icon={
            <IconTile>
              <PhoneIcon size={18} />
            </IconTile>
          }
          title={state === "installed" ? "האפליקציה מותקנת" : "התקנת האפליקציה"}
          subtitle={
            state === "installed"
              ? "פועלת מהמסך הראשי, בלי דפדפן"
              : state === "available"
                ? "אייקון במגירת היישומים, פתיחה במסך מלא"
                : iOS
                  ? "בספארי: שיתוף ← הוספה למסך הבית"
                  : "בתפריט הדפדפן: התקנת אפליקציה"
          }
          disabled={state !== "available"}
          trailing={
            state === "installed" ? (
              <CheckIcon size={18} className="text-accent" />
            ) : state === "available" ? (
              <ChevronStart size={17} className="text-muted" />
            ) : null
          }
          onClick={() => {
            void install().then((accepted) => {
              if (accepted) showToast({ tone: "success", title: "האפליקציה הותקנה" });
            });
          }}
        />
    </>
  );
}
