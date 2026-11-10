/* טנק מלא · prototype — parity with the live app: the sheets and screens the first prototype left out.
   Everything here follows the same rule as the rest: nothing derived is stored. */
(function () {
  'use strict';
  const { html, Icon, consStr, consUnit, consUnitShort, cons, Sheet, Seg, Row, Ticks, Toggle, Top, NumInput, Spinner, Badge, Bars, LineChart, Check, useState, useEffect, useRef } = UI;
  const { fmt, station, now, isoLocal, mkey, uid, DAY, REASONS, REMINDER_BASIS, REMINDER_SOURCE, ISSUE_STATUS, SYMPTOMS } = TM;
  const { pct } = S1;

  const download = (name, text, type, A, okMsg) => {
    try {
      const blob = new Blob([text], { type });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
      if (okMsg) A.toast(okMsg);
    } catch (e) { A.toast('ההורדה לא זמינה כאן.'); }
  };
  const dayIso = (d) => isoLocal(d).slice(0, 10);
  const daysFrom = (iso) => Math.round((new Date(iso + (iso.length === 10 ? 'T00:00' : '')) - new Date(dayIso(now()) + 'T00:00')) / DAY);
  const whenDay = (iso) => { const d = daysFrom(iso); return d === 0 ? 'היום' : d === 1 ? 'מחר' : d < 0 ? `לפני ${-d} ימים` : `בעוד ${d} ימים`; };

  /* ================= HOME · what the consumption figure rests on ================= */
  function Measure({ db, c, A }) {
    const m = c.measure, unit = UI.unitFor(db, c);
    return html`<${Sheet} title="מדידת הצריכה" onClose=${A.close}>
      <p className="muted small">${c.ev ? 'צריכה נמדדת בין שתי טעינות שבהן סימנת אחוז לפני ואחרי.' : 'צריכה נמדדת בין שני תדלוקים עד הסוף. התדלוק שפותח מקטע לא נספר בליטרים שלו.'}</p>
      <div className="facts" role="list">
        <div role="listitem"><span className="fl">${c.ev ? 'טעינות שנרשמו' : 'תדלוקים שנרשמו'}<small>${c.ev ? '' : `${m.full} מהם עד הסוף`}</small></span><i className="ld"></i><span className="fv"><span className="n">${m.fills}</span></span></div>
        <div role="listitem"><span className="fl">מקטעים שנמדדו<small>${m.restarts ? `${m.restarts} נקודות התחלה מחדש` : 'רצף אחד, בלי פספוסים'}</small></span><i className="ld"></i><span className="fv"><span className="n">${m.segments}</span></span></div>
        <div role="listitem"><span className="fl">מרחק שנרשם<small>בתוך המקטעים</small></span><i className="ld"></i><span className="fv"><span className="n">${fmt.int(m.km)}</span><u>ק״מ</u></span></div>
        <div role="listitem"><span className="fl">הממוצע שלך<small>לפי המרחק בכל מקטע שנמדד</small></span><i className="ld"></i><span className="fv"><span className="n">${consStr(c.avg, unit)}</span><u>${consUnitShort(unit)}</u></span></div>
        ${!c.ev && m.hasBaseline && html`<div role="listitem"><span className="fl">המקטע הפתוח<small>${m.pendingLiters > 0 ? `${fmt.dec(m.pendingLiters)} ליטרים ממתינים לחישוב` : 'נקודת ההתחלה נשמרה'}</small></span><i className="ld"></i><span className="fv"><span className="n">${m.pendingFills}</span><u>${m.pendingFills === 1 ? 'תדלוק' : 'תדלוקים'}</u></span></div>`}
      </div>
      <p className="note">${c.ev ? 'כל טעינה עם אחוזים סוגרת מקטע; טעינה בלי אחוזים נספרת בכסף אבל לא בצריכה.' : 'התדלוק הבא עד הסוף יסגור את המקטע. כל הליטרים שנוספו מאז התדלוק המלא הקודם ייכללו בו.'}</p>
    <//>`;
  }

  /* ================= HOME · tank preferences, planned trips, capacity ================= */
  function TankPref({ db, c, A }) {
    const pref = c.pref || {};
    const [reserve, setReserve] = useState(c.reserve);
    const [mode, setMode] = useState(pref.target != null ? 'manual' : 'auto');
    const [target, setTarget] = useState(pref.target != null ? pref.target : (c.learned || 0.3));
    const save = () => { A.updateVehicle(c.v.id, { pref: { ...pref, reserve, target: mode === 'manual' ? target : null } }); A.close(); A.toast('העדפות המיכל נשמרו'); };
    return html`<${Sheet} title="העדפות מיכל" onClose=${A.close}>
      <div className="field"><span className="lbl">רזרבה — מתי להתריע</span>
        <${Seg} value=${reserve} onChange=${setReserve} options=${[0.1, 0.15, 0.2, 0.25].map((v) => ({ v, l: pct(v) }))} />
        <span className="note">הרמה שממנה כדאי ${c.ev ? 'לטעון' : 'לתדלק'}. זו העדפה שלך, לא ${c.ev ? 'הרזרבה של היצרן' : 'נפח הרזרבה של היצרן או נורית הדלק'}.</span></div>
      <div className="field"><span className="lbl">מתי נוח ${c.ev ? 'לטעון' : 'לתדלק'}</span>
        <${Seg} value=${mode} onChange=${setMode} options=${[{ v: 'auto', l: 'נלמד מההרגלים' }, { v: 'manual', l: 'קביעה ידנית' }]} />
        ${mode === 'auto'
          ? html`<span className="note">${c.learned != null ? `עד עכשיו למדנו: בד״כ ${c.ev ? 'טוענים' : 'מתדלקים'} כשנשארים ${pct(c.learned)}.` : 'עוד לומדים. אחרי כמה רישומים נדע מתי אתם נוהגים לתדלק.'}</span>`
          : html`<div className="level" style=${{ marginTop: 8 }}><${Ticks} level=${target} onPick=${setTarget} /><div className="gk"><span>${c.ev ? '0%' : 'E'}</span><span>${pct(target)}</span><span>${c.ev ? '100%' : 'F'}</span></div></div>
            <span className="note">קביעה ידנית מחליפה את ההרגל שנלמד. אפשר לחזור ללמידה בכל רגע.</span>`}
      </div>
      <button className="btn" onClick=${save}>שמירה</button>
      <button className="btn line sm" onClick=${() => A.sheet('confirm', { title: 'לאפס את פרופיל ההרגלים?', body: 'הלמידה של הרגלי התדלוק תתחיל מחדש. התדלוקים, ההוצאות והצריכה נשארים כפי שהם.', confirm: 'איפוס', onConfirm: () => { A.updateVehicle(c.v.id, { pref: { ...pref, habitReset: isoLocal(now()) } }); A.toast('פרופיל ההרגלים אופס. התדלוקים נשארים.'); } })}>איפוס פרופיל ההרגלים</button>
    <//>`;
  }

  const TRIP_WHEN = [{ v: 0, l: 'היום' }, { v: 1, l: 'מחר' }, { v: 3, l: 'בעוד 3 ימים' }, { v: 7, l: 'בעוד שבוע' }];
  function Trip({ db, c, A, p }) {
    const existing = p.id ? db.records.find((r) => r.id === p.id) : null;
    const [when, setWhen] = useState(existing ? daysFrom(existing.date) : 1);
    const [custom, setCustom] = useState(existing && ![0, 1, 3, 7].includes(daysFrom(existing.date)) ? existing.date : '');
    const [km, setKm] = useState(existing ? String(existing.km) : '');
    const [mode, setMode] = useState(existing ? existing.mode : 'extra');
    const [margin, setMargin] = useState(existing && existing.margin ? String(existing.margin) : '');
    const [note, setNote] = useState(existing ? existing.note || '' : '');
    const date = custom || dayIso(new Date(now().getTime() + when * DAY));
    const kmN = Number(km) || 0;
    const canSave = kmN > 0;
    const save = () => {
      A.upsert({ ...(existing || { id: uid(), v: c.v.id, type: 'trip' }), date, km: kmN, mode, margin: Number(margin) || 0, note: note.trim() }, 'נסיעה מתוכננת');
      A.close(); A.toast('הנסיעה נשמרה. התחזית חושבה מחדש.');
    };
    return html`<${Sheet} title=${existing ? 'נסיעה מתוכננת' : 'יש לי נסיעה מתוכננת'} onClose=${A.close}>
      <div className="field"><span className="lbl">מתי</span><div className="chips">${TRIP_WHEN.map((o) => html`<button key=${o.v} className=${'chip' + (!custom && when === o.v ? ' on' : '')} onClick=${() => { setWhen(o.v); setCustom(''); }}>${o.l}</button>`)}<button className=${'chip' + (custom ? ' on' : '')} onClick=${() => setCustom(custom || dayIso(new Date(now().getTime() + 14 * DAY)))}>${custom ? fmt.dayMon(new Date(custom)) : 'תאריך אחר'}</button></div>
        ${custom && html`<input className="inp n" type="date" aria-label="תאריך הנסיעה" value=${custom} min=${dayIso(now())} onChange=${(e) => setCustom(e.target.value)} style=${{ marginTop: 8 }} />`}</div>
      <div className="field"><label htmlFor="tr-km">מרחק צפוי</label><div className="inp-wrap"><${NumInput} id="tr-km" className="inp n" decimals=${0} placeholder="200" value=${km} onChange=${setKm} autoFocus /><span className="unit">ק״מ</span></div></div>
      <div className="field"><span className="lbl">הנסיעה היא</span><${Seg} value=${mode} onChange=${setMode} options=${[{ v: 'extra', l: 'בנוסף לנהיגה הרגילה' }, { v: 'instead', l: 'במקום הנהיגה הרגילה' }]} /></div>
      <div className="field"><label htmlFor="tr-margin">מרווח ביטחון <span className="muted" style=${{ fontWeight: 400 }}>(לא חובה)</span></label><div className="inp-wrap"><${NumInput} id="tr-margin" className="inp n" decimals=${0} placeholder="30" value=${margin} onChange=${setMargin} /><span className="unit">ק״מ</span></div></div>
      <div className="field"><label htmlFor="tr-note">הערה</label><input id="tr-note" className="inp" placeholder="למשל: צפון" value=${note} onChange=${(e) => setNote(e.target.value)} /></div>
      <p className="note">הנסיעה משנה את התחזית בלבד. היא לא מתווספת לקילומטראז׳ או ל${c.ev ? 'חשמל' : 'דלק'} שנצרך.</p>
      <button className="btn" disabled=${!canSave} onClick=${save}>שמירה</button>
      ${existing && html`<button className="btn danger sm" onClick=${() => { A.removeRecord(existing.id, true); A.close(); A.toast('הנסיעה נמחקה'); }}><${Icon} n="trash" />מחיקת הנסיעה ב-${fmt.dayMon(new Date(existing.date))}</button>`}
    <//>`;
  }

  function Capacity({ db, c, A, p }) {
    const v = c.v;
    const sugg = p.suggest || v.tank;
    const [val, setVal] = useState(String(Math.round(sugg)));
    return html`<${Sheet} title="נפח המיכל" onClose=${A.close}>
      <p className="muted small">${p.suggest ? `לפי ${fmt.dec(p.liters)} ליטר שנכנסו כשהמיכל היה על ${pct(p.pre)}, נראה שהמיכל גדול מההערכה (${v.tank} ל׳).` : `נפח המיכל ${v.tankConfirmed ? 'אושר על ידך' : 'משוער לפי סוג הרכב'}. אישור שלו משפר את הערכת הדלק שנשאר.`}</p>
      <div className="pump"><div className="prow"><label htmlFor="cap-l">נפח המיכל</label><div className="pv"><${NumInput} id="cap-l" decimals=${0} value=${val} onChange=${setVal} autoFocus /><span className="u">ל׳</span></div><span className="s">${p.suggest ? `הערכה חדשה: כ-${Math.round(sugg)} ל׳` : `עכשיו: ${v.tank} ל׳ · ${v.tankConfirmed ? 'מאושר' : 'הערכה'}`}</span></div></div>
      <button className="btn" disabled=${!(Number(val) > 10)} onClick=${() => { A.updateVehicle(v.id, { tank: Number(val), tankConfirmed: true }); A.close(); A.toast('נפח המיכל אושר'); }}>${Number(val) === v.tank ? 'מאשר — זה נפח המיכל' : 'תיקון ואישור'}</button>
    <//>`;
  }

  /* ================= FILL-UP · receipt import (text or PDF) ================= */
  function parseReceipt(text) {
    const t = text.replace(/,/g, '');
    const num = (re) => { const m = t.match(re); return m ? Number(m[1]) : null; };
    const liters = num(/(\d{1,3}(?:\.\d{1,3})?)\s*(?:ל(?:יטר|׳|')|L\b|ltr)/i) || num(/(?:ליטר|כמות)\D{0,12}(\d{1,3}(?:\.\d{1,3})?)/i);
    const total = num(/(?:סה["״]?כ|לתשלום|total)\D{0,12}(\d{1,4}(?:\.\d{1,2})?)/i) || num(/(\d{1,4}(?:\.\d{1,2})?)\s*₪/) || num(/₪\s*(\d{1,4}(?:\.\d{1,2})?)/);
    const price = num(/(\d(?:\.\d{1,3})?)\s*(?:₪\s*)?(?:ל(?:ליטר|׳|'))/i) || num(/(?:מחיר)\D{0,10}(\d(?:\.\d{1,3})?)/i);
    const dm = t.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
    const date = dm ? `${dm[3].length === 2 ? '20' + dm[3] : dm[3]}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}` : null;
    const tm = t.match(/(\d{1,2}):(\d{2})/);
    const credit = /זיכוי|החזר/.test(t);
    return { liters, total, price, date, time: tm ? `${tm[1].padStart(2, '0')}:${tm[2]}` : null, credit };
  }
  const SAMPLE_RECEIPT = `דלק מסמיה · תחנה 1180\n03/11/26 18:42\nבנזין 95 — שירות עצמי\nכמות: 28.40 ליטר\nמחיר לליטר: 7.35\nסה"כ לתשלום: 208.74 ₪\nמס׳ מסמך 70031244`;
  function Receipt({ A, p }) {
    const [text, setText] = useState('');
    const [parsed, setParsed] = useState(null);
    const [checked, setChecked] = useState(false);
    const fileRef = useRef(null);
    const run = (t) => { setText(t); setParsed(parseReceipt(t)); setChecked(false); };
    const ok = parsed && parsed.liters && parsed.total && !parsed.credit;
    return html`<${Sheet} title="ייבוא קבלה" onClose=${A.close}>
      <p className="muted small">PDF עם טקסט, או טקסט שהעתקתם מהאפליקציה של התחנה. החילוץ כללי וניסיוני; בדקו מול הקבלה. המסמך נשאר במכשיר ולא נשמר.</p>
      <input ref=${fileRef} type="file" accept="application/pdf,.txt" style=${{ display: 'none' }} onChange=${(e) => e.target.files[0] && run(SAMPLE_RECEIPT)} />
      <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}><button className="btn line sm" onClick=${() => fileRef.current && fileRef.current.click()}><${Icon} n="upload" />קובץ קבלה PDF</button><button className="btn line sm" onClick=${() => run(SAMPLE_RECEIPT)}>דוגמה</button></div>
      <div className="field"><label htmlFor="rc-text">טקסט הקבלה</label><textarea id="rc-text" className="inp" dir="auto" style=${{ minHeight: 110, font: '14px/1.5 var(--mono)' }} value=${text} onChange=${(e) => run(e.target.value)} placeholder="הדביקו כאן את הטקסט מהקבלה"></textarea></div>
      ${parsed && parsed.credit && html`<div className="warnbox"><${Icon} n="alert" />זהו מסמך זיכוי. אין להוסיף ממנו ליטרים. אפשר לרשום החזר כהוצאה ברכב.</div>`}
      ${parsed && !parsed.credit && html`<div className="group">
        <${Row} title="ליטרים בקבלה" value=${parsed.liters != null ? html`<span className="n">${fmt.dec(parsed.liters, 2)}</span>` : 'לא זוהה'} />
        <${Row} title="עלות הדלק ששולמה" value=${parsed.total != null ? html`<span className="n">${fmt.dec(parsed.total, 2)} ₪</span>` : 'לא זוהה'} />
        <${Row} title="מחיר לליטר" value=${parsed.price != null ? html`<span className="n">${fmt.price(parsed.price)}</span>` : parsed.liters && parsed.total ? html`<span className="n">${fmt.price(parsed.total / parsed.liters)}</span> · מחושב` : 'לא זוהה'} />
        <${Row} title="תאריך הקבלה" value=${parsed.date ? `${fmt.date(new Date(parsed.date))}${parsed.time ? ', ' + parsed.time : ''}` : 'לא זוהה'} />
      </div>
      <${Check} on=${checked} onChange=${setChecked}>בדקתי: אלה ליטרים ועלות דלק ששולמה, אחרי הנחות וללא מוצרי חנות ועמלות</${Check}>`}
      <button className="btn" disabled=${!ok || !checked} onClick=${() => { p.onResult(parsed); A.close(); A.toast('הקבלה הועברה לטופס. השלימו קילומטראז׳ ובחרו מצב מיכל.'); }}>העברה לבדיקה בטופס</button>
      <p className="note">בלי מזהי מסמך מאושרים נבדקת רק חזרה של אותו טקסט. קבלה שכבר יובאה לרכב הזה לא תתווסף פעמיים.</p>
    <//>`;
  }

  /* ================= JOURNAL · on what the summary is based ================= */
  function JournalInfo({ A, p }) {
    return html`<${Sheet} title="על אילו נתונים הסיכום מבוסס?" onClose=${A.close}>
      <p className="small">הסכומים מבוססים על הרשומות שעוברות את הסינון הנוכחי, כולל החזרים (שמורידים מהסכום). עלות שלא נרשמה נשארת חסרה; אפס שנרשם נשאר אפס.</p>
      ${p.unknown > 0 && html`<p className="small">${p.unknown === 1 ? 'רשומה אחת' : `${p.unknown} רשומות`} בלי סכום — ${p.unknown === 1 ? 'היא לא נכללת' : 'הן לא נכללות'} בסכום הידוע. אפשר לפתוח אותן ולהשלים.</p>`}
      ${p.pending > 0 && html`<p className="small">חלק מהנתונים שמורים רק במכשיר או ממתינים לאישור. הסכום הידוע אינו בהכרח הסכום הסופי.</p>`}
      <p className="note">הוצאות שסומנו "לא נכלל בעלות הרכב" מופיעות ביומן ובסכום שלו, אבל לא ב"כמה הרכב עולה לך" ולא בממוצעים.</p>
    <//>`;
  }

  /* ================= VEHICLE · reminders ================= */
  function reminderNext(r, c, db) {
    // next due: manual → as set; completion → last linked service + interval; fixed → first target + n×interval past today
    const last = r.lastServiceId ? db.records.find((x) => x.id === r.lastServiceId) : null;
    let dueKm = r.dueKm, dueDate = r.dueDate;
    if (r.basis === 'completion' && last) {
      if (r.intervalKm && last.odo) dueKm = last.odo + r.intervalKm;
      if (r.intervalMonths) { const d = new Date(last.date); d.setMonth(d.getMonth() + r.intervalMonths); dueDate = dayIso(d); }
    }
    if (r.basis === 'fixed') {
      if (r.intervalKm && dueKm && c.estOdo) while (dueKm < c.estOdo - r.intervalKm) dueKm += r.intervalKm;
      if (r.intervalMonths && dueDate) { let d = new Date(dueDate); while (d < now()) d.setMonth(d.getMonth() + r.intervalMonths); dueDate = dayIso(d); }
    }
    const kmLeft = dueKm && c.estOdo ? Math.round(dueKm - c.estOdo) : null;
    const daysLeft = dueDate ? daysFrom(dueDate) : null;
    const byKm = kmLeft != null && (daysLeft == null || kmLeft / Math.max(1, c.dailyKm) < daysLeft);
    return { dueKm, dueDate, kmLeft, daysLeft, byKm, needsMileage: r.basis === 'completion' && !!r.intervalKm && !(last && last.odo), last };
  }
  function icsFor(r, due, v) {
    const d = due.dueDate ? due.dueDate.replace(/-/g, '') : dayIso(new Date(now().getTime() + Math.max(1, (due.kmLeft || 0) / 30) * DAY)).replace(/-/g, '');
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Tank Maleh//HE', 'BEGIN:VEVENT', `UID:${r.id}@tank-maleh`, `DTSTART;VALUE=DATE:${d}`, `SUMMARY:${r.label} · ${v.nick}`, `DESCRIPTION:תזכורת מטנק מלא${due.dueKm ? ` · יעד ${fmt.int(due.dueKm)} ק״מ` : ''}. צילום מצב של התאריך, בלי מעקב ק״מ.`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  }
  function ReminderView({ db, c, A, p }) {
    const r = db.reminders.find((x) => x.id === p.id);
    if (!r) return null;
    const due = reminderNext(r, c, db);
    const linked = db.records.filter((x) => x.type === 'service' && (x.reminderId === r.id || x.id === r.lastServiceId)).sort((a, b) => new Date(b.date) - new Date(a.date));
    const basis = REMINDER_BASIS.find((b) => b.id === (r.basis || 'manual')) || REMINDER_BASIS[2];
    const src = REMINDER_SOURCE.find((s) => s.id === r.source);
    const intervals = [r.intervalKm ? `כל ${fmt.int(r.intervalKm)} ק״מ` : null, r.intervalMonths ? `כל ${r.intervalMonths} חודשים` : null].filter(Boolean).join(' · ');
    const logService = () => { A.close(); A.go('service', { reminderId: r.id, kind: r.kind, label: r.label }); };
    return html`<${Sheet} title="תזכורת" onClose=${A.close}>
      <div>
        <span className="lbl">המועד הבא · ${basis.label}${r.active === false ? ' · מושהית' : ''}</span>
        <div className="disp" style=${{ fontSize: 44, lineHeight: 1.05, marginTop: 4 }}>${r.label}</div>
        <p style=${{ margin: '6px 0 0', fontSize: 16 }}>${due.needsMileage ? 'נדרשת קריאת ק״מ בטיפול האחרון כדי לחשב את היעד הבא.' : html`${due.dueDate ? fmt.date(new Date(due.dueDate)) : 'לפי קילומטראז׳'}${due.dueKm ? html` ${due.dueDate ? 'או ' : ''}<span className="n">${fmt.int(due.dueKm)}</span> ק״מ${due.dueDate ? ' · המוקדם מביניהם' : ''}` : ''}`}</p>
        <p className="muted small" style=${{ margin: '4px 0 0' }}>${due.kmLeft != null ? (due.kmLeft < 0 ? `עברו ${fmt.int(-due.kmLeft)} ק״מ מהיעד` : `בעוד כ-${fmt.int(due.kmLeft)} ק״מ`) : ''}${due.kmLeft != null && due.daysLeft != null ? ' · ' : ''}${due.daysLeft != null ? whenDay(due.dueDate) : ''}${intervals ? ` · ${intervals}` : ''}${src ? ` · ${src.label}` : ''}</p>
      </div>
      <div className="group">
        <${Row} icon="wrench" title="רישום טיפול שבוצע" sub="סוגר את התזכורת וקובע את המועד הבא" onClick=${logService} />
        <${Row} icon="edit" title="עריכת התזכורת" sub=${basis.sub} onClick=${() => A.sheet('reminder', { id: r.id })} />
        <${Row} icon="calendar" title="הוספה ליומן המכשיר" sub="קובץ iCal · צילום מצב של התאריך, בלי מעקב ק״מ" chevron=${false} onClick=${() => download('tank-maleh-reminder.ics', icsFor(r, due, c.v), 'text/calendar;charset=utf-8', A, 'קובץ היומן ירד למכשיר')} />
        <${Row} icon="clock" title="דחיית הופעת ההתראה" sub="לא משנה את מועד הטיפול" onClick=${() => A.sheet('snooze', { onPick: (iso) => { A.saveReminder({ ...r, snoozedUntil: iso }); A.toast(`ההתראה תופיע שוב ב-${fmt.dayMon(new Date(iso))}. מועד התזכורת לא השתנה.`); } })} />
        <${Row} icon=${r.active === false ? 'play' : 'pause'} title=${r.active === false ? 'החזרה לפעילות' : 'השהיית התזכורת'} chevron=${false} onClick=${() => { A.saveReminder({ ...r, active: r.active === false }); A.toast(r.active === false ? 'התזכורת פעילה' : 'התזכורת מושהית'); }} />
      </div>
      ${linked.length > 0 && html`<section><span className="lbl">טיפולים מקושרים</span><div className="group" style=${{ marginTop: 6 }}>${linked.map((s) => html`<${Row} key=${s.id} title=${s.label} sub=${`${fmt.dayMon(new Date(s.date))}${s.odo ? ` · ${fmt.int(s.odo)} ק״מ` : ''}`} value=${s.cost != null ? html`<span className="n">${fmt.money(s.cost)}</span>` : '—'} onClick=${() => A.sheet('entry', { id: s.id })} />`)}</div></section>`}
      <details className="note"><summary>איך נקבע מועד התזכורת?</summary><p>${basis.sub}. דחיית התראה אינה משנה את מועד הטיפול. ייצוא ליומן הוא צילום מצב של התאריך, ללא מעקב ק״מ או עדכון אוטומטי.</p></details>
      <button className="btn danger sm" onClick=${() => A.sheet('confirm', { title: 'מחיקת התזכורת?', body: 'הטיפולים שכבר תועדו נשארים ביומן.', confirm: 'מחיקה', danger: true, onConfirm: () => { A.deleteReminder(r.id); A.toast('התזכורת נמחקה'); } })}><${Icon} n="trash" />מחיקת התזכורת</button>
    <//>`;
  }
  function Snooze({ A, p }) {
    const opt = (d, l) => html`<button className="row" onClick=${() => { p.onPick(dayIso(new Date(now().getTime() + d * DAY))); A.close(); }}><span className="grow"><b>${l}</b><small>${fmt.date(new Date(now().getTime() + d * DAY))}</small></span><${Icon} n="chev" /></button>`;
    return html`<${Sheet} title="מתי להציג שוב?" onClose=${A.close}>
      <div className="group">${opt(1, 'מחר')}${opt(7, 'בעוד שבוע')}${opt(30, 'בעוד חודש')}</div>
      <p className="note">דחיית ההופעה אינה משנה את המועד שנשמר ברכב.</p>
    <//>`;
  }

  // Reminder editor: what, when, how it repeats, who said so.
  function ReminderEdit({ db, c, A, p }) {
    const existing = p.id ? db.reminders.find((r) => r.id === p.id) : null;
    const KINDS = c.ev ? TM.EV_REMINDER_KINDS : TM.REMINDER_KINDS;
    const kind = KINDS.find((k) => k.id === (existing ? existing.kind : p.kind)) || { id: 'other', label: '', by: 'km', km: 10000 };
    const [label, setLabel] = useState(existing ? existing.label : kind.label);
    const [basis, setBasis] = useState(existing ? existing.basis || 'manual' : 'fixed');
    const [source, setSource] = useState(existing ? existing.source || 'mine' : 'mfr');
    const [byKm, setByKm] = useState(existing ? existing.dueKm != null || !!existing.intervalKm : kind.by === 'km');
    const [byDate, setByDate] = useState(existing ? !!existing.dueDate || !!existing.intervalMonths : kind.by === 'date');
    const [km, setKm] = useState(existing && existing.dueKm ? String(existing.dueKm) : String(Math.round(((c.estOdo || 0) + (kind.km || 10000)) / 100) * 100));
    const [date, setDate] = useState(existing && existing.dueDate ? existing.dueDate : dayIso(new Date(now().getTime() + (kind.days || 365) * DAY)));
    const [intKm, setIntKm] = useState(existing && existing.intervalKm ? String(existing.intervalKm) : String(kind.km || 10000));
    const [intMo, setIntMo] = useState(existing && existing.intervalMonths ? String(existing.intervalMonths) : String(kind.days ? Math.round(kind.days / 30) : 12));
    const [active, setActive] = useState(existing ? existing.active !== false : true);
    const canSave = label.trim() && (byKm || byDate);
    const save = () => {
      const r = { ...(existing || { id: uid(), v: c.v.id, kind: kind.id }), label: label.trim(), basis, source, active,
        dueKm: byKm ? Number(km) : null, dueDate: byDate ? date : null,
        intervalKm: basis !== 'manual' && byKm ? Number(intKm) || null : null, intervalMonths: basis !== 'manual' && byDate ? Number(intMo) || null : null };
      A.saveReminder(r); A.close(); A.toast(existing ? 'התזכורת עודכנה' : `נזכיר לך: ${r.label}`);
    };
    return html`<${Sheet} title=${existing ? 'עריכת התזכורת' : 'תזכורת חוזרת'} onClose=${A.close}>
      <div className="field"><label htmlFor="re-l">תיאור</label><input id="re-l" className="inp" value=${label} placeholder="למשל: החלפת נוזל בלמים" onChange=${(e) => setLabel(e.target.value)} /></div>
      <div className="field"><span className="lbl">חישוב המועד הבא</span><${Seg} value=${basis} onChange=${setBasis} options=${REMINDER_BASIS.map((b) => ({ v: b.id, l: b.label }))} /><span className="note">${REMINDER_BASIS.find((b) => b.id === basis).sub}.</span></div>
      <div className="row" style=${{ padding: '8px 0' }}><span className="grow"><b>לפי קילומטראז׳</b>${byKm && html`<small>${basis === 'manual' ? 'יעד קילומטראז׳' : `חזרה כל ${fmt.int(Number(intKm) || 0)} ק״מ`}</small>`}</span><${Toggle} on=${byKm} label="לפי ק״מ" onChange=${setByKm} /></div>
      ${byKm && html`<div style=${{ display: 'grid', gridTemplateColumns: basis === 'manual' ? '1fr' : '1fr 1fr', gap: 10 }}>
        <div className="field"><label htmlFor="re-km">${basis === 'completion' ? 'היעד הבא (מחושב)' : 'יעד קילומטראז׳'}</label><div className="inp-wrap"><${NumInput} id="re-km" className="inp n" decimals=${0} value=${km} onChange=${setKm} disabled=${basis === 'completion'} /><span className="unit">ק״מ</span></div></div>
        ${basis !== 'manual' && html`<div className="field"><label htmlFor="re-ik">חזרה כל</label><div className="inp-wrap"><${NumInput} id="re-ik" className="inp n" decimals=${0} value=${intKm} onChange=${setIntKm} /><span className="unit">ק״מ</span></div></div>`}
      </div>`}
      <div className="row" style=${{ padding: '8px 0' }}><span className="grow"><b>לפי תאריך</b>${byDate && html`<small>${basis === 'manual' ? 'תאריך יעד' : `חזרה כל ${intMo} חודשים`}</small>`}</span><${Toggle} on=${byDate} label="לפי תאריך" onChange=${setByDate} /></div>
      ${byDate && html`<div style=${{ display: 'grid', gridTemplateColumns: basis === 'manual' ? '1fr' : '1fr 1fr', gap: 10 }}>
        <div className="field"><label htmlFor="re-d">תאריך יעד</label><input id="re-d" className="inp n" type="date" value=${date} onChange=${(e) => setDate(e.target.value)} disabled=${basis === 'completion'} /></div>
        ${basis !== 'manual' && html`<div className="field"><label htmlFor="re-im">חזרה כל</label><div className="inp-wrap"><${NumInput} id="re-im" className="inp n" decimals=${0} value=${intMo} onChange=${setIntMo} /><span className="unit">חודשים</span></div></div>`}
      </div>`}
      ${byKm && byDate && html`<p className="note">אפשר תאריך, קילומטרים או שניהם — המוקדם מביניהם.</p>`}
      <div className="field"><span className="lbl">מקור ההנחיה</span><${Seg} value=${source} onChange=${setSource} options=${REMINDER_SOURCE.map((s) => ({ v: s.id, l: s.label }))} /></div>
      <div className="row" style=${{ padding: '8px 0' }}><span className="grow"><b>תזכורת פעילה</b><small>${active ? 'תופיע בבית ובהתראות' : 'מושהית — נשמרת בלי להתריע'}</small></span><${Toggle} on=${active} label="תזכורת פעילה" onChange=${setActive} /></div>
      <button className="btn" disabled=${!canSave} onClick=${save}>${existing ? 'שמירה' : 'הוספת תזכורת'}</button>
    <//>`;
  }

  /* ================= VEHICLE · issues ================= */
  function IssueView({ db, c, A, p }) {
    const existing = p.id ? db.issues.find((i) => i.id === p.id) : null;
    const [f, setF] = useState(existing ? { ...existing, odo: existing.odo ? String(existing.odo) : '', note: '' } : { title: '', symptoms: '', date: isoLocal(now()).slice(0, 10) + 'T10:00', odo: '', importance: 'normal', status: 'open', serviceIds: [], history: [], note: '' });
    const set = (k, x) => setF((s) => ({ ...s, [k]: x }));
    const services = db.records.filter((r) => r.v === c.v.id && r.type === 'service').sort((a, b) => new Date(b.date) - new Date(a.date));
    const odoN = f.odo ? Number(f.odo) : null;
    const odoErr = odoN != null && c.latest && odoN > c.latest.odo + 5000 ? `הרכב על בערך ${fmt.int(c.estOdo)} ק״מ. ${fmt.int(odoN)} רחוק מזה.` : null;
    const save = () => {
      const changed = !existing || existing.status !== f.status || f.note.trim();
      const history = changed ? [...(f.history || []), { date: dayIso(now()), status: f.status, note: f.note.trim() }].slice(-10) : f.history;
      const issue = { ...(existing || { id: uid(), v: c.v.id }), title: f.title.trim(), symptoms: f.symptoms, date: f.date, odo: odoN, importance: f.importance, status: f.status, open: f.status !== 'resolved', serviceIds: f.serviceIds, history };
      A.saveIssue(issue); A.close(); A.toast(existing ? (f.status === 'resolved' ? 'סומן כנפתר' : 'עודכן') : 'נעקוב אחרי זה');
    };
    return html`<${Sheet} title=${existing ? 'תקלה' : 'משהו השתנה ברכב?'} onClose=${A.close}>
      <div className="field"><label htmlFor="is-t">שם התקלה</label><input id="is-t" className="inp" placeholder="למשל, רעש בזמן בלימה" value=${f.title} onChange=${(e) => set('title', e.target.value)} autoFocus=${!existing} /></div>
      ${!existing && html`<div className="chips" aria-label="תסמינים נפוצים">${SYMPTOMS.map((x) => html`<button key=${x} className=${'chip' + (f.title === x ? ' on' : '')} onClick=${() => set('title', x)}>${x}</button>`)}</div>`}
      <div className="field"><label htmlFor="is-s">מה שמתם לב?</label><textarea id="is-s" className="inp" maxLength=${2000} value=${f.symptoms} onChange=${(e) => set('symptoms', e.target.value)} placeholder="מתי זה קורה, איך זה נשמע, האם מחמיר"></textarea></div>
      <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div className="field"><label htmlFor="is-d">יום הגילוי</label><input id="is-d" className="inp n" type="date" value=${f.date.slice(0, 10)} max=${dayIso(now())} onChange=${(e) => set('date', e.target.value + 'T10:00')} /></div>
        <div className="field"><label htmlFor="is-o">קילומטראז׳ בגילוי <span className="muted" style=${{ fontWeight: 400 }}>(רשות)</span></label><div className="inp-wrap"><${NumInput} id="is-o" className="inp n" decimals=${0} value=${f.odo} onChange=${(x) => set('odo', x)} placeholder=${c.estOdo ? String(Math.round(c.estOdo)) : ''} /><span className="unit">ק״מ</span></div></div>
      </div>
      ${odoErr && html`<div className="warnbox"><${Icon} n="alert" />${odoErr}</div>`}
      <div className="field"><span className="lbl">חשיבות</span><${Seg} value=${f.importance} onChange=${(x) => set('importance', x)} options=${[{ v: 'normal', l: 'למעקב רגיל' }, { v: 'soon', l: 'חשוב לי לטפל בקרוב' }]} /></div>
      ${existing && html`<div className="field"><span className="lbl">מצב</span><${Seg} value=${f.status} onChange=${(x) => set('status', x)} options=${Object.entries(ISSUE_STATUS).map(([v, l]) => ({ v, l }))} /></div>
        <div className="field"><label htmlFor="is-n">הערה לעדכון</label><input id="is-n" className="inp" placeholder="מה השתנה?" value=${f.note} onChange=${(e) => set('note', e.target.value)} /></div>
        <section><span className="lbl">טיפולים שקשורים לתקלה</span>
          ${services.length ? html`<div className="group" style=${{ marginTop: 6 }}>${services.map((s) => html`<label key=${s.id} className="row" style=${{ cursor: 'pointer' }}><input type="checkbox" checked=${f.serviceIds.includes(s.id)} onChange=${(e) => set('serviceIds', e.target.checked ? [...f.serviceIds, s.id] : f.serviceIds.filter((x) => x !== s.id))} style=${{ width: 20, height: 20, accentColor: 'var(--tx)' }} /><span className="grow"><b>${s.label}</b><small>${fmt.dayMon(new Date(s.date))}${s.odo ? ` · ${fmt.int(s.odo)} ק״מ` : ''}</small></span><span className="val n">${s.cost != null ? fmt.money(s.cost) : '—'}</span></label>`)}</div>` : html`<p className="note">אחרי רישום הטיפול ביומן אפשר לקשר אותו כאן.</p>`}
          <p className="note">עלויות נספרות דרך הטיפול בלבד. סימון קישור אינו יוצר הוצאה נוספת.</p></section>
        ${f.history && f.history.length > 0 && html`<details className="note"><summary>שינויי המצב האחרונים (<span className="n">${f.history.length}</span>)</summary>${f.history.slice().reverse().map((h, i) => html`<p key=${i}><span className="n">${fmt.dayMon(new Date(h.date))}</span> · ${ISSUE_STATUS[h.status]}${h.note ? ` · ${h.note}` : ''}</p>`)}</details>`}`}
      <button className="btn" disabled=${!f.title.trim()} onClick=${save}>${existing ? 'שמירה' : 'הוספה'}</button>
      ${existing && f.status !== 'resolved' && html`<button className="btn line sm" onClick=${() => { set('status', 'resolved'); setTimeout(save, 0); }}><${Icon} n="check" />סימון כנפתרה</button>`}
    <//>`;
  }

  /* ================= VEHICLE · year view ================= */
  function VehicleYear({ db, c, A, p }) {
    const y = p.year;
    const t = c.yearly[y] || { fuel: 0, service: 0, expense: 0, count: 0 };
    const unit = UI.unitFor(db, c);
    const list = c.recs.filter((r) => r.date.startsWith(y) && ['fill', 'charge', 'service', 'expense'].includes(r.type)).sort((a, b) => new Date(b.date) - new Date(a.date));
    const months = Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`);
    const data = months.map((k) => c.monthly[k] || { fuel: 0, service: 0, expense: 0 });
    const total = t.fuel + t.service + t.expense;
    const unknown = list.filter((r) => (r.type === 'service' || r.type === 'expense') && r.cost == null).length;
    return html`<div className="pad noTabs" style=${{ gap: 18 }}>
      <${Top} onBack=${A.back} title=${`שנת ${y}`} />
      <div><span className="lbl">${c.v.nick} · ${y}${y === String(now().getFullYear()) ? ' עד עכשיו' : ''}</span><div className="disp n" style=${{ fontSize: 72, lineHeight: 1 }}>${fmt.money(total)}</div><p className="muted small" style=${{ margin: '4px 0 0' }}>${t.count} ${t.count === 1 ? 'רשומה' : 'רשומות'} בשנה זו${unknown ? ` · ${unknown} ${unknown === 1 ? 'עלות חסרה' : 'עלויות חסרות'}` : ''}</p></div>
      <article className="card"><span className="lbl">לפי חודש</span>
        <${Bars} data=${data} keys=${['fuel', 'service', 'expense']} colors=${['var(--c-fuel)', 'var(--c-service)', 'var(--c-other)']} labels=${months.map(fmt.monthShort)} />
        <div className="legend"><span><i className="sq" style=${{ background: 'var(--c-fuel)' }}></i>${c.ev ? 'חשמל' : 'דלק'}</span><span><i className="sq" style=${{ background: 'var(--c-service)' }}></i>טיפולים</span><span><i className="sq" style=${{ background: 'var(--c-other)' }}></i>הוצאות</span></div>
      </article>
      <div className="facts" role="list">
        <div role="listitem"><span className="fl">${c.ev ? 'חשמל' : 'דלק'}</span><i className="ld"></i><span className="fv"><span className="n">${fmt.money(t.fuel)}</span></span></div>
        <div role="listitem"><span className="fl">טיפולים</span><i className="ld"></i><span className="fv"><span className="n">${fmt.money(t.service)}</span></span></div>
        <div role="listitem"><span className="fl">הוצאות אחרות<small>אחרי החזרים</small></span><i className="ld"></i><span className="fv"><span className="n">${fmt.money(t.expense)}</span></span></div>
      </div>
      <section><div className="recent-h"><span className="lbl">הרשומות</span><button className="linkbtn" onClick=${() => A.tab('journal', { year: y })}>כל הרשומות של השנה ›</button></div>
        ${list.slice(0, 12).map((r) => html`<${S1.EntryRow} key=${r.id} r=${r} c=${c} unit=${unit} A=${A} />`)}</section>
    </div>`;
  }

  /* ================= VEHICLE · care backup / export / import ================= */
  function CareTransfer({ db, c, A }) {
    const care = db.records.filter((r) => r.v === c.v.id && ['service', 'expense', 'odo', 'tank', 'trip'].includes(r.type));
    const fileRef = useRef(null);
    const [preview, setPreview] = useState(null);
    const [ok, setOk] = useState(false);
    const backup = () => download(`tank-maleh-care-${c.v.nick}-${mkey(now())}.json`, JSON.stringify({ kind: 'care-backup', version: 1, vehicle: { id: c.v.id, nick: c.v.nick, plate: c.v.plate }, exportedAt: now().toISOString(), partial: db.writes.some((w) => w.state !== 'synced'), records: care, reminders: db.reminders.filter((r) => r.v === c.v.id), issues: db.issues.filter((i) => i.v === c.v.id) }, null, 2), 'application/json', A, 'גיבוי התחזוקה ירד למכשיר');
    const csv = () => download(`tank-maleh-costs-${c.v.nick}.csv`, TM.toCSV(db, c.v.id), 'text/csv;charset=utf-8', A, 'קובץ העלויות ירד למכשיר');
    const pick = () => setPreview({ file: 'care-backup-2025.json', vehicle: `${c.v.make} ${c.v.model}`, fresh: 3, existing: care.length, conflicts: 0, rows: [{ type: 'service', label: 'טיפול 60,000', date: '2025-03-12T10:00', cost: 720, odo: 160200 }, { type: 'expense', label: 'אגרת רישוי', date: '2025-11-20T09:00', cost: 1380 }, { type: 'service', label: 'מצבר', date: '2025-08-02T12:00', cost: 520, odo: 164900 }] });
    const doImport = () => { A.bulkAdd(preview.rows.map((r) => ({ ...r, id: uid(), v: c.v.id, kind: r.type === 'service' ? 'other' : undefined, cat: r.type === 'expense' ? 'license' : undefined })), 'ייבוא תחזוקה'); setPreview(null); A.close(); A.toast(`${preview.fresh} רשומות יובאו ואושרו`); };
    return html`<${Sheet} title="גיבוי וייצוא תחזוקה" onClose=${A.close}>
      <p className="muted small">${c.v.nick} בלבד. הגיבוי כולל טיפולים, תזכורות, הוצאות ועדכוני ק״מ. ${c.ev ? 'טעינות' : 'תדלוקים'} מיוצאים בנפרד דרך החשבון.</p>
      <div className="group">
        <${Row} icon="download" title="הורדת גיבוי" sub=${`${care.length} רשומות · JSON`} chevron=${false} onClick=${backup} />
        <${Row} icon="doc" title="ייצוא עלויות CSV" sub="נפתח ב-Excel" chevron=${false} onClick=${csv} />
        <${Row} icon="upload" title="בחירת גיבוי לשחזור" sub="קובץ גיבוי תחזוקה" chevron=${false} onClick=${() => fileRef.current && fileRef.current.click()} />
      </div>
      <input ref=${fileRef} type="file" accept="application/json" style=${{ display: 'none' }} onChange=${pick} />
      ${db.writes.some((w) => w.state !== 'synced') && html`<p className="note">העותק במכשיר עשוי להיות חלקי או לכלול שינויים שטרם סונכרנו. הקובץ יסומן בהתאם.</p>`}
      ${preview && html`<section style=${{ display: 'grid', gap: 10 }}>
        <span className="lbl">תצוגה מקדימה · ${preview.file}</span>
        <p className="small">רכב בקובץ: ${preview.vehicle} · רכב יעד: ${c.v.nick}<br/><b>${preview.fresh} רשומות חדשות</b> · ${preview.existing} כבר קיימות${preview.conflicts ? ` · ${preview.conflicts} עם תוכן שונה` : ''}</p>
        <div className="group">${preview.rows.map((r, i) => html`<div key=${i} className="row"><span className="grow"><b>${r.label}</b><small>${fmt.dayMon(new Date(r.date))}${r.odo ? ` · ${fmt.int(r.odo)} ק״מ` : ''}</small></span><span className="val n">${fmt.money(r.cost)}</span></div>`)}</div>
        <${Check} on=${ok} onChange=${setOk}>בדקתי שהרשומות שייכות לרכב היעד ושברצוני להוסיף אותן</${Check}>
        <button className="btn" disabled=${!ok} onClick=${doImport}>ייבוא הרשומות החדשות</button>
      </section>`}
    <//>`;
  }

  /* ================= EXPENSE · what "not part of the car's cost" means ================= */
  function ExcludeInfo({ A }) {
    return html`<${Sheet} title="לכלול בעלות הרכב?" onClose=${A.close}>
      <p className="small">כברירת מחדל כל הוצאה נכנסת ל"כמה הרכב עולה לך" ולממוצעים החודשיים והשנתיים — כי זה מה שהרכב באמת עולה.</p>
      <p className="small">כיבוי מתאים להוצאה שנרשמה ליומן בשביל התיעוד, אבל לא מייצגת את עלות התפעול: דוח חניה חד-פעמי, אביזר שקניתם במתנה, הוצאה שהעסק מחזיר לכם במלואה.</p>
      <p className="small">ההוצאה תישאר ביומן ובסכום של היומן, עם סימון "לא בעלות הרכב". היא לא תיכנס לעלות החודשית, לעלות לק״מ, לממוצעים ולסיכום שמשותף להשוואה.</p>
      <button className="btn ink" onClick=${A.close}>הבנתי</button>
    <//>`;
  }

  /* ================= ACCOUNT · install, sharing, delete, restore ================= */
  function Install({ db, A }) {
    const ios = /iPhone|iPad/.test(navigator.userAgent);
    return html`<${Sheet} title="התקנת האפליקציה" onClose=${A.close}>
      ${db.settings.installed ? html`<p className="small">האפליקציה מותקנת. היא פועלת מהמסך הראשי, בלי דפדפן, וממשיכה לעבוד גם בלי קליטה.</p>`
      : html`<p className="small">אייקון במסך הבית, פתיחה במסך מלא, וכל השמירות ממשיכות לעבוד גם בלי קליטה.</p>
        <div className="group">
          <${Row} title=${ios ? 'בספארי' : 'בכרום / Edge'} sub=${ios ? 'שיתוף ← הוספה למסך הבית' : 'בתפריט הדפדפן: התקנת אפליקציה'} />
          <${Row} title=${ios ? 'בכרום / Edge' : 'בספארי'} sub=${ios ? 'בתפריט הדפדפן: התקנת אפליקציה' : 'שיתוף ← הוספה למסך הבית'} />
        </div>
        <button className="btn" onClick=${() => { A.setSetting('installed', true); A.close(); A.toast('האפליקציה הותקנה'); }}>התקנה</button>`}
    <//>`;
  }
  function ShareInfo({ A, p }) {
    const cost = p.kind === 'cost';
    return html`<${Sheet} title=${cost ? 'מה משותף בסיכום העלות' : 'מה משותף בהשוואה'} onClose=${A.close}>
      <p className="small"><b>משותף:</b> ${cost ? 'עלות חודשית כוללת של הרכב, דגם, סוג דלק ומספר החודשים בחישוב. רק סיכום חיובי ומלא — פרטים חסרים אינם משותפים.' : 'דגם, שנת הרכב, סוג דלק, ממוצע צריכה, מספר המקטעים, מחיר ממוצע ששולם וזמן עדכון הסיכום.'}</p>
      <p className="small"><b>לא משותף:</b> ${cost ? 'פירוט הוצאות, חשבוניות, פרטי ביטוח, שם, מייל ולוחית רישוי.' : 'שם, מייל, מספר רישוי, קילומטראז׳, תאריכי תדלוקים, תחנות, מיקום או הערות.'}</p>
      <p className="note">הסיכום אינו אנונימי לחלוטין: מזהי החשבון והרכב משויכים אליו, כך שאפשר לקשר בין עדכונים של אותו חשבון. סיכום אחד לכל רכב. ${cost ? 'ההשוואה מוצגת רק מול ארבעה נהגים אחרים לפחות עם אותו דגם וסוג דלק.' : 'כיבוי מבקש להסיר את הסיכומים מהשרת; האישור מוצג אחרי שהשרת מאשר.'}</p>
      <button className="btn ink" onClick=${A.close}>סגירה</button>
    <//>`;
  }
  function DeleteAccount({ db, A }) {
    const [step, setStep] = useState(1);
    const [local, setLocal] = useState(false);
    const pending = db.writes.filter((w) => w.state !== 'synced').length;
    useEffect(() => { if (step === 3) { const t = setTimeout(() => { A.close(); A.newUser(); A.toast('החשבון וכל הנתונים נמחקו'); }, 1600); return () => clearTimeout(t); } }, [step]);
    return html`<${Sheet} title=${step === 2 ? 'אישור אחרון' : 'מחיקת החשבון'} onClose=${A.close}>
      ${step === 1 && html`<p className="muted">כל הרכבים, התדלוקים, הטיפולים והנתונים יימחקו לצמיתות. לא ניתן לשחזר. כדאי לשמור גיבוי קודם.</p>
        ${pending > 0 && html`<div className="warnbox"><${Icon} n="alert" />יש ${pending} שינויים שעוד לא עלו לענן במכשיר. טפלו בהם לפני המחיקה.</div>`}
        <button className="btn danger" disabled=${pending > 0} onClick=${() => setStep(2)}>המשך למחיקה</button>
        ${pending > 0 && html`<button className="btn line sm" onClick=${() => { A.close(); A.go('unsynced'); }}>שינויים שעוד לא עלו לענן</button>`}
        <button className="btn line sm" onClick=${A.close}>ביטול</button>`}
      ${step === 2 && html`<p className="muted">זו ההזדמנות האחרונה לבטל. למחוק את כל הנתונים לצמיתות?</p>
        <${Check} on=${local} onChange=${setLocal}>למחוק גם את הנתונים המקומיים במכשיר הזה (מחשב משותף)</${Check}>
        <button className="btn danger" onClick=${() => setStep(3)}>כן, מחקו הכול</button>
        <button className="btn line sm" onClick=${A.close}>ביטול</button>`}
      ${step === 3 && html`<div style=${{ display: 'grid', justifyItems: 'center', gap: 12, padding: '20px 0' }}><${Spinner} /><span className="muted">מוחקים את החשבון… ממתינים לאישור השרת.</span></div>`}
    <//>`;
  }
  function Restore({ db, A }) {
    const fileRef = useRef(null);
    const [preview, setPreview] = useState(null);
    const pick = () => setPreview({ file: 'tank-maleh-full-2026-10.json', vehicles: 2, fresh: 4, existing: db.records.length, prefs: true, drafts: 1, rows: [{ type: 'fill', label: 'תדלוק · פז רמות', date: '2026-05-03T09:00', cost: 226 }, { type: 'fill', label: 'תדלוק · סונול גדרה', date: '2026-05-21T18:10', cost: 221 }, { type: 'service', label: 'בדיקת חורף', date: '2025-12-02T10:00', cost: 180 }, { type: 'expense', label: 'חניה', date: '2026-04-14T12:00', cost: 24 }] });
    return html`<${Sheet} title="שחזור מגיבוי מלא" onClose=${A.close}>
      <p className="muted small">מזהי הרכב והרשומות והקשרים ביניהם נשמרים. השחזור מוסיף רשומות חסרות בלבד. היסטוריה קיימת אינה מוחלפת.</p>
      <input ref=${fileRef} type="file" accept="application/json" style=${{ display: 'none' }} onChange=${pick} />
      ${!preview && html`<button className="btn line" onClick=${() => fileRef.current && fileRef.current.click()}><${Icon} n="upload" />בחירת קובץ גיבוי מלא</button><button className="link" onClick=${pick}>אין קובץ? תצוגה מקדימה לדוגמה</button>`}
      ${preview && html`<section style=${{ display: 'grid', gap: 10 }}>
        <span className="lbl">תצוגה מקדימה לפני הוספה · ${preview.file}</span>
        <p className="small">${preview.vehicles} רכבים · <b>${preview.fresh} רשומות חדשות</b> · ${preview.existing} זהות${preview.prefs ? ' · העדפות אישיות' : ''}${preview.drafts ? ` · ${preview.drafts} טיוטות במכשיר הזה` : ''}</p>
        <div className="group">${preview.rows.map((r, i) => html`<div key=${i} className="row"><span className="grow"><b>${r.label}</b><small>${fmt.dayMon(new Date(r.date))}</small></span><span className="val n">${fmt.money(r.cost)}</span></div>`)}</div>
        <p className="note">שינויים ממתינים נשמרו בקובץ בנפרד. הם אינם משוחזרים אוטומטית לתור, כדי למנוע הפעלה חוזרת של מחיקות או כתיבות ישנות. תמונות אינן כלולות בגיבוי.</p>
        <button className="btn" onClick=${() => { A.bulkAdd(preview.rows.filter((r) => r.type !== 'fill').map((r) => ({ id: uid(), v: db.activeV, type: r.type, date: r.date, label: r.label, cost: r.cost, kind: r.type === 'service' ? 'other' : undefined, cat: r.type === 'expense' ? 'parking' : undefined })), 'שחזור מגיבוי'); A.close(); A.toast(`נוספו ${preview.fresh} רשומות. השחזור הושלם.`); }}>הוספת הנתונים שנבחרו</button>
        <button className="btn line sm" onClick=${() => A.sheet('confirm', { title: 'שחזור העדפות אישיות?', body: 'מראה, צבע, יחידות והנחת הדלק יוחלפו בערכים מהקובץ.', confirm: 'שחזור העדפות', onConfirm: () => A.toast('ההעדפות נשלחו לשמירה.') })}>שחזור העדפות אישיות</button>
      </section>`}
    <//>`;
  }

  /* ================= ACCOUNT · monthly statement for a business vehicle ================= */
  function monthStatement(db, c, key) {
    const list = c.recs.filter((r) => mkey(new Date(r.date)) === key && ['fill', 'charge', 'service', 'expense'].includes(r.type)).sort((a, b) => new Date(a.date) - new Date(b.date));
    const amt = (r) => (r.type === 'fill' || r.type === 'charge' ? r.total : r.refund ? -(r.cost || 0) : r.cost || 0);
    const cat = (r) => (r.type === 'fill' ? 'דלק' : r.type === 'charge' ? 'חשמל' : r.type === 'service' ? 'טיפולים ותיקונים' : r.excluded ? 'לא בעלות הרכב' : (TM.EXPENSE_KINDS.find((k) => k.id === r.cat) || {}).label || 'הוצאה');
    const groups = {};
    for (const r of list) { const k = cat(r); groups[k] = groups[k] || { label: k, rows: [], total: 0 }; groups[k].rows.push(r); groups[k].total += amt(r) || 0; }
    const total = list.filter((r) => !r.excluded).reduce((s, r) => s + (amt(r) || 0), 0);
    const odos = list.filter((r) => r.odo).map((r) => r.odo);
    const km = odos.length > 1 ? Math.max(...odos) - Math.min(...odos) : null;
    const unknown = list.filter((r) => (r.type === 'service' || r.type === 'expense') && r.cost == null).length;
    return { key, list, groups: Object.values(groups), total, km, unknown, amt, cat };
  }
  function statementCSV(db, c, st) {
    const rows = [['תאריך', 'קטגוריה', 'פירוט', 'ספק / תחנה', 'כמות', 'מחיר ליחידה', 'קילומטראז׳', 'סכום (₪)', 'נכלל בעלות הרכב', 'הערה']];
    for (const r of st.list) rows.push([r.date.slice(0, 10), st.cat(r), r.label || (r.type === 'fill' ? 'תדלוק' : 'טעינה'), r.type === 'fill' ? station(r.station).name : r.type === 'charge' ? r.station || TM.chargePlace(r.where).label : r.garage || '', r.liters ?? r.kwh ?? '', r.price ?? r.pricePerKwh ?? '', r.odo ?? '', st.amt(r) ?? '', r.excluded ? 'לא' : 'כן', (r.note || '').replace(/"/g, '""')]);
    rows.push([]); rows.push(['סה״כ לחודש', '', '', '', '', '', st.km ?? '', st.total.toFixed(2), '', `${c.v.make} ${c.v.model} · ${fmt.plate(c.v.plate)}`]);
    return '﻿' + rows.map((r) => r.map((x) => `"${x}"`).join(',')).join('\n');
  }
  function statementHTML(db, c, st, biz) {
    const row = (r) => `<tr><td>${r.date.slice(0, 10).split('-').reverse().join('.')}</td><td>${st.cat(r)}</td><td>${r.label || (r.type === 'fill' ? `תדלוק · ${station(r.station).name}` : `טעינה · ${r.station || TM.chargePlace(r.where).label}`)}${r.note ? `<br><small>${r.note}</small>` : ''}</td><td class="n">${r.liters != null ? fmt.dec(r.liters, 2) + ' ל׳' : r.kwh != null ? fmt.dec(r.kwh) + ' kWh' : ''}</td><td class="n">${r.odo ? fmt.int(r.odo) : ''}</td><td class="n">${st.amt(r) != null ? fmt.money(st.amt(r)) : '—'}</td></tr>`;
    return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>דוח הוצאות רכב · ${fmt.month(st.key)}</title>
<style>body{font:14px/1.5 -apple-system,"Segoe UI",Arial,sans-serif;color:#15130F;margin:32px;max-width:860px}h1{font-size:24px;margin:0}h2{font-size:14px;color:#6B6459;font-weight:500;margin:4px 0 20px}table{width:100%;border-collapse:collapse;margin:14px 0}th,td{padding:8px 6px;border-bottom:1px solid #E8E3D6;text-align:right;vertical-align:top}th{font-weight:600;font-size:12px;color:#6B6459}td.n,th.n{font-variant-numeric:tabular-nums;white-space:nowrap}tfoot td{font-weight:700;border-top:2px solid #15130F;border-bottom:0}.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:16px 0}.meta div{border:1px solid #E8E3D6;border-radius:10px;padding:10px 12px}.meta b{display:block;font-size:18px}.meta small{color:#6B6459}small{color:#6B6459}.sig{margin-top:40px;display:grid;grid-template-columns:1fr 1fr;gap:40px}.sig div{border-top:1px solid #15130F;padding-top:6px;font-size:12px;color:#6B6459}@media print{body{margin:12mm}}</style></head><body>
<h1>דוח הוצאות רכב · ${fmt.month(st.key)}</h1><h2>${biz.company ? biz.company + ' · ' : ''}${c.v.make} ${c.v.model} ${c.v.year} · לוחית ${fmt.plate(c.v.plate)}${biz.driver ? ' · נהג: ' + biz.driver : ''}${biz.usage ? ` · שימוש עסקי ${biz.usage}%` : ''}</h2>
<div class="meta"><div><small>סה״כ הוצאות החודש</small><b>${fmt.money(st.total)}</b></div><div><small>ק״מ שתועדו בחודש</small><b>${st.km != null ? fmt.int(st.km) : '—'}</b></div><div><small>${biz.usage ? `חלק עסקי (${biz.usage}%)` : 'רשומות'}</small><b>${biz.usage ? fmt.money(st.total * biz.usage / 100) : st.list.length}</b></div></div>
${st.groups.map((g) => `<h3 style="font-size:15px;margin:18px 0 0">${g.label} <small>· ${fmt.money(g.total)}</small></h3><table><thead><tr><th>תאריך</th><th>קטגוריה</th><th>פירוט</th><th class="n">כמות</th><th class="n">ק״מ</th><th class="n">סכום</th></tr></thead><tbody>${g.rows.map(row).join('')}</tbody></table>`).join('')}
<table><tfoot><tr><td colspan="5">סה״כ לחודש${st.unknown ? ` <small>(${st.unknown} רשומות ללא סכום לא נכללו)</small>` : ''}</td><td class="n">${fmt.money(st.total)}</td></tr></tfoot></table>
<p><small>הופק מטנק מלא ב-${fmt.date(now())}. הסכומים לפי הרשומות שתועדו באפליקציה; הקבלות המקוריות נשמרות אצל בעל הרכב. הוצאות שסומנו "לא בעלות הרכב" מופיעות בנפרד ואינן בסה״כ.</small></p>
<div class="sig"><div>חתימת הנהג</div><div>אישור הנהלת חשבונות</div></div></body></html>`;
  }
  function BizExport({ db, c, A }) {
    const months = [...new Set(c.recs.filter((r) => ['fill', 'charge', 'service', 'expense'].includes(r.type)).map((r) => mkey(new Date(r.date))))].sort().reverse();
    const [key, setKey] = useState(months[0] || mkey(now()));
    const biz = c.v.biz || {};
    const [company, setCompany] = useState(biz.company || '');
    const [driver, setDriver] = useState(biz.driver || db.user.name);
    const [usage, setUsage] = useState(biz.usage != null ? String(biz.usage) : '');
    const st = monthStatement(db, c, key);
    const saveBiz = () => A.updateVehicle(c.v.id, { biz: { company: company.trim(), driver: driver.trim(), usage: usage === '' ? null : Number(usage) } });
    const b = { company: company.trim(), driver: driver.trim(), usage: usage === '' ? null : Number(usage) };
    const stamp = isoLocal(now()).replace(/[:T]/g, '-');
    return html`<${Sheet} title="דוח חודשי להנהלת חשבונות" onClose=${A.close}>
      <p className="muted small">כל ההוצאות של חודש אחד, מקובצות לפי קטגוריה, עם ק״מ וסה״כ — מוכן להגשה כהוצאה בעסק. PDF להדפסה או Excel לייבוא.</p>
      <div className="field"><span className="lbl">חודש</span><div className="scrollx">${months.slice(0, 12).map((k) => html`<button key=${k} className=${'chip' + (key === k ? ' on' : '')} onClick=${() => setKey(k)}>${fmt.month(k)}</button>`)}</div></div>
      <div className="facts" role="list">
        <div role="listitem"><span className="fl">סה״כ ${fmt.month(key)}<small>${st.list.length} רשומות${st.unknown ? ` · ${st.unknown} בלי סכום` : ''}</small></span><i className="ld"></i><span className="fv"><span className="n">${fmt.money(st.total)}</span></span></div>
        <div role="listitem"><span className="fl">ק״מ שתועדו</span><i className="ld"></i><span className="fv"><span className="n">${st.km != null ? fmt.int(st.km) : '—'}</span></span></div>
        ${st.groups.map((g) => html`<div key=${g.label} role="listitem"><span className="fl"><small>${g.label}</small></span><i className="ld"></i><span className="fv"><span className="n" style=${{ fontSize: 16 }}>${fmt.money(g.total)}</span></span></div>`)}
      </div>
      <details className="note" open=${!!(biz.company || biz.usage != null)}><summary>פרטי העסק בדוח (לא חובה)</summary>
        <div style=${{ display: 'grid', gap: 10, marginTop: 8 }}>
          <div className="field"><label htmlFor="bz-c">שם העסק</label><input id="bz-c" className="inp" value=${company} onChange=${(e) => setCompany(e.target.value)} onBlur=${saveBiz} placeholder="למשל: מ. וינר בע״מ" /></div>
          <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="field"><label htmlFor="bz-d">נהג</label><input id="bz-d" className="inp" value=${driver} onChange=${(e) => setDriver(e.target.value)} onBlur=${saveBiz} /></div>
            <div className="field"><label htmlFor="bz-u">שימוש עסקי</label><div className="inp-wrap"><${NumInput} id="bz-u" className="inp n" decimals=${0} value=${usage} onChange=${setUsage} placeholder="100" /><span className="unit">%</span></div></div>
          </div>
          <span className="note">אחוז השימוש העסקי מופיע בדוח כחישוב עזר בלבד. הכרה בהוצאה היא לפי כללי רשות המסים ורואה החשבון שלכם.</span>
        </div></details>
      <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <button className="btn" onClick=${() => { saveBiz(); download(`דוח-רכב-${fmt.plate(c.v.plate)}-${key}-${stamp}.html`, statementHTML(db, c, st, b), 'text/html;charset=utf-8', A, 'הדוח ירד. פתחו והדפיסו ל-PDF.'); }}><${Icon} n="doc" />PDF להדפסה</button>
        <button className="btn line" onClick=${() => { saveBiz(); download(`הוצאות-רכב-${fmt.plate(c.v.plate)}-${key}-${stamp}.csv`, statementCSV(db, c, st), 'text/csv;charset=utf-8', A, 'קובץ Excel ירד למכשיר'); }}><${Icon} n="download" />Excel</button>
      </div>
      <p className="note">הוצאות שסומנו "לא בעלות הרכב" מופיעות בדוח בקבוצה נפרדת ולא בסה״כ. אפשר לשנות את הסימון בכל הוצאה.</p>
    <//>`;
  }

  /* ================= NOTIFICATIONS ================= */
  function Notifications({ db, A }) {
    const live = db.notifications.filter((n) => !n.archived);
    const today = dayIso(now());
    const snoozed = live.filter((n) => n.snoozedUntil && n.snoozedUntil > today);
    const unread = live.filter((n) => !n.read && !snoozed.includes(n));
    const read = live.filter((n) => n.read && !snoozed.includes(n));
    const arch = db.notifications.filter((n) => n.archived);
    const [showArch, setShowArch] = useState(false);
    const Item = ({ n }) => html`<article className="card" style=${{ gap: 8, borderWidth: n.read ? 1 : 2 }}>
      <div style=${{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}><b style=${{ fontSize: 16 }}>${!n.read && html`<span style=${{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: 'var(--worse)', marginLeft: 6 }}></span>`}${n.title}</b><span className="note">${fmt.rel(new Date(n.date))}</span></div>
      <p className="small muted" style=${{ margin: 0 }}>${n.body}</p>
      ${n.snoozedUntil && n.snoozedUntil > today && html`<p className="note">תופיע שוב ב-${fmt.dayMon(new Date(n.snoozedUntil))}. מועד התזכורת לא השתנה.</p>`}
      ${n.kind === 'price' && html`<details className="note"><summary>מה שינוי המחיר אומר?</summary><p>המחיר השמור משמש כברירת מחדל לתדלוקים חדשים ולקו ההשוואה בגרף. הוא אינו משנה את המחירים ששילמתם או את ההיסטוריה שכבר שמרתם.</p></details>`}
      <div className="chips">
        ${n.kind === 'reminder' && html`<button className="chip" onClick=${() => A.go('service')}><${Icon} n="wrench" />רישום טיפול</button>`}
        ${n.kind === 'doc' && html`<button className="chip" onClick=${() => A.tab('vehicle')}>לרישוי וביטוח</button>`}
        ${n.kind === 'price' && html`<button className="chip" onClick=${() => A.sheet('price')}>למחיר ולהנחה האישית</button>`}
        ${!n.read && html`<button className="chip" onClick=${() => A.patchNotification(n.id, { read: true })}>סימון כנקרא</button>`}
        ${!n.archived && n.kind !== 'price' && html`<button className="chip" onClick=${() => A.sheet('snooze', { onPick: (iso) => A.patchNotification(n.id, { snoozedUntil: iso, read: true }) })}><${Icon} n="clock" />דחיית הופעה</button>`}
        ${n.archived ? html`<button className="chip" onClick=${() => A.patchNotification(n.id, { archived: false })}>החזרה לפעילות</button>` : html`<button className="chip" onClick=${() => A.patchNotification(n.id, { archived: true })}><${Icon} n="archive" />לארכיון</button>`}
        <button className="chip" onClick=${() => A.sheet('confirm', { title: 'מחיקת ההתראה?', body: 'מחיקה מסירה את ההתראה הזו בלבד. היא אינה מוחקת טיפול, משנה תזכורת או מבטלת פעולת סנכרון.', confirm: 'מחיקה', danger: true, onConfirm: () => A.deleteNotification(n.id) })}><${Icon} n="trash" /></button>
      </div>
    </article>`;
    const Group = ({ title, list }) => list.length ? html`<section style=${{ display: 'grid', gap: 10 }}><h2 className="group-h">${title} <span className="n muted" style=${{ fontWeight: 400 }}>${list.length}</span></h2>${list.map((n) => html`<${Item} key=${n.id} n=${n} />`)}</section>` : null;
    return html`<div className="pad noTabs" style=${{ gap: 18 }}>
      <${Top} onBack=${A.back} title="התראות" right=${unread.length ? html`<button className="chip" onClick=${A.markAllRead}>סימון הכל כנקרא</button>` : null} />
      <p className="muted small" style=${{ margin: 0 }}>עדכונים ותזכורות לרכב. נשמר עד שתמחקו.</p>
      ${live.length === 0 && html`<div className="empty"><div className="disp" style=${{ fontSize: 36 }}>אין התראות חדשות</div><p className="muted small">נודיע כשמחיר הדלק משתנה, כשמתקרב טיפול או כשהרישוי עומד להסתיים.</p></div>`}
      <${Group} title="חדשות" list=${unread} />
      <${Group} title="נקראו" list=${read} />
      <${Group} title="נדחו" list=${snoozed} />
      ${arch.length > 0 && html`<button className="link" style=${{ justifySelf: 'start' }} onClick=${() => setShowArch(!showArch)}>${showArch ? 'הסתרת הארכיון' : `בארכיון (${arch.length})`}</button>`}
      ${showArch && html`<${Group} title="בארכיון" list=${arch} />`}
    </div>`;
  }

  /* ================= UNSYNCED ================= */
  const WRITE_STEPS = [{ k: 'device', l: 'נשמר במכשיר' }, { k: 'sent', l: 'נשלח לשרת' }, { k: 'synced', l: 'אושר וסונכרן' }];
  function Unsynced({ db, A }) {
    const list = [...db.writes].sort((a, b) => new Date(b.at) - new Date(a.at));
    const pending = list.filter((w) => w.state === 'pending'), failed = list.filter((w) => w.state === 'rejected');
    const [open, setOpen] = useState(null);
    const exportOps = () => download(`tank-maleh-unsynced-${mkey(now())}.json`, JSON.stringify({ exportedAt: now().toISOString(), operations: list.filter((w) => w.state !== 'synced') }, null, 2), 'application/json', A, 'הקובץ מכיל נתונים פרטיים — שמרו אותו במקום בטוח');
    const stepOf = (w) => (w.state === 'synced' ? 3 : w.state === 'pending' ? (db.settings.offline ? 1 : 2) : 2);
    return html`<div className="pad noTabs" style=${{ gap: 16 }}>
      <${Top} onBack=${A.back} title="שינויים שעוד לא עלו לענן" />
      <h1 className="h1" style=${{ fontSize: 46 }}>${failed.length ? `${failed.length} ${failed.length === 1 ? 'שינוי דורש' : 'שינויים דורשים'} בדיקה` : pending.length ? `${pending.length} ממתינים` : 'הכל מעודכן'}</h1>
      <p className="muted small" style=${{ margin: 0 }}>פעולות ממתינות נשלחות כשהחיבור זמין. פעולה שנכשלה דורשת ניסיון חוזר. רק אחרי האישור הפעולה יוצאת מהרשימה.</p>
      ${db.settings.offline && html`<div className="warnbox"><${Icon} n="wifi" />אין קליטה (מצב הדגמה). השינויים יעלו כשתכבו את המצב הלא מקוון.</div>`}
      <div className="row" style=${{ padding: '6px 0' }}><span className="grow"><b>מצב לא מקוון (הדגמה)</b><small>שמירות יחכו במכשיר עד שתכבו</small></span><${Toggle} on=${db.settings.offline} label="מצב לא מקוון" onChange=${A.setOffline} /></div>
      ${list.length === 0 ? html`<div className="empty"><div className="disp" style=${{ fontSize: 34 }}>אין במכשיר הזה שינויים שממתינים לאישור</div><p className="muted small">הוסיפו תדלוק ותראו אותו עובר מ"נשמר במכשיר" ל"אושר וסונכרן".</p></div>`
      : html`<div className="group">${list.slice(0, 40).map((w) => { const s = stepOf(w); return html`<div key=${w.id} style=${{ display: 'grid', gap: 8, padding: '12px 0', borderBottom: '1px solid var(--ln)' }}>
          <button className="row" style=${{ border: 0, padding: 0, minHeight: 0 }} onClick=${() => setOpen(open === w.id ? null : w.id)}>
            <span className=${'sync ' + (w.state === 'synced' ? 'ok' : w.state === 'pending' ? 'pending' : 'err')} style=${{ width: 10, height: 10, borderRadius: '50%', border: 0, flex: 'none' }}></span>
            <span className="grow"><b>${w.label}</b><small>${fmt.rel(new Date(w.at))}, ${fmt.time(new Date(w.at))} · ${w.state === 'rejected' ? 'לא סונכרן' : WRITE_STEPS[s - 1].l}</small></span><${Icon} n=${open === w.id ? 'up' : 'down'} s=${18} />
          </button>
          <div className="steps" aria-label="שלבי הסנכרון">${WRITE_STEPS.map((st, i) => html`<i key=${st.k} className=${i < s ? (w.state === 'rejected' && i === s - 1 ? 'on err' : 'on') : ''} style=${w.state === 'rejected' && i === s - 1 ? { background: 'var(--worse)' } : {}}></i>`)}</div>
          ${open === w.id && html`<div style=${{ display: 'grid', gap: 8 }}>
            ${w.error && html`<div className="warnbox"><${Icon} n="alert" />${w.error}</div>`}
            <p className="note" style=${{ margin: 0 }}>${w.state === 'rejected' ? 'השרת דחה את השינוי. הקלט נשאר כאן גם אחרי רענון. זהו העותק היחיד של מה שהקלדתם — אם תרצו לשמור אותו, ייצאו קודם.' : w.state === 'pending' ? 'הפעולה ממתינה בתור השליחה של המכשיר.' : 'הפעולה אושרה בשרת ויצאה מהתור.'}</p>
            ${w.state !== 'synced' && html`<div className="chips">
              ${w.state === 'rejected' && html`<button className="chip" onClick=${() => A.retryWrite(w.id)}><${Icon} n="refresh" />ניסיון חוזר</button>`}
              <button className="chip" onClick=${() => A.sheet('confirm', { title: 'להסיר את הרשומה מהמעקב?', body: 'הסרה מהרשימה לא מבטלת את הפעולה — הכתיבה עצמה עדיין עשויה להגיע לשרת. יוסר רק העותק שנשמר לתיקון.', confirm: 'הסרה מהמעקב', danger: true, onConfirm: () => A.dropWrite(w.id) })}><${Icon} n="trash" />הסרה מהמעקב</button>
            </div>`}
          </div>`}
        </div>`; })}</div>`}
      ${list.some((w) => w.state !== 'synced') && html`<button className="btn line sm" onClick=${exportOps}><${Icon} n="download" />ייצוא השינויים שעוד לא עלו</button>`}
      <details className="note"><summary>איך נשמרים השינויים?</summary><p>כל שינוי נשמר קודם במכשיר, גם בלי קליטה, ואז נשלח לענן. הרשימה נשמרת במכשיר הזה ושורדת רענון, סגירה והתנתקות. ניקוי נתוני האתר או מחיקת הדפדפן מוחקים גם אותה. לשמירת עותק נוסף, השתמשו בייצוא.</p></details>
    </div>`;
  }

  /* ================= IMPORT (fill-ups and tank updates from CSV / Excel) ================= */
  function Import({ db, c, A }) {
    const [kind, setKind] = useState('fills');
    const [state, setState] = useState('pick'); // pick | reading | source | preview | done | undoing
    const [name, setName] = useState('');
    const [source, setSource] = useState(null);
    const [result, setResult] = useState(null);
    const fileRef = useRef(null);
    const FILE = {
      vehicles: [{ id: 'a', label: 'יונדאי i20 · 72-480-78', rows: 4 }, { id: 'b', label: 'מאזדה 3 · 12-345-67', rows: 9 }],
      rows: [
        { date: '2026-05-03T09:00', odo: 167180, liters: 30.2, price: 7.49, station: 'pz-rm', isNew: true },
        { date: '2026-05-21T18:10', odo: 167560, liters: 29.5, price: 7.49, station: 'sn-gd', isNew: true },
        { date: '2026-06-13T08:10', odo: 167930, liters: 31.0, price: 7.62, station: 'pz-rm', isNew: false },
        { date: '2026-07-22T17:40', odo: 168310, liters: 29.7, price: 7.71, station: 'sn-gd', isNew: false },
      ],
      tank: [{ date: '2026-05-10T08:00', level: 0.5, odo: 167300 }, { date: '2026-06-01T08:00', level: 0.25, odo: 167800 }],
      warnings: ['שורה 7: תאריך בפורמט לא מזוהה (22.10.26) — דולגה.', 'שורה 12: ליטרים חסרים — דולגה.'],
    };
    const read = (n) => { setName(n); setState('reading'); setTimeout(() => setState(kind === 'fills' ? 'source' : 'preview'), 900); };
    const fresh = kind === 'fills' ? FILE.rows.filter((r) => r.isNew) : FILE.tank;
    const doImport = () => {
      const recs = kind === 'fills'
        ? fresh.map((r) => ({ id: uid(), v: c.v.id, type: 'fill', date: r.date, odo: r.odo, liters: r.liters, price: r.price, total: Math.round(r.liters * r.price * 100) / 100, station: r.station, full: true, fullSource: 'legacy-assumption', importId: name }))
        : fresh.map((r) => ({ id: uid(), v: c.v.id, type: 'tank', date: r.date, level: r.level, odo: r.odo, importId: name }));
      A.bulkAdd(recs, `ייבוא · ${name}`);
      setResult({ written: recs.length, skipped: FILE.warnings.length, at: now() }); setState('done');
    };
    const undo = () => { setState('undoing'); setTimeout(() => { A.undoImport(); setState('pick'); A.toast(`הייבוא בוטל · ${result.written} רשומות נמחקו`); }, 1100); };
    return html`<div className="pad noTabs" style=${{ gap: 16 }}>
      <${Top} onBack=${A.back} title="ייבוא נתונים" />
      ${state === 'pick' && html`
        <h1 className="h1" style=${{ fontSize: 54 }}>מעבירים היסטוריה</h1>
        <${Seg} value=${kind} onChange=${setKind} options=${[{ v: 'fills', l: c.ev ? 'טעינות' : 'תדלוקים' }, { v: 'tank', l: 'עדכוני מיכל ונסיעות' }]} />
        <p className="muted">קובץ CSV או Excel, מטנק מלא או מאפליקציה אחרת. הקובץ נקרא רק במכשיר, ולא נשמר כלום לפני שתאשרו. רכב היעד: <b>${c.v.nick}</b>.</p>
        <input ref=${fileRef} type="file" accept=".csv,.xlsx,.xls" style=${{ display: 'none' }} onChange=${(e) => e.target.files[0] && read(e.target.files[0].name)} />
        <button className="empty" style=${{ textAlign: 'center', justifyItems: 'center', background: 'var(--sf)' }} onClick=${() => fileRef.current && fileRef.current.click()}>
          <${Icon} n="upload" s=${32} /><b style=${{ font: '400 30px/1 var(--display)' }}>בחירת קובץ</b><span className="muted small">CSV · Excel</span>
        </button>
        <button className="link" onClick=${() => read('fuel-tracker-2026.xlsx')}>אין קובץ? נסו קובץ לדוגמה</button>
        <p className="note">ייבוא חוזר של אותו קובץ לא ייצור כפילויות: רשומות שכבר קיימות לא יוחלפו.</p>`}
      ${state === 'reading' && html`<div style=${{ display: 'grid', justifyItems: 'center', gap: 14, paddingTop: 80 }}><${Spinner} /><span className="muted">קוראים את ${name}…</span></div>`}
      ${state === 'source' && html`
        <h1 className="h1" style=${{ fontSize: 48 }}>הקובץ מכיל כמה רכבים</h1>
        <p className="muted small">ייובאו רק הרשומות של רכב המקור שנבחר, לרכב היעד <b>${c.v.nick}</b>. לשאר הרכבים יש לבצע ייבוא נוסף.</p>
        <div className="group">${FILE.vehicles.map((v) => html`<button key=${v.id} className="row" onClick=${() => { setSource(v.id); setState('preview'); }}><span className="grow"><b>${v.label}</b><small>${v.rows} שורות</small></span>${source === v.id && html`<${Icon} n="check" s=${22} />`}<${Icon} n="chev" /></button>`)}</div>`}
      ${state === 'preview' && html`
        <h1 className="h1" style=${{ fontSize: 48 }}>נמצאו ${kind === 'fills' ? FILE.rows.length : FILE.tank.length} ${kind === 'fills' ? 'תדלוקים' : 'עדכונים'}</h1>
        <p className="muted small">${name} · <b>${fresh.length} חדשים</b>${kind === 'fills' ? ` · ${FILE.rows.length - fresh.length} כבר קיימים ולא ייובאו שוב` : ''}</p>
        <div className="group">${(kind === 'fills' ? FILE.rows : FILE.tank).map((r, i) => html`<div key=${i} className="row" style=${{ opacity: r.isNew === false ? 0.5 : 1 }}>
          <span className="grow"><b>${kind === 'fills' ? TM.station(r.station).name : `מחוון ${pct(r.level)}`}</b><small><span className="n">${fmt.dayMon(new Date(r.date))}</span>${r.liters ? html` · <span className="n">${fmt.dec(r.liters)}</span> ל׳` : ''} · <span className="n">${fmt.int(r.odo)}</span> ק״מ</small></span>
          <span className="val">${r.isNew === false ? 'כפול' : 'חדש'}</span></div>`)}</div>
        ${kind === 'fills' && html`<div className="warnbox"><${Icon} n="alert" />בקובץ אין עמודה של טנק מלא, אז נניח שכל תדלוק היה עד הסוף. אפשר לתקן כל רשומה אחר כך.</div>`}
        <details className="note"><summary>אזהרות נוספות · ${FILE.warnings.length}</summary>${FILE.warnings.map((w, i) => html`<p key=${i}>${w}</p>`)}<p>אפשר לתקן את השורות בקובץ ולייבא שוב. ייבוא חוזר לא ייצור כפילויות.</p></details>
        <div className="bottomBar"><button className="btn" onClick=${doImport}>ייבוא ${fresh.length} ${kind === 'fills' ? 'תדלוקים' : 'עדכונים'}</button><button className="link" onClick=${() => setState('pick')}>קובץ אחר</button></div>`}
      ${state === 'done' && html`
        <div className="disp" style=${{ fontSize: 64 }}>${result.skipped ? 'הייבוא הסתיים חלקית' : 'הייבוא הסתיים'}</div>
        <p className="muted">${result.written} רשומות ${db.settings.offline ? 'נשמרו במכשיר וממתינות לסנכרון' : 'יובאו ואושרו בשרת'}. הצריכה והממוצעים חושבו מחדש.${result.skipped ? ` ${result.skipped} שורות דולגו.` : ''}</p>
        <div className="group"><${Row} title=${`ייבוא · ${name}`} sub=${`${fmt.date(result.at)}, ${fmt.time(result.at)} · ${result.written} רשומות`} value=${db.settings.offline ? 'ממתין' : 'אושר'} /></div>
        <button className="btn ink" onClick=${() => A.tab('journal')}>ליומן</button>
        <button className="link" disabled=${db.settings.offline} onClick=${undo}>${db.settings.offline ? 'ביטול הייבוא יהיה זמין אחרי האישור' : 'ביטול הייבוא כולו'}</button>`}
      ${state === 'undoing' && html`<div style=${{ display: 'grid', justifyItems: 'center', gap: 14, paddingTop: 80 }}><${Spinner} /><span className="muted">בקשת ביטול הייבוא ממתינה לאישור…</span></div>`}
    </div>`;
  }

  /* ================= UPDATE PROMPT ================= */
  function UpdatePrompt({ db, A }) {
    if (!db.settings.updateReady) return null;
    return html`<div className="update" role="status">
      <span className="grow"><b>גרסה חדשה זמינה</b><small>סיימו את השמירה או שמרו את הטיוטה לפני הרענון.</small></span>
      <button className="chip" onClick=${() => { A.setSetting('updateReady', false); A.toast('מפעילים את העדכון…'); }}>רעננו כדי לעבור אליה</button>
    </div>`;
  }

  /* register */
  Object.assign(window.SHEETS, { measure: Measure, tankPref: TankPref, trip: Trip, capacity: Capacity, receipt: Receipt, journalInfo: JournalInfo, reminderView: ReminderView, reminder: ReminderEdit, snooze: Snooze, issue: IssueView, careTransfer: CareTransfer, excludeInfo: ExcludeInfo, install: Install, shareInfo: ShareInfo, deleteAccount: DeleteAccount, restore: Restore, bizExport: BizExport });
  window.S4 = { VehicleYear, Notifications, Unsynced, Import, UpdatePrompt, reminderNext, monthStatement, download };
})();
