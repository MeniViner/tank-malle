import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useData } from '../context/DataContext';
import { useVehicleData } from '../context/VehicleDataContext';
import { useToast } from '../context/ToastContext';
import { useAppUpdateBlocker } from '../hooks/useAppUpdateBlocker';
import { shekel } from '../lib/format';
import { formatCivilDay } from '../lib/civilDate';
import {
  VEHICLE_DOC_KEYS, VEHICLE_DOC_TITLES, VEHICLE_COVERAGE_LABELS,
  VEHICLE_DOC_INSURER_MAX, readVehicleDocument,
  type VehicleDocKey, type VehicleDocView, type VehicleDocValues,
  type VehicleCoverage, type VehicleDocumentSnapshot,
} from '../lib/vehicle/documents';
import { useAccountScope } from './account/useAccountScope';
import { Button } from './Button';
import { CivilDateField } from './CivilDateField';
import { Field } from './Field';
import { NumericText, NumRun } from './Fmt';
import { Segmented } from './Segmented';
import { Sheet } from './Sheet';
import { DocumentIcon, ShieldIcon, PlusIcon, WarningIcon, ChevronStart } from './icons';
import { vehicleDocumentDraftChanges } from './vehicleDocumentDraft';
import { VehicleInfo } from './VehicleUI';

const INSURERS = ['הראל', 'מגדל', 'הפניקס', 'כלל', 'מנורה', 'ביטוח ישיר', 'AIG', 'שומרה', 'איילון', 'ליברה', '9 מיליון', 'שירביט'];
type Opening = {
  scope: string; vehicleId: string; key: VehicleDocKey;
  view: VehicleDocView; expected: VehicleDocumentSnapshot | null; isCurrent: () => boolean;
};

function description(view: VehicleDocView): string {
  if (view.state === 'unavailable') return 'הפרטים השמורים אינם זמינים לעריכה';
  if (view.state === 'absent') return view.key === 'test' ? 'מתי הטסט הבא?' : 'חברה, תוקף ועלות שנתית';
  const values = view.values as VehicleDocValues['coverage'];
  if (view.key === 'coverage' && values.type === 'none') return 'סימנת שאין ביטוח מקיף או צד ג׳';
  return [view.key === 'coverage' && values.type ? VEHICLE_COVERAGE_LABELS[values.type] : null,
    values.insurer || null, view.due ? `בתוקף עד ${formatCivilDay(view.due)}` : null,
    values.cost != null ? `${shekel(values.cost)} לשנה` : null].filter(Boolean).join(' · ') || 'פרטים חלקיים · להשלמה';
}

