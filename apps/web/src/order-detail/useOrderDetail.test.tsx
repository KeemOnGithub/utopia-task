// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
const detailFixture={id:'30000000-0000-4000-8000-000000000001',orderNumber:'SO-000001',customerName:'Demo Customer A',phone:'0123',address:'Address',problemDescription:'Problem',serviceType:'repair',quotedPrice:{currency:'MYR',amount:'150.00'},assignedTechnician:{id:'10000000-0000-4000-8000-000000000001',name:'Ali'},adminNotes:null,status:'assigned',createdByAccountId:'50000000-0000-4000-8000-000000000001',assignedByAccountId:'50000000-0000-4000-8000-000000000001',createdAt:'2026-10-23T07:40:00.000Z',assignedAt:'2026-10-23T07:40:00.000Z'};
const mock=vi.hoisted(()=>({binding:{accountId:'50000000-0000-4000-8000-000000000001' as string|null,authGeneration:1},phase:'authenticated',listeners:new Set<(event:any)=>void>(),fetch:vi.fn()}));
vi.mock('../auth/index.js',()=>({
  useAuth:()=>({...mock.binding,phase:mock.phase}),getAuthBinding:()=>({...mock.binding}),
  isCurrentAuthBinding:(binding:typeof mock.binding)=>mock.phase==='authenticated' && binding.accountId===mock.binding.accountId && binding.authGeneration===mock.binding.authGeneration,
  handleAuthError:()=>false,subscribeAuthLifecycle:(listener:(event:any)=>void)=>{mock.listeners.add(listener);return()=>mock.listeners.delete(listener);},
}));
vi.mock('../api/order-detail.js',()=>({fetchOrderDetail:(...args:unknown[])=>mock.fetch(...args)}));
import { useOrderDetail } from './useOrderDetail.js';
import { clearDetailState, rememberCreatedOrder } from './handoff.js';
function lifecycle(type:string,reason:string){
  if(type==='suspend'){mock.binding.authGeneration++;mock.phase='checking';}else if(type==='resume')mock.phase='authenticated';
  act(()=>{mock.listeners.forEach(listener=>listener({type,reason,binding:{...mock.binding}}));});
}
beforeEach(()=>{clearDetailState();mock.fetch.mockReset();mock.phase='authenticated';mock.binding={accountId:'50000000-0000-4000-8000-000000000001',authGeneration:1};});
afterEach(cleanup);
describe('detail read lifecycle',()=>{
  it('retains ready snapshots without refetch for nondestructive gates; 401 refetches',async()=>{
    mock.fetch.mockResolvedValue(detailFixture);const {result}=renderHook(()=>useOrderDetail(detailFixture.id));
    await waitFor(()=>expect(result.current.state.kind).toBe('ready'));
    for(const reason of ['visibility','sessionChange','login']){lifecycle('suspend',reason);lifecycle('resume',reason);await waitFor(()=>expect(result.current.state.kind).toBe('ready'));}
    expect(mock.fetch).toHaveBeenCalledTimes(1);
    lifecycle('suspend','unauthenticated');expect(result.current.state.kind).toBe('loading');lifecycle('resume','login');await waitFor(()=>expect(mock.fetch).toHaveBeenCalledTimes(2));
  });
  it('restarts interrupted reads exactly once and ignores their late completion',async()=>{
    let complete!:(value:unknown)=>void;mock.fetch.mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;})).mockResolvedValue(detailFixture);
    const {result}=renderHook(()=>useOrderDetail(detailFixture.id));lifecycle('suspend','visibility');lifecycle('resume','visibility');
    await waitFor(()=>expect(result.current.state.kind).toBe('ready'));await act(async()=>complete({...detailFixture,customerName:'Stale'}));
    expect(mock.fetch).toHaveBeenCalledTimes(2);expect(result.current.state).toMatchObject({kind:'ready',order:{customerName:'Demo Customer A'}});
  });
  it('withholds receipt mismatches and retry verifies only the saved read',async()=>{
    rememberCreatedOrder(mock.binding,{orderId:detailFixture.id,orderNumber:detailFixture.orderNumber,createdAt:detailFixture.createdAt});
    mock.fetch.mockResolvedValueOnce({...detailFixture,orderNumber:'SO-000002'}).mockResolvedValue(detailFixture);
    const {result}=renderHook(()=>useOrderDetail(detailFixture.id));await waitFor(()=>expect(result.current.state.kind).toBe('consistencyError'));
    act(()=>result.current.retry());await waitFor(()=>expect(result.current.state.kind).toBe('ready'));expect(mock.fetch).toHaveBeenCalledTimes(2);
  });
  it('retains the consumed receipt through StrictMode replay',async()=>{
    rememberCreatedOrder(mock.binding,{orderId:detailFixture.id,orderNumber:detailFixture.orderNumber,createdAt:detailFixture.createdAt});mock.fetch.mockResolvedValue(detailFixture);
    const {result}=renderHook(()=>useOrderDetail(detailFixture.id),{wrapper:({children})=><StrictMode>{children}</StrictMode>});
    await waitFor(()=>expect(result.current.state.kind).toBe('ready'));expect(result.current.visit?.receipt?.orderNumber).toBe('SO-000001');
  });
  it('invalid IDs never request saved data',()=>{const {result}=renderHook(()=>useOrderDetail('SO-000001'));expect(result.current.state.kind).toBe('invalidLink');expect(mock.fetch).not.toHaveBeenCalled();});
});
