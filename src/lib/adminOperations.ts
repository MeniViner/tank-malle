import { doc, getDocFromServer, type DocumentData, type DocumentSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import { nativeBuild } from './native/platform';
import { type BuildIdentity, parseBuildIdentity } from './appUpdates';

export const TANK_GITHUB = 'https://github.com/MeniViner/tank-malle';
export const TANK_FIREBASE = 'https://console.firebase.google.com/project/tank-malle';
export const TANK_CLOUD = 'https://console.cloud.google.com';
export const TANK_HOSTING = 'https://tank-malle.web.app';

export const productReports = [
  { label: 'Google Analytics', detail: 'כניסה, רכב ראשון, שמירה מקומית וסנכרון', href: 'https://analytics.google.com/analytics/web/#/p552217232/realtime/overview' },
  { label: 'Firebase Performance', detail: 'זמן שמירה מקומית וביצועי האפליקציה', href: TANK_FIREBASE + '/performance' },
  { label: 'Crashlytics', detail: 'קריסות בגרסאות המובייל המחוברות', href: TANK_FIREBASE + '/crashlytics' },
] as const;

export const JOBS = [
  { file: 'fuel-prices.yml', title: 'מחירי דלק', cadence: 'כל שעתיים' },
  { file: 'push-notifications.yml', title: 'התראות לטלפון', cadence: 'פעם ביום' },
  { file: 'scan-learn.yml', title: 'למידת סריקות', cadence: 'פעם ביום' },
  { file: 'admin-operations.yml', title: 'מדדי תפעול', cadence: 'כל 6 שעות' },
] as const;

export type Source<T> =
  | { status: 'ok'; value: T }
  | { status: 'empty' | 'forbidden' | 'limited' | 'unavailable' | 'disabled' };

interface Metric {
  status: 'ok' | 'empty' | 'forbidden' | 'unavailable';
  days?: (number | null)[];
  http?: number;
}
export interface ApiCall { service: string; method: string; code: string; count: number }
export interface ApiMetric extends Metric {
  calls?: ApiCall[];
  codes?: { code: string; count: number }[];
  breakdownSize?: number;
}
export interface OperationsSnapshot {
  collectedAt: number;
  end: number;
  metrics: { calls: ApiMetric; reads: Metric; writes: Metric; deletes: Metric; bandwidth: Metric };
}
export interface GithubRun {
  id: number;
  name: string;
  path: string;
  head_branch: string;
  head_sha: string;
  status: string;
  conclusion: string | null;
  run_started_at: string;
  updated_at: string;
}
export interface GithubIssue {
  number: number;
  title: string;
  updated_at: string;
  pull_request?: object;
}

const GITHUB_API = 'https://api.github.com/repos/MeniViner/tank-malle';
const REGISTRY = 'https://data.gov.il/api/3/action/datastore_search?resource_id=053cea08-09bc-40ec-8f7a-156f0677aff3&limit=0';

class HttpError extends Error {
  readonly status: number;
  readonly rateLimited: boolean;
  constructor(status: number, rateLimited: boolean) {
    super(`HTTP ${status}`);
    this.status = status;
    this.rateLimited = rateLimited;
  }
}

async function readJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, {
    signal, credentials: 'omit', cache: 'no-store', redirect: 'error',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new HttpError(response.status, response.headers.get('x-ratelimit-remaining') === '0');
  return response.json();
}

async function source<T>(read: () => Promise<T>): Promise<Source<T>> {
  try { return { status: 'ok', value: await read() }; }
  catch (error) {
    if (error instanceof HttpError && (error.rateLimited || error.status === 429)) return { status: 'limited' };
    if ((error as { code?: string })?.code === 'permission-denied') return { status: 'forbidden' };
    return { status: 'unavailable' };
  }
}

function withDeadline(parent: AbortSignal) {
  return AbortSignal.any([parent, AbortSignal.timeout(8000)]);
}

function serverDoc(path: [string, string], signal: AbortSignal) {
  return new Promise<DocumentSnapshot<DocumentData>>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    getDocFromServer(doc(db, ...path)).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

async function timed<T>(read: () => Promise<T>) {
  const start = performance.now();
  const value = await read();
  return { value, ms: Math.round(performance.now() - start) };
}

export function loadSystem(parent: AbortSignal) {
  return {
    hosting: nativeBuild ? Promise.resolve({ status: 'disabled' } as const)
      : source(() => timed(async () => parseBuildIdentity(await readJson('/build-info.json', withDeadline(parent))))),
    firestore: source(() => timed(async () => {
      const snapshot = await serverDoc(['appConfig', 'fuelPrices'], withDeadline(parent));
      const automation = snapshot.data()?.automation;
      return {
        hasConfig: snapshot.exists(),
        lastAttempt: finiteTime(automation?.lastAttemptAt),
        lastSuccess: finiteTime(automation?.lastSuccessAt),
        lastFailure: finiteTime(automation?.lastFailureAt),
      };
    })),
    registry: import.meta.env.VITE_LOCAL_CARE === '1' || import.meta.env.MODE === 'unified-preview'
      ? Promise.resolve({ status: 'disabled' } as const)
      : source(() => timed(async () => {
        const json = await readJson(REGISTRY, withDeadline(parent)) as { success?: boolean };
        if (json.success !== true) throw new Error('Invalid registry response');
      })),
  };
}

function finiteTime(value: unknown) {
  const time = typeof (value as { toMillis?: unknown })?.toMillis === 'function'
    ? (value as { toMillis(): number }).toMillis() : value;
  return typeof time === 'number' && Number.isFinite(time) && time > 0 && time < 8.64e15 ? time : null;
}

type JourneyReport = { status: 'ok' | 'empty' | 'limited' | 'forbidden' | 'unavailable'; counts?: Record<string, number>; limited?: boolean };
export interface JourneySnapshot { collectedAt: number; funnel: JourneyReport; operations: JourneyReport }

export async function loadJourney(parent: AbortSignal): Promise<Source<JourneySnapshot>> {
  const result = await source(async () => {
    const snapshot = await serverDoc(['adminOperations', 'journey'], withDeadline(parent));
    if (!snapshot.exists()) return null;
    const data = snapshot.data();
    if (!finiteTime(data?.collectedAt) || !data?.funnel?.status || !data?.operations?.status) throw new Error('Invalid journey report');
    return data as JourneySnapshot;
  });
  if (result.status !== 'ok') return result;
  return result.value ? { status: 'ok', value: result.value } : { status: 'empty' };
}

export async function loadOperations(parent: AbortSignal): Promise<Source<OperationsSnapshot>> {
  const result = await source(async () => {
    const snapshot = await serverDoc(['adminOperations', 'latest'], withDeadline(parent));
    if (!snapshot.exists()) return null;
    const data = snapshot.data();
    const keys = ['calls', 'reads', 'writes', 'deletes', 'bandwidth'];
    if (data?.version !== 1 || !finiteTime(data.end) || !finiteTime(data.collectedAt) ||
        keys.some(key => !['ok', 'empty', 'forbidden', 'unavailable'].includes(data.metrics?.[key]?.status))) {
      throw new Error('Invalid monitoring snapshot');
    }
    return data as OperationsSnapshot;
  });
  if (result.status !== 'ok') return result;
  return result.value ? { status: 'ok', value: result.value } : { status: 'empty' };
}

const disabledGithub = () => Promise.resolve({ status: 'disabled' } as const);
export function loadGithub(parent: AbortSignal) {
  const localOnly = import.meta.env.VITE_LOCAL_CARE === '1' || import.meta.env.MODE === 'unified-preview';
  const github = <T>(path: string, normalize: (data: unknown) => T) => localOnly ? disabledGithub()
    : source(async () => normalize(await readJson(`${GITHUB_API}/${path}`, withDeadline(parent))));
  const runs = (data: unknown) => {
    const entries = (data as { workflow_runs?: GithubRun[] }).workflow_runs;
    if (!Array.isArray(entries)) throw new Error('Invalid Actions response');
    return entries.filter(row => Number.isSafeInteger(row.id) && typeof row.name === 'string' && typeof row.path === 'string');
  };
  return {
    main: github('commits/main', data => {
      const row = data as { sha?: string; commit?: { message?: string; committer?: { date?: string } } };
      if (!row.sha || !/^[a-f0-9]{40}$/.test(row.sha)) throw new Error('Invalid commit');
      return { sha: row.sha, message: row.commit?.message?.split('\n')[0] ?? '', date: row.commit?.committer?.date };
    }),
    runs: github('actions/runs?per_page=16', runs),
    scheduled: github('actions/runs?branch=main&event=schedule&per_page=30', runs),
    issues: github('issues?state=open&sort=updated&direction=desc&per_page=20', data => {
      if (!Array.isArray(data)) throw new Error('Invalid issues response');
      return (data as GithubIssue[]).filter(row => Number.isSafeInteger(row.number) && typeof row.title === 'string');
    }),
  };
}

export type { BuildIdentity };
