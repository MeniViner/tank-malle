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
    money: (v) => (v < 0 ? '−' : '') + '₪' + Math.round(Math.abs(v)).toLocaleString('en-US'),
    price: (v) => '₪' + Number(v).toFixed(2),
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
    { id: 'plate', label: 'צהוב לוחית', light: '#FFC915', dark: '#E6B417' },
    { id: 'mint', label: 'מנטה', light: '#4FD1A5', dark: '#46BD95' },
    { id: 'sky', label: 'תכלת', light: '#78C2F3', dark: '#6FB2DF' },
    { id: 'peach', label: 'אפרסק', light: '#FF9F6E', dark: '#E8906A' },
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
  const PLATE_DB = {
    '7248078': { make: 'יונדאי', model: 'i20 Inspire', year: 2012, fuel: '95', tank: 45, mfr: 16.4 },
    '31284901': { make: 'קיה', model: 'פיקנטו', year: 2019, fuel: '95', tank: 35, mfr: 19.6 },
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
      ],
      records: [
        F('2026-06-13T08:10', 167930, 31.0, 7.55, 'pz-rm'),
        F('2026-07-22T17:40', 168310, 29.7, 7.64, 'sn-gd'),
        F('2026-08-25T07:55', 168680, 30.6, 7.89, 'pz-bk'),
        F('2026-09-08T13:20', 168860, 12.0, 7.82, 'pz-sl', false),
        F('2026-09-25T19:20', 169040, 17.8, 7.90, 'pz-sh'),
        F('2026-10-03T12:05', 169420, 27.9, 7.46, 'pz-sl'),
        F('2026-10-12T09:30', 169775, 24.1, 7.58, 'dl-ms'),
        F('2026-10-22T18:45', 170081, 30.6, 7.58, 'dl-ms', true, { pumpConfirmed: true }),
        F('2026-10-29T08:14', 170344, 28.2, 7.52, 'dl-km', true, { pumpConfirmed: true }),
        { id: uid(), v: 'v1', type: 'odo', date: '2026-11-01T20:00', odo: 170510 },
        { id: uid(), v: 'v1', type: 'service', date: '2026-07-02T10:00', kind: 'periodic', label: 'טיפול תקופתי', cost: 650, odo: 168100, note: 'מוסך יוסי, קרית מלאכי' },
        { id: uid(), v: 'v1', type: 'service', date: '2026-10-20T11:00', kind: 'tires', label: 'צמיגים', cost: 400, odo: 170050, note: '2 צמיגים קדמיים' },
        { id: uid(), v: 'v1', type: 'expense', date: '2026-09-14T09:00', cat: 'toll', label: 'כביש אגרה', cost: 23, note: 'כביש 6' },
        { id: uid(), v: 'v1', type: 'expense', date: '2026-10-05T16:00', cat: 'wash', label: 'שטיפה', cost: 40, note: '' },
      ],
      reminders: [{ id: uid(), v: 'v1', kind: 'periodic', label: 'טיפול תקופתי', dueDate: null, dueKm: 178100 }],
      issues: [{ id: uid(), v: 'v1', title: 'רעש קל בבלמים מאחור', date: '2026-10-28T10:00', open: true }],
      notifications: [
        { id: uid(), title: 'מחיר בנזין 95 ירד', body: 'בנובמבר: ₪7.35 לליטר, 23 אג׳ פחות מאוקטובר.', date: '2026-11-01T08:00', read: false, archived: false },
        { id: uid(), title: 'תדלוק בקרוב', body: 'לפי ההרגלים שלך, כנראה תתדלק בשבוע הקרוב.', date: '2026-10-31T19:00', read: true, archived: false },
      ],
      settings: { theme: 'system', unit: 'kml', accent: 'plate', discount: { type: 'none', value: 0 }, quickScan: false, notif: { service: true, price: true, sync: true }, community: true, offline: false },
      dismissed: [],
      writes: [],
    };
  }

  function makeEmpty() {
    return {
      user: { name: 'מני וינר', email: 'meniviner@gmail.com', admin: true },
      auth: { signedIn: false, onboarded: false },
      feedback: [], adminPrices: { '95': { value: 7.35, source: 'auto', at: '2026-11-01T06:00' }, '98': { value: 8.02, source: 'manual', at: '2026-11-01T09:12' }, diesel: { value: 7.08, source: 'manual', at: '2026-11-01T09:13' }, other: { value: null, source: 'manual', at: '2026-10-01T09:00' } },
      activeV: null, vehicles: [], records: [], reminders: [], issues: [], notifications: [],
      settings: { theme: 'system', unit: 'kml', accent: 'plate', discount: { type: 'none', value: 0 }, quickScan: false, notif: { service: true, price: true, sync: true }, community: true, offline: false },
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

  function compute(db, vid) {
    const v = db.vehicles.find((x) => x.id === vid);
    if (!v) return null;
    const recs = db.records.filter((r) => r.v === vid);
    const fills = recs.filter((r) => r.type === 'fill');
    const { segs, open, sorted } = segmentsOf(fills);
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
    const effK = avg || (v.mfr ? v.mfr * 0.8 : null);
    const lastFull = [...sorted].reverse().find((f) => f.full) || null;
    const obs = recs.filter((r) => r.type === 'tank').sort(byDate).pop() || null;
    let level = null, basis = null, baseDate = null;
    if (effK && latest) {
      let base = null, baseOdo = null;
      if (obs && (!lastFull || new Date(obs.date) > new Date(lastFull.date))) { base = obs.level; baseOdo = obs.odo; basis = 'obs'; baseDate = new Date(obs.date); }
      else if (lastFull) { base = 1; baseOdo = lastFull.odo; basis = 'full'; baseDate = new Date(lastFull.date); }
      if (base !== null) {
        const partialL = fills.filter((f) => !f.full && new Date(f.date) > baseDate).reduce((s, f) => s + f.liters, 0);
        const used = Math.max(0, estOdo - baseOdo) / effK;
        level = clamp((base * v.tank - used + partialL) / v.tank, 0, 1);
      }
    }
    // learned habit: level before each fill that follows a full tank
    const samples = [];
    for (let i = 1; i < sorted.length; i++) if (sorted[i - 1].full && sorted[i].full) samples.push(clamp(1 - sorted[i].liters / v.tank, 0, 1));
    const habit = samples.length >= 3 ? clamp(samples.reduce((s, x) => s + x, 0) / samples.length, 0.12, 0.7) : null;
    const reserve = 0.15;
    const target = Math.max(habit ?? 0.25, reserve);
    const kmLeft = level !== null ? level * v.tank * effK : null;
    const kmToTarget = level !== null ? Math.max(0, (level - target) * v.tank * effK) : null;
    const daysToTarget = kmToTarget !== null ? kmToTarget / dailyKm : null;

    // money
    const monthly = {};
    const add = (dt, k, val) => { const key = mkey(dt); monthly[key] = monthly[key] || { fuel: 0, service: 0, expense: 0, liters: 0, fills: 0 }; monthly[key][k] += val; };
    for (const r of recs) {
      const dt = new Date(r.date);
      if (r.type === 'fill') { add(dt, 'fuel', r.total); add(dt, 'liters', r.liters); add(dt, 'fills', 1); }
      if (r.type === 'service') add(dt, 'service', r.cost);
      if (r.type === 'expense') add(dt, 'expense', r.cost);
    }
    const fuelTotal = fills.reduce((s, f) => s + f.total, 0);
    const segCost = segs.reduce((s, x) => s + x.cost, 0);
    const costPerKm = sumKm ? segCost / sumKm : null;
    const months = Object.keys(monthly).sort();
    const fuelMonths = months.filter((k) => monthly[k].fills > 0);
    const avgMonthFuel = fuelMonths.length ? fuelMonths.reduce((s, k) => s + monthly[k].fuel, 0) / Math.max(1, monthSpan(fuelMonths[0], mkey(nowD))) : null;

    // stations
    const st = {};
    for (const f of fills) {
      const s = (st[f.station] = st[f.station] || { id: f.station, count: 0, liters: 0, spent: 0, last: null });
      s.count++; s.liters += f.liters; s.spent += f.total; if (!s.last || new Date(f.date) > new Date(s.last.date)) s.last = f;
    }
    const stations = Object.values(st).map((s) => ({ ...s, avgPrice: s.spent / s.liters, info: station(s.id) })).sort((a, b) => a.avgPrice - b.avgPrice);

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
    const sumWin = (pred) => inWin.filter(pred).reduce((s, r) => s + (r.type === 'fill' ? r.total : r.cost || 0), 0) / win;
    const tcoParts = [
      { id: 'fuel', label: 'דלק', icon: 'pump', value: sumWin((r) => r.type === 'fill'), color: 'var(--plate)' },
      { id: 'service', label: 'טיפולים ותיקונים', icon: 'wrench', value: sumWin((r) => r.type === 'service'), color: 'var(--tx)' },
      { id: 'mandatory', label: 'ביטוח חובה', icon: 'shield', value: fixed.mandatory, color: 'var(--tx2)', docKey: 'mandatory' },
      { id: 'coverage', label: docs.coverage && docs.coverage.type ? COVERAGE[docs.coverage.type] : 'ביטוח רכב', icon: 'shield', value: fixed.coverage, color: 'var(--tx3)', docKey: 'coverage' },
      { id: 'test', label: 'טסט ואגרת רישוי', icon: 'doc', value: fixed.test, color: 'var(--better)', docKey: 'test' },
      { id: 'other', label: 'חניה, אגרות ושאר', icon: 'coin', value: sumWin((r) => r.type === 'expense' && !skipCats.has(r.cat)), color: 'var(--sf2)' },
    ];
    const tcoMissing = tcoParts.filter((p) => p.value == null);
    const tcoMonth = tcoParts.reduce((s, p) => s + (p.value || 0), 0);
    const tco = { parts: tcoParts, month: tcoMonth, year: tcoMonth * 12, missing: tcoMissing, window: win, perKm: dailyKm > 0 ? tcoMonth / (dailyKm * 30.4) : null, complete: tcoMissing.length === 0 && fills.length > 0 };

    return {
      v, recs, fills: sorted, segs, open, avg, last, best, worst, sumKm, latest, estOdo, dailyKm, tco,
      level, basis, habit, reserve, target, kmLeft, kmToTarget, daysToTarget, effK, lastFull,
      monthly, months, fuelTotal, costPerKm, avgMonthFuel, stations,
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
    const rows = [['type', 'date', 'odometer', 'liters', 'price_per_liter', 'total', 'full_tank', 'station', 'label', 'cost', 'note']];
    for (const r of db.records.filter((x) => x.v === vid).sort(byDate)) {
      rows.push([r.type, r.date, r.odo ?? '', r.liters ?? '', r.price ?? '', r.total ?? '', r.full ?? '', r.station ? station(r.station).name : '', r.label ?? '', r.cost ?? '', (r.note || '').replace(/"/g, '""')]);
    }
    return '﻿' + rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
  }

  window.TM = {
    TODAY, now, DAY, uid, clamp, MONTHS, MS, fmt, isoLocal, mkey, STATIONS, station, brandLetter, OFFICIAL, officialFor, PUBLISHED,
    SERVICE_KINDS, EXPENSE_KINDS, REMINDER_KINDS, ACCENTS, accentOf, kindIcon, INSURERS, COVERAGE, emptyDocs, lookupPlate, makeDemo, makeEmpty, compute, evaluateDraft, odoBounds, toCSV, segmentsOf, monthSpan,
  };
})();
