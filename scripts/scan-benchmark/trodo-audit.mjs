// Audit TRODO v2 and freeze a grouped split, BEFORE any tuning on it.
//
//   node scripts/scan-benchmark/trodo-audit.mjs <extracted trodo-v01 dir> <out dir>
//
// Writes trodo-audit.json (counts, label checks, exclusions) and
// trodo-sessions.json (one still session per image, with group, family, split
// and sha256). Images are never copied into Git; only hashes and labels are.
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

const [root, out] = [resolve(process.argv[2] ?? '.scan-corpus/trodo-v2/trodo-v01'), resolve(process.argv[3] ?? 'benchmarks/scan')];
const truth = JSON.parse(await readFile(join(root, 'ground truth', 'groundtruth.json'), 'utf8')).odometers;
const annotationDir = join(root, 'pascal voc 1.1', 'Annotations');
const tag = (xml, name) => [...xml.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'g'))].map(m => m[1]);
function parseVoc(xml) {
  const [width] = tag(xml, 'width').map(Number), [height] = tag(xml, 'height').map(Number);
  const objects = tag(xml, 'object').map(o => ({ name: tag(o, 'name')[0], box: Object.fromEntries(['xmin', 'ymin', 'xmax', 'ymax'].map(k => [k, Number(tag(o, k)[0])])) }));
  return { width, height, objects };
}
const inside = (b, r) => { const cx = (b.xmin + b.xmax) / 2, cy = (b.ymin + b.ymax) / 2; return cx >= r.xmin && cx <= r.xmax && cy >= r.ymin && cy <= r.ymax; };
/** 64-bit difference hash of a grayscale 9x8 thumbnail. */
async function dhash(input) {
  const { data } = await sharp(input, { failOn: 'none' }).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  let bits = 0n; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits = (bits << 1n) | (data[y * 9 + x] > data[y * 9 + x + 1] ? 1n : 0n);
  return bits;
}
const hamming = (a, b) => { let x = a ^ b, n = 0; while (x) { n += Number(x & 1n); x >>= 1n; } return n; };
/** Interpretable display family from pixels inside the annotated boxes. */
async function family(file, odometer, digits, type) {
  const box = { left: Math.max(0, Math.floor(odometer.xmin)), top: Math.max(0, Math.floor(odometer.ymin)) };
  const { data, info } = await sharp(file, { failOn: 'none' }).rotate().extract({ ...box, width: Math.max(2, Math.ceil(odometer.xmax - odometer.xmin)), height: Math.max(2, Math.ceil(odometer.ymax - odometer.ymin)) }).removeAlpha().raw().toBuffer({ resolveWithObject: true }).catch(() => ({ data: null, info: null }));
  if (!data) return { family: `${type}-unknown`, polarity: 'unknown', hue: 'unknown' };
  let ink = [0, 0, 0, 0], ground = [0, 0, 0, 0];
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * 3, gx = x + box.left, gy = y + box.top;
    const target = digits.some(d => gx >= d.xmin && gx <= d.xmax && gy >= d.ymin + (d.ymax - d.ymin) * .2 && gy <= d.ymax - (d.ymax - d.ymin) * .2) ? ink : ground;
    target[0] += data[i]; target[1] += data[i + 1]; target[2] += data[i + 2]; target[3]++;
  }
  const mean = c => c[3] ? [c[0] / c[3], c[1] / c[3], c[2] / c[3]] : [0, 0, 0], lum = ([r, g, b]) => .299 * r + .587 * g + .114 * b;
  const [inkMean, groundMean] = [mean(ink), mean(ground)];
  const polarity = lum(inkMean) > lum(groundMean) ? 'light-on-dark' : 'dark-on-light';
  const bright = polarity === 'light-on-dark' ? inkMean : groundMean, [r, g, b] = bright, max = Math.max(r, g, b), min = Math.min(r, g, b);
  const hue = max - min < 28 ? 'neutral' : r === max ? (g > b + 20 ? 'amber' : 'red') : g === max ? 'green' : 'blue';
  return { family: `${type}-${polarity}-${hue}`, polarity, hue };
}

