/* טנק מלא · prototype — data, formatting and the derived-metrics engine.
   Like the real app, nothing derived is stored: every number on screen is computed
   from raw records by compute(). */
(function () {
  'use strict';
  const TODAY = new Date('2026-11-02T09:30:00');
  const T0 = Date.now();
  const now = () => new Date(TODAY.getTime() + (Date.now() - T0));
  const DAY = 864e5;
  const uid = () => Math.random().toString(36).slice(2, 10);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  const MS = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];

  const pad2 = (n) => String(n).padStart(2, '0');
  const isoLocal = (dt) => `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}T${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
  const mkey = (dt) => `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}`;

  const fmt = {
    money: (v) => (v < 0 ? '−' : '') + Math.round(Math.abs(v)).toLocaleString('en-US') + '\u202f₪',
    price: (v) => Number(v).toFixed(2) + '\u202f₪',
    int: (v) => Math.round(v).toLocaleString('en-US'),
    dec: (v, n = 1) => Number(v).toFixed(n),
    dayMon: (dt) => `${dt.getDate()} ב${MS[dt.getMonth()]}`,
    short: (dt) => `${dt.getDate()} ${MS[dt.getMonth()]}`,
    date: (dt) => `${dt.getDate()} ב${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`,
    month: (key) => { const [y, m] = key.split('-').map(Number); return MONTHS[m - 1] + (y !== TODAY.getFullYear() ? ' ' + y : ''); },
    monthShort: (key) => MS[Number(key.split('-')[1]) - 1],
    time: (dt) => `${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`,
    rel: (dt) => {
      const a = new Date(now()); a.setHours(0, 0, 0, 0);
      const b = new Date(dt); b.setHours(0, 0, 0, 0);
      const days = Math.round((a - b) / DAY);
      if (days === 0) return 'היום';
      if (days === 1) return 'אתמול';
      if (days === -1) return 'מחר';
      if (days > 1 && days < 7) return `לפני ${days} ימים`;
      return fmt.dayMon(dt);
    },
    plate: (p) => {
      const s = String(p || '').replace(/\D/g, '');
      if (s.length === 7) return `${s.slice(0, 2)}-${s.slice(2, 5)}-${s.slice(5)}`;
      if (s.length === 8) return `${s.slice(0, 3)}-${s.slice(3, 5)}-${s.slice(5)}`;
      return s;
    },
  };

  /* ---------- reference data ---------- */
  const STATIONS = [
    { id: 'dl-km', name: 'דלק קרית מלאכי', brand: 'd', dist: 0.3 },
    { id: 'sn-gd', name: 'סונול גדרה', brand: 's', dist: 9.5 },
    { id: 'dl-ms', name: 'דלק מסמיה', brand: 'd', dist: 6.8 },
    { id: 'pz-sl', name: 'פז סילבר', brand: 'p', dist: 12.1 },
    { id: 'da-as', name: 'דור אלון אשדוד', brand: 'a', dist: 17.4 },
    { id: 'pz-sh', name: 'פז שואבה', brand: 'p', dist: 38 },
    { id: 'pz-rm', name: 'פז רמות', brand: 'p', dist: 41 },
    { id: 'pz-bk', name: 'פז בקעה', brand: 'p', dist: 44 },
  ];
  const station = (id) => STATIONS.find((s) => s.id === id) || { id, name: id || 'תחנה לא ידועה', brand: 'x', dist: null };
  const brandLetter = { d: 'ד', p: 'פ', s: 'ס', a: 'א', x: '·' };

  // Regulated 95 self-service maximum, by month (illustrative values).
  const OFFICIAL = { '2026-05': 7.49, '2026-06': 7.62, '2026-07': 7.71, '2026-08': 7.95, '2026-09': 7.95, '2026-10': 7.58, '2026-11': 7.35 };
  const PUBLISHED = { ...OFFICIAL };
  const officialFor = (dt) => OFFICIAL[mkey(dt)] || 7.35;

  const SERVICE_KINDS = [
    { id: 'periodic', label: 'טיפול תקופתי', icon: 'wrench' },
    { id: 'tires', label: 'צמיגים', icon: 'tire' },
    { id: 'oil', label: 'שמן ומסננים', icon: 'oil' },
    { id: 'brakes', label: 'בלמים', icon: 'brake' },
    { id: 'battery', label: 'מצבר', icon: 'battery' },
    { id: 'repair', label: 'תיקון', icon: 'tools' },
    { id: 'other', label: 'אחר', icon: 'plus' },
  ];
  const EXPENSE_KINDS = [
    { id: 'insurance', label: 'ביטוח', icon: 'shield' },
    { id: 'license', label: 'רישוי וטסט', icon: 'doc' },
    { id: 'parking', label: 'חניה', icon: 'parking' },
    { id: 'toll', label: 'כביש אגרה', icon: 'road' },
    { id: 'wash', label: 'שטיפה', icon: 'drop' },
    { id: 'fine', label: 'דוח', icon: 'ticket' },
    { id: 'other', label: 'אחר', icon: 'coin' },
  ];
  // Curated accent palette. The licence plate itself always stays plate-yellow.
  const ACCENTS = [
    { id: 'plate', label: 'צהוב לוחית', light: '#F3C54B', dark: '#D7AE3A' },
    { id: 'mint', label: 'מנטה', light: '#7DD6B6', dark: '#5FBC9C' },
    { id: 'sky', label: 'תכלת', light: '#93CCF2', dark: '#79B5DE' },
    { id: 'peach', label: 'אפרסק', light: '#F7AE86', dark: '#DE9772' },
    { id: 'lilac', label: 'לילך', light: '#C8A8F0', dark: '#B59AD8' },
    { id: 'lime', label: 'ליים', light: '#CFE24E', dark: '#BACB48' },
  ];
  const accentOf = (id) => ACCENTS.find((a) => a.id === id) || ACCENTS[0];
  const REMINDER_KINDS = [
    { id: 'periodic', label: 'טיפול תקופתי', by: 'km', km: 10000 },
    { id: 'oil', label: 'החלפת שמן', by: 'km', km: 15000 },
    { id: 'tires', label: 'החלפת צמיגים', by: 'km', km: 40000 },
  ];
  const kindIcon = (r) => {
    const list = r.type === 'service' ? SERVICE_KINDS : EXPENSE_KINDS;
    const k = list.find((x) => x.id === (r.kind || r.cat));
    return k ? k.icon : r.type === 'service' ? 'wrench' : 'coin';
  };
  const INSURERS = ['הראל', 'מגדל', 'הפניקס', 'כלל', 'מנורה', 'ביטוח ישיר', 'AIG', 'שומרה', 'איילון', 'ליברה', '9 מיליון', 'שירביט'];
  const COVERAGE = { comprehensive: 'ביטוח מקיף', third: 'ביטוח צד ג׳', none: 'בלי ביטוח רכב' };
  // Licensing and insurance live on the vehicle; every vehicle shows these three rows.
  const emptyDocs = () => ({ test: { due: null }, mandatory: { insurer: '', due: null, cost: null }, coverage: { type: null, insurer: '', due: null, cost: null } });
  const FUEL_TYPES = [{ id: '95', label: 'בנזין 95', regulated: true }, { id: '98', label: 'בנזין 98' }, { id: 'סולר', label: 'סולר' }, { id: 'אחר', label: 'אחר' }];
  const FUEL_KEY = { '95': '95', '98': '98', 'סולר': 'diesel', 'אחר': 'other' };
  const fuelLabel = (v) => (v.powertrain === 'ev' ? 'חשמלי' : (FUEL_TYPES.find((f) => f.id === v.fuel) || FUEL_TYPES[0]).label);
  // Why did you fill up? (saved with the fill-up, shown in the journal)
  const REASONS = [{ id: 'routine', label: 'כרגיל' }, { id: 'low', label: 'כמעט נגמר' }, { id: 'trip', label: 'לפני נסיעה' }, { id: 'price', label: 'מחיר טוב' }, { id: 'unsure', label: 'לא בטוח' }];
  // Reminder scheduling: where the next date comes from, and who said so.
  const REMINDER_BASIS = [{ id: 'completion', label: 'מההשלמה', sub: 'המועד הבא נספר מהטיפול האחרון שבוצע' }, { id: 'fixed', label: 'מחזור קבוע', sub: 'יעדים קבועים מהיעד הראשון, גם אם איחרתם' }, { id: 'manual', label: 'הגדרה ידנית', sub: 'תאריך או ק״מ שאתם קובעים' }];
  const REMINDER_SOURCE = [{ id: 'mfr', label: 'הוראות יצרן' }, { id: 'garage', label: 'המלצת מוסך' }, { id: 'mine', label: 'הגדרה שלי' }];
  const ISSUE_STATUS = { open: 'פתוחה', watching: 'במעקב', resolved: 'נפתרה' };
  const SYMPTOMS = ['רעש מוזר', 'נורה בלוח', 'רעידות', 'ריח'];
  // Small catalogue for the manual path of the wizard (the real app reads the Ministry of Transport list).
  const CATALOG = {
    'יונדאי': { 'i10': [2016, 2024], 'i20': [2012, 2024], 'i25': [2013, 2018], 'טוסון': [2016, 2025], 'איוניק': [2017, 2023] },
    'טויוטה': { 'יאריס': [2012, 2025], 'קורולה': [2010, 2025], 'RAV4': [2016, 2025], 'C-HR': [2017, 2024] },
    'מאזדה': { '2': [2015, 2024], '3': [2014, 2025], 'CX-5': [2017, 2025] },
    'קיה': { 'פיקנטו': [2015, 2024], 'ריו': [2015, 2023], 'ספורטז׳': [2016, 2025], 'נירו': [2017, 2025] },
    'סקודה': { 'פאביה': [2015, 2024], 'אוקטביה': [2013, 2025], 'קודיאק': [2017, 2025] },
    'סוזוקי': { 'סוויפט': [2014, 2024], 'ויטרה': [2016, 2024] },
    'BYD': { 'Atto 3': [2022, 2025], 'Dolphin': [2023, 2025], 'Seal': [2023, 2025] },
    'טסלה': { 'Model 3': [2019, 2025], 'Model Y': [2021, 2025] },
  };
  // Anonymous community pool (what other accounts published): one summary per vehicle.
  const COMMUNITY = [
    { make: 'יונדאי', model: 'i20 Inspire', year: 2013, fuel: '95', avg: 13.1, segs: 14, price: 7.41, tco: 1480 },
    { make: 'יונדאי', model: 'i20 Inspire', year: 2012, fuel: '95', avg: 11.4, segs: 9, price: 7.62, tco: 1390 },
    { make: 'יונדאי', model: 'i20 Inspire', year: 2014, fuel: '95', avg: 12.6, segs: 22, price: 7.35, tco: 1210 },
    { make: 'יונדאי', model: 'i20 Inspire', year: 2012, fuel: '95', avg: 10.2, segs: 6, price: 7.70, tco: 1620 },
    { make: 'קיה', model: 'פיקנטו', year: 2019, fuel: '95', avg: 15.8, segs: 11, price: 7.44, tco: 980 },
    { make: 'טויוטה', model: 'קורולה', year: 2020, fuel: '95', avg: 16.9, segs: 18, price: 7.39, tco: 1540 },
    { make: 'מאזדה', model: '3', year: 2018, fuel: '95', avg: 13.4, segs: 7, price: 7.58, tco: 1710 },
    { make: 'סקודה', model: 'אוקטביה', year: 2021, fuel: '95', avg: 15.1, segs: 13, price: 7.49, tco: 1830 },
    { make: 'BYD', model: 'Atto 3', year: 2024, fuel: 'חשמל', avg: 5.9, segs: 31, price: 0.74, tco: 920 },
    { make: 'BYD', model: 'Atto 3', year: 2023, fuel: 'חשמל', avg: 6.3, segs: 19, price: 0.61, tco: 870 },
    { make: 'טסלה', model: 'Model 3', year: 2022, fuel: 'חשמל', avg: 6.8, segs: 40, price: 0.88, tco: 1150 },
  ];
  // Who do we compare you with? Same model + fuel when there are enough summaries, otherwise same fuel.
  function communityGroup(v) {
    const same = COMMUNITY.filter((x) => x.make === v.make && x.model === v.model && x.fuel === v.fuel);
    if (same.length >= 4) return { kind: 'model', label: 'אותו דגם ואותו סוג דלק', pool: same };
    const fuel = COMMUNITY.filter((x) => x.fuel === v.fuel);
    return { kind: 'fuel', label: 'אותו סוג דלק', pool: fuel, modelCount: same.length };
  }
  // Electric: where you charge decides the price (×4 between home and fast DC).
  const CHARGE_PLACES = [
    { id: 'home', label: 'בית', short: 'בית', rate: null, color: '#1F6F4A' },
    { id: 'work', label: 'עבודה', short: 'עבודה', rate: 0, color: '#2E3E8C' },
    { id: 'ac', label: 'עמדה ציבורית (AC)', short: 'ציבורי AC', rate: 1.4, color: '#5B3A8E' },
    { id: 'dc', label: 'טעינה מהירה (DC)', short: 'מהיר DC', rate: 2.3, color: '#C8102E' },
  ];
  const chargePlace = (id) => CHARGE_PLACES.find((p) => p.id === id) || CHARGE_PLACES[2];
  const placeRate = (v, id) => (id === 'home' ? (v.homeTariff ?? 0.58) : chargePlace(id).rate);
  const EV_REMINDER_KINDS = [
    { id: 'tires', label: 'סבב / החלפת צמיגים', by: 'km', km: 10000 },
    { id: 'brakefluid', label: 'נוזל בלמים', by: 'date', days: 730 },
    { id: 'cabin', label: 'מסנן מזגן', by: 'km', km: 15000 },
    { id: 'battery', label: 'בדיקת סוללה', by: 'date', days: 365 },
  ];
  const PLATE_DB = {
    '7248078': { make: 'יונדאי', model: 'i20 Inspire', year: 2012, fuel: '95', tank: 45, mfr: 16.4, engineCc: 1396, trim: 'Inspire' },
    '31284901': { make: 'קיה', model: 'פיקנטו', year: 2019, fuel: '95', tank: 35, mfr: 19.6, engineCc: 1248 },
    '52839102': { make: 'BYD', model: 'Atto 3', year: 2024, fuel: 'חשמל', powertrain: 'ev', battery: { kwh: 60, wltp: 420 }, tank: 60, mfr: 7, motorKw: 150, trim: 'Design' },
    '11223344': { make: 'טסלה', model: 'Model 3', year: 2023, fuel: 'חשמל', powertrain: 'ev', battery: { kwh: 57.5, wltp: 513 }, tank: 57.5, mfr: 8.9, motorKw: 208 },
  };
  const PLATE_FALLBACK = [
    { make: 'טויוטה', model: 'קורולה', year: 2020, fuel: '95', tank: 50, mfr: 17.2 },
    { make: 'מאזדה', model: '3', year: 2018, fuel: '95', tank: 51, mfr: 15.9 },
    { make: 'סקודה', model: 'אוקטביה', year: 2021, fuel: '95', tank: 50, mfr: 18.5 },
  ];
  const lookupPlate = (plate) => PLATE_DB[plate] || PLATE_FALLBACK[Number(plate.slice(-1)) % PLATE_FALLBACK.length];

  /* ---------- demo data ---------- */
  function makeDemo() {
    const F = (date, odo, liters, price, st, full = true, extra = {}) => ({
      id: uid(), v: 'v1', type: 'fill', date, odo, liters, price, total: Math.round(liters * price * 100) / 100, station: st, full, ...extra,
    });
    return {
      user: { name: 'מני וינר', email: 'meniviner@gmail.com', admin: true },
      auth: { signedIn: true, onboarded: true },
      feedback: [
        { id: uid(), kind: 'bug', text: 'כשאני מוסיף תדלוק בלי קליטה, הוא נעלם עד שאני פותח מחדש את האפליקציה.', from: 'עומר דהן', date: '2026-11-01T21:14', handled: false, device: 'Android · Chrome 131' },
        { id: uid(), kind: 'idea', text: 'אפשר להוסיף תזכורת לבדוק לחץ אוויר בצמיגים פעם בחודש?', from: 'שירה מזרחי', date: '2026-10-30T08:02', handled: false, device: 'iPhone · Safari' },
        { id: uid(), kind: 'love', text: 'סוף סוף אני יודע כמה באמת עולה לי הרכב. תודה!', from: 'גיא חדד', date: '2026-10-27T19:40', handled: true, device: 'Android · Chrome 130' },
        { id: uid(), kind: 'bug', text: 'הייבוא מ-Excel לא זיהה את עמודת התאריך שלי (פורמט 22.10.26).', from: 'יעל רוזן', date: '2026-10-24T12:31', handled: false, device: 'Windows · Edge' },
      ],
      adminPrices: { '95': { value: 7.35, source: 'auto', at: '2026-11-01T06:00' }, '98': { value: 8.02, source: 'manual', at: '2026-11-01T09:12' }, diesel: { value: 7.08, source: 'manual', at: '2026-11-01T09:13' }, other: { value: null, source: 'manual', at: '2026-10-01T09:00' } },
      activeV: 'v1',
      vehicles: [
        { id: 'v1', nick: 'מניס כאר', plate: '7248078', make: 'יונדאי', model: 'i20 Inspire', year: 2012, fuel: '95', tank: 45, mfr: 16.4, archived: false,
          docs: { test: { due: '2026-11-24', cost: 1420 }, mandatory: { insurer: 'הראל', due: '2027-03-14', cost: 1180 }, coverage: { type: 'third', insurer: 'ביטוח ישיר', due: '2027-03-14', cost: 960 } } },
        { id: 'v2', nick: 'הפיקנטו', plate: '31284901', make: 'קיה', model: 'פיקנטו', year: 2019, fuel: '95', tank: 35, mfr: 19.6, archived: true, docs: emptyDocs() },
        { id: 'v3', nick: 'האטו', plate: '52839102', make: 'BYD', model: 'Atto 3', year: 2024, fuel: 'חשמל', powertrain: 'ev', battery: { kwh: 60, wltp: 420 }, tank: 60, mfr: 7, homeTariff: 0.58, archived: false,
          docs: { test: { due: '2027-02-10', cost: 1180 }, mandatory: { insurer: 'מגדל', due: '2027-02-09', cost: 1490 }, coverage: { type: 'comprehensive', insurer: 'מגדל', due: '2027-02-09', cost: 4200 } } },
      ],
      records: [
        F('2026-06-13T08:10', 167930, 31.0, 7.55, 'pz-rm'),
        F('2026-07-22T17:40', 168310, 29.7, 7.64, 'sn-gd'),
        F('2026-08-25T07:55', 168680, 30.6, 7.89, 'pz-bk'),
        F('2026-09-08T13:20', 168860, 12.0, 7.82, 'pz-sl', false),
        F('2026-09-25T19:20', 169040, 17.8, 7.90, 'pz-sh'),
        F('2026-10-03T12:05', 169420, 27.9, 7.46, 'pz-sl'),
        F('2026-10-12T09:30', 169775, 24.1, 7.58, 'dl-ms'),
        F('2026-10-22T18:45', 170081, 30.6, 7.58, 'dl-ms', true, { pumpConfirmed: true, reason: 'routine', pre: 0.25 }),
        F('2026-10-29T08:14', 170344, 28.2, 7.52, 'dl-km', true, { pumpConfirmed: true, reason: 'low', pre: 0.2, note: 'שטיפה כלולה' }),
        { id: uid(), v: 'v1', type: 'odo', date: '2026-11-01T20:00', odo: 170510 },
        { id: 's-periodic', v: 'v1', type: 'service', date: '2026-07-02T10:00', kind: 'periodic', label: 'טיפול תקופתי', cost: 650, odo: 168100, garage: 'מוסך יוסי, קרית מלאכי', note: 'שמן, מסננים, בדיקת בלמים' },
        { id: 's-tires', v: 'v1', type: 'service', date: '2026-10-20T11:00', kind: 'tires', label: 'צמיגים', cost: 400, odo: 170050, garage: 'פנצ׳ריה אשדוד', note: '2 צמיגים קדמיים' },
        { id: uid(), v: 'v1', type: 'expense', date: '2026-09-14T09:00', cat: 'toll', label: 'כביש אגרה', cost: 23, note: 'כביש 6' },
        { id: uid(), v: 'v1', type: 'expense', date: '2026-10-05T16:00', cat: 'wash', label: 'שטיפה', cost: 40, note: '' },
        { id: uid(), v: 'v1', type: 'expense', date: '2026-10-16T12:00', cat: 'parking', label: 'חניה', cost: 18, note: 'חניון אסותא', refund: true },
        { id: uid(), v: 'v1', type: 'expense', date: '2026-08-21T12:00', cat: 'fine', label: 'דוח חניה', cost: 250, note: 'לא קשור לתפעול הרכב', excluded: true },
        { id: uid(), v: 'v1', type: 'trip', date: '2026-11-07', km: 260, mode: 'extra', margin: 30, note: 'צפון' },
        ...evDemoCharges(),
      ],
      reminders: [
        { id: 'r-periodic', v: 'v1', kind: 'periodic', label: 'טיפול תקופתי', dueDate: null, dueKm: 178100, basis: 'completion', source: 'mfr', intervalKm: 10000, intervalMonths: 12, lastServiceId: 's-periodic', active: true },
        { id: 'r-wipers', v: 'v1', kind: 'other', label: 'מגבים', dueDate: '2026-12-15', dueKm: null, basis: 'manual', source: 'mine', active: false },
        { id: uid(), v: 'v3', kind: 'tires', label: 'סבב / החלפת צמיגים', dueDate: null, dueKm: 24000, basis: 'fixed', source: 'mfr', intervalKm: 10000, active: true },
      ],
      issues: [
        { id: 'i-brakes', v: 'v1', title: 'רעש קל בבלמים מאחור', symptoms: 'בעיקר בבלימה חזקה מירידה', date: '2026-10-28T10:00', odo: 170300, importance: 'normal', status: 'watching', open: true, serviceIds: [], history: [{ date: '2026-10-28', status: 'open', note: 'זוהה בנסיעה לעבודה' }, { date: '2026-11-01', status: 'watching', note: 'לא החמיר' }] },
        { id: 'i-ac', v: 'v1', title: 'מזגן מקרר חלש', symptoms: '', date: '2026-06-20T10:00', odo: null, importance: 'soon', status: 'resolved', open: false, serviceIds: ['s-periodic'], history: [{ date: '2026-06-20', status: 'open', note: '' }, { date: '2026-07-02', status: 'resolved', note: 'מילוי גז בטיפול' }] },
      ],
      notifications: [
        { id: uid(), kind: 'price', title: 'מחיר בנזין 95 ירד', body: 'בנובמבר: 7.35 ₪ לליטר, 23 אג׳ פחות מאוקטובר.', date: '2026-11-01T08:00', read: false, archived: false, snoozedUntil: null },
        { id: uid(), kind: 'doc', title: 'הטסט בעוד 22 ימים', body: 'תוקף הרישוי של מניס כאר מסתיים ב-24 בנוב׳. כדאי לקבוע תור.', date: '2026-10-25T08:00', read: false, archived: false, snoozedUntil: null },
        { id: uid(), kind: 'reminder', title: 'טיפול תקופתי מתקרב', body: 'לפי הקילומטראז׳ המשוער, הטיפול הבא בעוד כ-7,500 ק״מ.', date: '2026-10-31T19:00', read: true, archived: false, snoozedUntil: null },
        { id: uid(), kind: 'system', title: 'ברוכים הבאים לטנק מלא', body: 'כל תדלוק, כל שקל, כל ק״מ. רושמים תדלוק ראשון ומתחילים.', date: '2026-06-10T09:00', read: true, archived: true, snoozedUntil: null },
      ],
      settings: { theme: 'system', unit: 'kml', accent: 'plate', discount: { type: 'none', value: 0 }, quickScan: false, notif: { all: true, service: true, price: true, sync: true }, community: true, shareCost: false, offline: false, installed: false },
      account: { provider: 'Google', since: '2026-06-10', lastLogin: '2026-11-01T07:48' },
      dismissed: [],
      // Every save goes to the device first, then to the cloud. One old write is stuck for the demo (it needs a look).
      writes: [{ id: 'w-stuck', label: 'הוצאה · שטיפה', at: '2026-10-05T16:02', state: 'rejected', recId: null, error: 'permission-denied · הרשומה שייכת לרכב אחר' }],
    };
  }

  function evDemoCharges() {
    // A realistic half year: ~17 kWh/100 km, home charging to 80% every 2–4 days, the odd public/fast charge on long days.
    const out = [];
    let odo = 16420, soc = 80, seed = 11, t = new Date('2026-06-04T22:10:00'), n = 0;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const end = new Date('2026-11-01T21:00:00');
    while (t < end) {
      const days = 1 + Math.floor(rnd() * 3);
      const longTrip = rnd() < 0.12;
      const drive = Math.round(days * (30 + rnd() * 16) + (longTrip ? 180 + rnd() * 120 : 0));
      const per100 = 15.5 + rnd() * 3.5 + (longTrip ? 1.5 : 0);
      t = new Date(t.getTime() + days * 864e5 + (rnd() - 0.5) * 4 * 36e5);
      odo += drive;
      soc = Math.max(6, soc - (drive * per100) / 100 / 60 * 100);
      if (soc > 42 && !longTrip) continue; // not charging yet
      const where = longTrip && soc < 25 ? 'dc' : rnd() < 0.1 ? 'ac' : 'home';
      const socFrom = Math.round(soc);
      const socTo = where === 'dc' ? 75 + Math.round(rnd() * 8) : where === 'ac' ? 88 + Math.round(rnd() * 8) : (n % 6 === 5 ? 100 : 80);
      const kwh = Math.round(((socTo - socFrom) / 100) * 60 * 1.06 * 10) / 10;
      const rate = where === 'home' ? 0.58 : where === 'ac' ? 1.4 : 2.3;
      const station = where === 'ac' ? 'עמדת גן העיר, אשדוד' : where === 'dc' ? 'EVI פז שואבה' : '';
      out.push({ id: uid(), v: 'v3', type: 'charge', date: isoLocal(t), odo, kwh, socFrom, socTo, where, station, pricePerKwh: rate, total: Math.round(kwh * rate * 100) / 100 });
      soc = socTo; n++;
    }
    out.push({ id: uid(), v: 'v3', type: 'service', date: '2026-09-20T10:00', kind: 'tires', label: 'סבב צמיגים', cost: 180, odo: 19860, note: 'ליד הבית' });
    out.push({ id: uid(), v: 'v3', type: 'expense', date: '2026-10-11T09:00', cat: 'toll', label: 'כביש אגרה', cost: 31, note: 'כביש 6' });
    return out;
  }

  function makeEmpty() {
    return {
      user: { name: 'מני וינר', email: 'meniviner@gmail.com', admin: true },
      auth: { signedIn: false, onboarded: false },
      feedback: [], adminPrices: { '95': { value: 7.35, source: 'auto', at: '2026-11-01T06:00' }, '98': { value: 8.02, source: 'manual', at: '2026-11-01T09:12' }, diesel: { value: 7.08, source: 'manual', at: '2026-11-01T09:13' }, other: { value: null, source: 'manual', at: '2026-10-01T09:00' } },
      activeV: null, vehicles: [], records: [], reminders: [], issues: [], notifications: [],
      settings: { theme: 'system', unit: 'kml', accent: 'plate', discount: { type: 'none', value: 0 }, quickScan: false, notif: { all: true, service: true, price: true, sync: true }, community: true, shareCost: false, offline: false, installed: false },
      account: { provider: 'Google', since: isoLocal(now()).slice(0, 10), lastLogin: null },
      dismissed: [],
      writes: [],
    };
  }

  /* ---------- engine ---------- */
  function byDate(a, b) { return new Date(a.date) - new Date(b.date); }

  function segmentsOf(fills) {
    const sorted = [...fills].sort((a, b) => a.odo - b.odo || byDate(a, b));
    const segs = [];
    let start = null, acc = 0, cost = 0, partials = 0;
    for (const f of sorted) {
      if (f.missedBefore) { start = null; acc = 0; cost = 0; partials = 0; }
      if (!start) { if (f.full) { start = f; acc = 0; cost = 0; partials = 0; } continue; }
      acc += f.liters; cost += f.total;
      if (!f.full) { partials++; continue; }
      const km = f.odo - start.odo;
      if (km > 0 && acc > 0) segs.push({ id: f.id, from: start, to: f, km, liters: acc, cost, partials, kmpl: km / acc, date: new Date(f.date) });
      start = f; acc = 0; cost = 0; partials = 0;
    }
    return { segs, open: start ? { from: start, liters: acc, cost, partials } : null, sorted };
  }

  // Electric: a segment closes on EVERY charge whose state of charge before and after is known.
  // Energy used since the previous charge = (SoC after previous − SoC before this one) × battery.
  function segmentsEV(charges, v) {
    const sorted = [...charges].sort((a, b) => a.odo - b.odo || byDate(a, b));
    const segs = [];
    const cap = (v.battery && v.battery.kwh) || v.tank || 60;
    for (let i = 1; i < sorted.length; i++) {
      const p = sorted[i - 1], c = sorted[i];
      if (p.socTo == null || c.socFrom == null || c.missedBefore) continue;
      const km = c.odo - p.odo;
      const kwh = ((p.socTo - c.socFrom) / 100) * cap;
      if (km <= 0 || kwh <= 0) continue;
      segs.push({ id: c.id, from: p, to: c, km, liters: kwh, cost: kwh * (p.pricePerKwh || 0), partials: 0, kmpl: km / kwh, date: new Date(c.date) });
    }
    return { segs, open: null, sorted };
  }
  function evaluateCharge(db, vid, draft) {
    const v = db.vehicles.find((x) => x.id === vid);
    const others = db.records.filter((r) => r.v === vid && r.type === 'charge' && r.id !== draft.id);
    const { segs } = segmentsEV([...others, draft], v);
    return { seg: segs.find((s) => s.id === draft.id) || null, open: null };
  }

  function compute(db, vid) {
    const v = db.vehicles.find((x) => x.id === vid);
    if (!v) return null;
    const recs = db.records.filter((r) => r.v === vid);
    const isEV = v.powertrain === 'ev';
    const cap = isEV ? ((v.battery && v.battery.kwh) || v.tank) : v.tank;
    const fills = recs.filter((r) => r.type === (isEV ? 'charge' : 'fill'));
    const { segs, open, sorted } = isEV ? segmentsEV(fills, v) : segmentsOf(fills);
    const sumKm = segs.reduce((s, x) => s + x.km, 0);
    const sumL = segs.reduce((s, x) => s + x.liters, 0);
    const avg = sumL ? sumKm / sumL : null;
    const last = segs[segs.length - 1] || null;
    const best = segs.reduce((b, s) => (!b || s.kmpl > b.kmpl ? s : b), null);
    const worst = segs.reduce((b, s) => (!b || s.kmpl < b.kmpl ? s : b), null);

    // odometer timeline
    const pts = recs.filter((r) => r.odo > 0).map((r) => ({ odo: r.odo, date: new Date(r.date), type: r.type }));
    pts.sort((a, b) => a.date - b.date);
    const latest = pts.reduce((m, p) => (!m || p.odo > m.odo ? p : m), null);
    const first = pts[0] || null;
    let dailyKm = 30;
    if (latest && first && latest.date - first.date > 14 * DAY) dailyKm = (latest.odo - first.odo) / ((latest.date - first.date) / DAY);
    const nowD = now();
    const estOdo = latest ? latest.odo + dailyKm * Math.max(0, (nowD - latest.date) / DAY) : null;

    // tank estimate
    const effK = avg || (isEV ? ((v.battery && v.battery.wltp ? v.battery.wltp / cap : 6.5) * 0.8) : (v.mfr ? v.mfr * 0.8 : null));
    const lastFull = isEV ? ([...sorted].reverse().find((f) => f.socTo != null) || null) : ([...sorted].reverse().find((f) => f.full) || null);
    const obs = recs.filter((r) => r.type === 'tank').sort(byDate).pop() || null;
    let level = null, basis = null, baseDate = null;
    if (effK && latest) {
      let base = null, baseOdo = null;
      if (obs && (!lastFull || new Date(obs.date) > new Date(lastFull.date))) { base = obs.level; baseOdo = obs.odo; basis = 'obs'; baseDate = new Date(obs.date); }
      else if (lastFull) { base = isEV ? lastFull.socTo / 100 : 1; baseOdo = lastFull.odo; basis = 'full'; baseDate = new Date(lastFull.date); }
      if (base !== null) {
        const partialL = isEV ? 0 : fills.filter((f) => !f.full && new Date(f.date) > baseDate).reduce((s, f) => s + f.liters, 0);
        const used = Math.max(0, estOdo - baseOdo) / effK;
        level = clamp((base * cap - used + partialL) / cap, 0, 1);
      }
    }
    // learned habit: level before each fill that follows a full tank
    const samples = [];
    if (isEV) { for (const c of sorted) if (c.socFrom != null) samples.push(c.socFrom / 100); }
    else for (let i = 1; i < sorted.length; i++) if (sorted[i - 1].full && sorted[i].full) samples.push(clamp(1 - sorted[i].liters / v.tank, 0, 1));
    const pref = v.pref || {};
    const samplesUsed = pref.habitReset ? samples.slice(-Math.max(0, sorted.filter((f) => new Date(f.date) >= new Date(pref.habitReset)).length)) : samples;
    const learned = samplesUsed.length >= 3 ? clamp(samplesUsed.reduce((s, x) => s + x, 0) / samplesUsed.length, 0.1, 0.7) : null;
    const habit = pref.target != null ? pref.target : learned;
    const habitTo = isEV && sorted.length >= 3 ? Math.round(sorted.filter((c) => c.socTo != null).reduce((s, c) => s + c.socTo, 0) / Math.max(1, sorted.filter((c) => c.socTo != null).length)) : null;
    const reserve = pref.reserve != null ? pref.reserve : isEV ? 0.1 : 0.15;
    const target = Math.max(habit ?? 0.25, reserve);
    const kmLeft = level !== null ? level * cap * effK : null;
    const kmToTarget = level !== null ? Math.max(0, (level - target) * cap * effK) : null;
    // Planned trips only change the forecast; they never add kilometres or fuel to the records.
    const today0 = new Date(nowD); today0.setHours(0, 0, 0, 0);
    const trips = recs.filter((r) => r.type === 'trip' && new Date(r.date) >= today0).sort((a, b) => new Date(a.date) - new Date(b.date));
    let daysToTarget = kmToTarget !== null ? kmToTarget / dailyKm : null;
    let tripWarn = null;
    if (kmToTarget !== null && trips.length) {
      const t = trips[0];
      const daysUntil = Math.max(0, Math.round((new Date(t.date) - today0) / DAY));
      const need = (t.km || 0) + (t.margin || 0) + (t.mode === 'extra' ? daysUntil * dailyKm : Math.max(0, daysUntil - 1) * dailyKm);
      if (need > kmToTarget) { tripWarn = { trip: t, daysUntil, need }; daysToTarget = Math.min(daysToTarget, Math.max(0, daysUntil - 0.5)); }
    }

    // money
    const monthly = {};
    const add = (dt, k, val) => { const key = mkey(dt); monthly[key] = monthly[key] || { fuel: 0, service: 0, expense: 0, liters: 0, fills: 0, excluded: 0, refunds: 0 }; monthly[key][k] += val; };
    for (const r of recs) {
      const dt = new Date(r.date);
      if (r.type === 'fill') { add(dt, 'fuel', r.total); add(dt, 'liters', r.liters); add(dt, 'fills', 1); }
      if (r.type === 'charge') { add(dt, 'fuel', r.total); add(dt, 'liters', r.kwh); add(dt, 'fills', 1); }
      if (r.type === 'service') add(dt, 'service', r.cost);
      if (r.type === 'expense') { if (r.excluded) add(dt, 'excluded', r.cost); else add(dt, 'expense', r.refund ? -(r.cost || 0) : r.cost); if (r.refund) add(dt, 'refunds', r.cost || 0); }
    }
    // by calendar year, for the vehicle screen
    const yearly = {};
    for (const [k, m] of Object.entries(monthly)) { const y = k.slice(0, 4); const t = (yearly[y] = yearly[y] || { fuel: 0, service: 0, expense: 0, count: 0 }); t.fuel += m.fuel; t.service += m.service; t.expense += m.expense; }
    for (const r of recs) if (['fill', 'charge', 'service', 'expense'].includes(r.type)) { const y = r.date.slice(0, 4); if (yearly[y]) yearly[y].count++; }
    const unknownCosts = recs.filter((r) => (r.type === 'service' || r.type === 'expense') && (r.cost == null || r.cost === '')).length;
    // fill-ups worth a second look: a segment far off your own average
    const anomalies = new Set(segs.filter((s) => avg && (s.kmpl > avg * 1.6 || s.kmpl < avg * 0.55)).map((s) => s.id));
    // what the consumption figure rests on
    const measure = { fills: fills.length, full: fills.filter((f) => f.full).length, segments: segs.length, km: sumKm, liters: sumL, pendingFills: open ? open.partials + 1 : 0, pendingLiters: open ? open.liters : 0, hasBaseline: !!open, restarts: fills.filter((f) => f.missedBefore).length };
    const fuelTotal = fills.reduce((s, f) => s + f.total, 0);
    const segCost = segs.reduce((s, x) => s + x.cost, 0);
    const costPerKm = sumKm ? segCost / sumKm : null;
    const months = Object.keys(monthly).sort();
    const fuelMonths = months.filter((k) => monthly[k].fills > 0);
    const avgMonthFuel = fuelMonths.length ? fuelMonths.reduce((s, k) => s + monthly[k].fuel, 0) / Math.max(1, monthSpan(fuelMonths[0], mkey(nowD))) : null;

    // stations
    const st = {};
    for (const f of fills) {
      const key = isEV ? f.where : f.station;
      const s = (st[key] = st[key] || { id: key, count: 0, liters: 0, spent: 0, last: null });
      s.count++; s.liters += isEV ? f.kwh : f.liters; s.spent += f.total; if (!s.last || new Date(f.date) > new Date(s.last.date)) s.last = f;
    }
    const stations = Object.values(st).map((s) => ({ ...s, avgPrice: s.liters ? s.spent / s.liters : 0, info: isEV ? chargePlace(s.id) : station(s.id) })).sort((a, b) => a.avgPrice - b.avgPrice);
    const totalKwh = isEV ? fills.reduce((s, f) => s + f.kwh, 0) : 0;
    const homeShare = isEV && totalKwh ? fills.filter((f) => f.where === 'home' || f.where === 'work').reduce((s, f) => s + f.kwh, 0) / totalKwh : null;

    // True cost of ownership: everything the car costs, per month, over the last ≤12 months.
    // Variable costs come from the journal; fixed yearly costs (insurance, licence+test) come
    // from the vehicle's documents and are amortised. Journal expenses in the insurance/licence
    // categories are skipped whenever the matching document carries a cost, so nothing counts twice.
    const docs = v.docs || emptyDocs();
    const firstKey = months[0] || mkey(nowD);
    const win = Math.min(12, Math.max(1, monthSpan(firstKey, mkey(nowD))));
    const winStart = new Date(nowD); winStart.setDate(1); winStart.setMonth(winStart.getMonth() - (win - 1)); winStart.setHours(0, 0, 0, 0);
    const inWin = recs.filter((r) => new Date(r.date) >= winStart);
    const fixed = {
      mandatory: docs.mandatory && docs.mandatory.cost ? docs.mandatory.cost / 12 : null,
      coverage: !docs.coverage || !docs.coverage.type ? null : docs.coverage.type === 'none' ? 0 : docs.coverage.cost ? docs.coverage.cost / 12 : null,
      test: docs.test && docs.test.cost ? docs.test.cost / 12 : null,
    };
    const skipCats = new Set([fixed.mandatory != null || fixed.coverage ? 'insurance' : null, fixed.test != null ? 'license' : null].filter(Boolean));
    const sumWin = (pred) => inWin.filter(pred).reduce((s, r) => s + (r.type === 'fill' || r.type === 'charge' ? r.total : r.cost || 0), 0) / win;
    const tcoParts = [
      { id: 'fuel', label: isEV ? 'חשמל' : 'דלק', icon: isEV ? 'bolt' : 'pump', value: sumWin((r) => r.type === 'fill' || r.type === 'charge'), color: 'var(--c-fuel)' },
      { id: 'service', label: 'טיפולים ותיקונים', icon: 'wrench', value: sumWin((r) => r.type === 'service'), color: 'var(--c-service)' },
      { id: 'mandatory', label: 'ביטוח חובה', icon: 'shield', value: fixed.mandatory, color: 'var(--c-ins1)', docKey: 'mandatory' },
      { id: 'coverage', label: docs.coverage && docs.coverage.type ? COVERAGE[docs.coverage.type] : 'ביטוח רכב', icon: 'shield', value: fixed.coverage, color: 'var(--c-ins2)', docKey: 'coverage' },
      { id: 'test', label: 'טסט ואגרת רישוי', icon: 'doc', value: fixed.test, color: 'var(--c-test)', docKey: 'test' },
      { id: 'other', label: 'חניה, אגרות ושאר', icon: 'coin', value: sumWin((r) => r.type === 'expense' && !r.excluded && !r.refund && !skipCats.has(r.cat)) - sumWin((r) => r.type === 'expense' && !r.excluded && r.refund), color: 'var(--c-other)' },
    ];
    const excludedMonthly = sumWin((r) => r.type === 'expense' && r.excluded);
    const tcoMissing = tcoParts.filter((p) => p.value == null);
    const tcoMonth = tcoParts.reduce((s, p) => s + (p.value || 0), 0);
    const tco = { parts: tcoParts, month: tcoMonth, year: tcoMonth * 12, missing: tcoMissing, window: win, perKm: dailyKm > 0 ? tcoMonth / (dailyKm * 30.4) : null, complete: tcoMissing.length === 0 && fills.length > 0, excludedMonthly };

    return {
      v, recs, fills: sorted, segs, open, avg, last, best, worst, sumKm, latest, estOdo, dailyKm, tco,
      level, basis, habit, learned, reserve, target, kmLeft, kmToTarget, daysToTarget, effK, lastFull, trips, tripWarn, pref,
      monthly, months, yearly, unknownCosts, fuelTotal, costPerKm, avgMonthFuel, stations, anomalies, measure,
      ev: isEV, cap, habitTo, homeShare, totalKwh,
    };
  }

  function monthSpan(a, b) {
    const [ya, ma] = a.split('-').map(Number), [yb, mb] = b.split('-').map(Number);
    return (yb - ya) * 12 + (mb - ma) + 1;
  }

  // The single authority on what an unsaved fill-up does (mirrors evaluateDraft()).
  function evaluateDraft(db, vid, draft) {
    const others = db.records.filter((r) => r.v === vid && r.type === 'fill' && r.id !== draft.id);
    const { segs, open } = segmentsOf([...others, draft]);
    const seg = segs.find((s) => s.id === draft.id) || null;
    return { seg, open };
  }

  // Hard block: an odometer that contradicts its chronological neighbours.
  function odoBounds(db, vid, dateIso, selfId) {
    const t = new Date(dateIso);
    const pts = db.records.filter((r) => r.v === vid && r.odo > 0 && r.id !== selfId && r.type !== 'service');
    let lo = null, hi = null;
    for (const p of pts) {
      const d = new Date(p.date);
      if (d <= t && (!lo || p.odo > lo.odo)) lo = p;
      if (d > t && (!hi || p.odo < hi.odo)) hi = p;
    }
    return { lo: lo ? lo.odo : null, hi: hi ? hi.odo : null };
  }

  function toCSV(db, vid) {
    const rows = [['type', 'date', 'odometer', 'liters', 'price_per_liter', 'total', 'full_tank', 'station', 'label', 'cost', 'refund', 'excluded_from_tco', 'garage', 'note']];
    for (const r of db.records.filter((x) => x.v === vid && x.type !== 'trip').sort(byDate)) {
      rows.push([r.type, r.date, r.odo ?? '', r.liters ?? r.kwh ?? '', r.price ?? r.pricePerKwh ?? '', r.total ?? '', r.full ?? '', r.station ? (r.type === 'charge' ? r.station : station(r.station).name) : '', r.label ?? '', r.cost ?? '', r.refund ? 'yes' : '', r.excluded ? 'yes' : '', r.garage ?? '', (r.note || '').replace(/"/g, '""')]);
    }
    return '﻿' + rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
  }

  window.TM = {
    TODAY, now, DAY, uid, clamp, MONTHS, MS, fmt, isoLocal, mkey, STATIONS, station, brandLetter, OFFICIAL, officialFor, PUBLISHED,
    SERVICE_KINDS, EXPENSE_KINDS, REMINDER_KINDS, EV_REMINDER_KINDS, CHARGE_PLACES, chargePlace, placeRate, evaluateCharge, ACCENTS, accentOf, kindIcon, INSURERS, COVERAGE, emptyDocs, lookupPlate, makeDemo, makeEmpty, compute, evaluateDraft, odoBounds, toCSV, segmentsOf, monthSpan,
    FUEL_TYPES, FUEL_KEY, fuelLabel, REASONS, REMINDER_BASIS, REMINDER_SOURCE, ISSUE_STATUS, SYMPTOMS, CATALOG, COMMUNITY, communityGroup,
  };
})();
