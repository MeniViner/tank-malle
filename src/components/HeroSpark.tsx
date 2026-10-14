import { useId } from "react";
import type { Segment } from "../lib/stats";
import { normalise, smoothPath } from "../lib/curve";

const SPARK_SEGMENTS = 6;

/**
 * The last few continuous closed segments, as a filled trend.
 *
 * The curve is the shape the individual results make —
 * a run of six numbers is a lot easier to read as a direction than as six
 * heights. Newest sits at the reading start of the row, which in RTL is the
 * left end, so the eye lands on the most recent result first.
 *
 * Decoration for the number above it: every figure it encodes is already
 * written out in text, so it is hidden from assistive tech rather than given
 * labels nobody asked for.
 */
export function HeroSpark({ segments }: { segments: Segment[] }) {
  const clipId = useId().replace(/:/g, "");
  // Never draw a measured trend across an undocumented-history break.
  let start = segments.length - 1;
  while (start > 0 && segments[start].startId === segments[start - 1].endId) start -= 1;
  const recent = segments.slice(Math.max(start, segments.length - SPARK_SEGMENTS));
  if (recent.length < 2) return null;

  // SVG x always runs left to right, so the series is reversed to put the
  // newest result on the left the way the rest of the row reads.
  const series = [...recent].reverse();
  const heights = normalise(series.map((segment) => segment.kmPerLiter));

  const width = 100;
  const height = 40;
  const gap = 1.6;
  const barWidth = (width - gap * (series.length - 1)) / series.length;
  // A flat run would otherwise collapse to a row of slivers, so the scale
  // starts a third of the way up rather than at zero.
  const topFor = (value: number) => height - (34 + 62 * value) * (height / 100);

  const points = series.map((_, index) => ({
    x: index * (barWidth + gap) + barWidth / 2,
    y: topFor(heights[index]),
  }));

  // Run the curve out to both edges so it reads as a continuing trend rather
  // than a line that starts and stops inside the card.
  const curve = smoothPath([
    { x: 0, y: points[0].y },
    ...points,
    { x: width, y: points[points.length - 1].y },
  ]);

  const newestEdge = barWidth + gap / 2;
  const area = `${curve} L ${width} ${height} L 0 ${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="h-[46px] w-full overflow-visible"
      aria-hidden="true"
    >
      <defs>
        {/* The newest result is highlighted by clipping a second copy of the
            same geometry, so the fill and the curve above it can never disagree
            about where "newest" ends. */}
        <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
          <rect x={0} y={-8} width={newestEdge} height={height + 16} />
        </clipPath>
      </defs>

      {/* Both colours share the exact curve boundary and baseline. Bars left
          gaps and flat tops that disagreed with the smoothed trend. */}
      <path d={area} className="fill-hero-soft" />
      <path d={area} className="fill-hero-accent" opacity={0.85} clipPath={`url(#${clipId})`} />

      <path
        d={curve}
        fill="none"
        stroke="var(--hero-ink)"
        strokeOpacity={0.7}
        strokeWidth={1.6}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={curve}
        fill="none"
        stroke="var(--hero-accent)"
        strokeWidth={2.2}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        clipPath={`url(#${clipId})`}
      />
    </svg>
  );
}
