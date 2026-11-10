import type { SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 24, children, ...rest }: IconProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true" focusable="false" {...rest}>{children}</svg>;
}

/** The complete symbol set from design/v2/prototype.html; no external icon runtime. */

export const PumpIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M4 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16"/><path d="M3 21h13"/><path d="M7 8h5"/><path d="M15 9h2a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V8l-3-3"/>
  </Svg>
);

export const HomeIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/>
  </Svg>
);

export const ListIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="miter" {...props}>
    <path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>
  </Svg>
);

export const ChartIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M3 20h18"/><path d="m4 15 5-5 4 3 7-7"/>
  </Svg>
);

export const CarIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M5 17H3v-5l2-5h14l2 5v5h-2"/><path d="M3 12h18"/><circle cx="7.5" cy="17" r="2"/><circle cx="16.5" cy="17" r="2"/>
  </Svg>
);

export const CloseIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="miter" {...props}>
    <path d="M6 6l12 12M18 6 6 18"/>
  </Svg>
);

export const CameraIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="butt" {...props}>
    <path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>
  </Svg>
);

export const PinIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="butt" {...props}>
    <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>
  </Svg>
);

export const ClockIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="miter" {...props}>
    <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>
  </Svg>
);

export const ChevronStart = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="m15 6-6 6 6 6"/>
  </Svg>
);

export const ChevronEnd = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="m9 6 6 6-6 6"/>
  </Svg>
);

export const ChevronDown = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="m6 9 6 6 6-6"/>
  </Svg>
);

export const PlusIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="miter" {...props}>
    <path d="M12 5v14M5 12h14"/>
  </Svg>
);

export const WrenchIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M14.5 6.5a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3z"/><path d="M14.5 6.5 17 4"/>
  </Svg>
);

export const CoinIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="miter" {...props}>
    <circle cx="12" cy="12" r="9"/><path d="M9 9.5h4.5a1.75 1.75 0 0 1 0 3.5H10.5a1.75 1.75 0 0 0 0 3.5H15M12 7.5v1.5M12 16.5V18"/>
  </Svg>
);

export const GaugeIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="miter" {...props}>
    <path d="M4.5 18a9 9 0 1 1 15 0"/><path d="m12 13 4-4"/>
  </Svg>
);

export const BellIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5h4"/>
  </Svg>
);

export const CheckIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="m5 12.5 4.5 4.5L19 7.5"/>
  </Svg>
);

export const WarningIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="miter" {...props}>
    <path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/>
  </Svg>
);

export const TrashIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13"/>
  </Svg>
);

export const PencilIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M4 20h4L19 9l-4-4L4 16z"/>
  </Svg>
);

export const UploadIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M12 15V4M7 9l5-5 5 5M4 15v5h16v-5"/>
  </Svg>
);

export const DownloadIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M12 4v11M7 10l5 5 5-5M4 15v5h16v-5"/>
  </Svg>
);

export const CloudIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="butt" {...props}>
    <path d="M7 18a4.5 4.5 0 0 1-.5-9A6 6 0 0 1 18 9.5a4 4 0 0 1-1 8.5z"/>
  </Svg>
);

export const MessageIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="butt" {...props}>
    <path d="M4 5h16v11H9l-5 4z"/>
  </Svg>
);

export const DocumentIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="butt" {...props}>
    <path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>
  </Svg>
);

export const ShareIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="miter" {...props}>
    <circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4"/>
  </Svg>
);

export const MoonIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="butt" {...props}>
    <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>
  </Svg>
);

export const UsersIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="miter" {...props}>
    <circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>
  </Svg>
);

export const TagIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="butt" {...props}>
    <path d="M3 12V3h9l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>
  </Svg>
);

export const LogoutIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M14 4h6v16h-6M10 8l-4 4 4 4M6 12h10"/>
  </Svg>
);

export const ArchiveIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="butt" {...props}>
    <path d="M3 4h18v4H3zM5 8v12h14V8M10 12h4"/>
  </Svg>
);

export const SearchIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="miter" {...props}>
    <circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>
  </Svg>
);

export const WifiIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="miter" {...props}>
    <path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0"/><circle cx="12" cy="19" r="1"/>
  </Svg>
);

export const ShieldIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="butt" {...props}>
    <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>
  </Svg>
);

export const TabHomeIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M3.5 11.2 12 4.5l8.5 6.7"/><path d="M6 10v9.5h12V10"/><path d="M10 19.5v-5h4v5"/>
  </Svg>
);

