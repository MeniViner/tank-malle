import { describe, expect, it } from "vitest";
import { parseExifDate, parsePhotoMetadata, photoJustTaken, photoTimeUsable } from "./photoMetadata";

type Tag = { tag: number; type: 2 | 4 | 5; value: string | number | number[][] };

/** A minimal TIFF block: IFD0 → Exif IFD and GPS IFD, the layout phone cameras write. */
function tiff(little: boolean, root: Tag[], exif: Tag[], gps: Tag[]): Uint8Array {
  const out: number[] = [];
  const u16 = (v: number) => little ? [v & 255, v >> 8] : [v >> 8, v & 255];
  const u32 = (v: number) => little ? [v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24] : [v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255];
  const ifds: Tag[][] = [root, exif, gps];
  const ifdSize = (tags: Tag[]) => 2 + tags.length * 12 + 4;
  const starts: number[] = [];
  let at = 8;
  for (const tags of ifds) { starts.push(at); at += ifdSize(tags); }
  let data = at;
  const blobs: number[] = [];
  const fixed = (tags: Tag[], index: number) => tags.map(t =>
    t.tag === 0x8769 ? { ...t, value: starts[1] } : t.tag === 0x8825 ? { ...t, value: starts[2] } : t).map(t => ({ ...t, index }));
  out.push(...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8));
  ifds.forEach((tags, index) => {
    const list = fixed(tags, index);
    out.push(...u16(list.length));
    for (const t of list) {
      let bytes: number[]; let count: number;
      if (t.type === 2) { bytes = [...String(t.value)].map(c => c.charCodeAt(0)).concat(0); count = bytes.length; }
      else if (t.type === 4) { bytes = u32(Number(t.value)); count = 1; }
      else { bytes = (t.value as number[][]).flatMap(([n, d]) => [...u32(n), ...u32(d)]); count = (t.value as number[][]).length; }
      out.push(...u16(t.tag), ...u16(t.type), ...u32(count));
      if (bytes.length <= 4) out.push(...bytes, ...Array(4 - bytes.length).fill(0));
      else { out.push(...u32(data)); blobs.push(...bytes); data += bytes.length; }
    }
    out.push(...u32(0));
  });
  return new Uint8Array([...out, ...blobs]);
}

function jpeg(block: Uint8Array): ArrayBuffer {
  const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...block];
  const length = payload.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xe1, length >> 8, length & 255, ...payload, 0xff, 0xda]).buffer;
}

const PHONE = (little: boolean) => tiff(little,
  [{ tag: 0x0132, type: 2, value: "2026:01:01 00:00:00" }, { tag: 0x8769, type: 4, value: 0 }, { tag: 0x8825, type: 4, value: 0 }],
  [{ tag: 0x9003, type: 2, value: "2026:11:19 18:42:07" }, { tag: 0x9011, type: 2, value: "+02:00" }],
  [{ tag: 1, type: 2, value: "N" }, { tag: 2, type: 5, value: [[32, 1], [4, 1], [3000, 100]] },
    { tag: 3, type: 2, value: "E" }, { tag: 4, type: 5, value: [[34, 1], [46, 1], [4800, 100]] }]);

describe("parsePhotoMetadata", () => {
  it("reads the time and position a phone camera writes, in both byte orders", () => {
    for (const little of [true, false]) {
      const meta = parsePhotoMetadata(jpeg(PHONE(little)));
      expect(meta.takenAt).toBe(Date.UTC(2026, 10, 19, 16, 42, 7));
      expect(meta.position?.lat).toBeCloseTo(32 + 4 / 60 + 30 / 3600, 6);
      expect(meta.position?.lng).toBeCloseTo(34 + 46 / 60 + 48 / 3600, 6);
    }
  });

  it("finds an embedded Exif block in other containers (HEIC/WebP)", () => {
    const block = PHONE(true);
    const container = new Uint8Array([...Array(40).fill(7), 0x45, 0x78, 0x69, 0x66, 0, 0, ...block]);
    expect(parsePhotoMetadata(container.buffer).position).not.toBeNull();
  });

  it("applies the south and west references", () => {
    const block = tiff(true, [{ tag: 0x8825, type: 4, value: 0 }], [],
      [{ tag: 1, type: 2, value: "S" }, { tag: 2, type: 5, value: [[10, 1], [0, 1], [0, 1]] },
        { tag: 3, type: 2, value: "W" }, { tag: 4, type: 5, value: [[20, 1], [30, 1], [0, 1]] }]);
    expect(parsePhotoMetadata(jpeg(block)).position).toEqual({ lat: -10, lng: -20.5 });
  });

  it("returns nothing for photos without EXIF, a zero position, or garbage", () => {
    expect(parsePhotoMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xda]).buffer)).toEqual({ takenAt: null, position: null });
    expect(parsePhotoMetadata(new Uint8Array(100).buffer)).toEqual({ takenAt: null, position: null });
    const zero = tiff(true, [{ tag: 0x8825, type: 4, value: 0 }], [],
      [{ tag: 2, type: 5, value: [[0, 1], [0, 1], [0, 1]] }, { tag: 4, type: 5, value: [[0, 1], [0, 1], [0, 1]] }]);
    expect(parsePhotoMetadata(jpeg(zero)).position).toBeNull();
    const broken = jpeg(PHONE(true)); new Uint8Array(broken).fill(0xff, 30, 60);
    expect(() => parsePhotoMetadata(broken)).not.toThrow();
  });
});

describe("parseExifDate", () => {
  it("uses the device time zone without an offset and rejects empty dates", () => {
    expect(parseExifDate("2026:11:19 08:05:00")).toBe(new Date(2026, 10, 19, 8, 5, 0).getTime());
    expect(parseExifDate("0000:00:00 00:00:00")).toBeNull();
    expect(parseExifDate("2026:02:31 10:00:00")).toBeNull();
    expect(parseExifDate("2026:11:19 08:05:00", "-05:00")).toBe(Date.UTC(2026, 10, 19, 13, 5, 0));
  });
});

describe("photoTimeUsable", () => {
  const now = Date.UTC(2026, 10, 20, 12);
  it("accepts recent photos and rejects future or old ones", () => {
    expect(photoTimeUsable(now - 3_600_000, now)).toBe(true);
    expect(photoTimeUsable(now + 60_000, now)).toBe(true);
    expect(photoTimeUsable(now + 3_600_000, now)).toBe(false);
    expect(photoTimeUsable(now - 61 * 86_400_000, now)).toBe(false);
  });
});

describe("photoJustTaken", () => {
  const now = Date.UTC(2026, 10, 20, 12);
  it("is true only for a photo from the last half hour", () => {
    expect(photoJustTaken(now - 10 * 60_000, now)).toBe(true);
    expect(photoJustTaken(now - 31 * 60_000, now)).toBe(false);
    expect(photoJustTaken(null, now)).toBe(false);
  });
});