/** Every vehicle retains all three rows, including empty and unreadable data. */
export function VehicleDocuments() {
  const { activeVehicle, captureVehicleDocument } = useData();
  const { scope, today } = useVehicleData();
  const captureParentScope = useAccountScope(scope);
  const [params, setParams] = useSearchParams();
  const [opening, setOpening] = useState<Opening | null>(null);
  const requested = params.get('doc');
  const requestedVehicle = params.get('vehicle');
  const docKey = VEHICLE_DOC_KEYS.find(key => key === requested);
  const shown = opening?.scope === scope && opening.vehicleId === activeVehicle?.id && opening.isCurrent() ? opening : null;

  useEffect(() => {
    // The browser URL can open/close a sheet through Back or a notification.
    // Keep one provider opening token across ordinary data-listener rerenders.
    // oxlint-disable-next-line react/set-state-in-effect
    if (!docKey || !activeVehicle || requestedVehicle !== activeVehicle.id) { setOpening(null); return; }
    setOpening(current => {
      if (current?.scope === scope && current.vehicleId === activeVehicle.id && current.key === docKey && current.isCurrent()) return current;
      const view = readVehicleDocument(activeVehicle.docs, docKey, today);
      return { scope, vehicleId: activeVehicle.id, key: docKey, view, isCurrent: captureParentScope(),
        expected: view.state === 'unavailable' ? null : captureVehicleDocument(activeVehicle, docKey) };
    });
  }, [activeVehicle, captureVehicleDocument, captureParentScope, docKey, requestedVehicle, scope, today]);

  if (!activeVehicle) return null;
  const open = (key: VehicleDocKey) => {
    const view = readVehicleDocument(activeVehicle.docs, key, today);
    setOpening({ scope, vehicleId: activeVehicle.id, key, view, isCurrent: captureParentScope(),
      expected: view.state === 'unavailable' ? null : captureVehicleDocument(activeVehicle, key) });
    setParams(previous => { const next = new URLSearchParams(previous); next.set('doc', key); next.set('vehicle', activeVehicle.id); return next; });
  };
  const close = () => {
    setOpening(null);
    setParams(previous => { const next = new URLSearchParams(previous); next.delete('doc'); next.delete('vehicle'); return next; }, { replace: true });
  };

  return <section className="tm-vehicle-section" aria-labelledby="vehicle-documents-heading">
    <h2 id="vehicle-documents-heading" className="tm-vehicle-section-title">רישוי וביטוח</h2>
    <div className="tm-vehicle-rows">
      {VEHICLE_DOC_KEYS.map(key => {
        const view = readVehicleDocument(activeVehicle.docs, key, today);
        const detail = description(view);
        const days = view.daysLeft;
        const none = view.state === 'ready' && key === 'coverage' && (view.values as VehicleDocValues['coverage']).type === 'none';
        const status = view.state === 'unavailable' ? 'לא זמין' : days !== null ? days < 0 ? 'פג תוקף' : days === 0 ? 'בתוקף עד היום' : days === 1 ? 'נותר יום אחד' : `נותרו ${days} ימים` : none ? 'שינוי' : 'הוספה';
        return <button type="button" key={key} className="tm-vehicle-row" data-testid={`vehicle-doc-${key}`}
          aria-label={`${VEHICLE_DOC_TITLES[key]} · ${detail} · ${status}`} onClick={() => open(key)}>
          <span className="tm-vehicle-row-icon" aria-hidden="true">{key === 'test' ? <DocumentIcon size={20}/> : <ShieldIcon size={20}/>}</span>
          <span className="tm-vehicle-row-main"><strong>{VEHICLE_DOC_TITLES[key]}</strong><small><NumericText>{detail}</NumericText></small></span>
          {view.state === 'unavailable' ? <span className="tm-vehicle-due"><WarningIcon size={20}/><small>לא זמין</small></span>
            : days !== null ? <span className="tm-vehicle-due" data-soon={days >= 0 && days < 30} data-expired={days < 0}>
              {days < 0 ? <><WarningIcon size={20}/><small>פג תוקף</small></> : days === 0 ? <><strong>היום</strong><small>יום אחרון</small></> : <><strong><NumRun>{days}</NumRun></strong><small>{days === 1 ? 'יום נותר' : 'ימים נותרו'}</small></>}
            </span> : <span className={!none ? 'tm-vehicle-add-label' : 'tm-vehicle-due'}>{!none ? <PlusIcon size={14}/> : <ChevronStart size={16}/>}<small>{status}</small></span>}
        </button>;
      })}
    </div>
    {docKey && requestedVehicle !== activeVehicle.id ? <p role="status" className="tm-vehicle-note">המסמך שבקישור שייך לרכב אחר. בחרו אותו בניהול רכבים.</p> : null}
    {shown ? <VehicleDocumentSheet key={`${shown.scope}/${shown.vehicleId}/${shown.key}`} opening={shown} captureParentScope={captureParentScope} onClose={close}/> : null}
  </section>;
}

