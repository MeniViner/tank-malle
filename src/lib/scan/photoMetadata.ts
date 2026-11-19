/**
 * Where and when a photo chosen from the device was taken, read from its EXIF block.
 *
 * Read on the device only: the position picks the nearest station and the time fills the
 * fill-up's date, as if the driver had pressed "locate" at the pump. Nothing here is sent
 * anywhere; the scan samples are cut from a canvas, which carries no EXIF.
 *
 * Best effort and dependency-free: JPEG (APP1), and any container that embeds a plain
 * "Exif\0\0" or TIFF block in its first megabyte (HEIC, WebP, PNG eXIf). Many photos carry
 * neither, for example screenshots, or a picker that strips location; then both are null.
 */
export interface PhotoMetadata {
  /** Epoch millis of DateTimeOriginal, or null. */
  takenAt: number | null;
  position: { lat: number; lng: number } | null;
}

const NONE: PhotoMetadata = { takenAt: null, position: null };
const SCAN_BYTES = 1 << 20;

export async function readPhotoMetadata(file: Blob): Promise<PhotoMetadata> {
  try { return parsePhotoMetadata(await file.slice(0, SCAN_BYTES).arrayBuffer()); } catch { return NONE; }
}

export function parsePhotoMetadata(buffer: ArrayBuffer): PhotoMetadata {
  const bytes = new Uint8Array(buffer);
  const tiff = findTiff(bytes);
  if (tiff < 0) return NONE;
  try { return readTiff(new DataView(buffer), tiff); } catch { return NONE; }
}

function isTiffAt(bytes: Uint8Array, at: number): boolean {
  return at + 8 <= bytes.length && (
    (bytes[at] === 0x49 && bytes[at + 1] === 0x49 && bytes[at + 2] === 0x2a && bytes[at + 3] === 0) ||
    (bytes[at] === 0x4d && bytes[at + 1] === 0x4d && bytes[at + 2] === 0 && bytes[at + 3] === 0x2a));
}

function findTiff(bytes: Uint8Array): number {
  // JPEG: walk the segments to APP1 "Exif\0\0".
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2;
    while (at + 4 <= bytes.length && bytes[at] === 0xff) {
      const marker = bytes[at + 1];
      if (marker === 0xda || marker === 0xd9) break;
      const length = (bytes[at + 2] << 8) | bytes[at + 3];
      if (marker === 0xe1 && bytes[at + 4] === 0x45 && bytes[at + 5] === 0x78 && bytes[at + 6] === 0x69 &&
        bytes[at + 7] === 0x66 && bytes[at + 8] === 0 && bytes[at + 9] === 0 && isTiffAt(bytes, at + 10)) return at + 10;
      at += 2 + length;
    }
  }
  // Other containers: the first "Exif\0\0" followed by a TIFF header, or a WebP/PNG EXIF chunk.
  for (let at = 0; at + 14 <= bytes.length; at++) {
    if (bytes[at] === 0x45 && bytes[at + 1] === 0x78 && bytes[at + 2] === 0x69 && bytes[at + 3] === 0x66) {
      if (bytes[at + 4] === 0 && bytes[at + 5] === 0 && isTiffAt(bytes, at + 6)) return at + 6;
    }
    if ((bytes[at] === 0x45 && bytes[at + 1] === 0x58 && bytes[at + 2] === 0x49 && bytes[at + 3] === 0x46) || // WebP "EXIF"
      (bytes[at] === 0x65 && bytes[at + 1] === 0x58 && bytes[at + 2] === 0x49 && bytes[at + 3] === 0x66)) { // PNG "eXIf"
      if (isTiffAt(bytes, at + 8)) return at + 8;   // WebP: type, size, data
      if (isTiffAt(bytes, at + 4)) return at + 4;   // PNG: length, type, data
    }
  }
  return -1;
}

type Entry = { type: number; count: number; valueAt: number };

