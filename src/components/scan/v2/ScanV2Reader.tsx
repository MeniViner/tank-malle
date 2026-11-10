import { useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../../Button';
import { GaugeIcon, PumpIcon, UploadIcon } from '../../icons';
import { LiveCamera } from '../LiveCamera';
import type { ScanContext } from '../../../lib/scan/v2/constraints';
import { GUIDE_BOXES, guideRect, type ScanKind } from '../../../lib/scan/v2/guide';
import type { ScanV2Result } from '../../../lib/scan/v2/pipeline';
import type { ScanV2WorkerRequest } from '../../../lib/scan/v2/v2.worker';

/** The proposal a frame leads to: the selected value(s), for the two-frame agreement check. */
function signature(result: ScanV2Result): string {
  if (result.status !== 'candidates') return '';
  return result.kind === 'odometer' ? result.odometer?.odometer?.text ?? '' : `${result.pump?.total?.text}|${result.pump?.liters?.text}`;
}

/**
 * Scan v2 capture: camera with the viewfinder guide box, or a photo from the
 * device. Pixels stay in memory and in the worker. Two consecutive camera
 * frames must propose the same value before the verification screen opens.
 */
export function ScanV2Reader({ kind, context, autoOpen = false, onResult }: {
  kind: ScanKind; context: ScanContext; autoOpen?: boolean; onResult: (result: ScanV2Result, live: boolean) => void;
}) {
  const [cameraOpen, setCameraOpen] = useState(autoOpen), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const generation = useRef(0), worker = useRef<Worker | null>(null), pending = useRef<((r: ScanV2Result | null) => void) | null>(null), last = useRef('');
  function cancel() { worker.current?.terminate(); worker.current = null; pending.current?.(null); pending.current = null; }
  useLayoutEffect(() => () => { generation.current++; cancel(); }, []);
  function scan(image: ImageData, crop?: ScanV2WorkerRequest['crop']): Promise<ScanV2Result | null> {
    return new Promise(resolve => {
      if (!worker.current) worker.current = new Worker(new URL('../../../lib/scan/v2/v2.worker.ts', import.meta.url), { type: 'module' });
      const timeout = setTimeout(() => cancel(), 5000);
      pending.current = result => { clearTimeout(timeout); resolve(result); };
      worker.current.onmessage = (event: MessageEvent<ScanV2Result>) => { pending.current?.(event.data); pending.current = null; };
      worker.current.onerror = () => cancel();
      const request: ScanV2WorkerRequest = { width: image.width, height: image.height, data: image.data, kind, crop, context };
      worker.current.postMessage(request, [image.data.buffer]);
    });
  }
  async function frame(image: ImageData, isActive: () => boolean) {
    const token = generation.current, result = await scan(image, guideRect(image.width, image.height, kind));
    if (!result || token !== generation.current || !isActive()) { last.current = ''; return false; }
    const sig = signature(result);
    if (sig && sig === last.current) { onResult(result, true); return true; }
    last.current = sig; return false;
  }
  async function load(file?: File) {
    if (!file) return;
    const token = ++generation.current; cancel(); setCameraOpen(false); setMessage(''); last.current = '';
    if (file.size > 20_000_000 || !(/^image\/(jpeg|png|webp|heic|heif|avif)$/.test(file.type) || (!file.type && /\.(jpe?g|png|webp|heic|heif|avif)$/i.test(file.name)))) { setMessage('בחרו תמונה בגודל עד 20 MB.'); return; }
    setBusy(true); const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('image')); image.src = url; });
      if (token !== generation.current) return;
      if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 60_000_000) throw new Error('size');
      const ratio = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight)), canvas = document.createElement('canvas');
      canvas.width = Math.round(image.naturalWidth * ratio); canvas.height = Math.round(image.naturalHeight * ratio);
      const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('canvas');
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      // A chosen photo has no viewfinder: the whole picture is read.
      const result = await scan(ctx.getImageData(0, 0, canvas.width, canvas.height));
      if (token !== generation.current) return;
      if (result?.status === 'candidates') { onResult(result, false); return; }
      setMessage('לא מצאנו ספרות בתמונה. נסו צילום קרוב יותר, או השלימו בטופס.');
    } catch { if (token === generation.current) setMessage('התמונה לא נפתחה. נסו JPEG, או השלימו בטופס.'); }
    finally { URL.revokeObjectURL(url); if (token === generation.current) setBusy(false); }
  }
  const Icon = kind === 'pump' ? PumpIcon : GaugeIcon;
  return <div className="flex flex-col gap-4">
    {cameraOpen ? <>
      <LiveCamera guide={GUIDE_BOXES[kind]} onFrame={frame} onClose={() => { generation.current++; cancel(); setCameraOpen(false); last.current = ''; }} />
      <p className="text-center text-sm text-muted">{kind === 'pump' ? 'מקמו את הסכום, הליטרים והמחיר בתוך המסגרת.' : 'מקמו את מד הקילומטרים המצטבר בתוך המסגרת.'}</p>
    </> : <div className="scan-start"><span className="scan-start-icon"><Icon size={38} /></span>
      <h3>{kind === 'pump' ? 'מצלמים את המשאבה' : 'עוברים למד הקילומטרים'}</h3>
      <p>{kind === 'pump' ? 'אחרי הזיהוי תראו את הספרות ליד הצילום, לבדיקה.' : 'כוונו אל מד המרחק המצטבר כשהרכב עומד.'}</p>
      <Button full onClick={() => { setMessage(''); setCameraOpen(true); }}>פתיחת מצלמה</Button></div>}
    <label className="scan-photo-choice"><UploadIcon size={18} />{busy ? 'קוראים את התמונה…' : 'בחירת תמונה מהמכשיר'}
      <input className="sr-only" type="file" accept="image/*" aria-label={kind === 'pump' ? 'תמונת משאבה' : 'תמונת קילומטראז׳'} onChange={e => { void load(e.target.files?.[0]); e.target.value = ''; }} /></label>
    {message ? <p role="status" className="text-sm leading-relaxed text-muted">{message}</p> : null}
  </div>;
}
