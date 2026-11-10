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
    const allRems = db.reminders.filter((r) => r.v === v.id);
    const rems = allRems.filter((r) => r.active !== false), paused = allRems.filter((r) => r.active === false);
    const KINDS = c.ev ? TM.EV_REMINDER_KINDS : REMINDER_KINDS;
    const sugg = KINDS.filter((k) => !allRems.some((r) => r.kind === k.id));
    const issues = db.issues.filter((i) => i.v === v.id && i.open), resolved = db.issues.filter((i) => i.v === v.id && !i.open);
    const y = String(now().getFullYear());
    const [period, setPeriod] = useState('year');
    const inP = ([k]) => (period === 'all' ? true : period === 'year' ? k.startsWith(y) : k === mkey(now()));
    const yr = Object.entries(c.monthly).filter(inP).reduce((s, [, m]) => ({ fuel: s.fuel + m.fuel, service: s.service + m.service, expense: s.expense + m.expense }), { fuel: 0, service: 0, expense: 0 });
    const from = period === 'all' ? '1900' : period === 'year' ? y : mkey(now());
    const count = c.recs.filter((r) => ['fill', 'charge', 'service', 'expense'].includes(r.type) && r.date >= from).length;
    const unknown = c.recs.filter((r) => (r.type === 'service' || r.type === 'expense') && r.cost == null && r.date >= from).length;
    const years = Object.keys(c.yearly).sort().reverse();
    const maxYear = Math.max(1, ...years.map((k) => c.yearly[k].fuel + c.yearly[k].service + c.yearly[k].expense));
    return html`<div className="pad" style=${{ gap: 20 }}>
      <div className="top"><span className="lbl">${v.nick}</span>
        <button className="chip" onClick=${() => A.go('vehicles')}>${db.vehicles.filter((x) => !x.archived).length > 1 ? 'החלפת רכב' : 'ניהול רכבים'}</button></div>
      <${PlateXL} value=${v.plate} />
      <div><div className="disp" style=${{ fontSize: 36 }}>${v.make} ${v.model}</div><div className="muted" style=${{ fontSize: 14.5, marginTop: 6 }}>${v.year} · ${c.ev ? `חשמלי · סוללה ${c.cap} kWh${v.battery && v.battery.wltp ? ` · טווח ${v.battery.wltp} ק״מ` : ''}` : `${TM.fuelLabel(v)} · מיכל ${v.tank} ל׳${v.tankConfirmed ? '' : ' (הערכה)'}`}${v.mfr && !c.ev ? ` · צריכה מוצהרת ${consStr(v.mfr, db.settings.unit)} ${consUnitShort(db.settings.unit)}` : ''}</div></div>
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
        ${rems.map((r) => { const due = S4.reminderNext(r, c, db); const byKm = due.byKm || due.daysLeft == null; const n = byKm ? due.kmLeft : due.daysLeft; const soon = byKm ? n != null && n < 1000 : n != null && n < 30; return html`<button key=${r.id} className="rem" onClick=${() => A.sheet('reminderView', { id: r.id })}>
          <span className="ri" style=${{ width: 36, height: 36, borderRadius: 10, border: '1.5px solid var(--tx)', display: 'grid', placeItems: 'center' }}><${Icon} n="calendar" s=${18} /></span>
          <span style=${{ display: 'grid' }}><b style=${{ fontWeight: 600 }}>${r.label}</b><small className="muted">${due.needsMileage ? 'נדרשת קריאת ק״מ בטיפול האחרון' : [due.dueDate ? fmt.date(new Date(due.dueDate)) : null, due.dueKm ? `ב-${fmt.int(due.dueKm)} ק״מ` : null].filter(Boolean).join(' או ')}${due.dueDate && due.dueKm ? ' · המוקדם' : ''}</small></span>
          ${n != null && html`<span className=${'due' + (soon ? ' soon' : '')}>${n < 0 ? 'עבר' : html`<span className="n">${fmt.int(n)}</span>`}<small>${n < 0 ? 'הזמן' : byKm ? 'ק״מ' : 'ימים'}</small></span>`}
        </button>`; })}
        ${paused.length > 0 && html`<details className="note" style=${{ marginTop: 6 }}><summary>תזכורות מושהות · ${paused.length}</summary>${paused.map((r) => html`<${Row} key=${r.id} icon="pause" title=${r.label} sub=${r.dueDate ? fmt.date(new Date(r.dueDate)) : r.dueKm ? `ב-${fmt.int(r.dueKm)} ק״מ` : ''} onClick=${() => A.sheet('reminderView', { id: r.id })} />`)}</details>`}
        ${sugg.length > 0 && rems.length === 0 && html`<div style=${{ display: 'grid', gap: 10, marginTop: 12 }}>
          <span className="lbl">${rems.length ? 'עוד משהו שכדאי שנזכיר?' : 'מה כדאי שנזכיר לך?'}</span>
          <div className="chips">${sugg.map((k) => html`<button key=${k.id} className="chip dash" onClick=${() => A.sheet('reminder', { kind: k.id })}><${Icon} n="plus" />${k.label}</button>`)}</div>
        </div>`}
        ${sugg.length > 0 && rems.length > 0 && html`<${Row} icon="plus" title="תזכורת נוספת" sub=${sugg.map((k) => k.label).join(' · ')} onClick=${() => A.sheet('choice', { title: 'מה להזכיר?', value: null, options: sugg.map((k) => ({ v: k.id, l: k.label })), onPick: (id) => setTimeout(() => A.sheet('reminder', { kind: id }), 0) })} />`}
      </section>

      <section>
        <h2 className="group-h">מה קורה ברכב</h2>
        ${issues.map((i) => html`<${Row} key=${i.id} icon="alert" title=${i.title} sub=${`${TM.ISSUE_STATUS[i.status || 'open']} · זוהתה ${fmt.rel(new Date(i.date))}${i.importance === 'soon' ? ' · חשוב לטפל בקרוב' : ''}`} onClick=${() => A.sheet('issue', { id: i.id })} />`)}
        <${Row} icon="plus" title="משהו השתנה ברכב?" sub="רעש, נורה, תקלה. נעקוב עד שזה מתוקן" onClick=${() => A.sheet('issue')} />
        ${resolved.length > 0 && html`<details className="note" style=${{ marginTop: 6 }}><summary>תקלות שנפתרו · ${resolved.length}</summary>${resolved.map((i) => html`<${Row} key=${i.id} icon="check" title=${i.title} sub=${`נפתרה · ${(i.history || []).slice(-1)[0] ? fmt.dayMon(new Date((i.history || []).slice(-1)[0].date)) : ''}`} onClick=${() => A.sheet('issue', { id: i.id })} />`)}</details>`}
      </section>

      <section>
        <div className="recent-h" style=${{ alignItems: 'center' }}><h2 className="group-h" style=${{ margin: 0 }}>כמה עלה</h2><${Seg} value=${period} onChange=${setPeriod} options=${[{ v: 'all', l: 'כל התקופה' }, { v: 'year', l: 'השנה' }, { v: 'month', l: 'החודש' }]} /></div>
        <div className="facts" role="list" style=${{ marginTop: 10 }}>
          <button role="listitem" onClick=${() => A.tab('insights', { tab: 'spend' })}><span className="fl">${period === 'all' ? 'מתחילת הרישומים' : period === 'year' ? `${y} עד עכשיו` : fmt.month(mkey(now()))}<small>${count} ${count === 1 ? 'רשומה' : 'רשומות'}${unknown ? ` · ${unknown} ${unknown === 1 ? 'עלות חסרה' : 'עלויות חסרות'}` : ''}</small></span><i className="ld"></i><span className="fv"><span className="n">${fmt.money(yr.fuel + yr.service + yr.expense)}</span></span></button>
          <button role="listitem" onClick=${() => A.tab('journal', { filter: 'fill' })}><span className="fl"><small>${c.ev ? 'חשמל' : 'דלק'}</small></span><i className="ld"></i><span className="fv"><span className="n" style=${{ fontSize: 16 }}>${fmt.money(yr.fuel)}</span></span></button>
          <button role="listitem" onClick=${() => A.tab('journal', { filter: 'service' })}><span className="fl"><small>טיפולים</small></span><i className="ld"></i><span className="fv"><span className="n" style=${{ fontSize: 16 }}>${fmt.money(yr.service)}</span></span></button>
          <button role="listitem" onClick=${() => A.tab('journal', { filter: 'expense' })}><span className="fl"><small>הוצאות אחרות</small></span><i className="ld"></i><span className="fv"><span className="n" style=${{ fontSize: 16 }}>${fmt.money(yr.expense)}</span></span></button>
        </div>
        ${years.length > 1 && html`<div style=${{ display: 'grid', gap: 6, marginTop: 14 }}><span className="lbl">לפי שנה</span>${years.map((k) => { const t = c.yearly[k]; const tot = t.fuel + t.service + t.expense; return html`<button key=${k} className="yearrow" onClick=${() => A.go('vehicleYear', { year: k })}><span className="n">${k}</span><i><b style=${{ width: (tot / maxYear) * 100 + '%' }}></b></i><span className="n">${fmt.money(tot)}</span><${Icon} n="chev" s=${16} /></button>`; })}</div>`}
      </section>

      <section className="group">
        <${Row} title="היסטוריית הטיפולים" sub=${`${c.recs.filter((r) => r.type === 'service').length} רשומות ביומן`} onClick=${() => A.tab('journal', { filter: 'service' })} />
        <${Row} title="פרטי הרכב" sub=${c.ev ? 'דגם, סוללה, טווח, תעריף בית' : 'דגם, סוג דלק, נפח מיכל, נתון יצרן'} onClick=${() => A.go('vehicleEdit')} />
        <${Row} title="גיבוי וייצוא תחזוקה" sub="טיפולים, תזכורות והוצאות של הרכב הזה" onClick=${() => A.sheet('careTransfer')} />
        <${Row} title="דוח חודשי לעסק" sub="PDF או Excel של כל ההוצאות בחודש" onClick=${() => A.sheet('bizExport')} />
        <${Row} title="רכבים נוספים וארכיון" onClick=${() => A.go('vehicles')} />
      </section>
    </div>`;
  }

  function VehicleEdit({ db, c, A }) {
    const v = c.v;
    const isEV = v.powertrain === 'ev';
    const [f, setF] = useState({ ...v, tank: String(v.tank), mfr: String(v.mfr || ''), year: String(v.year), kwh: String((v.battery && v.battery.kwh) || ''), wltp: String((v.battery && v.battery.wltp) || ''), homeTariff: v.homeTariff ? String(v.homeTariff) : '' });
    const [busy, setBusy] = useState(false);
    const set = (k, x) => setF((s) => ({ ...s, [k]: x }));
    const refresh = () => { setBusy(true); setTimeout(() => { setBusy(false); const r = lookupPlate(v.plate); setF((s) => ({ ...s, make: r.make, model: r.model, year: String(r.year), fuel: r.fuel, kwh: r.battery ? String(r.battery.kwh) : s.kwh, wltp: r.battery && r.battery.wltp ? String(r.battery.wltp) : s.wltp })); A.toast(r.fuel === 'חשמל' ? 'הפרטים עודכנו: רכב חשמלי, קיבולת סוללה וטווח' : 'הפרטים עודכנו ממאגר משרד התחבורה'); }, 900); };
    const save = () => { const ev = f.fuel === 'חשמל'; A.updateVehicle(v.id, { nick: f.nick, make: f.make, model: f.model, year: Number(f.year) || v.year, fuel: f.fuel, tankConfirmed: !ev && !!f.tankConfirmed && Number(f.tank) > 0, powertrain: ev ? 'ev' : null, tank: ev ? Number(f.kwh) || v.tank : Number(f.tank) || v.tank, mfr: ev ? (Number(f.wltp) && Number(f.kwh) ? Number(f.wltp) / Number(f.kwh) : v.mfr) : Number(f.mfr) || null, battery: ev ? { kwh: Number(f.kwh) || 60, wltp: Number(f.wltp) || null } : null, homeTariff: ev ? Number(f.homeTariff) || null : null }); A.back(); A.toast('פרטי הרכב נשמרו'); };
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
      <div className="field"><span className="lbl">הנעה</span><${Seg} value=${f.fuel} onChange=${(x) => set('fuel', x)} options=${[{ v: '95', l: '95' }, { v: '98', l: '98' }, { v: 'סולר', l: 'סולר' }, { v: 'חשמל', l: 'חשמלי' }]} /></div>
      ${f.fuel === 'חשמל' ? html`
        <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="field"><label htmlFor="ve-kwh">סוללה</label><div className="inp-wrap"><${NumInput} id="ve-kwh" className="inp n" decimals=${1} value=${f.kwh} onChange=${(x) => set('kwh', x)} /><span className="unit">kWh</span></div></div>
          <div className="field"><label htmlFor="ve-wltp">טווח יצרן</label><div className="inp-wrap"><${NumInput} id="ve-wltp" className="inp n" decimals=${0} value=${f.wltp} onChange=${(x) => set('wltp', x)} /><span className="unit">ק״מ WLTP</span></div></div>
        </div>
        <div className="field"><label htmlFor="ve-tariff">תעריף חשמל בבית</label><div className="inp-wrap"><${NumInput} id="ve-tariff" className="inp n" decimals=${3} placeholder="0.58" value=${f.homeTariff} onChange=${(x) => set('homeTariff', x)} /><span className="unit">₪ ל-kWh</span></div><span className="note">מה שחברת החשמל גובה ממך. בלי זה לטעינות הבית אין מחיר.</span></div>`
      : f.fuel !== '95' && html`<div className="warnbox"><${Icon} n="alert" />רק לבנזין 95 יש מחיר מרבי בפיקוח. ל${f.fuel === 'סולר' ? 'סולר' : 'דלק הזה'} נציע את המחיר ששילמתם בפעם הקודמת.</div>`}
      ${f.fuel !== 'חשמל' && html`<div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="field"><label htmlFor="ve-tank">נפח מיכל</label><div className="inp-wrap"><${NumInput} id="ve-tank" className="inp n" decimals=${0} value=${f.tank} onChange=${(x) => set('tank', x)} /><span className="unit">ל׳ · הערכה</span></div></div>
        <div className="field"><label htmlFor="ve-mfr">נתון יצרן</label><div className="inp-wrap"><${NumInput} id="ve-mfr" className="inp n" decimals=${1} value=${f.mfr} onChange=${(x) => set('mfr', x)} /><span className="unit">ק״מ/ל׳</span></div></div>
      </div>
      <${Check} on=${!!f.tankConfirmed} onChange=${(x) => set('tankConfirmed', x)}>בדקתי — זה נפח המיכל</${Check}>
      <p className="note">נפח המיכל לא מתפרסם בשום מאגר, אז הוא מוערך לפי סוג הרכב. אם אתם יודעים את המספר המדויק, תקנו ואשרו אותו — זה משפר את הערכת הדלק שנשאר.</p>`}
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
    const fromReminder = p.reminderId ? db.reminders.find((r) => r.id === p.reminderId) : null;
    const [step, setStep] = useState(editing || fromReminder ? 2 : 1);
    const [f, setF] = useState(editing
      ? { k: editing.kind || editing.cat, label: editing.label, cost: editing.cost == null ? '' : String(editing.cost), date: editing.date, odo: editing.odo ? String(editing.odo) : '', garage: editing.garage || '', note: editing.note || '', refund: !!editing.refund, included: !editing.excluded, next: false, nextKm: '', nextMo: '', nextSrc: 'garage', odoOk: true }
      : { k: fromReminder ? fromReminder.kind : null, label: fromReminder ? fromReminder.label : '', cost: '', date: isoLocal(now()), odo: c.latest ? String(Math.round(c.estOdo)) : '', garage: '', note: '', refund: false, included: true, next: !!fromReminder, nextKm: fromReminder && fromReminder.intervalKm ? String(fromReminder.intervalKm) : '10000', nextMo: fromReminder && fromReminder.intervalMonths ? String(fromReminder.intervalMonths) : '12', nextSrc: fromReminder ? fromReminder.source || 'garage' : 'garage', odoOk: false });
    const [tried, setTried] = useState(false);
    const set = (k, x) => setF((s) => ({ ...s, [k]: x }));
    const pick = (k) => { const def = KINDS.find((x) => x.id === k); setF((s) => ({ ...s, k, label: k === 'other' ? '' : def.label })); setStep(2); };
    const odoN = f.odo ? Number(f.odo) : null;
    const latest = c.latest ? c.latest.odo : null;
    const odoLow = isService && odoN != null && latest != null && odoN < latest && new Date(f.date) > new Date(c.latest.date);
    const odoJump = isService && odoN != null && latest != null && !odoLow && odoN - latest > 1500 && !f.odoOk;
    const costOk = f.cost === '' || Number(f.cost) >= 0;
    const save = () => {
      setTried(true);
      if (!f.label.trim() || !costOk || odoLow || odoJump) return;
      const rec = { ...(editing || {}), id: editing ? editing.id : uid(), v: c.v.id, type: kind, date: f.date, label: f.label.trim(), cost: f.cost === '' ? null : Number(f.cost), note: f.note };
      if (isService) { rec.kind = f.k; rec.odo = odoN || null; rec.garage = f.garage.trim(); if (fromReminder) rec.reminderId = fromReminder.id; }
      else { rec.cat = f.k; rec.refund = f.refund; rec.excluded = !f.included; }
      A.upsert(rec, isService ? 'טיפול' : 'הוצאה');
      if (isService && f.next && !editing) {
        const base = fromReminder || { id: uid(), v: c.v.id, kind: f.k, label: f.label.trim(), basis: 'completion', active: true };
        A.saveReminder({ ...base, label: fromReminder ? fromReminder.label : f.label.trim(), basis: 'completion', source: f.nextSrc, intervalKm: Number(f.nextKm) || null, intervalMonths: Number(f.nextMo) || null, lastServiceId: rec.id, dueKm: odoN && Number(f.nextKm) ? odoN + Number(f.nextKm) : null, dueDate: Number(f.nextMo) ? (() => { const d = new Date(f.date); d.setMonth(d.getMonth() + Number(f.nextMo)); return isoLocal(d).slice(0, 10); })() : null, snoozedUntil: null });
      } else if (fromReminder) A.completeReminder(fromReminder.id, rec.id);
      A.back();
      A.toast(isService ? (f.next && !editing ? `${rec.label} נשמר. התזכורת הבאה נקבעה.` : `${rec.label} נשמר ביומן`) : rec.cost == null ? 'ההוצאה נשמרה בלי סכום' : f.refund ? `החזר נרשם: ${fmt.money(rec.cost)}` : `ההוצאה נשמרה: ${fmt.money(rec.cost)}`);
    };
    return html`<div className="pad noTabs" style=${{ gap: 18 }}>
      <div className="top">
        <button className="ib" aria-label=${step === 2 && !editing && !fromReminder ? 'חזרה לבחירה' : 'סגירה'} onClick=${step === 2 && !editing && !fromReminder ? () => setStep(1) : A.back}><${Icon} n=${step === 2 && !editing && !fromReminder ? 'back' : 'x'} /></button>
        <span className="lbl">${editing || fromReminder ? '' : `${step} / 2`}</span><span style=${{ width: 44 }}></span>
      </div>
      ${step === 1 ? html`
        <h1 className="h1" style=${{ fontSize: 54 }}>${isService ? 'מה עשו ברכב?' : 'על מה ההוצאה?'}</h1>
        <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          ${KINDS.map((k) => html`<button key=${k.id} className="btn line" style=${{ justifyContent: 'flex-start', padding: '0 16px', minHeight: 64 }} onClick=${() => pick(k.id)}><${Icon} n=${k.icon} />${k.label}</button>`)}
        </div>
        <p className="note">${isService ? 'כמה עבודות בביקור אחד? בחרו את העיקרית ופרטו בהערה.' : 'ביטוח, טסט, חניה או החזר. גם כסף שהוחזר לכם נכנס לכאן.'}</p>`
      : html`
        ${fromReminder && html`<span className="pill neutral"><${Icon} n="calendar" s=${14} />רישום טיפול לתזכורת: ${fromReminder.label}</span>`}
        <h1 className="h1" style=${{ fontSize: 54 }}>${editing ? (isService ? 'עריכת טיפול' : 'עריכת הוצאה') : f.label || (isService ? 'טיפול' : 'הוצאה')}</h1>
        ${(f.k === 'other' || editing) && html`<div className="field"><label htmlFor="cf-label">תיאור</label><input id="cf-label" className="inp" value=${f.label} placeholder=${isService ? 'למשל: החלפת מגבים' : 'למשל: רישיון רכב'} onChange=${(e) => set('label', e.target.value)} />${tried && !f.label.trim() && html`<span className="err">חסר תיאור</span>`}</div>`}
        <div className="field"><label htmlFor="cf-cost">${f.refund ? 'כמה חזר אליכם' : 'כמה עלה'}</label><div className="inp-wrap"><${NumInput} id="cf-cost" className="inp n" style=${{ fontSize: 26, fontWeight: 600 }} placeholder="0" value=${f.cost} onChange=${(x) => set('cost', x)} autoFocus /><span className="unit">₪</span></div><span className="note">ריק אם לא ידוע · 0 אם לא שילמתם${f.cost === '' ? ' · עלות חסרה לא נספרת כאפס' : ''}</span></div>
        ${!isService && html`<div className="row" style=${{ padding: '4px 0' }}><span className="grow"><b>כסף שהוחזר לכם</b><small>החזר מוריד מהסכום של החודש</small></span><${Toggle} on=${f.refund} label="החזר" onChange=${(x) => set('refund', x)} /></div>`}
        <div className="field"><label htmlFor="cf-date">${isService ? 'תאריך ביצוע' : 'מתי'}</label><input id="cf-date" className="inp n" type="date" value=${f.date.slice(0, 10)} max=${isoLocal(now()).slice(0, 10)} onChange=${(e) => set('date', e.target.value + f.date.slice(10))} /></div>
        ${isService && html`<div className="field"><label htmlFor="cf-garage">מוסך / ספק <span className="muted" style=${{ fontWeight: 400 }}>(לא חובה)</span></label><input id="cf-garage" className="inp" value=${f.garage} placeholder="למשל: מוסך יוסי, קרית מלאכי" onChange=${(e) => set('garage', e.target.value)} /></div>`}
        ${isService && html`<div className="field"><label htmlFor="cf-odo">קילומטראז׳ בזמן הטיפול</label><div className="inp-wrap"><${NumInput} id="cf-odo" className="inp n" decimals=${0} value=${f.odo} onChange=${(x) => setF((st) => ({ ...st, odo: x, odoOk: false }))} placeholder="למשל 180000" /><span className="unit">ק״מ</span></div>
          ${odoLow ? html`<span className="err">הקריאה נמוכה מקילומטראז׳ שכבר תועד (${fmt.int(latest)} ק״מ). בדקו את המספר או בחרו תאריך היסטורי מתאים.</span>`
          : odoJump ? html`<div className="warnbox" style=${{ display: 'grid', gap: 8 }}><span><${Icon} n="alert" /> הקילומטראז׳ נכון? הזנתם ${fmt.int(odoN)} ק״מ — תוספת של ${fmt.int(odoN - latest)} ק״מ מהקריאה האחרונה (${fmt.int(latest)}, ${fmt.rel(c.latest.date)}).</span><div style=${{ display: 'flex', gap: 8 }}><button className="chip" onClick=${() => set('odoOk', true)}>כן, זו הקריאה</button><button className="chip" onClick=${() => set('odo', String(Math.round(c.estOdo)))}>לתקן את המספר</button></div></div>`
          : latest != null ? html`<span className="note">הקריאה האחרונה: ${fmt.int(latest)} ק״מ · ${fmt.rel(c.latest.date)}</span>` : null}</div>`}
        <div className="field"><label htmlFor="cf-note">הערות</label><textarea id="cf-note" className="inp" value=${f.note} placeholder=${isService ? 'מה הוחלף, מה המוסך המליץ' : ''} onChange=${(e) => set('note', e.target.value)}></textarea></div>
        ${!isService && html`<div className="row" style=${{ padding: '4px 0', borderTop: '1px solid var(--ln)' }}><span className="grow"><b style=${{ display: 'flex', alignItems: 'center', gap: 6 }}>לכלול בעלות הרכב<span className="ib ghost" role="button" aria-label="מה זה אומר" style=${{ width: 26, height: 26, minHeight: 0 }} onClick=${() => A.sheet('excludeInfo')}><${Icon} n="info" s=${15} /></span></b><small>${f.included ? 'נכנס ל"כמה הרכב עולה לך" ולממוצעים' : 'נרשם ביומן בלבד · לא בעלות הרכב ולא בממוצעים'}</small></span><${Toggle} on=${f.included} label="לכלול בעלות הרכב" onChange=${(x) => set('included', x)} /></div>`}
        ${isService && !editing && html`<div className="row" style=${{ padding: '4px 0', borderTop: '1px solid var(--ln)' }}><span className="grow"><b>לקבוע גם את הטיפול הבא</b><small>${fromReminder ? 'התזכורת תתקדם למועד הבא לפי המרווח' : 'תזכורת שנספרת מהטיפול הזה'}</small></span><${Toggle} on=${f.next} label="טיפול הבא" onChange=${(x) => set('next', x)} /></div>
          ${f.next && html`<div style=${{ display: 'grid', gap: 10 }}>
            <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="field"><label htmlFor="cf-nk">חזרה כל</label><div className="inp-wrap"><${NumInput} id="cf-nk" className="inp n" decimals=${0} value=${f.nextKm} onChange=${(x) => set('nextKm', x)} /><span className="unit">ק״מ</span></div></div>
              <div className="field"><label htmlFor="cf-nm">או כל</label><div className="inp-wrap"><${NumInput} id="cf-nm" className="inp n" decimals=${0} value=${f.nextMo} onChange=${(x) => set('nextMo', x)} /><span className="unit">חודשים</span></div></div>
            </div>
            <${Seg} value=${f.nextSrc} onChange=${(x) => set('nextSrc', x)} options=${TM.REMINDER_SOURCE.map((o) => ({ v: o.id, l: o.label }))} />
            <span className="note">המוקדם מביניהם. ${!odoN && Number(f.nextKm) ? 'בלי קילומטראז׳ בטיפול, היעד בק״מ לא יחושב.' : ''}</span>
          </div>`}`}
        ${editing && html`<button className="btn danger sm" onClick=${() => A.confirmDelete(editing.id, true)}><${Icon} n="trash" />מחיקה</button>`}
        <div className="bottomBar"><button className="btn" onClick=${save}>${editing ? 'שמירת שינויים' : 'שמירה'}</button></div>`}
    </div>`;
  }
  const ServiceForm = (props) => html`<${CostForm} ...${props} kind="service" />`;
  const ExpenseForm = (props) => html`<${CostForm} ...${props} kind="expense" />`;

  /* ================= ACCOUNT (profile + settings + data in one place) ================= */
  function Account({ db, c, A }) {
    const s = db.settings;
    const pending = db.writes.filter((w) => w.state === 'pending').length, failed = db.writes.filter((w) => w.state === 'rejected').length;
    const themeL = { system: 'לפי המכשיר', light: 'בהיר', dark: 'כהה' }[s.theme];
    const unitL = s.unit === 'kml' ? 'ק״מ לליטר' : 'ליטר ל-100 ק״מ';
    const discL = s.discount.type === 'none' ? 'אין' : s.discount.type === 'agorot' ? `${s.discount.value} אג׳ לליטר` : `${s.discount.value}%`;
    const [scope, setScope] = useState('active');
    const [refreshing, setRefreshing] = useState(false);
    const vids = scope === 'all' ? db.vehicles.map((v) => v.id) : [c.v.id];
    const dl = (name, text, type, msg) => S4.download(name, text, type, A, msg);
    const stamp = () => isoLocal(now()).replace(/[:T]/g, '-');
    const exportFills = () => vids.forEach((vid) => { const v = db.vehicles.find((x) => x.id === vid); dl(`tank-maleh-fills-${v.nick}-${stamp()}.csv`, TM.toCSV({ ...db, records: db.records.filter((r) => ['fill', 'charge'].includes(r.type)) }, vid), 'text/csv;charset=utf-8', vids.length === 1 ? 'הקובץ הוכן להורדה' : `${vids.length} קבצים הוכנו להורדה`); });
    const exportTank = () => vids.forEach((vid) => { const v = db.vehicles.find((x) => x.id === vid); const rows = [['type', 'date', 'odometer', 'level', 'trip_km', 'mode']].concat(db.records.filter((r) => r.v === vid && ['odo', 'tank', 'trip'].includes(r.type)).map((r) => [r.type, r.date, r.odo ?? '', r.level ?? '', r.km ?? '', r.mode ?? ''])); dl(`tank-maleh-tank-${v.nick}-${stamp()}.csv`, '﻿' + rows.map((r) => r.join(',')).join('\n'), 'text/csv;charset=utf-8', 'הקובץ הוכן להורדה'); });
    const exportAll = () => vids.forEach((vid) => { const v = db.vehicles.find((x) => x.id === vid); dl(`tank-maleh-${v.nick}-${stamp()}.csv`, TM.toCSV(db, vid), 'text/csv;charset=utf-8', 'הקובץ הוכן להורדה · נפתח ב-Excel'); });
    const backup = () => dl(`tank-maleh-full-${stamp()}.json`, JSON.stringify({ kind: 'full-backup', version: 3, exportedAt: now().toISOString(), vehicles: db.vehicles, records: db.records, reminders: db.reminders, issues: db.issues, notifications: db.notifications, settings: db.settings, pendingWrites: db.writes.filter((w) => w.state !== 'synced') }, null, 2), 'application/json', 'הגיבוי הוכן: כל הרכבים, הרשומות, ההעדפות, התראות ושינויים ממתינים. תמונות אינן כלולות.');
    // activity across every vehicle, archive included
    const act = (() => { const recs = db.records; const fills = recs.filter((r) => r.type === 'fill' || r.type === 'charge'); const liters = fills.filter((r) => r.type === 'fill').reduce((a, r) => a + r.liters, 0); const spend = recs.reduce((a, r) => a + (r.type === 'fill' || r.type === 'charge' ? r.total : r.type === 'service' || r.type === 'expense' ? (r.cost == null ? 0 : r.refund ? -r.cost : r.cost) : 0), 0); const unknown = recs.filter((r) => (r.type === 'service' || r.type === 'expense') && r.cost == null).length; let km = 0; for (const v of db.vehicles) { const o = recs.filter((r) => r.v === v.id && r.odo).map((r) => r.odo); if (o.length > 1) km += Math.max(...o) - Math.min(...o); } const fuelSpend = fills.filter((r) => r.type === 'fill').reduce((a, r) => a + r.total, 0); return { fills: fills.length, liters, spend, unknown, km, avgPrice: liters ? fuelSpend / liters : null }; })();
    const active = db.vehicles.filter((v) => !v.archived).length, archived = db.vehicles.length - active;
    const since = db.account && db.account.since ? new Date(db.account.since) : null;
    const lastLogin = db.account && db.account.lastLogin ? new Date(db.account.lastLogin) : null;
    return html`<div className="pad noTabs" style=${{ gap: 22 }}>
      <${Top} onBack=${A.back} title="חשבון" />
      <div style=${{ display: 'flex', gap: 14, alignItems: 'center' }}>
        <span className="avatar" style=${{ width: 64, height: 64, fontSize: 26 }}>${db.user.name[0]}</span>
        <div style=${{ display: 'grid', gap: 2 }}><b style=${{ font: '400 34px/1 var(--display)' }}>${db.user.name}</b><span className="muted small">${db.user.email}</span>${db.user.admin && html`<span className="pill neutral" style=${{ marginTop: 4 }}><${Icon} n="shield" s=${14} />מנהל מערכת</span>`}</div>
      </div>
      <div className="facts" role="list" aria-label="פרטי החשבון">
        <div role="listitem"><span className="fl">שיטת התחברות</span><i className="ld"></i><span className="fv"><span style=${{ fontSize: 15 }}>חשבון ${db.account ? db.account.provider : 'Google'}</span></span></div>
        ${since && html`<div role="listitem"><span className="fl">חבר מאז</span><i className="ld"></i><span className="fv"><span style=${{ fontSize: 15 }}>${fmt.date(since)}</span></span></div>`}
        <div role="listitem"><span className="fl">התחברות קודמת</span><i className="ld"></i><span className="fv"><span style=${{ fontSize: 15 }}>${lastLogin ? `${fmt.rel(lastLogin)}, ${fmt.time(lastLogin)}` : 'זו ההתחברות הראשונה'}</span></span></div>
        <div role="listitem"><span className="fl">הרשאות</span><i className="ld"></i><span className="fv"><span style=${{ fontSize: 15 }}>${db.user.admin ? 'מנהל מערכת' : 'משתמש'}</span></span></div>
      </div>

      <section><div className="recent-h"><h2 className="group-h" style=${{ margin: 0 }}>הפעילות שלי · כל הרכבים, כולל הארכיון</h2><button className="chip" disabled=${refreshing} onClick=${() => { setRefreshing(true); setTimeout(() => { setRefreshing(false); A.toast('הסיכום רוענן'); }, 900); }}>${refreshing ? html`<${Spinner} />` : html`<${Icon} n="refresh" s=${14} />`}רענון</button></div>
        <div className="facts" role="list" style=${{ marginTop: 8 }}>
          <div role="listitem"><span className="fl">רכבים<small>${active} פעילים · ${archived} בארכיון</small></span><i className="ld"></i><span className="fv"><span className="n">${db.vehicles.length}</span></span></div>
          <div role="listitem"><span className="fl">תדלוקים וטעינות<small>${fmt.int(act.liters)} ליטר בסך הכול</small></span><i className="ld"></i><span className="fv"><span className="n">${act.fills}</span></span></div>
          <div role="listitem"><span className="fl">סה״כ הוצאה<small>רכישות דלק, טיפולים והוצאות פחות החזרים${act.unknown ? ` · ${act.unknown} רשומות עם עלות חסרה לא נכללו` : ''}${act.avgPrice ? ` · ממוצע דלק ${fmt.price(act.avgPrice)} לליטר` : ''}</small></span><i className="ld"></i><span className="fv"><span className="n">${fmt.money(act.spend)}</span></span></div>
          <div role="listitem"><span className="fl">ק״מ שתועדו<small>${act.km ? 'המרחק שתועד בכל הרכבים' : 'אין כיסוי קילומטראז׳ מספק'}</small></span><i className="ld"></i><span className="fv"><span className="n">${act.km ? fmt.int(act.km) : '—'}</span>${act.km ? html`<u>ק״מ</u>` : ''}</span></div>
        </div></section>

      <section><h2 className="group-h">דלק ומחיר</h2><div className="group">
        ${c.ev ? html`<${Row} icon="bolt" title="תעריפי טעינה" sub="בית, עמדה ציבורית, טעינה מהירה" value=${c.v.homeTariff ? html`בית <span className="n">${fmt.price(c.v.homeTariff)}</span>` : 'לא הוגדר'} onClick=${() => A.sheet('tariffs')} />`
        : html`<${Row} icon="tag" title="הנחה בתדלוק" sub="נשארת קבועה; המחיר מתעדכן אוטומטית" value=${discL} onClick=${() => A.sheet('discount')} />
        <${Row} icon="coin" title="מחיר בנזין 95" sub=${`מחיר מרבי מפוקח · ${TM.MONTHS[now().getMonth()]}`} value=${fmt.price(TM.officialFor(now()))} onClick=${() => A.sheet('price')} />
        ${['98', 'סולר'].map((fu) => { const r = db.adminPrices[TM.FUEL_KEY[fu]] || {}; return html`<${Row} key=${fu} icon="coin" title=${`מחירון ${TM.FUEL_TYPES.find((x) => x.id === fu).label}`} sub=${r.value != null ? `${r.source === 'manual' ? 'הוזן ידנית' : 'מחירון הרשת'} · עודכן ${fmt.rel(new Date(r.at))} · אין מחיר מפוקח` : 'אין מחיר עדכני לסוג הדלק הזה'} value=${r.value != null ? fmt.price(r.value) : '—'} />`; })}`}
      </div></section>

      <section><h2 className="group-h">תצוגה</h2><div className="group">
        <${Row} icon="tag" title="צבע" value=${TM.accentOf(s.accent).label} onClick=${() => A.sheet('accent')}>
          <span style=${{ width: 22, height: 22, borderRadius: '50%', background: 'var(--plate)', border: '1.5px solid #111', flex: 'none' }}></span>
        <//>
        <${Row} icon="moon" title="מראה" value=${themeL} onClick=${() => A.sheet('choice', { title: 'מראה', value: s.theme, options: [{ v: 'system', l: 'לפי המכשיר' }, { v: 'light', l: 'בהיר' }, { v: 'dark', l: 'כהה' }], onPick: (x) => A.setSetting('theme', x) })} />
        ${c.ev ? html`<${Row} icon="gauge" title="יחידת צריכה" value=${(s.evUnit || 'kwh100') === 'kwh100' ? 'kWh ל-100 ק״מ' : 'ק״מ ל-kWh'} onClick=${() => A.sheet('choice', { title: 'יחידת צריכה', value: s.evUnit || 'kwh100', options: [{ v: 'kwh100', l: 'kWh ל-100 ק״מ' }, { v: 'kmkwh', l: 'ק״מ ל-kWh' }], onPick: (x) => A.setSetting('evUnit', x) })} />`
        : html`<${Row} icon="gauge" title="יחידת צריכה" value=${unitL} onClick=${() => A.sheet('choice', { title: 'יחידת צריכה', value: s.unit, options: [{ v: 'kml', l: 'ק״מ לליטר' }, { v: 'l100', l: 'ליטר ל-100 ק״מ' }], onPick: (x) => A.setSetting('unit', x) })} />`}
        ${!c.ev && html`<${Row} icon="cam" title="כפתור תדלקתי פותח מצלמה" sub="צילום משאבה ואז לוח הקילומטרים. אפשר לחזור להזנה ידנית"><${Toggle} on=${s.quickScan} label="כפתור תדלקתי פותח מצלמה" onChange=${(x) => A.setSetting('quickScan', x)} /><//>`}
      </div></section>

      <section><h2 className="group-h">התראות</h2><div className="group">
        <${Row} icon="bell" title="כל ההתראות" sub=${db.notifications.filter((n) => !n.read && !n.archived).length ? `${db.notifications.filter((n) => !n.read && !n.archived).length} חדשות` : 'אין התראות חדשות'} onClick=${() => A.go('notifications')} />
        <${Row} title="העדפות התראות" sub="כיבוי משתיק הכול"><${Toggle} on=${s.notif.all !== false} label="כל ההתראות" onChange=${(x) => A.setSetting('notif', { ...s.notif, all: x })} /><//>
        ${s.notif.all !== false && html`<${Row} title="טסט, ביטוח וטיפולים" sub="חודש לפני, ושוב שבוע לפני"><${Toggle} on=${s.notif.service} label="תזכורות טיפול" onChange=${(x) => A.setSetting('notif', { ...s.notif, service: x })} /><//>
        <${Row} title="שינוי במחיר הדלק" sub="בתחילת כל חודש, כשהמחיר המרבי מתעדכן"><${Toggle} on=${s.notif.price} label="שינוי מחיר" onChange=${(x) => A.setSetting('notif', { ...s.notif, price: x })} /><//>`}
      </div></section>

      <section><h2 className="group-h">השוואה לנהגים</h2><div className="group">
        <${Row} icon="users" title="שיתוף סיכום דלק להשוואה" sub=${html`דגם, שנה, סוג דלק, צריכה ומחיר ממוצע. <button className="linkbtn" onClick=${() => A.sheet('shareInfo', { kind: 'fuel' })}>מה משותף?</button>`}><${Toggle} on=${s.community} label="שיתוף השוואה" onChange=${(x) => { A.setSetting('community', x); A.toast(x ? 'ההשוואה הופעלה' : 'שיתוף הדלק כבוי. סיכומי הדלק יוסרו מהשרת אחרי אישור.'); }} /><//>
        <${Row} icon="coin" title="שיתוף סיכום עלות הרכב" sub=${html`נפרד משיתוף הדלק, כבוי כברירת מחדל. <button className="linkbtn" onClick=${() => A.sheet('shareInfo', { kind: 'cost' })}>מה משותף?</button>`}><${Toggle} on=${!!s.shareCost} label="שיתוף עלות" onChange=${(x) => { if (x && !c.tco.complete) { A.toast('סיכום עלות משותף רק כשהרישומים מלאים. השלימו את הפריטים החסרים ב"כמה הרכב עולה לך".'); return; } A.setSetting('shareCost', x); A.toast(x ? 'שיתוף העלות הופעל' : 'שיתוף העלות כבוי. סיכומי העלות יוסרו מהשרת אחרי אישור.'); }} /><//>
      </div></section>

      <section><h2 className="group-h">הנתונים שלי</h2>
        <div className="field" style=${{ marginBottom: 8 }}><span className="lbl">היקף הייצוא</span><${Seg} value=${scope} onChange=${setScope} options=${[{ v: 'active', l: `הרכב הפעיל · ${c.v.nick}` }, { v: 'all', l: 'כל הרכבים, כולל הארכיון' }]} /></div>
        <div className="group">
        <${Row} icon="download" title=${c.ev ? 'ייצוא טעינות' : 'ייצוא תדלוקים'} sub=${`CSV${vids.length > 1 ? ' נפרד לכל רכב' : ''} · נפתח ב-Excel`} onClick=${exportFills} chevron=${false} />
        <${Row} icon="gauge" title="ייצוא עדכוני מיכל ונסיעות" sub="סימוני מחוון, עדכוני ק״מ ונסיעות מתוכננות" onClick=${exportTank} chevron=${false} />
        <${Row} icon="doc" title="ייצוא ל-Excel" sub="כל הרשומות: תדלוקים, טיפולים והוצאות" onClick=${exportAll} chevron=${false} />
        <${Row} icon="briefcase" title="דוח חודשי לעסק" sub="PDF או Excel של חודש אחד, להגשה כהוצאה" onClick=${() => A.sheet('bizExport')} />
        <${Row} icon="cloud" title="גיבוי חשבון מלא" sub="כל הרכבים, הרשומות וההעדפות בקובץ אחד. תמונות אינן כלולות" onClick=${backup} chevron=${false} />
        <${Row} icon="upload" title="שחזור מגיבוי מלא" sub="מוסיף רשומות חסרות בלבד" onClick=${() => A.sheet('restore')} />
        <${Row} icon="upload" title="ייבוא נתונים" sub="CSV או Excel · גם יומנים ישנים" onClick=${() => A.go('import')} />
        <${Row} icon=${failed ? 'alert' : 'cloud'} title="שינויים שעוד לא עלו לענן" sub=${failed ? `${failed} דורשים בדיקה` : pending ? `${pending} ממתינים` : 'הכול מסונכרן'} value=${failed || pending ? html`<span className="n">${failed + pending}</span>` : null} onClick=${() => A.go('unsynced')} />
      </div></section>

      ${db.user.admin && html`<section><h2 className="group-h">ניהול</h2><div className="group">
        <${Row} icon="shield" title="לוח בקרה" sub="משתמשים, מחירי דלק ומשוב" onClick=${() => A.go('admin')} />
      </div></section>`}

      <section><h2 className="group-h">עוד</h2><div className="group">
        <${Row} icon="download" title=${s.installed ? 'האפליקציה מותקנת' : 'התקנת האפליקציה'} sub=${s.installed ? 'פועלת מהמסך הראשי, בלי דפדפן' : 'אייקון במסך הבית, פתיחה במסך מלא'} onClick=${() => A.sheet('install')} />
        <${Row} icon="chat" title="שליחת משוב" onClick=${() => A.go('feedback')} />
        <${Row} icon="share" title="שיתוף האפליקציה" sub="הקישור לעמוד הראשי ואינו כולל נתונים מהחשבון שלך" onClick=${() => { if (navigator.share) navigator.share({ title: 'טנק מלא', url: 'https://tank-malle.web.app' }).catch(() => {}); else if (navigator.clipboard) navigator.clipboard.writeText('https://tank-malle.web.app').then(() => A.toast('הקישור הועתק')).catch(() => A.toast('הקישור: tank-malle.web.app')); }} chevron=${false} />
        <${Row} icon="doc" title="תנאי שימוש" onClick=${() => A.go('legal', { doc: 'terms' })} />
        <${Row} icon="doc" title="מדיניות פרטיות" onClick=${() => A.go('legal', { doc: 'privacy' })} />
        <${Row} icon="out" title="התנתקות" onClick=${() => A.sheet('confirm', { title: 'להתנתק מהחשבון?', body: pending || failed ? `יש ${pending + failed} שינויים שעוד לא אושרו בשרת. הם נשמרים במכשיר הזה וזמינים לטיפול בהתחברות הבאה לאותו חשבון.` : 'הנתונים שבענן יחזרו בהתחברות הבאה. הנתונים המקומיים נשמרים במכשיר.', confirm: pending || failed ? 'התנתקות בכל זאת' : 'התנתקות', onConfirm: A.signOut })} chevron=${false} />
        <${Row} icon="trash" danger title="מחיקת החשבון" onClick=${() => A.sheet('deleteAccount')} chevron=${false} />
      </div></section>
      <p className="note" style=${{ textAlign: 'center' }}>טנק מלא · גרסה <span className="n">2.1</span> · בילד <span className="n">proto-v3</span>${pending || failed ? ' · שינויים מקומיים' : ''}</p>
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
    { t: 'כמה הרכב באמת עולה לך', b: 'דלק או חשמל, טיפולים, ביטוח, טסט ואגרה — סכום אחד בחודש, מחולק לקטגוריות. לא רק תדלוקים: כל ההוצאות של הרכב במקום אחד.' },
    { t: 'כל רישום ב-15 שניות', b: 'תדלוק: סכום וק״מ. טעינה: אחוז לפני ואחרי. טיפול או הוצאה: סכום ותאריך. התאריך, התחנה והמחיר כבר ממולאים.' },
    { t: 'צריכה אמיתית, לא הבטחות', b: 'אחרי כל טנק מלא (או טעינה) תדעו כמה נסעתם על ליטר או kWh, מה זה עולה לק״מ, ואיך זה ביחס לרגיל שלכם ולנהגים עם אותו רכב.' },
    { t: 'שום דבר לא נופל בין הכיסאות', b: 'טסט, ביטוח חובה ומקיף, טיפול תקופתי, תקלה שפתחתם — תזכורות לפי תאריך או קילומטראז׳, ותחזית מתי לתדלק לפני שהמחוון מתקרב לאדום.' },
  ];
  function Onboard({ A }) {
    const [i, setI] = useState(0);
    const s = SLIDES[i];
    const demoParts = [['דלק', 1180, 'var(--c-fuel)'], ['ביטוח', 263, 'var(--c-ins1)'], ['טיפולים', 175, 'var(--c-service)'], ['טסט ואגרה', 118, 'var(--c-test)'], ['חניה ושאר', 41, 'var(--c-other)']];
    const demoTotal = demoParts.reduce((s, p) => s + p[1], 0);
    const art = [
      html`<div className="tco" style=${{ pointerEvents: 'none' }}><span className="lbl">הרכב עולה לך</span><div className="tco-num"><span className="disp n" style=${{ fontSize: 64 }}>${fmt.money(demoTotal)}</span><span className="tco-unit">בחודש</span></div><div className="tco-bar" aria-hidden="true">${demoParts.map((p) => html`<i key=${p[0]} style=${{ flex: p[1] / demoTotal, background: p[2] }}></i>`)}</div><div className="tco-legend">${demoParts.map((p) => html`<span key=${p[0]}><i style=${{ background: p[2] }}></i>${p[0]} <b className="n">${fmt.money(p[1])}</b></span>`)}</div></div>`,
      html`<div style=${{ display: 'grid', gap: 10 }}><div className="pump" style=${{ padding: '4px 16px' }}><div className="prow"><label>סכום</label><div className="pv"><span className="u">₪</span><span className="n" style=${{ font: '600 32px var(--mono)' }}>218</span></div></div><div className="prow"><label>קילומטראז׳</label><div className="pv"><span className="n" style=${{ font: '600 32px var(--mono)' }}>170,344</span></div></div></div><div className="chips"><span className="chip"><${Icon} n="pump" s=${16} />תדלוק</span><span className="chip"><${Icon} n="bolt" s=${16} />טעינה</span><span className="chip"><${Icon} n="wrench" s=${16} />טיפול</span><span className="chip"><${Icon} n="coin" s=${16} />הוצאה</span></div></div>`,
      html`<div style=${{ display: 'grid', gap: 6 }}><span className="lbl">צריכה בתדלוק האחרון</span><span className="disp n" style=${{ fontSize: 110 }}>12.8</span><span className="pill better">5% פחות דלק לק״מ מהרגיל</span><span className="muted small">68 אג׳ לק״מ · 3% פחות מנהגים עם אותו דגם</span></div>`,
      html`<div style=${{ display: 'grid', gap: 10, pointerEvents: 'none' }}><div style=${{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 14px', border: '1px solid var(--ln)', borderRadius: 'var(--r-lg)', background: 'var(--sf)' }}><span className="ri"><${Icon} n="doc" /></span><span><b style=${{ display: 'block' }}>הטסט בעוד 22 ימים</b><small className="muted">כדאי לקבוע תור למכון הרישוי.</small></span></div><div className="next" style=${{ padding: '14px 16px' }}><span className="lbl">התדלוק הבא</span><div className="disp when" style=${{ fontSize: 40 }}>בעוד <span>4</span> ימים</div><${UI.Ticks} level=${0.45} habit=${0.3} /></div></div>`,
    ][i];
    return html`<div className="pad noTabs" style=${{ gap: 22 }}>
      <div className="top"><div className="steps" style=${{ flex: 1 }}>${SLIDES.map((_, j) => html`<i key=${j} className=${j <= i ? 'on' : ''}></i>`)}</div><button className="link" onClick=${() => A.replace('signin')}>דילוג</button></div>
      <div className="slide-art home">${art}</div>
      <h1 className="h1" style=${{ fontSize: 52 }}>${s.t}</h1>
      <p className="muted" style=${{ fontSize: 16.5 }}>${s.b}</p>
      <div className="bottomBar"><button className="btn" onClick=${() => (i < SLIDES.length - 1 ? setI(i + 1) : A.replace('signin'))}>${i < SLIDES.length - 1 ? 'הבא' : 'מתחילים'}</button></div>
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
      <h1 className="h1" style=${{ fontSize: 72 }}>כל מה שהרכב עולה. במקום אחד.</h1>
      <p className="muted" style=${{ fontSize: 17 }}>דלק או חשמל, טיפולים, ביטוח וטסט; צריכה אמיתית ותזכורות. לרכב פרטי ולרכב של העסק, גם בלי קליטה.</p>
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
    const [cat, setCat] = useState({ make: null, model: null });
    const [cq, setCq] = useState('');
    const ok = plate.length === 7 || plate.length === 8;
    const press = (k) => setPlate((s) => (k === 'del' ? s.slice(0, -1) : k === 'clr' ? '' : s.length < 8 ? s + k : s));
    useEffect(() => {
      if (step !== 1) return;
      const h = (e) => { if (/^\d$/.test(e.key)) press(e.key); if (e.key === 'Backspace') press('del'); };
      window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
    }, [step]);
    const find = () => { setBusy(true); setTimeout(() => { setBusy(false); setCar({ ...lookupPlate(plate) }); setStep(2); }, 1000); };
    const finish = () => {
      const ev = car.fuel === 'חשמל';
      const v = { id: uid(), plate, ...car, powertrain: ev ? 'ev' : null, battery: ev ? (car.battery || { kwh: Number(extra.tank) || 60, wltp: Number(extra.mfr) || null }) : null, homeTariff: ev ? 0.58 : null, nick: extra.nick.trim() || `${car.make} ${car.model}`, tank: Number(extra.tank) || car.tank, mfr: Number(extra.mfr) || car.mfr, archived: false };
      if (ev) v.mfr = v.battery && v.battery.wltp && v.battery.kwh ? v.battery.wltp / v.battery.kwh : null;
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
            ${!cat.make ? html`<div className="field"><label htmlFor="w-cq">בחירת יצרן</label><input id="w-cq" className="inp" placeholder="חיפוש יצרן…" value=${cq} onChange=${(e) => setCq(e.target.value)} />
                <div className="chips" style=${{ marginTop: 8 }}>${Object.keys(TM.CATALOG).filter((m) => !cq || m.includes(cq)).map((m) => html`<button key=${m} className="chip" onClick=${() => { setCat({ make: m, model: null }); setCq(''); setCar({ ...car, make: m }); }}>${m}</button>`)}${cq && !Object.keys(TM.CATALOG).some((m) => m.includes(cq)) && html`<button className="chip dash" onClick=${() => { setCat({ make: cq, model: '__free' }); setCar({ ...car, make: cq }); }}>אחר: ${cq}</button>`}</div></div>`
            : cat.model == null ? html`<div className="field"><label>בחירת דגם · ${cat.make} <button className="linkbtn" onClick=${() => setCat({ make: null, model: null })}>שינוי</button></label>
                <div className="chips">${Object.keys(TM.CATALOG[cat.make] || {}).map((m) => html`<button key=${m} className="chip" onClick=${() => { const yrs = TM.CATALOG[cat.make][m]; setCat({ make: cat.make, model: m }); setCar({ ...car, model: m, year: yrs[1] }); }}>${m}</button>`)}<button className="chip dash" onClick=${() => setCat({ make: cat.make, model: '__free' })}>דגם אחר</button></div>
                <span className="note">רשימת הדגמים לפי מאגר משרד התחבורה. לא נמצא? אפשר להזין ידנית.</span></div>`
            : html`<div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="field"><label htmlFor="w-make">יצרן</label><input id="w-make" className="inp" value=${car.make} onChange=${(e) => setCar({ ...car, make: e.target.value })} /></div>
              <div className="field"><label htmlFor="w-model">דגם</label><input id="w-model" className="inp" value=${car.model} onChange=${(e) => setCar({ ...car, model: e.target.value })} /></div>
            </div>
            <div className="field"><label htmlFor="w-year">שנת ייצור</label>${cat.model !== '__free' && TM.CATALOG[cat.make] && TM.CATALOG[cat.make][cat.model] ? html`<div className="scrollx">${(() => { const [a, b] = TM.CATALOG[cat.make][cat.model]; const out = []; for (let y = b; y >= a; y--) out.push(y); return out; })().map((y) => html`<button key=${y} className=${'chip n' + (car.year === y ? ' on' : '')} onClick=${() => setCar({ ...car, year: y })}>${y}</button>`)}</div>` : html`<${NumInput} id="w-year" className="inp n" decimals=${0} value=${String(car.year)} onChange=${(x) => setCar({ ...car, year: Number(x) })} />`}</div>`}
          </div>`
          : html`<div className="group">
            <${Row} title="יצרן" value=${car.make} /><${Row} title="דגם" value=${`${car.model}${car.trim ? ` · ${car.trim}` : ''}`} /><${Row} title="שנת ייצור" value=${html`<span className="n">${car.year}</span>`} />
            <${Row} title="הנעה" value=${car.fuel === 'חשמל' ? 'חשמלי' : TM.fuelLabel(car)} />
            ${car.fuel === 'חשמל' ? html`<${Row} title="קיבולת סוללה" sub="במקום נפח מנוע — ממאגר משרד התחבורה" value=${car.battery ? html`<span className="n">${car.battery.kwh}</span> kWh` : 'לא תועד'} /><${Row} title="טווח יצרן" sub="WLTP" value=${car.battery && car.battery.wltp ? html`<span className="n">${car.battery.wltp}</span> ק״מ` : 'לא תועד'} />${car.motorKw && html`<${Row} title="הספק מנוע" value=${html`<span className="n">${car.motorKw}</span> kW`} />`}`
            : html`${car.engineCc && html`<${Row} title="נפח מנוע" value=${html`<span className="n">${fmt.int(car.engineCc)}</span> סמ״ק`} />`}`}
          </div>
          ${car.fuel === 'חשמל' && html`<p className="note">ברכב חשמלי המאגר מחזיר קיבולת סוללה והספק במקום נפח מנוע. נשתמש בהם לחישוב הצריכה (kWh ל-100 ק״מ) ולתחזית הטעינה.</p>`}`}
        ${edit && html`<div className="field"><span className="lbl">הנעה</span><${Seg} value=${car.fuel} onChange=${(x) => setCar({ ...car, fuel: x, battery: x === 'חשמל' ? car.battery || { kwh: 60, wltp: null } : null })} options=${[{ v: '95', l: '95' }, { v: '98', l: '98' }, { v: 'סולר', l: 'סולר' }, { v: 'חשמל', l: 'חשמלי' }]} /></div>`}
        <div className="bottomBar"><button className="btn" disabled=${!car.make || !car.model || (edit && cat.model == null)} onClick=${() => setStep(3)}>${edit ? 'המשך' : 'כן, זה הרכב שלי'}</button>${!edit && html`<button className="link" onClick=${() => { setEdit(true); setCat({ make: car.make, model: car.model }); }}>תיקון פרטים</button>`}</div>`}
      ${step === 3 && html`
        <h1 className="h1" style=${{ fontSize: 58 }}>עוד שני פרטים</h1>
        <p className="muted">לא חובה. אפשר להשלים אחר כך בפרטי הרכב.${car.fuel !== 'חשמל' && (car.tank || car.mfr) ? ` ההערכות: נפח מיכל${car.tank ? ` כ-${car.tank} ל׳ לפי סוג הרכב` : ''}${car.mfr ? `, צריכת ייחוס ${car.mfr} ק״מ/ל׳ מנתוני CO₂ (תקינה אירופאית)` : ''}.` : car.fuel === 'חשמל' && car.battery ? ` מפרט יצרן: סוללה ${car.battery.kwh} kWh, טווח WLTP ${car.battery.wltp} ק״מ.` : ''}</p>
        <div className="field"><label htmlFor="w-nick">איך קוראים לרכב?</label><input id="w-nick" className="inp" placeholder=${`${car.make} ${car.model}`} value=${extra.nick} onChange=${(e) => setExtra({ ...extra, nick: e.target.value })} /></div>
        <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="field"><label htmlFor="w-tank">${car.fuel === 'חשמל' ? 'סוללה' : 'נפח מיכל'}</label><div className="inp-wrap"><${NumInput} id="w-tank" className="inp n" decimals=${0} placeholder=${String(car.battery ? car.battery.kwh : car.tank)} value=${extra.tank} onChange=${(x) => setExtra({ ...extra, tank: x })} /><span className="unit">${car.fuel === 'חשמל' ? 'kWh' : 'ל׳'}</span></div></div>
          <div className="field"><label htmlFor="w-mfr">${car.fuel === 'חשמל' ? 'טווח יצרן' : 'נתון יצרן'}</label><div className="inp-wrap"><${NumInput} id="w-mfr" className="inp n" decimals=${car.fuel === 'חשמל' ? 0 : 1} placeholder=${car.fuel === 'חשמל' ? (car.battery ? String(car.battery.wltp) : '—') : car.mfr ? String(car.mfr) : '—'} value=${extra.mfr} onChange=${(x) => setExtra({ ...extra, mfr: x })} /><span className="unit">${car.fuel === 'חשמל' ? 'ק״מ' : 'ק״מ/ל׳'}</span></div></div>
        </div>
        <div className="bottomBar"><button className="btn" onClick=${finish}>שמירת הרכב</button><button className="link" onClick=${finish}>אשלים אחר כך</button></div>`}
    </div>`;
  }

  window.S2 = { Vehicle, VehicleEdit, Vehicles, ServiceForm, ExpenseForm, Account, Notifications, Feedback, Import, Unsynced, Legal, Onboard, SignIn, Wizard, reminderDue };
})();
