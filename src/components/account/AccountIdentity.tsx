import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { fullDate, loginMoment, num, price, time } from "../../lib/format";
import { vehicleMoney } from "../../lib/vehicle/format";
import { EXCLUDED_LABEL } from "../../lib/vehicle/ownership";
import { Avatar } from "../Avatar";
import { Pill } from "../DesignPrimitives";
import { Fact, FactsStrip } from "../FactsStrip";
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
        <FactsStrip label="פרטי החשבון" testId="account-identity-facts">
          <Fact label="שיטת התחברות" valueKind="text" value="חשבון Google" />
          <Fact label="חבר מאז" valueKind="text" value={joinedAt === null ? null : fullDate(joinedAt)} />
          <Fact label="התחברות קודמת" valueKind="text" value={previousLoginAt === undefined ? "טוענים…" : previousLoginAt === null
            ? "זו ההתחברות הראשונה" : `נכנס לאחרונה ${loginMoment(previousLoginAt)}`} muted={previousLoginAt === undefined} />
          {isAdmin ? <Fact label="הרשאות" valueKind="text" value="מנהל מערכת" /> : null}
        </FactsStrip>
        <section data-testid="profile-summary" className="account-sheet-stack">
          <h3 className="account-section-title">הפעילות שלי</h3>
          <p className="account-note">כל הרכבים, כולל הארכיון</p>
          <FactsStrip label="הפעילות שלי בכל הרכבים" testId="account-activity-facts">
            <Fact label="רכבים" value={num(vehicles.length, 0)} sub={vehicles.length > active.length
              ? <><NumRun>{num(active.length, 0)}</NumRun> פעילים · <NumRun>{num(vehicles.length - active.length, 0)}</NumRun> בארכיון</>
              : active.length === 1 ? <NumericText>{active[0].nickname?.trim() || `${active[0].make} ${active[0].model}`.trim()}</NumericText> : undefined} />
            <Fact label="תדלוקים" value={records ? num(records.fillupCount, 0) : null}
              sub={<><NumRun>{records ? num(records.totalLiters, 0) : "—"}</NumRun> ליטר בסך הכול</>} />
            <Fact label="סה״כ הוצאה" value={records ? vehicleMoney(Math.round(records.totalCost * 100)) : null}
              sub={records?.unknownCosts ? <><NumRun>{num(records.unknownCosts, 0)}</NumRun> רשומות עם עלות חסרה לא נכללו</>
                : avgPrice !== null ? <>כולל תחזוקה והוצאות · ממוצע דלק <NumRun>{price(avgPrice)}</NumRun> לליטר</>
                  : "רכישות דלק, טיפולים והוצאות פחות החזרים"} />
            {records?.excludedCount ? <Fact label={EXCLUDED_LABEL} muted value={vehicleMoney(records.excludedAgorot)} testId="account-excluded"
              sub={<><NumRun>{num(records.excludedCount, 0)}</NumRun> {records.excludedCount === 1 ? "רשומה" : "רשומות"} · מחוץ לסה״כ ההוצאה</>} /> : null}
            <Fact label="ק״מ שתועדו" value={records && !records.distanceUnknown ? num(records.totalKm, 0) : null} unit="ק״מ"
              sub={records?.distanceUnknown ? "אין כיסוי קילומטראז׳ מספק בכל הרכבים" : "המרחק שתועד בכל הרכבים"} />
          </FactsStrip>
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
