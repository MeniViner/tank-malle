import type { SVGProps } from "react";

/**
 * Icon set traced from the design export. All icons are 24×24 stroked paths
 * that inherit `currentColor`, so they follow the token palette everywhere.
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 24, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const HomeIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M4.5 11.2 12 4.6l7.5 6.6" />
    <path d="M6.3 9.8V19a1 1 0 0 0 1 1h3.2v-4.6h3V20h3.2a1 1 0 0 0 1-1V9.8" />
  </Svg>
);

export const ClockIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="8.2" />
    <path d="M12 7.6V12l2.9 2.1" />
  </Svg>
);

export const ChartIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M4 19.5h16" />
    <path d="M4.5 15.5l4.2-4.6 3.4 3 6.4-7.4" />
    <circle cx="18.5" cy="6.5" r="1.6" />
  </Svg>
);

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

export const PumpIcon = (props: IconProps) => (
  <Svg strokeWidth={1.8} {...props}>
    <path d="M4 20.5V5.2A1.7 1.7 0 0 1 5.7 3.5h5.6A1.7 1.7 0 0 1 13 5.2v15.3" />
    <path d="M3 20.5h11" />
    <path d="M6.2 6.5h4.6v3.4H6.2z" />
    <path d="M13 9h1.6a1.7 1.7 0 0 1 1.7 1.7v5.6a1.35 1.35 0 0 0 2.7 0V9.4a1.9 1.9 0 0 0-.55-1.34L16.4 6" />
  </Svg>
);

export const CarIcon = (props: IconProps) => (
  <Svg strokeWidth={1.8} {...props}>
    <path d="M19 17h2v-3.3l-1.6-4A2 2 0 0 0 17.5 8.5h-11A2 2 0 0 0 4.6 9.7L3 13.7V17h2" />
    <circle cx="7.5" cy="17" r="2" />
    <path d="M9.5 17h5" />
    <circle cx="16.5" cy="17" r="2" />
    <path d="M5 11.5h14" />
  </Svg>
);

export const CalendarIcon = (props: IconProps) => (
  <Svg strokeWidth={1.8} {...props}>
    <rect x="3.8" y="5" width="16.4" height="15" rx="2.2" />
    <path d="M3.8 9.8h16.4" />
    <path d="M8.2 3v3.4" />
    <path d="M15.8 3v3.4" />
  </Svg>
);

export const PinIcon = (props: IconProps) => (
  <Svg strokeWidth={1.8} {...props}>
    <path d="M12 21s6.5-5.4 6.5-10a6.5 6.5 0 0 0-13 0c0 4.6 6.5 10 6.5 10z" />
    <circle cx="12" cy="11" r="2.4" />
  </Svg>
);

export const GaugeIcon = (props: IconProps) => (
  <Svg strokeWidth={1.8} {...props}>
    <path d="M5 17a8.5 8.5 0 1 1 14 0" />
    <path d="M12 14.5 16.2 10" />
    <circle cx="12" cy="15.2" r="1.6" fill="currentColor" stroke="none" />
  </Svg>
);

export const ChevronDown = (props: IconProps) => (
  <Svg strokeWidth={2} {...props}>
    <path d="M6.5 9.5l5.5 5.5 5.5-5.5" />
  </Svg>
);

/** Points toward the start of the line in RTL (i.e. visually to the right). */
export const ChevronStart = (props: IconProps) => (
  <Svg strokeWidth={2} {...props}>
    <path d="M14.5 6.5 9 12l5.5 5.5" />
  </Svg>
);

export const ChevronEnd = (props: IconProps) => (
  <Svg strokeWidth={2} {...props}>
    <path d="M9.5 6.5 15 12l-5.5 5.5" />
  </Svg>
);

export const CloseIcon = (props: IconProps) => (
  <Svg strokeWidth={2.1} {...props}>
    <path d="M6 6l12 12" />
    <path d="M18 6 6 18" />
  </Svg>
);

export const PlusIcon = (props: IconProps) => (
  <Svg strokeWidth={2.1} {...props}>
    <path d="M12 5.5v13" />
    <path d="M5.5 12h13" />
  </Svg>
);

