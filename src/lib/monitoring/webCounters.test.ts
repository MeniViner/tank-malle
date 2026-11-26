import { expect, it, vi } from 'vitest';
import type { DocumentData, QuerySnapshot } from 'firebase/firestore';
import { documentCounter, resourceCount } from './webCounters';

it('reports only fixed categories and measures cached zero bytes', () => {
  const count = vi.fn();
  const origin = 'https://tank-malle.web.app';
  for (const name of [origin + '/asset', 'https://firestore.googleapis.com/private?token=secret',
    'https://firestore.googleapis.com.example.org/listen']) {
    resourceCount({ name, transferSize: 0 } as PerformanceResourceTiming, origin, count);
  }
  expect(count.mock.calls).toEqual([['web_hosting_bytes', 0], ['web_firestore_http', 1]]);
});

it('uses initial confirmed documents and later changes without local writes or deletes', () => {
  const count = vi.fn();
  const receive = documentCounter(count);
  const docs = [false, true, false].map(hasPendingWrites => ({ metadata: { hasPendingWrites } }));
  const snapshot = { metadata: { fromCache: true }, docs,
    docChanges: () => [{ type: 'removed', doc: docs[0] }, { type: 'modified', doc: docs[2] }] };
  for (const fromCache of [true, false, false]) {
    snapshot.metadata.fromCache = fromCache;
    receive(snapshot as unknown as QuerySnapshot<DocumentData>);
  }
  expect(count.mock.calls).toEqual([['web_firestore_docs', 2], ['web_firestore_docs', 1]]);
});
