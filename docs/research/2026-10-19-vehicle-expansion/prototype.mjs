import { recognizeLine, validateDraft, validateReading } from './segment-reader.mjs';
import { demoPhoto } from './synthetic-fixtures.mjs';

const $ = id => document.getElementById(id);
const fieldNames = { total: 'סכום', liters: 'ליטרים', odometer: 'קילומטראז׳' };
const fields = Object.fromEntries(Object.keys(fieldNames).map(key => [key, { dirty: false }]));
const photos = { pump: null, odometer: null };
const samples = { pump: false, odometer: false };
const regions = {
  total: { x: .08, y: .18, w: .84, h: .28 },
  liters: { x: .08, y: .56, w: .84, h: .28 },
  odometer: { x: .08, y: .36, w: .84, h: .30 },
};
let step = 'pump', region = 'total', stream = null, generation = 0, pointerStart = null, photoGeneration = 0;
let scanGeneration = 0;
const canvas = $('photo');
const context = canvas.getContext('2d');
const source = document.createElement('canvas');
const sourceContext = source.getContext('2d', { willReadFrequently: true });

function notice(text, error = false) {
  $('notice').textContent = text;
  $('notice').classList.toggle('error', error);
}

function syncRegionControls() {
  for (const property of ['x', 'y', 'w', 'h']) $('crop-' + property).value = Math.round(regions[region][property] * 100);
  document.querySelectorAll('[data-region]').forEach(button => {
    button.hidden = step === 'pump' ? button.dataset.region === 'odometer' : button.dataset.region !== 'odometer';
    button.setAttribute('aria-pressed', String(button.dataset.region === region));
  });
}

function draw() {
  const photo = photos[step];
  canvas.hidden = !photo;
  $('empty-photo').hidden = Boolean(photo);
  $('crop-tools').hidden = !photo;
  $('sample-label').hidden = !samples[step] || !photo;
  if (!photo) return;
  canvas.width = source.width = photo.width;
  canvas.height = source.height = photo.height;
  sourceContext.putImageData(photo, 0, 0);
  context.drawImage(source, 0, 0);
  for (const name of step === 'pump' ? ['total', 'liters'] : ['odometer']) {
    const box = regions[name];
    const x = box.x * canvas.width, y = box.y * canvas.height;
    const w = box.w * canvas.width, h = box.h * canvas.height;
    context.strokeStyle = name === region ? '#048362' : '#bd7a00';
    context.lineWidth = Math.max(2, canvas.width / 250);
    context.strokeRect(x, y, w, h);
    context.font = `bold ${Math.max(13, canvas.width / 45)}px Arial`;
    context.textAlign = 'right';
    const text = fieldNames[name];
    const labelWidth = context.measureText(text).width + 20;
    context.fillStyle = '#123c2e';
    context.fillRect(x + w - labelWidth, Math.max(0, y - canvas.width / 30), labelWidth, canvas.width / 30);
    context.fillStyle = '#fff';
    context.fillText(text, x + w - 10, Math.max(canvas.width / 45, y - 6));
  }
}

function crop(name) {
  const box = regions[name];
  const x = Math.round(box.x * source.width), y = Math.round(box.y * source.height);
  const w = Math.min(source.width - x, Math.round(box.w * source.width));
  const h = Math.min(source.height - y, Math.round(box.h * source.height));
  return sourceContext.getImageData(x, y, w, h);
}

async function readPhoto() {
  if (!photos[step]) return;
  const current = step, photoAtStart = photos[step];
  const scan = ++scanGeneration;
  $('scan').disabled = true;
  notice('בודקים את הספרות במכשיר…');
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  try {
    if (scan !== scanGeneration || step !== current || photos[step] !== photoAtStart) return;
    const names = step === 'pump' ? ['total', 'liters'] : ['odometer'];
    const accepted = [], retained = [], rejected = [];
    for (const name of names) {
      if (fields[name].dirty) { retained.push(fieldNames[name]); continue; }
      const result = recognizeLine(crop(name), { kind: name, mode: $('color-mode').value });
      if (result.status === 'candidate') {
        $(name).value = result.text;
        $(name + '-hint').textContent = 'קריאה מהתמונה — יש לבדוק את כל הספרות.';
        accepted.push(fieldNames[name]);
      } else {
        // A new failed scan must not leave an old candidate looking current.
        $(name).value = '';
        $(name + '-hint').textContent = 'לא התקבלה קריאה ברורה. אפשר לצמצם את המסגרת או להקליד.';
        rejected.push(fieldNames[name]);
      }
    }
    notice([
      accepted.length ? `נמצאה קריאה לבדיקה: ${accepted.join(' ו')}.` : '',
      rejected.length ? `צריך לבדוק ידנית: ${rejected.join(' ו')}.` : '',
      retained.length ? `הערכים שהקלדת נשמרו: ${retained.join(' ו')}.` : '',
    ].filter(Boolean).join(' '), rejected.length > 0);
  } finally {
    if (scan === scanGeneration) $('scan').disabled = false;
  }
}

