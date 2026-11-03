/* טנק מלא · prototype — bottom sheets */
(function () {
  'use strict';
  const { html, Icon, N, consStr, consUnit, consUnitShort, Sheet, Seg, Row, Ticks, LineChart, NumInput, Spinner, Badge, MiniPlate, useState, useEffect } = UI;
  const { fmt, station, now, isoLocal, uid, STATIONS, REMINDER_KINDS, OFFICIAL, officialFor, DAY } = TM;
  const { pct } = S1;

  function CarSwitch({ db, A }) {
    const list = db.vehicles.filter((v) => !v.archived);
    return html`<${Sheet} title="הרכבים שלי" onClose=${A.close}>
      <div className="group">${list.map((v) => html`<button key=${v.id} className="row" onClick=${() => { A.setActive(v.id); A.close(); A.toast(`עברת ל${v.nick}`); }}>
        <${MiniPlate} plate=${v.plate} /><span className="grow"><b>${v.nick}</b><small>${v.make} ${v.model} · ${v.year}</small></span>
        ${db.activeV === v.id && html`<${Icon} n="check" s=${22} />`}
      </button>`)}</div>
      <button className="btn line" onClick=${() => { A.close(); A.go('wizard', { add: true }); }}><${Icon} n="plus" />הוספת רכב</button>
      <button className="link" onClick=${() => { A.close(); A.go('vehicles'); }}>ניהול רכבים וארכיון</button>
    <//>`;
  }

  function Tank({ db, c, A }) {
    const [lvl, setLvl] = useState(c.level != null ? Math.round(c.level * 20) / 20 : null);
    const changed = lvl != null && (c.level == null || Math.abs(lvl - c.level) > 0.024);
    const dateTxt = (d) => (d == null ? '—' : d < 0.6 ? 'היום' : d < 1.6 ? 'מחר' : `בעוד ${Math.round(d)} ימים`);
    const reserveDays = c.level != null ? Math.max(0, (c.level - c.reserve) * c.v.tank * c.effK / c.dailyKm) : null;
    return html`<${Sheet} title="מה יש במיכל" onClose=${A.close}>
      <p className="muted small">${c.basis === 'obs' ? 'לפי המחוון שסימנת, פחות מה שנסעת מאז.' : c.basis === 'full' ? `לפי הטנק המלא ב${fmt.dayMon(new Date(c.lastFull.date))}, פחות כ-${fmt.int(c.estOdo - c.lastFull.odo)} ק״מ שנסעת מאז.` : 'עוד אין לנו נקודת התחלה.'} מסתכלים על המחוון ברכב? הקישו על המקום המתאים.</p>
      <div className="level">
        <${Ticks} level=${lvl} habit=${c.habit} onPick=${setLvl} />
        <div className="gk"><span>E</span><span>${lvl != null ? pct(lvl) : 'הקישו על המחוון'}</span><span>F</span></div>
      </div>
      ${c.level != null && html`<div className="group">
        <${Row} title="מתי תרצה לתדלק" sub=${c.habit != null ? `לפי ההרגל שלך: כשנשארים ${pct(c.habit)}` : 'עוד לומדים את ההרגלים שלך'} value=${dateTxt(c.daysToTarget)} />
        <${Row} title="מתי כדאי לתדלק לכל המאוחר" sub=${`לפני שיורדים מתחת ל-${pct(c.reserve)}, הרזרבה`} value=${dateTxt(reserveDays)} />
        <${Row} title="טווח משוער" value=${html`<span className="n">${fmt.int(c.kmLeft)}</span> ק״מ`} />
      </div>`}
      <p className="note">ההערכה משתמשת בצריכה שלך (${consStr(c.effK, db.settings.unit)} ${consUnitShort(db.settings.unit)}) ובכ-${fmt.int(c.dailyKm)} ק״מ שאתה נוסע ביום בממוצע.</p>
      <button className="btn" disabled=${!changed} onClick=${() => { A.addRecord({ id: uid(), v: c.v.id, type: 'tank', date: isoLocal(now()), level: lvl, odo: Math.round(c.estOdo || 0) }, 'עדכון מחוון'); A.close(); A.toast('המחוון עודכן. התחזית חושבה מחדש.'); }}>עדכון המחוון</button>
    <//>`;
  }

  function Segment({ db, c, A, p }) {
    const s = c.segs.find((x) => x.id === p.id);
    if (!s) return html`<${Sheet} title="מקטע" onClose=${A.close}><p>המקטע לא קיים יותר.</p><//>`;
    const unit = db.settings.unit;
    const d = c.avg ? s.kmpl / c.avg - 1 : 0;
    return html`<${Sheet} title=${fmt.dayMon(new Date(s.from.date)) + ' – ' + fmt.dayMon(s.date)} onClose=${A.close}>
      <div style=${{ display: 'flex', alignItems: 'flex-end', gap: 10 }}><span className="disp n" style=${{ fontSize: 96 }}>${consStr(s.kmpl, unit)}</span><span className="muted" style=${{ paddingBottom: 12, fontWeight: 600 }}>${consUnit(unit)}</span></div>
      ${c.avg && html`<span className=${'pill ' + (Math.abs(d) < 0.03 ? 'neutral' : d > 0 ? 'better' : 'worse')}>${Math.abs(d) < 0.03 ? 'כמו הממוצע שלך' : `${pct(Math.abs(d))} ${d > 0 ? 'טוב' : 'פחות טוב'} מהממוצע (${consStr(c.avg, unit)})`}</span>`}
      <div className="group">
        <${Row} title="מרחק" value=${html`<span className="n">${fmt.int(s.km)}</span> ק״מ`} />
        <${Row} title="דלק" sub=${s.partials ? `כולל ${s.partials} תדלוק חלקי באמצע` : null} value=${html`<span className="n">${fmt.dec(s.liters)}</span> ל׳`} />
        <${Row} title="עלות" value=${html`<span className="n">${fmt.money(s.cost)}</span> · <span className="n">${Math.round((s.cost / s.km) * 100)}</span> אג׳ לק״מ`} />
        <${Row} title="נסגר בתדלוק" sub=${station(s.to.station).name} value=${fmt.dayMon(s.date)} onClick=${() => A.sheet('entry', { id: s.to.id })} />
      </div>
      <p className="note">מקטע נמדד בין שני טנקים מלאים: הק״מ שנסעת, חלקי כל הליטרים שנכנסו אחרי הטנק הראשון.</p>
    <//>`;
  }

  function Price({ db, A }) {
    const keys = Object.keys(OFFICIAL).sort();
    const s = db.settings.discount;
    const off = officialFor(now());
    const after = s.type === 'agorot' ? off - s.value / 100 : s.type === 'percent' ? off * (1 - s.value / 100) : null;
    return html`<${Sheet} title="בנזין 95" onClose=${A.close}>
      <div style=${{ display: 'flex', alignItems: 'flex-end', gap: 10 }}><span className="disp n" style=${{ fontSize: 84 }}>${fmt.price(off)}</span><span className="muted" style=${{ paddingBottom: 10 }}>לליטר · ${TM.MONTHS[now().getMonth()]}</span></div>
      ${after != null && html`<span className="pill better">אחרי ההנחה שלך: ${fmt.price(after)}</span>`}
      <${LineChart} series=${keys.map((k) => OFFICIAL[k])} labels=${keys.map(fmt.monthShort)} formatY=${(v) => v.toFixed(2)} height=${120} />
      <p className="small muted">המחיר המרבי לשירות עצמי, כפי שמשרד האנרגיה מפרסם בתחילת כל חודש. זה רק לבנזין 95. בתחנות רבות המחיר נמוך יותר.</p>
      <button className="btn line sm" onClick=${() => A.sheet('discount')}><${Icon} n="tag" />${s.type === 'none' ? 'יש לך הנחה בתדלוק?' : 'עריכת ההנחה'}</button>
    <//>`;
  }

  function Discount({ db, A }) {
    const cur = db.settings.discount;
    const [type, setType] = useState(cur.type);
    const [val, setVal] = useState(cur.value ? String(cur.value) : '');
    const off = officialFor(now());
    const n = Number(val) || 0;
    const after = type === 'agorot' ? off - n / 100 : type === 'percent' ? off * (1 - n / 100) : off;
    return html`<${Sheet} title="הנחה בתדלוק" onClose=${A.close}>
      <p className="muted small">מועדון, אפליקציה או כרטיס אשראי. נוריד את ההנחה מהמחיר שמוצע בטופס.</p>
      <${Seg} value=${type} onChange=${setType} options=${[{ v: 'none', l: 'אין' }, { v: 'agorot', l: 'אגורות לליטר' }, { v: 'percent', l: 'אחוז' }]} />
      ${type !== 'none' && html`<div className="inp-wrap"><${NumInput} className="inp n" style=${{ fontSize: 26, fontWeight: 600 }} decimals=${1} placeholder=${type === 'agorot' ? '30' : '5'} value=${val} onChange=${setVal} autoFocus /><span className="unit">${type === 'agorot' ? 'אג׳ לליטר' : '%'}</span></div>
        <p className="small">המחיר שיוצע: <b className="n">${fmt.price(after)}</b> במקום <span className="n">${fmt.price(off)}</span></p>`}
      <button className="btn" onClick=${() => { A.setSetting('discount', { type, value: type === 'none' ? 0 : n }); A.close(); A.toast(type === 'none' ? 'ההנחה הוסרה' : 'ההנחה נשמרה'); }}>שמירה</button>
    <//>`;
  }

  function Entry({ db, c, A, p }) {
    const r = db.records.find((x) => x.id === p.id);
    if (!r) return null;
    const unit = db.settings.unit;
    const dt = new Date(r.date);
    const edit = () => { A.close(); A.go(r.type === 'fill' ? 'fill' : r.type === 'service' ? 'service' : 'expense', { id: r.id }); };
    const del = () => { A.close(); A.confirmDelete(r.id); };
    if (r.type === 'fill') {
      const seg = c.segs.find((s) => s.id === r.id);
      return html`<${Sheet} title=${station(r.station).name} onClose=${A.close}>
        <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <span className="disp n" style=${{ fontSize: 84 }}>${fmt.money(r.total)}</span>
          ${seg && html`<button className="chip" onClick=${() => A.sheet('segment', { id: seg.id })}><span className="n">${consStr(seg.kmpl, unit)}</span> ${consUnitShort(unit)}</button>`}
        </div>
        <div className="group">
          <${Row} title="מתי" value=${`${fmt.date(dt)}, ${fmt.time(dt)}`} />
          <${Row} title="ליטרים" value=${html`<span className="n">${fmt.dec(r.liters, 2)}</span> · ${r.full ? 'עד הסוף' : 'חלקי'}`} />
          <${Row} title="מחיר לליטר" sub=${r.pumpConfirmed ? 'אישרת שזה המחיר במשאבה' : r.pumpPrice ? `במשאבה: ${fmt.price(r.pumpPrice)}` : null} value=${html`<span className="n">${fmt.price(r.price)}</span>`} />
          <${Row} title="קילומטראז׳" value=${html`<span className="n">${fmt.int(r.odo)}</span> ק״מ`} />
          ${r.missedBefore && html`<${Row} title="אחרי תדלוקים שלא נרשמו" sub="מדידה חדשה התחילה כאן" />`}
          ${r.reason && html`<${Row} title="סיבה" value=${r.reason} />`}
          ${r.note && html`<${Row} title="הערה" sub=${r.note} />`}
        </div>
        <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <button className="btn line sm" onClick=${edit}><${Icon} n="edit" />עריכה</button>
          <button className="btn danger sm" onClick=${del}><${Icon} n="trash" />מחיקה</button>
        </div>
      <//>`;
    }
    if (r.type === 'service' || r.type === 'expense') return html`<${Sheet} title=${r.label} onClose=${A.close}>
      <span className="disp n" style=${{ fontSize: 84 }}>${fmt.money(r.cost)}</span>
      <div className="group">
        <${Row} title="סוג" value=${r.type === 'service' ? 'טיפול' : 'הוצאה'} />
        <${Row} title="מתי" value=${fmt.date(dt)} />
        ${r.odo && html`<${Row} title="קילומטראז׳" value=${html`<span className="n">${fmt.int(r.odo)}</span> ק״מ`} />`}
        ${r.note && html`<${Row} title="הערה" sub=${r.note} />`}
      </div>
      <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <button className="btn line sm" onClick=${edit}><${Icon} n="edit" />עריכה</button>
        <button className="btn danger sm" onClick=${del}><${Icon} n="trash" />מחיקה</button>
      </div>
    <//>`;
    return html`<${Sheet} title=${r.type === 'odo' ? 'עדכון קילומטראז׳' : 'סימון מחוון'} onClose=${A.close}>
      <span className="disp n" style=${{ fontSize: 76 }}>${r.type === 'odo' ? fmt.int(r.odo) : pct(r.level)}</span>
      <p className="muted">${fmt.date(dt)}, ${fmt.time(dt)}</p>
      <button className="btn danger sm" onClick=${del}><${Icon} n="trash" />מחיקה</button>
    <//>`;
  }

  function AddMenu({ A }) {
    const item = (icon, t, sub, fn) => html`<button className="row" onClick=${() => { A.close(); fn(); }}><span className="ri"><${Icon} n=${icon} /></span><span className="grow"><b>${t}</b><small>${sub}</small></span><${Icon} n="chev" /></button>`;
    return html`<${Sheet} title="מה להוסיף?" onClose=${A.close}>
      <div className="group">
        ${item('pump', 'תדלוק', 'סכום, ליטרים, ק״מ', () => A.go('fill'))}
        ${item('wrench', 'טיפול', 'מוסך, צמיגים, תיקון', () => A.go('service'))}
        ${item('coin', 'הוצאה', 'ביטוח, טסט, חניה, אגרה', () => A.go('expense'))}
        ${item('gauge', 'עדכון ק״מ', 'משפר את תחזית התדלוק', () => A.sheet('odo'))}
      </div>
    <//>`;
  }

  function Odo({ db, c, A }) {
    const [val, setVal] = useState('');
    const n = Number(val);
    const last = c.latest ? c.latest.odo : null;
    const err = val && last != null && n < last ? `הקילומטראז׳ האחרון היה ${fmt.int(last)}. אפשר רק מספר גבוה יותר.` : null;
    const warn = val && last != null && !err && n - last > 3000 ? `${fmt.int(n - last)} ק״מ מאז הפעם הקודמת. נכון?` : null;
    const save = () => { if (!val || err) return; A.addRecord({ id: uid(), v: c.v.id, type: 'odo', date: isoLocal(now()), odo: n }, 'עדכון ק״מ'); A.close(); A.toast('הקילומטראז׳ עודכן'); };
    return html`<${Sheet} title="כמה ק״מ ברכב?" onClose=${A.close}>
      <div className="pump"><div className="prow"><label htmlFor="o-odo">קילומטראז׳</label><div className="pv"><${NumInput} id="o-odo" decimals=${0} placeholder=${last ? String(Math.round(c.estOdo)) : '0'} value=${val} onChange=${setVal} autoFocus /><span className="u">ק״מ</span></div>
        ${err ? html`<span className="s err">${err}</span>` : last != null ? html`<span className="s">${val ? `+${fmt.int(Math.max(0, n - last))} מהרישום הקודם` : `אחרון: ${fmt.int(last)} · ${fmt.rel(c.latest.date)}`}</span>` : null}</div></div>
      ${warn && html`<div className="warnbox"><${Icon} n="alert" />${warn}</div>`}
      <p className="note">עדכון ק״מ בין תדלוקים עוזר לנו לדעת כמה דלק נשאר ומתי לתדלק.</p>
      <button className="btn" disabled=${!val || !!err} onClick=${save}>שמירה</button>
    <//>`;
  }

  function StationPick({ A, p }) {
    const [q, setQ] = useState('');
    const list = STATIONS.filter((s) => !q || s.name.includes(q)).sort((a, b) => a.dist - b.dist);
    return html`<${Sheet} title="איפה תדלקת?" onClose=${A.close}>
      <div className="inp-wrap"><input className="inp" style=${{ paddingRight: 42 }} placeholder="חיפוש תחנה" value=${q} onChange=${(e) => setQ(e.target.value)} aria-label="חיפוש תחנה" /><span style=${{ position: 'absolute', right: 14, top: 16, color: 'var(--tx2)' }}><${Icon} n="search" s=${20} /></span></div>
      <div className="group">${list.map((s) => html`<button key=${s.id} className="row" onClick=${() => { p.onPick(s.id); A.close(); }}>
        <${Badge} st=${s.id} /><span className="grow"><b>${s.name}</b><small><span className="n">${fmt.dec(s.dist)}</span> ק״מ ממך</small></span>
        ${p.value === s.id && html`<${Icon} n="check" s=${22} />`}
      </button>`)}</div>
      <p className="note">המיקום נבדק רק במכשיר, מול רשימת התחנות הרשמית. הוא לא נשלח לשום שרת.</p>
    <//>`;
  }

  function Scan({ c, A, p }) {
    const [step, setStep] = useState(1);
    const [busy, setBusy] = useState(false);
    const [got, setGot] = useState({});
    const lastOdo = c.fills.length ? Math.max(...c.fills.map((f) => f.odo)) : Math.round(c.estOdo || 170000);
    const est = Math.max(Math.round(lastOdo + 31.55 * (c.avg || 12)), c.latest ? c.latest.odo + 5 : 0);
    const shoot = () => {
      setBusy(true);
      setTimeout(() => {
        setBusy(false);
        if (step === 1) { setGot({ total: '231.90', liters: '31.55' }); setStep(2); }
        else { setGot((g) => ({ ...g, odo: String(est) })); setStep(3); }
      }, 1100);
    };
    return html`<${Sheet} title="צילום המשאבה" onClose=${A.close}>
      <div className="steps">${[1, 2].map((j) => html`<i key=${j} className=${j <= Math.min(step, 2) ? 'on' : ''}></i>`)}</div>
      ${step < 3 ? html`
        <div className="viewfinder">
          <span className="corner c1"></span><span className="corner c2"></span><span className="corner c3"></span><span className="corner c4"></span>
          ${busy && html`<span className="scanline"></span>`}
          ${step === 1 ? html`<div className="lcd"><small>SALE ₪</small>231.90<small>LITERS</small>31.55</div>` : html`<div className="lcd" style=${{ background: '#111', color: '#F3EFE4' }}><small>ODO km</small>${String(est).padStart(6, '0')}</div>`}
        </div>
        <p style=${{ fontWeight: 600 }}>${step === 1 ? 'כוונו לצג של המשאבה, ונקרא סכום וליטרים' : `זיהינו ${fmt.money(231.9)} ו-31.55 ל׳. עכשיו לוח הקילומטרים`}</p>
        <button className="btn" disabled=${busy} onClick=${shoot}>${busy ? html`<${Spinner} />` : html`<${Icon} n="cam" />`}${busy ? 'קוראים…' : 'צילום'}</button>
        ${step === 2 && html`<button className="link" onClick=${() => { p.onResult({ ...got, odo: '' }); A.close(); }}>דילוג, אקליד את הק״מ</button>`}
        <p className="note">התמונות לא נשמרות. רק המספרים עוברים לטופס, ותוכלו לבדוק אותם לפני שמירה.</p>`
      : html`
        <div className="group">
          <${Row} title="סכום" value=${html`<span className="n">${fmt.money(Number(got.total))}</span>`} />
          <${Row} title="ליטרים" value=${html`<span className="n">${got.liters}</span>`} />
          <${Row} title="קילומטראז׳" value=${html`<span className="n">${fmt.int(Number(got.odo))}</span>`} />
        </div>
        <button className="btn" onClick=${() => { p.onResult(got); A.close(); }}>העברה לטופס</button>
        <button className="link" onClick=${() => { setStep(1); setGot({}); }}>צילום מחדש</button>`}
    <//>`;
  }

  function Reminder({ db, c, A, p }) {
    const existing = p.id ? db.reminders.find((r) => r.id === p.id) : null;
    const kind = REMINDER_KINDS.find((k) => k.id === (existing ? existing.kind : p.kind)) || REMINDER_KINDS[0];
    const defDate = new Date(now().getTime() + kind.days * DAY || 0);
    const [by, setBy] = useState(existing ? (existing.dueDate ? 'date' : 'km') : kind.by);
    const [date, setDate] = useState(existing && existing.dueDate ? existing.dueDate : isoLocal(isNaN(defDate) ? now() : new Date(now().getTime() + (kind.days || 180) * DAY)).slice(0, 10));
    const [km, setKm] = useState(existing && existing.dueKm ? String(existing.dueKm) : String(Math.round(((c.estOdo || 0) + (kind.km || 10000)) / 100) * 100));
    const save = () => {
      const r = { id: existing ? existing.id : uid(), v: c.v.id, kind: kind.id, label: kind.label, dueDate: by === 'date' ? date : null, dueKm: by === 'km' ? Number(km) : null };
      A.saveReminder(r); A.close(); A.toast(`נזכיר לך: ${kind.label}`);
    };
    return html`<${Sheet} title=${kind.label} onClose=${A.close}>
      <${Seg} value=${by} onChange=${setBy} options=${[{ v: 'date', l: 'לפי תאריך' }, { v: 'km', l: 'לפי ק״מ' }]} />
      ${by === 'date' ? html`<div className="field"><label htmlFor="r-date">עד מתי</label><input id="r-date" className="inp n" type="date" value=${date} onChange=${(e) => setDate(e.target.value)} /></div>`
        : html`<div className="field"><label htmlFor="r-km">באיזה ק״מ</label><div className="inp-wrap"><${NumInput} id="r-km" className="inp n" decimals=${0} value=${km} onChange=${setKm} /><span className="unit">ק״מ</span></div><span className="note">הרכב עכשיו על בערך ${fmt.int(c.estOdo || 0)}</span></div>`}
      <p className="note">נזכיר שבועיים לפני, או 500 ק״מ לפני.</p>
      <button className="btn" onClick=${save}>${existing ? 'שמירה' : 'הוספת תזכורת'}</button>
      ${existing && html`<button className="btn danger sm" onClick=${() => { A.deleteReminder(existing.id); A.close(); A.toast('התזכורת נמחקה'); }}><${Icon} n="trash" />מחיקה</button>`}
    <//>`;
  }

  function Issue({ db, c, A, p }) {
    const existing = p.id ? db.issues.find((i) => i.id === p.id) : null;
    const [t, setT] = useState(existing ? existing.title : '');
    return html`<${Sheet} title=${existing ? 'מה קורה ברכב' : 'משהו השתנה ברכב?'} onClose=${A.close}>
      <div className="field"><label htmlFor="is-t">מה שמת לב?</label><input id="is-t" className="inp" placeholder="למשל: נורת שמן נדלקה" value=${t} onChange=${(e) => setT(e.target.value)} autoFocus /></div>
      ${!existing && html`<div className="chips">${['רעש מוזר', 'נורה בלוח', 'רעידות', 'ריח'].map((x) => html`<button key=${x} className="chip" onClick=${() => setT(x)}>${x}</button>`)}</div>`}
      <button className="btn" disabled=${!t.trim()} onClick=${() => { A.saveIssue({ ...(existing || { id: uid(), v: c.v.id, date: isoLocal(now()), open: true }), title: t.trim() }); A.close(); A.toast(existing ? 'עודכן' : 'נעקוב אחרי זה'); }}>${existing ? 'שמירה' : 'הוספה'}</button>
      ${existing && html`<button className="btn line sm" onClick=${() => { A.saveIssue({ ...existing, open: false }); A.close(); A.toast('סומן כמתוקן'); }}><${Icon} n="check" />תוקן</button>`}
    <//>`;
  }


  function Doc({ db, c, A, p }) {
    const v = c.v;
    const docs = v.docs || TM.emptyDocs();
    const cur = docs[p.key] || {};
    const [f, setF] = useState({ type: cur.type || 'comprehensive', insurer: cur.insurer || '', due: cur.due || '', cost: cur.cost ? String(cur.cost) : '' });
    const set = (k, x) => setF((s) => ({ ...s, [k]: x }));
    const isIns = p.key !== 'test';
    const none = p.key === 'coverage' && f.type === 'none';
    const title = p.key === 'test' ? 'טסט שנתי' : p.key === 'mandatory' ? 'ביטוח חובה' : 'ביטוח רכב';
    const canSave = none || !!f.due;
    const save = () => {
      const obj = p.key === 'test' ? { due: f.due } : p.key === 'mandatory' ? { insurer: f.insurer.trim(), due: f.due, cost: f.cost ? Number(f.cost) : null } : { type: f.type, insurer: none ? '' : f.insurer.trim(), due: none ? null : f.due, cost: !none && f.cost ? Number(f.cost) : null };
      A.updateDocs(v.id, p.key, obj); A.close();
      A.toast(none ? 'נשמר: אין ביטוח רכב' : `נזכיר לך חודש לפני ${fmt.date(new Date(f.due))}`);
    };
    return html`<${Sheet} title=${title} onClose=${A.close}>
      ${p.key === 'mandatory' && html`<p className="muted small">חובה לכל רכב. מכסה נזקי גוף בלבד, ומתחדש בדרך כלל יחד עם הרישיון.</p>`}
      ${p.key === 'coverage' && html`<${Seg} value=${f.type} onChange=${(x) => set('type', x)} options=${[{ v: 'comprehensive', l: 'מקיף' }, { v: 'third', l: 'צד ג׳' }, { v: 'none', l: 'אין' }]} />
        <p className="muted small">${f.type === 'comprehensive' ? 'מכסה גם את הרכב שלך: תאונה, גניבה, נזקי טבע.' : f.type === 'third' ? 'מכסה נזק שגרמת לרכוש של אחרים, לא את הרכב שלך.' : 'אפשר להוסיף בכל רגע.'}</p>`}
      ${isIns && !none && html`<div className="field"><label htmlFor="d-ins">חברת ביטוח</label><input id="d-ins" className="inp" list="insurers" placeholder="למשל: הראל" value=${f.insurer} onChange=${(e) => set('insurer', e.target.value)} />
        <div className="scrollx" style=${{ marginTop: 4 }}>${TM.INSURERS.map((n) => html`<button key=${n} className=${'chip' + (f.insurer === n ? ' on' : '')} onClick=${() => set('insurer', n)}>${n}</button>`)}</div></div>`}
      ${!none && html`<div className="field"><label htmlFor="d-due">${isIns ? 'בתוקף עד' : 'מועד הטסט הבא'}</label><input id="d-due" className="inp n" type="date" value=${f.due} onChange=${(e) => set('due', e.target.value)} /></div>`}
      ${isIns && !none && html`<div className="field"><label htmlFor="d-cost">כמה עולה בשנה <span className="muted" style=${{ fontWeight: 400 }}>(לא חובה)</span></label><div className="inp-wrap"><${NumInput} id="d-cost" className="inp n" decimals=${0} value=${f.cost} onChange=${(x) => set('cost', x)} placeholder="0" /><span className="unit">₪</span></div></div>`}
      <p className="note">נזכיר חודש לפני, ושוב שבוע לפני.</p>
      <button className="btn" disabled=${!canSave} onClick=${save}>שמירה</button>
    <//>`;
  }

  function Accent({ db, A }) {
    const cur = db.settings.accent || 'plate';
    return html`<${Sheet} title="צבע הדגשה" onClose=${A.close}>
      <p className="muted small">הצבע של הכפתורים, המחוון וההדגשות. לוחית הרישוי נשארת צהובה תמיד.</p>
      <div className="swatches">${TM.ACCENTS.map((a) => html`<button key=${a.id} className=${'swatch' + (cur === a.id ? ' on' : '')} aria-pressed=${cur === a.id} onClick=${() => { A.setSetting('accent', a.id); }}>
        <i style=${{ background: a.light }}>${cur === a.id ? html`<${Icon} n="check" s=${22} />` : ''}</i><span>${a.label}</span>
      </button>`)}</div>
      <button className="btn" onClick=${A.close}>סיום</button>
    <//>`;
  }

  function Confirm({ A, p }) {
    return html`<${Sheet} title=${p.title} onClose=${A.close}>
      <p className="muted">${p.body}</p>
      <button className=${'btn ' + (p.danger ? 'danger' : 'ink')} onClick=${() => { A.close(); p.onConfirm(); }}>${p.confirm}</button>
      <button className="btn line sm" onClick=${A.close}>ביטול</button>
    <//>`;
  }

  function Choice({ A, p }) {
    return html`<${Sheet} title=${p.title} onClose=${A.close}>
      <div className="group" role="radiogroup">${p.options.map((o) => html`<button key=${String(o.v)} role="radio" aria-checked=${p.value === o.v} className="row" onClick=${() => { p.onPick(o.v); A.close(); }}>
        <span className="grow"><b>${o.l}</b></span>${p.value === o.v && html`<${Icon} n="check" s=${22} />`}</button>`)}</div>
    <//>`;
  }

  window.SHEETS = { accent: Accent, doc: Doc, carSwitch: CarSwitch, tank: Tank, segment: Segment, price: Price, discount: Discount, entry: Entry, addMenu: AddMenu, odo: Odo, station: StationPick, scan: Scan, reminder: Reminder, issue: Issue, confirm: Confirm, choice: Choice };
})();
