import { expect,it } from 'vitest';
import { assertCareEnvironment } from './careEnvironment';
it('permits only demo emulators with exact local origin, requiring HTTPS on phones',()=>{
  expect(()=>assertCareEnvironment('demo-tankmaleh','1','','http://127.0.0.1:5283')).not.toThrow();
  expect(()=>assertCareEnvironment('demo-tankmaleh','1','https://192.168.1.9:5443','https://192.168.1.9:5443')).not.toThrow();
  for(const args of [['prod','1','','http://localhost:5283'],['demo-tankmaleh','0','','http://localhost:5283'],['demo-tankmaleh','1','','http://192.168.1.9:5443'],['demo-tankmaleh','1','http://192.168.1.9:5443','http://192.168.1.9:5443'],['demo-tankmaleh','1','https://public.example:5443','https://public.example:5443'],['demo-tankmaleh','1','https://192.168.1.9:5443','https://192.168.1.10:5443']]) expect(()=>assertCareEnvironment(...args as [string,string,string,string])).toThrow();
});