export const TabJournalIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <rect x="5" y="3.5" width="14" height="17" rx="2.5"/><path d="M8.5 8h7M8.5 11.5h7M8.5 15h4"/><path d="M15.5 3.5v3l1.3-1 1.2 1v-3"/>
  </Svg>
);

export const TabInsightsIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M4 19.5h16"/><path d="M5 14.5 9.5 10l3.5 3 6-6.5"/><circle cx="19" cy="6.5" r="1.9" fill="currentColor" stroke="none"/>
  </Svg>
);

export const TabCarIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M4 13.5 5.7 9a2 2 0 0 1 1.9-1.3h8.8a2 2 0 0 1 1.9 1.3l1.7 4.5"/><path d="M3.5 13.5h17v4a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z"/><circle cx="7.5" cy="16" r="1.1" fill="currentColor" stroke="none"/><circle cx="16.5" cy="16" r="1.1" fill="currentColor" stroke="none"/><path d="M8 7.7V6.5M16 7.7V6.5"/>
  </Svg>
);

export const TabPumpIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <rect x="4" y="3.5" width="9.5" height="17" rx="2"/><rect x="6.3" y="6.2" width="4.9" height="3.6" rx=".8" fill="currentColor" stroke="none"/><path d="M2.8 20.5h12"/><path d="M13.5 9.5h2a1.8 1.8 0 0 1 1.8 1.8v5a1.7 1.7 0 0 0 3.4 0V9.2l-2.4-2.4"/>
  </Svg>
);

export const TireIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="miter" {...props}>
    <circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.2"/><path d="M12 3.5v5.3M12 15.2v5.3M3.5 12h5.3M15.2 12h5.3"/>
  </Svg>
);

export const OilIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M12 3.5s5.5 6 5.5 10a5.5 5.5 0 0 1-11 0c0-4 5.5-10 5.5-10z"/><path d="M9.5 14a2.5 2.5 0 0 0 2.5 2.5"/>
  </Svg>
);

export const BrakeIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="miter" {...props}>
    <circle cx="11" cy="13" r="7.5"/><circle cx="11" cy="13" r="2.3"/><path d="M15.5 3.5a9.5 9.5 0 0 1 5 5" strokeWidth="3"/>
  </Svg>
);

export const BatteryIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <rect x="3" y="7.5" width="18" height="12" rx="2"/><path d="M6.5 7.5V5.5h3v2M14.5 7.5V5.5h3v2"/><path d="M6.5 13.5h3.5M14 13.5h3.5M15.75 11.75v3.5"/>
  </Svg>
);

export const ToolsIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M13.5 4h5l1.5 3-3 1.5-2-2z"/><path d="m15 6.5-9.6 9.6a1.8 1.8 0 0 0 2.5 2.5L17.5 9"/>
  </Svg>
);

export const ParkingIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M10 16.5v-9h3a2.5 2.5 0 0 1 0 5h-3"/>
  </Svg>
);

export const RoadIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="miter" {...props}>
    <path d="M8 3.5 4.5 20.5M16 3.5l3.5 17M12 4.5V7M12 10.5v3M12 17v3"/>
  </Svg>
);

export const DropIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M11 5s5 5.5 5 9a5 5 0 0 1-10 0c0-3.5 5-9 5-9z"/><path d="M19 3.5v3.5M17.25 5.25h3.5"/>
  </Svg>
);

export const TicketIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="butt" {...props}>
    <path d="M3.5 7h17v3a2 2 0 0 0 0 4v3h-17v-3a2 2 0 0 0 0-4z"/><path d="M14.5 7.5v9" strokeDasharray="1.6 2.2"/>
  </Svg>
);

export const CalendarIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="butt" {...props}>
    <path d="M4 6h16v14H4zM4 10h16M8 3v5M16 3v5"/>
  </Svg>
);

/** Stable legacy exports remain available to existing screens. */

export const SlidersIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M6.5 4.5v5.3" />
    <circle cx="6.5" cy="12" r="2.2" />
    <path d="M6.5 14.2v5.3" />
    <path d="M12 4.5v2.3" />
    <circle cx="12" cy="9" r="2.2" />
    <path d="M12 11.2v8.3" />
    <path d="M17.5 4.5v7.8" />
    <circle cx="17.5" cy="14.5" r="2.2" />
    <path d="M17.5 16.7v2.8" />
  </Svg>
);

