import { NavLink, useNavigate } from "react-router-dom";
import { ChartIcon, ClockIcon, HomeIcon, PumpIcon, SlidersIcon } from "./icons";

const TABS = [
  { to: "/", label: "בית", Icon: HomeIcon, end: true },
  { to: "/history", label: "היסטוריה", Icon: ClockIcon, end: false },
  { to: "/stats", label: "סטטיסטיקות", Icon: ChartIcon, end: false },
  { to: "/settings", label: "הגדרות", Icon: SlidersIcon, end: false },
];

/**
 * Bottom tab bar with the fill-up FAB punched through its centre.
 * The FAB sits in the thumb zone and is the app's single primary action.
 */
export function TabBar({ canAddFillup }: { canAddFillup: boolean }) {
  const navigate = useNavigate();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto flex max-w-[430px] flex-col border-t border-line bg-[color-mix(in_srgb,var(--surface)_95%,transparent)] pb-safe backdrop-blur-xl">
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
            className="-mt-[38px] flex size-[58px] items-center justify-center rounded-full bg-accent text-accent-contrast shadow-fab ring-[5px] ring-bg transition-[scale,filter] duration-200 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.96] active:brightness-[0.97] disabled:pointer-events-none disabled:opacity-45"
          >
            <PumpIcon size={26} />
          </button>
          <span className="mt-[3px] text-[11px] font-bold text-accent">תדלוק</span>
        </span>

        {TABS.slice(2).map((tab) => (
          <Tab key={tab.to} {...tab} />
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
}: {
  to: string;
  label: string;
  Icon: (props: { size?: number }) => React.ReactElement;
  end: boolean;
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
          <Icon size={23} />
          <span className={`text-[11px] ${isActive ? "font-bold" : "font-semibold"}`}>
            {label}
          </span>
        </>
      )}
    </NavLink>
  );
}
