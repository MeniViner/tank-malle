import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import { useVehicleNotifications } from "../hooks/useVehicleNotifications";
import { formatPlate, vehicleShort } from "../lib/format";
import { Avatar } from "./Avatar";
import { CarSwitchSheet } from "./CarSwitchSheet";
import { MiniPlate } from "./DesignPrimitives";
import { NumericText } from "./Fmt";
import { BellIcon, CarIcon, ChevronDown, CloseIcon } from "./icons";

/** Home has one vehicle switcher and direct entries to notifications and Account. */
export function AppHeader() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeVehicle } = useData();
  const { unread } = useVehicleNotifications();
  const [switchOpen, setSwitchOpen] = useState(false);
  const label = activeVehicle ? vehicleShort(activeVehicle) : "בחירת רכב";

  return <header className="tm-home-header" data-testid="home-header">
    <button type="button" className="tm-home-car" data-testid="open-car-switch"
      aria-label={`החלפת רכב, ${label}${activeVehicle?.plateNumber ? `, לוחית ${formatPlate(activeVehicle.plateNumber)}` : ""}`}
      aria-description={activeVehicle ? "הרכב הפעיל" : "אין כרגע רכב פעיל"}
      aria-haspopup="dialog" aria-expanded={switchOpen} onClick={() => setSwitchOpen(true)}>
      {activeVehicle?.plateNumber ? <MiniPlate plate={activeVehicle.plateNumber} /> : <CarIcon size={22} />}
      <span className="tm-home-car-name"><NumericText>{label}</NumericText></span>
      <ChevronDown size={16} className="shrink-0" />
    </button>
    <div className="tm-home-header-actions">
      <button type="button" className="tm-header-bell" aria-label="התראות"
        aria-description={unread ? `${unread} התראות חדשות` : "אין התראות חדשות"}
        onClick={() => navigate("/notifications")}>
        <BellIcon size={20} />{unread ? <span className="tm-header-unread" aria-hidden="true" /> : null}
      </button>
      <button type="button" className="tm-header-account" aria-label="חשבון" data-testid="open-account"
        onClick={() => navigate("/account")}>
        <Avatar name={user?.displayName} photoURL={user?.photoURL} size={40} />
      </button>
    </div>
    {switchOpen ? <CarSwitchSheet key={user?.uid} onClose={() => setSwitchOpen(false)} /> : null}
  </header>;
}

/** Shared pushed-screen title. Existing close behavior remains the default. */
export function ScreenHeader({ title, onBack, trailing, subtitle, backLabel = "סגירה", backIcon }: {
  title: ReactNode; onBack?: () => void; trailing?: ReactNode; subtitle?: ReactNode;
  backLabel?: string; backIcon?: ReactNode;
}) {
  return <header className="tm-screen-header">
    {onBack ? <button type="button" onClick={onBack} aria-label={backLabel} className="tm-screen-back">
      {backIcon ?? <CloseIcon size={20} />}
    </button> : <span className="tm-screen-header-spacer" />}
    <div className="tm-screen-title-wrap"><h1 className="tm-screen-title">{title}</h1>{subtitle}</div>
    <div className="tm-screen-trailing">{trailing}</div>
  </header>;
}
