import { onSnapshot, type DocumentData, type DocumentReference } from 'firebase/firestore';

/** The SDK emits a local mutation snapshot after its persistence transaction
 * commits. Its write promise, separately, waits for SERVER acknowledgement.
 * Do not dismiss a form merely because the independent outbox committed. */
export function writeWithLocalAcceptance(
  ref: DocumentReference,
  matches: (data: DocumentData) => boolean,
  write: () => Promise<unknown>,
): { accepted: Promise<void>; settled: Promise<unknown> } {
  let unsubscribe = () => {};
  let done = false;
  let accept!: () => void;
  let reject!: (error: unknown) => void;
  const accepted = new Promise<void>((resolve, fail) => { accept = resolve; reject = fail; });
  // The caller first attaches the server receipt to the journal. A fast
  // local failure can precede its await of `accepted` by a microtask.
  void accepted.catch(() => {});
  const finish = (error?: unknown) => {
    if (done) return;
    done = true; unsubscribe();
    if (error !== undefined) reject(error); else accept();
  };
  unsubscribe = onSnapshot(ref, { includeMetadataChanges: true }, snapshot => {
    if (snapshot.exists() && matches(snapshot.data())) finish();
  }, error => finish(error));
  if (done) unsubscribe();
  let settled: Promise<unknown>;
  try { settled = write(); }
  catch (error) { finish(error); settled = Promise.reject(error); }
  // A server acknowledgement is also conclusive if the listener did not
  // deliver a matching snapshot. Rejections keep the input retryable.
  void settled.then(() => finish(), error => finish(error));
  return { accepted, settled };
}
