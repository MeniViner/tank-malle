import { useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../context/DataContext';
import { useVehicleData } from '../context/VehicleDataContext';
import { int, percentPlain, price } from '../lib/format';
import type { TcoPart, TcoPartId, TcoResult } from '../lib/tco';
import type { VehicleDocKey } from '../lib/vehicle/documents';
import { journalRangeLink } from './insights/presentation';
import { Money, NumericText, NumRun } from './Fmt';
import { CoinIcon, DocumentIcon, PumpIcon, ShieldIcon, WrenchIcon, ChevronStart } from './icons';
import { Segmented } from './Segmented';
import { Sheet } from './Sheet';
import { VehicleDocumentDialog } from './VehicleDocuments';
import { useAccountScope } from './account/useAccountScope';
import '../tco-design.css';
import { CostCommunity } from './CostCommunity';

/** Design v3 §4: one hue per cost category, light/dark variants live in index.css. */
const COLORS: Record<TcoPartId, string> = {
  fuel: 'var(--cat-fuel)', service: 'var(--cat-service)', mandatory: 'var(--cat-ins1)',
  coverage: 'var(--cat-ins2)', test: 'var(--cat-test)', other: 'var(--cat-other)',
};
/** Icon colour on each category tile (≥3:1 non-text contrast, see design/v3/evidence/stage-1/CONTRAST.md). */
const ON_COLORS: Record<TcoPartId, string> = {
  fuel: 'var(--cat-fuel-on)', service: 'var(--cat-service-on)', mandatory: 'var(--cat-ins1-on)',
  coverage: 'var(--cat-ins2-on)', test: 'var(--cat-test-on)', other: 'var(--cat-other-on)',
};
const ICONS = { fuel: PumpIcon, service: WrenchIcon, mandatory: ShieldIcon, coverage: ShieldIcon, test: DocumentIcon, other: CoinIcon };

function Amount({ value, className = '' }: { value: number | null; className?: string }) {
  const style = `font-display ${className}`;
  return value === null ? <NumRun block className={style}>—</NumRun> : <Money block value={value} className={style} />;
}

export function TcoBlock({ tco, compact = false }: { tco: TcoResult; compact?: boolean }) {
  const data = useData();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const summaryId = useId();
  if (!data.activeVehicle || !data.fillups.length) return null;
  const parts = tco.parts.filter(part => part.knownValue > 0);
  const total = parts.reduce((sum, part) => sum + part.knownValue, 0);
  const label = tco.complete ? 'הרכב עולה לך' : tco.lowerBound && tco.month !== null ? 'הרכב עולה לך, לפחות' : 'עלות הרכב לפי הרישומים';
  const missing = tco.missing.length === 1 ? `חסר ${tco.missing[0].label}` : `חסר ${int(tco.missing.length)} פריטים`;
  return <>
    <button ref={trigger} type="button" className="tm-tco" data-testid="tco-card" data-compact={compact}
      aria-label="כמה הרכב עולה לך" aria-describedby={summaryId} aria-haspopup="dialog" aria-expanded={open}
      onClick={event => { event.currentTarget.focus(); setOpen(true); }}>
      <span className="tm-tco-top"><span className="home-label">{label}</span>
        {tco.missing.length ? <span className="tm-tco-missing" data-testid="tco-missing"><NumericText>{missing}</NumericText></span> : null}
      </span>
      <span id={summaryId} className="tm-tco-number"><Amount value={tco.month} className="tm-tco-value" /><span className="tm-tco-unit">בחודש</span></span>
      <span className="tm-tco-sub">{tco.year === null ? 'ממתינים לעלות מתועדת' : <>כ־<Money value={tco.year} /> בשנה</>}
        {tco.perKm !== null ? <> · <NumRun>{price(tco.perKm)}</NumRun> לק״מ</> : null}</span>
      <span className="tm-tco-bar" data-testid="tco-bar" aria-hidden="true">
        {parts.map(part => <i key={part.id} data-tco-part={part.id} style={{ flexGrow: total ? part.knownValue / total : 0, background: COLORS[part.id] }} />)}
      </span>
      {!compact ? <span className="tm-tco-legend">{parts.slice(0, 4).map(part => <span key={part.id}>
        <i style={{ background: COLORS[part.id] }} aria-hidden="true" />{part.label}<strong><Money value={part.knownValue} /></strong>
      </span>)}</span> : null}
    </button>
    {open ? <TcoSheet tco={tco} onClose={() => setOpen(false)} returnFocus={() => trigger.current} /> : null}
  </>;
}

function TcoSheet({ tco, onClose, returnFocus }: { tco: TcoResult; onClose: () => void; returnFocus: () => HTMLElement | null }) {
  const vehicle = useVehicleData(), navigate = useNavigate();
  const captureDocumentScope = useAccountScope(vehicle.scope);
  const [period, setPeriod] = useState<'month' | 'year'>('month');
  const [document, setDocument] = useState<VehicleDocKey | null>(null);
  const docTrigger = useRef<HTMLButtonElement | null>(null);
  const multiplier = period === 'month' ? 1 : 12;
  const total = period === 'month' ? tco.month : tco.year;
  const fuel = tco.parts[0];
  const fuelShare = fuel.value !== null && tco.month !== null && tco.month > 0 ? fuel.value / tco.month * 100 : null;
  function openPart(part: TcoPart, button: HTMLButtonElement) {
    if (part.docKey) { docTrigger.current = button; setDocument(part.docKey); }
    else { onClose(); navigate(journalRangeLink(part.id === 'fuel' ? 'fuel' : part.id === 'service' ? 'service' : 'expense', tco.windowStart, vehicle.today)); }
  }
  return <>
    <Sheet open title="כמה הרכב עולה לך" onClose={onClose} returnFocus={returnFocus}>
      <div className="tm-tco-sheet" data-testid="tco-sheet">
        <Segmented value={period} onChange={setPeriod} ariaLabel="תקופת העלות" options={[{ value: 'month', label: 'בחודש' }, { value: 'year', label: 'בשנה' }]} />
        <div className="tm-tco-number"><Amount value={total} className="tm-tco-value" /><span className="tm-tco-unit">{period === 'month' ? 'בחודש' : 'בשנה'}</span></div>
        <p className="tm-tco-note">ממוצע על {tco.window === 1 ? 'החודש האחרון' : <><NumRun>{tco.window}</NumRun> החודשים האחרונים</>}. ביטוח, טסט ואגרה מחולקים ל־<NumRun>12</NumRun> חודשים.</p>
        <div className="tm-tco-rows">{tco.parts.map(part => {
          const Icon = ICONS[part.id];
          return <button type="button" className="tm-tco-row" key={part.id} data-testid={`tco-part-${part.id}`}
            onClick={event => openPart(part, event.currentTarget)}>
            <span className="tm-tco-icon" style={{ background: COLORS[part.id], color: ON_COLORS[part.id] }} aria-hidden="true"><Icon size={18} /></span>
            <span className="tm-tco-row-label"><strong>{part.label}</strong>{part.value === null ? <small className="tm-tco-warning">
              {part.docKey ? 'לא הוזן. הקישו להוספה' : 'הנתונים עדיין אינם מלאים או מאושרים'}
            </small> : null}</span>
            <span className="tm-tco-row-value" data-testid={`tco-value-${part.id}`}>{part.value === null ? <NumRun align="trailing">—</NumRun> : <Money align="trailing" value={part.value * multiplier} />}</span>
            <ChevronStart size={17} />
          </button>;
        })}</div>
        <div className="tm-tco-duo">
          <div><span>כל ק״מ עולה לך{tco.complete ? ' באמת' : tco.lowerBound ? ' לפחות' : ''}</span><strong><NumRun>{tco.perKm === null ? '—' : price(tco.perKm)}</NumRun></strong><small>{tco.perKm === null ? 'אחרי שתהיה נסועה יומית ידועה' : 'כולל העלויות המתועדות'}</small></div>
          <div><span>{tco.complete ? 'מתוך זה דלק' : 'דלק מתוך הסכום הידוע'}</span><strong><NumRun>{fuelShare === null ? '—' : percentPlain(fuelShare)}</NumRun></strong><small>{fuel.value === null ? 'עלות הדלק עדיין אינה מלאה' : <><Money value={fuel.value * multiplier} /> {period === 'month' ? 'בחודש' : 'בשנה'}</>}</small></div>
        </div>
        <CostCommunity tco={tco} />
      </div>
    </Sheet>
    {document ? <VehicleDocumentDialog key={`${vehicle.scope}/${document}`} docKey={document} onClose={() => setDocument(null)} returnFocus={() => docTrigger.current} captureParentScope={captureDocumentScope} /> : null}
  </>;
}
