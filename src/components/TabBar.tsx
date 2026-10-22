import { NavLink, useNavigate } from "react-router-dom";
import { ChartIcon, ClockIcon, HomeIcon, PumpIcon, CarSideIcon } from "./icons";
import { useVehicleData } from '../context/VehicleDataContext';

const TABS = [
  { to: "/", label: "בית", Icon: HomeIcon, end: true },
  { to: "/history", label: "יומן", Icon: ClockIcon, end: false },
  { to: "/stats", label: "תובנות", Icon: ChartIcon, end: false },
  { to: "/vehicle", label: "רכב", Icon: CarSideIcon, end: false },
];

/**
 * Bottom tab bar with the fill-up FAB punched through its centre.
 * The FAB sits in the thumb zone and is the app's single primary action.
 */
export function TabBar({ canAddFillup }: { canAddFillup: boolean }) {
  const navigate = useNavigate();
  const v=useVehicleData();
  const careCount=v.notifications.reminders?v.reminders.filter(r=>r.plan.active&&['due','soon'].includes(r.status)).length:0;
  const issueCount=v.notifications.issues?v.extra.vehicleIssues.filter(i=>i.importance==='important'&&i.status!=='resolved').length:0;

  return (
    <nav className="app-shell fixed inset-x-0 bottom-0 z-40 mx-auto flex max-w-[430px] flex-col border-t border-line bg-surface pb-safe">
      <div className="flex items-start px-1.5 pt-2">
        {TABS.slice(0, 2).map((tab) => (
          <Tab key={tab.to} {...tab} />
        ))}

        <span className="flex flex-1 flex-col items-center">
          <button
            type="button"
            onClick={() => navigate("/fillup/new")}
            disabled={!canAddFillup}
            aria-label="תדלוק חדש"
            className="-mt-[24px] flex size-[56px] items-center justify-center rounded-full bg-accent text-accent-contrast shadow-fab ring-[4px] ring-bg transition-[scale,filter] duration-200 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.96] active:brightness-[0.97] disabled:pointer-events-none disabled:opacity-45"
          >
            <PumpIcon size={26} />
          </button>
          <span className="mt-[3px] text-[11px] font-bold text-accent">תדלוק</span>
        </span>

        {TABS.slice(2).map((tab) => (
          <Tab key={tab.to} {...tab} badge={tab.to==='/vehicle'?careCount+issueCount:0} />
        ))}
      </div>
    </nav>
  );
}

function Tab({
  to,
  label,
  Icon,
  end,
  badge=0,
}: {
  to: string;
  label: string;
  Icon: (props: { size?: number }) => React.ReactElement;
  end: boolean;
  badge?:number;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex min-h-[52px] flex-1 flex-col items-center gap-[3px] pb-1 transition-[color,scale] duration-200 active:scale-[0.96] ${
          isActive ? "text-accent" : "text-muted"
        }`
      }
    >
      {({ isActive }) => (
        <>
          <span className="relative"><Icon size={23} />{badge>0?<span data-testid="vehicle-alert-count" className="vehicle-alert-count">{badge}</span>:null}</span>
          <span className={`text-[11px] ${isActive ? "font-bold" : "font-semibold"}`}>
            {label}
          </span>
        </>
      )}
    </NavLink>
  );
}
