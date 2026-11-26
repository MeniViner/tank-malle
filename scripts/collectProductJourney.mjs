import { GoogleAuth } from 'google-auth-library';
import journey from '../src/lib/monitoring/journey.json' with { type: 'json' };

const property = 'properties/552217232';
const base = 'https://analyticsdata.googleapis.com';
const dateRanges = [{ startDate: '7daysAgo', endDate: 'yesterday' }];
const steps = Object.keys(journey.steps);
const writes = Object.keys(journey.writes);

async function query(token, version, method, request, keys, parse, observedOnly = false) {
  try {
    const response = await fetch(`${base}/${version}/${property}:${method}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000), body: JSON.stringify(method === 'runRealtimeReport' ? request : { dateRanges, ...request }),
    });
    if (!response.ok) return { status: response.status === 403 || response.status === 401 ? 'forbidden'
      : response.status === 429 ? 'limited' : 'unavailable' };
    const data = await response.json();
    const table = parse(data);
    const counts = observedOnly ? {} : Object.fromEntries(keys.map(k => [k, 0]));
    for (const row of table.rows ?? []) {
      const name = row.dimensionValues[0].value.replace(/^\d+\. /, '');
      const count = Number(row.metricValues[0].value);
      if (!keys.includes(name) || !Number.isSafeInteger(count) || count < 0) throw new Error('Invalid report');
      counts[name] = count;
    }
    const limited = Boolean(data.metadata?.subjectToThresholding || data.metadata?.samplingMetadatas?.length ||
      data.metadata?.samplingMetadata || data.metadata?.dataLossFromOtherRow);
    return { status: (observedOnly ? Object.keys(counts).length > 0 : Object.values(counts).some(n => n > 0)) ? 'ok' : 'empty', counts, limited };
  } catch {
    return { status: 'unavailable' };
  }
}

// The existing scheduled collector credential is also a Viewer on this GA4 property.
export async function collectProductJourney(credentials) {
  try {
    const auth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/analytics.readonly'] });
    const token = await auth.getAccessToken();
    if (token) return readJourney(token);
  } catch { /* Report missing credentials independently of the Cloud Monitoring job. */ }
  return { collectedAt: Date.now(), funnel: { status: 'forbidden' }, operations: { status: 'forbidden' }, recent: { status: 'forbidden' }, opens: { status: 'forbidden' }, traffic: { status: 'forbidden' } };
}

export async function readJourney(token) {
  const writeReport = {
    dimensions: [{ name: 'eventName' }], metrics: [{ name: 'eventCount' }],
    dimensionFilter: { filter: { fieldName: 'eventName', inListFilter: { values: writes } } },
  };
  const websiteReport = (keys, metrics) => ({
    dimensions: [{ name: 'eventName' }], metrics: metrics.map(name => ({ name })),
    dimensionFilter: { andGroup: { expressions: [
      { filter: { fieldName: 'hostName', inListFilter: { values: ['tank-malle.web.app', 'tank-malle.firebaseapp.com'] } } },
      { filter: { fieldName: 'eventName', inListFilter: { values: keys } } },
    ] } },
  });
  const counters = Object.keys(journey.traffic);
  const [funnel, operations, recent, opens, traffic] = await Promise.all([
    query(token, 'v1alpha', 'runFunnelReport', { funnel: { isOpenFunnel: false,
      steps: steps.map(name => ({ name, filterExpression: { funnelEventFilter: { eventName: name } } })),
    } }, steps, data => data.funnelTable),
    query(token, 'v1beta', 'runReport', writeReport, writes, data => data),
    query(token, 'v1beta', 'runRealtimeReport', writeReport, writes, data => data),
    query(token, 'v1beta', 'runReport', websiteReport(['usage_open'], ['eventCount']), ['usage_open'], data => data, true),
    query(token, 'v1beta', 'runReport', websiteReport(counters, ['eventValue', 'eventCount']), counters, data => data, true),
  ]);
  return { collectedAt: Date.now(), funnel, operations, recent, opens, traffic };
}
