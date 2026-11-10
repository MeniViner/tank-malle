import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';
import { useAppUpdateBlocker } from '../hooks/useAppUpdateBlocker';
import { useAccountScope } from '../components/account/useAccountScope';
import { ScreenHeader } from '../components/AppHeader';
import { PlateXL } from '../components/DesignPrimitives';
import { Field } from '../components/Field';
import { Segmented } from '../components/Segmented';
import { Button, Spinner } from '../components/Button';
import { NumericText, NumRun } from '../components/Fmt';
import { ChevronStart, RefreshIcon, WarningIcon } from '../components/icons';
import { FUEL_TYPE_SHORT, formatPlate, parseDecimal } from '../lib/format';
import { LOOKUP_MESSAGES, lookupPlate } from '../lib/plateLookup';
import { fetchVehicleSpecs, type VehicleSpecs } from '../lib/vehicleSpecs';
import { evRefreshPatch, isEv, readBattery, readMotorKw } from '../lib/vehicle/v3Fields';
import type { FuelType, Vehicle } from '../lib/types';
import '../vehicle-page-design.css';

function VehicleEditPage({ back, children }: { back: string; children: ReactNode }) {
  const navigate = useNavigate();
  return <main className="vehicle-page vehicle-v2-page tm-vehicle-edit pb-safe pt-safe">
    <ScreenHeader title="פרטי הרכב" onBack={() => navigate(back)} backLabel={back === '/vehicle' ? 'חזרה לרכב' : 'חזרה לרכבים'} backIcon={<ChevronStart size={20} className="rotate-180"/>}/>
    <div className="tm-page">{children}</div>
  </main>;
}

export function VehicleEdit() {
  const { vehicleId } = useParams();
  const { user } = useAuth();
  const { vehicles, ready } = useData();
  const vehicle = vehicles.find(row => row.id === vehicleId);
  if (!vehicle) return <VehicleEditPage back="/settings/vehicles"><p>{ready ? 'הרכב אינו זמין בחשבון הזה.' : 'טוענים את פרטי הרכב…'}</p></VehicleEditPage>;
  if (vehicle.deletionPending) return <VehicleEditPage back="/settings/vehicles"><p>מחיקת הרכב כבר החלה. אפשר להשלים אותה בניהול רכבים.</p></VehicleEditPage>;
  return <VehicleEditForm key={`${user?.uid}/${vehicle.id}`} vehicle={vehicle}/>;
}

