// @vitest-environment jsdom
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { act,cleanup,render,screen,waitFor } from '@testing-library/react';
import { AuthProvider,useAuth } from './AuthProvider';
import { getAuthBinding,handleAuthError,subscribeAuthLifecycle,type AuthLifecycleEvent } from './lifecycle';
import { apiRequest,ApiError } from '../api/client';
import { confirmLeave } from '../navigation';
import type { SessionData } from '@sejuk/contracts/api';
vi.mock('../api/client',async original=>({...await original<typeof import('../api/client')>(),apiRequest:vi.fn()}));
vi.mock('../navigation',()=>({confirmLeave:vi.fn(async()=>true)}));
const request=vi.mocked(apiRequest);
const session=(id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'):SessionData=>({user:{id,email:`${id[0]}@example.test`,role:'admin'},expiresAt:'2026-10-24T00:00:00.000Z'});
let auth:ReturnType<typeof useAuth>;
function Probe(){auth=useAuth();return <div data-testid="phase">{auth.phase}</div>;}
function deferred<T>(){let resolve!:(value:T)=>void;let reject!:(error:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
beforeEach(()=>{vi.stubGlobal('BroadcastChannel',undefined);request.mockReset();vi.mocked(confirmLeave).mockResolvedValue(true);});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe('auth lifecycle bindings',()=>{
  it('suspends synchronously during visibility checks, rebinds same identity, and ignores old auth failures',async()=>{
    request.mockResolvedValueOnce(session());render(<AuthProvider><Probe/></AuthProvider>);
    await waitFor(()=>expect(screen.getByTestId('phase').textContent).toBe('authenticated'));
    const captured=getAuthBinding();const events:AuthLifecycleEvent[]=[];const stop=subscribeAuthLifecycle(event=>events.push(event));
    const check=deferred<SessionData>();request.mockReturnValueOnce(check.promise);
    act(()=>{void auth.refreshSession();});
    expect(events[0]?.type).toBe('suspend');expect(screen.getByTestId('phase').textContent).toBe('checking');
    await act(async()=>check.resolve(session()));
    expect(auth.phase).toBe('authenticated');expect(auth.authGeneration).toBeGreaterThan(captured.authGeneration);expect(events.at(-1)?.type).toBe('resume');
    expect(handleAuthError(new ApiError(401,'UNAUTHENTICATED','Expired'),captured)).toBe(false);expect(auth.phase).toBe('authenticated');stop();
  });
  it('deduplicates 401 transitions and restores only after fresh post-login verification',async()=>{
    request.mockResolvedValueOnce(session());render(<AuthProvider><Probe/></AuthProvider>);await waitFor(()=>expect(auth.phase).toBe('authenticated'));
    const captured=getAuthBinding();const events:AuthLifecycleEvent[]=[];const stop=subscribeAuthLifecycle(event=>events.push(event));
    act(()=>{expect(handleAuthError(new ApiError(401,'UNAUTHENTICATED','Expired'),captured)).toBe(true);expect(handleAuthError(new ApiError(401,'UNAUTHENTICATED','Expired'),captured)).toBe(false);});
    expect(auth.phase).toBe('recovering');expect(events).toHaveLength(1);
    const verified=deferred<SessionData>();request.mockResolvedValueOnce(session()).mockReturnValueOnce(verified.promise);
    let login!:Promise<void>;act(()=>{login=auth.login({email:'a@example.test',password:'password'});});
    await waitFor(()=>expect(request).toHaveBeenLastCalledWith('/auth/session',expect.anything()));expect(auth.phase).not.toBe('authenticated');
    await act(async()=>{verified.resolve(session());await login;});expect(auth.phase).toBe('authenticated');stop();
  });
  it('retains private account binding during unavailable verification and destroys before account change resume',async()=>{
    request.mockResolvedValueOnce(session());render(<AuthProvider><Probe/></AuthProvider>);await waitFor(()=>expect(auth.phase).toBe('authenticated'));
    const events:AuthLifecycleEvent[]=[];const stop=subscribeAuthLifecycle(event=>events.push(event));
    request.mockRejectedValueOnce(new TypeError('network'));await act(async()=>auth.refreshSession());expect(auth.phase).toBe('unavailable');expect(auth.accountId).toBe(session().user.id);
    request.mockResolvedValueOnce(session('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'));await act(async()=>auth.refreshSession());
    const destroyIndex=events.findIndex(event=>event.type==='destroy');expect(destroyIndex).toBeGreaterThan(-1);expect(events[destroyIndex]?.reason).toBe('accountChanged');expect(events[destroyIndex+1]?.type).toBe('resume');stop();
  });
  it('does not reinterpret credential or CSRF failures as access denial',async()=>{
    request.mockResolvedValueOnce(session());render(<AuthProvider><Probe/></AuthProvider>);await waitFor(()=>expect(auth.phase).toBe('authenticated'));
    const binding=getAuthBinding();expect(handleAuthError(new ApiError(403,'CSRF_REJECTED','Origin'),binding)).toBe(false);expect(auth.phase).toBe('authenticated');
    request.mockRejectedValueOnce(new ApiError(401,'INVALID_CREDENTIALS','Invalid email or password.'));
    await act(async()=>{await expect(auth.login({email:'a@example.test',password:'wrong password'})).rejects.toThrow('Invalid email or password.');});
    expect(auth.phase).toBe('recovering');expect(auth.accountId).toBe(binding.accountId);
  });
  it('consults guard before logout and keeps failed logout intent hidden until explicit retry',async()=>{
    request.mockResolvedValueOnce(session());render(<AuthProvider><Probe/></AuthProvider>);await waitFor(()=>expect(auth.phase).toBe('authenticated'));
    vi.mocked(confirmLeave).mockResolvedValueOnce(false);await act(async()=>auth.logout());expect(auth.phase).toBe('authenticated');expect(request).toHaveBeenCalledTimes(1);
    const events:AuthLifecycleEvent[]=[];const stop=subscribeAuthLifecycle(event=>events.push(event));
    request.mockRejectedValueOnce(new TypeError('network'));await act(async()=>auth.logout());expect(auth.phase).toBe('unconfirmedLogout');expect(events[0]?.type).toBe('destroy');
    document.dispatchEvent(new Event('visibilitychange'));expect(auth.phase).toBe('unconfirmedLogout');expect(request).toHaveBeenCalledTimes(2);
    request.mockResolvedValueOnce(undefined);await act(async()=>auth.logout());expect(auth.phase).toBe('anonymous');expect(vi.mocked(confirmLeave)).toHaveBeenCalledTimes(2);stop();
  });
  it('freshly verifies a delayed successful login even after a sibling signal superseded its generation',async()=>{
    class Channel {
      static last:Channel;onmessage:((event:{data:string})=>void)|null=null;
      constructor(){Channel.last=this;}
      postMessage=vi.fn();close=vi.fn();
    }
    vi.stubGlobal('BroadcastChannel',Channel);
    request.mockResolvedValueOnce(session());render(<AuthProvider><Probe/></AuthProvider>);await waitFor(()=>expect(auth.phase).toBe('authenticated'));
    const events:AuthLifecycleEvent[]=[];const stop=subscribeAuthLifecycle(event=>events.push(event));
    const loginResponse=deferred<SessionData>();request.mockReturnValueOnce(loginResponse.promise);
    let login!:Promise<void>;act(()=>{login=auth.login({email:'b@example.test',password:'password'});});
    const loginGeneration=auth.authGeneration;
    request.mockResolvedValueOnce(session());
    await act(async()=>{Channel.last.onmessage?.({data:'session-change'});});
    expect(auth.authGeneration).toBeGreaterThan(loginGeneration);expect(auth.phase).not.toBe('authenticated');
    request.mockResolvedValueOnce(session('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'));
    await act(async()=>{loginResponse.resolve(session('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'));await login;});
    expect(request.mock.calls.map(call=>call[0])).toEqual(['/auth/session','/auth/login','/auth/session','/auth/session']);
    expect(auth.phase).toBe('authenticated');expect(auth.accountId).toBe('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
    expect(events.some(event=>event.type==='destroy' && event.reason==='accountChanged')).toBe(true);expect(Channel.last.postMessage).toHaveBeenCalledWith('session-change');stop();
  });
  it('admits manager session and destroys prior privileged state when role changes',async()=>{
    const managerSession: SessionData = { user: { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', email: 'm@example.test', role: 'manager' }, expiresAt: '2026-10-24T00:00:00.000Z' };
    request.mockResolvedValueOnce(session());
    render(<AuthProvider><Probe/></AuthProvider>);
    await waitFor(()=>expect(auth.phase).toBe('authenticated'));
    expect(auth.user?.role).toBe('admin');
    const events:AuthLifecycleEvent[]=[];const stop=subscribeAuthLifecycle(event=>events.push(event));
    request.mockResolvedValueOnce(managerSession);
    await act(async()=>auth.refreshSession());
    expect(auth.phase).toBe('authenticated');
    expect(auth.user?.role).toBe('manager');
    const destroyIndex=events.findIndex(event=>event.type==='destroy');
    expect(destroyIndex).toBeGreaterThan(-1);
    expect(events[destroyIndex]?.reason).toBe('roleChanged');
    stop();
  });
});
