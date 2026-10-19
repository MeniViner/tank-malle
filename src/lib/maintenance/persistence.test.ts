import { expect, it } from 'vitest';
import { carePayloadMatches } from './persistence';
it('requires identical job and completion arrays, independent of object key order',()=>{
  expect(carePayloadMatches({version:1,jobs:['oil']},{jobs:['oil'],version:1})).toBe(true);
  expect(carePayloadMatches({version:1,jobs:['oil']},{version:1,jobs:['oil','tires']})).toBe(false);
  expect(carePayloadMatches({version:1,completedPlanIds:[]},{version:1,completedPlanIds:['oil']})).toBe(false);
  expect(carePayloadMatches({costAgorot:null},{costAgorot:0})).toBe(false);
});
