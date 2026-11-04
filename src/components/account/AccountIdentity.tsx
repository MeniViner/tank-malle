import { useState, type ReactNode } from "react";
import { useAuth } from "../../context/AuthContext";
import { fullDate, loginMoment, num, price, time } from "../../lib/format";
import { vehicleMoney } from "../../lib/vehicle/format";
import { Avatar } from "../Avatar";
import { GroupRow, Pill } from "../DesignPrimitives";
import { NumericText, NumRun } from "../Fmt";
import { ChevronStart, ShieldIcon } from "../icons";
import { Sheet } from "../Sheet";
import type { AccountSummary } from "./useAccountSummary";

export function AccountIdentity({ summary }: { summary: AccountSummary }) {
  const { user, isAdmin, previousLoginAt } = useAuth();
  const [open, setOpen] = useState(false);
  const joined = user?.metadata.creationTime ? new Date(user.metadata.creationTime).getTime() : null;
  const joinedAt = joined !== null && Number.isFinite(joined) ? joined : null;
  const { records, snapshot, liveReady, incomplete, activeVehicle, vehicles } = summary;
  const active = vehicles.filter(vehicle => !vehicle.archived);
  const avgPrice = records && records.unknownFuelCosts === 0 && records.totalLiters > 0
    ? records.fuelCost / records.totalLiters : null;

  return <>
    <button type="button" className="account-identity" data-testid="account-identity"
      aria-label={`${user?.displayName || "החשבון שלי"}, ${user?.email || ""} · פרטי החשבון והפעילות שלי`} aria-haspopup="dialog" onClick={() => setOpen(true)}>
      <span className="account-avatar"><Avatar name={user?.displayName} photoURL={user?.photoURL} size={61} /></span>
      <span className="account-identity-copy">
        <span className="account-name"><NumericText>{user?.displayName || "החשבון שלי"}</NumericText></span>
        <bdi dir="ltr" className="account-email">{user?.email}</bdi>
        {isAdmin ? <Pill><ShieldIcon size={14} />מנהל מערכת</Pill> : null}
      </span>
      <ChevronStart size={20} />
    </button>
    <Sheet open={open} onClose={() => setOpen(false)} title="פרטי החשבון">
      <div data-testid="account-summary" className="account-sheet-stack">
        <div className="tm-group">
          <GroupRow title="חבר מאז" value={joinedAt === null ? "—" : <NumericText>{fullDate(joinedAt)}</NumericText>} />
          <GroupRow title="התחברות קודמת" value={previousLoginAt === undefined ? "טוענים…" : previousLoginAt === null
            ? "זו ההתחברות הראשונה" : <NumericText>{`נכנס לאחרונה ${loginMoment(previousLoginAt)}`}</NumericText>} />
          <GroupRow title="שיטת התחברות" value="חשבון Google" />
          {isAdmin ? <GroupRow title="הרשאות" value="מנהל מערכת" /> : null}
        </div>
        <section data-testid="profile-summary" className="account-sheet-stack">
          <h3 className="account-section-title">הפעילות שלי</h3>
          <p className="account-note">כל הרכבים, כולל הארכיון</p>
          <div className="account-metrics">
            <Metric label="תדלוקים" value={records ? num(records.fillupCount, 0) : "—"}
              detail={<><NumRun>{records ? num(records.totalLiters, 0) : "—"}</NumRun> ליטר בסך הכול</>} />
            <Metric label="סה״כ הוצאה" value={records ? vehicleMoney(Math.round(records.totalCost * 100)) : "—"}
              detail={records?.unknownCosts ? <><NumRun>{num(records.unknownCosts, 0)}</NumRun> רשומות עם עלות חסרה לא נכללו</>
                : avgPrice !== null ? <>כולל תחזוקה והוצאות · ממוצע דלק <NumRun>{price(avgPrice)}</NumRun> לליטר</>
                  : "רכישות דלק, טיפולים והוצאות פחות החזרים"} />
            <Metric label="ק״מ שתועדו" value={records && !records.distanceUnknown ? num(records.totalKm, 0) : "—"} unit="ק״מ"
              detail={records?.distanceUnknown ? "אין כיסוי קילומטראז׳ מספק בכל הרכבים" : "המרחק שתועד בכל הרכבים"} />
            <Metric label="רכבים" value={num(vehicles.length, 0)} detail={vehicles.length > active.length
              ? <><NumRun>{num(active.length, 0)}</NumRun> פעילים · <NumRun>{num(vehicles.length - active.length, 0)}</NumRun> בארכיון</>
              : active.length === 1 ? <NumericText>{active[0].nickname?.trim() || `${active[0].make} ${active[0].model}`.trim()}</NumericText> : undefined} />
          </div>
          <p className="account-note">
            {snapshot ? <>נתוני שאר הרכבים נכונים ל־<NumRun>{time(snapshot.at)}</NumRun>. </> : "טוענים את סיכום החשבון. "}
            {liveReady ? incomplete ? "נתוני הרכב הפעיל כוללים מידע מקומי או שטרם סונכרן." : "הרכב הפעיל מתעדכן בזמן אמת."
              : activeVehicle ? "הרכב הפעיל יוצג לפי תמונת השרת עד השלמת הטעינה." : ""}
          </p>
          {summary.error ? <p role="alert" className="account-error">{summary.error}</p> : null}
          <button type="button" className="account-text-action" disabled={summary.loading || !summary.canRefresh} onClick={summary.refresh}>
            {summary.loading ? "מרעננים…" : "רענון הסיכום"}
          </button>
        </section>
      </div>
    </Sheet>
  </>;
}

function Metric({ label, value, unit, detail }: { label: string; value: string; unit?: string; detail?: ReactNode }) {
  return <div className="account-metric">
    <span className="account-metric-label">{label}</span>
    <span className="account-metric-reading"><NumRun>{value}</NumRun>{unit ? <span>{unit}</span> : null}</span>
    {detail ? <span className="account-note">{detail}</span> : null}
  </div>;
}
