import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../context/DataContext";
import { useAuth } from "../context/AuthContext";
import { vehicleLabel } from "../lib/format";
import { CarIcon, ChevronDown, CheckIcon, CloudOffIcon, PlusIcon } from "./icons";
import { Sheet } from "./Sheet";
import { Num } from "./Num";
import { Avatar } from "./Avatar";

/**
 * App header: active-vehicle switcher on one side, profile avatar on the
 * other, plus an offline indicator that appears only when relevant.
 */
export function AppHeader() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeVehicle, activeVehicles, setActiveVehicle, offline } = useData();
  const [switcherOpen, setSwitcherOpen] = useState(false);

  return (
    <header className="flex flex-none items-center justify-between gap-2 px-5 pb-1 pt-3">
      {activeVehicle ? (
        <button
          type="button"
          onClick={() => activeVehicles.length > 1 && setSwitcherOpen(true)}
          className="flex min-h-[42px] items-center gap-2.5 rounded-pill border border-line bg-surface px-3.5 py-2 active:bg-surface-2"
          aria-label="החלפת רכב פעיל"
        >
          <CarIcon size={18} className="text-accent" />
          <span className="max-w-[190px] truncate text-[14.5px] font-semibold text-ink">
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
          {activeVehicles.length > 1 ? <ChevronDown size={15} className="text-muted" /> : null}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => navigate("/vehicles/new")}
          className="flex min-h-[42px] items-center gap-2 rounded-pill border border-line bg-surface px-3.5 text-[14.5px] font-semibold text-accent"
        >
          <PlusIcon size={17} />
          הוספת רכב
        </button>
      )}

      <div className="flex items-center gap-2">
        {offline ? (
          <span
            className="flex size-9 items-center justify-center rounded-full bg-warning-soft text-warning-ink"
            title="אין חיבור — הנתונים יסתנכרנו אוטומטית"
          >
            <CloudOffIcon size={17} />
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => navigate("/settings/profile")}
          aria-label="פרופיל"
        >
          <Avatar name={user?.displayName} photoURL={user?.photoURL} size={38} />
        </button>
      </div>

      <Sheet
        open={switcherOpen}
        onClose={() => setSwitcherOpen(false)}
        title={<h2 className="text-[17px] font-bold text-ink">בחירת רכב</h2>}
      >
        <div className="flex flex-col gap-1">
          {activeVehicles.map((vehicle) => (
            <button
              key={vehicle.id}
              type="button"
              onClick={() => {
                void setActiveVehicle(vehicle.id);
                setSwitcherOpen(false);
              }}
              className="flex min-h-[56px] items-center gap-3 rounded-2xl px-3 text-start active:bg-surface-2"
            >
              <span className="flex size-9 flex-none items-center justify-center rounded-tile bg-accent-soft text-accent">
                <CarIcon size={18} />
              </span>
              <span className="flex-1 truncate text-[15px] font-semibold text-ink">
                {vehicleLabel(vehicle)}
              </span>
              {vehicle.id === activeVehicle?.id ? (
                <CheckIcon size={19} className="text-accent" />
              ) : null}
            </button>
          ))}

          <button
            type="button"
            onClick={() => {
              setSwitcherOpen(false);
              navigate("/vehicles/new");
            }}
            className="mt-1 flex min-h-[52px] items-center justify-center gap-2 rounded-pill bg-surface-2 text-[15px] font-bold text-accent"
          >
            <PlusIcon size={18} />
            הוספת רכב
          </button>
        </div>
      </Sheet>
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
          className="flex size-[38px] flex-none items-center justify-center rounded-full border border-line bg-surface text-ink active:bg-surface-2"
        >
          <CloseGlyph />
        </button>
      ) : (
        <span className="size-[38px] flex-none" />
      )}

      <div className="flex min-w-0 flex-1 flex-col items-center">
        <h1 className="max-w-full truncate text-[18px] font-bold text-ink">{title}</h1>
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
