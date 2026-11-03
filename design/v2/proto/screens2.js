/* טנק מלא · prototype — vehicle, service/expense, account and entry flows */
(function () {
  'use strict';
  const { html, Icon, N, consStr, consUnitShort, Top, Toggle, Seg, Row, PlateXL, NumInput, Check, Spinner, useState, useEffect, useRef } = UI;
  const { fmt, now, isoLocal, mkey, uid, DAY, SERVICE_KINDS, EXPENSE_KINDS, REMINDER_KINDS, lookupPlate } = TM;
  const { syncState, SYNC_LABEL, pct } = S1;

  /* ================= VEHICLE ================= */
  function reminderDue(r, c) {
    if (r.dueDate) { const days = Math.round((new Date(r.dueDate) - now()) / DAY); return { n: days, unit: 'ימים', soon: days < 30, text: days < 0 ? 'עבר' : null }; }
    if (r.dueKm && c.estOdo) { const km = Math.round(r.dueKm - c.estOdo); return { n: km, unit: 'ק״מ', soon: km < 1000, text: km < 0 ? 'עבר' : null }; }
    return { n: null };
  }

  function docRows(v) {
    const d = v.docs || TM.emptyDocs();
    const days = (iso) => (iso ? Math.round((new Date(iso) - now()) / DAY) : null);
    const until = (iso) => (iso ? `בתוקף עד ${fmt.date(new Date(iso))}` : null);
    const cov = d.coverage || {};
    return [
      { key: 'test', icon: 'doc', title: 'טסט שנתי', sub: until(d.test && d.test.due) || 'מתי הטסט הבא?', days: days(d.test && d.test.due), cta: 'תאריך' },
      { key: 'mandatory', icon: 'shield', title: 'ביטוח חובה', sub: d.mandatory && d.mandatory.due ? [d.mandatory.insurer, until(d.mandatory.due)].filter(Boolean).join(' · ') : 'חברה ותאריך חידוש', days: days(d.mandatory && d.mandatory.due), cta: 'הוספה' },
      { key: 'coverage', icon: 'shield', title: cov.type ? TM.COVERAGE[cov.type] : 'ביטוח מקיף או צד ג׳', sub: cov.type === 'none' ? 'סימנת שאין' : cov.due ? [cov.insurer, until(cov.due)].filter(Boolean).join(' · ') : 'סוג, חברה ותאריך חידוש', days: cov.type === 'none' ? null : days(cov.due), cta: cov.type === 'none' ? 'שינוי' : 'הוספה' },
    ];
  }

  function Vehicle({ db, c, A }) {
    const v = c.v;
    const odo = c.latest ? c.latest.odo : null;
    const digits = odo != null ? String(Math.round(odo)).padStart(6, '0').split('') : ['–', '–', '–', '–', '–', '–'];
    const rems = db.reminders.filter((r) => r.v === v.id);
    const sugg = REMINDER_KINDS.filter((k) => !rems.some((r) => r.kind === k.id));
    const issues = db.issues.filter((i) => i.v === v.id && i.open);
    const y = String(now().getFullYear());
    const yr = Object.entries(c.monthly).filter(([k]) => k.startsWith(y)).reduce((s, [, m]) => ({ fuel: s.fuel + m.fuel, service: s.service + m.service, expense: s.expense + m.expense }), { fuel: 0, service: 0, expense: 0 });
    return html`<div className="pad" style=${{ gap: 20 }}>
      <div className="top"><span className="lbl">${v.nick}</span>
        <button className="chip" onClick=${() => A.go('vehicles')}>${db.vehicles.filter((x) => !x.archived).length > 1 ? 'החלפת רכב' : 'ניהול רכבים'}</button></div>
      <${PlateXL} value=${v.plate} />
      <div><div className="disp" style=${{ fontSize: 52 }}>${v.make} ${v.model}</div><div className="muted" style=${{ fontSize: 14.5, marginTop: 6 }}>${v.year} · בנזין ${v.fuel} · מיכל ${v.tank} ל׳</div></div>
      <div style=${{ display: 'grid', gap: 8 }}>
        <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span className="lbl">קילומטראז׳${c.latest ? ' · ' + fmt.rel(c.latest.date) : ''}</span><button className="chip" onClick=${() => A.sheet('odo')}>עדכון</button></div>
        <button className="odo" style=${{ border: 0, background: 'none', padding: 0 }} onClick=${() => A.sheet('odo')} aria-label=${odo != null ? fmt.int(odo) + ' ק״מ' : 'אין קילומטראז׳'}>${digits.map((d, i) => html`<i key=${i}>${d}</i>`)}</button>
      </div>

      <section>
        <h2 className="group-h">רישוי וביטוח</h2>
        ${docRows(v).map((d) => html`<button key=${d.key} className="rem" onClick=${() => A.sheet('doc', { key: d.key })}>
          <span style=${{ width: 36, height: 36, borderRadius: 10, border: '1.5px solid var(--tx)', display: 'grid', placeItems: 'center' }}><${Icon} n=${d.icon} s=${18} /></span>
          <span style=${{ display: 'grid' }}><b style=${{ fontWeight: 600 }}>${d.title}</b><small className="muted">${d.sub}</small></span>
          ${d.days == null ? html`<span className="chip dash" style=${{ minHeight: 32 }}><${Icon} n="plus" />${d.cta}</span>`
            : html`<span className=${'due' + (d.days < 30 ? ' soon' : '')}>${d.days < 0 ? 'פג' : html`<span className="n">${fmt.int(d.days)}</span>`}<small>${d.days < 0 ? 'תוקף' : 'ימים'}</small></span>`}
        </button>`)}
      </section>

      <section>
        <h2 className="group-h">תזכורות</h2>
        ${rems.map((r) => { const d = reminderDue(r, c); return html`<button key=${r.id} className="rem" onClick=${() => A.sheet('reminder', { id: r.id })}>
          <span className="ri" style=${{ width: 36, height: 36, borderRadius: 10, border: '1.5px solid var(--tx)', display: 'grid', placeItems: 'center' }}><${Icon} n="calendar" s=${18} /></span>
          <span style=${{ display: 'grid' }}><b style=${{ fontWeight: 600 }}>${r.label}</b><small className="muted">${r.dueDate ? fmt.date(new Date(r.dueDate)) : `ב-${fmt.int(r.dueKm)} ק״מ`}</small></span>
          <span className=${'due' + (d.soon ? ' soon' : '')}>${d.text || html`<span className="n">${fmt.int(d.n)}</span>`}<small>${d.text ? '' : d.unit}</small></span>
        </button>`; })}
        ${sugg.length > 0 && html`<div style=${{ display: 'grid', gap: 10, marginTop: 12 }}>
          <span className="lbl">${rems.length ? 'עוד משהו שכדאי שנזכיר?' : 'מה כדאי שנזכיר לך?'}</span>
          <div className="chips">${sugg.map((k) => html`<button key=${k.id} className="chip dash" onClick=${() => A.sheet('reminder', { kind: k.id })}><${Icon} n="plus" />${k.label}</button>`)}</div>
        </div>`}
      </section>

      <section>
        <h2 className="group-h">מה קורה ברכב</h2>
        ${issues.map((i) => html`<${Row} key=${i.id} icon="alert" title=${i.title} sub=${'נפתח ' + fmt.rel(new Date(i.date))} onClick=${() => A.sheet('issue', { id: i.id })} />`)}
        <${Row} icon="plus" title="משהו השתנה ברכב?" sub="רעש, נורה, תקלה. נעקוב עד שזה מתוקן" onClick=${() => A.sheet('issue')} />
      </section>

      <section className="group">
        <${Row} title=${y + ' עד עכשיו'} value=${html`<span className="n">${fmt.money(yr.fuel + yr.service + yr.expense)}</span>`} onClick=${() => A.tab('insights', { tab: 'spend' })} />
        <${Row} title="טיפולים" sub=${`${c.recs.filter((r) => r.type === 'service').length} רשומות`} onClick=${() => A.tab('journal', { filter: 'service' })} />
        <${Row} title="פרטי הרכב" sub="דגם, סוג דלק, נפח מיכל, נתון יצרן" onClick=${() => A.go('vehicleEdit')} />
      </section>
    </div>`;
  }

  function VehicleEdit({ db, c, A }) {
    const v = c.v;
    const [f, setF] = useState({ ...v, tank: String(v.tank), mfr: String(v.mfr || ''), year: String(v.year) });
    const [busy, setBusy] = useState(false);
    const set = (k, x) => setF((s) => ({ ...s, [k]: x }));
    const refresh = () => { setBusy(true); setTimeout(() => { setBusy(false); const r = lookupPlate(v.plate); setF((s) => ({ ...s, make: r.make, model: r.model, year: String(r.year) })); A.toast('הפרטים עודכנו ממאגר משרד התחבורה'); }, 900); };
    const save = () => { A.updateVehicle(v.id, { nick: f.nick, make: f.make, model: f.model, year: Number(f.year) || v.year, fuel: f.fuel, tank: Number(f.tank) || v.tank, mfr: Number(f.mfr) || null }); A.back(); A.toast('פרטי הרכב נשמרו'); };
    return html`<div className="pad noTabs" style=${{ gap: 16 }}>
      <${Top} onBack=${A.back} title="פרטי הרכב" />
      <${PlateXL} value=${v.plate} style=${{ height: 64 }} />
      <button className="btn line sm" onClick=${refresh} disabled=${busy}>${busy ? html`<${Spinner} />` : html`<${Icon} n="cloud" />`}עדכון ממשרד התחבורה</button>
      <div className="field"><label htmlFor="ve-nick">כינוי</label><input id="ve-nick" className="inp" value=${f.nick} onChange=${(e) => set('nick', e.target.value)} /></div>
      <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="field"><label htmlFor="ve-make">יצרן</label><input id="ve-make" className="inp" value=${f.make} onChange=${(e) => set('make', e.target.value)} /></div>
        <div className="field"><label htmlFor="ve-model">דגם</label><input id="ve-model" className="inp" value=${f.model} onChange=${(e) => set('model', e.target.value)} /></div>
      </div>
      <div className="field"><label htmlFor="ve-year">שנת ייצור</label><${NumInput} id="ve-year" className="inp n" decimals=${0} value=${f.year} onChange=${(x) => set('year', x)} /></div>
      <div className="field"><span className="lbl">סוג דלק</span><${Seg} value=${f.fuel} onChange=${(x) => set('fuel', x)} options=${[{ v: '95', l: '95' }, { v: '98', l: '98' }, { v: 'סולר', l: 'סולר' }, { v: 'אחר', l: 'אחר' }]} /></div>
      ${f.fuel !== '95' && html`<div className="warnbox"><${Icon} n="alert" />רק לבנזין 95 יש מחיר מרבי בפיקוח. ל${f.fuel === 'סולר' ? 'סולר' : 'דלק הזה'} נציע את המחיר ששילמתם בפעם הקודמת.</div>`}
      <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="field"><label htmlFor="ve-tank">נפח מיכל</label><div className="inp-wrap"><${NumInput} id="ve-tank" className="inp n" decimals=${0} value=${f.tank} onChange=${(x) => set('tank', x)} /><span className="unit">ל׳ · הערכה</span></div></div>
        <div className="field"><label htmlFor="ve-mfr">נתון יצרן</label><div className="inp-wrap"><${NumInput} id="ve-mfr" className="inp n" decimals=${1} value=${f.mfr} onChange=${(x) => set('mfr', x)} /><span className="unit">ק״מ/ל׳</span></div></div>
      </div>
      <p className="note">נפח המיכל לא מתפרסם בשום מאגר, אז הוא מוערך לפי סוג הרכב. אם אתם יודעים את המספר המדויק, תקנו אותו.</p>
      <div className="bottomBar"><button className="btn" onClick=${save}>שמירה</button></div>
    </div>`;
  }

  function Vehicles({ db, A }) {
    const active = db.vehicles.filter((v) => !v.archived), arch = db.vehicles.filter((v) => v.archived);
    return html`<div className="pad noTabs" style=${{ gap: 18 }}>
      <${Top} onBack=${A.back} title="הרכבים שלי" />
      <section className="group">
        ${active.map((v) => html`<div key=${v.id} className="row">
          <button className="grow" style=${{ border: 0, background: 'none', textAlign: 'right', padding: 0 }} onClick=${() => { A.setActive(v.id); A.tab('home'); }}>
            <b>${v.nick}</b><small>${v.make} ${v.model} · ${v.year} · <span className="n">${fmt.plate(v.plate)}</span></small></button>
          ${db.activeV === v.id ? html`<span className="pill neutral">פעיל</span>` : html`<button className="chip" onClick=${() => A.setActive(v.id)}>בחירה</button>`}
          ${active.length > 1 && html`<button className="ib ghost" aria-label=${'העברה לארכיון: ' + v.nick} onClick=${() => A.sheet('confirm', { title: 'להעביר לארכיון?', body: `${v.nick} ייעלם מהמסכים, וכל הרשומות שלו יישמרו. אפשר להחזיר בכל רגע.`, confirm: 'העברה לארכיון', onConfirm: () => A.archiveVehicle(v.id, true) })}><${Icon} n="archive" s=${20} /></button>`}
        </div>`)}
      </section>
      <button className="btn line" onClick=${() => A.go('wizard', { add: true })}><${Icon} n="plus" />הוספת רכב</button>
      ${arch.length > 0 && html`<section><h2 className="group-h">בארכיון</h2><div className="group">
        ${arch.map((v) => html`<${Row} key=${v.id} title=${v.nick} sub=${`${v.make} ${v.model} · ${v.year}`} chevron=${false} onClick=${() => A.archiveVehicle(v.id, false)} value="החזרה" />`)}
      </div></section>`}
    </div>`;
  }

  /* ================= SERVICE / EXPENSE ================= */
  function CostForm({ db, c, A, p, kind }) {
    const isService = kind === 'service';
    const KINDS = isService ? SERVICE_KINDS : EXPENSE_KINDS;
    const editing = p.id ? db.records.find((r) => r.id === p.id) : null;
    const [step, setStep] = useState(editing ? 2 : 1);
    const [f, setF] = useState(editing ? { k: editing.kind || editing.cat, label: editing.label, cost: String(editing.cost), date: editing.date, odo: editing.odo ? String(editing.odo) : '', note: editing.note || '' }
      : { k: null, label: '', cost: '', date: isoLocal(now()), odo: c.latest ? String(Math.round(c.estOdo)) : '', note: '' });
    const [tried, setTried] = useState(false);
    const set = (k, x) => setF((s) => ({ ...s, [k]: x }));
    const pick = (k) => { const def = KINDS.find((x) => x.id === k); setF((s) => ({ ...s, k, label: k === 'other' ? '' : def.label })); setStep(2); };
    const odoN = f.odo ? Number(f.odo) : null;
    const odoWarn = isService && odoN && c.latest && Math.abs(odoN - c.estOdo) > 3000 ? `הרכב על בערך ${fmt.int(c.estOdo)} ק״מ. ${fmt.int(odoN)} רחוק מזה, כדאי לבדוק.` : null;
    const save = () => {
      setTried(true);
      if (!(Number(f.cost) >= 0) || f.cost === '' || !f.label.trim()) return;
      const rec = { ...(editing || {}), id: editing ? editing.id : uid(), v: c.v.id, type: kind, date: f.date, label: f.label.trim(), cost: Number(f.cost), note: f.note };
      if (isService) { rec.kind = f.k; rec.odo = odoN || null; } else rec.cat = f.k;
      A.upsert(rec, isService ? 'טיפול' : 'הוצאה');
      A.back();
      A.toast(isService ? `${rec.label} נשמר ביומן` : `ההוצאה נשמרה: ${fmt.money(rec.cost)}`);
    };
    return html`<div className="pad noTabs" style=${{ gap: 18 }}>
      <div className="top">
        <button className="ib" aria-label=${step === 2 && !editing ? 'חזרה לבחירה' : 'סגירה'} onClick=${step === 2 && !editing ? () => setStep(1) : A.back}><${Icon} n=${step === 2 && !editing ? 'back' : 'x'} /></button>
        <span className="lbl">${editing ? '' : `${step} / 2`}</span><span style=${{ width: 44 }}></span>
      </div>
      ${step === 1 ? html`
        <h1 className="h1" style=${{ fontSize: 54 }}>${isService ? 'מה עשו ברכב?' : 'על מה ההוצאה?'}</h1>
        <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          ${KINDS.map((k) => html`<button key=${k.id} className="btn line" style=${{ justifyContent: 'flex-start', padding: '0 16px', minHeight: 64 }} onClick=${() => pick(k.id)}><${Icon} n=${k.icon} />${k.label}</button>`)}
        </div>
        <p className="note">${isService ? 'כמה עבודות בביקור אחד? בחרו את העיקרית ופרטו בהערה.' : 'גם הוצאות שהחזירו לכם נכנסות לכאן, עם הערה.'}</p>`
      : html`
        <h1 className="h1" style=${{ fontSize: 54 }}>${editing ? (isService ? 'עריכת טיפול' : 'עריכת הוצאה') : f.label || (isService ? 'טיפול' : 'הוצאה')}</h1>
        ${(f.k === 'other' || editing) && html`<div className="field"><label htmlFor="cf-label">שם</label><input id="cf-label" className="inp" value=${f.label} placeholder=${isService ? 'למשל: החלפת מגבים' : 'למשל: רישיון רכב'} onChange=${(e) => set('label', e.target.value)} />${tried && !f.label.trim() && html`<span className="err">חסר שם</span>`}</div>`}
        <div className="field"><label htmlFor="cf-cost">כמה עלה</label><div className="inp-wrap"><${NumInput} id="cf-cost" className="inp n" style=${{ fontSize: 26, fontWeight: 600 }} placeholder="0" value=${f.cost} onChange=${(x) => set('cost', x)} autoFocus /><span className="unit">₪</span></div>${tried && f.cost === '' && html`<span className="err">חסר סכום (אפשר 0 אם לא שילמתם)</span>`}</div>
        <div className="field"><label htmlFor="cf-date">מתי</label><input id="cf-date" className="inp n" type="date" value=${f.date.slice(0, 10)} onChange=${(e) => set('date', e.target.value + f.date.slice(10))} /></div>
        ${isService && html`<div className="field"><label htmlFor="cf-odo">קילומטראז׳ בזמן הטיפול</label><div className="inp-wrap"><${NumInput} id="cf-odo" className="inp n" decimals=${0} value=${f.odo} onChange=${(x) => set('odo', x)} /><span className="unit">ק״מ</span></div>${odoWarn && html`<div className="warnbox"><${Icon} n="alert" />${odoWarn}</div>`}</div>`}
        <div className="field"><label htmlFor="cf-note">הערה</label><textarea id="cf-note" className="inp" value=${f.note} placeholder=${isService ? 'מוסך, מה הוחלף' : ''} onChange=${(e) => set('note', e.target.value)}></textarea></div>
        ${editing && html`<button className="btn danger sm" onClick=${() => A.confirmDelete(editing.id, true)}><${Icon} n="trash" />מחיקה</button>`}
        <div className="bottomBar"><button className="btn" onClick=${save}>שמירה</button></div>`}
    </div>`;
  }
  const ServiceForm = (props) => html`<${CostForm} ...${props} kind="service" />`;
  const ExpenseForm = (props) => html`<${CostForm} ...${props} kind="expense" />`;

  /* ================= ACCOUNT (profile + settings + data in one place) ================= */
  function Account({ db, c, A }) {
    const s = db.settings;
    const sync = syncState(db);
    const pending = db.writes.filter((w) => w.state !== 'synced').length;
    const themeL = { system: 'לפי המכשיר', light: 'בהיר', dark: 'כהה' }[s.theme];
    const unitL = s.unit === 'kml' ? 'ק״מ לליטר' : 'ליטר ל-100 ק״מ';
    const discL = s.discount.type === 'none' ? 'אין' : s.discount.type === 'agorot' ? `${s.discount.value} אג׳ לליטר` : `${s.discount.value}%`;
    const exportCsv = () => {
      try {
        const blob = new Blob([TM.toCSV(db, c.v.id)], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `tank-maleh-${c.v.nick}-${mkey(now())}.csv`; document.body.appendChild(a); a.click(); a.remove();
        A.toast('קובץ CSV ירד למכשיר');
      } catch (e) { A.toast('ההורדה לא זמינה כאן. באפליקציה האמיתית הקובץ יורד מיד.'); }
    };
    const backup = () => {
      try {
        const blob = new Blob([JSON.stringify({ version: 2, exportedAt: now().toISOString(), vehicles: db.vehicles, records: db.records }, null, 2)], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `tank-maleh-backup-${mkey(now())}.json`; document.body.appendChild(a); a.click(); a.remove();
        A.toast('עותק מלא של הנתונים ירד למכשיר');
      } catch (e) { A.toast('ההורדה לא זמינה כאן.'); }
    };
    return html`<div className="pad noTabs" style=${{ gap: 22 }}>
      <${Top} onBack=${A.back} title="חשבון" />
      <div style=${{ display: 'flex', gap: 14, alignItems: 'center' }}>
        <span className="avatar" style=${{ width: 64, height: 64, fontSize: 26 }}>${db.user.name[0]}</span>
        <div style=${{ display: 'grid', gap: 2 }}><b style=${{ font: '700 34px/1 var(--display)' }}>${db.user.name}</b><span className="muted small">${db.user.email}</span>${db.user.admin && html`<span className="pill neutral" style=${{ marginTop: 4 }}><${Icon} n="shield" s=${14} />מנהל מערכת</span>`}</div>
      </div>

      <section><h2 className="group-h">דלק ומחיר</h2><div className="group">
        <${Row} icon="tag" title="הנחה בתדלוק" value=${discL} onClick=${() => A.sheet('discount')} />
        <${Row} icon="coin" title="מחיר בנזין 95" value=${fmt.price(TM.officialFor(now()))} onClick=${() => A.sheet('price')} />
      </div></section>

      <section><h2 className="group-h">תצוגה</h2><div className="group">
        <${Row} icon="tag" title="צבע" value=${TM.accentOf(s.accent).label} onClick=${() => A.sheet('accent')}>
          <span style=${{ width: 22, height: 22, borderRadius: '50%', background: 'var(--plate)', border: '1.5px solid #111', flex: 'none' }}></span>
        <//>
        <${Row} icon="moon" title="מראה" value=${themeL} onClick=${() => A.sheet('choice', { title: 'מראה', value: s.theme, options: [{ v: 'system', l: 'לפי המכשיר' }, { v: 'light', l: 'בהיר' }, { v: 'dark', l: 'כהה' }], onPick: (x) => A.setSetting('theme', x) })} />
        <${Row} icon="gauge" title="יחידת צריכה" value=${unitL} onClick=${() => A.sheet('choice', { title: 'יחידת צריכה', value: s.unit, options: [{ v: 'kml', l: 'ק״מ לליטר' }, { v: 'l100', l: 'ליטר ל-100 ק״מ' }], onPick: (x) => A.setSetting('unit', x) })} />
        <${Row} icon="cam" title="כפתור תדלקתי פותח מצלמה" sub="צילום המשאבה ולוח הקילומטרים במקום הקלדה"><${Toggle} on=${s.quickScan} label="כפתור תדלקתי פותח מצלמה" onChange=${(x) => A.setSetting('quickScan', x)} /><//>
      </div></section>

      <section><h2 className="group-h">התראות</h2><div className="group">
        <${Row} icon="bell" title="כל ההתראות" onClick=${() => A.go('notifications')} />
        <${Row} title="טסט, ביטוח וטיפולים" sub="חודש לפני, ושוב שבוע לפני"><${Toggle} on=${s.notif.service} label="תזכורות טיפול" onChange=${(x) => A.setSetting('notif', { ...s.notif, service: x })} /><//>
        <${Row} title="שינוי במחיר הדלק"><${Toggle} on=${s.notif.price} label="שינוי מחיר" onChange=${(x) => A.setSetting('notif', { ...s.notif, price: x })} /><//>
      </div></section>

      <section><h2 className="group-h">השוואה לנהגים</h2><div className="group">
        <${Row} icon="users" title="שיתוף סיכום אנונימי" sub="דגם, שנה וצריכה ממוצעת בלבד. כיבוי מוחק אותו מיד"><${Toggle} on=${s.community} label="שיתוף השוואה" onChange=${(x) => { A.setSetting('community', x); A.toast(x ? 'ההשוואה הופעלה' : 'הסיכום שלך נמחק מההשוואה'); }} /><//>
      </div></section>

      <section><h2 className="group-h">הנתונים שלי</h2><div className="group">
        <${Row} icon="download" title="ייצוא ל-Excel" sub=${'כל הרשומות של ' + c.v.nick + ' כקובץ CSV'} onClick=${exportCsv} chevron=${false} />
        <${Row} icon="cloud" title="גיבוי" sub="עותק של כל הנתונים, לשחזור במכשיר אחר" onClick=${backup} chevron=${false} />
        <${Row} icon="upload" title="ייבוא מקובץ" sub="מאפליקציה אחרת או מ-Excel" onClick=${() => A.go('import')} />
      </div></section>

      ${db.user.admin && html`<section><h2 className="group-h">ניהול</h2><div className="group">
        <${Row} icon="shield" title="לוח בקרה" sub="משתמשים, מחירי דלק ומשוב" onClick=${() => A.go('admin')} />
      </div></section>`}

      <section><h2 className="group-h">עוד</h2><div className="group">
        <${Row} icon="chat" title="שליחת משוב" onClick=${() => A.go('feedback')} />
        <${Row} icon="share" title="שיתוף האפליקציה" onClick=${() => { if (navigator.share) navigator.share({ title: 'טנק מלא', url: 'https://tank-malle.web.app' }).catch(() => {}); else A.toast('הקישור הועתק'); }} chevron=${false} />
        <${Row} icon="doc" title="תנאי שימוש" onClick=${() => A.go('legal', { doc: 'terms' })} />
        <${Row} icon="doc" title="מדיניות פרטיות" onClick=${() => A.go('legal', { doc: 'privacy' })} />
        <${Row} icon="out" title="התנתקות" onClick=${() => A.sheet('confirm', { title: 'להתנתק?', body: 'הנתונים נשארים שמורים בחשבון. שינויים שעוד לא עלו לענן יישמרו במכשיר.', confirm: 'התנתקות', onConfirm: A.signOut })} chevron=${false} />
        <${Row} icon="trash" danger title="מחיקת החשבון" onClick=${() => A.sheet('confirm', { title: 'למחוק את החשבון?', body: 'כל הרכבים, התדלוקים והטיפולים יימחקו לצמיתות. אי אפשר לבטל את זה. כדאי לשמור גיבוי קודם.', confirm: 'מחיקה לצמיתות', danger: true, onConfirm: A.newUser })} chevron=${false} />
      </div></section>
      <p className="note" style=${{ textAlign: 'center' }}>טנק מלא · גרסה 2.0 (פרוטוטייפ)</p>
    </div>`;
  }

  function Notifications({ db, A }) {
    const list = db.notifications.filter((n) => !n.archived);
    const arch = db.notifications.filter((n) => n.archived);
    useEffect(() => { const t = setTimeout(() => A.markAllRead(), 1200); return () => clearTimeout(t); }, []);
    return html`<div className="pad noTabs" style=${{ gap: 16 }}>
      <${Top} onBack=${A.back} title="התראות" />
      ${list.length === 0 && html`<div className="empty"><div className="disp" style=${{ fontSize: 36 }}>אין התראות חדשות</div><p className="muted small">נודיע כשמחיר הדלק משתנה או כשמתקרב טיפול.</p></div>`}
      ${list.map((n) => html`<div key=${n.id} className="card" style=${{ gap: 6, borderWidth: n.read ? 1 : 2 }}>
        <div style=${{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}><b style=${{ fontSize: 16 }}>${!n.read && html`<span style=${{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: 'var(--worse)', marginLeft: 6 }}></span>`}${n.title}</b><span className="note">${fmt.rel(new Date(n.date))}</span></div>
        <p className="small muted">${n.body}</p>
        <button className="link" style=${{ justifySelf: 'start', padding: '4px 0', minHeight: 32 }} onClick=${() => A.archiveNotification(n.id)}>העברה לארכיון</button>
      </div>`)}
      ${arch.length > 0 && html`<p className="note">${arch.length} בארכיון</p>`}
    </div>`;
  }

  function Feedback({ A }) {
    const [kind, setKind] = useState('idea');
    const [t, setT] = useState('');
    const [sent, setSent] = useState(false);
    if (sent) return html`<div className="pad noTabs"><${Top} onBack=${A.back} title="" /><div className="disp" style=${{ fontSize: 60 }}>תודה!</div><p className="muted">קראנו כל מילה. אם השארתם פרטים, נחזור אליכם.</p><button className="btn ink" onClick=${A.back}>חזרה</button></div>`;
    return html`<div className="pad noTabs" style=${{ gap: 16 }}>
      <${Top} onBack=${A.back} title="משוב" />
      <h1 className="h1" style=${{ fontSize: 54 }}>מה חסר לכם?</h1>
      <${Seg} value=${kind} onChange=${setKind} options=${[{ v: 'idea', l: 'רעיון' }, { v: 'bug', l: 'תקלה' }, { v: 'love', l: 'מחמאה' }]} />
      <div className="field"><textarea className="inp" style=${{ minHeight: 180 }} maxLength=${2000} placeholder=${kind === 'bug' ? 'מה קרה, ובאיזה מסך?' : kind === 'love' ? 'מה עובד לכם טוב?' : 'מה הייתם רוצים שיהיה?'} value=${t} onChange=${(e) => setT(e.target.value)} aria-label="המשוב שלך"></textarea>
        <span className="note n" style=${{ textAlign: 'left' }}>${t.length}/2000</span></div>
      <div className="bottomBar"><button className="btn" disabled=${!t.trim()} onClick=${() => { A.addFeedback(kind, t.trim()); setSent(true); }}>שליחה</button></div>
    </div>`;
  }

  function Import({ db, c, A }) {
    const [state, setState] = useState('pick'); // pick | reading | preview | done
    const [name, setName] = useState('');
    const fileRef = useRef(null);
    const sample = [
      { date: '2026-05-03T09:00', odo: 167180, liters: 30.2, price: 7.49, station: 'pz-rm', isNew: true },
      { date: '2026-05-21T18:10', odo: 167560, liters: 29.5, price: 7.49, station: 'sn-gd', isNew: true },
      { date: '2026-06-13T08:10', odo: 167930, liters: 31.0, price: 7.62, station: 'pz-rm', isNew: false },
      { date: '2026-07-22T17:40', odo: 168310, liters: 29.7, price: 7.71, station: 'sn-gd', isNew: false },
    ];
    const read = (n) => { setName(n); setState('reading'); setTimeout(() => setState('preview'), 900); };
    const doImport = () => {
      const recs = sample.filter((r) => r.isNew).map((r) => ({ id: uid(), v: c.v.id, type: 'fill', date: r.date, odo: r.odo, liters: r.liters, price: r.price, total: Math.round(r.liters * r.price * 100) / 100, station: r.station, full: true, fullSource: 'legacy-assumption' }));
      A.bulkAdd(recs, 'ייבוא');
      setState('done');
    };
    return html`<div className="pad noTabs" style=${{ gap: 16 }}>
      <${Top} onBack=${A.back} title="ייבוא" />
      ${state === 'pick' && html`
        <h1 className="h1" style=${{ fontSize: 54 }}>מעבירים היסטוריה</h1>
        <p className="muted">קובץ CSV או Excel, מטנק מלא או מאפליקציה אחרת. הקובץ נקרא רק במכשיר, ולא נשמר כלום לפני שתאשרו.</p>
        <input ref=${fileRef} type="file" accept=".csv,.xlsx" style=${{ display: 'none' }} onChange=${(e) => e.target.files[0] && read(e.target.files[0].name)} />
        <button className="empty" style=${{ textAlign: 'center', justifyItems: 'center', background: 'var(--sf)' }} onClick=${() => fileRef.current && fileRef.current.click()}>
          <${Icon} n="upload" s=${32} /><b style=${{ font: '700 30px/1 var(--display)' }}>בחירת קובץ</b><span className="muted small">CSV · Excel</span>
        </button>
        <button className="link" onClick=${() => read('fuel-tracker-2026.xlsx')}>אין קובץ? נסו קובץ לדוגמה</button>`}
      ${state === 'reading' && html`<div style=${{ display: 'grid', justifyItems: 'center', gap: 14, paddingTop: 80 }}><${Spinner} /><span className="muted">קוראים את ${name}…</span></div>`}
      ${state === 'preview' && html`
        <h1 className="h1" style=${{ fontSize: 48 }}>נמצאו ${sample.length} תדלוקים</h1>
        <p className="muted small">${name} · <b>${sample.filter((r) => r.isNew).length} חדשים</b> · ${sample.filter((r) => !r.isNew).length} כבר קיימים ולא ייובאו שוב</p>
        <div className="group">${sample.map((r, i) => html`<div key=${i} className="row" style=${{ opacity: r.isNew ? 1 : 0.5 }}>
          <span className="grow"><b>${TM.station(r.station).name}</b><small><span className="n">${fmt.dayMon(new Date(r.date))}</span> · <span className="n">${fmt.dec(r.liters)}</span> ל׳ · <span className="n">${fmt.int(r.odo)}</span> ק״מ</small></span>
          <span className="val">${r.isNew ? 'חדש' : 'כפול'}</span></div>`)}</div>
        <div className="warnbox"><${Icon} n="alert" />בקובץ אין עמודה של טנק מלא, אז נניח שכל תדלוק היה עד הסוף. אפשר לתקן כל רשומה אחר כך.</div>
        <div className="bottomBar"><button className="btn" onClick=${doImport}>ייבוא ${sample.filter((r) => r.isNew).length} תדלוקים</button><button className="link" onClick=${() => setState('pick')}>קובץ אחר</button></div>`}
      ${state === 'done' && html`
        <div className="disp" style=${{ fontSize: 64 }}>יובא.</div>
        <p className="muted">2 תדלוקים נוספו ליומן. הצריכה והממוצעים חושבו מחדש.</p>
        <button className="btn ink" onClick=${() => A.tab('journal')}>ליומן</button>
        <button className="link" onClick=${() => { A.undoImport(); setState('pick'); A.toast('הייבוא בוטל'); }}>ביטול הייבוא</button>`}
    </div>`;
  }

  function Unsynced({ db, A }) {
    const list = [...db.writes].reverse();
    const L = { synced: 'עלה לענן', pending: 'נשמר במכשיר · ממתין', rejected: 'נדחה' };
    return html`<div className="pad noTabs" style=${{ gap: 16 }}>
      <${Top} onBack=${A.back} title="סנכרון" />
      <h1 className="h1" style=${{ fontSize: 50 }}>${db.writes.some((w) => w.state === 'pending') ? 'יש שינויים שמחכים' : 'הכל בענן'}</h1>
      <p className="muted small">כל שינוי נשמר קודם במכשיר, גם בלי קליטה, ועולה לענן כשאפשר. כאן רואים מה עוד לא עלה.</p>
      ${db.settings.offline && html`<div className="warnbox"><${Icon} n="wifi" />אין קליטה (מצב הדגמה). השינויים יעלו כשתכבו את המצב הלא מקוון.</div>`}
      ${list.length === 0 ? html`<div className="empty"><div className="disp" style=${{ fontSize: 34 }}>אין שינויים בסשן הזה</div><p className="muted small">הוסיפו תדלוק ותראו אותו עובר מ"נשמר במכשיר" ל"עלה לענן".</p></div>`
        : html`<div className="group">${list.map((w) => html`<div key=${w.id} className="row">
          <span className=${'sync ' + (w.state === 'synced' ? 'ok' : w.state === 'pending' ? 'pending' : 'err')} style=${{ width: 10, height: 10, borderRadius: '50%', border: 0, flex: 'none' }}></span>
          <span className="grow"><b>${w.label}</b><small>${fmt.time(new Date(w.at))} · ${L[w.state]}</small></span></div>`)}</div>`}
    </div>`;
  }

  function Legal({ A, p }) {
    const terms = p.doc === 'terms';
    return html`<div className="pad noTabs" style=${{ gap: 16 }}>
      <${Top} onBack=${A.back} title=${terms ? 'תנאי שימוש' : 'פרטיות'} />
      <div className="doc" style=${{ maxWidth: '36ch' }}>
        <h3>${terms ? 'תנאי שימוש' : 'מדיניות פרטיות'}</h3>
        <p className="muted">[כאן יוצג הטקסט המלא של ${terms ? 'תנאי השימוש' : 'מדיניות הפרטיות'} הקיים באפליקציה, בלי שינוי בתוכן. העיצוב: שורה של 36 תווים, גוף 16 פיקסל, ריווח 1.75, כותרות בפונט התצוגה.]</p>
        ${!terms && html`<p>בקצרה: הנתונים שלכם שייכים לכם. המיקום נבדק רק במכשיר כדי לזהות תחנה ולא נשלח לשרת. להשוואה בין נהגים נשלח רק סיכום של הרכב, בלי שם, מייל, לוחית או תאריכים.</p>`}
      </div>
    </div>`;
  }

  /* ================= ONBOARDING / SIGN-IN / WIZARD ================= */
  const SLIDES = [
    { t: 'תדלוק נרשם ב-15 שניות', b: 'סכום, ק״מ, שמירה. התאריך, התחנה והמחיר כבר ממולאים.' },
    { t: 'צריכה אמיתית, לא הבטחות', b: 'אחרי כל טנק מלא תדעו כמה נסעתם על ליטר, ואיך זה ביחס לרגיל שלכם וליצרן.' },
    { t: 'יודעים מתי לתדלק', b: 'האפליקציה לומדת את ההרגלים שלכם ומזכירה לפני שהמחוון מתקרב לאדום.' },
  ];
  function Onboard({ A }) {
    const [i, setI] = useState(0);
    const s = SLIDES[i];
    const art = [
      html`<div className="pump" style=${{ padding: '4px 16px' }}><div className="prow"><label>סכום</label><div className="pv"><span className="u">₪</span><span className="n" style=${{ font: '600 32px var(--mono)' }}>218</span></div></div><div className="prow"><label>קילומטראז׳</label><div className="pv"><span className="n" style=${{ font: '600 32px var(--mono)' }}>170,344</span></div></div></div>`,
      html`<div style=${{ display: 'grid', gap: 6 }}><span className="lbl">צריכה בתדלוק האחרון</span><span className="disp n" style=${{ fontSize: 120 }}>12.8</span><span className="pill better">5% פחות דלק לק״מ מהרגיל</span></div>`,
      html`<div className="next" style=${{ pointerEvents: 'none' }}><span className="lbl">התדלוק הבא</span><div className="disp when">בעוד <span>4</span> ימים</div><${UI.Ticks} level=${0.45} habit=${0.3} /></div>`,
    ][i];
    return html`<div className="pad noTabs" style=${{ gap: 22 }}>
      <div className="top"><div className="steps" style=${{ flex: 1 }}>${SLIDES.map((_, j) => html`<i key=${j} className=${j <= i ? 'on' : ''}></i>`)}</div><button className="link" onClick=${() => A.replace('signin')}>דילוג</button></div>
      <div className="slide-art">${art}</div>
      <h1 className="h1" style=${{ fontSize: 58 }}>${s.t}</h1>
      <p className="muted" style=${{ fontSize: 17 }}>${s.b}</p>
      <div className="bottomBar"><button className="btn" onClick=${() => (i < 2 ? setI(i + 1) : A.replace('signin'))}>${i < 2 ? 'הבא' : 'מתחילים'}</button></div>
    </div>`;
  }

  function SignIn({ db, A }) {
    const [ok, setOk] = useState(false);
    const [shake, setShake] = useState(false);
    const [busy, setBusy] = useState(false);
    const go = () => {
      if (!ok) { setShake(true); setTimeout(() => setShake(false), 420); return; }
      setBusy(true);
      setTimeout(() => { A.signIn(); }, 900);
    };
    return html`<div className="pad noTabs" style=${{ gap: 22, justifyContent: 'flex-end' }}>
      <div style=${{ display: 'flex', alignItems: 'center', gap: 10 }}><span className="badge" style=${{ background: 'var(--plate)', color: '#111', border: '2px solid #111' }}><${Icon} n="pump" s=${20} /></span><b style=${{ font: '700 30px/1 var(--display)' }}>טנק מלא</b></div>
      <h1 className="h1" style=${{ fontSize: 76 }}>כל תדלוק, כל שקל, כל ק״מ.</h1>
      <p className="muted" style=${{ fontSize: 17 }}>צריכה אמיתית, הוצאה חודשית, ומתי לתדלק. במקום אחד, גם בלי קליטה.</p>
      <div style=${{ flex: 1 }}></div>
      <${Check} on=${ok} onChange=${setOk} className=${shake ? 'shake' : ''}>קראתי ואני מסכים/ה ל<a href="#" onClick=${(e) => { e.preventDefault(); e.stopPropagation(); A.go('legal', { doc: 'terms' }); }}>תנאי השימוש</a> ול<a href="#" onClick=${(e) => { e.preventDefault(); e.stopPropagation(); A.go('legal', { doc: 'privacy' }); }}>מדיניות הפרטיות</a></${Check}>
      ${shake && html`<span className="err">צריך לסמן את התיבה כדי להמשיך</span>`}
      <button className="gbtn" onClick=${go} aria-disabled=${!ok} style=${{ opacity: ok ? 1 : 0.6 }}>${busy ? html`<${Spinner} />` : html`<span className="gdot"></span>`}התחברות עם Google</button>
      <p className="note" style=${{ textAlign: 'center' }}>הנתונים נשמרים בחשבון שלך ורק אצלך.</p>
    </div>`;
  }

  function Wizard({ db, A, p }) {
    const [step, setStep] = useState(1);
    const [plate, setPlate] = useState('');
    const [busy, setBusy] = useState(false);
    const [car, setCar] = useState(null);
    const [edit, setEdit] = useState(false);
    const [extra, setExtra] = useState({ nick: '', tank: '', mfr: '' });
    const ok = plate.length === 7 || plate.length === 8;
    const press = (k) => setPlate((s) => (k === 'del' ? s.slice(0, -1) : k === 'clr' ? '' : s.length < 8 ? s + k : s));
    useEffect(() => {
      if (step !== 1) return;
      const h = (e) => { if (/^\d$/.test(e.key)) press(e.key); if (e.key === 'Backspace') press('del'); };
      window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
    }, [step]);
    const find = () => { setBusy(true); setTimeout(() => { setBusy(false); setCar({ ...lookupPlate(plate) }); setStep(2); }, 1000); };
    const finish = () => {
      const v = { id: uid(), plate, ...car, nick: extra.nick.trim() || `${car.make} ${car.model}`, tank: Number(extra.tank) || car.tank, mfr: Number(extra.mfr) || car.mfr, archived: false };
      A.addVehicle(v);
    };
    const back = () => (step === 1 ? (p.add || db.vehicles.length ? A.back() : null) : setStep(step - 1));
    return html`<div className="pad noTabs" style=${{ gap: 18 }}>
      <div className="top">
        ${step > 1 || p.add || db.vehicles.length ? html`<button className="ib" aria-label="חזרה" onClick=${back}><${Icon} n="back" /></button>` : html`<span style=${{ width: 44 }}></span>`}
        <span className="lbl">שלב ${step} מתוך 3</span><span style=${{ width: 44 }}></span>
      </div>
      <div className="steps">${[1, 2, 3].map((j) => html`<i key=${j} className=${j <= step ? 'on' : ''}></i>`)}</div>
      ${step === 1 && html`
        <h1 className="h1" style=${{ fontSize: 58 }}>מה מספר הרכב?</h1>
        <p className="muted">נביא יצרן, דגם ושנה ממאגר משרד התחבורה.</p>
        <${PlateXL} value=${plate} placeholder style=${{ height: 92 }} />
        <div className="keys">
          ${['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => html`<button key=${k} onClick=${() => press(k)}>${k}</button>`)}
          <button className="mute" onClick=${() => press('clr')}>ניקוי</button><button onClick=${() => press('0')}>0</button><button className="mute" aria-label="מחיקה" onClick=${() => press('del')}>⌫</button>
        </div>
        <div className="bottomBar"><button className="btn" disabled=${!ok || busy} onClick=${find}>${busy ? html`<${Spinner} />` : 'חיפוש הרכב'}</button>
          <button className="link" onClick=${() => { setCar({ make: '', model: '', year: 2020, fuel: '95', tank: 45, mfr: null }); setEdit(true); setStep(2); }}>אין לוחית? הזנה ידנית</button></div>`}
      ${step === 2 && car && html`
        ${!edit && html`<span className="pill better">✓ נמצא במאגר משרד התחבורה</span>`}
        <h1 className="h1" style=${{ fontSize: 58 }}>${edit ? 'פרטי הרכב' : 'זה הרכב שלך?'}</h1>
        ${plate && html`<${PlateXL} value=${plate} style=${{ height: 60 }} />`}
        ${edit ? html`<div style=${{ display: 'grid', gap: 12 }}>
            <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="field"><label htmlFor="w-make">יצרן</label><input id="w-make" className="inp" value=${car.make} onChange=${(e) => setCar({ ...car, make: e.target.value })} /></div>
              <div className="field"><label htmlFor="w-model">דגם</label><input id="w-model" className="inp" value=${car.model} onChange=${(e) => setCar({ ...car, model: e.target.value })} /></div>
            </div>
            <div className="field"><label htmlFor="w-year">שנה</label><${NumInput} id="w-year" className="inp n" decimals=${0} value=${String(car.year)} onChange=${(x) => setCar({ ...car, year: Number(x) })} /></div>
          </div>`
          : html`<div className="group">
            <${Row} title="יצרן" value=${car.make} /><${Row} title="דגם" value=${car.model} /><${Row} title="שנת ייצור" value=${html`<span className="n">${car.year}</span>`} />
          </div>`}
        <div className="field"><span className="lbl">סוג דלק</span><${Seg} value=${car.fuel} onChange=${(x) => setCar({ ...car, fuel: x })} options=${[{ v: '95', l: '95' }, { v: '98', l: '98' }, { v: 'סולר', l: 'סולר' }, { v: 'אחר', l: 'אחר' }]} /></div>
        <div className="bottomBar"><button className="btn" disabled=${!car.make || !car.model} onClick=${() => setStep(3)}>${edit ? 'המשך' : 'כן, זה הרכב שלי'}</button>${!edit && html`<button className="link" onClick=${() => setEdit(true)}>תיקון פרטים</button>`}</div>`}
      ${step === 3 && html`
        <h1 className="h1" style=${{ fontSize: 58 }}>עוד שני פרטים</h1>
        <p className="muted">לא חובה. אפשר להשלים אחר כך בפרטי הרכב.</p>
        <div className="field"><label htmlFor="w-nick">איך קוראים לרכב?</label><input id="w-nick" className="inp" placeholder=${`${car.make} ${car.model}`} value=${extra.nick} onChange=${(e) => setExtra({ ...extra, nick: e.target.value })} /></div>
        <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="field"><label htmlFor="w-tank">נפח מיכל</label><div className="inp-wrap"><${NumInput} id="w-tank" className="inp n" decimals=${0} placeholder=${String(car.tank)} value=${extra.tank} onChange=${(x) => setExtra({ ...extra, tank: x })} /><span className="unit">ל׳</span></div></div>
          <div className="field"><label htmlFor="w-mfr">נתון יצרן</label><div className="inp-wrap"><${NumInput} id="w-mfr" className="inp n" decimals=${1} placeholder=${car.mfr ? String(car.mfr) : '—'} value=${extra.mfr} onChange=${(x) => setExtra({ ...extra, mfr: x })} /><span className="unit">ק״מ/ל׳</span></div></div>
        </div>
        <div className="bottomBar"><button className="btn" onClick=${finish}>שמירת הרכב</button><button className="link" onClick=${finish}>אשלים אחר כך</button></div>`}
    </div>`;
  }

  window.S2 = { Vehicle, VehicleEdit, Vehicles, ServiceForm, ExpenseForm, Account, Notifications, Feedback, Import, Unsynced, Legal, Onboard, SignIn, Wizard, reminderDue };
})();