function stopCamera() {
  generation++;
  scanGeneration++;
  $('scan').disabled = false;
  if (stream) stream.getTracks().forEach(track => track.stop());
  stream = null;
  $('video').srcObject = null;
  $('video-stage').hidden = true;
  $('live-actions').hidden = true;
  document.querySelector('.camera-actions').hidden = false;
  $('camera').disabled = false;
  draw();
}

async function startCamera() {
  stopCamera();
  if (!navigator.mediaDevices?.getUserMedia) {
    notice('המצלמה החיה אינה זמינה כאן. אפשר לצלם דרך מצלמת המכשיר או לבחור תמונה.', true);
    $('native-fallback').hidden = false;
    return;
  }
  const request = ++generation;
  $('camera').disabled = true;
  $('live-actions').hidden = false;
  $('capture').disabled = true;
  notice('ממתינים להרשאת מצלמה… אפשר לבטל בכל רגע.');
  try {
    const nextStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
    if (request !== generation) { nextStream.getTracks().forEach(track => track.stop()); return; }
    stream = nextStream;
    $('video').srcObject = stream;
    await $('video').play();
    if (request !== generation) return;
    $('video-stage').hidden = false;
    $('video-stage').classList.toggle('odo', step === 'odometer');
    $('photo').hidden = $('empty-photo').hidden = $('sample-label').hidden = true;
    document.querySelector('.camera-actions').hidden = true;
    $('capture').disabled = false;
    notice('ממקמים את הספרות במסגרות ולוחצים על צילום.');
  } catch {
    if (request !== generation) return;
    stopCamera();
    $('native-fallback').hidden = false;
    notice('לא הצלחנו לפתוח את המצלמה. אפשר לצלם דרך מצלמת המכשיר, לבחור תמונה או להזין ידנית.', true);
  }
}

function importPixels(image, synthetic = false) {
  photos[step] = image;
  samples[step] = synthetic;
  for (const name of step === 'pump' ? ['total', 'liters'] : ['odometer']) {
    if (!fields[name].dirty) $(name).value = '';
  }
  if (step === 'odometer') $('confirm-odo').checked = false;
  draw();
  void readPhoto();
}

async function importFile(file) {
  if (!file) return;
  stopCamera();
  if (file.size > 20_000_000) { notice('התמונה גדולה מ־20 MB. יש לבחור תמונה קטנה יותר.', true); return; }
  if (!/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name) && !/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type)) {
    notice('יש לבחור צילום בפורמט JPG, PNG, WebP או HEIC הנתמך במכשיר.', true); return;
  }
  const request = ++photoGeneration, requestedStep = step;
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (request !== photoGeneration || requestedStep !== step) return;
    if (image.naturalWidth * image.naturalHeight > 60_000_000) throw new Error('image too large');
    const ratio = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
    const buffer = document.createElement('canvas');
    buffer.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    buffer.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const ctx = buffer.getContext('2d');
    ctx.drawImage(image, 0, 0, buffer.width, buffer.height);
    importPixels(ctx.getImageData(0, 0, buffer.width, buffer.height));
  } catch {
    if (request === photoGeneration && requestedStep === step) notice('התמונה לא נפתחה. אפשר לנסות JPG / PNG או להזין ידנית.', true);
  } finally { URL.revokeObjectURL(url); }
}

function changeStep(next) {
  stopCamera();
  photoGeneration++;
  step = next;
  region = step === 'pump' ? 'total' : 'odometer';
  const pump = step === 'pump';
  $('capture-view').hidden = false;
  $('review-view').hidden = true;
  $('step-count').textContent = pump ? 'צילום 1 מתוך 2' : 'צילום 2 מתוך 2';
  $('step-title').textContent = pump ? 'מתחילים במשאבה' : 'עכשיו, מד המרחק';
  $('step-help').textContent = pump ? 'מכניסים את הסכום והליטרים למסגרות. מצלמים כשהתדלוק הסתיים ובהתאם להנחיות התחנה.' : 'מצלמים את הקילומטראז׳ המצטבר כשהרכב חונה. יש לכלול את כל הספרות.';
  $('photo-prompt').textContent = pump ? 'הסכום למעלה, הליטרים למטה' : 'מד המרחק המצטבר בק״מ';
  $('pump-fields').hidden = !pump;
  $('odo-fields').hidden = pump;
  $('back').hidden = pump;
  $('continue').textContent = pump ? 'בדקתי, לצילום מד המרחק ←' : 'בדקתי, להצגת הנתונים ←';
  $('progress-odo').classList.toggle('active', !pump);
  $('color-mode').value = 'auto';
  $('native-fallback').hidden = true;
  syncRegionControls(); draw();
  notice(photos[step] ? 'אפשר לבדוק את הקריאות או לסרוק שוב.' : 'אפשר להתחיל בצילום או להזין ידנית.');
  $('step-title').focus({ preventScroll: true });
  $('capture-view').scrollIntoView({ behavior: 'instant', block: 'start' });
}