const files = new Set(await readdir(join(root, 'images')));
const rows = [], exclusions = [];
for (const entry of truth) {
  const file = join(root, 'images', entry.image);
  if (!files.has(entry.image)) { exclusions.push({ image: entry.image, reason: 'image-missing' }); continue; }
  const bytes = await readFile(file), sha256 = createHash('sha256').update(bytes).digest('hex');
  const voc = parseVoc(await readFile(join(annotationDir, entry.image.replace(/\.jpe?g$/i, '.xml')), 'utf8').catch(() => ''));
  const meta = await sharp(bytes, { failOn: 'none' }).metadata();
  // Browsers show a truncated JPEG partially; it stays, flagged.
  const truncated = await sharp(bytes, { failOn: 'truncated' }).raw().toBuffer().then(() => false, () => true);
  const odometers = voc.objects.filter(o => o.name === 'odometer');
  const odometer = odometers[0]?.box ?? null;
  const symbols = voc.objects.filter(o => o.name !== 'odometer' && (!odometer || inside(o.box, odometer))).sort((a, b) => a.box.xmin - b.box.xmin);
  const digits = symbols.filter(o => /^\d$/.test(o.name));
  // The odometer box also holds trip meters and clocks, and photos are tilted
  // or taken sideways. Rows are chains of similar-sized neighbouring digits,
  // read along the row's own axis in both directions; leading zeros of a drum
  // register are ignored.
  // Upright digits are taller than wide; a sideways photo swaps the axes.
  const aspects = digits.map(d => (d.box.xmax - d.box.xmin) / Math.max(1e-6, d.box.ymax - d.box.ymin)).sort((a, b) => a - b);
  const sideways = aspects.length > 0 && aspects[aspects.length >> 1] > 1;
  const uv = d => sideways ? { u: (d.box.ymin + d.box.ymax) / 2, v: (d.box.xmin + d.box.xmax) / 2, along: d.box.ymax - d.box.ymin, across: d.box.xmax - d.box.xmin } : { u: (d.box.xmin + d.box.xmax) / 2, v: (d.box.ymin + d.box.ymax) / 2, along: d.box.xmax - d.box.xmin, across: d.box.ymax - d.box.ymin };
  const rowParent = digits.map((_, i) => i), rowFind = i => rowParent[i] === i ? i : (rowParent[i] = rowFind(rowParent[i]));
  digits.forEach((a, i) => digits.forEach((b, j) => {
    if (j <= i) return; const p = uv(a), q = uv(b), ratio = p.across / q.across;
    // Side by side along the reading axis; chaining tolerates a tilted row.
    if (ratio > .6 && ratio < 1.6 && Math.abs(p.v - q.v) < .6 * Math.max(p.across, q.across) && Math.abs(p.u - q.u) < 2.4 * Math.max(p.along, q.along)) rowParent[rowFind(i)] = rowFind(j);
  }));
  const rowGroups = [...digits.reduce((m, d, i) => m.set(rowFind(i), [...(m.get(rowFind(i)) ?? []), d]), new Map()).values()];
  const rowTexts = rowGroups.flatMap(row => {
    const ordered = [...row].sort((a, b) => uv(a).u - uv(b).u).map(d => d.name).join('');
    return [ordered, [...ordered].reverse().join('')];
  });
  const strip = t => t.replace(/^0+(?=\d)/, '');
  const fromBoxes = rowTexts.find(t => strip(t) === strip(entry.mileage.replace('.', ''))) ?? rowTexts.join('|');
  const issues = [];
  if (!/^\d{1,7}$/.test(entry.mileage)) issues.push('mileage-not-integer');
  if (odometers.length !== 1) issues.push(`odometer-boxes:${odometers.length}`);
  if (strip(fromBoxes) !== strip(entry.mileage.replace('.', ''))) issues.push('digit-boxes-disagree');
  if (symbols.some(o => o.name === 'X')) issues.push('non-mileage-characters');
  if (symbols.some(o => o.name === ',')) issues.push('separator');
  if (meta.orientation && meta.orientation !== 1) issues.push(`exif-orientation:${meta.orientation}`);
  if (truncated) issues.push('truncated-jpeg');
  rows.push({ image: entry.image, sha256, bytes: bytes.length, width: meta.width, height: meta.height, type: entry.odometer_type, mileage: entry.mileage, odometer, digitBoxes: digits.map(o => o.box), fromBoxes, issues,
    hash: await dhash(bytes), cropHash: odometer ? await dhash(await sharp(bytes, { failOn: 'none' }).rotate().extract({ left: Math.max(0, Math.floor(odometer.xmin)), top: Math.max(0, Math.floor(odometer.ymin)), width: Math.max(9, Math.ceil(odometer.xmax - odometer.xmin)), height: Math.max(8, Math.ceil(odometer.ymax - odometer.ymin)) }).toBuffer().catch(() => bytes)) : 0n,
    ...(odometer ? await family(file, odometer, digits.map(o => o.box), entry.odometer_type) : { family: `${entry.odometer_type}-unknown`, polarity: 'unknown', hue: 'unknown' }),
    capturedAt: /PHOTO-(\d{4})-(\d\d)-(\d\d)-(\d\d)-(\d\d)-(\d\d)/.exec(entry.image)?.slice(1).join('') ?? null });
}

