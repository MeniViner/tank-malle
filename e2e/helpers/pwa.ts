import { expect, type Page } from "@playwright/test";

/**
 * Helpers for the production-build rig (the `pwa` Playwright project).
 *
 * Everything here assumes the page is served by `vite preview` from a real
 * build, so a service worker exists and can be primed. Nothing here is
 * specific to a page; the spec decides what to visit and when to go offline.
 */

/**
 * Wait until a service worker is active AND controls this page.
 *
 * The build registers the worker with `registerType: "prompt"`, which does
 * not `clientsClaim`: the very first load that registers the worker is not
 * controlled by it, only the next navigation is. `ready` alone therefore is
 * not enough — a page can have an active worker and still fetch straight
 * from the network, and an offline reload would then fail. If the page is
 * not yet controlled after `ready`, one reload puts it under control.
 */
export async function waitForServiceWorkerControl(page: Page): Promise<void> {
  const controlled = () =>
    page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return "unsupported";
      await navigator.serviceWorker.ready;
      return navigator.serviceWorker.controller ? "controlled" : "uncontrolled";
    });

  await expect.poll(controlled, { timeout: 30_000 }).not.toBe("unsupported");
  if ((await controlled()) === "controlled") return;

  await page.reload();
  await expect.poll(controlled, { timeout: 30_000 }).toBe("controlled");
}

/** What the navigation timing entry says about how the current document arrived. */
export interface NavigationDelivery {
  /** > 0 when a service worker handled the navigation request. */
  workerStart: number;
  /** 0 when nothing came over the network for the document itself. */
  transferSize: number;
}

export async function navigationDelivery(page: Page): Promise<NavigationDelivery> {
  return page.evaluate(() => {
    const [entry] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    return { workerStart: entry?.workerStart ?? -1, transferSize: entry?.transferSize ?? -1 };
  });
}

/**
 * Prove the network is really cut, service worker included.
 *
 * A same-origin resource that is NOT precached, with a cache-busting query so
 * no runtime cache can answer either. The worker has nothing for it and falls
 * through to the network; with the browser offline that fetch must fail. If
 * it succeeds, the rig is lying about "offline" and the spec must say so
 * rather than pass on a reload the worker never served.
 */
export async function expectNetworkCut(page: Page): Promise<void> {
  const outcome = await page.evaluate(async () => {
    try {
      const response = await fetch(`/fuel-stations.json?probe=${Date.now()}`, { cache: "no-store" });
      return `reached the network: HTTP ${response.status}`;
    } catch {
      return "cut";
    }
  });
  expect(outcome, "the browser is supposed to be offline").toBe("cut");
}

/**
 * Count the durable outbox entries for one account.
 *
 * Two stores are consulted, because the outbox is moving from `localStorage`
 * to IndexedDB: the `tm.outbox.v1.<uid>` keys hold a JSON snapshot with an
 * `operations` array; the `tm-outbox` database, when it exists, holds one
 * record per operation in an `operations` store. Operations are de-duplicated
 * by `opId` across both, so a migration that briefly keeps a copy in each
 * cannot double-count.
 */
export async function outboxCount(page: Page, uid: string): Promise<number> {
  return page.evaluate(async (uid) => {
    const ids = new Set<string>();

    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i) ?? "";
      if (!key.startsWith("tm.outbox.v1.")) continue;
      try {
        const parsed = JSON.parse(localStorage.getItem(key) ?? "{}") as {
          operations?: { opId?: string; uid?: string }[];
        };
        for (const op of parsed.operations ?? []) {
          if (op.uid === uid) ids.add(op.opId ?? `${key}#${ids.size}`);
        }
      } catch {
        // A malformed snapshot counts for nothing, exactly as the app treats it.
      }
    }

    const hasOutboxDb =
      "databases" in indexedDB &&
      (await indexedDB.databases()).some((entry) => entry.name === "tm-outbox");
    if (hasOutboxDb) {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("tm-outbox");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        if (db.objectStoreNames.contains("operations")) {
          const records = await new Promise<{ opId?: string; uid?: string }[]>(
            (resolve, reject) => {
              const request = db.transaction("operations", "readonly").objectStore("operations").getAll();
              request.onsuccess = () => resolve(request.result as { opId?: string; uid?: string }[]);
              request.onerror = () => reject(request.error);
            },
          );
          records.forEach((record, index) => {
            if (record.uid === uid) ids.add(record.opId ?? `idb#${index}`);
          });
        }
      } finally {
        db.close();
      }
    }

    return ids.size;
  }, uid);
}

/**
 * Type a record into the real form and save it. Does not wait for the record
 * to be acknowledged — the point of the spec is what happens before it is.
 */
export async function fillForm(
  page: Page,
  input: { odometer: number; liters: number; price: number; full?: boolean },
): Promise<void> {
  await page.goto("/fillup/new");
  await page.getByLabel(/^קילומטראז׳/).fill(String(input.odometer));
  await page.getByLabel("ליטרים", { exact: true }).fill(String(input.liters));
  await page.getByLabel("מחיר לליטר").fill(String(input.price));
  if (input.full !== false) {
    await page.getByRole("button", { name: "מילאתי מיכל מלא", exact: true }).click();
  }
  await page.getByRole("button", { name: "שמירת תדלוק" }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/(\?.*)?$/, { timeout: 20_000 });
}
