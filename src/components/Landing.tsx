import type { ReactNode } from "react";
import { ConsumptionValue, Distance, Money, SignedPercent } from "./Fmt";
import { ArrowUp } from "./icons";

/**
 * Pieces of the public landing / sign-in composition.
 *
 * This surface is a fixed brand composition — dark green over a white sheet —
 * rather than a themed product screen, so the colours here are literal instead
 * of semantic tokens: the hero must not turn white because the device is in
 * light mode, and the sheet must not turn near-black in dark mode. Everything
 * behind the sign-in wall keeps using the tokens as usual.
 *
 * The figures are static onboarding demo values. Nothing here reads Firestore:
 * an anonymous visitor has no data, and querying for some would be a request
 * the rules would rightly refuse.
 */

/** The one colour the SVG and the badge need as a literal attribute value. */
const GREEN = "#0F6B58";

/** The white statistics card that straddles the hero and the sheet below it. */
export function LandingStatsPreview() {
  // A believable consumption curve — deliberately not a straight line. The
  // last point is the one the dot marks, so the series has to end high.
  const points = [
    [4, 54],
    [44, 44],
    [84, 48],
    [124, 36],
    [164, 40],
    [204, 22],
    [244, 26],
    [296, 8],
  ];

  return (
    <div
      className="rounded-[22px] bg-white p-[18px]"
      style={{
        boxShadow: "0 18px 40px rgb(10 58 49 / 0.22), 0 0 0 1px rgb(10 58 49 / 0.06)",
      }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[13.5px] font-semibold tracking-[0.2px] text-[rgb(18_33_29/0.55)]">
          צריכה ממוצעת
        </span>
        {/* SignedPercent keeps the leading "+" glued to the digits — writing
            the sign by hand inside RTL text is what produced "5%+". */}
        <span
          className="flex items-center gap-1 rounded-[8px] bg-[#E4F1EB] px-[9px] py-1 text-[12.5px] font-bold"
          style={{ color: GREEN }}
        >
          <SignedPercent value={5} />
          <ArrowUp size={9} />
        </span>
      </div>

      <ConsumptionValue
        kmPerLiter={12.4}
        units="kmPerLiter"
        className="mt-2 flex items-baseline gap-1.5 text-[40px] font-extrabold leading-none tracking-[-1.2px] text-[#12211D]"
        unitClassName="text-[14px] font-semibold tracking-normal text-[rgb(18_33_29/0.45)]"
      />

      {/* Inline SVG rather than the charting library: this is a still picture
          of a trend, and Recharts is the heaviest thing in the bundle. */}
      <svg
        viewBox="0 0 300 66"
        width="100%"
        height="62"
        preserveAspectRatio="none"
        className="mt-2.5 block"
        aria-hidden="true"
      >
        <line
          x1="0"
          y1="30"
          x2="300"
          y2="30"
          stroke="rgb(18 33 29 / 0.1)"
          strokeWidth="1.5"
          strokeDasharray="5 6"
        />
        <polyline
          points={points.map(([x, y]) => `${x},${y}`).join(" ")}
          fill="none"
          stroke={GREEN}
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="296" cy="8" r="4.5" fill={GREEN} />
      </svg>

      <div className="mt-3 flex gap-2.5 border-t border-[rgb(18_33_29/0.07)] pt-3.5">
        <LandingMetric label="החודש">
          <Money value={642} />
        </LandingMetric>
        <span aria-hidden="true" className="w-px bg-[rgb(18_33_29/0.07)]" />
        <LandingMetric label="טווח">
          <Distance value={620} />
        </LandingMetric>
      </div>
    </div>
  );
}

function LandingMetric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex-1">
      <div className="text-[12px] font-semibold text-[rgb(18_33_29/0.5)]">{label}</div>
      <div className="mt-[3px] text-[17px] font-bold text-[#12211D]">{children}</div>
    </div>
  );
}

/** One of the three compact capability tiles under the statistics card. */
export function LandingBenefitTile({ children }: { children: ReactNode }) {
  return (
    <span className="flex-1 rounded-[14px] bg-[#F5F7F6] px-1.5 py-3 text-center text-[12.5px] font-bold leading-[1.3] text-[#2A3B36]">
      {children}
    </span>
  );
}