function VehicleEditForm({ vehicle }: { vehicle: Vehicle }) {
  const { user } = useAuth();
  const { updateVehicle, activeVehicle } = useData();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const captureScope = useAccountScope(`${user?.uid}/${vehicle.id}`);
  const [original] = useState(vehicle);
  const [make, setMake] = useState(vehicle.make);
  const [model, setModel] = useState(vehicle.model);
  const [year, setYear] = useState(vehicle.year == null ? '' : String(vehicle.year));
  const [plate, setPlate] = useState(vehicle.plateNumber ?? '');
  const [fuelType, setFuelType] = useState<FuelType>(vehicle.fuelType);
  const [nickname, setNickname] = useState(vehicle.nickname ?? '');
  const [tank, setTank] = useState(vehicle.tankLiters == null ? '' : String(vehicle.tankLiters));
  const [declared, setDeclared] = useState(vehicle.declaredKmPerLiter == null ? '' : String(vehicle.declaredKmPerLiter));
  const [tankSource, setTankSource] = useState<Vehicle['tankLitersSource']>(vehicle.tankLitersSource);
  const [declaredSource, setDeclaredSource] = useState<Vehicle['declaredSource']>(vehicle.declaredSource);
  const [tankUrl, setTankUrl] = useState(vehicle.tankSourceUrl);
  const [specUrl, setSpecUrl] = useState(vehicle.specSourceUrl);
  const [registryCodes, setRegistryCodes] = useState({ tozeretCd: vehicle.tozeretCd, degemCd: vehicle.degemCd });
  const [tankHint, setTankHint] = useState<number | null>(null);
  // Design v3: EV registry fields found by "עדכון ממשרד התחבורה"; saved with the form.
  const [evPatch, setEvPatch] = useState<Partial<Vehicle>>({});
  // DESIGN-V3 §7.4: no tank / engine / km-per-litre fields for an EV (EV-AUDIT.md). A refresh that
  // returns EV data hides them too; the stored fuel type, tank and declared value are left untouched.
  const electric = isEv({ powertrain: evPatch.powertrain !== undefined ? evPatch.powertrain : vehicle.powertrain });
  const electricBattery = readBattery(evPatch.battery !== undefined ? evPatch.battery : vehicle.battery);
  const electricMotor = readMotorKw(evPatch.motorKw !== undefined ? evPatch.motorKw : vehicle.motorKw);
  const [dirty, setDirty] = useState<ReadonlySet<string>>(() => new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState('');
  const [state, setState] = useState<'idle' | 'submitting' | 'pending'>('idle');
  const [error, setError] = useState('');
  useAppUpdateBlocker(dirty.size > 0 && state !== 'pending');
  const request = useRef<AbortController | null>(null);
  const saving = useRef(false);
  const errorNode = useRef<HTMLParagraphElement>(null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => { if (error) errorNode.current?.focus(); }, [error]);
  const touch = (...fields: string[]) => { setDirty(current => new Set([...current, ...fields])); setError(''); };
  const yearError = year.trim() && (!/^\d{4}$/.test(year) || Number(year) < 1900 || Number(year) > 2100) ? 'שנה בין 1900 ל־2100' : null;
  const tankError = tank.trim() && (!Number.isFinite(parseDecimal(tank)) || parseDecimal(tank) <= 0 || parseDecimal(tank) > 500) ? 'נפח מיכל בין 0 ל־500 ליטר (ללא אפס)' : null;
  const declaredError = declared.trim() && (!Number.isFinite(parseDecimal(declared)) || parseDecimal(declared) <= 0) ? 'הצריכה חייבת להיות מספר חיובי' : null;
  const valid = make.trim().length > 0 && make.length <= 60 && model.length <= 80 && nickname.length <= 60 && !yearError && !tankError && !declaredError;
  const back = activeVehicle?.id === vehicle.id ? '/vehicle' : '/settings/vehicles';

  function applySpecs(specs: VehicleSpecs, powertrain?: Vehicle['powertrain']) {
    const ev = evRefreshPatch(vehicle, { powertrain: specs.powertrain ?? powertrain, motorKw: specs.motorKw, battery: specs.battery });
    if (Object.keys(ev).length) { setEvPatch(ev); touch('ev'); }
    // A deliberately cleared field is authored input, not a missing suggestion.
    if (!dirty.has('tank') && tankSource !== 'user' && !tank.trim() && specs.trustedTankLiters) {
      setTank(String(specs.trustedTankLiters)); setTankSource('trusted'); setTankUrl(specs.tankSourceUrl ?? null); touch('tank');
    }
    if (!dirty.has('declared') && declaredSource !== 'user' && !declared.trim() && specs.declaredKmPerLiter && specs.declaredSource === 'exact-year' && specs.consumptionIsOfficial) {
      setDeclared(String(specs.declaredKmPerLiter)); setDeclaredSource('exact-year'); setSpecUrl(specs.sourceUrl ?? null); touch('declared');
    }
    setTankHint(specs.suggestedTankLiters);
    return specs.trustedTankLiters || specs.declaredKmPerLiter ? 'נמצאו נתוני מפרט. נתונים שכבר הזנתם נשארו בטופס.' : 'אין מפרט תואם במאגר. אפשר להזין את הנתונים ידנית.';
  }

  async function refresh() {
    if (refreshing || saving.current) return;
    const isCurrent = captureScope();
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    const current = () => isCurrent() && request.current === controller && !controller.signal.aborted;
    setRefreshing(true); setRefreshNote('');
    try {
      const digits = plate.replace(/\D/g, '');
      if (digits.length < 5) {
        const sameIdentity = make === original.make && model === original.model && Number(year) === original.year && fuelType === original.fuelType;
        const specs = await fetchVehicleSpecs({ make, model, year: year ? Number(year) : null, fuelType, ...(sameIdentity ? { ...registryCodes, powertrain: original.powertrain ?? null } : {}) }, controller.signal);
        if (current()) setRefreshNote(applySpecs(specs));
        return;
      }
      const outcome = await lookupPlate(digits, { uid: user?.uid ?? null, signal: controller.signal });
      if (!current()) return;
      if (outcome.status === 'not-found') { setRefreshNote(LOOKUP_MESSAGES.notFound); return; }
      if (outcome.status === 'unavailable' && !outcome.cached) { setRefreshNote(LOOKUP_MESSAGES.unavailable); return; }
      const found = outcome.status === 'found' ? outcome.vehicle : outcome.cached!;
      if (found.make) { setMake(found.make); touch('make'); }
      if (found.model) { setModel(found.model); touch('model'); }
      if (found.year) { setYear(String(found.year)); touch('year'); }
      if (found.fuelType) { setFuelType(found.fuelType); touch('fuelType'); }
      setRegistryCodes({ tozeretCd: found.tozeretCd, degemCd: found.degemCd }); touch('registryCodes');
      const registryNote = outcome.status === 'unavailable' ? LOOKUP_MESSAGES.cachedFallback : 'הפרטים ממשרד התחבורה מוצגים לבדיקה. הם יישמרו בלחיצה על שמירה.';
      setRefreshNote(registryNote);
      const specs = await fetchVehicleSpecs({ make: found.make, model: found.model, engineCc: found.engineVolume, tozeretCd: found.tozeretCd, degemCd: found.degemCd, year: found.year, fuelType: found.fuelType, powertrain: found.powertrain }, controller.signal);
      if (current()) setRefreshNote(`${registryNote} ${applySpecs(specs, found.powertrain)}`);
    } catch {
      if (current()) setRefreshNote(LOOKUP_MESSAGES.unavailable);
    } finally {
      if (current()) setRefreshing(false);
    }
  }

  async function save() {
    if (saving.current || refreshing || !dirty.size) return;
    if (!valid) { setError('בדקו את השדות המסומנים ואת שם היצרן.'); form.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus(); return; }
    const patch: Partial<Vehicle> = {};
    if (dirty.has('make')) patch.make = make.trim();
    if (dirty.has('model')) patch.model = model.trim();
    if (dirty.has('year')) patch.year = year ? Number(year) : null;
    if (dirty.has('plate')) patch.plateNumber = plate.replace(/\D/g, '') || null;
    if (dirty.has('fuelType')) patch.fuelType = fuelType;
    if (dirty.has('nickname')) patch.nickname = nickname.trim() || null;
    if (dirty.has('registryCodes')) { patch.tozeretCd = registryCodes.tozeretCd ?? null; patch.degemCd = registryCodes.degemCd ?? null; }
    if (dirty.has('tank')) { patch.tankLiters = tank.trim() ? parseDecimal(tank) : null; patch.tankLitersSource = tank.trim() ? tankSource ?? 'user' : 'user'; patch.tankSourceUrl = tank.trim() ? tankUrl ?? null : null; }
    if (dirty.has('ev')) Object.assign(patch, evPatch);
    if (dirty.has('declared')) { patch.declaredKmPerLiter = declared.trim() ? parseDecimal(declared) : null; patch.declaredSource = declared.trim() ? declaredSource ?? 'user' : 'user'; patch.specSourceUrl = declared.trim() ? specUrl ?? null : null; }
    const isCurrent = captureScope();
    if (!isCurrent()) return;
    saving.current = true; setState('submitting'); setError('');
    try {
      const receipt = await updateVehicle(vehicle.id, patch);
      if (!isCurrent()) return;
      setState('pending');
      const accepted = await receipt.settled;
      if (!isCurrent()) return;
      if (!accepted) { setError('השינוי טרם אושר. הפרטים נשארו בטופס ובשינויים שעוד לא עלו לענן.'); setState('idle'); return; }
      showToast({ tone: 'success', title: 'פרטי הרכב עודכנו' });
      navigate(back);
    } catch (cause) {
      if (isCurrent()) { setError(cause instanceof Error ? cause.message : 'לא ניתן לשמור. הפרטים נשארו בטופס.'); setState('idle'); }
    } finally { saving.current = false; }
  }

  return <VehicleEditPage back={back}>
    <PlateXL value={plate}/>
    <form ref={form} className="tm-vehicle-form" noValidate onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset disabled={state !== 'idle' || refreshing}>
        <Field label="מספר רכב" inputMode="numeric" value={plate} maxLength={8} hint={plate ? <NumRun>{formatPlate(plate)}</NumRun> : 'אפשר להזין את הפרטים גם ללא מספר רכב'} onChange={event => { setPlate(event.target.value.replace(/\D/g, '').slice(0, 8)); touch('plate'); }}/>
        <Button variant="line" full onClick={() => void refresh()} disabled={refreshing}>{refreshing ? <Spinner size={18}/> : <RefreshIcon size={18}/>}עדכון ממשרד התחבורה</Button>
        {refreshNote ? <p role="status" className="tm-vehicle-note"><NumericText>{refreshNote}</NumericText></p> : null}
        <Field label="כינוי לרכב" dir="auto" maxLength={60} placeholder="למשל, המאזדה שלי" value={nickname} onChange={event => { setNickname(event.target.value); touch('nickname'); }}/>
        <div className="tm-vehicle-field-pair"><Field label="יצרן" required dir="auto" maxLength={60} value={make} onChange={event => { setMake(event.target.value); touch('make'); }}/><Field label="דגם" dir="auto" maxLength={80} value={model} onChange={event => { setModel(event.target.value); touch('model'); }}/></div>
        <Field label="שנת ייצור" inputMode="numeric" value={year} error={yearError ? <NumericText>{yearError}</NumericText> : null} maxLength={4} onChange={event => { setYear(event.target.value.replace(/\D/g, '').slice(0, 4)); touch('year'); }}/>
        {electric ? <div className="tm-vehicle-field-group" data-testid="vehicle-edit-ev">
          <span className="tm-vehicle-field-label">הנעה</span>
          <p className="tm-vehicle-note">רכב חשמלי · אין מיכל דלק, נפח מנוע או צריכה בק״מ לליטר.
            {electricBattery?.kwh ? <> סוללה <NumRun>{electricBattery.kwh}</NumRun> kWh.</> : null}
            {electricBattery?.wltp ? <> טווח WLTP <NumRun>{electricBattery.wltp}</NumRun> ק״מ.</> : null}
            {electricMotor ? <> מנוע <NumRun>{electricMotor}</NumRun> kW.</> : null}</p>
        </div> : <>
        <div className="tm-vehicle-field-group"><span className="tm-vehicle-field-label">סוג דלק</span><Segmented<FuelType> value={fuelType} ariaLabel="סוג דלק" options={(['95', '98', 'diesel', 'other'] as const).map(value => ({ value, label: FUEL_TYPE_SHORT[value] }))} onChange={value => { setFuelType(value); touch('fuelType'); }}/></div>
        {fuelType !== '95' ? <p className="tm-vehicle-warning"><WarningIcon size={20}/><NumericText>רק לבנזין 95 יש מחיר מרבי בפיקוח. אם תועד מחיר קודם לדלק הזה, נציע אותו; אחרת יש להזין את המחיר ששילמתם.</NumericText></p> : null}
        <div className="tm-vehicle-field-pair tm-vehicle-edit-numbers">
          <div className="tm-vehicle-edit-tank">
            <Field label="נפח מיכל" inputMode="decimal" suffix="ליטר" value={tank} error={tankError ? <NumericText>{tankError}</NumericText> : null} placeholder={tankHint ? String(tankHint) : 'לא ידוע'} onChange={event => { setTank(event.target.value); setTankSource('user'); setTankUrl(null); touch('tank'); }} hint={tankSource === 'estimate' ? 'הערכה לפי סוג הרכב — אפשר לאשר או לתקן לפי מדריך הרכב' : tankSource === 'trusted' ? 'נתון ממפרט יצרן' : tank && (!tankSource || tankSource === 'legacy') ? 'הערך הקיים נשמר בלי מקור ידוע. אשרו אותו לפי מדריך הרכב.' : 'מופיע במדריך הרכב; אפשר להשלים מאוחר יותר'}/>
            {tank.trim() && (!tankSource || tankSource === 'legacy' || tankSource === 'estimate') ? <button type="button" className="tm-vehicle-chip" onClick={() => { setTankSource('user'); touch('tank'); }}>בדקתי — זה נפח המיכל</button> : null}
            {!tank.trim() && tankHint ? <button type="button" className="tm-vehicle-chip tm-vehicle-chip-dashed" onClick={() => { setTank(String(tankHint)); setTankSource('estimate'); setTankUrl(null); touch('tank'); }}><NumericText>{`שימוש בהערכה: ${tankHint} ליטר`}</NumericText></button> : null}
          </div>
          <Field label={declaredSource === 'co2-estimate' ? 'צריכת ייחוס משוערת' : 'נתון יצרן'} inputMode="decimal" suffix="ק״מ/ל׳" value={declared} error={declaredError ? <NumericText>{declaredError}</NumericText> : null} placeholder="לא ידוע" onChange={event => { setDeclared(event.target.value); setDeclaredSource('user'); setSpecUrl(null); touch('declared'); }} hint={declaredSource === 'co2-estimate' ? 'קירוב מנתוני CO₂. אפשר להזין נתון יצרן מדויק.' : declaredSource === 'other-year' ? 'נתון משנת ייצור אחרת — כדאי לבדוק התאמה לרכב.' : undefined}/>
        </div>
        </>}
      </fieldset>
      {error ? <p ref={errorNode} tabIndex={-1} role="alert" className="tm-vehicle-error"><NumericText>{error}</NumericText></p> : null}
      <Button type="submit" full disabled={state !== 'idle' || refreshing || !dirty.size}>{state !== 'idle' ? 'שומרים…' : 'שמירת שינויים'}</Button>
      {state === 'pending' || error ? <Link className="tm-vehicle-chip" to="/settings/unsynced">שינויים שעוד לא עלו לענן</Link> : null}
    </form>
  </VehicleEditPage>;
}
