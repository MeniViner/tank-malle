/* טנק מלא · prototype — Home, fill-up, saved, journal, insights */
(function () {
  'use strict';
  const { html, Icon, N, consStr, consUnit, consUnitShort, cons, Top, Toggle, Seg, Row, Badge, MiniPlate, Ticks, LineChart, Bars, NumInput, useState, useEffect, useRef } = UI;
  const { fmt, station, now, isoLocal, mkey, officialFor, evaluateDraft, odoBounds, DAY, uid } = TM;
  const pct = (x) => Math.round(x * 100) + '%';

  function syncState(db) {
    if (db.writes.some((w) => w.state === 'rejected')) return 'err';
    if (db.writes.some((w) => w.state === 'pending')) return 'pending';
    return 'ok';
  }
  const SYNC_LABEL = { ok: 'הכל שמור בענן', pending: 'נשמר במכשיר · ממתין לסנכרון', err: 'שינוי אחד נדחה' };

  function HeaderBar({ db, c, A }) {
    const unread = db.notifications.some((n) => !n.read && !n.archived);
    const s = syncState(db);
    return html`<div className="top">
      <button className="carbtn" onClick=${() => A.sheet('carSwitch')} aria-label="החלפת רכב">
        <${MiniPlate} plate=${c.v.plate} />${c.v.nick}<${Icon} n="down" s=${16} />
      </button>
      <div style=${{ display: 'flex', gap: 8 }}>
        <button className="ib ghost" aria-label="התראות" onClick=${() => A.go('notifications')}><${Icon} n="bell" />${unread && html`<span className="badge-dot"></span>`}</button>
        <button className="avatar" aria-label="חשבון" onClick=${() => A.go('account')}><svg className="ring" viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="21" /></svg>${db.user.name[0]}</button>
      </div>
    </div>`;
  }

  function whenStr(days) {
    if (days == null) return '';
    if (days < 0.6) return 'היום';
    if (days < 1.6) return 'מחר';
    return `בעוד ${Math.round(days)} ימים`;
  }
  function whenText(days) {
    if (days == null) return null;
    if (days < 0.6) return html`<span>היום</span>`;
    if (days < 1.6) return html`<span>מחר</span>`;
    return html`בעוד <span>${Math.round(days)}</span> ימים`;
  }

  function ConsCompare({ seg, avg, unit, ev }) {
    if (!seg || !avg) return null;
    const word = ev ? 'חשמל' : 'דלק';
    const moreFuel = avg / seg.kmpl - 1; // >0 = used more fuel per km than usual
    if (Math.abs(moreFuel) < 0.03) return html`<span className="pill neutral">בדיוק כמו הרגיל שלך</span>`;
    const p = pct(Math.abs(moreFuel));
    return moreFuel > 0
      ? html`<span className="pill worse">${p} יותר ${word} לק״מ מהרגיל שלך (${consStr(avg, unit)})</span>`
      : html`<span className="pill better">${p} פחות ${word} לק״מ מהרגיל שלך (${consStr(avg, unit)})</span>`;
  }


  /* ---- Spotlight: the one thing that matters right now, at the top of Home ---- */
  function spotlightItems(db, c, A) {
    const items = [];
    const nowD = now();
    const unit = UI.unitFor(db, c);
    if (db.writes.some((w) => w.state === 'rejected')) items.push({ id: 'rejected', tone: 'danger', icon: 'alert', title: 'שמירה אחת נדחתה', body: 'השרת לא קיבל שינוי אחד. אפשר לנסות שוב או לערוך.', go: () => A.go('unsynced'), sticky: true });
    const docs = c.v.docs || {};
    const docRows = [
      ['test', 'הטסט', 'doc', docs.test && docs.test.due],
      ['mandatory', 'ביטוח החובה', 'shield', docs.mandatory && docs.mandatory.due],
      ['coverage', docs.coverage && docs.coverage.type && docs.coverage.type !== 'none' ? TM.COVERAGE[docs.coverage.type] : null, 'shield', docs.coverage && docs.coverage.type !== 'none' && docs.coverage.due],
    ];
    for (const [key, label, icon, due] of docRows) {
      if (!label || !due) continue;
      const days = Math.round((new Date(due) - nowD) / DAY);
      if (days > 30) continue;
      items.push({ id: `doc-${key}-${due}`, tone: days < 7 ? 'danger' : 'warn', icon,
        title: days < 0 ? `${label} פג תוקף` : days === 0 ? `${label} היום` : days === 1 ? `${label} מחר` : `${label} בעוד ${days} ימים`,
        body: days < 0 ? 'כדאי לחדש כמה שיותר מהר.' : key === 'test' ? 'כדאי לקבוע תור למכון הרישוי.' : 'כדאי להשוות הצעות ולחדש.',
        go: () => A.sheet('doc', { key }), sticky: days < 7 });
    }
    const today = isoLocal(nowD).slice(0, 10);
    for (const r of db.reminders.filter((x) => x.v === c.v.id && x.active !== false && !(x.snoozedUntil && x.snoozedUntil > today))) {
      const due = S4.reminderNext(r, c, db);
      const soonKm = due.kmLeft != null && due.kmLeft <= 500, soonDay = due.daysLeft != null && due.daysLeft <= 14;
      if (!soonKm && !soonDay) continue;
      const past = (due.kmLeft != null && due.kmLeft < 0) || (due.daysLeft != null && due.daysLeft < 0);
      items.push({ id: `rem-${r.id}`, tone: 'warn', icon: 'wrench', title: past ? `${r.label}: הגיע הזמן` : soonKm && (!soonDay || due.byKm) ? `${r.label} בעוד ${fmt.int(due.kmLeft)} ק״מ` : `${r.label} ${due.daysLeft === 0 ? 'היום' : due.daysLeft === 1 ? 'מחר' : `בעוד ${due.daysLeft} ימים`}`, body: soonKm ? 'לפי הקילומטראז׳ המשוער של הרכב.' : 'לפי המועד שנקבע.', go: () => A.sheet('reminderView', { id: r.id }) });
    }
    if (c.tripWarn) items.push({ id: 'trip-' + c.tripWarn.trip.id, tone: 'warn', icon: 'road', title: `כדאי ${c.ev ? 'לטעון' : 'לתדלק'} לפני הנסיעה`, body: `${fmt.int(c.tripWarn.trip.km)} ק״מ ב${fmt.dayMon(new Date(c.tripWarn.trip.date))}. יש כ-${fmt.int(c.kmToTarget)} ק״מ עד ${c.ev ? 'שבד״כ טוענים' : 'שבד״כ מתדלקים'}.`, go: () => A.sheet('tank') });
    if (c.last && c.best && c.last.id === c.best.id && c.segs.length >= 3) items.push({ id: 'best-' + c.last.id, tone: 'better', icon: 'chart', title: 'שיא אישי בצריכה', body: `${consStr(c.last.kmpl, unit)} ${consUnit(unit)} במקטע האחרון. הכי טוב עד היום.`, go: () => A.sheet('segment', { id: c.last.id }) });
    const k = mkey(nowD); const pd = new Date(nowD); pd.setDate(1); pd.setMonth(pd.getMonth() - 1); const pk = mkey(pd);
    if (c.v.fuel === '95' && TM.OFFICIAL[k] && TM.OFFICIAL[pk]) {
      const diff = Math.round((TM.OFFICIAL[k] - TM.OFFICIAL[pk]) * 100);
      if (diff !== 0) items.push({ id: 'price-' + k, tone: 'info', icon: 'coin', title: diff < 0 ? `בנזין 95 ירד ב-${-diff} אג׳` : `בנזין 95 עלה ב-${diff} אג׳`,
        body: `${fmt.price(TM.OFFICIAL[k])} לליטר ב${TM.MONTHS[nowD.getMonth()]}. מיכל מלא ${diff < 0 ? 'זול' : 'יקר'} עכשיו בכ-${fmt.money(Math.abs(diff) / 100 * c.v.tank)}.`, go: () => A.sheet('price') });
    }
    const pm = c.monthly[pk];
    if (nowD.getDate() <= 7 && pm && pm.fills > 0) items.push({ id: 'month-' + pk, tone: 'info', icon: 'chart', title: `${fmt.month(pk)} בסיכום`, body: `${fmt.money(pm.fuel)} דלק · ${pm.fills === 1 ? 'תדלוק אחד' : pm.fills + ' תדלוקים'}${pm.service ? ` · ${fmt.money(pm.service)} טיפולים` : ''}`, go: () => A.tab('insights', { tab: 'spend' }) });
    const gone = new Set(db.dismissed || []);
    return items.filter((i) => !gone.has(i.id)).slice(0, 4);
  }

  function Spotlight({ db, c, A }) {
    const items = spotlightItems(db, c, A);
    const [i, setI] = useState(0);
    const ref = useRef(null);
    const touched = useRef(false);
    const n = items.length;
    const goTo = (idx) => { const el = ref.current; if (!el) return; const w = el.clientWidth + 12; el.scrollTo({ left: -idx * w, behavior: 'smooth' }); setI(idx); };
    useEffect(() => { if (i >= n) setI(Math.max(0, n - 1)); }, [n]);
    useEffect(() => {
      if (n < 2) return;
      const t = setInterval(() => { if (touched.current) return; const next = (i + 1) % n; goTo(next); }, 7000);
      return () => clearInterval(t);
    }, [i, n]);
    if (!n) return null;
    const onScroll = () => { const el = ref.current; if (!el) return; const idx = Math.round(Math.abs(el.scrollLeft) / (el.clientWidth + 12)); if (idx !== i) setI(idx); };
    return html`<section className="spot" aria-label="מה חשוב עכשיו" onPointerDown=${() => { touched.current = true; }}>
      <div className="spot-track" ref=${ref} onScroll=${onScroll}>
        ${items.map((it) => html`<div key=${it.id} className=${'spot-card ' + it.tone}>
          <button className="si" aria-hidden="true" tabIndex=${-1} onClick=${it.go}><${Icon} n=${it.icon} /></button>
          <button className="st" onClick=${it.go}><b>${it.title}</b><small>${it.body}</small></button>
          ${it.sticky ? html`<span className="sx"><${Icon} n="chev" /></span>` : html`<button className="sx" aria-label="הסתרה" onClick=${() => A.dismiss(it.id)}><${Icon} n="x" /></button>`}
        </div>`)}
      </div>
      ${n > 1 && html`<div className="spot-dots" aria-hidden="true">${items.map((it, idx) => html`<i key=${it.id} className=${idx === i ? 'on' : ''} onClick=${() => { touched.current = true; goTo(idx); }}></i>`)}</div>`}
    </section>`;
  }


  /* Consumption sparkline: your usual band, a calm line, values on every point, today's point in tone. */
  function ConsSpark({ segs, avg, unit, tone, onPick, quiet, ev, home }) {
    if (!segs.length) return null;
    const W = 350, H = quiet ? 56 : home ? 118 : 156, padX = quiet ? 8 : 22, top = quiet ? 8 : 28, bottom = quiet ? 8 : 30;
    const vals = segs.map((s) => cons(s.kmpl, unit));
    const a = avg ? cons(avg, unit) : null;
    const lo = a != null ? a * 0.93 : null, hi = a != null ? a * 1.07 : null;
    let min = Math.min(...vals, lo ?? Infinity), max = Math.max(...vals, hi ?? -Infinity);
    const pad = (max - min) * 0.18 || 1; min -= pad; max += pad;
    const n = segs.length;
    const x = (i) => (n === 1 ? W / 2 : W - padX - (i * (W - 2 * padX)) / (n - 1));
    const y = (v) => top + (1 - (v - min) / (max - min)) * (H - top - bottom);
    const pts = vals.map((v, i) => [x(i), y(v)]);
    // smooth path (Catmull-Rom → Bézier)
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    const base = H - bottom + 6;
    const area = `${d} L${pts[pts.length - 1][0]},${base} L${pts[0][0]},${base} Z`;
    const toneCls = tone || '';
    return html`<figure style=${{ margin: 0 }} aria-label="הצריכה בששת המקטעים האחרונים" onClick=${quiet ? () => onPick() : undefined} role=${quiet ? 'button' : undefined}>
      ${quiet && html`<div className="spark-cap"><span>6 מקטעים אחרונים</span><span>הרצועה: הרגיל שלך ${fmt.dec(a)}</span></div>`}
      <svg className="spark" viewBox=${`0 0 ${W} ${H}`} role="img">
        <defs><linearGradient id="spfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--tx)" stopOpacity=".10" /><stop offset="1" stopColor="var(--tx)" stopOpacity="0" /></linearGradient></defs>
        ${a != null && html`<rect className="band" x="0" y=${y(hi)} width=${W} height=${Math.max(2, y(lo) - y(hi))} rx="6" />`}
                ${!quiet && html`<path d=${area} style=${{ fill: 'url(#spfill)' }} />`}
        <path d=${d} fill="none" style=${{ stroke: 'var(--tx)' }} strokeWidth="2.25" strokeLinecap="round" />
        ${!quiet && html`<line className="base" x1="0" x2=${W} y1=${base} y2=${base} />`}
        ${pts.map((p, i) => {
          const last = i === n - 1;
          return html`<g key=${segs[i].id} className="pt" onClick=${() => onPick(segs[i].id)} role="button" aria-label=${`${fmt.short(segs[i].date)}: ${fmt.dec(vals[i])}`}>
            <rect x=${p[0] - 24} y="0" width="48" height=${H} fill="transparent" />
            ${!quiet && html`<text className=${'val' + (last ? ' last ' + toneCls : '')} x=${p[0]} y=${p[1] - 11}>${fmt.dec(vals[i])}</text>`}
            ${(!quiet || last) && html`<circle className=${'dot' + (last ? ' last ' + toneCls : '')} cx=${p[0]} cy=${p[1]} r=${last ? (quiet ? 5 : 6.5) : 4} />`}
            ${!quiet && (!home || last || i === 0) && html`<text x=${p[0]} y=${H - 9} style=${{ textAnchor: 'middle', fontWeight: last ? 700 : 400, fill: last ? 'var(--tx)' : 'var(--tx2)' }}>${fmt.short(segs[i].date)}</text>`}
          </g>`;
        })}
      </svg>
      ${a != null && !quiet && !home && html`<figcaption className="legend" style=${{ marginTop: 2 }}><span><i className="sq" style=${{ width: 16, height: 8, borderRadius: 3, background: 'color-mix(in srgb,var(--plate) 45%,transparent)' }}></i>הטווח הרגיל שלך, סביב <b className="n">${fmt.dec(a)}</b></span><span><i className="sq" style=${{ width: 9, height: 9, borderRadius: '50%', background: tone === 'worse' ? 'var(--worse)' : tone === 'better' ? 'var(--better)' : 'var(--tx)' }}></i>${ev ? 'הטעינה האחרונה' : 'התדלוק האחרון'}</span></figcaption>`}
    </figure>`;
  }


  /* True cost of ownership block: used on Home and in Insights › הוצאות */
  function TcoBlock({ c, A, compact }) {
    const t = c.tco;
    const [per, setPer] = useState('month');
    if (!t || !c.fills.length) return null;
    const parts = t.parts.filter((p) => (p.value || 0) > 0).sort((a, b) => b.value - a.value);
    const total = t.month || 1;
    const yearly = per === 'year';
    const k = yearly ? 12 : 1;
    return html`<button className="tco" onClick=${() => A.sheet('tco')} aria-label="כמה הרכב עולה לך">
      <div className="tco-top">
        <span className="lbl">${t.complete ? 'הרכב עולה לך' : 'הרכב עולה לך, לפחות'}</span>
        ${!t.complete && html`<span className="pill warn">חסר ${t.missing.length === 1 ? t.missing[0].label : t.missing.length + ' פריטים'}</span>`}
      </div>
      <div className="tco-num"><span className="disp n">${fmt.money(t.month * k)}</span><span className="tco-unit tco-per" role="button" aria-label="החלפה בין חודש לשנה" onClick=${(e) => { e.stopPropagation(); setPer(yearly ? 'month' : 'year'); }}>${yearly ? 'בשנה' : 'בחודש'}<${Icon} n="swap" s=${13} /></span></div>
      <div className="tco-sub">כ-<span className="n">${fmt.money(yearly ? t.month : t.year)}</span> ${yearly ? 'בחודש' : 'בשנה'}${t.perKm ? html` · <span className="n">${t.perKm.toFixed(2)}</span> ₪ לק״מ` : ''}</div>
      <div className="tco-bar" aria-hidden="true">${parts.map((p) => html`<i key=${p.id} style=${{ flex: p.value / total, background: p.color }}></i>`)}</div>
      ${!compact && html`<div className="tco-legend">${parts.map((p) => html`<span key=${p.id}><i style=${{ background: p.color }}></i>${p.label} <b className="n">${fmt.money(p.value * k)}</b></span>`)}</div>`}
    </button>`;
  }

  function TcoRow({ c, A, off, discount }) {
    const t = c.tco;
    if (!t || !c.fills.length) return null;
    const parts = t.parts.filter((p) => (p.value || 0) > 0).sort((a, b) => b.value - a.value);
    return html`<button className="tco tco-row" onClick=${() => A.sheet('tco')} aria-label="כמה הרכב עולה לך">
      <div className="tco-line"><span>${t.complete ? 'הרכב עולה לך' : 'הרכב עולה לך, לפחות'}</span><span className="tco-amt"><span className="disp n">${fmt.money(t.month)}</span> <span className="tco-unit">בחודש</span></span><${Icon} n="chev" s=${18} /></div>
      <div className="tco-bar" aria-hidden="true">${parts.map((p) => html`<i key=${p.id} style=${{ flex: p.value / (t.month || 1), background: p.color }}></i>`)}</div>
      <div className="tco-foot"><span>${!t.complete ? `חסר ${t.missing.length === 1 ? t.missing[0].label : t.missing.length + ' פריטים'}` : `כ-${fmt.money(t.year)} בשנה`}</span><span>95 היום <b className="n">${fmt.price(off)}</b>${discount.type !== 'none' ? ' לפני ההנחה' : ''}</span></div>
    </button>`;
  }

  /* ================= HOME ================= */
  function Home({ db, c, A }) {
    const unit = UI.unitFor(db, c);
    const ev = c.ev;
    const v = c.v;
    const hasFills = c.fills.length > 0;
    const segs6 = c.segs.slice(-6);
    const lastTone = c.last && c.avg ? (c.avg / c.last.kmpl - 1 > 0.03 ? 'worse' : c.avg / c.last.kmpl - 1 < -0.03 ? 'better' : '') : '';
    const recent = [...c.recs].filter((r) => ['fill', 'charge', 'service', 'expense'].includes(r.type)).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 2);
    const off = officialFor(now());
    const low = c.level != null && c.level <= c.reserve + 0.02;
    const fuelPart = c.tco && c.tco.parts.find((p) => p.id === 'fuel');
    const cost100 = fuelPart && fuelPart.value > 0 && c.dailyKm > 0 ? (fuelPart.value / (c.dailyKm * 30.4)) * 100 : null;
    /* trio: the month we show money for is the current one, unless nothing was bought yet this month */
    const mo = (() => { const d = now(); const cur = c.monthly[mkey(d)]; if (cur && cur.fuel > 0) return { d, fuel: cur.fuel }; const pd = new Date(d); pd.setDate(1); pd.setMonth(pd.getMonth() - 1); const prev = c.monthly[mkey(pd)]; return prev && prev.fuel > 0 ? { d: pd, fuel: prev.fuel } : { d, fuel: cur ? cur.fuel : 0 }; })();

    const spot = hasFills ? spotlightItems(db, c, A) : [];
    const testDue = v.docs && v.docs.test && v.docs.test.due;
    const fillLine = c.level != null ? `${ev ? 'טעינה' : 'תדלוק'} ${whenStr(c.daysToTarget)} · ${ev ? 'בסוללה' : 'במיכל'} כ-${pct(c.level)}` : '';
    const status = !hasFills ? null
      : low ? (ev ? 'הסוללה נמוכה · כדאי לטעון היום' : 'הדלק נמוך · כדאי לתדלק היום')
      : spot.length ? fillLine
      : `הכל תקין${testDue ? ` · הטסט בתוקף עד ${fmt.dayMon(testDue)}` : ''}`;

    return html`<div className="pad home">
      <div className="home-top">
        <${HeaderBar} db=${db} c=${c} A=${A} />
        ${status && html`<p className="status">${status}</p>`}
      </div>
      <${Spotlight} db=${db} c=${c} A=${A} />

      ${!hasFills && html`<section className="empty">
        <span className="lbl">${v.make} ${v.model} · ${v.year}</span>
        <div className="disp">${ev ? 'מתחילים מהטעינה הבאה' : 'מתחילים מהתדלוק הבא'}</div>
        <p className="muted small">${ev ? 'בפעם הבאה שמחברים לטעינה, הקישו על "טענתי" וסמנו את האחוז לפני ואחרי. כבר מהטעינה השנייה נדע את הצריכה האמיתית.' : 'בפעם הבאה שאתם בתחנה, הקישו על "תדלקתי". אחרי שני תדלוקים מלאים נדע את הצריכה האמיתית.'}</p>
        <button className="btn" onClick=${() => A.fab()}><${Icon} n=${ev ? 'bolt' : 'pump'} />${ev ? 'רישום הטעינה הראשונה' : 'רישום התדלוק הראשון'}</button>
      </section>`}

      ${hasFills && html`<div className="facts" role="list">
        <button role="listitem" onClick=${() => A.tab('vehicle')}><span className="fl">נוסע ביום<small>${c.latest ? html`כ-<span className="n">${fmt.int(c.dailyKm * 30)}</span> ק״מ בחודש` : 'אחרי כמה רישומים'}</small></span><i className="ld"></i><span className="fv"><span className="n">${c.latest ? fmt.int(c.dailyKm) : '—'}</span><u>ק״מ</u></span></button>
        <button role="listitem" onClick=${() => A.tab('insights', { tab: 'spend' })}><span className="fl">${ev ? 'חשמל' : 'דלק'} ב${TM.MONTHS[mo.d.getMonth()]}<small>${c.avgMonthFuel != null ? html`בד״כ <span className="n">${fmt.money(c.avgMonthFuel)}</span> בחודש` : 'עד עכשיו'}</small></span><i className="ld"></i><span className="fv"><span className="n">${fmt.money(mo.fuel)}</span></span></button>
        ${ev
          ? html`<button role="listitem" onClick=${() => A.tab('insights', { tab: 'price' })}><span className="fl">חשמל ל-100 ק״מ<small>${c.homeShare != null ? html`<span className="n">${Math.round(c.homeShare * 100)}%</span> מהטעינות בבית` : 'לפי הטעינות האחרונות'}</small></span><i className="ld"></i><span className="fv"><span className="n">${cost100 != null ? fmt.money(cost100) : '—'}</span></span></button>`
          : html`<button role="listitem" onClick=${() => A.sheet('price')}><span className="fl">בנזין 95 היום<small>${db.settings.discount.type !== 'none' ? 'המחיר המרבי, לפני ההנחה שלך' : 'המחיר המרבי בתחנות'}</small></span><i className="ld"></i><span className="fv"><span className="n">${fmt.price(off)}</span><u>לליטר</u></span></button>`}
      </div>`}

      <${TcoBlock} c=${c} A=${A} />

      ${c.last ? html`<section className="home-cons">
          <button className="cons" onClick=${() => A.sheet('segment', { id: c.last.id })}>
            <span className="lbl" style=${{ display: 'flex', alignItems: 'center', gap: 6 }}>${ev ? 'צריכה מאז הטעינה הקודמת' : 'צריכה בתדלוק האחרון'}<span className="ib ghost" role="button" tabIndex="0" aria-label="פרטי מדידת הצריכה" style=${{ width: 28, height: 28, minHeight: 0 }} onClick=${(e) => { e.stopPropagation(); A.sheet('measure'); }}><${Icon} n="info" s=${16} /></span></span>
            <div className="cons-row"><span className="disp big n" style=${{ fontSize: 56 }}>${consStr(c.last.kmpl, unit)}</span><span className="unit" style=${{ paddingBottom: 6 }}>${consUnit(unit)}</span></div>
            <${ConsCompare} seg=${c.last} avg=${c.avg} unit=${unit} ev=${ev} />
          </button>
          <${ConsSpark} segs=${segs6} avg=${c.avg} unit=${unit} tone=${lastTone} ev=${ev} home onPick=${(id) => A.sheet('segment', { id })} />
          <div className="spark-cap"><span>${segs6.length} ${ev ? 'טעינות' : 'תדלוקים'} אחרונים</span>${c.avg ? html`<span>הרגיל שלך <b className="n">${consStr(c.avg, unit)}</b></span>` : ''}</div>
        </section>`
      : hasFills && html`<section className="empty">
          <span className="lbl">צריכה</span>
          <div className="disp" style=${{ fontSize: 36 }}>${ev ? 'עוד טעינה אחת ונדע' : 'עוד תדלוק מלא אחד ונדע'}</div>
          <div className="progress"><i style=${{ width: c.lastFull ? '50%' : '10%' }}></i></div>
          <p className="muted small">${c.lastFull ? 'הטנק המלא הראשון כבר רשום. בפעם הבאה שתמלאו עד הסוף, נחשב כמה נסעתם על כל ליטר.' : 'צריכה נמדדת בין שני תדלוקים עד הסוף. תדלוקים חלקיים נשמרים ומצטרפים לחישוב.'}</p>
        </section>`}


      ${hasFills && html`<button className="next" onClick=${() => A.sheet(ev ? 'battery' : 'tank')} aria-label=${ev ? 'הטעינה הבאה · פרטים' : 'התדלוק הבא · פרטים'}>
        <span className="lbl">${ev ? (low ? 'הסוללה נמוכה' : 'הטעינה הבאה') : (low ? 'הדלק עומד להיגמר' : 'התדלוק הבא')}</span>
        ${c.level == null
          ? html`<div className="disp when" style=${{ fontSize: 40 }}>${ev ? 'כמה אחוז בסוללה?' : 'כמה דלק יש עכשיו?'}</div><p>${ev ? 'הקישו כדי לסמן את האחוז מהמסך ברכב, ונחשב מתי לחבר.' : 'הקישו כדי לסמן את מחוון הדלק, ונחשב מתי לתדלק.'}</p>`
          : html`<div className="disp when" style=${{ fontSize: 44 }}>${whenText(c.daysToTarget)}</div>
            <div style=${{ display: 'grid', gap: 6 }}>
              <${Ticks} level=${c.level} habit=${c.habit} low=${low} habitLabel=${c.habit != null ? (ev ? 'כאן בד״כ טוענים' : 'כאן בד״כ מתדלקים') : null} />
              <div className="gk"><span>${ev ? '0%' : 'E'}</span><span>${ev ? 'בסוללה' : 'במיכל'} כ-${pct(c.level)} · כ-${fmt.int(c.kmLeft)} ק״מ</span><span>${ev ? '100%' : 'F'}</span></div>
            </div>
`}
        <span className="more"><span>${c.level < 0.03 ? (ev ? 'הסוללה כמעט ריקה?' : 'המיכל כמעט ריק?') : c.basis === 'obs' ? (ev ? 'לפי האחוז שסימנת' : 'לפי המחוון שסימנת') : ev ? 'לפי הטעינה האחרונה ומה שנסעת מאז' : 'לפי התדלוק האחרון ומה שנסעת מאז'}</span><span>עדכון ›</span></span>
      </button>`}

      ${recent.length > 0 && html`<section className="recent">
        <div className="recent-h"><span className="lbl">לאחרונה</span><button className="linkbtn" onClick=${() => A.tab('journal')}>היומן המלא ›</button></div>
        ${recent.map((r) => html`<${EntryRow} key=${r.id} r=${r} c=${c} unit=${unit} A=${A} db=${db} />`)}
      </section>`}


    </div>`;
  }

  /* entry row (shared by home + journal) */
  function EntryRow({ r, c, unit, A, db }) {
    const dt = new Date(r.date);
    const day = html`<div className="day"><b className="n">${dt.getDate()}</b><small>${TM.MS[dt.getMonth()]}</small></div>`;
    const w = db ? db.writes.find((x) => x.recId === r.id && x.state !== 'synced') : null;
    const state = w ? (w.state === 'rejected' ? html` · <span className="flag">דורש בדיקה</span>` : ' · ממתין לאישור') : '';
    if (r.type === 'fill') {
      const seg = c.segs.find((s) => s.id === r.id);
      const st = station(r.station);
      const odd = seg && c.anomalies.has(seg.id);
      return html`<button className="entry" onClick=${() => A.sheet('entry', { id: r.id })}>
        ${day}<${Badge} st=${r.station} />
        <span className="t"><b>${st.name}</b><small><span className="n">${fmt.dec(r.liters)}</span> ל׳${seg ? html` · <span className=${'n' + (odd ? ' flag' : '')}>${consStr(seg.kmpl, unit)}</span> ${consUnitShort(unit)}${odd ? html` <span className="flag">· כדאי לבדוק</span>` : ''}` : r.full ? '' : ' · חלקי'}${r.missedBefore ? ' · אחרי תדלוקים שלא נרשמו' : ''}${state}</small></span>
        <span className="amt n">${fmt.money(r.total)}</span>
      </button>`;
    }
    if (r.type === 'trip') return html`<button className="quiet" onClick=${() => A.sheet('trip', { id: r.id })}>נסיעה מתוכננת: <span className="n">${fmt.int(r.km)}</span> ק״מ · ${fmt.dayMon(dt)}</button>`;
    if (r.type === 'charge') {
      const seg = c.segs.find((s) => s.id === r.id);
      const pl = TM.chargePlace(r.where);
      return html`<button className="entry" onClick=${() => A.sheet('entry', { id: r.id })}>
        ${day}<span className="badge" style=${{ background: pl.color }}><${Icon} n="bolt" /></span>
        <span className="t"><b>${r.station || pl.label}</b><small><span className="n">${fmt.dec(r.kwh)}</span> kWh · <span className="n">${r.socFrom}→${r.socTo}%</span></small></span>
        <span className="amt n">${fmt.money(r.total)}</span>
      </button>`;
    }
    if (r.type === 'service' || r.type === 'expense') {
      const suspicious = r.odo && c.latest && r.odo > c.latest.odo + 2000;
      return html`<button className="entry" onClick=${() => A.sheet('entry', { id: r.id })}>
        ${day}<span className="badge t"><${Icon} n=${TM.kindIcon(r)} /></span>
        <span className="t"><b>${r.label}</b><small>${r.type === 'service' ? 'טיפול' : r.refund ? 'החזר' : 'הוצאה'}${r.excluded ? ' · לא בעלות הרכב' : ''}${r.odo ? html` · <span className=${'n' + (suspicious ? ' flag' : '')}>${fmt.int(r.odo)}</span> ק״מ${suspicious ? html` <span className="flag">· כדאי לבדוק</span>` : ''}` : ''}${r.garage ? ' · ' + r.garage : r.note ? ' · ' + r.note : ''}${state}</small></span>
        <span className=${'amt n' + (r.refund ? ' better' : '')}>${r.cost == null ? '—' : fmt.money(r.refund ? -r.cost : r.cost)}</span>
      </button>`;
    }
    if (r.type === 'odo') return html`<button className="quiet" onClick=${() => A.sheet('entry', { id: r.id })}>קילומטראז׳ עודכן ל-<span className="n">${fmt.int(r.odo)}</span> · ${fmt.dayMon(dt)}</button>`;
    if (r.type === 'tank') return html`<button className="quiet" onClick=${() => A.sheet('entry', { id: r.id })}>סימנת מחוון דלק: ${pct(r.level)} · ${fmt.dayMon(dt)}</button>`;
    return null;
  }

  /* ================= FILL-UP FORM ================= */
  function FillForm({ db, c, A, p }) {
    if (c.ev) return html`<${EV.ChargeForm} db=${db} c=${c} A=${A} p=${p} />`;
    const editing = p.id ? db.records.find((r) => r.id === p.id) : null;
    const v = c.v;
    const disc = db.settings.discount;
    const FUEL_KEY = { '98': '98', 'סולר': 'diesel', 'אחר': 'other' };
    const suggestPrice = (dt, stationId) => {
      const lastPaid = [...c.fills].reverse()[0];
      let base = v.fuel === '95' ? officialFor(dt) : (db.adminPrices[FUEL_KEY[v.fuel]] || {}).value ?? (lastPaid ? lastPaid.price : 7.5);
      if (disc.type === 'agorot') base = Math.max(0, base - disc.value / 100);
      if (disc.type === 'percent') base = base * (1 - disc.value / 100);
      const adj = (db.settings.stationAdjust || {})[stationId || TM.STATIONS[0].id];
      return adj ? Math.max(0, base - adj / 100) : base;
    };
    const nearest = TM.STATIONS[0];
    const regulated = v.fuel === '95';
    const draftKey = 'fill:' + v.id;
    const saved = !editing && !p.scan && !p.receipt ? DRAFTS[draftKey] : null;
    const fresh = () => ({
      total: '', liters: '', price: fmt.dec(suggestPrice(now()), 2), odo: '', typed: { total: false, liters: false, price: false },
      full: true, date: isoLocal(now()), station: nearest.id, pre: null, post: null, reason: null, missed: false, note: '', open: false,
    });
    const [f, setF] = useState(() => editing ? {
      total: String(editing.total), liters: String(editing.liters), price: String(editing.price), odo: String(editing.odo),
      typed: { total: true, liters: true, price: true }, full: editing.full, date: editing.date, station: editing.station,
      pre: editing.pre ?? null, post: editing.post ?? null, reason: editing.reason || null, missed: !!editing.missedBefore, note: editing.note || '', open: false,
    } : saved ? { ...saved, open: false } : fresh());
    const [restored, setRestored] = useState(!!saved);
    const [tried, setTried] = useState(false);
    const [shake, setShake] = useState(false);
    const totalRef = useRef(null);
    useEffect(() => { if (!editing && !p.scan && totalRef.current) totalRef.current.focus({ preventScroll: true }); }, []);
    useEffect(() => { if (p.scan) A.sheet('scan', { onResult: applyScan }); if (p.receipt) A.sheet('receipt', { onResult: applyReceipt }); }, []);
    // the draft lives on the device until it is saved or thrown away
    useEffect(() => { if (!editing) { if (f.total || f.liters || f.odo || f.note) DRAFTS[draftKey] = f; else delete DRAFTS[draftKey]; } }, [f]);

    const set = (k, val) => setF((s) => ({ ...s, [k]: val }));
    const dropDraft = () => { delete DRAFTS[draftKey]; setF(fresh()); setRestored(false); A.toast('הטיוטה נמחקה'); };
    const num = (s) => (s === '' || s == null || isNaN(Number(s)) ? null : Number(s));

    // receipt ownership: a typed figure never moves; the untyped one is derived.
    const T = num(f.total), L = num(f.liters), P = num(f.price);
    let derived = null, vals = { total: T, liters: L, price: P };
    if (f.typed.total && f.typed.liters && !f.typed.price && T && L) { derived = 'price'; vals.price = T / L; }
    else if (f.typed.total && !f.typed.liters && T && P) { derived = 'liters'; vals.liters = T / P; }
    else if (f.typed.liters && !f.typed.total && L && P) { derived = 'total'; vals.total = L * P; }
    const conflict = f.typed.total && f.typed.liters && f.typed.price && T && L && P && Math.abs(T - L * P) > 0.6;

    const show = (k) => (derived === k && vals[k] != null ? fmt.dec(vals[k], 2) : f[k]);
    const onField = (k) => (s) => setF((st) => {
      const typed = { ...st.typed, [k]: s !== '' };
      // editing a derived value: it becomes the user's figure and the previously derived slot frees up
      const next = { ...st, [k]: s, typed };
      if (k !== 'price' && typed.total && typed.liters && typed.price) next.typed = { ...typed, price: false };
      return next;
    });

    const odo = num(f.odo);
    const bounds = odoBounds(db, v.id, f.date, editing ? editing.id : null);
    let odoErr = null;
    if (odo != null) {
      if (bounds.lo != null && odo <= bounds.lo) odoErr = bounds.hi != null ? `הזינו בין ${fmt.int(bounds.lo + 1)} ל-${fmt.int(bounds.hi - 1)}` : `הקילומטראז׳ האחרון היה ${fmt.int(bounds.lo)}`;
      else if (bounds.hi != null && odo >= bounds.hi) odoErr = `הזינו בין ${fmt.int((bounds.lo || 0) + 1)} ל-${fmt.int(bounds.hi - 1)}`;
    }
    const missing = { total: !vals.total, liters: !vals.liters, odo: odo == null };
    const valid = !missing.total && !missing.liters && !missing.odo && !odoErr && vals.price > 0;

    const draft = valid ? { id: editing ? editing.id : '__draft', v: v.id, type: 'fill', date: f.date, odo, liters: vals.liters, total: vals.total, price: vals.price, full: f.full, station: f.station, missedBefore: f.missed } : null;
    const ev = draft ? evaluateDraft(db, v.id, draft) : null;
    const softWarn = [];
    if (vals.liters && vals.liters > v.tank * 1.05) softWarn.push(`${fmt.dec(vals.liters)} ל׳ זה יותר מהמיכל (${v.tank} ל׳). אפשר לשמור בכל זאת.`);
    if (ev && ev.seg && (ev.seg.kmpl > (v.mfr || 15) * 1.7 || ev.seg.kmpl < 4)) softWarn.push(`${consStr(ev.seg.kmpl, db.settings.unit)} ${consUnitShort(db.settings.unit)} נראה לא סביר. כדאי לבדוק את הקילומטראז׳.`);
    if (odo != null && bounds.lo != null && !odoErr && odo - bounds.lo > 1500) softWarn.push(`${fmt.int(odo - bounds.lo)} ק״מ מאז הרישום הקודם. פספסתם תדלוק? אפשר לסמן בפרטים הנוספים.`);

    const lastPt = bounds.lo;
    const st = station(f.station);
    const dt = new Date(f.date);
    const isToday = new Date(now()).toDateString() === dt.toDateString();

    function applyScan(r) {
      setF((s) => ({ ...s, total: r.total, liters: r.liters, odo: r.odo, typed: { total: true, liters: true, price: false } }));
      A.toast('הצילום הועבר לטופס. בדקו את הספרות לפני השמירה.');
    }
    function applyReceipt(r) {
      setF((s) => ({ ...s, total: r.total != null ? String(r.total) : s.total, liters: r.liters != null ? String(r.liters) : s.liters, typed: { total: r.total != null, liters: r.liters != null, price: false }, date: r.date ? `${r.date}T${r.time || '12:00'}` : s.date, full: null, open: true }));
    }
    // a full tank from a known level tells us how big the tank really is
    const capHint = f.full && f.pre != null && vals.liters && vals.liters > (1 - f.pre) * v.tank * 1.12 ? Math.round(vals.liters / Math.max(0.05, 1 - f.pre)) : null;
    const tankStateMissing = f.full == null;

    function save() {
      setTried(true);
      if (!valid) { setShake(true); setTimeout(() => setShake(false), 420); return; }
      const rec = { ...(editing || {}), id: editing ? editing.id : uid(), v: v.id, type: 'fill', date: f.date, odo, liters: Math.round(vals.liters * 100) / 100, total: Math.round(vals.total * 100) / 100, price: Math.round(vals.price * 1000) / 1000, full: f.full === true, tankUnknown: f.full == null, station: f.station, pre: f.pre, post: f.full ? null : f.post, reason: f.reason, missedBefore: f.missed, note: f.note };
      delete DRAFTS[draftKey];
      A.upsert(rec, editing ? 'עריכת תדלוק' : 'תדלוק חדש');
      if (editing) { A.back(); A.toast('התדלוק עודכן. כל החישובים עודכנו.'); }
      else A.replace('saved', { id: rec.id });
    }

    return html`<div className="pad noTabs" style=${{ gap: 16 }}>
      <div className="top">
        <button className="ib" aria-label="סגירה" onClick=${A.back}><${Icon} n="x" /></button>
        <span className="ttl" style=${{ fontSize: editing ? 34 : 40 }}>${editing ? 'עריכת תדלוק' : 'תדלוק חדש'}</span>
        <div style=${{ display: 'flex', gap: 6 }}>
          <button className="ib" aria-label="ייבוא קבלה מקובץ או טקסט" onClick=${() => A.sheet('receipt', { onResult: applyReceipt })}><${Icon} n="receipt" /></button>
          <button className="ib" aria-label="צילום המשאבה ולוח הקילומטרים" onClick=${() => A.sheet('scan', { onResult: applyScan })}><${Icon} n="cam" /></button>
        </div>
      </div>
      ${restored && html`<div className="row" style=${{ padding: '6px 0', borderBottom: 0 }}><span className="grow"><b>הטיוטה שלכם שוחזרה</b><small>מה שהקלדתם קודם נשאר כאן</small></span><button className="chip" onClick=${dropDraft}>מחיקת טיוטה</button></div>`}
      <div className="chips">
        <button className="chip" onClick=${() => set('open', true)}><${Icon} n="clock" />${isToday ? 'היום' : fmt.dayMon(dt)}, ${fmt.time(dt)}</button>
        <button className="chip" onClick=${() => A.sheet('station', { value: f.station, onPick: (id) => setF((st) => ({ ...st, station: id, price: st.typed.price ? st.price : fmt.dec(suggestPrice(new Date(st.date), id), 2) })) })}><${Icon} n="pin" />${st.name}${!editing && f.station === nearest.id ? html`<small>· לפי מיקום</small>` : ''}</button>
        ${!regulated && html`<span className="chip dash" style=${{ pointerEvents: 'none' }}>${TM.fuelLabel(v)}</span>`}
      </div>

      <div className=${'pump' + (shake ? ' shake' : '')} role="group" aria-label="נתוני המשאבה">
        <div className="prow">
          <label htmlFor="f-total">סכום</label>
          <div className="pv"><span className="u">₪</span><${NumInput} id="f-total" inputRef=${totalRef} placeholder="0.00" value=${show('total')} onChange=${onField('total')} /></div>
          ${derived === 'total' ? html`<span className="s auto">חושב: ${fmt.dec(vals.liters)} ל׳ × ${fmt.price(vals.price)}</span>` : tried && missing.total ? html`<span className="s err">חסר סכום</span>` : null}
        </div>
        <div className="prow">
          <label htmlFor="f-liters">ליטרים</label>
          <div className="pv"><${NumInput} id="f-liters" placeholder="0.00" value=${show('liters')} onChange=${onField('liters')} /><span className="u">ל׳</span></div>
          ${derived === 'liters' ? html`<span className="s auto">חושב לפי ${fmt.price(vals.price)} לליטר · הקלידו לשינוי</span>` : tried && missing.liters ? html`<span className="s err">חסרים ליטרים</span>` : null}
        </div>
        <div className="prow">
          <label htmlFor="f-price">מחיר לליטר</label>
          <div className="pv"><span className="u">₪</span><${NumInput} id="f-price" decimals=${3} placeholder="0.00" value=${derived === 'price' ? fmt.dec(vals.price, 2) : f.price} onChange=${onField('price')} style=${{ fontSize: 24 }} /></div>
          <span className="s">${derived === 'price' ? 'חושב מהסכום והליטרים' : f.typed.price ? 'המחיר שהקלדתם' : !regulated ? `ל${TM.fuelLabel(v)} אין מחיר מפוקח · ${(db.adminPrices[TM.FUEL_KEY[v.fuel]] || {}).value ? 'מחירון הרשת' : 'המחיר הקודם ששילמתם'} · הקלידו את מחיר המשאבה` : disc.type !== 'none' ? 'מחיר מרבי אחרי ההנחה שלך' : 'מחיר מרבי 95 החודש · אפשר לשנות'}</span>
        </div>
        <div className="prow">
          <label htmlFor="f-odo">קילומטראז׳</label>
          <div className="pv"><${NumInput} id="f-odo" decimals=${0} placeholder=${lastPt ? fmt.int(lastPt + 250).replace(/,/g, '') : '0'} value=${f.odo} onChange=${(s) => set('odo', s)} /><span className="u">ק״מ</span></div>
          ${odoErr ? html`<span className="s err">${odoErr}</span>` : tried && missing.odo ? html`<span className="s err">חסר קילומטראז׳</span>` : odo != null && lastPt ? html`<span className="s">+${fmt.int(odo - lastPt)} ק״מ מהרישום הקודם</span>` : lastPt ? html`<span className="s">אחרון: ${fmt.int(lastPt)}</span>` : null}
        </div>
      </div>
      ${conflict && html`<div className="warnbox"><${Icon} n="alert" />הסכום, הליטרים והמחיר לא מסתדרים. נשמור את מה שהקלדתם, בלי לשנות אף מספר.</div>`}

      <div style=${{ display: 'grid', gap: 10 }}>
        <${Seg} big label="מצב המיכל בסוף התדלוק" value=${f.full} onChange=${(x) => set('full', x)} options=${[{ v: true, l: 'מילאתי עד הסוף' }, { v: false, l: 'תדלוק חלקי' }]} />
        ${tankStateMissing && html`<span className="note">מצב המיכל לא צוין · אפשר לשמור כך, והתדלוק ייספר בכסף אבל לא במדידת הצריכה.</span>`}
        ${f.full === false && html`<div className="level"><span className="lbl">מצב המיכל אחרי התדלוק <span className="muted" style=${{ fontWeight: 400 }}>(לא חובה)</span></span><${Ticks} level=${f.post} onPick=${(x) => set('post', f.post === x ? null : x)} /><div className="gk"><span>E</span><span>${f.post != null ? pct(f.post) : vals.liters && f.pre != null ? `לפי הסימון והכמות יוצא כ-${pct(Math.min(1, f.pre + vals.liters / v.tank))}` : 'הקישו על המחוון · משפר את התחזית'}</span><span>F</span></div></div>`}
        ${capHint && html`<div className="warnbox"><${Icon} n="alert" />נראה שנפח המיכל גדול מההערכה (${v.tank} ל׳): נכנסו ${fmt.dec(vals.liters)} ל׳ ממצב של ${pct(f.pre)}. <button className="linkbtn" onClick=${() => A.sheet('capacity', { suggest: capHint, liters: vals.liters, pre: f.pre })}>בדיקת נפח המיכל ›</button></div>`}
      </div>

      <div className="preview" aria-live="polite">
        ${!draft ? html`<span>מלאו סכום וק״מ ונראה מה יצא</span>`
          : ev.seg ? html`<b className="n">${consStr(ev.seg.kmpl, db.settings.unit)}</b><span>${consUnit(db.settings.unit)} צפוי למקטע הזה</span>`
          : f.full == null ? html`<span>מצב המיכל לא ידוע · נשמור את הסכום והליטרים, בלי מדידת צריכה</span>`
          : !f.full ? html`<span>תדלוק חלקי: ${fmt.dec(vals.liters)} ל׳ יצטרפו לחישוב בטנק המלא הבא</span>`
          : html`<span>טנק מלא ראשון${f.missed ? ' אחרי פספוס' : ''}: מכאן נתחיל למדוד</span>`}
      </div>
      ${softWarn.map((w, i) => html`<div key=${i} className="warnbox"><${Icon} n="alert" />${w}</div>`)}

      <button className=${'disclosure' + (f.open ? ' open' : '')} aria-expanded=${f.open} onClick=${() => set('open', !f.open)}>
        <span>עוד פרטים<small>תאריך, מחוון דלק, סיבה, רצף תדלוקים, הערה</small></span><${Icon} n="down" />
      </button>
      ${f.open && html`<div style=${{ display: 'grid', gap: 18 }}>
        <div className="field"><label htmlFor="f-date">מתי</label><input id="f-date" className="inp n" type="datetime-local" value=${f.date} max=${isoLocal(now())} onChange=${(e) => set('date', e.target.value)} /></div>
        <div className="level">
          <span className="lbl">כמה היה במיכל לפני התדלוק? <span className="muted" style=${{ fontWeight: 400 }}>(לא חובה)</span></span>
          <${Ticks} level=${f.pre} onPick=${(x) => set('pre', f.pre === x ? null : x)} />
          <div className="gk"><span>E</span><span>${f.pre != null ? pct(f.pre) : 'הקישו על המחוון'}</span><span>F</span></div>
        </div>
        <div className="field"><span className="lbl">למה תדלקת? <span className="muted" style=${{ fontWeight: 400 }}>(לא חובה)</span></span><div className="chips">${TM.REASONS.map((r) => html`<button key=${r.id} className=${'chip' + (f.reason === r.id ? ' on' : '')} onClick=${() => set('reason', f.reason === r.id ? null : r.id)}>${r.label}</button>`)}</div></div>
        <div className="row" style=${{ borderTop: '1px solid var(--ln)' }}>
          <span className="grow"><b>פספסתי תדלוקים לפני זה</b><small>נתחיל מדידה חדשה מכאן, וההיסטוריה נשארת</small></span>
          <${Toggle} on=${f.missed} label="פספסתי תדלוקים" onChange=${(x) => set('missed', x)} />
        </div>
        <div className="field"><label htmlFor="f-note">הערה</label><textarea id="f-note" className="inp" placeholder="למשל: שטיפה כלולה" value=${f.note} onChange=${(e) => set('note', e.target.value)}></textarea></div>
      </div>`}
      ${editing && html`<button className="btn danger sm" onClick=${() => A.confirmDelete(editing.id, true)}><${Icon} n="trash" />מחיקת התדלוק</button>`}
      <div className="bottomBar"><button className="btn" onClick=${save}>${editing ? 'שמירת שינויים' : 'שמירת תדלוק'}</button></div>
    </div>`;
  }
  const DRAFTS = {};

  /* ================= SAVED (post-save reveal) ================= */
  function Saved({ db, c, A, p }) {
    const rec = db.records.find((r) => r.id === p.id);
    const [left, setLeft] = useState(5);
    const [ans, setAns] = useState(rec && rec.pumpConfirmed != null ? 'done' : null);
    const [pumpPrice, setPumpPrice] = useState('');
    const [scope, setScope] = useState('once');
    useEffect(() => { const t = setInterval(() => setLeft((x) => Math.max(0, x - 1)), 1000); return () => clearInterval(t); }, []);
    if (!rec) return html`<div className="pad"><${Top} onBack=${A.back} title="" /><p>הרשומה בוטלה.</p></div>`;
    const unit = UI.unitFor(db, c);
    const ev = c.ev;
    const seg = c.segs.find((s) => s.id === rec.id);
    const isBest = seg && c.best && c.best.id === seg.id && c.segs.length >= 3;
    const firstFull = !seg && (ev ? true : rec.full);
    const isPublicCharge = ev && (rec.where === 'ac' || rec.where === 'dc');
    let sub = '';
    if (seg && c.avg) {
      const d = seg.kmpl / c.avg - 1;
      sub = isBest ? 'השיא שלך עד היום' : Math.abs(d) < 0.03 ? 'בדיוק כמו הממוצע שלך' : d > 0 ? `${pct(d)} יותר טוב מהממוצע שלך` : `${pct(-d)} פחות טוב מהממוצע שלך`;
    }
    const undo = () => { A.removeRecord(rec.id, true); A.back(); A.toast(ev ? 'הטעינה בוטלה' : 'התדלוק בוטל'); };
    const answer = (yes) => {
      if (yes) { A.patch(rec.id, { pumpConfirmed: true }); setAns('done'); }
      else setAns('no');
    };
    return html`<div className="yellow"><div className="pad noTabs" style=${{ gap: 16 }}>
      <div className="top"><span className="stamp"><i>✓</i>נשמר</span><button className="ib" aria-label="סגירה" onClick=${A.back}><${Icon} n="x" /></button></div>
      ${seg ? html`<div>
          <div className="disp hero-n n">${consStr(seg.kmpl, unit)}</div>
          <div style=${{ fontWeight: 700, fontSize: 18 }}>${consUnit(unit)} במקטע שנסגר</div>
          <div style=${{ fontSize: 15, marginTop: 2 }}>${sub}</div>
        </div>
        <div className="cmp">
          <div><span>הממוצע שלך</span><b className="n">${consStr(c.avg, unit)}</b></div>
          ${c.v.mfr && html`<div><span>נתון היצרן</span><b className="n">${consStr(c.v.mfr, unit)}</b></div>`}
          <div><span>המקטע</span><b><span className="n">${fmt.int(seg.km)}</span> ק״מ · <span className="n">${fmt.dec(seg.liters)}</span> ${ev ? 'kWh' : 'ל׳'}</b></div>
          <div><span>עלות לק״מ במקטע</span><b><span className="n">${Math.round((seg.cost / seg.km) * 100)}</span> אג׳</b></div>
        </div>`
      : html`<div>
          <div className="disp n" style=${{ fontSize: 150 }}>${ev ? fmt.dec(rec.kwh) : fmt.dec(rec.liters)}</div>
          <div style=${{ fontWeight: 700, fontSize: 18 }}>${ev ? 'kWh' : 'ליטרים'} · ${fmt.money(rec.total)}</div>
          <p style=${{ fontSize: 15, marginTop: 8, maxWidth: '30ch' }}>${ev ? 'הטעינה הראשונה נרשמה. כבר בטעינה הבאה נדע כמה נסעת על כל kWh.' : firstFull ? 'נקודת ההתחלה נקבעה. בטנק המלא הבא נדע כמה נסעת על כל ליטר.' : 'תדלוק חלקי נשמר. הליטרים יצטרפו לחישוב כשתמלאו עד הסוף.'}</p>
        </div>`}

      ${ans === null && (!ev || isPublicCharge) && html`<div className="ask">
        <p>${ev ? `המחיר בעמדה היה ${fmt.price(rec.pricePerKwh)} ל-kWh?` : `המחיר במשאבה היה ${fmt.price(rec.price)}?`}</p>
        <div className="two"><button className="y" onClick=${() => answer(true)}>כן</button><button onClick=${() => answer(false)}>לא, היה אחר</button></div>
        <small>${ev ? 'עוזר לנהגים אחרים לדעת כמה עולה טעינה בעמדה הזו.' : `עוזר לנהגים אחרים לדעת כמה עולה דלק ב${station(rec.station).name}.`}</small>
      </div>`}
      ${ans === 'no' && html`<div className="ask">
        <p>מה המחיר שהיה כתוב במשאבה?</p>
        <div style=${{ display: 'flex', gap: 8 }}>
          <div className="inp-wrap" style=${{ flex: 1 }}><${NumInput} className="inp n" placeholder=${fmt.dec(rec.price, 2)} value=${pumpPrice} onChange=${setPumpPrice} style=${{ background: '#fff', color: '#111' }} /><span className="unit">₪ לליטר</span></div>
          <button className="y" style=${{ padding: '0 18px' }} onClick=${() => { if (Number(pumpPrice) > 0) { const diff = Math.round((Number(pumpPrice) - rec.price) * 100); A.patch(rec.id, { pumpConfirmed: false, pumpPrice: Number(pumpPrice) }); if (scope === 'station' && diff > 0) A.setStationAdjust(rec.station, diff); setAns('done'); A.toast(scope === 'station' ? 'ההתאמה האישית נשמרה לתדלוקים הבאים כאן.' : 'ההתאמה נשמרה לתדלוק הזה בלבד.'); } }}>שמירה</button>
        </div>
        ${Number(pumpPrice) > rec.price && html`<div className="two" style=${{ marginTop: 8 }}><button className=${scope === 'once' ? 'y' : ''} onClick=${() => setScope('once')}>רק לתדלוק הזה</button><button className=${scope === 'station' ? 'y' : ''} onClick=${() => setScope('station')}>${Math.round((Number(pumpPrice) - rec.price) * 100)} אג׳ הנחה ב${station(rec.station).name}</button></div>`}
        <small>ההפרש יירשם כהנחה או התאמה אישית, ולא כמחיר התחנה.</small>
      </div>`}
      ${ans === 'done' && html`<p style=${{ fontWeight: 600 }}>תודה. זה עוזר לכולם.</p>`}

      <div className="bottomBar" style=${{ background: 'linear-gradient(to top,var(--plate) 70%,transparent)' }}>
        <button className="btn ink" onClick=${A.back}>סיום</button>
        ${left > 0 && html`<button className="link" onClick=${undo}>ביטול השמירה (${left})</button>`}
      </div>
    </div></div>`;
  }

  /* ================= JOURNAL ================= */
  const FILTERS = [{ v: 'all', l: 'הכל' }, { v: 'fill', l: 'תדלוקים' }, { v: 'service', l: 'טיפולים' }, { v: 'expense', l: 'הוצאות' }, { v: 'issue', l: 'תקלות' }, { v: 'odo', l: 'ק״מ ומחוון' }];
  const J_PERIODS = [{ v: 'all', l: 'כל התקופה' }, { v: 'month', l: 'החודש' }, { v: 'year', l: 'השנה' }, { v: '3', l: '3 חודשים' }, { v: '6', l: '6 חודשים' }, { v: '12', l: '12 חודשים' }];
  const PAGE = 25;
  function Journal({ db, c, A, p }) {
    const [filter, setFilter] = useState(p.filter || 'all');
    const [period, setPeriod] = useState(p.year ? 'year:' + p.year : 'all');
    const [q, setQ] = useState('');
    const [searching, setSearching] = useState(false);
    const [shown, setShown] = useState(PAGE);
    const unit = UI.unitFor(db, c);
    const nowD = now();
    const from = period === 'all' ? null : period === 'month' ? new Date(nowD.getFullYear(), nowD.getMonth(), 1) : period === 'year' ? new Date(nowD.getFullYear(), 0, 1) : period.startsWith('year:') ? new Date(Number(period.slice(5)), 0, 1) : new Date(new Date(nowD).setMonth(nowD.getMonth() - Number(period)));
    const to = period.startsWith('year:') ? new Date(Number(period.slice(5)) + 1, 0, 1) : null;
    const inPeriod = (d) => (!from || d >= from) && (!to || d < to);
    let list = [...c.recs].filter((r) => r.type !== 'trip' || inPeriod(new Date(r.date))).sort((a, b) => new Date(b.date) - new Date(a.date));
    const issues = db.issues.filter((i) => i.v === c.v.id).map((i) => ({ ...i, type: 'issue', date: i.date }));
    if (filter === 'issue') list = issues.sort((a, b) => new Date(b.date) - new Date(a.date));
    else if (filter !== 'all') list = list.filter((r) => (filter === 'odo' ? r.type === 'odo' || r.type === 'tank' : filter === 'fill' ? r.type === 'fill' || r.type === 'charge' : r.type === filter));
    list = list.filter((r) => inPeriod(new Date(r.date)));
    if (q.trim()) {
      const sq = q.trim();
      list = list.filter((r) => (r.type === 'fill' && station(r.station).name.includes(sq)) || (r.label || '').includes(sq) || (r.title || '').includes(sq) || (r.note || '').includes(sq) || (r.garage || '').includes(sq));
    }
    const money = list.filter((r) => ['fill', 'charge', 'service', 'expense'].includes(r.type));
    const known = money.reduce((sum, r) => sum + (r.type === 'fill' || r.type === 'charge' ? r.total : r.cost == null ? 0 : r.refund ? -r.cost : r.cost), 0);
    const unknown = money.filter((r) => (r.type === 'service' || r.type === 'expense') && r.cost == null).length;
    const pendingN = db.writes.filter((w) => w.state === 'pending').length, failedN = db.writes.filter((w) => w.state === 'rejected').length;
    const visible = list.slice(0, shown);
    const groups = [];
    for (const r of visible) {
      const k = mkey(new Date(r.date));
      let g = groups[groups.length - 1];
      if (!g || g.k !== k) { g = { k, items: [] }; groups.push(g); }
      g.items.push(r);
    }
    const periodLabel = period.startsWith('year:') ? `שנת ${period.slice(5)}` : J_PERIODS.find((x) => x.v === period).l;
    const first = c.recs.length ? c.recs.reduce((m, r) => (new Date(r.date) < new Date(m.date) ? r : m)) : null;
    return html`<div className="pad" style=${{ gap: 14 }}>
      <div className="title-row"><h1 className="h1">יומן</h1><div style=${{ display: 'flex', gap: 8 }}><button className="ib" aria-label="חיפוש" aria-pressed=${searching} onClick=${() => { setSearching(!searching); if (searching) setQ(''); }}><${Icon} n=${searching ? 'x' : 'search'} /></button><button className="add" onClick=${() => A.sheet('addMenu')}><${Icon} n="plus" />הוספה</button></div></div>
      ${searching && html`<input className="inp" autoFocus style=${{ minHeight: 46 }} placeholder="חיפוש תחנה, טיפול או הערה" value=${q} onChange=${(e) => { setQ(e.target.value); setShown(PAGE); }} aria-label="חיפוש ביומן" />`}
      ${(pendingN > 0 || failedN > 0) && html`<button className="warnbox" style=${{ textAlign: 'right', cursor: 'pointer' }} onClick=${() => A.go('unsynced')}><${Icon} n=${failedN ? 'alert' : 'cloud'} />${failedN ? `${failedN} ${failedN === 1 ? 'שינוי דורש' : 'שינויים דורשים'} בדיקה` : `${pendingN} שינויים שעוד לא עלו לענן`} · בדיקה ותיקון ←</button>`}
      <div className="scrollx">
        <button className="chip" onClick=${() => A.sheet('choice', { title: 'תקופת היומן', value: period.startsWith('year:') ? 'year' : period, options: J_PERIODS, onPick: (v) => { setPeriod(v); setShown(PAGE); } })}><${Icon} n="calendar" s=${16} />${periodLabel}<${Icon} n="down" s=${14} /></button>
        ${FILTERS.map((f) => html`<button key=${f.v} className=${'chip' + (filter === f.v ? ' on' : '')} onClick=${() => { setFilter(f.v); setShown(PAGE); }}>${f.v === 'fill' && c.ev ? 'טעינות' : f.l}</button>`)}
      </div>
      ${money.length > 0 && filter !== 'issue' && html`<div className="facts" role="list" aria-label="סיכום היומן המסונן">
        <button role="listitem" onClick=${() => A.sheet('journalInfo', { unknown, pending: pendingN })}><span className="fl">${unknown ? 'סכום ידוע בתקופה' : 'סך הכול בתקופה'}<small>${periodLabel === 'כל התקופה' && first ? `מתחילת הרישומים, ${fmt.dayMon(new Date(first.date))}` : periodLabel} · ${money.length} ${money.length === 1 ? 'רשומה' : 'רשומות'}${unknown ? ` · ${unknown} ${unknown === 1 ? 'עלות חסרה' : 'עלויות חסרות'}` : ''} · <u style=${{ textDecoration: 'underline dotted' }}>על מה מבוסס?</u></small></span><i className="ld"></i><span className="fv"><span className="n">${fmt.money(known)}</span></span></button>
      </div>`}
      ${list.length === 0 && html`<div className="empty"><div className="disp" style=${{ fontSize: 34 }}>${q ? 'לא נמצאו רשומות' : c.recs.length ? 'אין רשומות בתקופה הזו' : 'אין כאן עדיין רשומות'}</div><p className="muted small">${q ? 'נסו חיפוש או סינון אחר.' : c.recs.length ? 'אפשר לבחור תקופה אחרת.' : 'אפשר להוסיף תדלוק, טיפול או הוצאה.'}</p>${(q || filter !== 'all' || period !== 'all') && html`<button className="btn line sm" onClick=${() => { setQ(''); setFilter('all'); setPeriod('all'); }}>ניקוי סינון</button>`}</div>`}
      ${groups.map((g) => {
        const m = c.monthly[g.k] || { fuel: 0, service: 0, expense: 0, fills: 0 };
        const tot = m.fuel + m.service + m.expense;
        return html`<section key=${g.k}>
          <div className="month"><b>${fmt.month(g.k)}</b><span>${tot > 0 && filter !== 'issue' ? html`<span className="n">${fmt.money(tot)}</span>` : ''}</span></div>
          ${g.items.map((r) => r.type === 'issue'
            ? html`<button key=${r.id} className="entry" onClick=${() => A.sheet('issue', { id: r.id })}><div className="day"><b className="n">${new Date(r.date).getDate()}</b><small>${TM.MS[new Date(r.date).getMonth()]}</small></div><span className="badge t"><${Icon} n="alert" /></span><span className="t"><b>${r.title}</b><small>תקלה · ${TM.ISSUE_STATUS[r.status || (r.open ? 'open' : 'resolved')]}${r.odo ? html` · <span className="n">${fmt.int(r.odo)}</span> ק״מ` : ''}</small></span></button>`
            : html`<${EntryRow} key=${r.id} r=${r} c=${c} unit=${unit} A=${A} db=${db} />`)}
        </section>`;
      })}
      ${list.length > shown && html`<button className="btn line sm" onClick=${() => setShown(shown + PAGE)}>הצגת רשומות נוספות · מוצגות ${shown} מתוך ${list.length}</button>`}
    </div>`;
  }

  /* ================= INSIGHTS ================= */
  const PERIODS = [{ v: 3, l: '3 חודשים' }, { v: 6, l: '6 חודשים' }, { v: 12, l: '12 חודשים' }, { v: 0, l: 'מהרשומה הראשונה' }];
  function Insights({ db, c, A, p }) {
    const [tab, setTab] = useState(p.tab || 'cons');
    const [period, setPeriod] = useState(6);
    const unit = UI.unitFor(db, c);
    const from = period ? new Date(new Date(now()).setMonth(now().getMonth() - period)) : new Date(0);
    const segs = c.segs.filter((s) => s.date >= from);
    const fills = c.fills.filter((f) => new Date(f.date) >= from);
    const sumKm = segs.reduce((s, x) => s + x.km, 0), sumL = segs.reduce((s, x) => s + x.liters, 0);
    const avgP = sumL ? sumKm / sumL : null;

    let body = null;
    if (tab === 'cons') {
      if (!segs.length) body = html`<div className="empty"><div className="disp" style=${{ fontSize: 34 }}>אין עדיין מקטעים בתקופה הזו</div><p className="muted small">${c.ev ? 'מקטע נסגר בכל טעינה שבה סימנת אחוז לפני ואחרי.' : 'מקטע נסגר בכל פעם שממלאים עד הסוף אחרי טנק מלא קודם.'}</p></div>`;
      else {
        const vsMfr = c.v.mfr ? avgP / c.v.mfr - 1 : null;
        const lastTone = segs.length && avgP ? (segs[segs.length - 1].kmpl < avgP * 0.97 ? 'var(--worse)' : segs[segs.length - 1].kmpl > avgP * 1.03 ? 'var(--better)' : 'var(--tx)') : null;
        const bestP = segs.reduce((b, s) => (!b || s.kmpl > b.kmpl ? s : b), null);
        const worstP = segs.reduce((b, s) => (!b || s.kmpl < b.kmpl ? s : b), null);
        body = html`
          <article className="card">
            <span className="lbl">צריכה ממוצעת · לפי מרחק</span>
            <h4>${unit === 'l100' ? html`אתה צורך <span className="n">${consStr(avgP, unit)}</span> ל׳ ל-100 ק״מ` : unit === 'kwh100' ? html`אתה צורך <span className="n">${consStr(avgP, unit)}</span> kWh ל-100 ק״מ` : unit === 'kmkwh' ? html`אתה נוסע <span className="n">${consStr(avgP, unit)}</span> ק״מ ל-kWh` : html`אתה נוסע <span className="n">${consStr(avgP, unit)}</span> ק״מ לליטר`}</h4>
            <${LineChart} series=${segs.map((s) => cons(s.kmpl, unit))} avgLine=${cons(avgP, unit)} labels=${segs.map((s) => fmt.short(s.date))} highlightLast=${lastTone} />
            <div className="legend"><span><i></i>${c.ev ? 'כל מקטע בין טעינות' : 'כל מקטע בין טנקים מלאים'}</span><span><i className="dash"></i>הממוצע שלך</span>${vsMfr != null && html`<span className="muted">${pct(Math.abs(vsMfr))} ${vsMfr < 0 ? 'מתחת' : 'מעל'} ליצרן</span>`}</div>
            ${vsMfr != null && html`<p className="small muted" style=${{ margin: 0 }}>${c.ev ? `נתון היצרן ${consStr(c.v.mfr, unit)} ${consUnitShort(unit)} (טווח WLTP).` : `נתון היצרן ${consStr(c.v.mfr, unit)} ${consUnitShort(unit)} · אומדן לפי נתוני הפליטה (תקינה אירופאית). רוב הרכבים נוסעים פחות מהנתון הרשמי.`}</p>`}
            ${c.measure.restarts > 0 && html`<p className="small muted" style=${{ margin: 0 }}>${c.measure.restarts} נקודות התחלה מחדש בהיסטוריה. הקו נקטע שם בכוונה; אין רצף על פני תדלוקים שלא תועדו.</p>`}
          </article>
          ${!c.ev && c.open && html`<article className="card" style=${{ gap: 4 }}><span className="lbl">המקטע שעדיין פתוח</span><h4 style=${{ margin: 0 }}>מהתדלוק המלא ב${fmt.dayMon(new Date(c.open.from.date))}${c.open.liters > 0 ? html` · <span className="n">${fmt.dec(c.open.liters)}</span> ליטרים ממתינים` : ''}</h4><p className="small muted" style=${{ margin: 0 }}>הליטרים במקטע הפתוח ייכללו במדידה כשהוא ייסגר בתדלוק מלא.</p></article>`}
          <div className="facts" role="list">
            <button role="listitem" onClick=${() => A.sheet('segment', { id: bestP.id })}><span className="fl">המקטע הטוב<small>${fmt.dayMon(bestP.date)}</small></span><i className="ld"></i><span className="fv"><span className="n">${consStr(bestP.kmpl, unit)}</span><u>${consUnitShort(unit)}</u></span></button>
            <button role="listitem" onClick=${() => A.sheet('segment', { id: worstP.id })}><span className="fl">המקטע החלש<small>${fmt.dayMon(worstP.date)}</small></span><i className="ld"></i><span className="fv"><span className="n">${consStr(worstP.kmpl, unit)}</span><u>${consUnitShort(unit)}</u></span></button>
            <div role="listitem"><span className="fl">מרחק שנמדד<small>ב-${segs.length} מקטעים</small></span><i className="ld"></i><span className="fv"><span className="n">${fmt.int(sumKm)}</span><u>ק״מ</u></span></div>
            <div role="listitem"><span className="fl">${c.ev ? 'חשמל במקטעים' : 'דלק במקטעים'}<small>${c.ev ? 'מה שנטען ונצרך' : 'מה שתודלק ונצרך'}</small></span><i className="ld"></i><span className="fv"><span className="n">${fmt.int(sumL)}</span><u>${c.ev ? 'kWh' : 'ליטרים'}</u></span></div>
          </div>
          <details className="tbl"><summary>כל המקטעים בתקופה · ${segs.length}</summary>
            <table><thead><tr><th>סיום המקטע</th><th className="n">מרחק</th><th className="n">${c.ev ? 'kWh' : 'ליטרים'}</th><th className="n">צריכה</th></tr></thead>
            <tbody>${[...segs].reverse().map((sg) => html`<tr key=${sg.id} onClick=${() => A.sheet('segment', { id: sg.id })}><td>${fmt.dayMon(sg.date)}${sg.to.station ? ` · ${station(sg.to.station).name}` : ''}</td><td className="n">${fmt.int(sg.km)}</td><td className="n">${fmt.dec(sg.liters)}</td><td className=${'n' + (c.anomalies.has(sg.id) ? ' flag' : '')}>${consStr(sg.kmpl, unit)}</td></tr>`)}</tbody></table>
            <p className="note">המקטעים נבנים מכל ההיסטוריה; התקופה נבחרת לפי מועד סגירת כל מקטע. הממוצע מחושב מסך המרחק והליטרים.</p>
          </details>`;
      }
    }
    if (tab === 'price' && c.ev) {
      body = fills.length ? html`<${EV.PlacesCard} db=${db} c=${c} A=${A} fills=${fills} />
        <article className="card"><span className="lbl">עלות לק״מ</span><h4>כל ק״מ עולה לך <span className="n">${sumKm ? Math.round((segs.reduce((a, x) => a + x.cost, 0) / sumKm) * 100) : '—'}</span> אג׳ בחשמל</h4><p className="small muted">${c.v.battery && c.v.battery.wltp ? `טווח יצרן ${c.v.battery.wltp} ק״מ, בפועל כ-${fmt.int(c.cap * (avgP || c.effK))} ק״מ מסוללה מלאה.` : ''}</p></article>`
        : html`<div className="empty"><div className="disp" style=${{ fontSize: 34 }}>אין טעינות בתקופה הזו</div></div>`;
    }
    else if (tab === 'price') {
      const months = [...new Set(fills.map((f) => mkey(new Date(f.date))))].sort();
      const paid = months.map((k) => { const fs = fills.filter((f) => mkey(new Date(f.date)) === k); return fs.reduce((s, f) => s + f.total, 0) / fs.reduce((s, f) => s + f.liters, 0); });
      const offi = months.map((k) => TM.OFFICIAL[k] || null);
      const totL = fills.reduce((s, f) => s + f.liters, 0), totC = fills.reduce((s, f) => s + f.total, 0);
      const st = {};
      for (const f of fills) { const s = (st[f.station] = st[f.station] || { id: f.station, l: 0, c: 0, n: 0 }); s.l += f.liters; s.c += f.total; s.n++; }
      const ranked = Object.values(st).map((s) => ({ ...s, p: s.c / s.l })).sort((a, b) => a.p - b.p);
      const maxP = Math.max(...ranked.map((r) => r.p), 1), minP = Math.min(...ranked.map((r) => r.p), 0);
      const spread = ranked.length > 1 ? ranked[ranked.length - 1].p - ranked[0].p : 0;
      const priced = fills.filter((f) => f.total > 0 && f.liters > 0);
      const dear = priced.reduce((b, f) => (!b || f.price > b.price ? f : b), null);
      const cheap = priced.reduce((b, f) => (!b || f.price < b.price ? f : b), null);
      const regulated = c.v.fuel === '95';
      body = fills.length ? html`
        <article className="card">
          <span className="lbl">מחיר ממוצע ששילמת · ${TM.fuelLabel(c.v)}</span>
          <h4><span className="n">${fmt.price(totC / totL)}</span> לליטר</h4>
          ${months.length > 1 && html`<${LineChart} series=${paid} second=${regulated ? offi : null} labels=${months.map(fmt.monthShort)} formatY=${(v) => v.toFixed(2)} />
          <div className="legend"><span><i></i>מה ששילמת</span>${regulated && html`<span><i className="dash"></i>המחיר המרבי של 95</span>`}</div>`}
          <p className="small muted" style=${{ margin: 0 }}>הממוצעים משוקללים לפי הליטרים שנרכשו, כולל הנחות אישיות. ${regulated ? 'המחיר להשוואה נלקח מאותו חודש.' : `ל${TM.fuelLabel(c.v)} אין מחיר מפוקח, אז מוצגים רק המחירים ששילמתם.`}</p>
        </article>
        <div className="facts" role="list">
          ${dear && html`<button role="listitem" onClick=${() => A.sheet('entry', { id: dear.id })}><span className="fl">התדלוק היקר ביותר<small>${station(dear.station).name} · ${fmt.dayMon(new Date(dear.date))}</small></span><i className="ld"></i><span className="fv"><span className="n">${fmt.price(dear.price)}</span></span></button>`}
          ${cheap && cheap !== dear && html`<button role="listitem" onClick=${() => A.sheet('entry', { id: cheap.id })}><span className="fl">הכי זול ששילמת<small>${station(cheap.station).name} · ${fmt.dayMon(new Date(cheap.date))}</small></span><i className="ld"></i><span className="fv"><span className="n">${fmt.price(cheap.price)}</span></span></button>`}
          <div role="listitem"><span className="fl">ליטרים עם סכום ידוע<small>${priced.length} תדלוקים</small></span><i className="ld"></i><span className="fv"><span className="n">${fmt.int(totL)}</span><u>ל׳</u></span></div>
        </div>
        <article className="card">
          <span className="lbl">תחנות</span>
          <h4>${ranked.length > 1 ? html`הכי זול לך: ${station(ranked[0].id).name}` : station(ranked[0].id).name}</h4>
          <div className="rank">${ranked.map((r, i) => html`<div key=${r.id} className=${i === 0 && ranked.length > 1 ? 'best' : ''}><span>${station(r.id).name}</span><i style=${{ width: 40 + ((r.p - minP) / Math.max(0.01, maxP - minP)) * 60 + '%' }}></i><b>${r.p.toFixed(2)}</b></div>`)}</div>
          ${spread > 0.02 && html`<p className="small muted">הפרש של ${fmt.price(spread)} לליטר, בערך ${fmt.money(spread * c.v.tank * 0.65)} למיכל.</p>`}
        </article>` : html`<div className="empty"><div className="disp" style=${{ fontSize: 34 }}>אין תדלוקים בתקופה הזו</div></div>`;
    }
    if (tab === 'spend') {
      const keys = [];
      const n = period || Math.max(1, c.months.length ? TM.monthSpan(c.months[0], mkey(now())) : 1);
      for (let i = Math.min(n, 12) - 1; i >= 0; i--) { const d = new Date(now()); d.setDate(1); d.setMonth(d.getMonth() - i); keys.push(mkey(d)); }
      const data = keys.map((k) => c.monthly[k] || { fuel: 0, service: 0, expense: 0 });
      const all = Object.entries(c.monthly).filter(([k]) => new Date(k + '-01') >= new Date(from.getFullYear(), from.getMonth(), 1));
      const sum = (key) => all.reduce((s, [, m]) => s + m[key], 0);
      const fuel = sum('fuel'), service = sum('service'), expense = sum('expense'), refunds = sum('refunds'), excluded = sum('excluded');
      const segCost = segs.reduce((s, x) => s + x.cost, 0);
      const total = fuel + service + expense;
      const firstDate = all.length ? new Date(Math.min(...c.recs.filter((r) => ['fill', 'charge', 'service', 'expense'].includes(r.type) && new Date(r.date) >= from).map((r) => new Date(r.date)))) : now();
      const days = Math.max(7, (now() - firstDate) / DAY);
      const weekly = total / (days / 7), monthlyAvg = total / (days / 30.4);
      const ytd = Object.entries(c.monthly).filter(([k]) => k.startsWith(String(now().getFullYear()))).reduce((s, [, m]) => s + m.fuel + m.service + m.expense, 0);
      const odos = c.recs.filter((r) => r.odo && new Date(r.date) >= from).map((r) => r.odo);
      const kmSpan = odos.length > 1 ? Math.max(...odos) - Math.min(...odos) : null;
      const unknownN = c.recs.filter((r) => (r.type === 'service' || r.type === 'expense') && r.cost == null && new Date(r.date) >= from).length;
      body = html`
        <${TcoBlock} c=${c} A=${A} compact />
        <article className="card">
          <span className="lbl">הוצאות הרכב לפי חודש · ${PERIODS.find((x) => x.v === period).l}</span>
          <h4 className="n">${fmt.money(total)}${refunds > 0 ? html` <span className="muted" style=${{ fontSize: 14, fontWeight: 500 }}>נטו, אחרי ${fmt.money(refunds)} שהוחזרו</span>` : ''}</h4>
          <${Bars} data=${data} keys=${['fuel', 'service', 'expense']} colors=${['var(--c-fuel)', 'var(--c-service)', 'var(--c-other)']} labels=${keys.map(fmt.monthShort)} />
          <div className="legend"><span><i className="sq" style=${{ background: 'var(--c-fuel)' }}></i>${c.ev ? 'חשמל' : 'דלק'}</span><span><i className="sq" style=${{ background: 'var(--c-service)' }}></i>טיפולים</span><span><i className="sq" style=${{ background: 'var(--c-other)' }}></i>הוצאות</span></div>
          ${unknownN > 0 && html`<p className="small muted" style=${{ margin: 0 }}>סכומים ידועים בלבד · ${unknownN} ${unknownN === 1 ? 'עלות חסרה' : 'עלויות חסרות'}.</p>`}
        </article>
        <div className="facts" role="list">
          <div role="listitem"><span className="fl">ממוצע חודשי<small>לפי הזמן שעבר בתקופה, כולל חודשים בלי תדלוק</small></span><i className="ld"></i><span className="fv"><span className="n">${fmt.money(monthlyAvg)}</span></span></div>
          <div role="listitem"><span className="fl">ממוצע שבועי</span><i className="ld"></i><span className="fv"><span className="n">${fmt.money(weekly)}</span></span></div>
          <div role="listitem"><span className="fl">מתחילת השנה<small>${now().getFullYear()}</small></span><i className="ld"></i><span className="fv"><span className="n">${fmt.money(ytd)}</span></span></div>
          ${kmSpan > 0 && html`<div role="listitem"><span className="fl">הכול לק״מ<small>כל ההוצאות בתקופה, חלקי <span className="n">${fmt.int(kmSpan)}</span> ק״מ שתועדו · בלי ירידת ערך</small></span><i className="ld"></i><span className="fv"><span className="n">${(total / kmSpan).toFixed(2)}</span><u>₪</u></span></div>`}
          ${kmSpan > 0 && html`<div role="listitem"><span className="fl">רכישות ${c.ev ? 'חשמל' : 'דלק'} לק״מ<small>כל מה ששילמת ב${c.ev ? 'טעינות' : 'תדלוקים'}, גם חלקיים</small></span><i className="ld"></i><span className="fv"><span className="n">${Math.round((fuel / kmSpan) * 100)}</span><u>אג׳</u></span></div>`}
          ${sumKm > 0 && html`<button role="listitem" onClick=${() => A.sheet('measure')}><span className="fl">${c.ev ? 'חשמל' : 'דלק'} שנמדד לק״מ<small>רק במקטעים סגורים, ללא התדלוק שפתח כל מקטע</small></span><i className="ld"></i><span className="fv"><span className="n">${Math.round((segCost / sumKm) * 100)}</span><u>אג׳</u></span></button>`}
        </div>
        <details className="tbl"><summary>לפי חודש · ${keys.length}</summary>
          <table><thead><tr><th>חודש</th><th className="n">${c.ev ? 'חשמל' : 'דלק'}</th><th className="n">טיפולים</th><th className="n">אחרות</th><th className="n">סה״כ</th></tr></thead>
          <tbody>${[...keys].reverse().map((k, i) => { const m = data[keys.length - 1 - i]; return html`<tr key=${k}><td>${fmt.month(k)}</td><td className="n">${fmt.money(m.fuel)}</td><td className="n">${fmt.money(m.service)}</td><td className="n">${fmt.money(m.expense)}</td><td className="n"><b>${fmt.money(m.fuel + m.service + m.expense)}</b></td></tr>`; })}</tbody></table>
          <p className="note">הסכומים והגרף כוללים עלויות ידועות בלבד. החזרים מופחתים מ"אחרות".</p>
        </details>
        <div className="group">
          <${Row} title=${c.ev ? 'חשמל' : 'דלק'} value=${html`<span className="n">${fmt.money(fuel)}</span>`} onClick=${() => A.tab('journal', { filter: 'fill' })} />
          <${Row} title="טיפולים" value=${html`<span className="n">${fmt.money(service)}</span>`} onClick=${() => A.tab('journal', { filter: 'service' })} />
          <${Row} title="הוצאות אחרות" sub=${refunds > 0 ? `אחרי ${fmt.money(refunds)} שחזרו אליכם` : null} value=${html`<span className="n">${fmt.money(expense)}</span>`} onClick=${() => A.tab('journal', { filter: 'expense' })} />
          ${excluded > 0 && html`<${Row} title="לא בעלות הרכב" sub="נרשם ביומן בלבד, לא בממוצעים" value=${html`<span className="n muted">${fmt.money(excluded)}</span>`} onClick=${() => A.tab('journal', { filter: 'expense' })} />`}
        </div>`;
    }
    if (tab === 'community') {
      const on = db.settings.community;
      const g = TM.communityGroup(c.v);
      const pool = g.pool;
      const myAvg = c.avg;
      const unitK = (x) => cons(x, unit);
      const groupAvg = pool.length ? pool.reduce((s, x) => s + x.avg, 0) / pool.length : null;
      const bestK = pool.length ? pool.reduce((b, x) => (!b || x.avg > b.avg ? x : b), null) : null;
      const worseThanMe = myAvg ? pool.filter((x) => x.avg < myAvg).length : 0;
      const myPrice = c.fills.length ? c.fuelTotal / c.fills.reduce((s, f) => s + (f.liters || f.kwh || 0), 0) : null;
      const groupPrice = pool.length ? pool.reduce((s, x) => s + x.price, 0) / pool.length : null;
      // distribution buckets in the user's unit
      const vals = pool.map((x) => unitK(x.avg)).concat(myAvg ? [unitK(myAvg)] : []);
      const lo = Math.min(...vals), hi = Math.max(...vals);
      const nb = 5, step = Math.max(0.1, (hi - lo) / nb || 1);
      const buckets = Array.from({ length: nb }, (_, i) => ({ from: lo + i * step, n: pool.filter((x) => { const v = unitK(x.avg); return v >= lo + i * step && (i === nb - 1 ? v <= hi : v < lo + (i + 1) * step); }).length }));
      const myBucket = myAvg ? Math.min(nb - 1, Math.floor((unitK(myAvg) - lo) / step)) : -1;
      const d = myAvg && groupAvg ? groupAvg / myAvg - 1 : null; // >0: group uses less fuel per km? no: groupAvg km/l higher means they drive more km per litre
      body = !on ? html`<div className="empty"><div className="disp" style=${{ fontSize: 34 }}>ההשוואה כבויה</div><p className="muted small">כדי לראות איך אתם ביחס לנהגים עם אותו רכב, צריך לשתף סיכום של הצריכה. אפשר לשנות את ההשתתפות בחשבון.</p><button className="btn line sm" onClick=${() => A.setSetting('community', true)}>להפעיל השוואה</button></div>`
      : c.segs.length < 2 ? html`<div className="empty"><div className="disp" style=${{ fontSize: 34 }}>עוד מקטע אחד ונשווה</div><p className="muted small">נדרשים לפחות שני מקטעי צריכה סגורים כדי לשתף סיכום ולהציג השוואה.</p></div>`
      : pool.length < 4 ? html`<article className="card"><span className="lbl">${c.v.make} ${c.v.model} · ${TM.fuelLabel(c.v)}</span><h4>מחכים לעוד ${4 - pool.length} ${4 - pool.length === 1 ? 'סיכום' : 'סיכומים'}</h4><div className="progress"><i style=${{ width: (pool.length / 4) * 100 + '%' }}></i></div><p className="small muted">יש כרגע ${pool.length} סיכומי רכבים עם ${g.label}. ההשוואה תופיע כשיהיו ארבעה.</p></article>`
      : html`
        <article className="card">
          <span className="lbl">הממוצע שלך מול הקבוצה · ${g.label}${g.kind === 'fuel' ? ` (רק ${g.modelCount} עם אותו דגם)` : ''}</span>
          <h4>${Math.abs(d) < 0.03 ? 'בדיוק כמו ממוצע הקבוצה' : d < 0 ? `${pct(-d)} ${c.ev ? 'פחות חשמל' : 'פחות דלק'} לק״מ מממוצע הקבוצה` : `${pct(d)} ${c.ev ? 'יותר חשמל' : 'יותר דלק'} לק״מ מממוצע הקבוצה`}</h4>
          <div className="facts" role="list">
            <div role="listitem"><span className="fl">הממוצע שלך<small>${c.segs.length} מקטעים · כל ההיסטוריה</small></span><i className="ld"></i><span className="fv"><span className="n">${consStr(myAvg, unit)}</span><u>${consUnitShort(unit)}</u></span></div>
            <div role="listitem"><span className="fl">ממוצע הקבוצה<small>${pool.length} סיכומי רכבים</small></span><i className="ld"></i><span className="fv"><span className="n">${consStr(groupAvg, unit)}</span><u>${consUnitShort(unit)}</u></span></div>
            <div role="listitem"><span className="fl">החסכוני בקבוצה<small>${bestK.make} ${bestK.model} ${bestK.year}</small></span><i className="ld"></i><span className="fv"><span className="n">${consStr(bestK.avg, unit)}</span><u>${consUnitShort(unit)}</u></span></div>
          </div>
          <p className="small muted" style=${{ margin: 0 }}>${worseThanMe} מתוך ${pool.length} מהסיכומים מצביעים על צריכת ${c.ev ? 'חשמל' : 'דלק'} גבוהה משלך לק״מ. ההשוואה משתמשת בכל ההיסטוריה; בחירת תקופה לא משנה אותה.</p>
        </article>
        <article className="card">
          <span className="lbl">התפלגות הצריכה בקבוצה · ${consUnitShort(unit)}</span>
          <div className="hist" aria-label="התפלגות ממוצעי הצריכה">${buckets.map((b, i) => html`<div key=${i} className=${'hb' + (i === myBucket ? ' me' : '')}><i style=${{ height: Math.max(4, (b.n / Math.max(1, ...buckets.map((x) => x.n))) * 70) + 'px' }}></i><small className="n">${fmt.dec(b.from)}</small>${i === myBucket && html`<b>אתה</b>`}</div>`)}</div>
          <p className="small muted" style=${{ margin: 0 }}>כל רכב תורם סיכום משלו. מספר הסיכומים אינו בהכרח מספר הנהגים.</p>
        </article>
        ${myPrice && groupPrice && html`<div className="facts" role="list">
          <div role="listitem"><span className="fl">מחיר ממוצע ל${c.ev ? 'קוט״ש' : 'ליטר'} · שלך<small>${Math.abs(myPrice / groupPrice - 1) < 0.02 ? 'המחיר שלך קרוב לממוצע הקבוצה' : myPrice < groupPrice ? `${pct(1 - myPrice / groupPrice)} פחות מהקבוצה` : `${pct(myPrice / groupPrice - 1)} יותר מהקבוצה`}</small></span><i className="ld"></i><span className="fv"><span className="n">${fmt.price(myPrice)}</span></span></div>
          <div role="listitem"><span className="fl">מחיר ממוצע · הקבוצה</span><i className="ld"></i><span className="fv"><span className="n">${fmt.price(groupPrice)}</span></span></div>
        </div>`}
        <details className="tbl"><summary>סיכומי רכבים בקבוצת ההשוואה · ${pool.length}</summary>
          <table><thead><tr><th>רכב</th><th className="n">צריכה</th><th className="n">מקטעים</th></tr></thead><tbody>${[...pool].sort((a, b) => b.avg - a.avg).map((x, i) => html`<tr key=${i}><td>${x.make} ${x.model} · ${x.year}</td><td className="n">${consStr(x.avg, unit)}</td><td className="n">${x.segs}</td></tr>`)}</tbody></table>
          <p className="note">איך נבחרת הקבוצה: אותו דגם וסוג דלק, ואם אין מספיק סיכומים — אותו סוג דלק. השנתון אינו תנאי.</p>
        </details>
        <article className="card">
          <span className="lbl">מה משותף</span>
          <p className="small" style=${{ margin: 0 }}><b>משותף:</b> דגם, שנה, סוג דלק, ממוצע צריכה, מספר מקטעים, מחיר ממוצע ששולם. <b>לא משותף:</b> שם, מייל, לוחית, קילומטראז׳, תאריכים, תחנות, מיקום או הערות. הסיכום משויך למזהי החשבון והרכב.</p>
          <button className="link" style=${{ justifySelf: 'start', padding: 0 }} onClick=${() => A.go('account')}>אפשר לשנות את ההשתתפות בחשבון</button>
        </article>`;
    }

    return html`<div className="pad" style=${{ gap: 16 }}>
      <div className="title-row"><h1 className="h1">תובנות</h1>
        <button className="chip" onClick=${() => A.sheet('choice', { title: 'תקופה', value: period, options: PERIODS, onPick: setPeriod })}>${PERIODS.find((x) => x.v === period).l}<${Icon} n="down" /></button>
      </div>
      <div className="scrollx">${[{ v: 'cons', l: 'צריכה' }, { v: 'price', l: c.ev ? 'טעינות' : 'מחירים' }, { v: 'spend', l: 'הוצאות' }, { v: 'community', l: 'השוואה' }].map((t) => html`<button key=${t.v} className=${'chip' + (tab === t.v ? ' on' : '')} onClick=${() => setTab(t.v)}>${t.l}</button>`)}</div>
      ${body}
    </div>`;
  }

  window.S1 = { TcoBlock, Home, FillForm, Saved, Journal, Insights, EntryRow, syncState, SYNC_LABEL, pct };
})();
