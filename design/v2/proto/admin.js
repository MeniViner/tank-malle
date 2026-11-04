/* טנק מלא · prototype — admin dashboard (/admin). Read-only over other users by construction. */
(function () {
  'use strict';
  const { html, Icon, Top, Seg, Row, Sheet, Bars, NumInput, Spinner, useState, useEffect } = UI;
  const { fmt, now, mkey, uid, DAY, officialFor } = TM;

  // deterministic demo population
  const NAMES = ['נועה כהן', 'איתי לוי', 'שירה מזרחי', 'יונתן פרץ', 'מאיה ביטון', 'עומר דהן', 'תמר אזולאי', 'אורי פרידמן', 'ליאור שפירא', 'הדר גבאי', 'דניאל אוחיון', 'רוני אברהם', 'עדי סויסה', 'גיא חדד', 'יעל רוזן', 'אלון קליין', 'מיכל אלמוג', 'נדב שטרן', 'ענבל טל', 'בן אשכנזי', 'רותם גולן', 'אביב נחום', 'שקד ברק', 'עמית יוסף', 'הילה זילבר', 'אסף מור', 'קרן לב', 'טל ששון', 'ניר בר', 'ליה עמר'];
  const CARS = ['טויוטה קורולה', 'יונדאי i20', 'קיה פיקנטו', 'מאזדה 3', 'סקודה אוקטביה', 'יונדאי איוניק', 'שברולט ספארק', 'סוזוקי סוויפט', 'טויוטה יאריס', 'מיצובישי אטראז׳'];
  let seed = 7;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const POP = NAMES.map((n, i) => {
    const has = rnd() > 0.12;
    const fills = has ? Math.round(2 + rnd() * 60) : 0;
    return {
      uid: 'u' + i, name: n, email: `driver${i + 1}@example.com`, car: CARS[i % CARS.length],
      vehicles: has ? (rnd() > 0.85 ? 2 : 1) : 0, fills, kmpl: has && fills > 2 ? 10 + rnd() * 9 : null,
      spend: Math.round(fills * (180 + rnd() * 90)), joined: new Date(now().getTime() - Math.round(rnd() * 400) * DAY), summary: has,
    };
  });

  function useMe(db) {
    const recs = db.records;
    const fills = recs.filter((r) => r.type === 'fill');
    const segs = db.activeV ? (TM.compute(db, db.activeV) || {}).avg : null;
    return { uid: 'me', name: db.user.name, email: db.user.email, car: 'יונדאי i20', vehicles: db.vehicles.length, fills: fills.length, kmpl: segs, spend: fills.reduce((s, f) => s + f.total, 0), joined: new Date('2026-06-01'), summary: true, me: true };
  }

  const Tile = ({ label, value, sub }) => html`<div style=${{ display: 'grid', gap: 2, padding: '12px 0' }}><small className="muted" style=${{ fontSize: 12.5 }}>${label}</small><b className="n" style=${{ font: '700 40px/1 var(--display)' }}>${value}</b>${sub && html`<small className="note">${sub}</small>`}</div>`;

  function Admin({ db, A }) {
    const [tab, setTab] = useState('overview');
    const [state, setState] = useState('loading'); // loading | ok | error
    const [failOnce, setFailOnce] = useState(true);
    const [q, setQ] = useState('');
    const [sort, setSort] = useState('activity');
    const [shown, setShown] = useState(15);
    const [fbFilter, setFbFilter] = useState('all');
    const [pulling, setPulling] = useState(false);
    const [checking, setChecking] = useState(false);
    const me = useMe(db);
    const users = [me, ...POP];

    const load = () => { setState('loading'); setTimeout(() => setState('ok'), 700); };
    useEffect(() => { load(); }, []);

    if (!db.user.admin) return html`<div className="pad noTabs"><${Top} onBack=${A.back} title="לוח בקרה" /><div className="empty"><div className="disp" style=${{ fontSize: 36 }}>אין הרשאה</div><p className="muted small">לוח הבקרה זמין רק לחשבונות עם הרשאת מנהל.</p></div></div>`;

    const loaded = users.slice(0, shown + 1);
    const totals = {
      users: 214, vehicles: 248,
      records: loaded.reduce((s, u) => s + u.fills, 0) * 3 + 1840,
      kmpl: 13.4,
    };
    const counts = { fill: loaded.reduce((s, u) => s + u.fills, 0) + 2810, expense: 412, service: 296, odo: 1138 };
    const months = []; for (let i = 5; i >= 0; i--) { const d = new Date(now()); d.setDate(1); d.setMonth(d.getMonth() - i); months.push(mkey(d)); }
    const spend = months.map((k, i) => ({ fuel: 38000 + i * 4100 + (i % 2) * 2600, service: 6100 + (i % 3) * 1400, expense: 2300 + i * 210 }));

    let list = users.filter((u) => !q.trim() || u.name.includes(q.trim()) || u.email.includes(q.trim().toLowerCase()));
    list = [...list].sort((a, b) => (sort === 'activity' ? b.fills - a.fills : sort === 'spend' ? b.spend - a.spend : b.joined - a.joined));
    const visible = list.slice(0, q ? list.length : shown);

    const fb = db.feedback.filter((f) => fbFilter === 'all' || f.kind === fbFilter).sort((a, b) => new Date(b.date) - new Date(a.date));
    const KIND = { bug: { l: 'תקלה', c: 'worse' }, idea: { l: 'רעיון', c: 'better' }, love: { l: 'מחמאה', c: 'neutral' } };
    const prices = db.adminPrices;
    const off95 = officialFor(now());

    const pull = () => {
      setPulling(true);
      setTimeout(() => { setPulling(false); const pub = TM.PUBLISHED[mkey(now())] || off95; const changed = Math.abs(pub - off95) > 0.001; A.setAdminPrice('95', pub, 'auto'); A.toast(changed ? `נקרא מ-gov.il: ${fmt.price(pub)}. המחיר הידני הוחלף במחיר הרשמי.` : `נקרא מ-gov.il: ${fmt.price(pub)}. לא היה שינוי.`); }, 1200);
    };
    const check = () => { setChecking(true); setTimeout(() => { setChecking(false); A.toast('כל המקורות נבדקו'); }, 1000); };

    return html`<div className="pad noTabs" style=${{ gap: 18 }}>
      <${Top} onBack=${A.back} title="לוח בקרה" right=${html`<button className="ib" aria-label="רענון" onClick=${load}><${Icon} n="cloud" /></button>`} />
      <div className="scrollx" role="tablist" aria-label="מדורי ניהול">${[{ v: 'overview', l: 'סקירה' }, { v: 'users', l: 'משתמשים' }, { v: 'data', l: 'נתונים' }, { v: 'feedback', l: `משוב${db.feedback.some((f) => !f.handled) ? ' ·' : ''}` }].map((t) => html`<button key=${t.v} role="tab" aria-selected=${tab === t.v} className=${'chip' + (tab === t.v ? ' on' : '')} onClick=${() => setTab(t.v)}>${t.l}</button>`)}</div>

      ${state === 'loading' && html`<div style=${{ display: 'grid', justifyItems: 'center', gap: 12, padding: '60px 0' }}><${Spinner} /><span className="muted small">טוענים…</span></div>`}
      ${state === 'error' && html`<div className="empty"><div className="disp" style=${{ fontSize: 34 }}>הטעינה נכשלה</div><p className="muted small">השרת לא ענה. שום דבר לא השתנה.</p><button className="btn line sm" onClick=${load}>ניסיון נוסף</button></div>`}

      ${state === 'ok' && tab === 'overview' && html`
        <section>
          <h2 className="group-h">המערכת</h2>
          <div className="kpis" style=${{ borderTop: '1.5px solid var(--tx)' }}>
            <${Tile} label="משתמשים" value=${fmt.int(totals.users)} sub="+6 השבוע" />
            <${Tile} label="רכבים" value=${fmt.int(totals.vehicles)} />
            <${Tile} label="רשומות יומן" value=${fmt.int(totals.records)} />
            <${Tile} label="צריכה ממוצעת" value=${fmt.dec(totals.kmpl)} sub="ק״מ/ל׳, משוקלל לפי מרחק" />
          </div>
          <div className="chips" style=${{ marginTop: 10 }}>
            <span className="chip">תדלוקים <b className="n">${fmt.int(counts.fill)}</b></span>
            <span className="chip">טיפולים <b className="n">${fmt.int(counts.service)}</b></span>
            <span className="chip">הוצאות <b className="n">${fmt.int(counts.expense)}</b></span>
            <span className="chip">עדכוני ק״מ <b className="n">${fmt.int(counts.odo)}</b></span>
          </div>
          <p className="note" style=${{ marginTop: 10 }}>נטענו ${loaded.length} חשבונות מתוך ${totals.users}. הספירות מסיכומים שהחשבונות פרסמו, ולכן חלקיות עד שכל החשבונות נטענים.</p>
        </section>
        <article className="card">
          <span className="lbl">הוצאה של כל המשתמשים · 6 חודשים</span>
          <h4 className="n">${fmt.money(spend.reduce((s, m) => s + m.fuel + m.service + m.expense, 0))}</h4>
          <${Bars} data=${spend} keys=${['fuel', 'service', 'expense']} colors=${['var(--plate)', 'var(--tx2)', 'var(--sf2)']} labels=${months.map(fmt.monthShort)} />
          <div className="legend"><span><i className="sq" style=${{ background: 'var(--plate)' }}></i>דלק</span><span><i className="sq" style=${{ background: 'var(--tx2)' }}></i>טיפולים</span><span><i className="sq" style=${{ background: 'var(--sf2)', boxShadow: 'inset 0 0 0 1px var(--tx)' }}></i>הוצאות</span></div>
        </article>
        <div className="group">
          <${Row} icon="users" title="מאגר ההשוואה" sub="סיכומי צריכה בלי שם או מייל" value=${html`<span className="n">163</span> רשומות`} />
          <${Row} icon="chat" title="משוב שלא טופל" value=${html`<span className="n">${db.feedback.filter((f) => !f.handled).length}</span>`} onClick=${() => setTab('feedback')} />
          <${Row} icon="coin" title="מחיר 95 החודש" value=${fmt.price(off95)} onClick=${() => setTab('data')} />
        </div>`}

      ${state === 'ok' && tab === 'users' && html`
        <div className="inp-wrap"><input type="search" className="inp" style=${{ minHeight: 46, paddingRight: 42 }} placeholder="חיפוש לפי שם או מייל" value=${q} onChange=${(e) => setQ(e.target.value)} aria-label="חיפוש משתמשים" /><span style=${{ position: 'absolute', right: 14, top: 13, color: 'var(--tx2)' }}><${Icon} n="search" s=${20} /></span></div>
        <${Seg} label="מיון משתמשים" value=${sort} onChange=${setSort} options=${[{ v: 'activity', l: 'תדלוקים' }, { v: 'spend', l: 'הוצאה' }, { v: 'joined', l: 'הצטרפות' }]} />
        <div className="group">${visible.map((u) => html`<button key=${u.uid} className="row" onClick=${() => A.sheet('adminUser', { u })}>
          <span className="avatar" style=${{ width: 38, height: 38, fontSize: 15 }}>${u.name[0]}</span>
          <span className="grow"><b>${u.name}${u.me ? ' (את/ה)' : ''}</b><small className="n" style=${{ textAlign: 'right' }}>${u.email}</small></span>
          <span style=${{ display: 'grid', justifyItems: 'end' }}><b className="n" style=${{ font: '700 24px/1 var(--display)' }}>${u.summary ? (sort === 'spend' ? fmt.money(u.spend) : sort === 'joined' ? fmt.short(u.joined) : u.fills) : '—'}</b><small className="note">${sort === 'spend' ? 'הוצאה' : sort === 'joined' ? 'הצטרף' : 'תדלוקים'}</small></span>
        </button>`)}</div>
        ${!visible.length && html`<p className="muted small">לא נמצאו משתמשים בחשבונות שנטענו.</p>`}
        ${!q && shown < users.length - 1 && html`<button className="btn line sm" onClick=${() => setShown(users.length)}>טעינת עוד ${users.length - 1 - shown} משתמשים</button>`}
        <p className="note">החיפוש והמיון חלים על החשבונות שנטענו. נתוני משתמשים לקריאה בלבד.</p>`}

      ${state === 'ok' && tab === 'data' && html`
        <section>
          <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h2 className="group-h" style=${{ margin: 0 }}>מחירי דלק</h2>
            <button className="chip" disabled=${pulling} onClick=${pull}>${pulling ? html`<${Spinner} />` : html`<${Icon} n="download" />`}${pulling ? 'קוראים…' : 'משיכה עכשיו'}</button>
          </div>
          <p className="note" style=${{ margin: '6px 0 8px' }}>רק 95 בשירות עצמי מפוקח. את השאר מנהל מעדכן ידנית.</p>
          <div className="group">
            ${[{ k: '95', l: 'בנזין 95 · מפוקח' }, { k: '98', l: 'בנזין 98' }, { k: 'diesel', l: 'סולר' }, { k: 'other', l: 'אחר' }].map((f) => {
              const p = prices[f.k];
              const val = f.k === '95' ? off95 : p.value;
              return html`<${Row} key=${f.k} title=${f.l} sub=${p.value == null && f.k !== '95' ? 'לא הוגדר. נהגים יראו "מחיר לא ידוע"' : p.source === 'auto' ? `עודכן אוטומטית · ${fmt.rel(new Date(p.at))}` : `עודכן ידנית · ${fmt.rel(new Date(p.at))}`} value=${val != null ? html`<span className="n">${fmt.price(val)}</span>` : '—'} onClick=${() => A.sheet('adminPrice', { k: f.k, l: f.l, value: val })} />`;
            })}
          </div>
        </section>
        <section>
          <h2 className="group-h">מקורות ובריאות</h2>
          <div className="group">
            <${Row} title="הרשאת כתיבה למחירים" sub="נבדק מול הרשאת המנהל בחשבון" value=${html`<span style=${{ color: '#3E9B5F', fontWeight: 700 }}>מותרת</span>`} />
            <${Row} title="עדכון אוטומטי של 95" sub="משימה יומית שקוראת את הודעת משרד האנרגיה" value=${html`<span style=${{ color: '#3E9B5F', fontWeight: 700 }}>רץ היום 06:00</span>`} />
            <${Row} title="קטלוג התחנות" sub="קובץ סטטי, 1,247 תחנות" value="תקין" />
            <${Row} title="מרשם משרד האנרגיה" sub="data.gov.il" value="תקין" />
            <${Row} title="מחירים לפי תחנה" sub="דורש שדרוג ל-Blaze. עד אז מוצג המחיר הארצי" value=${html`<span className="muted">כבוי</span>`} />
          </div>
          <button className="btn line sm" style=${{ marginTop: 12 }} disabled=${checking} onClick=${check}>${checking ? html`<${Spinner} />` : null}בדיקה עכשיו</button>
        </section>`}

      ${state === 'ok' && tab === 'feedback' && html`
        <${Seg} label="סינון משוב" value=${fbFilter} onChange=${setFbFilter} options=${[{ v: 'all', l: 'הכל' }, { v: 'bug', l: 'תקלות' }, { v: 'idea', l: 'רעיונות' }, { v: 'love', l: 'מחמאות' }]} />
        ${fb.length === 0 && html`<div className="empty"><div className="disp" style=${{ fontSize: 34 }}>אין משוב כאן</div></div>`}
        ${fb.map((f) => html`<button key=${f.id} className="card" style=${{ textAlign: 'right', gap: 6, opacity: f.handled ? 0.6 : 1 }} onClick=${() => A.sheet('adminFeedback', { id: f.id })}>
          <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}><span className=${'pill ' + KIND[f.kind].c}>${KIND[f.kind].l}</span><span className="note">${f.handled ? 'טופל · ' : ''}${fmt.rel(new Date(f.date))}</span></div>
          <p style=${{ fontSize: 15, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>${f.text}</p>
          <small className="muted">${f.from}</small>
        </button>`)}
        <p className="note">משוב לא ניתן לעריכה אחרי שנשלח. אפשר רק לסמן שטופל.</p>`}

      <button className="link note" style=${{ alignSelf: 'center' }} onClick=${() => { setState('error'); }}>הדגמה: מצב שגיאת טעינה</button>
    </div>`;
  }

  function AdminUser({ A, p }) {
    const u = p.u;
    return html`<${Sheet} title=${u.name} onClose=${A.close}>
      <span className="muted n" style=${{ textAlign: 'right' }}>${u.email}</span>
      <div className="group">
        <${Row} title="רכבים" value=${u.summary ? u.vehicles : '—'} />
        <${Row} title="רכב עיקרי" value=${u.summary ? u.car : '—'} />
        <${Row} title="תדלוקים" value=${u.summary ? html`<span className="n">${u.fills}</span>` : '—'} />
        <${Row} title="צריכה ממוצעת" value=${u.kmpl ? html`<span className="n">${fmt.dec(u.kmpl)}</span> ק״מ/ל׳` : '—'} />
        <${Row} title="הוצאה שפורסמה" value=${u.summary ? html`<span className="n">${fmt.money(u.spend)}</span>` : '—'} />
        <${Row} title="הצטרפות" value=${fmt.date(u.joined)} />
      </div>
      <p className="note">${u.summary ? 'הנתונים הם סיכום שהחשבון פרסם.' : 'לחשבון הזה אין עדיין סיכום תקין.'} אין אפשרות לערוך או למחוק נתונים של משתמש אחר.</p>
    <//>`;
  }

  function AdminPrice({ db, A, p }) {
    const [val, setVal] = useState(p.value != null ? fmt.dec(p.value, 2) : '');
    const n = Number(val);
    const ok = val !== '' && n > 3 && n < 15;
    const warn = ok && p.value && Math.abs(n - p.value) > 0.5 ? `שינוי של ${fmt.price(Math.abs(n - p.value))} בבת אחת. בטוח?` : null;
    return html`<${Sheet} title=${'מחיר לליטר · ' + p.l} onClose=${A.close}>
      <div className="pump"><div className="prow"><label htmlFor="ap-v">${TM.MONTHS[now().getMonth()]}</label><div className="pv"><span className="u">₪</span><${NumInput} id="ap-v" value=${val} onChange=${setVal} placeholder="0.00" autoFocus /></div>
        ${val !== '' && !ok ? html`<span className="s err">מחיר בין ₪3 ל-₪15</span>` : html`<span className="s">${p.k === '95' ? 'ידני עוקף את העדכון האוטומטי לחודש הזה' : 'יוצע לנהגים עם הדלק הזה'}</span>`}</div></div>
      ${warn && html`<div className="warnbox"><${Icon} n="alert" />${warn}</div>`}
      <button className="btn" disabled=${!ok} onClick=${() => { A.setAdminPrice(p.k, n, 'manual'); A.close(); A.toast(`${p.l}: ${fmt.price(n)} נשמר. נהגים יראו אותו מיד.`); }}>שמירה</button>
      ${p.k !== '95' && db.adminPrices[p.k].value != null && html`<button className="btn danger sm" onClick=${() => { A.setAdminPrice(p.k, null, 'manual'); A.close(); A.toast('המחיר הוסר'); }}>הסרת המחיר</button>`}
    <//>`;
  }

  function AdminFeedback({ db, A, p }) {
    const f = db.feedback.find((x) => x.id === p.id);
    if (!f) return null;
    const L = { bug: 'תקלה', idea: 'רעיון', love: 'מחמאה' };
    return html`<${Sheet} title=${L[f.kind]} onClose=${A.close}>
      <p style=${{ fontSize: 16.5, lineHeight: 1.7 }}>${f.text}</p>
      <div className="group">
        <${Row} title="מאת" value=${f.from} />
        <${Row} title="נשלח" value=${`${fmt.date(new Date(f.date))}, ${fmt.time(new Date(f.date))}`} />
        <${Row} title="מכשיר" value=${f.device || 'Android · Chrome'} />
      </div>
      <button className=${'btn ' + (f.handled ? 'line' : 'ink')} onClick=${() => { A.setFeedbackHandled(f.id, !f.handled); A.close(); }}>${f.handled ? 'החזרה לטיפול' : 'סימון כטופל'}</button>
    <//>`;
  }

  window.S3 = { Admin };
  Object.assign(window.SHEETS, { adminUser: AdminUser, adminPrice: AdminPrice, adminFeedback: AdminFeedback });
})();
