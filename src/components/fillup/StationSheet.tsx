import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { FuelPrices, FuelType, Station } from "../../lib/types";
import { loadStationCatalog, searchStationOptions, stationOptionsByDistance, stationKey, toStation, formatDistance, type GeoResult, type StationSearchResult } from "../../lib/stations";
import { publicPriceStationId, reusableStationName } from "../../lib/fillupPricing";
import { adaptLegacyConfig } from "../../lib/prices/regulated";
import { resolveStationPrice, stationPriceView, type StationPriceView } from "../../lib/prices/resolver";
import { BEST_VALUE_UNAVAILABLE, SORT_LABELS, bestValueBlocker, rankStations, type StationCandidate, type StationSort } from "../../lib/prices/ranking";
import { Sheet } from "../Sheet";
import { CheckIcon, SearchIcon } from "../icons";
import { NumericText, NumRun } from "../Fmt";
import { price, relativeDate } from "../../lib/format";
import { StationBrandMark } from "../StationBrand";

export function StationSheet({
  fuelType,
  kmPerLiter,
  litersToBuy,
  prices,
  open,
  onClose,
  stations,
  lastPaid,
  nearby,
  geoStatus,
  onLocate,
  current,
  onPick,
}: {
  /** The ACTIVE vehicle's fuel type. Every price shown is for this and only this. */
  fuelType: FuelType;
  /** Measured consumption, for the best-value ranking. Null until one exists. */
  kmPerLiter: number | null;
  litersToBuy: number;
  prices: FuelPrices | null;
  open: boolean;
  onClose: () => void;
  stations: Station[];
  /** Station id or name → the price this user last paid there. */
  lastPaid: Map<string, { price: number; observedAt: number }>;
  nearby: GeoResult["nearby"];
  geoStatus: GeoResult["status"];
  /** Fresh location only: the parent must never select a station in this callback. */
  onLocate: () => Promise<GeoResult | null>;
  current: Station | null;
  onPick: (station: Station | null) => void;
}) {
  const regulated = useMemo(() => adaptLegacyConfig(prices), [prices]);

  /**
   * The price to show on a station row, for THIS vehicle's fuel type.
   *
   * Everything goes through the one resolver, so a diesel vehicle can never be
   * shown a 95 figure. What the ROW shows is then decided by `stationPriceView`,
   * which deliberately drops the regulated ceiling: it is the same nationwide
   * number on every station and repeating it down the list said nothing about
   * any of them.
   */
  const resolveFor = useCallback(
    (stationId: string | null) => resolveStationPrice({ stationId: publicPriceStationId({ stationId, name: "" }), fuelType, regulated }),
    [fuelType, regulated],
  );

  const viewFor = useCallback((stationId: string | null, name?: string | null): StationPriceView => {
    const resolved = resolveFor(stationId);
    const reusableName = reusableStationName(name);
    const personal = stationId ? lastPaid.get(`id:${stationId}`) ?? null
      : reusableName ? lastPaid.get(`name:${reusableName}`) ?? null : null;
    // The caller verified raw price presence. A real paid zero remains distinct
    // from the resolver's absent-price fallback, without inventing a public price.
    if (personal?.price === 0 && (resolved.price === null || resolved.isCeiling)) {
      return { text: price(0), detail: `שילמת כאן · ${relativeDate(personal.observedAt)}`, kind: 'personal', stale: false };
    }
    return stationPriceView(resolved, personal);
  }, [resolveFor, lastPaid]);

  const [sort, setSort] = useState<StationSort>("nearest");

  /**
   * Nearby stations, ordered.
   *
   * Every price is resolved for the ACTIVE vehicle's fuel type before ranking,
   * so no order can end up comparing diesel against petrol.
   */
  const nearbyCandidates: StationCandidate[] = useMemo(
    () =>
      nearby.map((entry) => ({
        station: entry,
        distanceMeters: entry.distance,
        price: resolveFor(entry.i ?? null),
      })),
    [nearby, resolveFor],
  );

  const blocker = useMemo(
    () => bestValueBlocker(nearbyCandidates, { fuelType, kmPerLiter, litersToBuy }),
    [nearbyCandidates, fuelType, kmPerLiter, litersToBuy],
  );

  const rankedNearby = useMemo(
    () =>
      rankStations(nearbyCandidates, sort === "bestValue" && blocker ? "nearest" : sort, {
        fuelType,
        kmPerLiter,
        litersToBuy,
      }),
    [nearbyCandidates, sort, blocker, fuelType, kmPerLiter, litersToBuy],
  );
  const [query, setQuery] = useState("");
  const [nearbyPosition, setNearbyPosition] = useState<GeoResult["position"]>(null);
  const [ordering, setOrdering] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [visibleCount, setVisibleCount] = useState(30);
  const locationRequest = useRef({ generation: 0 });
  const [catalog, setCatalog] = useState<Awaited<ReturnType<typeof loadStationCatalog>>>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const requests = locationRequest.current;
    void loadStationCatalog().then((next) => {
      if (!active) return;
      setCatalog(next);
      setCatalogLoading(false);
    });
    return () => { active = false; requests.generation++; };
  }, [open]);

  // The query is cleared by the events that close the sheet, not by an
  // effect watching `open`.
  const clear = () => {
    locationRequest.current.generation++;
    setQuery("");
    setNearbyPosition(null);
    setOrdering(false);
    setLocationError("");
    setVisibleCount(30);
  };
  const close = () => {
    clear();
    onClose();
  };
  const pick = (next: Station | null) => {
    clear();
    onPick(next);
  };

  const orderNearby = async () => {
    if (ordering) return;
    const request = ++locationRequest.current.generation;
    setOrdering(true);
    setLocationError("");
    try {
      const result = await onLocate();
      // Closing, selecting, unmounting or reopening invalidates this request.
      if (request !== locationRequest.current.generation || result === null) return;
      if (result.position && (result.status === "ok" || result.status === "none")) {
        setNearbyPosition(result.position);
        setVisibleCount(30);
      } else {
        const reason = result.status === "denied" ? "הרשאת המיקום נדחתה." : "לא הצלחנו לקבל מיקום.";
        setLocationError(`${reason} ${nearbyPosition ? "סדר התחנות הקודם נשמר." : "אפשר להמשיך לחפש או לנסות שוב."}`);
      }
    } catch {
      if (request === locationRequest.current.generation) setLocationError("לא הצלחנו לקבל מיקום. אפשר להמשיך לחפש או לנסות שוב.");
    } finally {
      if (request === locationRequest.current.generation) setOrdering(false);
    }
  };

  const matches = useMemo(
    () => nearbyPosition ? [] : searchStationOptions(catalog, stations, query),
    [catalog, stations, query, nearbyPosition],
  );
  const orderedMatches = useMemo(
    () => nearbyPosition ? stationOptionsByDistance(catalog, stations, query, nearbyPosition) : null,
    [catalog, stations, query, nearbyPosition],
  );
  const shownMatches: (StationSearchResult & { distance?: number | null })[] =
    orderedMatches?.slice(0, visibleCount) ?? matches;

  const trimmed = query.trim();

  return (
    <Sheet
      open={open}
      onClose={close}
      title="תחנת דלק"
    >
      <div className="flex max-h-[64vh] flex-col gap-3">
        <div className="flex min-h-[48px] items-center gap-2 rounded-md border border-line bg-surface px-3.5">
          <SearchIcon size={17} className="text-muted" />
          <input
            value={query}
            onChange={(event) => { setQuery(event.target.value); setVisibleCount(30); }}
            placeholder="חיפוש תחנה…"
            aria-label="חיפוש תחנה" className="min-h-[44px] min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted"
          />
        </div>

        <div className="flex flex-none items-center justify-between gap-3">
          <button type="button" className="fillup-text-action min-w-[44px]" data-testid="station-nearby-order"
            onClick={() => void orderNearby()} disabled={ordering} aria-busy={ordering}>בקרבתי</button>
          {ordering ? <span role="status" className="text-[12px] text-muted">מאתר מיקום…</span>
            : nearbyPosition ? <span className="text-[12px] text-muted">לפי מרחק בקו אווירי</span> : null}
        </div>
        {locationError ? <p role="status" className="text-[13px] text-muted">{locationError}</p> : null}

        <div className="no-scrollbar flex flex-col overflow-y-auto">
          {nearbyPosition || trimmed.length >= 2 ? (
            shownMatches.length > 0 ? (
              <>{shownMatches.map((entry) => (
                <StationRow
                  key={stationKey(entry.station)}
                  label={entry.station.name}
                  meta={[entry.source === "history" ? "תחנה מהיסטוריית התדלוקים" : entry.address,
                    entry.distance === undefined ? null : entry.distance === null ? "מרחק לא ידוע" : formatDistance(entry.distance)]
                    .filter(Boolean).join(" · ")}
                  brand={entry.station.brand}
                  view={viewFor(entry.station.stationId ?? null, entry.station.name)}
                  selected={current !== null && stationKey(current) === stationKey(entry.station)}
                  onClick={() => pick(entry.station)}
                />
              ))}
              {orderedMatches && shownMatches.length < orderedMatches.length ? (
                <button type="button" className="fillup-text-action" data-testid="station-show-more"
                  onClick={() => setVisibleCount(count => count + 30)}>עוד תחנות</button>
              ) : null}</>
            ) : (
              <div className="flex flex-col gap-2 py-5">
                <p className="text-center text-[14px] text-muted">
                  {catalogLoading
                    ? "טוען תחנות…"
                    : catalog
                      ? "לא נמצאה תחנה בשם הזה"
                      : "קטלוג התחנות אינו זמין כרגע — החיפוש כולל את התחנות מההיסטוריה"}
                </p>
                {trimmed.length >= 2 ? <button
                  type="button"
                  onClick={() => pick({ name: trimmed })}
                  className="min-h-[46px] rounded-pill bg-surface-2 text-[14px] font-semibold text-ink"
                >
                  שמירה בשם „<NumericText>{trimmed}</NumericText>״
                </button> : null}
              </div>
            )
          ) : (
            <>
              {/* Nearby first — it is almost always what the user wants. */}
              <SheetGroupLabel>
                בקרבתי
                {geoStatus === "locating" ? " · מאתר…" : ""}
              </SheetGroupLabel>

              {geoStatus === "denied" || geoStatus === "unavailable" ? (
                <button
                  type="button"
                  onClick={() => void orderNearby()}
                  disabled={ordering}
                  className="mb-1 min-h-[46px] rounded-md bg-surface-2 text-[14px] font-semibold text-ink"
                >
                  {geoStatus === "denied"
                    ? "הרשאת מיקום נדחתה — נסו שוב"
                    : "איתור מיקום אינו זמין — נסו שוב"}
                </button>
              ) : geoStatus === "none" ? (
                <p className="px-2 py-3 text-[13px] text-muted">
                  לא נמצאה תחנה במרחק של <NumRun>400</NumRun> מ׳ מכאן.
                </p>
              ) : nearby.length === 0 && geoStatus !== "locating" ? (
                <button
                  type="button"
                  onClick={() => void orderNearby()}
                  disabled={ordering}
                  className="mb-1 min-h-[46px] rounded-md bg-surface-2 text-[14px] font-semibold text-ink"
                >
                  איתור תחנות בקרבת מקום
                </button>
              ) : (
                <>
                  {/* One control, not a four-pill rail that spilled sideways
                      over the first result on a 360px screen. */}
                  <SortControl value={sort} onChange={setSort} />

                  {sort === "bestValue" && blocker ? (
                    <p className="pb-2 text-[12px] leading-relaxed text-muted">
                      {blocker === "no-consumption" ? "נדרשים שני מילויים עד הסוף לחישוב הצריכה." : BEST_VALUE_UNAVAILABLE[blocker]} מוצג לפי מרחק בינתיים.
                    </p>
                  ) : null}

                  {rankedNearby.map((entry) => (
                    <StationRow
                      key={`near-${entry.station.n}-${entry.station.lat}`}
                      label={entry.station.n}
                      meta={
                        entry.distanceMeters !== null
                          ? formatDistance(entry.distanceMeters)
                          : undefined
                      }
                      brand={entry.station.c}
                      view={viewFor(entry.station.i ?? null, entry.station.n)}
                      selected={current !== null && stationKey(current) === stationKey(toStation(entry.station))}
                      onClick={() => pick(toStation(entry.station))}
                    />
                  ))}
                </>
              )}

              {stations.length > 0 ? (
                <>
                  <SheetGroupLabel>תחנות שתדלקתי בהן</SheetGroupLabel>
                  {stations.map((entry) => (
                    <StationRow
                      key={stationKey(entry)}
                      label={entry.name}
                      brand={entry.brand}
                      view={viewFor(entry.stationId ?? null, entry.name)}
                      selected={current !== null && stationKey(current) === stationKey(entry)}
                      onClick={() => pick(entry)}
                    />
                  ))}
                </>
              ) : null}
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => pick(null)}
          className="min-h-[48px] flex-none rounded-pill bg-surface-2 text-[14.5px] font-semibold text-muted transition-[background-color,scale] duration-200 active:scale-[0.97]"
        >
          ללא מיקום
        </button>
      </div>
    </Sheet>
  );
}