export const CheckIcon = (props: IconProps) => (
  <Svg strokeWidth={2.4} {...props}>
    <path d="M5 12.5l4.6 4.5L19 7.5" />
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

export const InfoIcon = (props: IconProps) => (
  <Svg strokeWidth={1.8} {...props}>
    <circle cx="12" cy="12" r="8.2" />
    <path d="M12 11v5" />
    <circle cx="12" cy="8.1" r="0.6" fill="currentColor" stroke="none" />
  </Svg>
);

export const WarningIcon = (props: IconProps) => (
  <Svg strokeWidth={1.9} {...props}>
    <path d="M12 4.4 21 19.6H3z" />
    <path d="M12 10v4" />
    <circle cx="12" cy="16.8" r="0.7" fill="currentColor" stroke="none" />
  </Svg>
);

export const SearchIcon = (props: IconProps) => (
  <Svg strokeWidth={1.9} {...props}>
    <circle cx="11" cy="11" r="6.4" />
    <path d="M15.8 15.8 20 20" />
  </Svg>
);

export const PencilIcon = (props: IconProps) => (
  <Svg strokeWidth={1.8} {...props}>
    <path d="M4.5 19.5h3.2L18.4 8.8a2.2 2.2 0 0 0-3.2-3.1L4.5 16.3z" />
    <path d="M14.2 6.8l3.1 3.1" />
  </Svg>
);

export const TrashIcon = (props: IconProps) => (
  <Svg strokeWidth={1.8} {...props}>
    <path d="M4.6 6.6h14.8" />
    <path d="M9.4 6.6V4.9a1.2 1.2 0 0 1 1.2-1.2h2.8a1.2 1.2 0 0 1 1.2 1.2v1.7" />
    <path d="M6.6 6.6 7.5 19a1.4 1.4 0 0 0 1.4 1.3h6.2A1.4 1.4 0 0 0 16.5 19l.9-12.4" />
    <path d="M10.4 10.2v6" />
    <path d="M13.6 10.2v6" />
  </Svg>
);

export const ArchiveIcon = (props: IconProps) => (
  <Svg strokeWidth={1.8} {...props}>
    <rect x="3.6" y="4.4" width="16.8" height="4.2" rx="1.4" />
    <path d="M5.2 8.6V18a1.6 1.6 0 0 0 1.6 1.6h10.4A1.6 1.6 0 0 0 18.8 18V8.6" />
    <path d="M10 12.2h4" />
  </Svg>
);

export const RestoreIcon = (props: IconProps) => (
  <Svg strokeWidth={1.8} {...props}>
    <path d="M4.5 10.5A8 8 0 1 1 5 15.2" />
    <path d="M4.2 5.5v5h5" />
  </Svg>
);

export const DownloadIcon = (props: IconProps) => (
  <Svg strokeWidth={1.8} {...props}>
    <path d="M12 4.5v10.2" />
    <path d="M8 11l4 4 4-4" />
    <path d="M4.8 18.2h14.4" />
  </Svg>
);

/** Arrow into a tray — data coming in. */
export const UploadIcon = (props: IconProps) => (
  <Svg strokeWidth={1.8} {...props}>
    <path d="M4.8 15.4v3.2a1.6 1.6 0 0 0 1.6 1.6h11.2a1.6 1.6 0 0 0 1.6-1.6v-3.2" />
    <path d="M8 8.6 12 4.6l4 4" />
    <path d="M12 4.6v10.8" />
  </Svg>
);

export const LogoutIcon = (props: IconProps) => (
  <Svg strokeWidth={1.8} {...props}>
    <path d="M14.5 7.5V5.9a1.6 1.6 0 0 0-1.6-1.6H6.4A1.6 1.6 0 0 0 4.8 5.9v12.2a1.6 1.6 0 0 0 1.6 1.6h6.5a1.6 1.6 0 0 0 1.6-1.6v-1.6" />
    <path d="M9.8 12h9.4" />
    <path d="M16.4 8.8 19.6 12l-3.2 3.2" />
  </Svg>
);

/** Two figures — the account switcher. */
export const UsersIcon = (props: IconProps) => (
  <Svg strokeWidth={1.8} {...props}>
    <path d="M15.6 20.4v-1.7a3.4 3.4 0 0 0-3.4-3.4H6.6a3.4 3.4 0 0 0-3.4 3.4v1.7" />
    <circle cx="9.4" cy="7.9" r="3.4" />
    <path d="M20.8 20.4v-1.7a3.4 3.4 0 0 0-2.5-3.3" />
    <path d="M15.6 4.7a3.4 3.4 0 0 1 0 6.6" />
  </Svg>
);

export const ShieldIcon = (props: IconProps) => (
  <Svg strokeWidth={1.8} {...props}>
    <path d="M12 3.6 19 6v5.4c0 4.2-2.9 7.6-7 8.9-4.1-1.3-7-4.7-7-8.9V6z" />
    <path d="M9.2 12.2l2 2 3.6-3.9" />
  </Svg>
);

export const SunIcon = (props: IconProps) => (
  <Svg strokeWidth={1.8} {...props}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
  </Svg>
);

export const MoonIcon = (props: IconProps) => (
  <Svg strokeWidth={1.8} {...props}>
    <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4 8.4 8.4 0 1 0 20 14.2z" />
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

export const MessageIcon = (props: IconProps) => (
  <Svg strokeWidth={1.8} {...props}>
    <path d="M20.2 12.4c0 3.8-3.7 6.9-8.2 6.9a9.7 9.7 0 0 1-2.6-.35L4.8 20.2l1.3-3.4a6.6 6.6 0 0 1-2.3-4.9c0-3.8 3.7-6.9 8.2-6.9s8.2 3.1 8.2 6.9z" />
  </Svg>
);

export const SparkleIcon = (props: IconProps) => (
  <Svg strokeWidth={1.7} {...props}>
    <path d="M12 3.4l1.9 5.1 5.1 1.9-5.1 1.9-1.9 5.1-1.9-5.1L5 10.4l5.1-1.9z" />
    <path d="M18.6 16.4l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z" />
  </Svg>
);

export const ShareIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="18" cy="5.8" r="2.6" />
    <circle cx="6" cy="12" r="2.6" />
    <circle cx="18" cy="18.2" r="2.6" />
    <path d="M8.3 10.8 15.7 7.1" />
    <path d="m8.3 13.2 7.4 3.7" />
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

/** App mark: the fuel-gauge needle from the design export. */
export const AppMark = ({ size = 30, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <path d="M14 41A21 21 0 1 1 50 41" stroke={color} strokeWidth="4.5" strokeLinecap="round" />
    <path d="M32 36 45 26" stroke={color} strokeWidth="4" strokeLinecap="round" />
    <circle cx="32" cy="37" r="4" fill={color} />
  </svg>
);