export const CarSideIcon = (props: IconProps) => (
  <Svg strokeWidth={1.8} {...props}>
    <path d="M3 16H2v-4l3-1 3-5h7l4 5 3 2v3h-2M8 16h8M5 11h14M10 6v5" />
    <circle cx="5.5" cy="16" r="2"/><circle cx="18.5" cy="16" r="2"/>
  </Svg>
);

export const ArrowUp = (props: IconProps) => (
  <Svg strokeWidth={2.4} {...props}>
    <path d="M12 19V6" />
    <path d="M6.5 11.5 12 6l5.5 5.5" />
  </Svg>
);

export const ArrowDown = (props: IconProps) => (
  <Svg strokeWidth={2.4} {...props}>
    <path d="M12 5v13" />
    <path d="M17.5 12.5 12 18l-5.5-5.5" />
  </Svg>
);

/** Two opposing arrows: a value that flips between two periods (v3 TCO "בחודש ⇅"). */
export const SwapIcon = (props: IconProps) => (
  <Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M7 16V5m0 0L3.5 8.5M7 5l3.5 3.5M17 8v11m0 0 3.5-3.5M17 19l-3.5-3.5"/>
  </Svg>
);

export const InfoIcon = (props: IconProps) => (
  <Svg strokeWidth={1.8} {...props}>
    <circle cx="12" cy="12" r="8.2" />
    <path d="M12 11v5" />
    <circle cx="12" cy="8.1" r="0.6" fill="currentColor" stroke="none" />
  </Svg>
);

export const RestoreIcon = (props: IconProps) => (
  <Svg strokeWidth={1.8} {...props}>
    <path d="M4.5 10.5A8 8 0 1 1 5 15.2" />
    <path d="M4.2 5.5v5h5" />
  </Svg>
);

export const SunIcon = (props: IconProps) => (
  <Svg strokeWidth={1.8} {...props}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
  </Svg>
);

export const DeviceIcon = (props: IconProps) => (
  <Svg strokeWidth={1.8} {...props}>
    <rect x="4" y="4.5" width="16" height="11" rx="1.8" />
    <path d="M9 19.5h6" />
    <path d="M12 15.5v4" />
  </Svg>
);

export const PaletteIcon = (props: IconProps) => (
  <Svg strokeWidth={1.8} {...props}>
    <path d="M12 3.6a8.4 8.4 0 0 0 0 16.8c1 0 1.7-.8 1.7-1.7 0-.5-.2-.9-.5-1.2a1.7 1.7 0 0 1 1.2-2.9h2A3.9 3.9 0 0 0 20.4 11c0-4.1-3.8-7.4-8.4-7.4z" />
    <circle cx="8" cy="10.5" r="1" fill="currentColor" stroke="none" />
    <circle cx="12" cy="7.8" r="1" fill="currentColor" stroke="none" />
    <circle cx="15.8" cy="10" r="1" fill="currentColor" stroke="none" />
  </Svg>
);

export const UserIcon = (props: IconProps) => (
  <Svg strokeWidth={1.8} {...props}>
    <circle cx="12" cy="8.4" r="3.8" />
    <path d="M4.8 20c.9-3.6 3.7-5.6 7.2-5.6s6.3 2 7.2 5.6" />
  </Svg>
);

export const PhoneIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="6.4" y="2.8" width="11.2" height="18.4" rx="2.6" />
    <path d="M10.6 18.4h2.8" />
  </Svg>
);

export const RefreshIcon = (props: IconProps) => (
  <Svg strokeWidth={1.8} {...props}>
    <path d="M19.5 10.5A8 8 0 1 0 19 15.2" />
    <path d="M19.8 5.5v5h-5" />
  </Svg>
);

export const CloudOffIcon = (props: IconProps) => (
  <Svg strokeWidth={1.8} {...props}>
    <path d="M8.5 18.5h8.2a3.8 3.8 0 0 0 .6-7.5A5.6 5.6 0 0 0 8.8 7.4" />
    <path d="M6.6 10.6a3.9 3.9 0 0 0 .7 7.8" />
    <path d="M3.5 3.5 20.5 20.5" />
  </Svg>
);

export const HeartIcon = (props: IconProps) => (
  <Svg strokeWidth={1.8} {...props}>
    <path d="M12 20s-7.2-4.4-7.2-9.4A4.3 4.3 0 0 1 12 8.2a4.3 4.3 0 0 1 7.2 2.4c0 5-7.2 9.4-7.2 9.4z" />
  </Svg>
);

