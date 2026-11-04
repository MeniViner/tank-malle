import { useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useData, type VehicleSelectionResult } from '../context/DataContext';
import { useToast } from '../context/ToastContext';
import { useAccountScope } from '../components/account/useAccountScope';
import { ScreenHeader } from '../components/AppHeader';
import '../vehicle-page-design.css';
import { NumericText, NumRun } from '../components/Fmt';
import { ConfirmDialog } from '../components/Sheet';
import { ArchiveIcon, CarIcon, PlusIcon, TrashIcon, ChevronStart } from '../components/icons';
import { FUEL_TYPE_SHORT, formatPlate, vehicleLabel } from '../lib/format';
import type { Vehicle } from '../lib/types';

type Action = { vehicle: Vehicle; kind: 'archive' | 'delete' };

export function VehicleManager() {
  const { user } = useAuth();
  return <VehicleManagerContent key={user?.uid ?? 'signed-out'}/>;
}

function VehicleManagerContent() {
  const { user } = useAuth();
  const { vehicles, activeVehicle, setActiveVehicle, setVehicleArchived, deleteVehicle, ready } = useData();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const captureScope = useAccountScope(user?.uid);
  const [confirm, setConfirm] = useState<Action | null>(null);
  const [pending, setPending] = useState<{ id: string; label: string } | null>(null);
  const [error, setError] = useState('');
  const [selectionNotice, setSelectionNotice] = useState<{ message: string; pending: boolean; operationId?: string } | null>(null);
  const submitting = useRef(false);
  const action = useRef<object | null>(null);
  const cards = useRef(new Map<string, HTMLElement>());
  const activeSection = useRef<HTMLElement>(null);
  const focusFlow = useRef<{ vehicleId: string; anchor: HTMLElement | null; isCurrent: () => boolean } | null>(null);
  const active = vehicles.filter(vehicle => !vehicle.archived && !vehicle.deletionPending);
  const archived = vehicles.filter(vehicle => vehicle.archived || vehicle.deletionPending);

  useLayoutEffect(() => {
    const flow = focusFlow.current;
    if (confirm || !flow) return;
    if (!flow.isCurrent()) { focusFlow.current = null; return; }
    const focused = document.activeElement;
    const lost = !flow.anchor?.isConnected || flow.anchor.matches(':disabled');
    if (!lost) {
      if (focused !== flow.anchor && !flow.anchor?.contains(focused)) focusFlow.current = null;
      return;
    }
    // Follow the same logical card when archiving/restoring replaces its DOM.
    // A deliberate move elsewhere during an asynchronous save wins over this.
    if (focused !== document.body && focused !== flow.anchor && focused?.isConnected) {
      focusFlow.current = null; return;
    }
    const target = cards.current.get(flow.vehicleId) ?? activeSection.current;
    if (target?.isConnected) { target.focus(); flow.anchor = target; }
  }, [vehicles, activeVehicle?.id, pending, confirm]);

  async function run(vehicle: Vehicle, kind: 'select' | 'archive' | 'restore' | 'delete') {
    if (submitting.current) return;
    const isCurrent = captureScope();
    if (!isCurrent()) return;
    const token = {}; action.current = token;
    const actionCurrent = () => isCurrent() && action.current === token;
    focusFlow.current = { vehicleId: vehicle.id, anchor: document.activeElement as HTMLElement | null, isCurrent: actionCurrent };
    const followup: { current?: { result: VehicleSelectionResult; isCurrent: () => boolean } } = {};
    const options = { onSelection: (result: VehicleSelectionResult, selectionCurrent: () => boolean) => {
      followup.current = { result, isCurrent: selectionCurrent };
    } };
    submitting.current = true;
    setError(''); setSelectionNotice(null); setConfirm(null);
    const labels = { select: 'בוחרים רכב…', archive: 'העברה לארכיון ממתינה לאישור', restore: 'החזרת הרכב ממתינה לאישור', delete: 'משלימים את מחיקת הרכב…' };
    setPending({ id: vehicle.id, label: labels[kind] });
    try {
      if (kind === 'select') await setActiveVehicle(vehicle.id);
      else if (kind === 'delete') await deleteVehicle(vehicle.id, options);
      else await setVehicleArchived(vehicle.id, kind === 'archive', options);
      if (!actionCurrent()) return;
      if (kind !== 'select') showToast({ tone: 'success', title: kind === 'archive' ? 'הרכב הועבר לארכיון' : kind === 'restore' ? 'הרכב הוחזר מהארכיון' : 'הרכב נמחק' });
      const selection = followup.current;
      if (selection?.isCurrent()) {
        const { result } = selection;
        if (result.state === 'blocked') setSelectionNotice({ pending: false, message: result.message, operationId: result.operation?.opId });
        else if (result.state === 'submitted') {
          setSelectionNotice({ pending: true, message: 'בחירת הרכב הפעיל נשמרה במכשיר וממתינה לאישור.', operationId: result.opId });
          void result.receipt.settled.then(accepted => {
            if (!actionCurrent() || !selection.isCurrent()) return;
            setSelectionNotice(accepted ? null : { pending: false, message: 'בחירת הרכב הפעיל טרם אושרה. הפעולה נשמרה לבדיקה.', operationId: result.opId });
          });
        }
      }
    } catch (cause) {
      if (isCurrent()) setError(cause instanceof Error ? cause.message : 'הפעולה לא אושרה. אפשר לבדוק בשינויים שעוד לא עלו לענן.');
    } finally {
      submitting.current = false;
      if (isCurrent()) setPending(null);
    }
  }

  const card = (vehicle: Vehicle, isArchived: boolean) => {
    const selected = activeVehicle?.id === vehicle.id && !isArchived;
    const label = vehicleLabel(vehicle);
    const detail = [vehicle.nickname ? `${vehicle.make} ${vehicle.model}` : null, vehicle.year, FUEL_TYPE_SHORT[vehicle.fuelType]].filter(Boolean).join(' · ');
    const metadata=<><NumericText>{detail}</NumericText>{vehicle.plateNumber ? <> · <NumRun>{formatPlate(vehicle.plateNumber)}</NumRun></> : null}</>;
    return <article className="tm-vehicle-card" data-archived={isArchived} data-managed-vehicle={vehicle.id} key={vehicle.id} aria-label={label} tabIndex={-1}
      ref={node => { if (node) cards.current.set(vehicle.id, node); else cards.current.delete(vehicle.id); }}>
      <div className="tm-vehicle-card-title">{!isArchived ? <Link to={`/vehicle/edit/${encodeURIComponent(vehicle.id)}`} aria-label={`פרטי הרכב · ${label}`}><h2><NumericText>{label}</NumericText></h2><p>{metadata}</p></Link> : <><h2><NumericText>{label}</NumericText></h2><p>{metadata}</p></>}</div>
      <div className="tm-vehicle-card-actions">
        {isArchived ? <>{!vehicle.deletionPending ? <button type="button" className="tm-vehicle-restore" disabled={!!pending} onClick={() => void run(vehicle, 'restore')} aria-label={`החזרת ${label} מהארכיון`}>החזרה</button> : <span className="tm-vehicle-status">מחיקה ממתינה</span>}<button type="button" className="tm-icon-button text-danger" disabled={!!pending} onClick={() => setConfirm({ vehicle, kind: 'delete' })} aria-label={`${vehicle.deletionPending ? 'השלמת מחיקת' : 'מחיקת'} ${label}`}><TrashIcon size={19}/></button></> : <>{selected ? <span className="tm-vehicle-status" data-active>פעיל</span> : <button type="button" className="tm-vehicle-chip" disabled={!!pending} aria-label={`בחירה ברכב ${label}`} onClick={() => void run(vehicle, 'select')}>בחירה</button>}<button type="button" className="tm-icon-button" disabled={!!pending} onClick={() => setConfirm({ vehicle, kind: 'archive' })} aria-label={`העברת ${label} לארכיון`}><ArchiveIcon size={20}/></button></>}
      </div>
      {pending?.id === vehicle.id ? <p role="status" className="tm-vehicle-note">{pending.label}</p> : null}
    </article>;
  };

  return <main className="vehicle-page vehicle-v2-page tm-vehicle-manager pb-safe pt-safe">
    <ScreenHeader title="הרכבים שלי" onBack={() => navigate('/vehicle')} backLabel="חזרה לרכב" backIcon={<ChevronStart size={20} className="rotate-180"/>}/>
    <div className="tm-page">
    {!ready && !vehicles.length ? <p role="status" className="tm-vehicle-note">טוענים את הרכבים…</p> : null}
    <section ref={activeSection} tabIndex={-1} className="tm-vehicle-section tm-vehicle-list" aria-label="רכבים פעילים">{active.map(vehicle => card(vehicle, false))}{ready && !active.length ? <div className="tm-vehicle-empty"><CarIcon size={30}/><h2>איזה רכב מצטרף?</h2><p>אפשר להוסיף רכב או להחזיר אחד מהארכיון.</p></div> : null}</section>
    <Link className="tm-button tm-button-line" to="/vehicles/new"><PlusIcon size={20}/>הוספת רכב</Link>
    {archived.length ? <section className="tm-vehicle-section" aria-labelledby="archived-vehicles-heading"><h2 id="archived-vehicles-heading" className="tm-vehicle-section-title">בארכיון</h2><div className="tm-vehicle-list">{archived.map(vehicle => card(vehicle, true))}</div></section> : null}
    {pending && !vehicles.some(vehicle => vehicle.id === pending.id) ? <p role="status" className="tm-vehicle-note">{pending.label}</p> : null}
    {pending ? <p className="tm-vehicle-note">ממתינים לאישור מהשרת. רשומות הרכב נשארות בחשבון בזמן העברה לארכיון או החזרה ממנו.</p> : null}
    {error ? <p role="alert" className="tm-vehicle-error"><NumericText>{error}</NumericText></p> : null}
    {pending || error ? <Link className="tm-vehicle-chip" to="/settings/unsynced">שינויים שעוד לא עלו לענן</Link> : null}
    {selectionNotice ? <section data-testid="vehicle-selection-followup" data-state={selectionNotice.pending ? 'pending' : 'blocked'} data-operation-id={selectionNotice.operationId}
      className="tm-vehicle-selection-notice" role={selectionNotice.pending ? 'status' : 'alert'}>
      {!selectionNotice.pending ? <h2 className="tm-vehicle-section-title">בחירת הרכב הפעיל לא הושלמה</h2> : null}
      <p className="tm-vehicle-note"><NumericText>{selectionNotice.message}</NumericText></p>
      {selectionNotice.operationId ? <Link className="tm-vehicle-chip" to="/settings/unsynced">בדיקת הבחירה שנשמרה</Link>
        : <p className="tm-vehicle-note">{active.length ? 'אפשר לבחור רכב מהרשימה.' : 'אפשר להחזיר רכב מהארכיון או להוסיף רכב.'}</p>}
    </section> : null}
    <ConfirmDialog open={confirm !== null} title={confirm?.kind === 'archive' ? 'להעביר לארכיון?' : 'למחוק את הרכב?'}
      body={confirm?.kind === 'archive' ? 'הרכב ייעלם מהמסכים הפעילים, וכל הרשומות שלו יישמרו. אפשר להחזיר אותו בכל רגע.' : 'הרכב וכל התדלוקים, הטיפולים, ההוצאות והרשומות שלו יימחקו לצמיתות. לא ניתן לשחזר.'}
      confirmLabel={confirm?.kind === 'archive' ? 'העברה לארכיון' : confirm?.vehicle.deletionPending ? 'השלמת מחיקה' : 'מחיקת הרכב'}
      tone={confirm?.kind === 'archive' ? 'accent' : 'danger'} onCancel={() => setConfirm(null)} onConfirm={() => { if (confirm) void run(confirm.vehicle, confirm.kind); }}/>
    </div>
  </main>;
}
