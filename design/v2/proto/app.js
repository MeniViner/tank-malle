/* טנק מלא · prototype — app shell, navigation, actions */
(function () {
  'use strict';
  const { useState, useEffect, useMemo, useRef, useCallback } = React;
  const { html, Icon, Toast } = UI;
  const { uid, now, compute } = TM;

  const SCREENS = {
    home: S1.Home, journal: S1.Journal, insights: S1.Insights, vehicle: S2.Vehicle,
    fill: S1.FillForm, saved: S1.Saved, service: S2.ServiceForm, expense: S2.ExpenseForm,
    vehicleEdit: S2.VehicleEdit, vehicles: S2.Vehicles, account: S2.Account, notifications: S2.Notifications,
    feedback: S2.Feedback, import: S2.Import, unsynced: S2.Unsynced, legal: S2.Legal,
    onboard: S2.Onboard, signin: S2.SignIn, wizard: S2.Wizard, admin: S3.Admin,
  };
  const TABS = ['home', 'journal', 'insights', 'vehicle'];
  const NEEDS_CAR = new Set(['home', 'journal', 'insights', 'vehicle', 'fill', 'saved', 'service', 'expense', 'vehicleEdit', 'account', 'import']);

  function TabBar({ cur, A }) {
    const t = (s, icon, label) => html`<button className=${'tab' + (cur === s ? ' on' : '')} aria-current=${cur === s ? 'page' : undefined} onClick=${() => A.tab(s)}><span className="ico"><${Icon} n=${icon} /></span>${label}</button>`;
    return html`<nav className="tabs" aria-label="ניווט ראשי">
      ${t('home', 't-home', 'בית')}${t('journal', 't-journal', 'יומן')}
      <button className="fab" onClick=${A.fab} aria-label="רישום תדלוק"><${Icon} n="t-pump" />תדלקתי</button>
      ${t('insights', 't-insights', 'תובנות')}${t('vehicle', 't-car', 'רכב')}
    </nav>`;
  }

  function MapPanel({ cur, A, db }) {
    const b = (label, fn, on) => html`<button className=${on ? 'on' : ''} onClick=${fn}>${label}</button>`;
    const lastFill = db.records.filter((r) => r.type === 'fill' && r.v === db.activeV).sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    const dark = db.settings.theme === 'dark';
    return html`<aside className="map" aria-label="מפת מסכים">
      <h1>טנק <em>מלא</em></h1>
      <p>פרוטוטייפ לחיץ. הכל עובד: תדלוק חדש מעדכן את הבית, היומן והתובנות. הנתונים נשמרים רק בלשונית הזו.</p>
      <div className="map-row">
        <button className=${!dark ? 'on' : ''} onClick=${() => A.setSetting('theme', 'light')}>בהיר</button>
        <button className=${dark ? 'on' : ''} onClick=${() => A.setSetting('theme', 'dark')}>כהה</button>
      </div>
      <div className="map-g"><b>ראשי</b>
        ${b('בית', () => A.tab('home'), cur === 'home')}
        ${b('צבע הדגשה', () => A.sheet('accent'))}
        ${b('יומן', () => A.tab('journal'), cur === 'journal')}
        ${b('תובנות', () => A.tab('insights'), cur === 'insights')}
        ${b('רכב', () => A.tab('vehicle'), cur === 'vehicle')}
      </div>
      <div className="map-g"><b>רישום</b>
        ${b('תדלוק חדש', () => A.go('fill'), cur === 'fill')}
        ${b('תדלוק עם צילום', () => A.go('fill', { scan: true }))}
        ${lastFill && b('המסך שאחרי שמירה', () => A.go('saved', { id: lastFill.id }), cur === 'saved')}
        ${b('טיפול', () => A.go('service'), cur === 'service')}
        ${b('הוצאה', () => A.go('expense'), cur === 'expense')}
        ${b('עדכון ק״מ', () => A.sheet('odo'))}
        ${b('מחוון דלק ותחזית', () => A.sheet('tank'))}
      </div>
      <div className="map-g"><b>חשבון ונתונים</b>
        ${b('חשבון והגדרות', () => A.go('account'), cur === 'account')}
        ${b('התראות', () => A.go('notifications'), cur === 'notifications')}
        ${b('הרכבים שלי', () => A.go('vehicles'), cur === 'vehicles')}
        ${b('פרטי רכב', () => A.go('vehicleEdit'), cur === 'vehicleEdit')}
        ${b('ייבוא', () => A.go('import'), cur === 'import')}
        ${b('משוב', () => A.go('feedback'), cur === 'feedback')}
        ${b('לוח בקרה (מנהל)', () => A.go('admin'), cur === 'admin')}
      </div>
      <div className="map-g"><b>משתמש חדש</b>
        ${b('אונבורדינג', () => A.reset([{ s: 'onboard' }]), cur === 'onboard')}
        ${b('התחברות', () => A.reset([{ s: 'signin' }]), cur === 'signin')}
        ${b('הוספת רכב (לוחית)', () => A.go('wizard', { add: true }), cur === 'wizard')}
        ${b('להתחיל מאפס כמשתמש חדש', A.newUser)}
        ${b('חזרה לנתוני הדגמה', A.demo)}
      </div>
    </aside>`;
  }

  // Quiet atmosphere behind every screen: a faint gauge dial off one corner, a soft accent glow, a top wash.
  const BG_OF = { home: ['home', 'start'], journal: ['journal', 'end'], insights: ['insights', 'start'], vehicle: ['vehicle', 'end'], vehicleEdit: ['vehicle', 'end'], vehicles: ['vehicle', 'end'], account: ['account', 'start'], notifications: ['account', 'start'], feedback: ['account', 'start'], import: ['account', 'start'], unsynced: ['account', 'start'], legal: ['neutral', 'end'], admin: ['account', 'start'], fill: ['fill', 'end'], service: ['fill', 'end'], expense: ['fill', 'end'], onboard: ['home', 'start'], signin: ['home', 'start'], wizard: ['vehicle', 'end'], saved: ['none'] };
  const TICKS = Array.from({ length: 72 }, (_, i) => { const a = (i * 5 * Math.PI) / 180; const long = i % 3 === 0; const r1 = long ? 168 : 176, r2 = 186; return [210 + r1 * Math.cos(a), 210 + r1 * Math.sin(a), 210 + r2 * Math.cos(a), 210 + r2 * Math.sin(a)]; });
  function Bgfx({ screen }) {
    const [k, side] = BG_OF[screen] || ['neutral', 'end'];
    if (k === 'none') return null;
    return html`<div className=${`bgfx bg-${k} bg-${side}`} aria-hidden="true">
      <span className="wash"></span>
      <span className="glow"></span>
      <svg className="dial" viewBox="0 0 420 420" fill="none" stroke="currentColor" strokeWidth="1">
        <circle cx="210" cy="210" r="96"/><circle cx="210" cy="210" r="140"/><circle cx="210" cy="210" r="196"/>
        ${TICKS.map((t, i) => html`<line key=${i} x1=${t[0].toFixed(1)} y1=${t[1].toFixed(1)} x2=${t[2].toFixed(1)} y2=${t[3].toFixed(1)} strokeWidth=${i % 3 === 0 ? 1.5 : 1} />`)}
      </svg>
    </div>`;
  }

  function useDark(theme) {
    const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
    const [sys, setSys] = useState(mq ? mq.matches : false);
    useEffect(() => { if (!mq) return; const h = (e) => setSys(e.matches); mq.addEventListener ? mq.addEventListener('change', h) : mq.addListener(h); return () => (mq.removeEventListener ? mq.removeEventListener('change', h) : mq.removeListener(h)); }, []);
    return theme === 'dark' || (theme === 'system' && sys);
  }

  function App() {
    const [db, setDb] = useState(() => TM.makeDemo());
    const [nav, setNav] = useState({ stack: [{ s: 'home', p: {} }], dir: 'f', n: 0 });
    const [sheet, setSheet] = useState(null);
    const [toast, setToast] = useState(null);
    const dbRef = useRef(db); dbRef.current = db;
    const lastImport = useRef([]);
    const c = useMemo(() => (db.activeV ? compute(db, db.activeV) : null), [db]);
    const dark = useDark(db.settings.theme);
    const accent = TM.accentOf(db.settings.accent);

    const A = useMemo(() => {
      const push = (s, p = {}) => { setSheet(null); setNav((n) => ({ stack: [...n.stack, { s, p }], dir: 'f', n: n.n + 1 })); };
      const write = (label) => {
        const id = uid();
        setDb((d) => ({ ...d, writes: [...d.writes, { id, label, at: now().toISOString(), state: 'pending' }] }));
        setTimeout(() => setDb((d) => (d.settings.offline ? d : { ...d, writes: d.writes.map((w) => (w.id === id ? { ...w, state: 'synced' } : w)) })), 1400);
      };
      const A = {
        go: push,
        back: () => setNav((n) => (n.stack.length > 1 ? { stack: n.stack.slice(0, -1), dir: 'b', n: n.n + 1 } : n)),
        replace: (s, p = {}) => setNav((n) => ({ stack: [...n.stack.slice(0, -1), { s, p }], dir: 'f', n: n.n + 1 })),
        reset: (stack) => { setSheet(null); setNav((n) => ({ stack: stack.map((x) => ({ p: {}, ...x })), dir: 'f', n: n.n + 1 })); },
        tab: (s, p = {}) => { setSheet(null); setNav((n) => ({ stack: [{ s, p }], dir: 'f', n: n.n + 1 })); },
        fab: () => push('fill', dbRef.current.settings.quickScan ? { scan: true } : {}),
        sheet: (k, p = {}) => setSheet({ k, p, n: Math.random() }),
        close: () => setSheet(null),
        toast: (msg, undo, ms) => setToast({ msg, undo, ms, id: Math.random() }),
        upsert: (rec, label) => {
          setDb((d) => ({ ...d, records: d.records.some((r) => r.id === rec.id) ? d.records.map((r) => (r.id === rec.id ? rec : r)) : [...d.records, rec] }));
          write(label);
        },
        addRecord: (rec, label) => A.upsert(rec, label),
        bulkAdd: (recs, label) => { lastImport.current = recs.map((r) => r.id); setDb((d) => ({ ...d, records: [...d.records, ...recs] })); write(label); },
        undoImport: () => { const ids = new Set(lastImport.current); setDb((d) => ({ ...d, records: d.records.filter((r) => !ids.has(r.id)) })); },
        patch: (id, obj) => { setDb((d) => ({ ...d, records: d.records.map((r) => (r.id === id ? { ...r, ...obj } : r)) })); write('עדכון רשומה'); },
        removeRecord: (id, silent) => {
          const rec = dbRef.current.records.find((r) => r.id === id);
          setDb((d) => ({ ...d, records: d.records.filter((r) => r.id !== id) }));
          write('מחיקה');
          if (!silent && rec) A.toast('הרשומה נמחקה', () => setDb((d) => ({ ...d, records: [...d.records, rec] })));
        },
        confirmDelete: (id, fromForm) => {
          const r = dbRef.current.records.find((x) => x.id === id);
          const what = r && r.type === 'fill' ? 'התדלוק' : r && r.type === 'service' ? 'הטיפול' : r && r.type === 'expense' ? 'ההוצאה' : 'הרשומה';
          A.sheet('confirm', { title: `למחוק את ${what}?`, body: r && r.type === 'fill' ? 'הצריכה והממוצעים יחושבו מחדש בלי התדלוק הזה. אפשר לבטל מיד אחרי.' : 'אפשר לבטל מיד אחרי.', confirm: 'מחיקה', danger: true, onConfirm: () => { if (fromForm) A.back(); A.removeRecord(id); } });
        },
        setSetting: (k, v) => setDb((d) => ({ ...d, settings: { ...d.settings, [k]: v } })),
        dismiss: (id) => setDb((d) => ({ ...d, dismissed: [...(d.dismissed || []), id] })),
        setOffline: (on) => {
          setDb((d) => ({ ...d, settings: { ...d.settings, offline: on } }));
          if (!on) setTimeout(() => setDb((d) => ({ ...d, writes: d.writes.map((w) => (w.state === 'pending' ? { ...w, state: 'synced' } : w)) })), 1200);
          A.toast(on ? 'מצב לא מקוון: שמירות יחכו במכשיר' : 'הקליטה חזרה. מעלים את השינויים…');
        },
        setActive: (id) => setDb((d) => ({ ...d, activeV: id })),
        updateVehicle: (id, obj) => { setDb((d) => ({ ...d, vehicles: d.vehicles.map((v) => (v.id === id ? { ...v, ...obj } : v)) })); write('פרטי רכב'); },
        archiveVehicle: (id, arch) => {
          setDb((d) => {
            const vehicles = d.vehicles.map((v) => (v.id === id ? { ...v, archived: arch } : v));
            const activeV = arch && d.activeV === id ? (vehicles.find((v) => !v.archived) || {}).id || null : d.activeV;
            return { ...d, vehicles, activeV };
          });
          A.toast(arch ? 'הרכב הועבר לארכיון' : 'הרכב חזר לרשימה');
        },
        updateDocs: (vid, key, obj) => { setDb((d) => ({ ...d, vehicles: d.vehicles.map((v) => (v.id === vid ? { ...v, docs: { ...(v.docs || TM.emptyDocs()), [key]: obj } } : v)) })); write('רישוי וביטוח'); },
        addVehicle: (v) => {
          v = { docs: TM.emptyDocs(), ...v };
          setDb((d) => ({ ...d, vehicles: [...d.vehicles, v], activeV: v.id, auth: { signedIn: true, onboarded: true } }));
          write('רכב חדש');
          A.reset([{ s: 'home' }]);
          A.toast(`${v.nick} נוסף. אפשר לרשום תדלוק ראשון.`);
        },
        saveReminder: (r) => setDb((d) => ({ ...d, reminders: d.reminders.some((x) => x.id === r.id) ? d.reminders.map((x) => (x.id === r.id ? r : x)) : [...d.reminders, r] })),
        deleteReminder: (id) => setDb((d) => ({ ...d, reminders: d.reminders.filter((x) => x.id !== id) })),
        saveIssue: (i) => setDb((d) => ({ ...d, issues: d.issues.some((x) => x.id === i.id) ? d.issues.map((x) => (x.id === i.id ? i : x)) : [...d.issues, i] })),
        markAllRead: () => setDb((d) => ({ ...d, notifications: d.notifications.map((n) => ({ ...n, read: true })) })),
        archiveNotification: (id) => setDb((d) => ({ ...d, notifications: d.notifications.map((n) => (n.id === id ? { ...n, archived: true } : n)) })),
        signIn: () => {
          const d = dbRef.current;
          setDb((x) => ({ ...x, auth: { signedIn: true, onboarded: true } }));
          A.reset([{ s: d.vehicles.some((v) => !v.archived) ? 'home' : 'wizard' }]);
        },
        signOut: () => { setDb((d) => ({ ...d, auth: { ...d.auth, signedIn: false } })); A.reset([{ s: 'signin' }]); },
        newUser: () => { setDb(TM.makeEmpty()); A.reset([{ s: 'onboard' }]); },
        addFeedback: (kind, text) => { const d = dbRef.current; setDb((x) => ({ ...x, feedback: [...x.feedback, { id: uid(), kind, text, from: d.user.name, date: TM.isoLocal(now()), handled: false, device: navigator.userAgent.includes('iPhone') ? 'iPhone · Safari' : 'דפדפן' }] })); write('משוב'); },
        setFeedbackHandled: (id, h) => setDb((d) => ({ ...d, feedback: d.feedback.map((f) => (f.id === id ? { ...f, handled: h } : f)) })),
        setAdminPrice: (k, v, source) => { if (k === '95' && v != null) TM.OFFICIAL[TM.mkey(now())] = v; setDb((d) => ({ ...d, adminPrices: { ...d.adminPrices, [k]: { value: v, source, at: TM.isoLocal(now()) } } })); write('מחיר דלק'); },
        demo: () => { TM.OFFICIAL['2026-11'] = 7.35; setDb(TM.makeDemo()); A.reset([{ s: 'home' }]); A.toast('נתוני ההדגמה נטענו מחדש'); },
      };
      return A;
    }, []);

    useEffect(() => { window.__TM_A = A; }, [A]);

    let cur = nav.stack[nav.stack.length - 1];
    // guards: no car → wizard / sign-in
    if (NEEDS_CAR.has(cur.s) && !c) cur = db.auth.signedIn ? { s: 'wizard', p: {} } : { s: db.auth.onboarded ? 'signin' : 'onboard', p: {} };
    const Screen = SCREENS[cur.s] || SCREENS.home;
    const SheetC = sheet ? SHEETS[sheet.k] : null;
    const showTabs = TABS.includes(cur.s);

    return html`<div className="stage">
      <${MapPanel} cur=${cur.s} A=${A} db=${db} />
      <div className=${'ph' + (dark ? ' dark' : '')} style=${{ '--plate': dark ? accent.dark : accent.light }}>
        <${Bgfx} screen=${cur.s} />
        <div className=${'screen' + (nav.dir === 'b' ? ' back' : '')} key=${nav.n}>
          <${Screen} db=${db} c=${c} A=${A} p=${cur.p || {}} />
        </div>
        ${showTabs && html`<${TabBar} cur=${cur.s} A=${A} />`}
        ${SheetC && (c || ['confirm', 'choice'].includes(sheet.k)) && html`<${SheetC} key=${sheet.n} db=${db} c=${c} A=${A} p=${sheet.p} />`}
        <${Toast} t=${toast} low=${!showTabs || !!sheet} onClose=${() => setToast(null)} />
      </div>
    </div>`;
  }

  ReactDOM.createRoot(document.getElementById('root')).render(html`<${App} />`);
})();
