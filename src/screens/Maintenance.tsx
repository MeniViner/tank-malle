import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useVehicleData } from '../context/VehicleDataContext';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';
import { useAccountScope } from '../components/account/useAccountScope';
import { FUEL_TYPE_LABELS, consumption, formatPlate, int, num, vehicleLabel } from '../lib/format';
import { isEv, readBattery, readMotorKw } from '../lib/vehicle/v3Fields';
import { BusinessStatementSheet } from '../components/business/BusinessStatementSheet';
import { Fact, FactsStrip } from '../components/FactsStrip';
import { vehicleDay, vehicleMoney } from '../lib/vehicle/format';
import { civilDaysBetween } from '../lib/vehicle/documents';
import { periodSummary } from '../lib/vehicle/derived';
import type { Job } from '../lib/maintenance/model';
import { VehiclePage, VehicleAddBar, CoverageNotice, VehicleInfo } from '../components/VehicleUI';
import { VehicleOverview } from '../components/VehicleOverview';
import { VehicleDocuments } from '../components/VehicleDocuments';
import { RunningCosts } from '../components/RunningCosts';
import { CareGlyph } from '../components/maintenance/CareGlyph';
import { PeriodPicker } from '../components/PeriodPicker';
import { NumericText, NumRun } from '../components/Fmt';
import { TankPreferencesSection } from '../components/TankPreferencesSection';
import { ChevronStart, PlusIcon, WarningIcon, WrenchIcon, CarIcon, SlidersIcon, DocumentIcon } from '../components/icons';

const statusLabels = { due: 'הגיע הזמן', soon: 'מתקרב', unknown: 'נדרש עדכון ק״מ', later: 'בהמשך', done: 'הושלם' };
const suggestions: { job: Job; label: string }[] = [{ job: 'periodic', label: 'טיפול תקופתי' }, { job: 'oil', label: 'החלפת שמן' }, { job: 'tires', label: 'החלפת צמיגים' }];

