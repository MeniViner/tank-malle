import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  lookupPlate,
  lookupTuning,
  normalizePlate,
  readCachedLookup,
  LOOKUP_MESSAGES,
} from "./plateLookup";

const PLATE = "12345678";

/** A minimal localStorage so the last-known-good cache is exercised. */
function installStorage(): void {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  });
}

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

const RECORD = {
  mispar_rechev: 12345678,
  tozeret_nm: "מאזדה יפן",
  kinuy_mishari: "3",
  shnat_yitzur: 2018,
  sug_delek_nm: "בנזין",
  tozeret_cd: 123,
  degem_cd: 456,
};

const emptyResult = { success: true, result: { records: [] } };
const hitResult = { success: true, result: { records: [RECORD] } };

const REAL_RETRY_DELAY = lookupTuning.retryDelayMs;

beforeEach(() => {
  installStorage();
  // The backoff is real behaviour, not something to assert here; shortening it
  // keeps the suite fast without changing which code path runs.
  lookupTuning.retryDelayMs = 0;
});

afterEach(() => {
  lookupTuning.retryDelayMs = REAL_RETRY_DELAY;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("plate normalisation", () => {
  it("keeps digits only", () => {
    expect(normalizePlate("12-345-678")).toBe("12345678");
  });

  it("does not call the registry for an obviously short plate", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const outcome = await lookupPlate("123");
    expect(outcome.status).toBe("not-found");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("found", () => {
  it("returns the parsed vehicle on the first dataset that holds it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(hitResult)));
    const outcome = await lookupPlate(PLATE, { uid: "u1" });

    expect(outcome.status).toBe("found");
    if (outcome.status !== "found") return;
    expect(outcome.vehicle.make).toBe("מאזדה");
    expect(outcome.vehicle.model).toBe("3");
    expect(outcome.vehicle.year).toBe(2018);
    expect(outcome.vehicle.fuelType).toBe("95");
  });

  it("caches the result as last-known-good, scoped to the user", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(hitResult)));
    await lookupPlate(PLATE, { uid: "u1" });

    expect(readCachedLookup("u1", PLATE)?.make).toBe("מאזדה");
    // Another account must not see it.
    expect(readCachedLookup("u2", PLATE)).toBeNull();
    // Nor another plate.
    expect(readCachedLookup("u1", "87654321")).toBeNull();
  });

  it("does not store the plate number in the clear", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(hitResult)));
    await lookupPlate(PLATE, { uid: "u1" });
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
    expect(keys.every((key) => !key?.includes(PLATE))).toBe(true);
  });
});

describe("confirmed not found", () => {
  it("is returned only when every dataset answered cleanly and empty", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(emptyResult));
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await lookupPlate(PLATE, { uid: "u1" });
    expect(outcome.status).toBe("not-found");
    if (outcome.status !== "not-found") return;
    expect(outcome.datasetsChecked).toBe(5);
  });
});

/* ------------------------------------------------------------------ *
 * Every one of these used to surface as "the vehicle does not exist".
 * ------------------------------------------------------------------ */

