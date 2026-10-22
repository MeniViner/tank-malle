import { useState } from "react";
import { Sheet } from "./Sheet";
import { useVehicleNotifications } from "../hooks/useVehicleNotifications";
import { type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../context/DataContext";
import { useAuth } from "../context/AuthContext";
import {
  BellIcon,
  CarIcon,
  ChevronStart,
  CloudOffIcon,
  PlusIcon,
  WarningIcon,
} from "./icons";
import { Num } from "./Num";
import { Avatar } from "./Avatar";

/**
 * App header: the active vehicle on one side, profile avatar on the other,
 * plus a sync indicator that appears only when relevant.
 *
 * The vehicle pill opens vehicle MANAGEMENT rather than a switcher sheet:
 * tapping the car you are looking at to get a list of cars was the one thing
 * it was never asked to do.
 */
export function AppHeader() {
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();
  const [accountOpen,setAccountOpen]=useState(false);
  const { unread }=useVehicleNotifications();
  const { activeVehicle, offline, writes, outbox, outboxHealth, outboxReady } = useData();
  const failed =
    outbox.filter((op) => op.status !== "pending").length +
    (outboxReady && outboxHealth.state !== "ok" ? 1 : 0);
  const pending = outbox.filter((op) => op.status === "pending").length;

  return (
    <header className="flex flex-none items-center justify-between gap-2 px-5 pb-1 pt-3">
      {activeVehicle ? (
        <button
          type="button"
          onClick={() => navigate("/settings/vehicles")}
          className="flex min-w-0 flex-1 min-h-[42px] items-center gap-2 rounded-control py-2 transition-[background-color,scale] duration-200 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.97] active:bg-surface-2"
          aria-label="ניהול רכבים"
        >
          <CarIcon size={21} className="flex-none text-muted" />
          <span className="min-w-0 truncate text-[17px] font-bold text-ink">
            {activeVehicle.nickname?.trim() ? (
              activeVehicle.nickname
            ) : (
              <>
                {activeVehicle.make} {activeVehicle.model}
                {activeVehicle.year ? (
                  <>
                    {" · "}
                    <Num>{activeVehicle.year}</Num>
                  </>
                ) : null}
              </>
            )}
          </span>
          <ChevronStart size={15} className="flex-none text-muted" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => navigate("/vehicles/new")}
          className="flex min-h-[42px] items-center gap-2 rounded-pill border border-line bg-surface px-3.5 text-[14.5px] font-semibold text-accent shadow-card transition-[background-color,scale] duration-200 active:scale-[0.97] active:bg-surface-2"
        >
          <PlusIcon size={17} />
          הוספת רכב
        </button>
      )}

      <div className="flex flex-none items-center gap-2">
        {/* Four distinct states, never conflated: a permanent rejection is not
            the same thing as a queued write, and neither is "no connection". */}
        {failed > 0 || writes.failed.length > 0 ? (
          <button
            type="button"
            onClick={() => navigate("/settings/unsynced")}
            className="flex min-h-10 items-center gap-1.5 rounded-pill bg-danger-soft px-2.5 text-[12px] font-semibold text-danger-ink"
            aria-label="פעולות שלא סונכרנו"
          >
            <WarningIcon size={15} />
            <span className="hidden min-[400px]:inline">לא סונכרן</span>
            {failed > 0 ? <Num>{failed}</Num> : null}
          </button>
        ) : writes.syncing || pending > 0 ? (
          <button
            type="button"
            onClick={() => navigate("/settings/unsynced")}
            className="flex min-h-10 items-center gap-1.5 rounded-pill bg-surface-2 px-2.5 text-[12px] font-semibold text-muted"
            aria-label="פעולות שממתינות לסנכרון"
            title={offline ? "אין חיבור — יסונכרן כשיחזור" : "ממתין לאישור מהשרת"}
          >
            <CloudOffIcon size={15} />
            <span className="hidden min-[400px]:inline">{offline ? "נשמר במכשיר" : "ממתין לסנכרון"}</span>
          </button>
        ) : offline ? (
          <span
            className="flex size-9 items-center justify-center rounded-full bg-warning-soft text-warning-ink"
            title="אין חיבור — הנתונים יסתנכרנו אוטומטית"
          >
            <CloudOffIcon size={17} />
          </span>
        ) : null}
        <button type="button" aria-label="התראות" aria-description={unread?`${unread} התראות חדשות`:'אין התראות חדשות'} onClick={()=>navigate('/notifications')} className="relative flex size-11 items-center justify-center rounded-full text-muted"><BellIcon size={21}/>{unread?<span className="notification-dot" aria-hidden="true"/>:null}</button>
        <button
          type="button"
          onClick={() => setAccountOpen(true)}
          aria-label="פרופיל"
          className="flex size-11 items-center justify-center rounded-full active:scale-[0.96]"
        >
          <Avatar name={user?.displayName} photoURL={user?.photoURL} size={34} />
        </button>
      </div>

      <Sheet open={accountOpen} onClose={()=>setAccountOpen(false)} title="החשבון שלי"><div className="v-group">{[['/settings/profile','פרופיל והנתונים שלי'],['/settings','הגדרות'],...(isAdmin?[['/admin','לוח הבקרה']]:[])].map(([to,label])=><button className="v-row" type="button" key={to} onClick={()=>{setAccountOpen(false);navigate(to);}}>{label}<span>←</span></button>)}</div></Sheet>
    </header>
  );
}

/** Simple centred title bar for the secondary (pushed) screens. */
export function ScreenHeader({
  title,
  onBack,
  trailing,
  subtitle,
}: {
  title: ReactNode;
  onBack?: () => void;
  trailing?: ReactNode;
  subtitle?: ReactNode;
}) {
  return (
    <header className="flex flex-none items-center justify-between gap-2 px-[18px] pb-3 pt-2.5">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          aria-label="סגירה"
          className="flex size-[44px] flex-none items-center justify-center rounded-full text-ink transition-[background-color,scale] duration-200 active:scale-[0.96] active:bg-surface-2"
        >
          <CloseGlyph />
        </button>
      ) : (
        <span className="size-[38px] flex-none" />
      )}

      <div className="flex min-w-0 flex-1 flex-col items-center">
        <h1 className="max-w-full truncate text-[17px] font-bold text-ink">{title}</h1>
        {subtitle}
      </div>

      <div className="flex min-w-[38px] max-w-[34%] flex-none items-center justify-end">
        {trailing}
      </div>
    </header>
  );
}

function CloseGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 6l12 12M18 6 6 18"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
    </svg>
  );
}
