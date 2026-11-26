import { afterEach, expect, it, vi } from 'vitest';
import type { Gray } from './engine/image';

const mocks = vi.hoisted(() => ({
  auth: { currentUser: { uid: 'owner', emailVerified: true, getIdTokenResult: vi.fn() } },
  getConsoleAccess: vi.fn(), getToken: vi.fn(), getAI: vi.fn(),
}));
vi.mock('../firebase', () => ({ app: {}, auth: mocks.auth }));
vi.mock('../ownerConsole', () => ({ getConsoleAccess: mocks.getConsoleAccess }));
vi.mock('../native/platform', () => ({ nativeBuild: false }));
vi.mock('./cloudPilot', () => ({ cloudPilot: false, ownerCloudBuild: true, webAttestationKey: 'test' }));
vi.mock('firebase/ai', () => ({ getAI: mocks.getAI }));
vi.mock('firebase/app-check', () => ({
  initializeAppCheck: () => ({}), getToken: mocks.getToken, ReCaptchaEnterpriseProvider: class {},
}));

afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

it('public scans send a crop only for the enrolled Google owner and only through the owner service', async () => {
  const { cloudScan } = await import('./cloudScan');
  vi.stubGlobal('navigator', { onLine: true });
  const send = vi.fn(async () => new Response('{"odometer":"123456"}'));
  vi.stubGlobal('fetch', send);
  vi.stubGlobal('document', { createElement: () => ({
    getContext: () => ({ createImageData: () => ({ data: new Uint8ClampedArray(4) }), putImageData: () => {} }),
    toDataURL: () => 'data:image/jpeg;base64,AQ==',
  }) });
  const generated = vi.fn();
  const read = () => cloudScan('odometer', { width: 1, height: 1, data: new Uint8Array([0]) } as Gray,
    {}, new AbortController().signal, generated);
  mocks.auth.currentUser.getIdTokenResult.mockResolvedValue({ claims: { admin: true }, signInProvider: 'google.com', token: 'fixture' });
  mocks.getConsoleAccess.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  mocks.getToken.mockResolvedValue({ token: 'attestation' });
  expect(await read()).toBeUndefined();
  expect(mocks.getToken).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
  expect(await read()).toEqual({ odometer: '123456' });
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith('https://tank-malle-owner-scan.meniviner.workers.dev/scan/odometer', expect.objectContaining({ method: 'POST' }));
  expect(generated).toHaveBeenCalledTimes(1);
  expect(mocks.getAI).not.toHaveBeenCalled();
});