export const LightbulbIcon = (props: IconProps) => (
  <Svg strokeWidth={1.8} {...props}>
    <path d="M9.2 17.2a6 6 0 1 1 5.6 0" />
    <path d="M9.6 17.4h4.8" />
    <path d="M10.4 20.2h3.2" />
  </Svg>
);

export const SparkleIcon = (props: IconProps) => (
  <Svg strokeWidth={1.7} {...props}>
    <path d="M12 3.4l1.9 5.1 5.1 1.9-5.1 1.9-1.9 5.1-1.9-5.1L5 10.4l5.1-1.9z" />
    <path d="M18.6 16.4l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z" />
  </Svg>
);

export const CopyIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="9" y="9" width="11" height="11" rx="2.4" />
    <path d="M15 6.2V5.4A1.4 1.4 0 0 0 13.6 4H5.4A1.4 1.4 0 0 0 4 5.4v8.2A1.4 1.4 0 0 0 5.4 15h.8" />
  </Svg>
);

export const GoogleMark = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <path
      fill="#4285F4"
      d="M45.1 24.5c0-1.6-.1-2.8-.4-4H24v7.3h12.1c-.2 2-1.6 5-4.5 7l6.9 5.3c4.1-3.8 6.6-9.4 6.6-15.6z"
    />
    <path
      fill="#34A853"
      d="M24 46c5.9 0 10.9-2 14.5-5.3l-6.9-5.3c-1.8 1.3-4.3 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.1l-7.1 5.5C8.1 41.1 15.4 46 24 46z"
    />
    <path
      fill="#FBBC05"
      d="M11.5 28.5c-.5-1.4-.7-2.9-.7-4.5s.3-3.1.7-4.5l-7.1-5.5C2.9 17 2 20.4 2 24s.9 7 2.4 10z"
    />
    <path
      fill="#EA4335"
      d="M24 10.2c4.1 0 6.9 1.8 8.5 3.3l6.2-6C34.9 4 29.9 2 24 2 15.4 2 8.1 6.9 4.4 14l7.1 5.5c1.8-5.3 6.7-9.3 12.5-9.3z"
    />
  </svg>
);

export const AppMark = ({ size = 30, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <path d="M14 41A21 21 0 1 1 50 41" stroke={color} strokeWidth="4.5" strokeLinecap="round" />
    <path d="M32 36 45 26" stroke={color} strokeWidth="4" strokeLinecap="round" />
    <circle cx="32" cy="37" r="4" fill={color} />
  </svg>
);

const DESIGN_ICONS = {
  "pump": PumpIcon,
  "home": HomeIcon,
  "list": ListIcon,
  "chart": ChartIcon,
  "car": CarIcon,
  "x": CloseIcon,
  "cam": CameraIcon,
  "pin": PinIcon,
  "clock": ClockIcon,
  "chev": ChevronStart,
  "back": ChevronEnd,
  "down": ChevronDown,
  "plus": PlusIcon,
  "wrench": WrenchIcon,
  "coin": CoinIcon,
  "gauge": GaugeIcon,
  "bell": BellIcon,
  "check": CheckIcon,
  "alert": WarningIcon,
  "trash": TrashIcon,
  "edit": PencilIcon,
  "upload": UploadIcon,
  "download": DownloadIcon,
  "cloud": CloudIcon,
  "chat": MessageIcon,
  "doc": DocumentIcon,
  "share": ShareIcon,
  "moon": MoonIcon,
  "users": UsersIcon,
  "tag": TagIcon,
  "out": LogoutIcon,
  "archive": ArchiveIcon,
  "search": SearchIcon,
  "wifi": WifiIcon,
  "shield": ShieldIcon,
  "t-home": TabHomeIcon,
  "t-journal": TabJournalIcon,
  "t-insights": TabInsightsIcon,
  "t-car": TabCarIcon,
  "t-pump": TabPumpIcon,
  "tire": TireIcon,
  "oil": OilIcon,
  "brake": BrakeIcon,
  "battery": BatteryIcon,
  "tools": ToolsIcon,
  "parking": ParkingIcon,
  "road": RoadIcon,
  "drop": DropIcon,
  "ticket": TicketIcon,
  "calendar": CalendarIcon,
  "swap": SwapIcon,
} as const;

export type DesignIconName = keyof typeof DESIGN_ICONS;

export function DesignIcon({ name, ...props }: IconProps & { name: DesignIconName }) {
  const Icon = DESIGN_ICONS[name];
  return <Icon {...props} />;
}
