import { expect, type Page } from "@playwright/test";
import type { Outbox, OutboxKind, OutboxOperation, OutboxPayload } from "../../src/lib/outbox";

type HookWindow = Window & { __tankMalleTest: { openOutbox: (uid: string) => Promise<Outbox> } };

/** Read the real account journal, never a UI count or a mocked write queue. */
export async function journalOperations(page: Page, uid: string): Promise<OutboxOperation[]> {
  return page.evaluate(async uid => {
    const box = await (window as HookWindow).__tankMalleTest.openOutbox(uid);
    try { return await box.list(); } finally { box.close(); }
  }, uid);
}

/** A real recovered input whose desired metadata differs from its immutable server base. */
export async function replaceRejectedFillupPayload(page: Page, uid: string, fields: OutboxPayload) {
  return page.evaluate(async ({ uid, fields }) => {
    const box = await (window as HookWindow).__tankMalleTest.openOutbox(uid);
    try {
      const rows = await box.list();
      const original = rows[0];
      if (rows.length !== 1 || original.status !== "failed" || !original.payload ||
        !["fillup.add", "fillup.update"].includes(original.kind)) throw new Error("Expected one genuinely rejected fill-up input");
      const next = await box.enqueue({ kind: original.kind, path: original.path, vehicleId: original.vehicleId,
        payload: { ...original.payload, ...fields }, beforeImage: original.beforeImage, opType: original.opType,
        replaceOpId: original.opId, batchId: original.batchId });
      if (!await box.fail(next.opId, next.version, { code: "permission-denied", message: "Recovered rejected metadata fixture", at: Date.now() })) {
        throw new Error("The recovered input was replaced unexpectedly");
      }
      return { original, replacement: (await box.get(next.opId))! };
    } finally { box.close(); }
  }, { uid, fields });
}

/**
 * Pause one matching real enqueue either before the disk commit or after the
 * commit but before DataContext can submit it. This disposable page-only
 * interleaving makes durability and server-CAS failures reproducible without
 * altering application code, server clocks, or the outbox implementation.
 */
export async function holdJournal(page: Page, uid: string, kind: OutboxKind, timing: "before" | "after"): Promise<void> {
  await page.evaluate(async ({ uid, kind, timing }) => {
    const box = await (window as HookWindow).__tankMalleTest.openOutbox(uid);
    const prototype = Object.getPrototypeOf(box) as Outbox;
    const original = prototype.enqueueMany;
    box.close();
    let resume: () => void = () => {};
    let reject = false;
    const pending = new Promise<void>(resolve => { resume = resolve; });
    const gate = {
      attempted: false,
      committed: false,
      release: (fail = false) => {
        reject = fail;
        prototype.enqueueMany = original;
        resume();
      },
    };
    (window as Window & { fillupJournalGate?: typeof gate }).fillupJournalGate = gate;
    prototype.enqueueMany = async function (inputs) {
      const matched = !gate.attempted && inputs.some(input => input.kind === kind);
      if (!matched) return original.call(this, inputs);
      gate.attempted = true;
      if (timing === "before") {
        await pending;
        if (reject) throw new Error("e2e: journal storage refused this attempt");
      }
      const result = await original.call(this, inputs);
      gate.committed = true;
      if (timing === "after") await pending;
      return result;
    };
  }, { uid, kind, timing });
}

export async function waitForJournalHold(page: Page, committed = false): Promise<void> {
  await expect.poll(() => page.evaluate(committed => {
    const gate = (window as Window & { fillupJournalGate?: { attempted: boolean; committed: boolean } }).fillupJournalGate;
    return committed ? gate?.committed : gate?.attempted;
  }, committed)).toBe(true);
}

export async function releaseJournal(page: Page, reject = false): Promise<void> {
  await page.evaluate(reject => {
    (window as Window & { fillupJournalGate?: { release: (fail?: boolean) => void } }).fillupJournalGate?.release(reject);
  }, reject);
}
