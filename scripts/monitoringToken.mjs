const provider = 'projects/157993868783/locations/global/workloadIdentityPools/tank-malle-ops/providers/github';

async function readToken(response, field, providerName) {
  const payload = await response.json();
  if (!response.ok || typeof payload[field] !== 'string' || !payload[field]) {
    throw new Error(`${providerName} token unavailable (HTTP ${response.status})`);
  }
  return payload[field];
}

/** The provider accepts this repository's main-branch monitoring workflow only. */
export async function monitoringToken() {
  const endpoint = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
  const credential = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (endpoint.protocol !== 'https:' || !credential) throw new Error('GitHub workload credentials are unavailable');
  endpoint.searchParams.set('audience', `https://iam.googleapis.com/${provider}`);
  const github = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${credential}` },
    signal: AbortSignal.timeout(10_000),
    redirect: 'error',
  });
  const subject = await readToken(github, 'value', 'GitHub');
  const google = await fetch('https://sts.googleapis.com/v1/token', {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      audience: `//iam.googleapis.com/${provider}`,
      requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
      subject_token: subject,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
    }),
    signal: AbortSignal.timeout(10_000),
    redirect: 'error',
  });
  return readToken(google, 'access_token', 'Cloud Monitoring workload');
}