function VehicleDocumentSheet({ opening, onClose, captureParentScope }: { opening: Opening; onClose: () => void; captureParentScope: () => () => boolean }) {
  const { updateVehicleDocument } = useData();
  const { showToast } = useToast();
  const captureScope = useAccountScope(opening.scope);
  const values = (opening.view.state === 'unavailable' ? {} : opening.view.values) as VehicleDocValues['coverage'];
  const [insurer, setInsurer] = useState(values.insurer ?? '');
  const [dueDraft, setDueDraft] = useState(formatCivilDay(values.due));
  const [costDraft, setCostDraft] = useState(values.cost == null ? '' : String(values.cost));
  const [coverage, setCoverage] = useState<VehicleCoverage | ''>(values.type ?? '');
  const [dirty, setDirty] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState('');
  const [dateError, setDateError] = useState('');
  const [costError, setCostError] = useState('');
  const [insurerError, setInsurerError] = useState('');
  const [busy, setBusy] = useState(false);
  useAppUpdateBlocker(dirty.size > 0 || busy);
  const saving = useRef(false);
  const dateInput = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const errorNode = useRef<HTMLParagraphElement>(null);
  const none = opening.key === 'coverage' && coverage === 'none';
  const insurance = opening.key !== 'test';
  const touch = (field: string) => { setDirty(current => new Set([...current, field])); setError(''); };
  useEffect(() => { if (error) errorNode.current?.focus(); }, [error]);

  async function save() {
    if (saving.current || !opening.expected || opening.view.state === 'unavailable') return;
    setError(''); setDateError(''); setCostError(''); setInsurerError('');
    const intent = vehicleDocumentDraftChanges(opening.key, values,
      { insurer, dueText: dueDraft, costText: costDraft, coverage }, dirty);
    if (intent.ok === false) {
      if (intent.field === 'due') { setDateError(intent.message); dateInput.current?.focus(); }
      else if (intent.field === 'cost') { setCostError(intent.message); form.current?.querySelector<HTMLInputElement>('[data-doc-cost]')?.focus(); }
      else { setInsurerError(intent.message); form.current?.querySelector<HTMLInputElement>('[data-doc-insurer]')?.focus(); }
      return;
    }
    const changes = intent.changes;
    if (!Object.keys(changes).length) { onClose(); return; }
    const isCurrent = captureScope();
    const isScopeCurrent = captureParentScope();
    if (!isCurrent() || !isScopeCurrent()) return;
    saving.current = true; setBusy(true);
    try {
      const receipt = await updateVehicleDocument(opening.vehicleId, opening.key, changes, { expected: opening.expected });
      if (!isScopeCurrent()) return;
      showToast({ tone: 'info', title: 'פרטי הרישוי נשמרו במכשיר — ממתינים לסנכרון' });
      // The provider owns the account/vehicle token. Never reopen or mutate a
      // newer sheet after this durable local submission closes its editor.
      if (isCurrent()) onClose();
      void receipt.settled.then(ok => { if (!ok && isScopeCurrent()) showToast({ tone: 'error', title: 'השמירה טרם אושרה', detail: 'אפשר לבדוק בשינויים שעוד לא עלו לענן.' }); });
    } catch (cause) {
      if (isCurrent()) setError(cause instanceof Error ? cause.message : 'לא ניתן לשמור. הפרטים נשארו כאן.');
      else if (isScopeCurrent()) showToast({ tone: 'error', title: 'שמירת פרטי הרישוי לא הושלמה', detail: 'בדקו את הפרטים ואת השינויים שעוד לא עלו לענן.' });
    } finally {
      saving.current = false;
      if (isCurrent()) setBusy(false);
    }
  }

  return <Sheet open title={VEHICLE_DOC_TITLES[opening.key]} atmosphereRoute="/vehicle" onClose={onClose}
    returnFocus={() => opening.isCurrent() ? document.querySelector<HTMLElement>(`[data-testid="vehicle-doc-${opening.key}"]`) : null}>
    {opening.view.state === 'unavailable' ? <div className="tm-vehicle-form"><p role="status" className="tm-vehicle-warning"><WarningIcon size={20}/>הפרטים השמורים אינם בפורמט שניתן לערוך כאן. הם נשמרו כפי שהם ולא הוחלפו בפרטים ריקים.</p><p className="tm-vehicle-note">אפשר להוריד גיבוי של הנתונים ממסך החשבון לפני בירור או תיקון.</p><Button full variant="secondary" onClick={onClose}>סגירה</Button></div>
      : !opening.expected ? <div className="tm-vehicle-form"><p role="status" className="tm-vehicle-warning"><WarningIcon size={20}/>הפרטים עדיין לא אומתו לשמירה. המתינו לסנכרון ואז סגרו ופתחו את המסמך שוב.</p><Button full variant="secondary" onClick={onClose}>סגירה</Button></div>
        : <form ref={form} className="tm-vehicle-form tm-vehicle-document-form" data-testid="vehicle-doc-form" data-doc-key={opening.key} noValidate onSubmit={event => { event.preventDefault(); void save(); }}>
          <fieldset disabled={busy}>
            {opening.key === 'coverage' ? <div className="tm-vehicle-field-group"><span className="tm-vehicle-field-label">סוג הביטוח</span><Segmented<VehicleCoverage | ''> value={coverage} ariaLabel="סוג ביטוח הרכב" options={(['comprehensive', 'third', 'none'] as const).map(value => ({ value, label: VEHICLE_COVERAGE_LABELS[value] }))} onChange={value => { setCoverage(value); touch('type'); }}/>{!coverage ? <p className="tm-vehicle-note">סוג הביטוח עדיין לא נבחר.</p> : null}</div> : null}
            {none ? <p className="tm-vehicle-note">לא יוצגו תזכורות לביטוח מקיף או צד ג׳. בחירה זו מנקה את פרטי החברה, התוקף והעלות שהוזנו למסמך הזה.</p> : <>
              {insurance ? <div className="tm-vehicle-field-group"><Field label="חברת ביטוח" data-doc-insurer data-testid="vehicle-doc-insurer" dir="auto" value={insurer} error={insurerError ? <NumericText>{insurerError}</NumericText> : null} maxLength={VEHICLE_DOC_INSURER_MAX} placeholder="בחירת חברה או כתיבה חופשית" onChange={event => { setInsurer(event.target.value); touch('insurer'); setInsurerError(''); }}/><div className="tm-vehicle-insurers" aria-label="חברות ביטוח נפוצות">{INSURERS.map(name => <button key={name} type="button" className="tm-vehicle-chip" aria-pressed={insurer === name} onClick={() => { setInsurer(name); touch('insurer'); setInsurerError(''); }}><NumericText>{name}</NumericText></button>)}</div></div> : null}
              <CivilDateField ref={dateInput} id="vehicle-doc-due" label={opening.key === 'test' ? 'תוקף הטסט' : 'בתוקף עד'} draftText={dueDraft} error={dateError} onDraftTextChange={text => { setDueDraft(text); touch('due'); setDateError(''); }}/>
              {insurance ? <Field label="עלות שנתית (רשות)" suffix="₪" data-doc-cost data-testid="vehicle-doc-cost" inputMode="decimal" dir="ltr" value={costDraft} error={costError ? <NumericText>{costError}</NumericText> : null} placeholder="0" onChange={event => { setCostDraft(event.target.value); touch('cost'); setCostError(''); }}/> : null}
            </>}
            {insurance ? <p className="tm-vehicle-note">העלות נשמרת כאן כפרט של הביטוח. לרישום הוצאה ביומן יש להוסיף אותה בנפרד.</p> : null}
            <VehicleInfo title="על תזכורות הרישוי"><p>נזכיר באפליקציה חודש לפני המועד ושבוע לפניו. בחירה ב״אין״ לביטוח מקיף או צד ג׳ מבטלת את התזכורות למסמך הזה.</p></VehicleInfo>
          </fieldset>
          {error ? <p ref={errorNode} tabIndex={-1} role="alert" className="tm-vehicle-error" data-testid="vehicle-doc-error"><NumericText>{error}</NumericText></p> : null}
          <Button type="submit" full data-testid="vehicle-doc-save" disabled={busy || dirty.size === 0}>{busy ? 'שומרים…' : 'שמירת הפרטים'}</Button>
        </form>}
  </Sheet>;
}
