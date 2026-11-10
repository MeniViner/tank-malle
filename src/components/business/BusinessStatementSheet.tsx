import { useMemo, useState } from "react";
import { useData } from "../../context/DataContext";
import { useToast } from "../../context/ToastContext";
import { useVehicleData } from "../../context/VehicleDataContext";
import { buildMonthlyStatement, statementCsv, statementHtml, statementMonths, type StatementGroup } from "../../lib/business/statement";
import { downloadCareFile } from "../../lib/maintenance/export";
import { int, monthYear, parseDecimal, vehicleShort } from "../../lib/format";
import { vehicleDay, vehicleMoney } from "../../lib/vehicle/format";
import { readBiz } from "../../lib/vehicle/v3Fields";
import { useAccountScope } from "../account/useAccountScope";
import { Button } from "../Button";
import { Fact, FactsStrip } from "../FactsStrip";
import { Field } from "../Field";
import { NumericText, NumRun } from "../Fmt";
import { DocumentIcon, DownloadIcon } from "../icons";
import { Sheet } from "../Sheet";
import { businessForm, statementFileName, type BizForm } from "./statementView";
import "../../business-design.css";

/**
 * "דוח חודשי לעסק" (design v3 §7.2) for the active vehicle. Opened from
 * Account → הנתונים שלי and from the vehicle screen. Everything shown is built
 * at read time by `buildMonthlyStatement`; only the optional business details
 * (`biz`) are stored, on the vehicle, through the ordinary vehicle update.
 */
export function BusinessStatementSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <Sheet open={open} onClose={onClose} title={<h2>דוח חודשי לעסק</h2>} className="biz-sheet">
    {open ? <StatementBody /> : null}
  </Sheet>;
}

