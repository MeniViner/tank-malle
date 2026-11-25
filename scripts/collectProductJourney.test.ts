import { afterEach, expect, it, vi } from 'vitest';
import { collectProductJourney } from './collectProductJourney.mjs';

afterEach(() => vi.unstubAllGlobals());

it('keeps counts of ordered users separate from permission errors for event totals', async () => {
  const requests: string[] = [];
  vi.stubGlobal('fetch', async (url: string, options: RequestInit) => {
    requests.push(url);
    const payload = JSON.parse(String(options.body));
    if (url.endsWith(':generateAccessToken')) {
      expect(payload.scope).toEqual(['https://www.googleapis.com/auth/analytics.readonly']);
      return Response.json({ accessToken: 'fixture' });
    }
    if (url.endsWith(':runFunnelReport')) {
      expect(payload.funnel.isOpenFunnel).toBe(false);
      expect(payload.funnel.steps.at(-1).filterExpression.funnelEventFilter.eventName).toBe('first_action_saved');
      return Response.json({ funnelTable: { rows: [
        { dimensionValues: [{ value: '1. signin_viewed' }], metricValues: [{ value: '9' }] },
        { dimensionValues: [{ value: '6. first_action_saved' }], metricValues: [{ value: '2' }] },
      ] } });
    }
    return new Response(null, { status: 403 });
  });
  const result = await collectProductJourney('fixture');
  expect(requests).toHaveLength(3);
  expect(result.funnel).toMatchObject({ status: 'ok', counts: { signin_viewed: 9, first_action_saved: 2 } });
  expect(result.operations).toEqual({ status: 'forbidden' });
});
