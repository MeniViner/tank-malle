import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useData } from "../../context/DataContext";
import { useTheme } from "../../context/ThemeContext";
import { useToast } from "../../context/ToastContext";
import type { ThemeSetting, Units, UserSettings } from "../../lib/types";
import { notificationPreferences } from "../../lib/vehicle/notificationPreferences";
import { ChoiceList } from "../ChoiceList";
import { GroupRow } from "../DesignPrimitives";
import { NumericText } from "../Fmt";
import { BellIcon, CameraIcon, CheckIcon, GaugeIcon, InfoIcon, MoonIcon, PaletteIcon, SlidersIcon, UsersIcon } from "../icons";
import { NotificationPreferences } from "../NotificationPreferences";
import { Toggle } from "../Segmented";
import { Sheet } from "../Sheet";
import { useCostSharing } from "../../context/CostCommunityContext";
import { Button } from "../Button";
import { useAccountScope } from "./useAccountScope";

const THEMES: { value: ThemeSetting; label: string }[] = [
  { value: "system", label: "לפי המכשיר" },
  { value: "light", label: "בהיר" },
  { value: "dark", label: "כהה" },
];
const UNITS: { value: Units; label: string }[] = [
  { value: "kmPerLiter", label: "ק״מ לליטר" },
  { value: "litersPer100", label: "ליטר ל-100 ק״מ" },
];

