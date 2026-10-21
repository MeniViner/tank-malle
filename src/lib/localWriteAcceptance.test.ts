import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentReference } from 'firebase/firestore';
import { writeWithLocalAcceptance } from './localWriteAcceptance';

const observer = vi.hoisted(() => ({ next: (_snapshot: unknown) => {}, fail: (_error: unknown) => {}, off: vi.fn() }));
vi.mock('firebase/firestore', () => ({ onSnapshot: (_ref: unknown, _options: unknown, next: typeof observer.next, fail: typeof observer.fail) => {
  observer.next = next; observer.fail = fail; return observer.off;
} }));
const ref = {} as DocumentReference;
const snapshot = (writeId: string) => ({ exists: () => true, data: () => ({ writeId }) });

describe('local acceptance and server acknowledgement are separate receipts', () => {
  beforeEach(() => vi.clearAllMocks());
  it('ignores cached older writes and accepts the exact durable write without waiting for the network', async () => {
    let acknowledge!: () => void;
    const settled = new Promise<void>(resolve => { acknowledge = resolve; });
    const receipt = writeWithLocalAcceptance(ref, data => data.writeId === 'op.2', () => settled);
    let accepted = false; void receipt.accepted.then(() => { accepted = true; });
    observer.next(snapshot('op.1')); await Promise.resolve(); expect(accepted).toBe(false);
    observer.next(snapshot('op.2')); await receipt.accepted; expect(accepted).toBe(true);
    expect(observer.off).toHaveBeenCalledOnce();
    expect(receipt.settled).toBe(settled); acknowledge(); await receipt.settled;
  });
  it('rejects a failed local persistence write so the form can retain its input', async () => {
    const error = new Error('disk unavailable');
    const receipt = writeWithLocalAcceptance(ref, () => false, () => Promise.reject(error));
    await expect(receipt.accepted).rejects.toBe(error);
    await expect(receipt.settled).rejects.toBe(error); expect(observer.off).toHaveBeenCalledOnce();
  });
  it('also accepts a server receipt and cleans up when a matching snapshot did not arrive', async () => {
    const receipt = writeWithLocalAcceptance(ref, () => false, () => Promise.resolve());
    await receipt.accepted; expect(observer.off).toHaveBeenCalledOnce();
  });
  it('retains a listener failure instead of reporting local acceptance', async () => {
    const receipt = writeWithLocalAcceptance(ref, () => false, () => new Promise(() => {}));
    const error = new Error('listener unavailable'); observer.fail(error);
    await expect(receipt.accepted).rejects.toBe(error); expect(observer.off).toHaveBeenCalledOnce();
  });
});
