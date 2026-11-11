import { describe, expect, it } from 'vitest';
import { notificationLink, parseNotificationLink } from './link';

const parse = (url: string) => parseNotificationLink(new URL(url, 'https://app.test').searchParams);

describe('notification links', () => {
  it('carry the vehicle and the screen, whatever characters they hold', () => {
    const link = notificationLink('car with space', '/vehicle?doc=test&vehicle=car%20with%20space');
    expect(link.startsWith('/open?')).toBe(true);
    expect(parse(link)).toEqual({ vehicleId: 'car with space', to: '/vehicle?doc=test&vehicle=car%20with%20space' });
    expect(parse(notificationLink('v1', '/vehicle/reminders/p%2F1'))).toEqual({ vehicleId: 'v1', to: '/vehicle/reminders/p%2F1' });
  });
  it('refuse a missing part and any path that could leave the app', () => {
    for (const url of ['/open', '/open?vehicle=v1', '/open?to=%2Fvehicle', '/open?vehicle=v1&to=https%3A%2F%2Fevil.test', '/open?vehicle=v1&to=%2F%2Fevil.test',
      '/open?vehicle=v1&to=%2F%5Cevil.test', '/open?vehicle=v1&to=vehicle', '/open?vehicle=v1&to=%2Fa%0Ab'])
      expect(parse(url)).toBeNull();
  });
});