Object.keys(fields).forEach(name => $(name).addEventListener('input', () => {
  fields[name].dirty = $(name).value.trim() !== '';
  $(name + '-hint').textContent = fields[name].dirty ? 'הערך שהקלדת יישמר גם בסריקה נוספת.' : 'השדה ריק; אפשר לסרוק מחדש.';
  if (name === 'odometer') $('confirm-odo').checked = false;
}));
$('camera').addEventListener('click', () => void startCamera());
$('stop-camera').addEventListener('click', () => { stopCamera(); notice('הצילום בוטל. אפשר להמשיך ידנית או לנסות שוב.'); });
$('choose').addEventListener('click', () => $('file').click());
$('native-fallback').addEventListener('click', () => $('native-camera').click());
for (const id of ['file', 'native-camera']) $(id).addEventListener('change', event => {
  const file = event.target.files?.[0]; event.target.value = ''; void importFile(file);
});
$('capture').addEventListener('click', () => {
  const video = $('video');
  if (!video.videoWidth || !video.videoHeight) return;
  const buffer = document.createElement('canvas');
  const ratio = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
  buffer.width = Math.round(video.videoWidth * ratio); buffer.height = Math.round(video.videoHeight * ratio);
  const ctx = buffer.getContext('2d');
  ctx.drawImage(video, 0, 0, buffer.width, buffer.height);
  stopCamera();
  importPixels(ctx.getImageData(0, 0, buffer.width, buffer.height));
});
$('sample').addEventListener('click', () => {
  stopCamera(); photoGeneration++;
  const sample = demoPhoto(step);
  importPixels(new ImageData(sample.data, sample.width, sample.height), true);
});
$('manual').addEventListener('click', () => {
  stopCamera(); photoGeneration++;
  notice('אפשר להזין את כל הנתונים ידנית ולהמשיך באותו התהליך.');
  $(step === 'pump' ? 'total' : 'odometer').focus();
});
$('scan').addEventListener('click', () => void readPhoto());
$('color-mode').addEventListener('change', () => void readPhoto());
document.querySelectorAll('[data-region]').forEach(button => button.addEventListener('click', () => {
  region = button.dataset.region; syncRegionControls(); draw();
}));
for (const property of ['x', 'y', 'w', 'h']) $('crop-' + property).addEventListener('input', event => {
  const box = regions[region];
  box[property] = Number(event.target.value) / 100;
  box.w = Math.min(box.w, 1 - box.x); box.h = Math.min(box.h, 1 - box.y);
  syncRegionControls(); draw();
});
const point = event => {
  const rect = canvas.getBoundingClientRect();
  return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
};
canvas.addEventListener('pointerdown', event => { pointerStart = point(event); canvas.setPointerCapture(event.pointerId); });
canvas.addEventListener('pointermove', event => {
  if (!pointerStart) return;
  const current = point(event);
  const box = { x: Math.min(current.x, pointerStart.x), y: Math.min(current.y, pointerStart.y), w: Math.abs(current.x - pointerStart.x), h: Math.abs(current.y - pointerStart.y) };
  if (box.w > .03 && box.h > .03) { regions[region] = box; syncRegionControls(); draw(); }
});
canvas.addEventListener('pointerup', () => { pointerStart = null; void readPhoto(); });
canvas.addEventListener('pointercancel', () => { pointerStart = null; });
$('back').addEventListener('click', () => changeStep('pump'));
$('continue').addEventListener('click', () => {
  if (step === 'pump') {
    const invalid = ['total', 'liters'].filter(key => !validateReading($(key).value.trim().replace(',', '.'), key));
    if (invalid.length) { notice('יש להשלים ' + invalid.map(key => fieldNames[key]).join(' ו') + ', כולל הנקודה העשרונית.', true); $(invalid[0]).focus(); return; }
    changeStep('odometer'); return;
  }
  const draft = { total: $('total').value.trim().replace(',', '.'), liters: $('liters').value.trim().replace(',', '.'), odometer: $('odometer').value.trim(), confirmedOdometer: $('confirm-odo').checked };
  const result = validateDraft(draft);
  if (result.errors.length) { notice(result.errors.join(' '), true); return; }
  stopCamera();
  $('capture-view').hidden = true; $('review-view').hidden = false;
  $('step-count').textContent = 'בדיקת הנתונים';
  $('review-total').textContent = Number(draft.total).toFixed(2) + ' ₪';
  $('review-liters').textContent = draft.liters + ' L';
  $('review-price').textContent = result.pricePerLiter.toFixed(3) + ' ₪/L';
  $('review-odo').textContent = Number(draft.odometer).toLocaleString('he-IL') + ' km';
  $('done').hidden = true;
  $('review-view').querySelector('h2').focus();
  $('review-view').scrollIntoView({ behavior: 'instant', block: 'start' });
});
$('edit').addEventListener('click', () => changeStep('pump'));
$('finish').addEventListener('click', () => { $('done').hidden = false; });
document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); });
window.addEventListener('pagehide', () => { stopCamera(); photoGeneration++; });
syncRegionControls();