export function Maintenance() {
  const v = useVehicleData();
  const { showToast } = useToast();
  const captureAccount = useAccountScope(v.uid);
  const { activeVehicle, activeVehicles, setActiveVehicle, settings } = useData();
  const [params] = useSearchParams();
  const requested = params.get('tab') ?? 'due';
  const tab = ['costs', 'details', 'prefs'].includes(requested) && !params.has('doc') ? requested : 'due';
  const [period, setPeriod] = useState('all');
  const [statementOpen, setStatementOpen] = useState(false);
  if (!activeVehicle) return <VehiclePage title="הרכב שלי"><div className="tm-vehicle-empty"><CarIcon size={28}/><h2>כאן מכירים את הרכב</h2><p>בחרו רכב או הוסיפו אחד כדי לרכז רישוי, ביטוח ותחזוקה.</p><Link className="tm-button tm-button-primary" to="/settings/vehicles">ניהול רכבים</Link><Link className="tm-vehicle-chip" to="/vehicles/new">הוספת רכב</Link></div></VehiclePage>;
  const year = v.today.slice(0, 4);
  const ev = isEv(activeVehicle);
  const battery = readBattery(activeVehicle.battery);
  const motorKw = readMotorKw(activeVehicle.motorKw);
  const years = [...new Set(v.ledger.map(r => r.day.slice(0, 4)))].sort().reverse();
  const yearSummary = periodSummary(v.ledger, v.mileage, `${year}-01-01`, v.today, v.incomplete);
  const activeReminders = v.reminders.filter(row => row.plan.active);
  const paused = v.reminders.filter(row => !row.plan.active);
  const openIssues = v.extra.vehicleIssues.filter(issue => issue.status !== 'resolved');
  const resolvedIssues = v.extra.vehicleIssues.filter(issue => issue.status === 'resolved');
  const declared = consumption(activeVehicle.declaredKmPerLiter ?? null, settings.units ?? 'kmPerLiter');
  const subTitle = { costs: 'עלויות הרכב', details: 'פרטי הרכב', prefs: 'הגדרות הרכב', due: 'הרכב שלי' }[tab] ?? 'הרכב שלי';

  const reminderRow = (row: typeof v.reminders[number]) => {
    const { plan, due, status } = row;
    const days = due.day ? civilDaysBetween(v.today, due.day) : null;
    const mileageAge = v.currentMileage ? civilDaysBetween(v.currentMileage.day, v.today) : null;
    const km = due.odometer !== null && v.currentMileage && !v.currentMileage.ambiguous && mileageAge !== null && mileageAge <= 30 ? due.odometer - v.currentMileage.odometer : null;
    // A date and an odometer are independent triggers; the status must not
    // conceal a nearby km threshold behind a distant calendar countdown.
    const count = due.day && due.odometer !== null ? null : days ?? km;
    const subtitle = [due.day ? vehicleDay(due.day) : null, due.odometer !== null ? `${due.odometer.toLocaleString('he-IL')} ק״מ` : null].filter(Boolean).join(' או ');
    return <Link className="tm-vehicle-row" key={plan.id} to={`/vehicle/reminders/${encodeURIComponent(plan.id)}`}>
      <span className="tm-vehicle-row-icon"><CareGlyph kind={plan.job} size={20}/></span>
      <span className="tm-vehicle-row-main"><strong><NumericText>{plan.title}</NumericText></strong><small><NumericText>{`${subtitle}${due.day && due.odometer !== null ? ' · המוקדם מביניהם' : ''}`}</NumericText></small></span>
      <span className="tm-vehicle-due" data-soon={status === 'soon' || status === 'due'}>
        {plan.active && (status === 'soon' || status === 'later') && count !== null && count > 0 ? <><strong><NumRun>{count.toLocaleString('he-IL')}</NumRun></strong><small>{days !== null ? days === 1 ? 'יום נותר' : 'ימים נותרו' : 'ק״מ נותרו'}</small></> : <small>{plan.active ? statusLabels[status] : 'מושהית'}</small>}
      </span>
    </Link>;
  };
  const issueRow = (issue: typeof openIssues[number]) => <Link className="tm-vehicle-row" key={issue.id} to={`/vehicle/issues/${encodeURIComponent(issue.id)}`}><span className="tm-vehicle-row-icon"><WarningIcon size={20}/></span><span className="tm-vehicle-row-main"><strong><NumericText>{issue.title}</NumericText></strong><small><NumericText>{issue.symptoms || vehicleDay(issue.day)}</NumericText></small></span><span className="tm-vehicle-due" data-soon={issue.importance === 'important' && issue.status !== 'resolved'}><small>{{ open: 'פתוחה', watching: 'במעקב', resolved: 'נפתרה' }[issue.status]}</small></span></Link>;

  return <VehiclePage title={subTitle} heading={tab !== 'due'} vehicleChoice={tab !== 'due' ? vehicleLabel(activeVehicle) : undefined} back={tab !== 'due' ? '/vehicle' : undefined}>
    {tab === 'due' ? <>
      <VehicleOverview/>
      <VehicleDocuments/>
      <section className="tm-vehicle-section" aria-labelledby="vehicle-reminders-heading">
        <div className="tm-vehicle-section-head"><h2 id="vehicle-reminders-heading" className="tm-vehicle-section-title">תזכורות</h2><button type="button" onClick={() => v.edit({ collection: 'maintenancePlans' })}><PlusIcon size={16}/>תזכורת</button></div>
        {activeReminders.length ? <div className="tm-vehicle-rows">{activeReminders.map(reminderRow)}</div> : <p className="tm-vehicle-note">מה כדאי שנזכיר לכם?</p>}
        <div className="tm-vehicle-suggestions">{suggestions.filter(item => !v.reminders.some(row => row.plan.job === item.job)).map(item => <button key={item.job} className="tm-vehicle-chip tm-vehicle-chip-dashed" type="button" onClick={() => v.edit({ collection: 'maintenancePlans', initialJob: item.job })}><PlusIcon size={15}/>{item.label}</button>)}</div>
        {paused.length ? <details className="tm-vehicle-disclosure"><summary>תזכורות מושהות <NumRun>{paused.length}</NumRun></summary><div className="tm-vehicle-rows">{paused.map(reminderRow)}</div></details> : null}
        <VehicleInfo title="איך נקבע מועד התזכורת?"><p>התזכורות מוצגות באפליקציה. תאריך וק״מ נבדקים בנפרד, לפי המועד שמגיע ראשון. את היעדים קובעים לפי הוראות היצרן או המוסך.</p></VehicleInfo>
      </section>
      <section className="tm-vehicle-section" aria-labelledby="vehicle-issues-heading"><h2 id="vehicle-issues-heading" className="tm-vehicle-section-title">מה קורה ברכב</h2><div className="tm-vehicle-rows">{openIssues.map(issueRow)}<button type="button" className="tm-vehicle-row" onClick={() => v.edit({ collection: 'vehicleIssues' })}><span className="tm-vehicle-row-icon"><PlusIcon size={20}/></span><span className="tm-vehicle-row-main"><strong>משהו השתנה ברכב?</strong><small>רעש, נורה, תקלה. נעקוב עד שזה מתוקן</small></span><ChevronStart size={18}/></button></div>{resolvedIssues.length ? <details className="tm-vehicle-disclosure" open={requested === 'issues'}><summary>תקלות שנפתרו <NumRun>{resolvedIssues.length}</NumRun></summary><div className="tm-vehicle-rows">{resolvedIssues.map(issueRow)}</div></details> : null}</section>
      <div className="tm-vehicle-links">
        <Link className="tm-vehicle-link" to="/vehicle?tab=costs"><span><NumericText>{`${year} עד עכשיו`}</NumericText><small>{yearSummary.incomplete || yearSummary.unknown ? 'הסכום הידוע · נתונים חלקיים' : 'עלויות הרכב'}</small></span><span><NumericText>{vehicleMoney(yearSummary.total)}</NumericText></span><ChevronStart size={18}/></Link>
        <Link className="tm-vehicle-link" to="/history?kind=service"><WrenchIcon size={20}/><span>טיפולים<small><NumericText>{`${v.care.data.serviceEvents.length} ${v.care.data.serviceEvents.length === 1 ? 'רשומה' : 'רשומות'} ביומן`}</NumericText></small></span><ChevronStart size={18}/></Link>
        <Link className="tm-vehicle-link" to={`/vehicle/edit/${encodeURIComponent(activeVehicle.id)}`}><CarIcon size={20}/><span>פרטי הרכב<small>{ev ? 'דגם, סוללה, טווח והספק' : 'דגם, סוג דלק, נפח מיכל, נתון יצרן'}</small></span><ChevronStart size={18}/></Link>
        <button type="button" className="tm-vehicle-link" data-testid="vehicle-business-statement" aria-haspopup="dialog" onClick={() => setStatementOpen(true)}><DocumentIcon size={20}/><span>דוח חודשי לעסק<small>PDF או CSV של כל ההוצאות בחודש</small></span><ChevronStart size={18}/></button>
        <Link className="tm-vehicle-link" to="/vehicle?tab=prefs"><SlidersIcon size={20}/><span>הגדרות הרכב<small>{ev ? 'רכבים נוספים והעדפות' : 'העדפות מיכל ורכבים נוספים'}</small></span><ChevronStart size={18}/></Link>
      </div>
      <VehicleAddBar includeMileage={false}/>
    </> : null}
    <CoverageNotice/>
    {v.care.errors.length || v.extraErrors.length ? <p className="tm-vehicle-error" role="alert">לא ניתן לקרוא חלק מהנתונים. אפשר לנסות שוב לאחר רענון.</p> : null}
    {tab === 'costs' ? <><div className="v-period"><span>תקופת הסיכום</span><PeriodPicker value={period} onChange={setPeriod} ariaLabel="תקופת הסיכום" options={[{ value: 'all', label: 'כל התקופה' }, { value: 'year', label: 'השנה' }, { value: 'month', label: 'החודש' }]}/></div><RunningCosts ev={ev} from={period === 'month' ? v.today.slice(0, 7) + '-01' : period === 'year' ? year + '-01-01' : '1900-01-01'} to={v.today}/><h2 className="tm-vehicle-section-title">לפי שנה</h2><div className="v-years">{years.map(value => { const summary = periodSummary(v.ledger, v.mileage, `${value}-01-01`, `${value}-12-31`, v.incomplete), gross = summary.fuel + summary.maintenance + summary.other; return <Link className="vehicle-year-row" to={`/vehicle/years/${value}`} key={value}><span className="vehicle-year-head"><b><NumRun>{value}</NumRun></b>{gross > 0 ? <span className="vehicle-year-bar" aria-label={`חלוקת הוצאות לפני החזרים: ${ev ? 'חשמל' : 'דלק'} ${vehicleMoney(summary.fuel)}, טיפולים ${vehicleMoney(summary.maintenance)}, אחרות ${vehicleMoney(summary.other)}`} role="img">{[summary.fuel, summary.maintenance, summary.other].map((amount, index) => <span key={index} style={{ width: `${100 * amount / gross}%` }}/>)}</span> : <span className="vehicle-year-bar vehicle-year-bar-empty" aria-hidden="true"/>}<span className="vehicle-year-total"><NumericText>{vehicleMoney(summary.total)}</NumericText></span><ChevronStart size={16}/></span><small><NumericText>{`${summary.count} ${summary.count === 1 ? 'רשומה' : 'רשומות'}${summary.refunds ? ` · הוחזרו ${vehicleMoney(summary.refunds)}` : ''}${summary.unknown ? ` · ${summary.unknown} ${summary.unknown === 1 ? 'עלות חסרה' : 'עלויות חסרות'}` : ''}`}</NumericText></small></Link>; })}</div><VehicleAddBar includeMileage={false}/></> : null}
    {tab === 'details' ? <><FactsStrip label="פרטי הרכב" testId="vehicle-details-facts" className="v-details-facts">
      <Fact label="יצרן ודגם" valueKind="text" value={`${activeVehicle.make} ${activeVehicle.model}`.trim() || 'לא תועד'}/>
      <Fact label="שנת ייצור" valueKind={activeVehicle.year ? undefined : 'text'} value={activeVehicle.year ? String(activeVehicle.year) : 'לא תועדה'} muted={!activeVehicle.year}/>
      <Fact label="מספר רישוי" valueKind={activeVehicle.plateNumber ? undefined : 'text'} value={activeVehicle.plateNumber ? formatPlate(activeVehicle.plateNumber) : 'לא תועד'} muted={!activeVehicle.plateNumber}/>
      {ev ? <>
        <Fact label="הנעה" valueKind="text" value="חשמלי"/>
        <Fact label="סוללה" sub={battery?.kwh ? undefined : 'לא ידוע'} value={battery?.kwh ? num(battery.kwh, 1) : null} unit="kWh" testId="vehicle-battery"/>
        <Fact label="טווח WLTP" sub={battery?.wltp ? 'נתון יצרן' : 'לא ידוע'} value={battery?.wltp ? int(battery.wltp) : null} unit="ק״מ" testId="vehicle-wltp"/>
        <Fact label="הספק מנוע" sub={motorKw ? undefined : 'לא ידוע'} value={motorKw ? int(motorKw) : null} unit="kW" testId="vehicle-motor"/>
      </> : <>
        <Fact label="סוג דלק" valueKind="text" value={FUEL_TYPE_LABELS[activeVehicle.fuelType]}/>
        <Fact label="נפח מיכל" testId="vehicle-tank" sub={activeVehicle.tankLiters ? activeVehicle.tankLitersSource === 'estimate' ? 'הערכה לפי סוג הרכב' : 'מאושר' : 'לא ידוע'} value={activeVehicle.tankLiters ? int(activeVehicle.tankLiters) : null} unit="ל׳"/>
        <Fact label="צריכה מוצהרת" testId="vehicle-declared" sub={activeVehicle.declaredKmPerLiter ? undefined : 'לא תועדה'} value={activeVehicle.declaredKmPerLiter ? declared.value : null} unit={declared.unit}/>
      </>}
    </FactsStrip><Link className="tm-button tm-button-primary" to={`/vehicle/edit/${encodeURIComponent(activeVehicle.id)}`}>עריכת פרטי הרכב</Link><div className="tm-vehicle-links"><Link className="tm-vehicle-link" to="/history?kind=service">היסטוריית הטיפולים<ChevronStart size={18}/></Link><button type="button" className="tm-vehicle-link" aria-haspopup="dialog" onClick={() => setStatementOpen(true)}>דוח חודשי לעסק<ChevronStart size={18}/></button><Link className="tm-vehicle-link" to="/settings/vehicles">רכבים נוספים וארכיון<ChevronStart size={18}/></Link><Link className="tm-vehicle-link" to="/account">הנתונים שלי וגיבוי<ChevronStart size={18}/></Link></div></> : null}
    {tab === 'prefs' ? <>{ev ? null : <section aria-label="הגדרות הרכב"><div className="v-group"><TankPreferencesSection embedded/></div></section>}<div className="tm-vehicle-links">{activeVehicles.length > 1 ? activeVehicles.map(vehicle => <button type="button" className="tm-vehicle-link" key={vehicle.id} onClick={() => { const isCurrent = captureAccount(); void setActiveVehicle(vehicle.id).catch(() => { if (isCurrent()) showToast({ tone: 'error', title: 'בחירת הרכב לא נשמרה' }); }); }}><span><NumericText>{vehicleLabel(vehicle)}</NumericText></span><small>{vehicle.id === activeVehicle.id ? 'פעיל' : 'בחירה'}</small></button>) : null}<Link className="tm-vehicle-link" to="/settings/vehicles">רכבים וארכיון<ChevronStart size={18}/></Link><Link className="tm-vehicle-link" to="/vehicles/new">הוספת רכב<PlusIcon size={18}/></Link><Link className="tm-vehicle-link" to="/account">העדפות האפליקציה<ChevronStart size={18}/></Link></div></> : null}
    <BusinessStatementSheet open={statementOpen} onClose={() => setStatementOpen(false)}/>
  </VehiclePage>;
}
