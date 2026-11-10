/* טנק מלא · prototype — electric vehicles: charge form, charging places, tariffs */
(function () {
  'use strict';
  const { html, Icon, consStr, consUnit, consUnitShort, cons, Sheet, Seg, Row, Ticks, NumInput, Toggle, useState, useEffect, useRef } = UI;
  const { fmt, now, isoLocal, uid, CHARGE_PLACES, chargePlace, placeRate, evaluateCharge, odoBounds, mkey } = TM;
  const pct = (x) => Math.round(x) + '%';

  /* ---------- SoC picker: 20 ticks, 5% each, with a big readout ---------- */
  function SocPick({ label, value, onChange, hint }) {
    return html`<div className="soc">
      <div className="soc-h"><span className="lbl">${label}</span><b className="n">${value == null ? '—' : pct(value)}</b></div>
      <${Ticks} level=${value == null ? null : value / 100} onPick=${(x) => onChange(Math.round(x * 100))} />
      <div className="gk"><span>0%</span><span>${hint || ''}</span><span>100%</span></div>
    </div>`;
  }

  /* ---------- "טענתי" form ---------- */
  function ChargeForm({ db, c, A, p }) {
    const v = c.v;
    const editing = p.id ? db.records.find((r) => r.id === p.id) : null;
    const lastCharge = c.fills[c.fills.length - 1] || null;
    const guessFrom = c.level != null ? Math.round((c.level * 100) / 5) * 5 : null;
    const [f, setF] = useState(() => editing ? {
      where: editing.where, station: editing.station || '', socFrom: editing.socFrom, socTo: editing.socTo, kwh: String(editing.kwh), total: String(editing.total), price: String(editing.pricePerKwh),
      typed: { kwh: true, total: true, price: true }, odo: String(editing.odo), date: editing.date, note: editing.note || '', open: false,
    } : {
      where: 'home', station: '', socFrom: guessFrom, socTo: lastCharge && lastCharge.where === 'home' ? lastCharge.socTo : 80, kwh: '', total: '', price: fmt.dec(placeRate(v, 'home'), 2),
      typed: { kwh: false, total: false, price: false }, odo: '', date: isoLocal(now()), note: '', open: false,
    });
    const [tried, setTried] = useState(false);
    const set = (k, x) => setF((s) => ({ ...s, [k]: x }));
    const num = (x) => (x === '' || x == null || isNaN(Number(x)) ? null : Number(x));
    const setWhere = (id) => setF((s) => ({ ...s, where: id, price: s.typed.price ? s.price : fmt.dec(placeRate(v, id), 2), socTo: id === 'dc' && !editing ? Math.max(s.socTo || 0, 80) : s.socTo }));

    // energy: from the two SoC readings unless the user typed kWh
    const cap = c.cap;
    const socOk = f.socFrom != null && f.socTo != null && f.socTo > f.socFrom;
    const kwhAuto = socOk ? ((f.socTo - f.socFrom) / 100) * cap * 1.06 : null;
    const kwh = f.typed.kwh ? num(f.kwh) : kwhAuto;
    const price = num(f.price);
    const total = f.typed.total ? num(f.total) : kwh != null && price != null ? kwh * price : null;
    const derivedPrice = f.typed.total && f.typed.kwh && !f.typed.price && num(f.total) && num(f.kwh) ? num(f.total) / num(f.kwh) : null;
    const effPrice = derivedPrice ?? price;

    const odo = num(f.odo);
    const bounds = odoBounds(db, v.id, f.date, editing ? editing.id : null);
    let odoErr = null;
    if (odo != null) {
      if (bounds.lo != null && odo <= bounds.lo) odoErr = bounds.hi != null ? `הזינו בין ${fmt.int(bounds.lo + 1)} ל-${fmt.int(bounds.hi - 1)}` : `הקילומטראז׳ האחרון היה ${fmt.int(bounds.lo)}`;
      else if (bounds.hi != null && odo >= bounds.hi) odoErr = `הזינו בין ${fmt.int((bounds.lo || 0) + 1)} ל-${fmt.int(bounds.hi - 1)}`;
    }
    const socErr = f.socFrom != null && f.socTo != null && f.socTo <= f.socFrom ? 'האחוז אחרי הטעינה צריך להיות גבוה מלפני' : null;
    const missing = { soc: !socOk, odo: odo == null, kwh: kwh == null };
    const valid = socOk && !missing.odo && !odoErr && kwh != null && kwh > 0;
    const draft = valid ? { id: editing ? editing.id : '__draft', v: v.id, type: 'charge', date: f.date, odo, kwh, socFrom: f.socFrom, socTo: f.socTo, where: f.where, pricePerKwh: effPrice || 0, total: total || 0 } : null;
    const ev = draft ? evaluateCharge(db, v.id, draft) : null;
    const unit = (db.settings.evUnit || 'kwh100');
    const warns = [];
    if (kwh != null && kwh > cap * 1.15) warns.push(`${fmt.dec(kwh)} kWh זה יותר מהסוללה (${cap} kWh). אפשר לשמור בכל זאת.`);
    if (ev && ev.seg && (ev.seg.kmpl < 2.5 || ev.seg.kmpl > 12)) warns.push(`${consStr(ev.seg.kmpl, unit)} ${consUnitShort(unit)} נראה לא סביר. כדאי לבדוק את האחוזים או את הקילומטראז׳.`);
    if (f.where === 'home' && !v.homeTariff) warns.push('לא הוגדר תעריף חשמל בבית. משתמשים ב-₪0.58 לשעה. אפשר לשנות בהגדרות הרכב.');
    const isPublic = f.where === 'ac' || f.where === 'dc';
    const dt = new Date(f.date);
    const isToday = new Date(now()).toDateString() === dt.toDateString();

    const save = () => {
      setTried(true);
      if (!valid) return;
      const rec = { ...(editing || {}), id: editing ? editing.id : uid(), v: v.id, type: 'charge', date: f.date, odo, kwh: Math.round(kwh * 10) / 10, socFrom: f.socFrom, socTo: f.socTo, where: f.where, station: isPublic ? f.station : '', pricePerKwh: Math.round((effPrice || 0) * 1000) / 1000, total: Math.round((total || 0) * 100) / 100, note: f.note };
      A.upsert(rec, editing ? 'עריכת טעינה' : 'טעינה');
      if (editing) { A.back(); A.toast('השינויים נשמרו. כל החישובים עודכנו.'); }
      else A.replace('saved', { id: rec.id });
    };

    return html`<div className="pad noTabs" style=${{ gap: 18 }}>
      <div className="top">
        <button className="ib" aria-label="סגירה" onClick=${A.back}><${Icon} n="x" /></button>
        <span className="ttl" style=${{ fontSize: 40 }}>${editing ? 'עריכת טעינה' : 'טעינה'}</span>
        <button className="chip" onClick=${() => set('open', true)}><${Icon} n="clock" />${isToday ? 'היום' : fmt.dayMon(dt)}, ${fmt.time(dt)}</button>
      </div>

      <div className="field"><span className="lbl">איפה טענת?</span>
        <div className="places">${CHARGE_PLACES.map((pl) => html`<button key=${pl.id} className=${'place' + (f.where === pl.id ? ' on' : '')} onClick=${() => setWhere(pl.id)}>
          <span className="pdot" style=${{ background: pl.color }}></span><b>${pl.short}</b><small>${pl.id === 'home' ? `₪${fmt.dec(placeRate(v, 'home'), 2)} ל-kWh` : pl.id === 'work' ? 'חינם' : `כ-₪${fmt.dec(pl.rate, 2)} ל-kWh`}</small>
        </button>`)}</div>
        ${isPublic && html`<input className="inp" style=${{ marginTop: 8 }} placeholder="שם העמדה או המקום (לא חובה)" value=${f.station} onChange=${(e) => set('station', e.target.value)} />`}
      </div>

      <div className="card" style=${{ gap: 16 }}>
        <${SocPick} label="סוללה לפני" value=${f.socFrom} onChange=${(x) => set('socFrom', x)} hint=${f.socFrom == null && guessFrom != null ? `לפי ההערכה שלנו: כ-${guessFrom}%` : ''} />
        <${SocPick} label="סוללה אחרי" value=${f.socTo} onChange=${(x) => set('socTo', x)} hint=${f.socTo === 80 ? 'עד 80% טוב לסוללה' : ''} />
        ${socErr && html`<span className="err">${socErr}</span>`}
        ${tried && missing.soc && !socErr && html`<span className="err">סמנו אחוז לפני ואחרי</span>`}
      </div>

      <div className="pump" role="group" aria-label="נתוני הטעינה">
        <div className="prow">
          <label htmlFor="c-kwh">kWh</label>
          <div className="pv"><${NumInput} id="c-kwh" decimals=${1} placeholder=${kwhAuto != null ? fmt.dec(kwhAuto) : '0.0'} value=${f.typed.kwh ? f.kwh : kwhAuto != null ? fmt.dec(kwhAuto) : ''} onChange=${(x) => setF((s) => ({ ...s, kwh: x, typed: { ...s.typed, kwh: x !== '' } }))} /><span className="u">kWh</span></div>
          <span className=${'s' + (f.typed.kwh ? '' : ' auto')}>${f.typed.kwh ? 'מה שהעמדה הראתה' : kwhAuto != null ? `חושב מהאחוזים (${pct(f.socTo - f.socFrom)} מתוך ${cap} kWh, כולל הפסדי טעינה)` : 'יחושב מהאחוזים'}</span>
        </div>
        <div className="prow">
          <label htmlFor="c-price">מחיר ל-kWh</label>
          <div className="pv"><span className="u">₪</span><${NumInput} id="c-price" decimals=${3} value=${derivedPrice != null ? fmt.dec(derivedPrice, 2) : f.price} onChange=${(x) => setF((s) => ({ ...s, price: x, typed: { ...s.typed, price: x !== '' } }))} style=${{ fontSize: 24 }} /></div>
          <span className="s">${derivedPrice != null ? 'חושב מהסכום וה-kWh' : f.where === 'home' ? 'התעריף שלך בבית' : f.where === 'work' ? 'חינם בעבודה' : 'מחיר מקובל, אפשר לשנות'}</span>
        </div>
        <div className="prow">
          <label htmlFor="c-total">סכום</label>
          <div className="pv"><span className="u">₪</span><${NumInput} id="c-total" placeholder="0.00" value=${f.typed.total ? f.total : total != null ? fmt.dec(total, 2) : ''} onChange=${(x) => setF((s) => ({ ...s, total: x, typed: { ...s.typed, total: x !== '' } }))} /></div>
          <span className=${'s' + (f.typed.total ? '' : ' auto')}>${f.typed.total ? 'מה ששילמת' : f.where === 'home' ? 'הערכה לפי התעריף, יופיע בחשבון החשמל' : 'מחושב, הקלידו את הסכום מהחשבונית'}</span>
        </div>
        <div className="prow">
          <label htmlFor="c-odo">קילומטראז׳</label>
          <div className="pv"><${NumInput} id="c-odo" decimals=${0} placeholder=${bounds.lo ? fmt.int(bounds.lo + 100).replace(/,/g, '') : '0'} value=${f.odo} onChange=${(x) => set('odo', x)} /><span className="u">ק״מ</span></div>
          ${odoErr ? html`<span className="s err">${odoErr}</span>` : tried && missing.odo ? html`<span className="s err">חסר קילומטראז׳</span>` : odo != null && bounds.lo ? html`<span className="s">+${fmt.int(odo - bounds.lo)} ק״מ מהטעינה הקודמת</span>` : bounds.lo ? html`<span className="s">אחרון: ${fmt.int(bounds.lo)}</span>` : null}
        </div>
      </div>

      <div className="preview" aria-live="polite">
        ${!draft ? html`<span>סמנו אחוזים וק״מ ונראה מה יצא</span>`
          : ev.seg ? html`<b className="n">${consStr(ev.seg.kmpl, unit)}</b><span>${consUnit(unit)} מאז הטעינה הקודמת · <span className="n">${Math.round((ev.seg.cost / ev.seg.km) * 100)}</span> אג׳ לק״מ</span>`
          : html`<span>טעינה ראשונה: מכאן נתחיל למדוד</span>`}
      </div>
      ${warns.map((w, i) => html`<div key=${i} className="warnbox"><${Icon} n="alert" />${w}</div>`)}

      <button className=${'disclosure' + (f.open ? ' open' : '')} aria-expanded=${f.open} onClick=${() => set('open', !f.open)}><span>עוד פרטים<small>תאריך, הערה</small></span><${Icon} n="down" /></button>
      ${f.open && html`<div style=${{ display: 'grid', gap: 18 }}>
        <div className="field"><label htmlFor="c-date">מתי</label><input id="c-date" className="inp n" type="datetime-local" value=${f.date} max=${isoLocal(now())} onChange=${(e) => set('date', e.target.value)} /></div>
        <div className="field"><label htmlFor="c-note">הערה</label><textarea id="c-note" className="inp" placeholder="למשל: טעינה לפני נסיעה לצפון" value=${f.note} onChange=${(e) => set('note', e.target.value)}></textarea></div>
      </div>`}
      ${editing && html`<button className="btn danger sm" onClick=${() => A.confirmDelete(editing.id, true)}><${Icon} n="trash" />מחיקת הטעינה</button>`}
      <div className="bottomBar"><button className="btn" onClick=${save}>${editing ? 'שמירת שינויים' : 'שמירה'}</button></div>
    </div>`;
  }

  /* ---------- Insights › "איפה אתה טוען" ---------- */
  function PlacesCard({ db, c, A, fills }) {
    const cap = c.cap;
    const by = {};
    for (const f of fills) { const s = (by[f.where] = by[f.where] || { id: f.where, kwh: 0, cost: 0, n: 0 }); s.kwh += f.kwh; s.cost += f.total; s.n++; }
    const rows = CHARGE_PLACES.map((p) => ({ ...p, ...(by[p.id] || { kwh: 0, cost: 0, n: 0 }) })).filter((r) => r.n > 0);
    const totKwh = rows.reduce((s, r) => s + r.kwh, 0) || 1;
    const totCost = rows.reduce((s, r) => s + r.cost, 0);
    const home = rows.filter((r) => r.id === 'home' || r.id === 'work').reduce((s, r) => s + r.kwh, 0) / totKwh;
    const avgPublic = 1.6;
    const ifAllPublic = totKwh * avgPublic;
    const months = Math.max(1, new Set(fills.map((f) => mkey(new Date(f.date)))).size);
    return html`<article className="card">
      <span className="lbl">איפה אתה טוען</span>
      <h4>${Math.round(home * 100)}% מהחשמל שלך מהבית</h4>
      <div className="placebar" aria-hidden="true">${rows.map((r) => html`<i key=${r.id} style=${{ flex: r.kwh / totKwh, background: r.color }}></i>`)}</div>
      <div className="group">${rows.map((r) => html`<div key=${r.id} className="row" style=${{ minHeight: 48 }}>
        <span className="pdot" style=${{ background: r.color, width: 12, height: 12, borderRadius: 4 }}></span>
        <span className="grow"><b>${r.label}</b><small>${r.n} טעינות · <span className="n">${fmt.int(r.kwh)}</span> kWh</small></span>
        <span className="val" style=${{ color: 'var(--tx)', fontWeight: 600 }}><span className="n">${fmt.price(r.kwh ? r.cost / r.kwh : 0)}</span> ל-kWh</span>
      </div>`)}</div>
      <p className="small muted">ממוצע משוקלל: <b className="n">${fmt.price(totCost / totKwh)}</b> ל-kWh. אילו הכל היה בעמדות ציבוריות זה היה עולה בערך <b className="n">${fmt.money((ifAllPublic - totCost) / months)}</b> יותר בחודש.</p>
    </article>`;
  }

  /* ---------- sheets ---------- */
  function Tariffs({ db, c, A }) {
    const v = c.v;
    const [val, setVal] = useState(v.homeTariff ? String(v.homeTariff) : '');
    const n = Number(val);
    return html`<${Sheet} title="תעריפי טעינה" onClose=${A.close}>
      <p className="muted small">בחשמל אין מחיר אחד: הבית, עמדה ציבורית וטעינה מהירה נבדלים פי 3–4. התעריף בבית הוא מה שחברת החשמל גובה ממך ל-kWh.</p>
      <div className="field"><label htmlFor="t-home">התעריף שלך בבית</label><div className="inp-wrap"><${NumInput} id="t-home" className="inp n" decimals=${3} placeholder="0.58" value=${val} onChange=${setVal} autoFocus /><span className="unit">₪ ל-kWh</span></div><span className="note">התעריף הביתי הרגיל כ-₪0.58. עם תעריף לילה (תעו״ז) הוא נמוך יותר בשעות הטעינה.</span></div>
      <div className="group">
        ${CHARGE_PLACES.filter((p) => p.id !== 'home').map((p) => html`<${Row} key=${p.id} title=${p.label} value=${p.rate === 0 ? 'חינם' : html`כ-<span className="n">${fmt.price(p.rate)}</span> ל-kWh`} />`)}
      </div>
      <button className="btn" disabled=${!(n > 0)} onClick=${() => { A.updateVehicle(v.id, { homeTariff: n }); A.close(); A.toast(`תעריף הבית נשמר: ${fmt.price(n)} ל-kWh`); }}>שמירה</button>
    <//>`;
  }

  function BatterySheet({ db, c, A }) {
    const [lvl, setLvl] = useState(c.level != null ? Math.round(c.level * 20) / 20 : null);
    const changed = lvl != null && (c.level == null || Math.abs(lvl - c.level) > 0.024);
    const dateTxt = (d) => (d == null ? '—' : d < 0.6 ? 'היום' : d < 1.6 ? 'מחר' : `בעוד ${Math.round(d)} ימים`);
    const unit = db.settings.evUnit || 'kwh100';
    return html`<${Sheet} title="מה יש בסוללה" onClose=${A.close}>
      <p className="muted small">${c.basis === 'obs' ? 'לפי האחוז שסימנת, פחות מה שנסעת מאז.' : c.lastFull ? `לפי ${c.lastFull.socTo}% בסוף הטעינה האחרונה, פחות כ-${fmt.int(Math.max(0, c.estOdo - c.lastFull.odo))} ק״מ שנסעת מאז.` : 'עוד אין טעינה עם אחוזים.'} רואים את האחוז במסך הרכב? הקישו עליו.</p>
      <div className="level">
        <${Ticks} level=${lvl} habit=${c.habit} onPick=${setLvl} />
        <div className="gk"><span>0%</span><span>${lvl != null ? pct(lvl * 100) : 'הקישו על המחוון'}</span><span>100%</span></div>
      </div>
      ${c.level != null && html`<div className="group">
        <${Row} title="מתי תחבר, לפי ההרגל שלך" sub=${c.habit != null ? `בדרך כלל אתה מחבר סביב ${pct(c.habit * 100)}${c.habitTo ? ` וטוען עד ${c.habitTo}%` : ''}` : 'עוד לומדים את ההרגלים שלך'} value=${dateTxt(c.daysToTarget)} />
        <${Row} title="טווח משוער" value=${html`<span className="n">${fmt.int(c.kmLeft)}</span> ק״מ`} />
        <${Row} title="עד הרזרבה (10%)" value=${dateTxt(Math.max(0, (c.level - c.reserve) * c.cap * c.effK / c.dailyKm))} />
      </div>`}
      <p className="note">לפי ${consStr(c.effK, unit)} ${consUnitShort(unit)} שאתה צורך בפועל, וכ-${fmt.int(c.dailyKm)} ק״מ ביום. טעינה יומיומית עד 80% שומרת על הסוללה; עד 100% רק לפני נסיעה ארוכה.</p>
      <button className="btn" disabled=${!changed} onClick=${() => { A.addRecord({ id: uid(), v: c.v.id, type: 'tank', date: isoLocal(now()), level: lvl, odo: Math.round(c.estOdo || 0) }, 'עדכון סוללה'); A.close(); A.toast('האחוז עודכן. התחזית חושבה מחדש.'); }}>עדכון האחוז</button>
    <//>`;
  }

  window.EV = { ChargeForm, PlacesCard, SocPick };
  Object.assign(window.SHEETS, { tariffs: Tariffs, battery: BatterySheet });
})();