export function AccountPreferences() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();
  const { settings, updateSettings, benchmarkWithdrawal, retryBenchmarkWithdrawal } = useData();
  const { theme, setTheme, accent, accentId, accents, setAccent, resolvedTheme } = useTheme();
  const captureScope = useAccountScope(user?.uid);
  const [sheet, setSheet] = useState<"theme" | "units" | "accent" | "notifications" | "sharing" | "cost-sharing" | null>(null);
  const prefs = notificationPreferences(settings);
  const cost = useCostSharing();
  const [costBusy, setCostBusy] = useState(false);

  function save(patch: Partial<UserSettings>, title = "ההעדפה לא נשמרה") {
    const current = captureScope();
    void updateSettings(patch).catch(() => {
      if (current()) showToast({ tone: "error", title, detail: "בדקו את החיבור ונסו שוב" });
    });
  }

  return <>
    <section className="account-section" aria-labelledby="account-display-heading">
      <h2 id="account-display-heading" className="account-section-title">תצוגה</h2>
      <div className="tm-group" data-testid="account-display">
        <GroupRow testId="account-accent" icon={<PaletteIcon />} title="צבע" value={accent.label} onClick={() => setSheet("accent")}>
          <span className="account-accent-preview" aria-hidden="true" />
        </GroupRow>
        <GroupRow testId="account-theme" icon={<MoonIcon />} title="מראה" value={THEMES.find(option => option.value === theme)?.label} onClick={() => setSheet("theme")} />
        <GroupRow testId="account-units" icon={<GaugeIcon />} title="יחידת צריכה"
          value={<NumericText>{UNITS.find(option => option.value === settings.units)?.label ?? "ק״מ לליטר"}</NumericText>} onClick={() => setSheet("units")} />
        <GroupRow testId="account-quick-scan" icon={<CameraIcon />} title="כפתור תדלקתי פותח מצלמה">
          <Toggle checked={settings.quickEntry === true} ariaLabel="כפתור תדלקתי פותח מצלמה"
            onChange={quickEntry => save({ quickEntry }, "העדפת התדלוק לא נשמרה")} />
        </GroupRow>
      </div>
    </section>

    <section className="account-section" aria-labelledby="account-notifications-heading">
      <h2 id="account-notifications-heading" className="account-section-title">התראות</h2>
      <div className="tm-group">
        <GroupRow testId="account-all-notifications" icon={<BellIcon />} title="כל ההתראות" onClick={() => navigate("/notifications")} />
        <GroupRow testId="account-reminder-notifications" title="טסט, ביטוח וטיפולים">
          <Toggle checked={prefs.reminders} ariaLabel="טסט, ביטוח וטיפולים" onChange={reminderNotifications => save({ reminderNotifications })} />
        </GroupRow>
        <GroupRow testId="account-price-notifications" title="שינוי במחיר הדלק">
          <Toggle checked={prefs.prices} ariaLabel="שינוי במחיר הדלק" onChange={priceNotifications => save({ priceNotifications })} />
        </GroupRow>
        <GroupRow testId="account-notification-preferences" icon={<SlidersIcon />} title="העדפות התראות" onClick={() => setSheet("notifications")} />
      </div>
    </section>

    <section className="account-section" aria-labelledby="account-community-heading">
      <h2 id="account-community-heading" className="account-section-title">השוואה לנהגים</h2>
      <div className="tm-group">
        <GroupRow testId="account-comparison-sharing" icon={<UsersIcon />} title="שיתוף סיכום דלק להשוואה">
          <button type="button" className="tm-icon-button" aria-label="מה משותף בהשוואה" aria-haspopup="dialog" onClick={() => setSheet("sharing")}><InfoIcon size={18} /></button>
          <Toggle checked={settings.shareBenchmarks !== false} ariaLabel="שיתוף סיכום דלק להשוואה"
            onChange={shareBenchmarks => save({ shareBenchmarks }, "שינוי השיתוף לא נשמר")} />
        </GroupRow>
        <GroupRow testId="account-cost-sharing" icon={<UsersIcon />} title="שיתוף סיכום עלות הרכב">
          <button type="button" className="tm-icon-button" aria-label="מה משותף בסיכום העלות" aria-haspopup="dialog" onClick={() => setSheet("cost-sharing")}><InfoIcon size={18} /></button>
          <Toggle checked={settings.shareTcoBenchmarks === true} ariaLabel="שיתוף סיכום עלות הרכב"
            onChange={next => next ? setSheet("cost-sharing") : save({ shareTcoBenchmarks: false }, "שינוי שיתוף העלות לא נשמר")} />
        </GroupRow>
      </div>
      {settings.shareTcoBenchmarks !== true ? <p role="status" className="account-note" data-testid="cost-sharing-withdrawal">
        {cost.withdrawal === "done" ? "שיתוף העלות כבוי. סיכומי העלות הוסרו מהשרת."
          : cost.withdrawal === "error" ? "שיתוף העלות כבוי במכשיר. הסרת הסיכומים מהשרת טרם אושרה."
            : "שיתוף העלות כבוי במכשיר. ממתינים לאישור הסרת הסיכומים מהשרת…"}
        {cost.withdrawal === "error" ? <button type="button" className="account-text-action" onClick={cost.retry}>ניסיון חוזר</button> : null}
      </p> : <p role="status" className="account-note" data-testid="cost-sharing-publication">
        {cost.publication === "error" ? <>סיכום העלות לא עודכן בשרת. <button type="button" className="account-text-action" onClick={cost.retry}>ניסיון חוזר</button></>
          : "סיכום עלות חיובי משותף רק כשהרישומים מלאים ומסונכרנים. פרטים חסרים אינם משותפים."}
      </p>}
      {settings.shareBenchmarks === false ? <p role="status" className="account-note">
        {benchmarkWithdrawal === "done" ? "שיתוף הדלק כבוי. סיכומי הדלק הוסרו מהשרת."
          : benchmarkWithdrawal === "error" ? "הסרת סיכומי הדלק עדיין לא אושרה. נדרש חיבור לשרת."
            : "ממתינים לאישור הסרת סיכומי הדלק מהשרת…"}
        {benchmarkWithdrawal === "error" ? <button type="button" className="account-text-action" onClick={retryBenchmarkWithdrawal}>ניסיון חוזר</button> : null}
      </p> : null}
    </section>

    <Sheet open={sheet === "theme"} onClose={() => setSheet(null)} title="מראה">
      <ChoiceList value={theme} options={THEMES} ariaLabel="מראה" onChange={value => { setTheme(value); save({ theme: value }); }} />
    </Sheet>
    <Sheet open={sheet === "units"} onClose={() => setSheet(null)} title="יחידת צריכה">
      <ChoiceList value={settings.units} options={UNITS} ariaLabel="יחידת צריכה" onChange={units => save({ units })} />
    </Sheet>
    <Sheet open={sheet === "accent"} onClose={() => setSheet(null)} title="צבע">
      <div className="account-accent-grid">
        {accents.map(option => <button key={option.id} type="button" aria-pressed={accentId === option.id}
          data-testid={`accent-${option.id}`} className="account-accent-choice"
          onClick={() => { setAccent(option.id); save({ accentColor: option.id, customAccent: null }); }}>
          <span className="account-accent-swatch" style={{ background: resolvedTheme === "dark" ? option.dark : option.light }}>
            {accentId === option.id ? <CheckIcon size={20} /> : null}
          </span>
          <span>{option.label}</span>
        </button>)}
      </div>
    </Sheet>
    <NotificationPreferences open={sheet === "notifications"} onClose={() => setSheet(null)} />
    <Sheet open={sheet === "cost-sharing"} onClose={() => setSheet(null)} title="שיתוף סיכום עלות הרכב">
      <div className="account-sheet-stack" data-testid="cost-sharing-consent">
        <p>השיתוף הזה נפרד משיתוף נתוני הדלק וכבוי כברירת מחדל.</p>
        <p>רק סיכום עלות חיובי ומלא ישותף. הוא יכלול עלות חודשית כוללת של הרכב, דגם, סוג דלק ומספר חודשים בחישוב. פירוט הוצאות, חשבוניות, פרטי ביטוח, שם, מייל ולוחית רישוי אינם משותפים.</p>
        <p>לסיכום יש מזהה חשבון ורכב ומועד עדכון. משתמשים מחוברים יכולים לקרוא אותו ולקשר בין עדכונים של אותו חשבון.</p>
        <p>כיבוי השיתוף מסיר את סיכומי העלות מכל הרכבים לאחר אישור השרת. ההשוואה מוצגת רק מול ארבעה נהגים אחרים לפחות עם אותו דגם וסוג דלק.</p>
        {settings.shareTcoBenchmarks !== true ? <Button full disabled={costBusy} onClick={() => {
          const current = captureScope(); setCostBusy(true);
          void updateSettings({ shareTcoBenchmarks: true }).then(() => { if (current()) setSheet(null); }, () => {
            if (current()) showToast({ tone: "error", title: "שיתוף העלות לא הופעל", detail: "בדקו את החיבור ונסו שוב" });
          }).finally(() => { if (current()) setCostBusy(false); });
        }}>אישור והפעלת שיתוף עלות</Button> : null}
        <Button full variant="secondary" onClick={() => setSheet(null)}>סגירה</Button>
      </div>
    </Sheet>
    <Sheet open={sheet === "sharing"} onClose={() => setSheet(null)} title="השוואה לנהגים">
      <div className="account-sheet-stack">
        <p>שיתוף הדלק כולל דגם ושנה, סוג דלק, צריכה ממוצעת, מספר המקטעים ומחיר ממוצע לליטר. שיתוף העלות הכוללת מופעל בנפרד.</p>
        <p>שם, מייל, מספר רישוי, קילומטראז׳, מועדי התדלוקים ותחנות אינם משותפים.</p>
        <p>לסיכום יש מזהה חשבון ורכב ומועד עדכון. משתמשים מחוברים יכולים לקרוא אותו ולקשר בין עדכונים של אותו חשבון.</p>
        <p>כיבוי שיתוף הדלק מבקש להסיר את סיכומי הדלק של כל הרכבים. האישור מוצג רק לאחר שהשרת מאשר את ההסרה.</p>
      </div>
    </Sheet>
  </>;
}
