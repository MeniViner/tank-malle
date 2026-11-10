import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button } from '../../Button';
import { PricePerLiter } from '../../Fmt';
import { CheckIcon, WarningIcon } from '../../icons';
import { leastConfidentDigit, type Check, type CheckName, type FieldCandidate } from '../../../lib/scan/v2/constraints';
import { logCorrections, thumbnail, type CorrectionEntry, type CorrectionField } from '../../../lib/scan/v2/correctionLog';
import type { ScanV2Result } from '../../../lib/scan/v2/pipeline';

const LABELS: Record<CorrectionField, string> = { total: 'סכום לתשלום', liters: 'ליטרים', price: 'מחיר לליטר', odometer: 'קילומטראז׳' };
const CHECK_TEXT: Record<CheckName, string> = {
  'total≈liters×price': 'הסכום תואם ליטרים × מחיר',
  'price-range': 'מחיר לליטר בין 5 ל-12 ₪',
  'liters≤tank': 'הליטרים לא עולים על נפח המיכל',
  'odometer>last': 'גבוה מהקריאה הקודמת',
  'odometer<last+3000': 'עד 3,000 ק״מ מעל הקריאה הקודמת',
};
const PATTERN: Record<CorrectionField, RegExp> = { total: /^\d{1,5}(\.\d{1,2})?$/, liters: /^\d{1,3}(\.\d{1,3})?$/, price: /^\d{1,2}(\.\d{1,3})?$/, odometer: /^\d{1,7}$/ };

type FieldState = { field: CorrectionField; proposal: FieldCandidate | null; options: FieldCandidate[] };

function CropCanvas({ crop }: { crop: NonNullable<ScanV2Result['crop']> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current, context = element?.getContext('2d');
    if (!element || !context) return;
    element.width = crop.width; element.height = crop.height;
    context.putImageData(new ImageData(new Uint8ClampedArray(crop.data), crop.width, crop.height), 0, 0);
  }, [crop]);
  return <canvas ref={canvas} className="scan-verify-crop" role="img" aria-label="האזור שצולם בתוך המסגרת" />;
}

/** The recognised characters, the least certain one marked. */
function Digits({ candidate, edited }: { candidate: FieldCandidate | null; edited: boolean }) {
  if (!candidate?.digits?.length || edited) return null;
  const weakest = leastConfidentDigit(candidate);
  return <span className="scan-verify-digits" dir="ltr" aria-hidden="true">
    {candidate.digits.map((d, i) => <span key={i} className={i === weakest ? 'is-weakest' : d.char === '.' ? 'is-dot' : undefined}>{d.char}</span>)}
  </span>;
}

/**
 * Verification screen: the guide-box crop beside the recognised values. The
 * least confident character is highlighted; each value is editable and the
 * other top-3 candidates are one tap away. Confirming logs proposal vs final
 * value on this device only.
 */
