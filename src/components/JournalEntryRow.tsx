import { Link } from "react-router-dom";
import { dayMonthShort, int } from "../lib/format";
import { fillupEndLabel, observationLevelLabel } from "../lib/journal/presentation";
import { resolveEndState } from "../lib/tank/observations";
import type { TankObservation } from "../lib/tank/types";
import type { Fillup } from "../lib/types";
import type { LedgerRow } from "../lib/vehicle/derived";
import { vehicleDay } from "../lib/vehicle/format";
import { ConsumptionValue, Distance, Money, NumericText, NumRun, Percent, Quantity, SignedMoney } from "./Fmt";
import { GaugeIcon, WarningIcon } from "./icons";
import { CareGlyph } from "./maintenance/CareGlyph";
import { EXCLUDED_LABEL } from "../lib/vehicle/ownership";
import { StationBrandMark } from "./StationBrand";
import "../journal-entry.css";

export function JournalEntryRow({ row, units, kmPerLiter, ev = false, pending = false, attention = false, flagged = false, to, onOpen }: {
  row: LedgerRow; units: "kmPerLiter" | "litersPer100"; kmPerLiter?: number;
  /** EV (Stage 7 D2): a charge row names the record instead of showing litres or km/L. */
  ev?: boolean;
  pending?: boolean; attention?: boolean; flagged?: boolean; to?: string; onOpen?: () => void;
}) {
  const date = new Date(`${row.day}T12:00:00`);
  const fuel = row.kind === "fuel" ? row.record as Fillup : null;
  const refund = row.kind === "expense" && "category" in row.record && row.record.category === "refund";
  const quiet = row.kind === "odometer" || row.kind === "tank";
  const observation = row.collection === "observations" ? row.record as TankObservation : null;
  const job = "jobs" in row.record ? row.record.jobs[0] : "periodic";
  const category = "category" in row.record ? row.record.category : "other";
  const classes = `tm-journal-row ledger-row${quiet ? " tm-journal-quiet" : ""}`;
  const state = attention ? "דורש בדיקה" : pending ? "ממתין לאישור" : "";
  // Density pass: the quiet rows (odometer, tank mark) read as a small tag, not a full entry.
  const content = quiet ? <>
    <span className="tm-journal-quiet-copy">
      <GaugeIcon size={14} />
      {row.kind === "odometer" && row.odometer !== null ? <>ק״מ <NumRun>{int(row.odometer)}</NumRun></>
        : observation?.level != null ? <>{observationLevelLabel(observation)} <Percent value={observation.level * 100} /></>
          : <NumericText>{row.title}</NumericText>}
      <span className="tm-journal-meta"> · <NumericText>{dayMonthShort(date)}</NumericText>{state ? ` · ${state}` : ""}</span>
    </span>
  </> : <>
    {fuel ? <StationBrandMark brand={fuel.station?.brand} name={fuel.station?.name} size={40} />
      : <span className={`tm-journal-badge${row.kind === "issue" ? " tm-journal-badge-warning" : refund ? " tm-journal-badge-refund" : ""}`} aria-hidden="true">
        {row.kind === "issue" ? <WarningIcon size={20} /> : <CareGlyph kind={row.kind === "service" ? job : category} size={20} />}
      </span>}
    <span className="tm-journal-main">
      <strong className="tm-journal-title"><NumericText>{row.title}</NumericText></strong>
      <span className="tm-journal-meta">{fuel ? ev ? <>טעינה{fuelEndNote(fuel)}</> : <FuelMeta fillup={fuel} value={kmPerLiter} units={units} /> : <>
        {row.kind === "service" ? "טיפול" : row.kind === "issue" ? "תקלה" : refund ? "החזר" : "הוצאה"}
        {row.odometer !== null ? <> · <Distance value={row.odometer} /></> : null}
      </>}</span>
      {fuel?.continuityBreakBefore ? <span className="tm-journal-state">אחרי תדלוקים שלא נרשמו</span> : null}
      {state ? <span className="tm-journal-state">{state}</span> : null}
      {flagged ? <span className="tm-journal-state tm-journal-flag"><WarningIcon size={13} />כדאי לבדוק</span> : null}
      {row.excluded ? <span className="tm-journal-state tm-journal-excluded" data-testid="journal-excluded-tag">{EXCLUDED_LABEL}</span> : null}
    </span>
    <span className={`tm-journal-money${refund ? " tm-journal-refund" : ""}`}>
      {row.financial ? row.amountAgorot === null ? <NumRun align="trailing">—</NumRun>
        : refund ? <SignedMoney value={Math.abs(row.amountAgorot) / 100} align="trailing" /> : <Money value={row.amountAgorot / 100} align="trailing" />
        : null}
      <time className="tm-journal-day" dateTime={row.day} aria-label={vehicleDay(row.day)}><NumericText>{dayMonthShort(date)}</NumericText></time>
    </span>
  </>;
  const shared = { className: classes, "data-collection": row.collection, "data-testid": `journal-entry-${row.key}` };
  return to ? <Link {...shared} to={to}>{content}</Link> : <button {...shared} type="button" onClick={onOpen}>{content}</button>;
}

/** A full tank is the normal case and is not repeated on every row; only a partial or unknown end is named. */
function fuelEndNote(fillup: Fillup) {
  const state = resolveEndState(fillup).state;
  return state === "full" ? "" : ` · ${fillupEndLabel(fillup)}`;
}

function FuelMeta({ fillup, value, units }: { fillup: Fillup; value?: number; units: "kmPerLiter" | "litersPer100" }) {
  return <><Quantity value={fillup.liters} digits={1} />{fuelEndNote(fillup)}
    {value !== undefined ? <> · <ConsumptionValue kmPerLiter={value} units={units} /></> : null}</>;
}
