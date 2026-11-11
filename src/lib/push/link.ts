/**
 * A phone notification can be about any of the account's vehicles, while the app's
 * screens show the active one. Its link therefore goes through /open, which selects
 * the vehicle first and then continues to the screen (src/screens/OpenNotification.tsx).
 */
export function notificationLink(vehicleId: string, to: string): string {
  return `/open?vehicle=${encodeURIComponent(vehicleId)}&to=${encodeURIComponent(to)}`;
}

/** The vehicle and in-app path of a notification link; null when either is missing or the path could leave the app. */
export function parseNotificationLink(params: URLSearchParams): { vehicleId: string; to: string } | null {
  const vehicleId = params.get('vehicle'), to = params.get('to');
  if (!vehicleId || !to || !/^\/(?![/\\])/.test(to) || [...to].some(ch => ch === '\\' || ch.charCodeAt(0) < 32)) return null;
  return { vehicleId, to };
}
