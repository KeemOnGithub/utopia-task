import { describe,expect,it } from 'vitest';
import { resolveDetailReturn } from './navigation.js';
describe('detail return intent',()=>{
  const context={pathname:'/orders',cursor:null,originatingItemId:'30000000-0000-4000-8000-000000000001',scrollY:100};
  it('restores valid private context, while creation always wins',()=>{expect(resolveDetailReturn(false,context)).toEqual({kind:'restoreOrders',context});expect(resolveDetailReturn(true,context)).toEqual({kind:'newestOrders'});});
  it.each([null,{}, {...context,pathname:'https://evil.test'}, {...context,cursor:'forged'}, {...context,scrollY:NaN},{...context,scrollY:-1},{...context,originatingItemId:'SO-000001'}])('rejects malformed context %j',value=>{expect(resolveDetailReturn(false,value)).toEqual({kind:'newestOrders'});});
});
