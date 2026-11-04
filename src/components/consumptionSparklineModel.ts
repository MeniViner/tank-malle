import type { Segment } from "../lib/stats";
import { consumptionComparison } from "../lib/consumptionPresentation";

export type ConsumptionUnits = "kmPerLiter" | "litersPer100";
interface Point { segment: Segment; value: number; x: number; y: number }
export const WIDTH = 350;
export const HEIGHT = 156;
export const BASELINE = 128;
const coordinate = (value: number) => Math.round(value * 100) / 100;

function smoothPath(points: Point[]) {
  if (!points.length) return "";
  let path = `M ${coordinate(points[0].x)} ${coordinate(points[0].y)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index - 1] ?? points[index];
    const current = points[index];
    const next = points[index + 1];
    const following = points[index + 2] ?? next;
    path += ` C ${coordinate(current.x + (next.x - previous.x) / 6)} ${coordinate(current.y + (next.y - previous.y) / 6)}, ${coordinate(next.x - (following.x - current.x) / 6)} ${coordinate(next.y - (following.y - current.y) / 6)}, ${coordinate(next.x)} ${coordinate(next.y)}`;
  }
  return path;
}

/** Presentation geometry only: the production stats engine supplies every segment and average. */
export function consumptionSparklineModel(segments: Segment[], units: ConsumptionUnits, average: number | null) {
  const recent = segments.filter((segment) => Number.isFinite(segment.kmPerLiter) && segment.kmPerLiter > 0).slice(-6);
  const convert = (value: number) => units === "litersPer100" ? 100 / value : value;
  const knownAverage = average !== null && Number.isFinite(average) && average > 0;
  const averageValue = knownAverage ? convert(average) : null;
  // Convert the same canonical interval, not ±7% of an inverted average.
  const band = knownAverage ? [convert(average * .93), convert(average * 1.07)].sort((a, b) => a - b) : null;
  const values = recent.map((segment) => convert(segment.kmPerLiter));
  const domain = [...values, ...(band ?? [])];
  const minimum = domain.length ? Math.min(...domain) : 0;
  const maximum = domain.length ? Math.max(...domain) : 1;
  const padding = Math.max((maximum - minimum) * .18, .6);
  const low = Math.max(0, minimum - padding);
  const high = maximum + padding;
  const y = (value: number) => 28 + (1 - (value - low) / (high - low)) * (BASELINE - 28);
  const points: Point[] = recent.map((segment, index) => ({
    segment, value: values[index],
    x: recent.length === 1 ? WIDTH / 2 : WIDTH - 22 - index * (WIDTH - 44) / (recent.length - 1),
    y: y(values[index]),
  }));
  const islands: Point[][] = [];
  for (const point of points) {
    const island = islands.at(-1);
    if (island?.at(-1)?.segment.endId === point.segment.startId) island.push(point);
    else islands.push([point]);
  }
  const last = recent.at(-1);
  const tone = consumptionComparison(last?.kmPerLiter ?? null, average)?.tone ?? "neutral";
  return {
    points, tone, averageValue,
    band: band ? { low: band[0], high: band[1], y: y(band[1]), height: y(band[0]) - y(band[1]) } : null,
    paths: islands.filter((island) => island.length > 1).map((island) => {
      const line = smoothPath(island);
      return { key: island[0].segment.endId, line, area: `${line} L ${coordinate(island.at(-1)!.x)} ${BASELINE} L ${coordinate(island[0].x)} ${BASELINE} Z` };
    }),
  };
}
