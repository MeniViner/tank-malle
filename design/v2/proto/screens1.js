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
        <button className="avatar" aria-label="חשבון" onClick=${() => A.go('account')}>${db.user.name[0]}</button>
      </div>
    </div>`;
  }

  function whenText(days) {
    if (days == null) return null;
    if (days < 0.6) return html`<span>היום</span>`;
    if (days < 1.6) return html`<span>מחר</span>`;
    return html`בעוד <span>${Math.round(days)}</span> ימים`;
  }

  function ConsCompare({ seg, avg, unit }) {
    if (!seg || !avg) return null;
    const moreFuel = avg / seg.kmpl - 1; // >0 = used more fuel per km than usual
    if (Math.abs(moreFuel) < 0.03) return html`<span className="pill neutral">בדיוק כמו הרגיל שלך</span>`;
    const p = pct(Math.abs(moreFuel));
    return moreFuel > 0
      ? html`<span className="pill worse">${p} יותר דלק לק״מ מהרגיל שלך (${consStr(avg, unit)})</span>`
      : html`<span className="pill better">${p} פחות דלק לק״מ מהרגיל שלך (${consStr(avg, unit)})</span>`;
  }


  /* ---- Spotlight: the one thing that matters right now, at the top of Home ---- */
  function spotlightItems(db, c, A) {
    const items = [];
    const nowD = now();
    const unit = db.settings.unit;
    if (db.writes.some((w) => w.state === 'rejected')) items.push({ id: 'rejected', tone: 'danger', icon: 'alert', title: 'שמירה אחת נדחתה', body: 'השרת לא קיבל שינוי אחד. אפשר לנסות שוב או לערוך.', go: () => A.go('unsynced'), sticky: true });
    const docs = c.v.docs || {};
    const docRows = [
      ['test', 'הטסט השנתי', 'doc', docs.test && docs.test.due],
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
    for (const r of db.reminders.filter((x) => x.v === c.v.id)) {
      if (!r.dueKm || !c.estOdo) continue;
      const km = Math.round(r.dueKm - c.estOdo);
      if (km > 500) continue;
      items.push({ id: `rem-${r.id}`, tone: 'warn', icon: 'wrench', title: km < 0 ? `${r.label}: עבר הזמן` : `${r.label} בעוד ${fmt.int(km)} ק״מ`, body: 'לפי הקילומטראז׳ המשוער של הרכב.', go: () => A.sheet('reminder', { id: r.id }) });
    }
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
  function ConsSpark({ segs, avg, unit, tone, onPick }) {
    if (!segs.length) return null;
    const W = 350, H = 156, padX = 22, top = 30, bottom = 32;
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
    return html`<figure style=${{ margin: 0 }} aria-label="הצריכה בששת המקטעים האחרונים">
      <svg className="spark" viewBox=${`0 0 ${W} ${H}`} role="img">
        <defs><linearGradient id="spfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--tx)" stopOpacity=".10" /><stop offset="1" stopColor="var(--tx)" stopOpacity="0" /></linearGradient></defs>
        ${a != null && html`<rect className="band" x="0" y=${y(hi)} width=${W} height=${Math.max(2, y(lo) - y(hi))} rx="6" />`}
                <path d=${area} style=${{ fill: 'url(#spfill)' }} />
        <path d=${d} fill="none" style=${{ stroke: 'var(--tx)' }} strokeWidth="2.25" strokeLinecap="round" />
        <line className="base" x1="0" x2=${W} y1=${base} y2=${base} />
        ${pts.map((p, i) => {
          const last = i === n - 1;
          return html`<g key=${segs[i].id} className="pt" onClick=${() => onPick(segs[i].id)} role="button" aria-label=${`${fmt.short(segs[i].date)}: ${fmt.dec(vals[i])}`}>
            <rect x=${p[0] - 24} y="0" width="48" height=${H} fill="transparent" />
            <text className=${'val' + (last ? ' last ' + toneCls : '')} x=${p[0]} y=${p[1] - 11}>${fmt.dec(vals[i])}</text>
            <circle className=${'dot' + (last ? ' last ' + toneCls : '')} cx=${p[0]} cy=${p[1]} r=${last ? 6.5 : 4} />
            <text x=${p[0]} y=${H - 9} style=${{ textAnchor: 'middle', fontWeight: last ? 700 : 400, fill: last ? 'var(--tx)' : 'var(--tx2)' }}>${fmt.short(segs[i].date)}</text>
          </g>`;
        })}
      </svg>
      ${a != null && html`<figcaption className="legend" style=${{ marginTop: 2 }}><span><i className="sq" style=${{ width: 16, height: 8, borderRadius: 3, background: 'color-mix(in srgb,var(--plate) 45%,transparent)' }}></i>הטווח הרגיל שלך, סביב <b className="n">${fmt.dec(a)}</b></span><span><i className="sq" style=${{ width: 9, height: 9, borderRadius: '50%', background: tone === 'worse' ? 'var(--worse)' : tone === 'better' ? 'var(--better)' : 'var(--tx)' }}></i>התדלוק האחרון</span></figcaption>`}
    </figure>`;
  }


  /* True cost of ownership block: used on Home and in Insights › הוצאות */
  function TcoBlock({ c, A, compact }) {
    const t = c.tco;
    if (!t || !c.fills.length) return null;
    const parts = t.parts.filter((p) => (p.value || 0) > 0);
    const total = t.month || 1;
    return html`<button className="tco" onClick=${() => A.sheet('tco')} aria-label="כמה הרכב עולה לך">
      <div className="tco-top">
        <span className="lbl">${t.complete ? 'הרכב עולה לך' : 'הרכב עולה לך, לפחות'}</span>
        ${!t.complete && html`<span className="pill warn">חסר ${t.missing.length === 1 ? t.missing[0].label : t.missing.length + ' פריטים'}</span>`}
      </div>
      <div className="tco-num"><span className="disp n">${fmt.money(t.month)}</span><span className="tco-unit">בחודש</span></div>
      <div className="tco-sub">כ-<span className="n">${fmt.money(t.year)}</span> בשנה${t.perKm ? html` · <span className="n">${t.perKm.toFixed(2)}</span> ₪ לכל ק״מ` : ''}</div>
      <div className="tco-bar" aria-hidden="true">${parts.map((p) => html`<i key=${p.id} style=${{ flex: p.value / total, background: p.color }}></i>`)}</div>
      ${!compact && html`<div className="tco-legend">${parts.slice(0, 4).map((p) => html`<span key=${p.id}><i style=${{ background: p.color }}></i>${p.label} <b className="n">${fmt.money(p.value)}</b></span>`)}</div>`}
    </button>`;
  }

  /* ================= HOME ================= */
  function Home({ db, c, A }) {
    const unit = db.settings.unit;
    const v = c.v;
    const hasFills = c.fills.length > 0;
    const segs6 = c.segs.slice(-6);
    const lastTone = c.last && c.avg ? (c.avg / c.last.kmpl - 1 > 0.03 ? 'worse' : c.avg / c.last.kmpl - 1 < -0.03 ? 'better' : '') : '';
    const recent = [...c.recs].filter((r) => ['fill', 'service', 'expense'].includes(r.type)).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 3);
    const off = officialFor(now());
    const low = c.level != null && c.level <= c.reserve + 0.02;

    return html`<div className="pad">
      <${HeaderBar} db=${db} c=${c} A=${A} />
      <${Spotlight} db=${db} c=${c} A=${A} />

      ${!hasFills && html`<section className="empty">
        <span className="lbl">${v.make} ${v.model} · ${v.year}</span>
        <div className="disp">מתחילים מהתדלוק הבא</div>
        <p className="muted small">בפעם הבאה שאתם בתחנה, הקישו על "תדלקתי". אחרי שני תדלוקים מלאים נדע את הצריכה האמיתית.</p>
        <button className="btn" onClick=${() => A.fab()}><${Icon} n="pump" />רישום התדלוק הראשון</button>
      </section>`}

      ${hasFills && html`<button className="next" onClick=${() => A.sheet('tank')} aria-label="התדלוק הבא · פרטים">
        <span className="lbl">${low ? 'הדלק עומד להיגמר' : 'התדלוק הבא'}</span>
        ${c.level == null
          ? html`<div className="disp when" style=${{ fontSize: 46 }}>כמה דלק יש עכשיו?</div><p>הקישו כדי לסמן את מחוון הדלק, ונחשב מתי לתדלק.</p>`
          : html`<div className="disp when">${whenText(c.daysToTarget)}</div>
            <div style=${{ display: 'grid', gap: 6 }}>
              <${Ticks} level=${c.level} habit=${c.habit} low=${low} />
              <div className="gk"><span>E</span><span>כ-${pct(c.level)} · כ-${fmt.int(c.kmLeft)} ק״מ</span><span>F</span></div>
            </div>
            <p>${c.level < 0.03 ? 'לפי החישוב המיכל כמעט ריק. אם זה לא נכון, הקישו ועדכנו את המחוון.' : c.habit != null ? `בדרך כלל אתה מתדלק כשנשארים ${pct(c.habit)}. הקו הלבן מסמן את זה.` : 'אחרי עוד כמה תדלוקים נלמד מתי אתה נוהג לתדלק.'}</p>`}
        <span className="more"><span>${c.basis === 'obs' ? 'לפי המחוון שסימנת' : c.basis === 'full' ? 'הערכה מהטנק המלא האחרון' : ''}</span><span>עדכון ›</span></span>
      </button>`}

      ${c.last ? html`<button className="cons" onClick=${() => A.sheet('segment', { id: c.last.id })}>
          <span className="lbl">צריכה בתדלוק האחרון</span>
          <div className="cons-row"><span className="disp big n">${consStr(c.last.kmpl, unit)}</span><span className="unit">${consUnit(unit)}</span></div>
          <${ConsCompare} seg=${c.last} avg=${c.avg} unit=${unit} />
        </button>
        <${ConsSpark} segs=${segs6} avg=${c.avg} unit=${unit} tone=${lastTone} onPick=${(id) => A.sheet('segment', { id })} />`
      : hasFills && html`<section className="empty">
          <span className="lbl">צריכה</span>
          <div className="disp" style=${{ fontSize: 36 }}>עוד תדלוק מלא אחד ונדע</div>
          <div className="progress"><i style=${{ width: c.lastFull ? '50%' : '10%' }}></i></div>
          <p className="muted small">${c.lastFull ? 'הטנק המלא הראשון כבר רשום. בפעם הבאה שתמלאו עד הסוף, נחשב כמה נסעתם על כל ליטר.' : 'צריכה נמדדת בין שני תדלוקים עד הסוף. תדלוקים חלקיים נשמרים ומצטרפים לחישוב.'}</p>
        </section>`}

      <${TcoBlock} c=${c} A=${A} />

      <div className="duo trio">
        <button onClick=${() => A.tab('vehicle')}><small>נוסע ביום</small><span className="v"><span className="n">${c.latest ? fmt.int(c.dailyKm) : '—'}</span> <span className="vu">ק״מ</span></span><small>${c.latest ? `כ-${fmt.int(c.dailyKm * 30)} בחודש` : 'אחרי כמה רישומים'}</small></button>
        <button onClick=${() => A.tab('insights', { tab: 'spend' })}><small>דלק ב${TM.MS[now().getMonth()]}</small><span className="v n">${fmt.money((c.monthly[mkey(now())] || { fuel: 0 }).fuel)}</span><small>${c.avgMonthFuel != null ? `בד״כ ${fmt.money(c.avgMonthFuel)}` : 'עד עכשיו'}</small></button>
        <button onClick=${() => A.sheet('price')}><small>95 היום</small><span className="v n">${fmt.price(off)}</span><small>${db.settings.discount.type !== 'none' ? 'לפני ההנחה' : 'מחיר מרבי'}</small></button>
      </div>

      ${recent.length > 0 && html`<section>
        <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
          <span className="group-h" style=${{ margin: 0 }}>לאחרונה</span>
          <button className="link" onClick=${() => A.tab('journal')}>כל היומן</button>
        </div>
        ${recent.map((r) => html`<${EntryRow} key=${r.id} r=${r} c=${c} unit=${unit} A=${A} />`)}
      </section>`}
    </div>`;
  }

  /* entry row (shared by home + journal) */
  function EntryRow({ r, c, unit, A }) {
    const dt = new Date(r.date);
    const day = html`<div className="day"><b className="n">${dt.getDate()}</b><small>${TM.MS[dt.getMonth()]}</small></div>`;
    if (r.type === 'fill') {
      const seg = c.segs.find((s) => s.id === r.id);
      const st = station(r.station);
      return html`<button className="entry" onClick=${() => A.sheet('entry', { id: r.id })}>
        ${day}<${Badge} st=${r.station} />
        <span className="t"><b>${st.name}</b><small><span className="n">${fmt.dec(r.liters)}</span> ל׳ · ${r.full ? 'מלא' : 'חלקי'}${seg ? html` · <span className="n">${consStr(seg.kmpl, unit)}</span> ${consUnitShort(unit)}` : ''}${r.missedBefore ? ' · אחרי פספוס' : ''}</small></span>
        <span className="amt n">${fmt.money(r.total)}</span>
      </button>`;
    }
    if (r.type === 'service' || r.type === 'expense') {
      const suspicious = r.odo && c.latest && r.odo > c.latest.odo + 2000;
      return html`<button className="entry" onClick=${() => A.sheet('entry', { id: r.id })}>
        ${day}<span className="badge t"><${Icon} n=${TM.kindIcon(r)} /></span>
        <span className="t"><b>${r.label}</b><small>${r.type === 'service' ? 'טיפול' : 'הוצאה'}${r.odo ? html` · <span className=${'n' + (suspicious ? ' flag' : '')}>${fmt.int(r.odo)}</span> ק״מ${suspicious ? html` <span className="flag">· לבדוק</span>` : ''}` : ''}${r.note ? ' · ' + r.note : ''}</small></span>
        <span className="amt n">${fmt.money(r.cost)}</span>
      </button>`;
    }
    if (r.type === 'odo') return html`<button className="quiet" onClick=${() => A.sheet('entry', { id: r.id })}>קילומטראז׳ עודכן ל-<span className="n">${fmt.int(r.odo)}</span> · ${fmt.dayMon(dt)}</button>`;
    if (r.type === 'tank') return html`<button className="quiet" onClick=${() => A.sheet('entry', { id: r.id })}>סימנת מחוון דלק: ${pct(r.level)} · ${fmt.dayMon(dt)}</button>`;
    return null;
  }

  /* ================= FILL-UP FORM ================= */
  function FillForm({ db, c, A, p }) {
    const editing = p.id ? db.records.find((r) => r.id === p.id) : null;
    const v = c.v;
    const disc = db.settings.discount;
    const FUEL_KEY = { '98': '98', 'סולר': 'diesel', 'אחר': 'other' };
    const suggestPrice = (dt) => {
      const lastPaid = [...c.fills].reverse()[0];
      const base = v.fuel === '95' ? officialFor(dt) : (db.adminPrices[FUEL_KEY[v.fuel]] || {}).value ?? (lastPaid ? lastPaid.price : 7.5);
      if (disc.type === 'agorot') return Math.max(0, base - disc.value / 100);
      if (disc.type === 'percent') return base * (1 - disc.value / 100);
      return base;
    };
    const nearest = TM.STATIONS[0];
    const [f, setF] = useState(() => editing ? {
      total: String(editing.total), liters: String(editing.liters), price: String(editing.price), odo: String(editing.odo),
      typed: { total: true, liters: true, price: true }, full: editing.full, date: editing.date, station: editing.station,
      pre: editing.pre ?? null, reason: editing.reason || null, missed: !!editing.missedBefore, note: editing.note || '', open: false,
    } : {
      total: '', liters: '', price: fmt.dec(suggestPrice(now()), 2), odo: '', typed: { total: false, liters: false, price: false },
      full: true, date: isoLocal(now()), station: nearest.id, pre: null, reason: null, missed: false, note: '', open: false,
    });
    const [tried, setTried] = useState(false);
    const [shake, setShake] = useState(false);
    const totalRef = useRef(null);
    useEffect(() => { if (!editing && !p.scan && totalRef.current) totalRef.current.focus({ preventScroll: true }); }, []);
    useEffect(() => { if (p.scan) A.sheet('scan', { onResult: applyScan }); }, []);

    const set = (k, val) => setF((s) => ({ ...s, [k]: val }));
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
      A.toast('הערכים מהצילום הועברו לטופס. בדקו שהם נכונים.');
    }

    function save() {
      setTried(true);
      if (!valid) { setShake(true); setTimeout(() => setShake(false), 420); return; }
      const rec = { ...(editing || {}), id: editing ? editing.id : uid(), v: v.id, type: 'fill', date: f.date, odo, liters: Math.round(vals.liters * 100) / 100, total: Math.round(vals.total * 100) / 100, price: Math.round(vals.price * 1000) / 1000, full: f.full, station: f.station, pre: f.pre, reason: f.reason, missedBefore: f.missed, note: f.note };
      A.upsert(rec, editing ? 'עריכת תדלוק' : 'תדלוק חדש');
      if (editing) { A.back(); A.toast('השינויים נשמרו. כל החישובים עודכנו.'); }
      else A.replace('saved', { id: rec.id });
    }

    return html`<div className="pad noTabs" style=${{ gap: 16 }}>
      <div className="top">
        <button className="ib" aria-label="סגירה" onClick=${A.back}><${Icon} n="x" /></button>
        <span className="ttl" style=${{ fontSize: editing ? 34 : 40 }}>${editing ? 'עריכת תדלוק' : 'תדלוק חדש'}</span>
        <button className="ib" aria-label="צילום המשאבה ולוח הקילומטרים" onClick=${() => A.sheet('scan', { onResult: applyScan })}><${Icon} n="cam" /></button>
      </div>
      <div className="chips">
        <button className="chip" onClick=${() => set('open', true)}><${Icon} n="clock" />${isToday ? 'היום' : fmt.dayMon(dt)}, ${fmt.time(dt)}</button>
        <button className="chip" onClick=${() => A.sheet('station', { value: f.station, onPick: (id) => set('station', id) })}><${Icon} n="pin" />${st.name}${!editing && f.station === nearest.id ? html`<small>· לפי מיקום</small>` : ''}</button>
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
          <span className="s">${derived === 'price' ? 'חושב מהסכום והליטרים' : f.typed.price ? 'המחיר שהזנתם' : disc.type !== 'none' ? 'מחיר מרבי אחרי ההנחה שלך' : 'מחיר מרבי 95 החודש · אפשר לשנות'}</span>
        </div>
        <div className="prow">
          <label htmlFor="f-odo">קילומטראז׳</label>
          <div className="pv"><${NumInput} id="f-odo" decimals=${0} placeholder=${lastPt ? fmt.int(lastPt + 250).replace(/,/g, '') : '0'} value=${f.odo} onChange=${(s) => set('odo', s)} /><span className="u">ק״מ</span></div>
          ${odoErr ? html`<span className="s err">${odoErr}</span>` : tried && missing.odo ? html`<span className="s err">חסר קילומטראז׳</span>` : odo != null && lastPt ? html`<span className="s">+${fmt.int(odo - lastPt)} ק״מ מהרישום הקודם</span>` : lastPt ? html`<span className="s">אחרון: ${fmt.int(lastPt)}</span>` : null}
        </div>
      </div>
      ${conflict && html`<div className="warnbox"><${Icon} n="alert" />הסכום, הליטרים והמחיר לא מסתדרים. נשמור את מה שהקלדתם, בלי לשנות אף מספר.</div>`}

      <${Seg} big label="מצב המיכל בסוף" value=${f.full} onChange=${(x) => set('full', x)} options=${[{ v: true, l: 'מילאתי עד הסוף' }, { v: false, l: 'תדלוק חלקי' }]} />

      <div className="preview" aria-live="polite">
        ${!draft ? html`<span>מלאו סכום וק״מ ונראה מה יצא</span>`
          : ev.seg ? html`<b className="n">${consStr(ev.seg.kmpl, db.settings.unit)}</b><span>${consUnit(db.settings.unit)} צפוי למקטע הזה</span>`
          : !f.full ? html`<span>תדלוק חלקי: ${fmt.dec(vals.liters)} ל׳ יצטרפו לחישוב בטנק המלא הבא</span>`
          : html`<span>טנק מלא ראשון${f.missed ? ' אחרי פספוס' : ''}: מכאן נתחיל למדוד</span>`}
      </div>
      ${softWarn.map((w, i) => html`<div key=${i} className="warnbox"><${Icon} n="alert" />${w}</div>`)}

      <button className=${'disclosure' + (f.open ? ' open' : '')} aria-expanded=${f.open} onClick=${() => set('open', !f.open)}>
        <span>עוד פרטים<small>תאריך, מחוון דלק לפני, סיבה, הערה</small></span><${Icon} n="down" />
      </button>
      ${f.open && html`<div style=${{ display: 'grid', gap: 18 }}>
        <div className="field"><label htmlFor="f-date">מתי</label><input id="f-date" className="inp n" type="datetime-local" value=${f.date} max=${isoLocal(now())} onChange=${(e) => set('date', e.target.value)} /></div>
        <div className="level">
          <span className="lbl">כמה היה במיכל לפני התדלוק? <span className="muted" style=${{ fontWeight: 400 }}>(לא חובה)</span></span>
          <${Ticks} level=${f.pre} onPick=${(x) => set('pre', f.pre === x ? null : x)} />
          <div className="gk"><span>E</span><span>${f.pre != null ? pct(f.pre) : 'הקישו על המחוון'}</span><span>F</span></div>
        </div>
        <div className="field"><span className="lbl">למה תדלקת עכשיו?</span>
          <div className="chips">${['כמעט נגמר', 'מחיר טוב', 'לפני נסיעה', 'הייתי בדרך'].map((r) => html`<button key=${r} className=${'chip' + (f.reason === r ? ' on' : '')} onClick=${() => set('reason', f.reason === r ? null : r)}>${r}</button>`)}</div>
        </div>
        <div className="row" style=${{ borderTop: '1px solid var(--ln)' }}>
          <span className="grow"><b>פספסתי תדלוקים לפני זה</b><small>נתחיל מדידה חדשה מכאן, וההיסטוריה נשארת</small></span>
          <${Toggle} on=${f.missed} label="פספסתי תדלוקים" onChange=${(x) => set('missed', x)} />
        </div>
        <div className="field"><label htmlFor="f-note">הערה</label><textarea id="f-note" className="inp" placeholder="למשל: שטיפה כלולה" value=${f.note} onChange=${(e) => set('note', e.target.value)}></textarea></div>
      </div>`}
      ${editing && html`<button className="btn danger sm" onClick=${() => A.confirmDelete(editing.id, true)}><${Icon} n="trash" />מחיקת התדלוק</button>`}
      <div className="bottomBar"><button className="btn" onClick=${save}>${editing ? 'שמירת שינויים' : 'שמירה'}</button></div>
    </div>`;
  }

  /* ================= SAVED (post-save reveal) ================= */
  function Saved({ db, c, A, p }) {
    const rec = db.records.find((r) => r.id === p.id);
    const [left, setLeft] = useState(5);
    const [ans, setAns] = useState(rec && rec.pumpConfirmed != null ? 'done' : null);
    const [pumpPrice, setPumpPrice] = useState('');
    useEffect(() => { const t = setInterval(() => setLeft((x) => Math.max(0, x - 1)), 1000); return () => clearInterval(t); }, []);
    if (!rec) return html`<div className="pad"><${Top} onBack=${A.back} title="" /><p>הרשומה בוטלה.</p></div>`;
    const unit = db.settings.unit;
    const seg = c.segs.find((s) => s.id === rec.id);
    const isBest = seg && c.best && c.best.id === seg.id && c.segs.length >= 3;
    const firstFull = !seg && rec.full;
    let sub = '';
    if (seg && c.avg) {
      const d = seg.kmpl / c.avg - 1;
      sub = isBest ? 'השיא שלך עד היום' : Math.abs(d) < 0.03 ? 'בדיוק כמו הממוצע שלך' : d > 0 ? `${pct(d)} יותר טוב מהממוצע שלך` : `${pct(-d)} פחות טוב מהממוצע שלך`;
    }
    const undo = () => { A.removeRecord(rec.id, true); A.back(); A.toast('התדלוק בוטל'); };
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
          <div><span>המקטע</span><b><span className="n">${fmt.int(seg.km)}</span> ק״מ · <span className="n">${fmt.dec(seg.liters)}</span> ל׳</b></div>
          <div><span>עלות לק״מ במקטע</span><b><span className="n">${Math.round((seg.cost / seg.km) * 100)}</span> אג׳</b></div>
        </div>`
      : html`<div>
          <div className="disp n" style=${{ fontSize: 150 }}>${fmt.dec(rec.liters)}</div>
          <div style=${{ fontWeight: 700, fontSize: 18 }}>ליטרים · ${fmt.money(rec.total)}</div>
          <p style=${{ fontSize: 15, marginTop: 8, maxWidth: '30ch' }}>${firstFull ? 'נקודת ההתחלה נקבעה. בטנק המלא הבא נדע כמה נסעת על כל ליטר.' : 'תדלוק חלקי נשמר. הליטרים יצטרפו לחישוב כשתמלאו עד הסוף.'}</p>
        </div>`}

      ${ans === null && html`<div className="ask">
        <p>המחיר במשאבה היה ${fmt.price(rec.price)}?</p>
        <div className="two"><button className="y" onClick=${() => answer(true)}>כן</button><button onClick=${() => answer(false)}>לא, היה אחר</button></div>
        <small>עוזר לנהגים אחרים לדעת כמה עולה דלק ב${station(rec.station).name}.</small>
      </div>`}
      ${ans === 'no' && html`<div className="ask">
        <p>מה המחיר שהיה כתוב במשאבה?</p>
        <div style=${{ display: 'flex', gap: 8 }}>
          <div className="inp-wrap" style=${{ flex: 1 }}><${NumInput} className="inp n" placeholder=${fmt.dec(rec.price, 2)} value=${pumpPrice} onChange=${setPumpPrice} style=${{ background: '#fff', color: '#111' }} /><span className="unit">₪ לליטר</span></div>
          <button className="y" style=${{ padding: '0 18px' }} onClick=${() => { if (Number(pumpPrice) > 0) { A.patch(rec.id, { pumpConfirmed: false, pumpPrice: Number(pumpPrice) }); setAns('done'); } }}>שמירה</button>
        </div>
        <small>ההפרש יירשם כהנחה שקיבלת, לא כמחיר התחנה.</small>
      </div>`}
      ${ans === 'done' && html`<p style=${{ fontWeight: 600 }}>תודה. זה עוזר לכולם.</p>`}

      <div className="bottomBar" style=${{ background: 'linear-gradient(to top,var(--plate) 70%,transparent)' }}>
        <button className="btn ink" onClick=${A.back}>סיום</button>
        ${left > 0 && html`<button className="link" onClick=${undo}>ביטול השמירה (${left})</button>`}
      </div>
    </div></div>`;
  }

  /* ================= JOURNAL ================= */
  const FILTERS = [{ v: 'all', l: 'הכל' }, { v: 'fill', l: 'תדלוקים' }, { v: 'service', l: 'טיפולים' }, { v: 'expense', l: 'הוצאות' }, { v: 'odo', l: 'ק״מ ומחוון' }];
  function Journal({ db, c, A, p }) {
    const [filter, setFilter] = useState(p.filter || 'all');
    const [q, setQ] = useState('');
    const unit = db.settings.unit;
    let list = [...c.recs].sort((a, b) => new Date(b.date) - new Date(a.date));
    if (filter !== 'all') list = list.filter((r) => (filter === 'odo' ? r.type === 'odo' || r.type === 'tank' : r.type === filter));
    if (q.trim()) {
      const s = q.trim();
      list = list.filter((r) => (r.type === 'fill' && station(r.station).name.includes(s)) || (r.label || '').includes(s) || (r.note || '').includes(s));
    }
    const groups = [];
    for (const r of list) {
      const k = mkey(new Date(r.date));
      let g = groups[groups.length - 1];
      if (!g || g.k !== k) { g = { k, items: [] }; groups.push(g); }
      g.items.push(r);
    }
    return html`<div className="pad" style=${{ gap: 14 }}>
      <div className="title-row"><h1 className="h1">יומן</h1><button className="add" onClick=${() => A.sheet('addMenu')}><${Icon} n="plus" />הוספה</button></div>
      <div className="inp-wrap"><input className="inp" style=${{ minHeight: 46, paddingRight: 42 }} placeholder="חיפוש תחנה, טיפול או הערה" value=${q} onChange=${(e) => setQ(e.target.value)} aria-label="חיפוש ביומן" /><span style=${{ position: 'absolute', right: 14, top: 13, color: 'var(--tx2)' }}><${Icon} n="search" s=${20} /></span></div>
      <div className="scrollx">${FILTERS.map((f) => html`<button key=${f.v} className=${'chip' + (filter === f.v ? ' on' : '')} onClick=${() => setFilter(f.v)}>${f.l}</button>`)}</div>
      ${groups.length === 0 && html`<div className="empty"><div className="disp" style=${{ fontSize: 34 }}>${q ? 'לא נמצא כלום' : 'אין כאן עדיין רשומות'}</div><p className="muted small">${q ? 'נסו מילה אחרת.' : 'כל תדלוק, טיפול והוצאה יופיעו כאן לפי חודשים.'}</p></div>`}
      ${groups.map((g) => {
        const m = c.monthly[g.k] || { fuel: 0, service: 0, expense: 0, fills: 0 };
        const tot = m.fuel + m.service + m.expense;
        return html`<section key=${g.k}>
          <div className="month"><b>${fmt.month(g.k)}</b><span>${tot > 0 ? html`<span className="n">${fmt.money(tot)}</span>` : ''}${m.fills ? (m.fills === 1 ? ' · תדלוק אחד' : ` · ${m.fills} תדלוקים`) : ''}</span></div>
          ${g.items.map((r) => html`<${EntryRow} key=${r.id} r=${r} c=${c} unit=${unit} A=${A} />`)}
        </section>`;
      })}
    </div>`;
  }

  /* ================= INSIGHTS ================= */
  const PERIODS = [{ v: 3, l: '3 חודשים' }, { v: 6, l: '6 חודשים' }, { v: 12, l: 'שנה' }, { v: 0, l: 'הכל' }];
  function Insights({ db, c, A, p }) {
    const [tab, setTab] = useState(p.tab || 'cons');
    const [period, setPeriod] = useState(6);
    const unit = db.settings.unit;
    const from = period ? new Date(new Date(now()).setMonth(now().getMonth() - period)) : new Date(0);
    const segs = c.segs.filter((s) => s.date >= from);
    const fills = c.fills.filter((f) => new Date(f.date) >= from);
    const sumKm = segs.reduce((s, x) => s + x.km, 0), sumL = segs.reduce((s, x) => s + x.liters, 0);
    const avgP = sumL ? sumKm / sumL : null;

    let body = null;
    if (tab === 'cons') {
      if (!segs.length) body = html`<div className="empty"><div className="disp" style=${{ fontSize: 34 }}>אין עדיין מקטעים בתקופה הזו</div><p className="muted small">מקטע נסגר בכל פעם שממלאים עד הסוף אחרי טנק מלא קודם.</p></div>`;
      else {
        const vsMfr = c.v.mfr ? avgP / c.v.mfr - 1 : null;
        const lastTone = segs.length && avgP ? (segs[segs.length - 1].kmpl < avgP * 0.97 ? 'var(--worse)' : segs[segs.length - 1].kmpl > avgP * 1.03 ? 'var(--better)' : 'var(--tx)') : null;
        const bestP = segs.reduce((b, s) => (!b || s.kmpl > b.kmpl ? s : b), null);
        const worstP = segs.reduce((b, s) => (!b || s.kmpl < b.kmpl ? s : b), null);
        body = html`
          <article className="card">
            <span className="lbl">צריכה ממוצעת · לפי מרחק</span>
            <h4>${unit === 'l100' ? html`אתה צורך <span className="n">${consStr(avgP, unit)}</span> ל׳ ל-100 ק״מ` : html`אתה נוסע <span className="n">${consStr(avgP, unit)}</span> ק״מ לליטר`}</h4>
            <${LineChart} series=${segs.map((s) => cons(s.kmpl, unit))} avgLine=${cons(avgP, unit)} labels=${segs.map((s) => fmt.short(s.date))} highlightLast=${lastTone} />
            <div className="legend"><span><i></i>כל מקטע בין טנקים מלאים</span><span><i className="dash"></i>הממוצע שלך</span></div>
            ${vsMfr != null && html`<p className="small muted">${Math.abs(vsMfr) < 0.03 ? 'בדיוק כמו נתון היצרן' : `${pct(Math.abs(vsMfr))} ${vsMfr < 0 ? 'מתחת' : 'מעל'} לנתון היצרן (${consStr(c.v.mfr, unit)})`}. רוב הרכבים בישראל נוסעים פחות מהנתון הרשמי.</p>`}
          </article>
          <div className="kpis">
            <button className="row" style=${{ display: 'grid', border: 0, minHeight: 0, padding: '10px 0' }} onClick=${() => A.sheet('segment', { id: bestP.id })}><small className="muted">המקטע הטוב</small><b style=${{ font: '700 28px/1 var(--display)' }} className="n">${consStr(bestP.kmpl, unit)}</b><small className="muted">${fmt.dayMon(bestP.date)}</small></button>
            <button className="row" style=${{ display: 'grid', border: 0, borderRight: '1px solid var(--ln)', paddingRight: 12, minHeight: 0 }} onClick=${() => A.sheet('segment', { id: worstP.id })}><small className="muted">המקטע החלש</small><b style=${{ font: '700 28px/1 var(--display)' }} className="n">${consStr(worstP.kmpl, unit)}</b><small className="muted">${fmt.dayMon(worstP.date)}</small></button>
            <div><small>מרחק שנמדד</small><b className="n">${fmt.int(sumKm)}</b><small>ק״מ ב-${segs.length} מקטעים</small></div>
            <div><small>דלק במקטעים</small><b className="n">${fmt.int(sumL)}</b><small>ליטרים</small></div>
          </div>`;
      }
    }
    if (tab === 'price') {
      const months = [...new Set(fills.map((f) => mkey(new Date(f.date))))].sort();
      const paid = months.map((k) => { const fs = fills.filter((f) => mkey(new Date(f.date)) === k); return fs.reduce((s, f) => s + f.total, 0) / fs.reduce((s, f) => s + f.liters, 0); });
      const offi = months.map((k) => TM.OFFICIAL[k] || null);
      const totL = fills.reduce((s, f) => s + f.liters, 0), totC = fills.reduce((s, f) => s + f.total, 0);
      const st = {};
      for (const f of fills) { const s = (st[f.station] = st[f.station] || { id: f.station, l: 0, c: 0, n: 0 }); s.l += f.liters; s.c += f.total; s.n++; }
      const ranked = Object.values(st).map((s) => ({ ...s, p: s.c / s.l })).sort((a, b) => a.p - b.p);
      const maxP = Math.max(...ranked.map((r) => r.p), 1), minP = Math.min(...ranked.map((r) => r.p), 0);
      const spread = ranked.length > 1 ? ranked[ranked.length - 1].p - ranked[0].p : 0;
      body = fills.length ? html`
        <article className="card">
          <span className="lbl">מחיר ממוצע ששילמת</span>
          <h4><span className="n">${fmt.price(totC / totL)}</span> לליטר</h4>
          ${months.length > 1 && html`<${LineChart} series=${paid} second=${offi} labels=${months.map(fmt.monthShort)} formatY=${(v) => v.toFixed(2)} />
          <div className="legend"><span><i></i>מה ששילמת</span><span><i className="dash"></i>המחיר המרבי של 95</span></div>`}
        </article>
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
      const fuel = sum('fuel'), service = sum('service'), expense = sum('expense');
      const segCost = segs.reduce((s, x) => s + x.cost, 0);
      body = html`
        <${TcoBlock} c=${c} A=${A} compact />
        <article className="card">
          <span className="lbl">סה״כ ברכב · ${PERIODS.find((x) => x.v === period).l}</span>
          <h4 className="n">${fmt.money(fuel + service + expense)}</h4>
          <${Bars} data=${data} keys=${['fuel', 'service', 'expense']} colors=${['var(--plate)', 'var(--tx2)', 'var(--sf2)']} labels=${keys.map(fmt.monthShort)} />
          <div className="legend"><span><i className="sq" style=${{ background: 'var(--plate)' }}></i>דלק</span><span><i className="sq" style=${{ background: 'var(--tx2)' }}></i>טיפולים</span><span><i className="sq" style=${{ background: 'var(--sf2)', boxShadow: 'inset 0 0 0 1px var(--tx)' }}></i>הוצאות</span></div>
        </article>
        ${sumKm > 0 && html`<article className="card" style=${{ gridTemplateColumns: '1fr auto', alignItems: 'end' }}>
          <div style=${{ display: 'grid', gap: 4 }}><span className="lbl">דלק לכל ק״מ</span><h4>כל ק״מ עולה לך</h4></div>
          <span className="disp n" style=${{ fontSize: 64 }}>${Math.round((segCost / sumKm) * 100)}<span style=${{ fontSize: 26 }}> אג׳</span></span>
        </article>`}
        <div className="group">
          <${Row} title="דלק" value=${html`<span className="n">${fmt.money(fuel)}</span>`} onClick=${() => A.tab('journal', { filter: 'fill' })} />
          <${Row} title="טיפולים" value=${html`<span className="n">${fmt.money(service)}</span>`} onClick=${() => A.tab('journal', { filter: 'service' })} />
          <${Row} title="הוצאות אחרות" value=${html`<span className="n">${fmt.money(expense)}</span>`} onClick=${() => A.tab('journal', { filter: 'expense' })} />
        </div>`;
    }
    if (tab === 'community') {
      const on = db.settings.community;
      body = on ? html`
        <article className="card">
          <span className="lbl">${c.v.make} ${c.v.model} · ${c.v.year} · בנזין ${c.v.fuel}</span>
          <h4>עוד נהג אחד ונשווה</h4>
          <div className="progress"><i style=${{ width: '75%' }}></i></div>
          <p className="small muted">יש כרגע 3 מתוך 4 נהגים עם רכב דומה. כשיהיה רביעי, תראו איפה הצריכה שלכם ביחס אליהם.</p>
        </article>
        <article className="card">
          <span className="lbl">מה משותף</span>
          <p className="small">רק סיכום אחד לרכב: דגם, שנה, סוג דלק, צריכה ממוצעת ומחיר ממוצע. בלי שם, מייל, לוחית, מיקום או תאריכים.</p>
          <button className="link" style=${{ justifySelf: 'start', padding: 0 }} onClick=${() => A.go('account')}>אפשר לכבות בהגדרות</button>
        </article>`
        : html`<div className="empty"><div className="disp" style=${{ fontSize: 34 }}>ההשוואה כבויה</div><p className="muted small">כדי לראות איך אתם ביחס לנהגים עם אותו רכב, צריך לשתף סיכום אנונימי של הצריכה.</p><button className="btn line sm" onClick=${() => A.setSetting('community', true)}>להפעיל השוואה</button></div>`;
    }

    return html`<div className="pad" style=${{ gap: 16 }}>
      <div className="title-row"><h1 className="h1">תובנות</h1>
        <button className="chip" onClick=${() => A.sheet('choice', { title: 'תקופה', value: period, options: PERIODS, onPick: setPeriod })}>${PERIODS.find((x) => x.v === period).l}<${Icon} n="down" /></button>
      </div>
      <div className="scrollx">${[{ v: 'cons', l: 'צריכה' }, { v: 'price', l: 'מחירים' }, { v: 'spend', l: 'הוצאות' }, { v: 'community', l: 'השוואה' }].map((t) => html`<button key=${t.v} className=${'chip' + (tab === t.v ? ' on' : '')} onClick=${() => setTab(t.v)}>${t.l}</button>`)}</div>
      ${body}
    </div>`;
  }

  window.S1 = { TcoBlock, Home, FillForm, Saved, Journal, Insights, EntryRow, syncState, SYNC_LABEL, pct };
})();