function StatementBody() {
  const { activeVehicle, updateVehicle } = useData();
  const v = useVehicleData();
  const { showToast } = useToast();
  const capture = useAccountScope(v.scope);
  const months = useMemo(() => statementMonths(v.ledger), [v.ledger]);
  // Until the user picks one, follow the newest month with records (records may still be loading on open).
  const [picked, setMonth] = useState<string | null>(null);
  const month = picked ?? months[0] ?? v.today.slice(0, 7);
  const stored = readBiz(activeVehicle?.biz);
  const [form, setForm] = useState<BizForm>(() => ({ company: stored?.company ?? "", driver: stored?.driver ?? "", usage: stored?.usagePct === undefined ? "" : String(stored.usagePct) }));
  const [saving, setSaving] = useState(false);
  const parsed = businessForm(form, parseDecimal);
  const storedKey = JSON.stringify(stored ?? null);
  const dirty = parsed.ok && JSON.stringify(parsed.biz) !== storedKey;
  // The preview and both exports use what is in the form now; saving is separate.
  const statement = useMemo(() => activeVehicle
    ? buildMonthlyStatement({ ...activeVehicle, biz: parsed.ok ? parsed.biz : stored }, { ledger: v.ledger, mileage: v.mileage, incomplete: v.incomplete }, month)
    : null, [activeVehicle, parsed.ok, parsed.ok ? JSON.stringify(parsed.biz) : storedKey, v.ledger, v.mileage, v.incomplete, month]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!activeVehicle || !statement) return <p className="biz-note">בחרו רכב פעיל כדי להפיק דוח.</p>;

  const save = async () => {
    if (!parsed.ok || !dirty || saving) return;
    const current = capture();
    setSaving(true);
    try {
      const receipt = await updateVehicle(activeVehicle.id, { biz: parsed.biz });
      if (!current()) return;
      showToast({ tone: "success", title: "פרטי העסק נשמרו לרכב" });
      void receipt.settled.then(accepted => { if (!accepted && current()) showToast({ tone: "error", title: "שמירת פרטי העסק טרם אושרה", detail: "אפשר לבדוק בשינויים שעוד לא עלו לענן." }); });
    } catch (error) {
      if (current()) showToast({ tone: "error", title: "פרטי העסק לא נשמרו", detail: error instanceof Error ? error.message : undefined });
    } finally { if (current()) setSaving(false); }
  };
  const exportHtml = () => {
    const html = statementHtml(statement);
    const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    const opened = window.open(url, "_blank");
    if (opened) {
      showToast({ tone: "success", title: "הדוח נפתח בחלון חדש", detail: "משם מדפיסים או שומרים כ-PDF." });
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } else {
      URL.revokeObjectURL(url);
      downloadCareFile(html, statementFileName(statement, "html"), "text/html;charset=utf-8");
      showToast({ tone: "info", title: "הדוח ירד כקובץ", detail: "פתחו אותו והדפיסו ל-PDF." });
    }
    void save();
  };
  const exportCsv = () => {
    downloadCareFile(statementCsv(statement), statementFileName(statement, "csv"), "text/csv;charset=utf-8");
    showToast({ tone: "success", title: "קובץ ה-CSV הוכן להורדה", detail: "נפתח ב-Excel." });
    void save();
  };
  const groups: StatementGroup[] = [...statement.groups, ...(statement.excludedGroup ? [statement.excludedGroup] : [])];

  return <div className="biz-stack" data-testid="business-statement">
    <p className="biz-note">כל ההוצאות של חודש אחד ב<NumericText>{vehicleShort(activeVehicle)}</NumericText>, לפי קטגוריה, עם הק״מ שתועדו וסה״כ. להדפסה כ-PDF או לייבוא ל-Excel.</p>
    <div className="biz-months" role="group" aria-label="חודש הדוח" data-testid="business-statement-months">
      {(months.length ? months : [month]).map(key => <button type="button" key={key} aria-pressed={key === month} onClick={() => setMonth(key)}>
        <NumericText>{monthYear(key)}</NumericText></button>)}
    </div>
    {!months.length ? <p className="biz-note" role="status">עוד אין הוצאות מתועדות לרכב הזה.</p> : null}
    <FactsStrip label={`סיכום ${statement.label}`} testId="business-statement-facts">
      <Fact label={<NumericText>{`סה״כ ${statement.label}`}</NumericText>} valueTestId="business-statement-total" value={vehicleMoney(statement.totalAgorot)}
        sub={<NumericText>{`${statement.recordCount} ${statement.recordCount === 1 ? "רשומה" : "רשומות"}${statement.unknownCount ? ` · ${statement.unknownCount} ללא סכום, לא בסה״כ` : ""}${statement.refundsAgorot ? ` · אחרי החזרים של ${vehicleMoney(statement.refundsAgorot)}` : ""}`}</NumericText>} />
      <Fact label="ק״מ שתועדו בחודש" valueTestId="business-statement-km" value={statement.km === null ? null : int(statement.km)} unit="ק״מ"
        sub={statement.km === null ? "אין מספיק קריאות קילומטראז׳ בחודש" : <NumericText>{`${vehicleDay(statement.kmBasis.fromDay!)} — ${vehicleDay(statement.kmBasis.toDay!)}`}</NumericText>} />
      {statement.groups.map(group => <Fact key={group.id} variant="minor" label={group.label} value={vehicleMoney(group.totalAgorot)} testId={`business-group-${group.id}`} />)}
      {statement.businessShareAgorot !== null ? <Fact label={<>חלק עסקי (<NumRun>{`${statement.biz!.usagePct}%`}</NumRun>)</>} sub="חישוב עזר בלבד" value={vehicleMoney(statement.businessShareAgorot)} valueTestId="business-statement-share" /> : null}
      {statement.excludedGroup ? <Fact label={statement.excludedGroup.label} muted testId="business-group-excluded" value={vehicleMoney(statement.excludedGroup.totalAgorot)}
        sub={<><NumRun>{statement.excludedGroup.rows.length}</NumRun> {statement.excludedGroup.rows.length === 1 ? "רשומה" : "רשומות"} · מחוץ לסה״כ</>} /> : null}
    </FactsStrip>
    {statement.incomplete ? <p className="biz-note" role="status">חלק מהנתונים עדיין לא נטענו או לא אושרו; ייתכן שהדוח חלקי.</p> : null}

    {groups.length ? <details className="biz-rows" data-testid="business-statement-rows"><summary>הרשומות בחודש</summary>
      {groups.map(group => <section key={group.id} className={group.inTotal ? "" : "biz-outside"}>
        <h3>{group.label}{group.inTotal ? null : <small> · מחוץ לסה״כ</small>}</h3>
        <ul>{group.rows.map(row => <li key={row.key}>
          <span><NumericText>{`${vehicleDay(row.day)} · ${row.title}${row.supplier ? ` · ${row.supplier}` : ""}`}</NumericText></span>
          <NumRun>{row.amountAgorot === null ? "—" : vehicleMoney(row.amountAgorot)}</NumRun>
        </li>)}</ul>
      </section>)}
    </details> : null}

    <details className="biz-details" open={!!stored}><summary>פרטי העסק בדוח (רשות)</summary>
      <div className="biz-fields">
        <Field label="שם העסק" value={form.company} maxLength={120} autoComplete="organization" onChange={event => setForm({ ...form, company: event.target.value })} />
        <Field label="נהג" value={form.driver} maxLength={80} autoComplete="name" onChange={event => setForm({ ...form, driver: event.target.value })} />
        <Field label="שימוש עסקי" inputMode="decimal" suffix="%" value={form.usage} onChange={event => setForm({ ...form, usage: event.target.value })}
          error={parsed.ok ? undefined : parsed.error} hint="חישוב עזר בלבד. ההכרה בהוצאה לפי כללי רשות המסים ורואה החשבון." />
        <Button variant="secondary" disabled={!dirty || saving} loading={saving} onClick={() => void save()}>שמירת פרטי העסק לרכב</Button>
      </div>
    </details>

    <div className="biz-actions">
      <Button onClick={exportHtml} disabled={!parsed.ok}><DocumentIcon size={18} />PDF להדפסה</Button>
      <Button variant="secondary" onClick={exportCsv} disabled={!parsed.ok}><DownloadIcon size={18} />CSV ל-Excel</Button>
    </div>
    <p className="biz-note">הוצאות שסומנו ״לא בעלות הרכב״ מופיעות בדוח בקבוצה נפרדת ואינן בסה״כ. הסכומים בדוח המודפס מעוגלים לשקל; קובץ ה-CSV שומר את הערכים המדויקים.</p>
  </div>;
}
