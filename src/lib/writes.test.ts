import { describe, expect, it, vi } from "vitest";
import { WriteTracker, describeError, syncLabelText } from "./writes";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("write tracking", () => {
  it("reports a write as pending until the server acknowledges it", async () => {
    const tracker = new WriteTracker();
    const write = deferred<void>();

    const receipt = tracker.track("fillup.add", write.promise);
    expect(tracker.status().syncing).toBe(true);
    expect(tracker.status().pending).toHaveLength(1);

    write.resolve();
    await expect(receipt.settled).resolves.toBe(true);

    expect(tracker.status().syncing).toBe(false);
    expect(tracker.status().pending).toHaveLength(0);
    expect(tracker.status().failed).toHaveLength(0);
  });

  it("surfaces a permanent rejection instead of swallowing it", async () => {
    const tracker = new WriteTracker();
    const write = deferred<void>();

    const receipt = tracker.track("fillup.add", write.promise);
    write.reject({ code: "permission-denied" });

    await expect(receipt.settled).resolves.toBe(false);

    const status = tracker.status();
    expect(status.failed).toHaveLength(1);
    expect(status.failed[0].error).toBe("אין הרשאה לשמור את הרשומה הזו");
    // A failure is kept until the user acknowledges it.
    expect(status.syncing).toBe(false);
  });

  it("keeps a failure until it is dismissed", async () => {
    const tracker = new WriteTracker();
    const write = deferred<void>();
    tracker.track("fillup.update", write.promise);
    write.reject({ code: "invalid-argument" });
    await Promise.resolve();
    await Promise.resolve();

    const id = tracker.status().failed[0].id;
    tracker.dismiss(id);
    expect(tracker.status().failed).toHaveLength(0);
  });

  it("notifies subscribers on every transition", async () => {
    const tracker = new WriteTracker();
    const seen: number[] = [];
    tracker.subscribe((status) => seen.push(status.pending.length));

    const write = deferred<void>();
    const receipt = tracker.track("settings.update", write.promise);
    write.resolve();
    await receipt.settled;

    expect(seen).toEqual([0, 1, 0]);
  });

  it("lists unacknowledged writes, for the account-switch warning", async () => {
    const tracker = new WriteTracker();
    const slow = deferred<void>();
    tracker.track("fillup.add", slow.promise);

    expect(tracker.unacknowledged()).toHaveLength(1);
    slow.resolve();
    await slow.promise;
    await Promise.resolve();
    expect(tracker.unacknowledged()).toHaveLength(0);
  });

  it("cannot write into the next account's state after disposal", async () => {
    const tracker = new WriteTracker();
    const listener = vi.fn();
    tracker.subscribe(listener);

    const write = deferred<void>();
    const receipt = tracker.track("fillup.add", write.promise);

    // The account changed; this tracker belongs to the previous generation.
    tracker.dispose();
    listener.mockClear();

    write.reject({ code: "permission-denied" });
    await receipt.settled;

    expect(listener).not.toHaveBeenCalled();
    expect(tracker.status().failed).toHaveLength(0);
  });
});

describe("error and state copy", () => {
  it("distinguishes the failure modes worth acting on differently", () => {
    expect(describeError({ code: "permission-denied" })).toContain("הרשאה");
    expect(describeError({ code: "unauthenticated" })).toContain("התחברו מחדש");
    expect(describeError({ code: "resource-exhausted" })).toContain("מכסת");
    expect(describeError(new Error("boom"))).toBe("השמירה נכשלה בשרת");
  });

  it("names all four sync states distinctly", () => {
    const labels = (["saved-locally", "pending", "synced", "failed"] as const).map(
      syncLabelText,
    );
    expect(labels).toEqual(["נשמר במכשיר", "ממתין לסנכרון", "סונכרן", "הסנכרון נכשל"]);
    expect(new Set(labels).size).toBe(4);
  });
});