export function ScanVerify({ result, protectedFields, onConfirm, onRetake }: {
  result: ScanV2Result;
  protectedFields: readonly CorrectionField[];
  onConfirm: (values: Partial<Record<'total' | 'liters' | 'odometer', string>>) => void;
  onRetake: () => void;
}) {
  const id = useId();
  const fields: FieldState[] = useMemo(() => result.kind === 'odometer'
    ? [{ field: 'odometer', proposal: result.odometer?.odometer ?? null, options: result.fields.odometer ?? [] }]
    : (['total', 'liters', 'price'] as const).filter(f => f !== 'price' || result.fields.price?.length).map(field => ({
      field, proposal: (field === 'total' ? result.pump?.total : field === 'liters' ? result.pump?.liters : result.pump?.price) ?? null, options: result.fields[field] ?? [],
    })), [result]);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map(f => [f.field, f.proposal?.text ?? ''])));
  const checks: Check[] = (result.kind === 'odometer' ? result.odometer?.checks : result.pump?.checks) ?? [];
  const consistent = result.kind === 'odometer' ? result.odometer?.consistent : result.pump?.consistent;
  const invalid = fields.filter(f => f.field !== 'price' && !protectedFields.includes(f.field) && !PATTERN[f.field].test(values[f.field] ?? ''));
  const implied = result.kind === 'pump' && Number(values.liters) > 0 && Number(values.total) > 0 ? Number(values.total) / Number(values.liters) : null;

  function confirm() {
    if (invalid.length) return;
    const now = new Date().toISOString(), thumb = result.crop ? thumbnail(result.crop) : undefined;
    const entries: CorrectionEntry[] = fields.map(f => ({
      at: now, kind: result.kind, field: f.field, recognised: f.proposal?.text ?? '', confirmed: values[f.field] ?? '',
      changed: (f.proposal?.text ?? '') !== (values[f.field] ?? ''), confidence: f.proposal?.confidence ?? null,
      top3: f.options.map(o => o.text), digitConfidences: f.proposal?.digits?.map(d => Math.round(d.confidence * 1000) / 1000) ?? [],
      failedChecks: checks.filter(c => c.status === 'failed').map(c => c.name), thumbnail: thumb,
    }));
    // Local and best-effort: a blocked IndexedDB must never block the fill-up.
    void logCorrections(entries).catch(() => undefined);
    const out: Partial<Record<'total' | 'liters' | 'odometer', string>> = {};
    for (const f of fields) if (f.field !== 'price' && !protectedFields.includes(f.field)) out[f.field] = values[f.field];
    onConfirm(out);
  }

  return <div className="scan-verify">
    <div className="scan-verify-grid">
      {result.crop ? <CropCanvas crop={result.crop} /> : null}
      <div className="scan-verify-fields">
        {fields.map(f => {
          const inputId = `${id}-${f.field}`, locked = protectedFields.includes(f.field);
          const edited = values[f.field] !== (f.proposal?.text ?? '');
          return <div key={f.field} className="scan-verify-field">
            <label htmlFor={inputId}>{LABELS[f.field]}{f.field === 'price' ? <span className="text-muted"> · לבדיקה בלבד</span> : null}</label>
            <Digits candidate={f.proposal} edited={edited} />
            <input id={inputId} className="scan-verify-input" dir="ltr" inputMode={f.field === 'odometer' ? 'numeric' : 'decimal'} autoComplete="off"
              value={values[f.field] ?? ''} readOnly={locked} aria-invalid={invalid.includes(f) || undefined}
              aria-describedby={`${inputId}-hint`}
              onChange={e => setValues(v => ({ ...v, [f.field]: e.target.value.replace(',', '.').replace(/[^\d.]/g, '') }))} />
            <p id={`${inputId}-hint`} className="scan-verify-hint">
              {locked ? 'כבר מילאתם את השדה בטופס; הוא לא יוחלף.'
                : invalid.includes(f) ? 'בדקו את המספר.'
                  : f.proposal?.digits?.length && !edited ? 'הספרה המסומנת היא הפחות ודאית.' : ' '}
            </p>
            {f.options.length > 1 && !locked ? <div className="scan-verify-options" role="group" aria-label={`אפשרויות נוספות ל${LABELS[f.field]}`}>
              {f.options.map(o => <button key={o.text} type="button" dir="ltr" aria-pressed={values[f.field] === o.text}
                onClick={() => setValues(v => ({ ...v, [f.field]: o.text }))}>{o.text}</button>)}
            </div> : null}
          </div>;
        })}
      </div>
    </div>
    {implied != null ? <p className="scan-verify-hint">מחיר לליטר לפי הסכום והליטרים: <PricePerLiter value={implied} /></p> : null}
    {checks.length ? <ul className="scan-verify-checks" aria-label="בדיקות התאמה">
      {checks.filter(c => c.status !== 'unknown').map(c => <li key={c.name} className={c.status === 'ok' ? 'is-ok' : 'is-failed'}>
        {c.status === 'ok' ? <CheckIcon size={16} /> : <WarningIcon size={16} />}<span>{CHECK_TEXT[c.name]}</span>
        <span className="sr-only">{c.status === 'ok' ? 'עבר' : 'לא עבר'}</span></li>)}
    </ul> : null}
    {consistent === false ? <p role="status" className="scan-verify-warning">חלק מהבדיקות לא עברו. בדקו את הספרות מול הצילום.</p> : null}
    <div className="scan-verify-actions">
      <Button full onClick={confirm} disabled={invalid.length > 0}>אישור והעברה לטופס</Button>
      <Button full variant="ghost" onClick={onRetake}>צילום מחדש</Button>
    </div>
    <p className="text-center text-xs leading-relaxed text-muted">האישור והתיקונים נשמרים במכשיר בלבד, עם תמונה קטנה בשחור-לבן של האזור שבמסגרת, כדי לשפר את הזיהוי. הם לא נשלחים לשום מקום.</p>
  </div>;
}
