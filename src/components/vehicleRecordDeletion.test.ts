import { describe, expect, it, vi } from 'vitest';
import type { RecordDeletionSubmission } from '../lib/recordUndo';
import type { Toast } from '../context/ToastContext';
import { observeVehicleRecordDeletion } from './vehicleRecordDeletion';

function deferred() {
  let resolve!: (accepted: boolean) => void;
  const promise = new Promise<boolean>(done => { resolve = done; });
  return { promise, resolve };
}

describe('quiet deletion feedback', () => {
  it('stays quiet until ACK, then offers Undo without announcing pending restoration', async () => {
    const deletion = deferred(), restoration = deferred();
    const restoreDeleted = vi.fn(async () => ({ id: 'restore', settled: restoration.promise }));
    const submission: RecordDeletionSubmission = {
      receipt: { id: 'delete', settled: deletion.promise }, isCurrent: () => true,
      canRestore: () => true, undoDeadline: Date.now() + 5000, restoreDeleted,
    };
    const show = vi.fn((_toast: Omit<Toast, 'id'>) => 1);
    observeVehicleRecordDeletion(submission, show);
    expect(show).not.toHaveBeenCalled();
    deletion.resolve(true);
    await deletion.promise;
    const toast = show.mock.calls[0][0];
    expect(toast.tone).toBe('success');
    expect(toast.title).toBe('התזכורת נמחקה');
    expect(toast.onUndo).toBeTypeOf('function');
    const undo = toast.onUndo!();
    await Promise.resolve();
    expect(restoreDeleted).toHaveBeenCalledOnce();
    expect(show).toHaveBeenCalledOnce();
    restoration.resolve(true);
    await undo;
    expect(show.mock.calls[1][0]).toMatchObject({ tone: 'success', title: 'התזכורת שוחזרה' });
  });

  it('retains rejection feedback without any premature success or Undo', async () => {
    const deletion = deferred();
    const submission: RecordDeletionSubmission = {
      receipt: { id: 'delete', settled: deletion.promise }, isCurrent: () => true,
      canRestore: () => false, undoDeadline: null, restoreDeleted: vi.fn(),
    };
    const show = vi.fn((_toast: Omit<Toast, 'id'>) => 1);
    observeVehicleRecordDeletion(submission, show);
    expect(show).not.toHaveBeenCalled();
    deletion.resolve(false);
    await deletion.promise;
    expect(show).toHaveBeenCalledOnce();
    expect(show.mock.calls[0][0]).toMatchObject({ tone: 'info', title: 'המחיקה דורשת בדיקה' });
    expect(show.mock.calls[0][0].onUndo).toBeUndefined();
  });

  it('does not publish a late result into a changed account or vehicle scope', async () => {
    const deletion = deferred();
    let current = true;
    const submission: RecordDeletionSubmission = {
      receipt: { id: 'delete', settled: deletion.promise }, isCurrent: () => current,
      canRestore: () => false, undoDeadline: null, restoreDeleted: vi.fn(),
    };
    const show = vi.fn((_toast: Omit<Toast, 'id'>) => 1);
    observeVehicleRecordDeletion(submission, show);
    current = false;
    deletion.resolve(true);
    await deletion.promise;
    expect(show).not.toHaveBeenCalled();
  });
});
