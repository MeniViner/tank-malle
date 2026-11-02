import { useEffect, useState } from 'react';
import { cachedMarketPrice, MARKET_REFRESH_MS, refreshMarketPrice, type MarketPriceReading } from '../lib/prices/marketSource';

/** Display-only feed. It never writes fuel config or suggests receipt values. */
export function useMarketFuelPrice() {
  const [reading, setReading] = useState<MarketPriceReading | null>(() => cachedMarketPrice());
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    const refresh = async (force = false) => {
      setRefreshing(true);
      try {
        const value = await refreshMarketPrice(Date.now(), fetch, force);
        if (current) { setReading(value); setFailed(false); }
      } catch { if (current) setFailed(true); }
      finally { if (current) setRefreshing(false); }
    };
    void refresh(attempt > 0);
    const resume = () => { if (document.visibilityState === 'visible') void refresh(); };
    const online = () => { void refresh(); };
    const timer = window.setInterval(resume, MARKET_REFRESH_MS);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', online);
    return () => {
      current = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', online);
    };
  }, [attempt]);
  return { reading, refreshing, failed, refresh: () => setAttempt(n => n + 1) };
}