// Groups approximate "one physical vehicle". TRODO publishes no vehicle IDs,
// so links are deliberately generous: an over-merged group costs test size,
// an under-merged one leaks a vehicle across splits.
const parent = rows.map((_, i) => i), find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
const link = (i, j, why) => { const a = find(i), b = find(j); if (a !== b) { parent[a] = b; links[why] = (links[why] ?? 0) + 1; } };
const links = {};
for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
  const a = rows[i], b = rows[j];
  if (a.sha256 === b.sha256) link(i, j, 'identical-file');
  else if (hamming(a.hash, b.hash) <= 6) link(i, j, 'near-duplicate-image');
  else if (a.type === b.type && hamming(a.cropHash, b.cropHash) <= 6 && Math.abs(Number(a.mileage) - Number(b.mileage)) <= 5000) link(i, j, 'similar-display-close-mileage');
  else if (a.type === b.type && a.mileage === b.mileage) link(i, j, 'identical-mileage');
}
const groups = new Map();
rows.forEach((row, i) => { const g = `trodo-g${String(find(i)).padStart(4, '0')}`; row.group = g; groups.set(g, [...(groups.get(g) ?? []), row]); });

// Unseen-family challenge: whole display families held out of tuning and
// test. Chosen by rule from counts, before any result: every family with
// 35-60 images. This keeps the dominant LCD styles in the main test split.
const familyCounts = rows.reduce((m, r) => m.set(r.family, (m.get(r.family) ?? 0) + 1), new Map());
const challengeFamilies = [...familyCounts].filter(([f, n]) => !f.endsWith('-unknown') && n >= 35 && n <= 60).map(([f]) => f).sort();
const unit = g => parseInt(createHash('sha256').update(`tank-maleh-scan-split-v1:${g}`).digest('hex').slice(0, 8), 16) / 2 ** 32;
for (const [g, members] of groups) {
  const split = members.some(r => challengeFamilies.includes(r.family)) ? 'challenge' : unit(g) < .35 ? 'tuning' : 'test';
  for (const r of members) r.split = split;
}
const count = (list, key) => list.reduce((m, r) => ({ ...m, [key(r)]: (m[key(r)] ?? 0) + 1 }), {});
// Label semantics, from labels and type only (decided by sampling crops by
// eye before any recognition result existed; see PROTOCOL.md):
//  - "0", decimals and 1-2 digits are trip meters / clocks: negative scenes;
//  - digital labels of 3-4 digits are mostly trips with the decimal dropped:
//    unscored, because the label does not say which;
//  - analog registers of 3+ digits and digital readings of 5+ digits are the
//    lifetime odometer: eligible when the digit boxes spell the label.
function role(r) {
  if (r.mileage === '0' || /\./.test(r.mileage) || r.mileage.length <= 2) return 'negative-trip-or-clock';
  if (r.type === 'digital' && r.mileage.length <= 4) return 'unscored-ambiguous-label';
  // Protocol v1.1 (from tuning-split errors only): most analog registers end
  // in a differently coloured drum that is usually tenths, and TRODO labels
  // usually include it as a digit. The label then does not define the integer
  // the app records, so registers are reported separately, both ways.
  if (r.type === 'analog') return 'unscored-analog-register';
  if (r.issues.includes('digit-boxes-disagree') || r.issues.some(i => i.startsWith('odometer-boxes:'))) return 'excluded-label-check';
  return 'eligible';
}
const eligible = r => role(r) === 'eligible';
const audit = {
  format: 'tank-maleh-trodo-audit-v1', protocol: '1.1', at: new Date().toISOString(), source: 'TRODO v2, doi:10.17632/6y8m379mkt.2, CC BY 4.0',
  images: rows.length, groundTruthEntries: truth.length, exclusions, byType: count(rows, r => r.type), byFamily: count(rows, r => r.family),
  bySplit: count(rows, r => r.split), groupsBySplit: Object.fromEntries(['tuning', 'test', 'challenge'].map(s => [s, new Set(rows.filter(r => r.split === s).map(r => r.group)).size])),
  groups: groups.size, largestGroup: Math.max(...[...groups.values()].map(g => g.length)), links, challengeFamilies,
  issues: count(rows.flatMap(r => r.issues.length ? r.issues.map(i => ({ i })) : [{ i: 'none' }]), x => x.i),
  mileageDigits: count(rows, r => String(r.mileage.length)), below1000: rows.filter(r => Number(r.mileage) < 1000).length,
  roles: count(rows, role), rolesBySplit: Object.fromEntries(['tuning', 'test', 'challenge'].map(sp => [sp, count(rows.filter(r => r.split === sp), role)])),
};
const sessions = rows.map(r => ({
  id: `trodo:${r.image.replace(/\.jpe?g$/i, '')}`, kind: 'odometer', source: 'trodo-v2', split: r.split, group: r.group, family: r.family, device: 'unknown-smartphone',
  role: role(r), eligible: eligible(r), truth: 'dataset-annotation', expected: role(r) === 'eligible' ? { odometer: r.mileage } : null, label: r.mileage, type: r.type, issues: r.issues,
  frames: [{ file: `trodo-v2/trodo-v01/images/${r.image}`, sha256: r.sha256, bytes: r.bytes }],
  odometerBox: r.odometer, capturedAt: r.capturedAt,
}));
await mkdir(out, { recursive: true });
await writeFile(join(out, 'trodo-audit.json'), JSON.stringify(audit, null, 2) + '\n');
// One session per line keeps the frozen manifest reviewable in a diff.
await writeFile(join(out, 'trodo-sessions.json'), `{"format":"tank-maleh-scan-sessions-v1","source":"trodo-v2","splitSalt":"tank-maleh-scan-split-v1","sessions":[\n${sessions.map(x => JSON.stringify(x)).join(',\n')}\n]}\n`);
console.log(JSON.stringify({ images: audit.images, bySplit: audit.bySplit, groupsBySplit: audit.groupsBySplit, links, challengeFamilies, issues: audit.issues, roles: audit.roles, rolesBySplit: audit.rolesBySplit }, null, 1));
