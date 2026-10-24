import { beforeEach, describe, expect, it, vi } from 'vitest';
const auth=vi.hoisted(()=>({binding:{accountId:'50000000-0000-4000-8000-000000000001' as string|null,authGeneration:1},listeners:[] as Array<(event:{type:string})=>void>}));
vi.mock('../auth/index.js',()=>({isCurrentAuthBinding:(binding:typeof auth.binding)=>binding.accountId===auth.binding.accountId && binding.authGeneration===auth.binding.authGeneration,subscribeAuthLifecycle:(listener:(event:{type:string})=>void)=>{auth.listeners.push(listener);return()=>{};}}));
import { beginDetailVisit, clearDetailState, dismissCreation, endDetailVisit, rememberCreatedOrder } from './handoff.js';
const receipt={orderId:'30000000-0000-4000-8000-000000000001',orderNumber:'SO-000001',createdAt:'2026-10-23T07:40:00.000Z'};
beforeEach(()=>{clearDetailState();auth.binding={accountId:'50000000-0000-4000-8000-000000000001',authGeneration:1};});
describe('memory-only creation visits',()=>{
  it('claims once and remains identical across StrictMode replay and dismissal',()=>{
    rememberCreatedOrder(auth.binding,receipt);const first=beginDetailVisit(auth.binding,receipt.orderId,'stable');
    expect(beginDetailVisit(auth.binding,receipt.orderId,'stable')).toBe(first);dismissCreation('stable');
    expect(first.dismissed).toBe(true);expect(first.creationIntent).toBe(true);
    expect(beginDetailVisit(auth.binding,receipt.orderId,'other').receipt).toBeNull();
    endDetailVisit('stable');expect(beginDetailVisit(auth.binding,receipt.orderId,'stable').receipt).toBeNull();
  });
  it('rejects stale handoff and never transfers it across accounts',()=>{
    rememberCreatedOrder({...auth.binding,authGeneration:0},receipt);expect(beginDetailVisit(auth.binding,receipt.orderId,'one').receipt).toBeNull();
    rememberCreatedOrder(auth.binding,receipt);auth.binding.accountId='50000000-0000-4000-8000-000000000002';expect(beginDetailVisit(auth.binding,receipt.orderId,'two').receipt).toBeNull();
  });
  it('retains receipt through same-account generation changes but destroy clears it',()=>{
    rememberCreatedOrder(auth.binding,receipt);const first=beginDetailVisit(auth.binding,receipt.orderId,'visit');dismissCreation('visit');auth.binding.authGeneration++;
    expect(beginDetailVisit(auth.binding,receipt.orderId,'visit')).toBe(first);
    auth.listeners.forEach(listener=>listener({type:'destroy'}));expect(beginDetailVisit(auth.binding,receipt.orderId,'visit').receipt).toBeNull();
  });
});
