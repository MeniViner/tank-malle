import { describe, expect, it } from "vitest";
import {
  SERVER_TIMESTAMP,
  fillupPayloadMatches,
  parseFillupDocument,
  sanitizeStation,
  serializeFillup,
  serializeFillupPatch,
  validateFillupPayload,
  validateFillupInput,
} from "./fillupSerializer";
import type { Fillup } from "./stats";

const stored: Fillup = {
  id: "f1",
  date: Date.UTC(2026, 8, 5, 8, 0),
  odometer: 123_456,
  liters: 38.2,
  pricePerLiter: 7.19,
  totalCost: 274.66,
  isFullTank: true,
  station: { name: "פז", stationId: "1234", brand: "פז" },
  notes: "הערה",
  createdAt: 1_700_000_000_000,
  continuityBreakBefore: false,
  fullTankSource: "user",
  postedPricePerLiter: 7.19,
  fuelType: "95",
  schemaVersion: 2,
};

describe("serialising a fill-up", () => {
  it("never sends the document id — the Undo-after-edit regression", () => {
    const patch = serializeFillupPatch(stored);
    expect(Object.keys(patch)).not.toContain("id");
    expect(Object.keys(patch)).not.toContain("createdAt");
    expect(validateFillupPayload(patch)).toEqual([]);
  });

  it("stamps a new record with the server timestamp and keeps an existing one", () => {
    const { id: _id, createdAt: _at, ...fresh } = stored;
    expect(serializeFillup(fresh).createdAt).toBe(SERVER_TIMESTAMP);
    expect(serializeFillup(stored).createdAt).toBe(1_700_000_000_000);
  });

  it("drops undefined values and keys the rules do not know", () => {
    const payload = serializeFillup({
      ...stored,
      importSource: undefined,
      ...({ leaked: "x" } as object),
    });
    expect(payload).not.toHaveProperty("leaked");
    expect(payload).not.toHaveProperty("importSource");
  });

  it("sanitises a station picked from history or an import", () => {
    expect(
      sanitizeStation({ name: "  פז חגור ", lat: 32.1, lng: 34.9, stationId: "42", tracking: { a: 1 } }),
    ).toEqual({ name: "פז חגור", lat: 32.1, lng: 34.9, stationId: "42" });
    expect(sanitizeStation({ name: "" })).toBeNull();
    expect(sanitizeStation("פז")).toBeNull();
  });

  it("trims whitespace without truncating the note", () => {
    const payload = serializeFillup({ ...stored, notes: "  " });
    expect(payload.notes).toBeNull();
    const long = serializeFillup({ ...stored, notes: "א".repeat(600) });
    expect((long.notes as string).length).toBe(600);
    expect(validateFillupPayload(long).map((e) => e.field)).toContain("notes");
  });
});

describe("reading a stored document", () => {
  it("reports a record with an unreadable date instead of stamping it with now", () => {
    const parsed = parseFillupDocument("bad", { odometer: 1, liters: 2, date: "yesterday" });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toContain("תאריך");
  });

  it("reads Timestamp-like dates", () => {
    const parsed = parseFillupDocument("f1", {
      date: { toMillis: () => 5 },
      createdAt: { seconds: 10 },
      odometer: 1,
      liters: 2,
    });
    expect(parsed.ok && parsed.fillup.date).toBe(5);
    expect(parsed.ok && parsed.fillup.createdAt).toBe(10_000);
  });

  it("round-trips a serialised payload", () => {
    const payload = serializeFillup(stored);
    const parsed = parseFillupDocument("f1", payload);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.fillup.liters).toBe(38.2);
      expect(parsed.fillup.station).toEqual(stored.station);
      expect(parsed.fillup.postedPricePerLiter).toBe(7.19);
    }
  });
});

describe("client validation mirrors the rules", () => {
  const base = serializeFillup(stored);

  it("accepts a well-formed record", () => {
    expect(validateFillupPayload(base)).toEqual([]);
  });

  it("names the field for every server constraint", () => {
    const fields = (over: Record<string, unknown>) =>
      validateFillupPayload({ ...base, ...over }).map((e) => e.field);
    expect(fields({ odometer: 3_000_000 })).toContain("odometer");
    expect(fields({ liters: 501, totalCost: 0 })).toContain("liters");
    expect(fields({ pricePerLiter: 101, totalCost: 0 })).toContain("pricePerLiter");
    expect(fields({ totalCost: 50_001 })).toContain("totalCost");
    expect(fields({ notes: "א".repeat(501) })).toContain("notes");
    expect(fields({ station: { name: "פז", extra: 1 } })).toContain("station");
    expect(fields({ preFillLevel: 25 })).toContain("tank");
    expect(fields({ refuelReason: "boredom" })).toContain("tank");
    expect(fields({ id: "f1" })).toContain("tank");
  });

  it("explains a total that does not reconcile — the price-refresh regression", () => {
    // 40 L at ₪7 = 280; a suggested price arriving later at 8.25 would need 330.
    const errors = validateFillupPayload({ ...base, liters: 40, pricePerLiter: 8.25, totalCost: 280 });
    expect(errors.map((e) => e.field)).toEqual(["totalCost"]);
    expect(errors[0].message).toContain("280");
  });

  it("allows pump rounding within the rules' tolerance", () => {
    expect(validateFillupPayload({ ...base, liters: 40, pricePerLiter: 7.31, totalCost: 292 })).toEqual([]);
  });
});

describe("matching a payload against a server read", () => {
  it("ignores creation metadata and reads server timestamps", () => {
    const payload = serializeFillup(stored);
    expect(
      fillupPayloadMatches(payload, { ...payload, date: { seconds: stored.date / 1000 }, createdAt: { seconds: 1 } }),
    ).toBe(true);
    expect(fillupPayloadMatches(payload, { ...payload, liters: 40 })).toBe(false);
  });
});


describe("raw user input is validated before normalization", () => {
  it("rejects oversized notes including whitespace that normalization would conceal", () => {
    const notes = " ".repeat(501);
    expect(validateFillupInput({ ...stored, notes }).map((error) => error.field)).toContain("notes");
  });
  for (const [field, maximum] of [["name", 120], ["stationId", 64], ["brand", 60]] as const) {
    it(`retains and rejects oversized station ${field} instead of shortening it`, () => {
      const station = { name: "פז", [field]: "א".repeat(maximum + 1), tracking: "legacy-extra" };
      const payload = serializeFillup({ ...stored, station });
      expect((payload.station as Record<string, unknown>)[field]).toBe(station[field]);
      expect(payload.station).not.toHaveProperty("tracking");
      expect(validateFillupInput({ ...stored, station }).map((error) => error.field)).toContain("station");
      expect(validateFillupPayload(payload).map((error) => error.field)).toContain("station");
    });
    it(`accepts station ${field} at the exact limit`, () => {
      expect(validateFillupInput({ ...stored, station: { name: "פז", [field]: "א".repeat(maximum) } })).toEqual([]);
    });
  }
  it("retains oversize historical station evidence when reading an existing document", () => {
    const station = { name: "א".repeat(121), stationId: "b".repeat(65), brand: "c".repeat(61) };
    const read = parseFillupDocument("history", { ...stored, station });
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.fillup.station).toEqual(station);
  });
  it("preserves whitelist compatibility for valid legacy records with unknown UI fields", () => {
    const legacyStation = { ...stored.station!, tracking: "legacy" };
    expect(validateFillupInput({ ...stored, station: legacyStation })).toEqual([]);
  });
});