function readTiff(view: DataView, tiff: number): PhotoMetadata {
  const little = view.getUint8(tiff) === 0x49;
  const u16 = (at: number) => view.getUint16(at, little);
  const u32 = (at: number) => view.getUint32(at, little);
  const SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

  function ifd(offset: number): Map<number, Entry> {
    const entries = new Map<number, Entry>();
    const start = tiff + offset;
    if (offset < 8 || start + 2 > view.byteLength) return entries;
    const count = Math.min(u16(start), 512);
    for (let i = 0; i < count; i++) {
      const entry = start + 2 + i * 12;
      if (entry + 12 > view.byteLength) break;
      const type = u16(entry + 2), n = u32(entry + 4);
      const size = (SIZES[type] ?? 1) * n;
      entries.set(u16(entry), { type, count: n, valueAt: size <= 4 ? entry + 8 : tiff + u32(entry + 8) });
    }
    return entries;
  }
  function ascii(entry: Entry | undefined): string | null {
    if (!entry || entry.type !== 2 || entry.valueAt + entry.count > view.byteLength) return null;
    let text = "";
    for (let i = 0; i < entry.count; i++) {
      const code = view.getUint8(entry.valueAt + i);
      if (code === 0) break;
      text += String.fromCharCode(code);
    }
    return text.trim();
  }
  function rationals(entry: Entry | undefined): number[] | null {
    if (!entry || entry.type !== 5 || entry.valueAt + entry.count * 8 > view.byteLength) return null;
    const values: number[] = [];
    for (let i = 0; i < entry.count; i++) {
      const denominator = u32(entry.valueAt + i * 8 + 4);
      if (denominator === 0) return null;
      values.push(u32(entry.valueAt + i * 8) / denominator);
    }
    return values;
  }
  function pointer(entry: Entry | undefined): number | null {
    return entry && (entry.type === 4 || entry.type === 13) ? u32(entry.valueAt) : null;
  }

  const root = ifd(u32(tiff + 4));
  const exifOffset = pointer(root.get(0x8769));
  const exif = exifOffset === null ? new Map<number, Entry>() : ifd(exifOffset);
  const takenAt = parseExifDate(ascii(exif.get(0x9003)) ?? ascii(exif.get(0x9004)) ?? ascii(root.get(0x0132)),
    ascii(exif.get(0x9011)) ?? ascii(exif.get(0x9010)));

  let position: PhotoMetadata["position"] = null;
  const gpsOffset = pointer(root.get(0x8825));
  if (gpsOffset !== null) {
    const gps = ifd(gpsOffset);
    const lat = degrees(rationals(gps.get(2)), ascii(gps.get(1)), "S");
    const lng = degrees(rationals(gps.get(4)), ascii(gps.get(3)), "W");
    if (lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)) position = { lat, lng };
  }
  return { takenAt, position };
}

function degrees(parts: number[] | null, ref: string | null, negative: string): number | null {
  if (!parts || parts.length === 0 || parts.some(part => !Number.isFinite(part))) return null;
  const value = parts[0] + (parts[1] ?? 0) / 60 + (parts[2] ?? 0) / 3600;
  return ref?.toUpperCase().startsWith(negative) ? -value : value;
}

/** "YYYY:MM:DD HH:MM:SS" with an optional "+HH:MM" offset; without one, the device's own time zone. */
export function parseExifDate(text: string | null, offset: string | null = null): number | null {
  const match = text?.match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(part => Number(part ?? 0));
  if (year < 2000 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  const zone = offset?.match(/^([+-])(\d{2}):?(\d{2})$/);
  if (zone) {
    const minutes = (zone[1] === "-" ? -1 : 1) * (Number(zone[2]) * 60 + Number(zone[3]));
    return Date.UTC(year, month - 1, day, hour, minute, second) - minutes * 60_000;
  }
  const local = new Date(year, month - 1, day, hour, minute, second);
  return local.getDate() === day ? local.getTime() : null;
}

/**
 * A photo's time fills the fill-up's date only when it is plausibly this fill-up: not in the
 * future (a few minutes of clock skew aside) and from the last 60 days. An older photo is more
 * likely a reused picture than a late entry; the date stays one tap away either way.
 */
export function photoTimeUsable(takenAt: number, now: number): boolean {
  return takenAt <= now + 5 * 60_000 && takenAt >= now - 60 * 86_400_000;
}
