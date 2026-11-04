import type { RecordDeletionSubmission } from '../context/DataContext';
import type { Toast } from '../context/ToastContext';

/** Exact provider envelope remains authoritative after the detail route closes. */
export function observeVehicleRecordDeletion(
  submission: RecordDeletionSubmission,
  showToast: (toast: Omit<Toast, 'id'>) => number,
  dismissToast: (id: number) => void,
) {
  if (!submission.isCurrent()) return;
  const waiting = showToast({ tone: 'info', title: 'בקשת המחיקה נשמרה במכשיר', detail: 'ממתינה לאישור בענן' });
  void submission.receipt.settled.then(accepted => {
    dismissToast(waiting);
    if (!submission.isCurrent()) return;
    if (!accepted) {
      showToast({ tone: 'info', title: 'המחיקה דורשת בדיקה', detail: 'הבקשה שמורה בשינויים שעוד לא עלו לענן' }); return;
    }
    const deadline = submission.undoDeadline;
    let used = false;
    const canRestore = () => !used && submission.isCurrent() && deadline !== null && Date.now() < deadline && submission.canRestore();
    const restore = async () => {
      if (!canRestore()) return;
      used = true;
      try {
        const receipt = await submission.restoreDeleted();
        if (!submission.isCurrent()) return;
        showToast({ tone: 'info', title: 'בקשת השחזור נשמרה במכשיר' });
        const restored = await receipt.settled;
        if (submission.isCurrent()) showToast({ tone: restored ? 'success' : 'info', title: restored ? 'התזכורת שוחזרה' : 'השחזור דורש בדיקה' });
      } catch (cause) {
        if (!submission.isCurrent()) return;
        const retry = submission.canRestore() && deadline !== null && Date.now() < deadline;
        if (retry) used = false;
        showToast({ tone: 'error', title: cause instanceof Error ? cause.message : 'השחזור לא נשמר',
          duration: retry ? deadline! - Date.now() : 5000, onUndo: retry ? restore : undefined });
      }
    };
    const offer = canRestore();
    showToast({ tone: 'success', title: deadline === null ? 'התזכורת כבר אינה ברכב' : 'התזכורת נמחקה',
      duration: offer ? deadline! - Date.now() : 5000, onUndo: offer ? restore : undefined });
  });
}