describe("temporarily unavailable", () => {
  async function expectUnavailable(fetchImpl: () => Promise<Response>) {
    vi.stubGlobal("fetch", vi.fn(fetchImpl));
    const outcome = await lookupPlate(PLATE, { uid: "u1" });
    expect(outcome.status).toBe("unavailable");
    return outcome;
  }

  it("HTTP 503", async () => {
    await expectUnavailable(async () => jsonResponse({}, { status: 503 }));
  });

  it("a network or CORS failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const outcome = await lookupPlate(PLATE, { uid: "u1" });
    expect(outcome.status).toBe("unavailable");
  });

  it("a timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("aborted", "AbortError");
      }),
    );
    const outcome = await lookupPlate(PLATE, { uid: "u1" });
    expect(outcome.status).toBe("unavailable");
    if (outcome.status !== "unavailable") return;
    expect(outcome.reason).toBe("timeout");
  });

  it("a body that is not JSON", async () => {
    await expectUnavailable(
      async () =>
        new Response("upstream error", { headers: { "content-type": "text/html" } }),
    );
  });

  it("an HTML page — the SPA rewrite that would otherwise read as 'no records'", async () => {
    const outcome = await expectUnavailable(
      async () =>
        new Response("<!doctype html><html><body>app</body></html>", {
          headers: { "content-type": "application/json" },
        }),
    );
    if (outcome.status !== "unavailable") return;
    expect(outcome.reason).toBe("html-response");
  });

  it("success: false", async () => {
    await expectUnavailable(async () => jsonResponse({ success: false, error: {} }));
  });

  it("a missing result structure", async () => {
    await expectUnavailable(async () => jsonResponse({ success: true }));
  });

  it("records that are not an array", async () => {
    await expectUnavailable(async () =>
      jsonResponse({ success: true, result: { records: "nope" } }),
    );
  });

  it("a row for a different plate than the one requested", async () => {
    await expectUnavailable(async () =>
      jsonResponse({
        success: true,
        result: { records: [{ ...RECORD, mispar_rechev: 99999999 }] },
      }),
    );
  });

  it("a partial sweep: one dataset fails while the rest come back empty", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call += 1;
        // The first dataset — the one most likely to hold a private car —
        // fails; the others answer empty. "Not found" is not a conclusion we
        // are entitled to draw.
        if (call <= 2) return jsonResponse({}, { status: 503 });
        return jsonResponse(emptyResult);
      }),
    );

    const outcome = await lookupPlate(PLATE, { uid: "u1" });
    expect(outcome.status).toBe("unavailable");
    if (outcome.status !== "unavailable") return;
    expect(outcome.reason).toBe("partial-sweep");
  });

  it("offers the last known good result when there is one", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(hitResult)));
    await lookupPlate(PLATE, { uid: "u1" });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const outcome = await lookupPlate(PLATE, { uid: "u1" });

    expect(outcome.status).toBe("unavailable");
    if (outcome.status !== "unavailable") return;
    expect(outcome.cached?.make).toBe("מאזדה");
  });

  it("has no cached fallback for a plate never looked up successfully", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const outcome = await lookupPlate("87654321", { uid: "u1" });
    if (outcome.status !== "unavailable") throw new Error("expected unavailable");
    expect(outcome.cached).toBeNull();
  });
});

describe("resilience", () => {
  it("retries a transient failure once before giving up on a dataset", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call += 1;
        if (call === 1) return jsonResponse({}, { status: 503 });
        return jsonResponse(hitResult);
      }),
    );
    const outcome = await lookupPlate(PLATE, { uid: "u1" });
    expect(outcome.status).toBe("found");
    expect(call).toBe(2);
  });

  it("re-asks with a string filter when the numeric one is a type mismatch", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        seen.push(new URL(url).searchParams.get("filters") ?? "");
        // 409 is CKAN's answer when the filter type does not match the column.
        if (seen.length === 1) return jsonResponse({}, { status: 409 });
        return jsonResponse(hitResult);
      }),
    );

    const outcome = await lookupPlate(PLATE, { uid: "u1" });
    expect(outcome.status).toBe("found");
    expect(seen[0]).toContain('"mispar_rechev":12345678'); // numeric first
    expect(seen[1]).toContain('"mispar_rechev":"12345678"'); // then text
  });

  it("sends a no-store request so a cached 200 cannot mask an outage", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      void _url;
      void init;
      return jsonResponse(hitResult);
    });
    vi.stubGlobal("fetch", fetchMock);
    await lookupPlate(PLATE, { uid: "u1" });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
  });
});

describe("copy", () => {
  it("distinguishes a confirmed miss from an outage", () => {
    expect(LOOKUP_MESSAGES.notFound).toContain("לא נמצא במאגרים שנבדקו");
    expect(LOOKUP_MESSAGES.unavailable).toContain("אינו זמין כרגע");
    expect(LOOKUP_MESSAGES.cachedFallback).toContain("בבדיקה הקודמת");
    // The old wording claimed absence for an outage; it must not reappear.
    expect(LOOKUP_MESSAGES.unavailable).not.toContain("לא נמצא");
  });
});
