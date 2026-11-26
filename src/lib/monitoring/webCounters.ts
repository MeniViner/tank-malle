import type { DocumentData, QuerySnapshot } from 'firebase/firestore';

export type WebCounter = 'web_firestore_docs' | 'web_firestore_http' | 'web_firebase_http' | 'web_lookup_http' | 'web_scan_http' | 'web_hosting_bytes';
export type Count = (name: WebCounter, value: number) => void;

const apiHosts = new Map<string, WebCounter>([
  ['firestore.googleapis.com', 'web_firestore_http'],
  ...['identitytoolkit.googleapis.com', 'securetoken.googleapis.com', 'firebaseappcheck.googleapis.com',
    'firebaseinstallations.googleapis.com'].map(host => [host, 'web_firebase_http'] as const),
  ['firebasevertexai.googleapis.com', 'web_scan_http'],
  ['tank-malle-owner-scan.meniviner.workers.dev', 'web_scan_http'],
  ...['data.gov.il', 'www.gov.il', 'r.jina.ai'].map(host => [host, 'web_lookup_http'] as const),
]);

export function resourceCount(entry: PerformanceResourceTiming, origin: string, count: Count) {
  let url: URL;
  try { url = new URL(entry.name); } catch { return; }
  if (url.protocol !== 'https:') return;
  if (url.origin === origin) {
    if (Number.isSafeInteger(entry.transferSize) && entry.transferSize >= 0) count('web_hosting_bytes', entry.transferSize);
    return;
  }
  const group = apiHosts.get(url.host);
  if (group) count(group, 1);
}

// Each listener counts the first confirmed result, then observed document changes.
// A cache-to-server transition may reuse local documents, so this is an estimate.
export function documentCounter(count: Count) {
  let initial = true;
  return (snapshot: QuerySnapshot<DocumentData>) => {
    if (snapshot.metadata.fromCache) { initial = true; return; }
    const docs = initial ? snapshot.docs : snapshot.docChanges().filter(change => change.type !== 'removed').map(change => change.doc);
    initial = false;
    const received = docs.filter(doc => !doc.metadata.hasPendingWrites).length;
    count('web_firestore_docs', received);
  };
}

export function observeWebTraffic(since: number, count: Count) {
  if (typeof PerformanceObserver === 'undefined') return () => {};
  const observer = new PerformanceObserver(list => {
    for (const entry of list.getEntries()) {
      if (entry.startTime >= since) resourceCount(entry as PerformanceResourceTiming, location.origin, count);
    }
  });
  for (const type of ['resource', 'navigation']) {
    try {
      if (PerformanceObserver.supportedEntryTypes?.includes(type)) observer.observe({ type, buffered: true });
    } catch { /* Some browsers only support a subset of entry types. */ }
  }
  return () => observer.disconnect();
}
