/* טנק מלא · prototype — shared UI pieces */
(function () {
  'use strict';
  const { useState, useEffect, useRef } = React;
  const html = htm.bind(React.createElement);
  const { fmt, station, brandLetter } = TM;

  const Icon = ({ n, s = 24 }) => html`<svg width=${s} height=${s} aria-hidden="true" focusable="false"><use href=${'#i-' + n} /></svg>`;
  const N = ({ children, className = '' }) => html`<span className=${'n ' + className}>${children}</span>`;

  // consumption in the user's unit
  // units: kml / l100 for petrol, kwh100 / kmkwh for electric (the engine value is always km per litre or km per kWh)
  const cons = (kmpl, unit) => (unit === 'l100' || unit === 'kwh100' ? 100 / kmpl : kmpl);
  const consStr = (kmpl, unit) => (kmpl == null ? '—' : fmt.dec(cons(kmpl, unit), 1));
  const consUnit = (unit) => ({ l100: 'ל׳ ל-100 ק״מ', kml: 'ק״מ לליטר', kwh100: 'kWh ל-100 ק״מ', kmkwh: 'ק״מ ל-kWh' }[unit] || 'ק״מ לליטר');
  const consUnitShort = (unit) => ({ l100: 'ל׳/100', kml: 'ק״מ/ל׳', kwh100: 'kWh/100', kmkwh: 'ק״מ/kWh' }[unit] || 'ק״מ/ל׳');
  const unitFor = (db, c) => (c && c.ev ? (db.settings.evUnit || 'kwh100') : db.settings.unit);

  function Top({ title, onBack, right, big }) {
    return html`<div className="top">
      ${onBack ? html`<button className="ib" aria-label="חזרה" onClick=${onBack}><${Icon} n="back" /></button>` : html`<span style=${{ width: 44 }}></span>`}
      ${big ? null : html`<span className="ttl">${title}</span>`}
      ${right || html`<span style=${{ width: 44 }}></span>`}
    </div>`;
  }

  function Sheet({ title, onClose, children }) {
    useEffect(() => {
      const k = (e) => { if (e.key === 'Escape') onClose(); };
      window.addEventListener('keydown', k);
      return () => window.removeEventListener('keydown', k);
    }, [onClose]);
    return html`<${React.Fragment}>
      <div className="scrim" onClick=${onClose}></div>
      <div className="sheet" role="dialog" aria-modal="true" aria-label=${title || ''}>
        <div className="grab"></div>
        ${title != null && html`<div className="sheet-h"><h3>${title}</h3><button className="ib" aria-label="סגירה" onClick=${onClose}><${Icon} n="x" /></button></div>`}
        ${children}
      </div>
    <//>`;
  }

  const Toggle = ({ on, onChange, label }) => html`<button className=${'toggle' + (on ? ' on' : '')} role="switch" aria-checked=${on} aria-label=${label} onClick=${() => onChange(!on)}></button>`;

  const Seg = ({ value, options, onChange, big, label }) => html`<div className=${'seg' + (big ? ' big' : '')} role="radiogroup" aria-label=${label || ''}>
    ${options.map((o) => html`<button key=${o.v} role="radio" aria-checked=${value === o.v} className=${value === o.v ? 'on' : ''} onClick=${() => onChange(o.v)}>${o.l}</button>`)}
  </div>`;

  function Row({ icon, title, sub, value, onClick, danger, children, chevron = true }) {
    const inner = html`
      ${icon && html`<span className="ri"><${Icon} n=${icon} /></span>`}
      <span className="grow"><b>${title}</b>${sub && html`<small>${sub}</small>`}</span>
      ${value != null && html`<span className="val">${value}</span>`}
      ${children}
      ${onClick && chevron && html`<${Icon} n="chev" />`}`;
    return onClick
      ? html`<button className=${'row' + (danger ? ' danger' : '')} onClick=${onClick}>${inner}</button>`
      : html`<div className=${'row' + (danger ? ' danger' : '')}>${inner}</div>`;
  }

  const Badge = ({ st }) => { const s = station(st); return html`<span className=${'badge ' + s.brand} aria-hidden="true">${brandLetter[s.brand]}</span>`; };

  const MiniPlate = ({ plate }) => html`<span className="miniplate"><span>${fmt.plate(plate)}</span></span>`;

  function PlateXL({ value, placeholder, style }) {
    const s = String(value || '');
    let shown = fmt.plate(s);
    if (placeholder) {
      const full = (s + '00000000').slice(0, Math.max(7, s.length));
      const f = fmt.plate(full);
      let typed = 0, out = [];
      for (const ch of f) {
        if (ch === '-') { out.push(html`<span key=${out.length}>-</span>`); continue; }
        out.push(html`<span key=${out.length} className=${typed < s.length ? '' : 'ph0'}>${ch}</span>`); typed++;
      }
      shown = out;
    }
    return html`<div className="plate-xl" style=${style} aria-label=${'לוחית ' + fmt.plate(s)}><span className="il">IL</span><span className="num">${shown}</span></div>`;
  }

  // 20-segment fuel gauge
  function Ticks({ level, habit, onPick, low, habitLabel }) {
    const filled = level == null ? 0 : Math.round(level * 20);
    const hab = habit != null ? Math.round(habit * 20) : -1;
    return html`<div className="ticks">
      ${Array.from({ length: 20 }, (_, i) => html`<i key=${i} className=${i < filled ? (low ? 'f low' : hab >= 0 && i >= hab ? 'f use' : 'f') : ''} onClick=${onPick ? () => onPick((i + 1) / 20) : undefined} role=${onPick ? 'button' : undefined} aria-label=${onPick ? `${(i + 1) * 5}%` : undefined}></i>`)}
      ${habit != null && html`<span className=${'hab' + (habitLabel ? ' lbl' : '')} style=${{ left: habit * 100 + '%' }}>${habitLabel && html`<em>${habitLabel}</em>`}</span>`}
    </div>`;
  }

  // RTL line chart: oldest on the right.
  function LineChart({ series, avgLine: refLine, height = 130, labels, highlightLast, color, formatY = (v) => v.toFixed(1), second }) {
    const W = 330, H = height, padT = 14, padB = 22, padX = 14;
    const all = [...series, ...(second || []), ...(refLine != null ? [refLine] : [])].filter((x) => x != null);
    if (!series.length) return null;
    let min = Math.min(...all), max = Math.max(...all);
    if (max - min < 1e-6) { max += 1; min -= 1; }
    const span = max - min; min -= span * 0.12; max += span * 0.12;
    const n = series.length;
    const x = (i) => (n === 1 ? W / 2 : W - padX - (i * (W - 2 * padX)) / (n - 1));
    const y = (v) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
    const pts = series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const pts2 = second ? second.map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean).join(' ') : null;
    const step = Math.ceil(n / 6);
    return html`<svg className="chart" viewBox=${`0 0 ${W} ${H}`} height=${H} role="img" aria-label="גרף">
      ${refLine != null && html`<g><line x1="0" x2=${W} y1=${y(refLine)} y2=${y(refLine)} stroke="currentColor" strokeDasharray="4 4" opacity=".5" /><text x="2" y=${y(refLine) - 5}>${formatY(refLine)}</text></g>`}
      ${pts2 && html`<polyline points=${pts2} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="2 4" opacity=".7" />`}
      <polyline points=${pts} fill="none" style=${{ stroke: color || 'currentColor' }} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      ${series.map((v, i) => {
        const last = highlightLast && i === n - 1;
        return html`<circle key=${i} cx=${x(i)} cy=${y(v)} r=${last ? 6 : 3.5} style=${{ fill: last ? highlightLast : 'var(--sf)', stroke: last ? 'none' : 'currentColor' }} strokeWidth="2" />`;
      })}
      ${labels && labels.map((l, i) => (i % step === 0 || i === n - 1) && html`<text key=${'l' + i} x=${x(i)} y=${H - 4} textAnchor="middle">${l}</text>`)}
    </svg>`;
  }

  // stacked bars by month (RTL: oldest right)
  function Bars({ data, keys, colors, height = 140, labels }) {
    const W = 330, H = height, padB = 22, padT = 18;
    const totals = data.map((d) => keys.reduce((s, k) => s + (d[k] || 0), 0));
    const max = Math.max(1, ...totals);
    const n = data.length, gap = 8, bw = (W - gap * (n - 1)) / n;
    return html`<svg className="chart" viewBox=${`0 0 ${W} ${H}`} height=${H} role="img" aria-label="גרף עמודות">
      ${data.map((d, i) => {
        const x0 = W - (i + 1) * bw - i * gap;
        let yAcc = H - padB;
        return html`<g key=${i}>
          ${keys.map((k, j) => { const h = ((d[k] || 0) / max) * (H - padB - padT); yAcc -= h; return h > 0 && html`<rect key=${k} x=${x0} y=${yAcc} width=${bw} height=${h} rx="3" style=${{ fill: colors[j], stroke: 'var(--tx)' }} strokeWidth="1" />`; })}
          ${totals[i] > 0 && html`<text x=${x0 + bw / 2} y=${H - padB - (totals[i] / max) * (H - padB - padT) - 5} textAnchor="middle" style=${{ fill: 'var(--tx)', fontWeight: 600 }}>${fmt.int(totals[i])}</text>`}
          <text x=${x0 + bw / 2} y=${H - 5} textAnchor="middle">${labels[i]}</text>
        </g>`;
      })}
    </svg>`;
  }

  function Toast({ t, onClose, low }) {
    useEffect(() => {
      if (!t) return;
      const id = setTimeout(onClose, t.ms || 5000);
      return () => clearTimeout(id);
    }, [t]);
    if (!t) return null;
    return html`<div className=${'toast' + (low ? ' low' : '')} role="status">
      <span className="grow">${t.msg}</span>
      ${t.undo && html`<button onClick=${() => { t.undo(); onClose(); }}>ביטול</button>`}
    </div>`;
  }

  // Numeric input that keeps the exact typed string (never rounds the user's figure).
  function NumInput({ value, onChange, placeholder, decimals = 2, id, inputRef, ...rest }) {
    return html`<input id=${id} ref=${inputRef} inputMode="decimal" autoComplete="off" placeholder=${placeholder} value=${value}
      onChange=${(e) => {
        let s = e.target.value.replace(/[^\d.,]/g, '').replace(',', '.');
        const parts = s.split('.');
        if (parts.length > 2) s = parts[0] + '.' + parts.slice(1).join('');
        if (decimals === 0) s = s.replace(/\./g, '');
        else if (parts[1] && parts[1].length > decimals) s = parts[0] + '.' + parts[1].slice(0, decimals);
        onChange(s);
      }} ...${rest} />`;
  }

  function Check({ on, onChange, children, className = '' }) {
    return html`<button className=${'check ' + (on ? 'on ' : '') + className} role="checkbox" aria-checked=${on} onClick=${() => onChange(!on)}><i>${on ? '✓' : ''}</i><span>${children}</span></button>`;
  }

  function Spinner() { return html`<span className="spinner" aria-label="טוען"></span>`; }

  window.UI = { html, Icon, N, cons, consStr, unitFor, consUnit, consUnitShort, Top, Sheet, Toggle, Seg, Row, Badge, MiniPlate, PlateXL, Ticks, LineChart, Bars, Toast, NumInput, Check, Spinner, useState, useEffect, useRef };
})();