function SheetGroupLabel({ children }: { children: ReactNode }) {
  return (
    <span className="px-1 pb-1 pt-2 text-[12px] font-semibold  text-muted">
      {children}
    </span>
  );
}

/**
 * One compact sort control.
 *
 * The four pills it replaces were laid out in a horizontally scrolling rail
 * that, at 360px, ran under the first station row and looked like part of it.
 */
function SortControl({ value, onChange }: { value: StationSort; onChange: (value: StationSort) => void }) {
  const options: StationSort[] = ["nearest", "cheapest", "freshest", "bestValue"];
  return <label className="fillup-station-sort">מיון
    <select aria-label="מיון תחנות" value={value} onChange={event => onChange(event.currentTarget.value as StationSort)}>
      {options.map(option => <option key={option} value={option}>{SORT_LABELS[option]}</option>)}
    </select>
  </label>;
}

function StationRow({
  label,
  meta,
  brand,
  view,
  selected,
  onClick,
}: {
  label: string;
  meta?: string;
  /** Company from the register, for the brand badge. */
  brand?: string | null;
  /**
   * What to show for the price, already decided for the active vehicle's fuel
   * type — see `stationPriceView` for which figure wins.
   */
  view: StationPriceView;
  selected: boolean;
  onClick: () => void;
}) {
  // A figure someone actually observed at this station is the only one worth
  // colouring; the nationwide ceiling stays quiet so it cannot be mistaken
  // for one.
  const known = view.kind === "station" || view.kind === "personal";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className="flex min-h-[54px] items-center gap-3 border-b border-line px-2 py-2 text-start transition-[background-color] duration-150 last:border-b-0 active:bg-surface-2"
    >
      <StationBrandMark brand={brand} name={label} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] font-semibold text-ink"><NumericText>{label}</NumericText></span>
        {meta ? <span className="truncate text-[12px] text-muted"><NumericText>{meta}</NumericText></span> : null}
      </span>

      {view.text ? (
        <span className="flex flex-none flex-col items-end gap-0.5">
          <span
            className={`text-[14.5px] font-bold ${
              view.stale ? "text-muted" : known ? "text-success-ink" : "text-ink"
            }`}
          >
            <NumericText>{view.text}</NumericText>
          </span>
          {/* Three words at most: what kind of figure this is. */}
          <span
            className={`text-[12px] ${view.stale ? "text-warning-ink" : "text-muted"}`}
          >
            <NumericText>{view.stale ? `${view.detail} · ישן` : view.detail}</NumericText>
          </span>
        </span>
      ) : (
        <span className="flex-none text-[12px] text-muted"><NumericText>{view.detail}</NumericText></span>
      )}

      {selected ? <CheckIcon size={18} className="flex-none text-ink" /> : null}
    </button>
  );
}
