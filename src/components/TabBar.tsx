import { NavLink, useNavigate } from "react-router-dom";
import type { ReactElement } from "react";
import { useVehicleData } from "../context/VehicleDataContext";
import { int } from "../lib/format";
import { NumRun } from "./Fmt";
import { TabCarIcon, TabHomeIcon, TabInsightsIcon, TabJournalIcon, TabPumpIcon } from "./icons";

const TABS = [
  { to: "/", label: "בית", Icon: TabHomeIcon },
  { to: "/history", label: "יומן", Icon: TabJournalIcon },
  { to: "/stats", label: "תובנות", Icon: TabInsightsIcon },
  { to: "/vehicle", label: "רכב", Icon: TabCarIcon },
];

/** The camera preference is consumed by the existing new-fill-up controller. */
export function TabBar({ canAddFillup }: { canAddFillup: boolean }) {
  const navigate = useNavigate();
  const vehicle = useVehicleData();
  const careCount = vehicle.notifications.reminders
    ? vehicle.reminders.filter(row => row.plan.active && ["due", "soon"].includes(row.status)).length : 0;
  const issueCount = vehicle.notifications.issues
    ? vehicle.extra.vehicleIssues.filter(row => row.importance === "important" && row.status !== "resolved").length : 0;

  return <nav aria-label="ניווט ראשי" className="tm-tabbar" data-testid="tab-bar">
    {TABS.slice(0, 2).map(tab => <Tab key={tab.to} {...tab} />)}
    <button type="button" className="tm-refuel-fab" data-testid="refuel-fab"
      aria-label="תדלקתי" disabled={!canAddFillup} onClick={() => navigate("/fillup/new")}>
      <TabPumpIcon size={26} /><span>תדלקתי</span>
    </button>
    {TABS.slice(2).map(tab => <Tab key={tab.to} {...tab} badge={tab.to === "/vehicle" ? careCount + issueCount : 0} />)}
  </nav>;
}

function Tab({ to, label, Icon, badge = 0 }: {
  to: string; label: string; Icon: (props: { size?: number }) => ReactElement; badge?: number;
}) {
  return <NavLink to={to} end={to === "/"} className="tm-tab-link" aria-label={`${label}${badge > 0 ? `, ${int(badge)} התראות` : ""}`}
    data-testid={`tab-${to === "/" ? "home" : to.slice(1)}`}>
    <span className="tm-tab-icon-pill"><Icon size={23} />
      {badge > 0 ? <span data-testid="vehicle-alert-count" className="vehicle-alert-count" aria-hidden="true"><NumRun>{int(badge)}</NumRun></span> : null}
    </span>
    <span>{label}</span>
  </NavLink>;
}
