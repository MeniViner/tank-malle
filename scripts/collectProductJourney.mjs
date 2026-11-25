import journey from '../src/lib/monitoring/journey.json' with { type: 'json' };

const property = 'properties/552217232';
const base = 'https://analyticsdata.googleapis.com';
const dateRanges = [{ startDate: '7daysAgo', endDate: 'yesterday' }];
const steps = Object.keys(journey.steps);
const writes = Object.keys(journey.writes);

async function query(token, version, method, request, keys, parse) {
  try {
    const response = await fetch(`${base}/${version}/${property}:${method}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000), body: JSON.stringify({ dateRanges, ...request }),
    });
    if (!response.ok) return { status: response.status === 403 || response.status === 401 ? 'forbidden'
      : response.status === 429 ? 'limited' : 'unavailable' };
    const data = await response.json();
    const table = parse(data);
    const counts = Object.fromEntries(keys.map(k => [k, 0]));
    for (const row of table.rows ?? []) {
      const name = row.dimensionValues[0].value.replace(/^\d+\. /, '');
      const count = Number(row.metricValues[0].value);
      if (!keys.includes(name) || !Number.isSafeInteger(count) || count < 0) throw new Error('Invalid report');
      counts[name] = count;
    }
    const limited = Boolean(data.metadata?.subjectToThresholding || data.metadata?.samplingMetadatas?.length ||
      data.metadata?.samplingMetadata || data.metadata?.dataLossFromOtherRow);
    return { status: Object.values(counts).some(n => n > 0) ? 'ok' : 'empty', counts, limited };
  } catch {
    return { status: 'unavailable' };
  }
}

// Only aggregated counts enter Firestore.
export async function collectProductJourney(cloudToken) {
  // The main-branch scheduler can impersonate this report-only identity without a private key.
  let token;
  try {
    const response = await fetch('https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/journey-reports@tank-malle.iam.gserviceaccount.com:generateAccessToken', {
      method: 'POST', headers: { Authorization: `Bearer ${cloudToken}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ scope: ['https://www.googleapis.com/auth/analytics.readonly'], lifetime: '300s' }),
    });
    if (!response.ok) return missing(response.status === 403 || response.status === 401 ? 'forbidden' : 'unavailable');
    token = (await response.json()).accessToken;
    if (!token) return missing('unavailable');
  } catch { return missing('unavailable'); }
  return readJourney(token);
}

function missing(status) {
  return { collectedAt: Date.now(), funnel: { status }, operations: { status } };
}

export async function readJourney(token) {
  const [funnel, operations] = await Promise.all([
    query(token, 'v1alpha', 'runFunnelReport', { funnel: { isOpenFunnel: false,
      steps: steps.map(name => ({ name, filterExpression: { funnelEventFilter: { eventName: name } } })),
    } }, steps, data => data.funnelTable),
    query(token, 'v1beta', 'runReport', {
      dimensions: [{ name: 'eventName' }], metrics: [{ name: 'eventCount' }],
      dimensionFilter: { filter: { fieldName: 'eventName', inListFilter: { values: writes } } },
    }, writes, data => data),
  ]);
  return { collectedAt: Date.now(), funnel, operations };
}
