import { expect,it } from 'vitest';
import { validateDeviceConfig,emulatorPort } from './care-device.mjs';
it('requires private IPv4 HTTPS and refuses control-plane/prod routes',()=>{
  expect(validateDeviceConfig({origin:'https://192.168.1.20:5443',cert:'cert.pem',key:'key.pem'}).port).toBe('5443');
  for(const origin of ['http://192.168.1.20:5443','https://example.com:5443','https://192.168.1.20','https://192.168.1.20:5443/path'])expect(()=>validateDeviceConfig({origin,cert:'cert.pem',key:'key.pem'})).toThrow();
  expect(emulatorPort('/google.firestore.v1.Firestore/Listen/channel?database=projects%2Fdemo-tankmaleh%2Fdatabases%2F(default)')).toBe(8080);
  expect(emulatorPort('/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=demo-api-key')).toBe(9099);
  expect(emulatorPort('/emulator/auth/handler')).toBe(9099);
  for(const path of ['/emulator/v1/projects/demo-tankmaleh/accounts','/v1/projects/production/databases/(default)/documents','/google.firestore.v1.Firestore/Write/channel?database=projects%2Fproduction%2Fdatabases%2F(default)'])expect(emulatorPort(path)).toBe(-1);
});
