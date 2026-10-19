import { LiveCamera } from './LiveCamera';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../Button';
import { recognizeLine, type ReadingKind, type ReadingMode } from '../../lib/scan/sevenSegment';

type Box = { x: number; y: number; w: number; h: number };
const DEFAULTS: Record<ReadingKind, Box> = {
  total: { x: 8, y: 18, w: 84, h: 28 }, liters: { x: 8, y: 56, w: 84, h: 28 },
  odometer: { x: 8, y: 36, w: 84, h: 30 },
};
const LABELS = { total: 'סכום', liters: 'ליטרים', odometer: 'קילומטראז׳' };

/** All pixels stay in this component's memory; no URL or photo enters a draft or upload. */
export function PhotoReader({ kind, onRead }: { kind: 'pump' | 'odometer'; onRead: (field: ReadingKind, text: string | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const source = useRef<HTMLCanvasElement | null>(null);
  const generation = useRef(0);
  const [cameraOpen,setCameraOpen] = useState(false);
  const [hasImage, setHasImage] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [field, setField] = useState<ReadingKind>(kind === 'pump' ? 'total' : 'odometer');
  const [boxes, setBoxes] = useState(DEFAULTS);
  const [mode, setMode] = useState<ReadingMode>('auto');
  const drag = useRef<{ x: number; y: number } | null>(null);
  const box = boxes[field];
  useEffect(() => () => { generation.current++; source.current = null; }, []);

  useEffect(() => {
    const image = source.current, target = canvas.current;
    if (!image || !target) return;
    target.width = image.width; target.height = image.height;
    const ctx = target.getContext('2d'); if (!ctx) return;
    ctx.drawImage(image, 0, 0);
    ctx.strokeStyle = '#00e6ad'; ctx.lineWidth = Math.max(3, image.width / 250);
    ctx.strokeRect(box.x * image.width / 100, box.y * image.height / 100, box.w * image.width / 100, box.h * image.height / 100);
  }, [box, hasImage, busy, correcting]);

  function scan(image: HTMLCanvasElement, fieldName: ReadingKind, region: Box) {
    const ctx = image.getContext('2d', { willReadFrequently: true }); if (!ctx) return false;
    const x = Math.floor(region.x * image.width / 100), y = Math.floor(region.y * image.height / 100);
    const width = Math.max(2, Math.min(image.width - x, Math.floor(region.w * image.width / 100)));
    const height = Math.max(2, Math.min(image.height - y, Math.floor(region.h * image.height / 100)));
    const result = recognizeLine(ctx.getImageData(x, y, width, height), { kind: fieldName, mode });
    onRead(fieldName, result.status === 'candidate' ? result.text : null);
    return result.status === 'candidate';
  }
  async function load(file?: File) {
    if (!file) return;
    setCameraOpen(false);
    const token = ++generation.current;
    source.current = null; setHasImage(false); setBusy(false); setCorrecting(false);
    (kind === 'pump' ? ['total', 'liters'] as const : ['odometer'] as const).forEach(f => onRead(f, null));
    if (file.size > 20_000_000 || !( /^image\/(jpeg|png|webp|heic|heif|avif)$/.test(file.type) || (!file.type && /\.(jpe?g|png|webp|heic|heif|avif)$/i.test(file.name)) )) { setMessage('בחרו תמונה בגודל עד 20 MB.'); return; }
    setBusy(true); setMessage('פותחים את התמונה…');
    const url = URL.createObjectURL(file);
    try {
      const image = new Image(); image.src = url; await image.decode();
      if (token !== generation.current) return;
      if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 60_000_000) throw new Error('size');
      const size = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
      const next = document.createElement('canvas'); next.width = Math.round(image.naturalWidth * size); next.height = Math.round(image.naturalHeight * size);
      const context = next.getContext('2d'); if (!context) throw new Error('canvas');
      context.drawImage(image, 0, 0, next.width, next.height); source.current = next;
      setBoxes(DEFAULTS); setHasImage(true);
      const fields: ReadingKind[] = kind === 'pump' ? ['total', 'liters'] : ['odometer'];
      const results = fields.map(f => scan(next, f, DEFAULTS[f]));
      setCorrecting(!results.every(Boolean));
      setMessage(results.every(Boolean) ? 'נמצאו ספרות — בדקו שהמספרים נכונים.' : 'אפשר למקד את המסגרת סביב שורת הספרות, או להקליד ידנית.');
    } catch { if (token === generation.current) setMessage('לא הצלחנו לפתוח את התמונה. נסו צילום חדש או JPEG, או הזינו ידנית.'); }
    finally { URL.revokeObjectURL(url); if (token === generation.current) setBusy(false); }
  }
  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(99, (event.clientX - bounds.left) / bounds.width * 100)),
      y: Math.max(0, Math.min(99, (event.clientY - bounds.top) / bounds.height * 100)) };
  }
  return <div className="flex flex-col gap-3">
    {cameraOpen ? <LiveCamera onImage={file=>void load(file)} onClose={()=>setCameraOpen(false)} /> : <Button variant="secondary" onClick={()=>setCameraOpen(true)}>פתיחת מצלמה</Button>}
    <label className="flex min-h-14 cursor-pointer items-center justify-center rounded-control border border-dashed border-accent bg-accent-soft p-3 font-bold text-accent focus-within:ring-2 focus-within:ring-accent">
      {hasImage ? 'בחירת צילום חדש' : kind === 'pump' ? 'בחירת צילום של צג המשאבה' : 'בחירת צילום של מד הקילומטרים'}
      <input className="sr-only" type="file" accept="image/*" capture="environment" onClick={()=>setCameraOpen(false)} aria-label={kind === 'pump' ? 'תמונת משאבה' : 'תמונת קילומטראז׳'} onChange={e => { void load(e.target.files?.[0]); e.target.value = ''; }} />
    </label>
    <p role="status" className="text-sm text-muted">{message}</p>
    {hasImage && !correcting ? <Button variant="ghost" onClick={()=>setCorrecting(true)}>תיקון מסגרת או צבע</Button> : null}
    {hasImage && correcting ? <>
      <div className="flex gap-2">{(kind === 'pump' ? ['total', 'liters'] as const : ['odometer'] as const).map(f => <Button key={f} size="sm" variant={field === f ? 'primary' : 'secondary'} onClick={() => setField(f)} aria-pressed={field === f}>מסגרת {LABELS[f]}</Button>)}</div>
      <canvas ref={canvas} aria-label="גררו מסגרת סביב שורת ספרות אחת" className="w-full touch-none rounded-xl bg-black" onPointerDown={e => { drag.current = point(e); e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={e => {
        if (!drag.current) return; onRead(field,null); const end = point(e), start = drag.current;
        setBoxes(prev => ({ ...prev, [field]: { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), w: Math.max(1, Math.abs(end.x - start.x)), h: Math.max(1, Math.abs(end.y - start.y)) } }));
      }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} />
      <details className="text-sm text-muted"><summary className="min-h-11 cursor-pointer py-3">כיוון מסגרת וצבע הספרות</summary>
        {(['x','y','w','h'] as const).map((key,i) => <label key={key} className="flex min-h-11 items-center gap-3">{['מיקום אופקי','מיקום אנכי','רוחב','גובה'][i]}<input type="range" min={key === 'w' || key === 'h' ? 1 : 0} max={key === 'w' ? 100-box.x : key === 'h' ? 100-box.y : 99} value={box[key]} onChange={e => { onRead(field,null); setBoxes(prev => { const next = { ...prev[field], [key]: Number(e.target.value) }; next.w = Math.min(next.w,100-next.x); next.h = Math.min(next.h,100-next.y); return { ...prev, [field]: next }; }); }} /></label>)}
        <label className="flex min-h-11 items-center gap-3">צבע הספרות<select aria-label="צבע הספרות" value={mode} onChange={e => { onRead(field,null); setMode(e.target.value as ReadingMode); }} className="min-h-11 rounded-lg bg-surface-2 p-2"><option value="auto">אוטומטי</option><option value="dark">כהה</option><option value="light">בהיר</option><option value="blue">כחול</option></select></label>
      </details>
      <Button size="sm" variant="secondary" onClick={() => { if (source.current) setMessage(scan(source.current, field, box) ? 'נמצאה קריאה — בדקו אותה לפני ההמשך.' : 'הספרות לא ברורות. נסו מסגרת צמודה יותר או הקלדה ידנית.'); }}>קריאת {LABELS[field]} במסגרת</Button>
    </> : null}
    {busy ? <p className="text-sm text-muted">טוענים צילום…</p> : null}
  </div>;
}
