import type { Fillup } from './types';
import type { OutboxPayload } from './outbox';
import type { MutationReceipt } from './writes';
import { parseFillupDocument, serializeFillup, serializeFillupPatch } from './fillupSerializer';
import { assertMutationScope } from './rawDocument';

function retainExistingNotes(fillup: Readonly<Fillup>, image: OutboxPayload): OutboxPayload {
  if (typeof fillup.notes === 'string') image.notes = fillup.notes;
  return image;
}

/**
 * Capture an existing fill-up for deletion or restoration, not a new form input.
 * The document reader preserves legal legacy notes verbatim, including empty
 * strings and surrounding whitespace. Reapplying the input serializer's text
 * cleanup here would manufacture a different CAS base and alter an Undo.
 * Keep its field whitelist and all other serialization behavior unchanged.
 */
export function fillupLifecycleImage(fillup: Readonly<Fillup>): OutboxPayload {
  return retainExistingNotes(fillup, serializeFillup(fillup));
}

/** Existing update bases and explicit Undo targets never carry createdAt. */
export function fillupLifecyclePatch(fillup: Readonly<Fillup>): OutboxPayload {
  return retainExistingNotes(fillup, serializeFillupPatch(fillup));
}

/** The submitted model reflects the actual canonical patch, not raw form input. */
export function fillupAfterPatch(id: string, previous: Readonly<Fillup> | null, outgoing: OutboxPayload): Fillup {
  const parsed = parseFillupDocument(id, { ...previous, ...outgoing });
  if (!parsed.ok) throw new Error('לא ניתן לקרוא את התדלוק שנשלח');
  return parsed.fillup;
}

/**
 * Only the provider supplies this writer. An edit Undo remains an update with
 * an exact submitted base; it cannot become an absent-document restoration.
 * Both images are captured now, before a delayed acknowledgement or route exit.
 */
export function createFillupEditUndo(input: {
  previous: Readonly<Fillup> | null;
  written: Readonly<Fillup>;
  receipt: MutationReceipt;
  replacement: boolean;
  isCurrent: () => boolean;
  submitPatch: (payload: OutboxPayload, before: OutboxPayload) => Promise<MutationReceipt>;
}): (() => Promise<MutationReceipt>) | undefined {
  if (!input.previous || input.replacement) return undefined;
  const payload = fillupLifecyclePatch({ ...input.previous, version: (input.written.version ?? 0) + 1 });
  const before = fillupLifecyclePatch(input.written);
  const { receipt, isCurrent, submitPatch } = input;
  let submitted: Promise<MutationReceipt> | null = null;
  return () => {
    assertMutationScope(isCurrent);
    if (submitted) return submitted;
    const attempt = (async () => {
      const accepted = await receipt.settled;
      assertMutationScope(isCurrent);
      if (!accepted) throw Object.assign(new Error('העריכה לא אושרה — השינוי נשמר לבדיקה לפני ביטול'), {
        code: 'edit-unacknowledged',
      });
      return submitPatch(payload, before);
    })();
    submitted = attempt;
    // A pre-journal failure remains retryable. A returned failed receipt stays
    // with its original durable operation for explicit Outbox recovery.
    void attempt.catch(() => { if (submitted === attempt) submitted = null; });
    return attempt;
  };
}
