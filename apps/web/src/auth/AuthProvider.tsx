import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { SessionData } from '@sejuk/contracts/api';
import { apiRequest, ApiError } from '../api/client';
import { confirmLeave } from '../navigation';
import { recoveryStore } from './recovery';
import { handleAuthError, isAuthFailure, isCurrentAuthBinding, publishAuth, setAuthFailureHandler, setAuthPhase, type AuthBinding, type AuthLifecycleEvent, type AuthPhase } from './lifecycle';

type AuthContextValue={accountId:string|null;authGeneration:number;phase:AuthPhase;user:SessionData['user']|null;binding:AuthBinding;isCurrent:typeof isCurrentAuthBinding;handleAuthError:typeof handleAuthError;refreshSession:()=>Promise<void>;login:(credentials:{email:string;password:string})=>Promise<void>;logout:()=>Promise<void>};
const Context=createContext<AuthContextValue|null>(null);
export function useAuth(){const value=useContext(Context);if(!value)throw new Error('AuthProvider is required');return value;}
export function AuthProvider({children}:{children:ReactNode}) {
  const [state,setState]=useState<{phase:AuthPhase;user:SessionData['user']|null;generation:number}>({phase:'checking',user:null,generation:0});
  const current=useRef(state);
  const channel=useRef<BroadcastChannel|null>(null);
  const authBusy=useRef(false);
  const logoutIntent=useRef(false);
  const checking=useRef<AbortController|null>(null);
  function update(phase:AuthPhase,user=current.current.user,generation=current.current.generation){const next={phase,user,generation};current.current=next;setAuthPhase(phase);setState(next);}
  function invalidate(type:'suspend'|'destroy',reason:AuthLifecycleEvent['reason']):number {
    checking.current?.abort();
    const generation=current.current.generation+1;
    const binding={accountId:current.current.user?.id??null,authGeneration:generation};
    if(type==='destroy')recoveryStore.clear();
    // Lifecycle listeners run before React hides the DOM and before any later callback can commit.
    setAuthPhase('checking');
    publishAuth({type,reason,binding} as AuthLifecycleEvent);
    update('checking',type==='destroy'?null:current.current.user,generation);
    return generation;
  }
  async function verify(reason:'initialCheck'|'visibility'|'sessionChange'|'login',generation?:number):Promise<void> {
    if(logoutIntent.current)return;
    const previous=current.current.user?.id??null;
    const ownGeneration=generation??invalidate('suspend',reason);
    const controller=new AbortController();checking.current=controller;
    try {
      const data=await apiRequest<SessionData>('/auth/session',{signal:controller.signal});
      if(current.current.generation!==ownGeneration || logoutIntent.current)return;
      if(authBusy.current && reason!=='login')return;
      if(!data?.user?.id || data.user.role!=='admin')throw new Error('Invalid session response');
      if(previous && previous!==data.user.id){recoveryStore.clear();publishAuth({type:'destroy',reason:'accountChanged',binding:{accountId:previous,authGeneration:ownGeneration}});}
      update('authenticated',data.user,ownGeneration);
      publishAuth({type:'resume',reason,binding:{accountId:data.user.id,authGeneration:ownGeneration}});
    }catch(error){
      if(controller.signal.aborted || current.current.generation!==ownGeneration)return;
      if(error instanceof ApiError && error.code==='UNAUTHENTICATED'){
        publishAuth({type:'suspend',reason:'unauthenticated',binding:{accountId:previous,authGeneration:ownGeneration}});
        update(previous?'recovering':'anonymous');
      }else if(error instanceof ApiError && error.code==='FORBIDDEN'){
        recoveryStore.clear();publishAuth({type:'destroy',reason:'forbidden',binding:{accountId:previous,authGeneration:ownGeneration}});update('forbidden',null);
      }else update('unavailable');
    }
  }
  async function login(credentials:{email:string;password:string}) {
    if(authBusy.current)throw new Error('An authentication request is already pending.');
    authBusy.current=true;logoutIntent.current=false;
    const generation=invalidate('suspend','login');
    update(current.current.user?'recovering':'anonymous');
    try {
      await apiRequest<SessionData>('/auth/login',{method:'POST',body:JSON.stringify(credentials)});
      channel.current?.postMessage('session-change');
      // A stale callback cannot undo the cookie the browser already accepted.
      // Always verify after this successful response, never reuse a signal's older GET.
      if(!logoutIntent.current)await verify('login',current.current.generation===generation?generation:undefined);
    }catch(error){if(current.current.generation===generation || current.current.phase==='checking')update(current.current.user?'recovering':'anonymous');throw error;}
    finally{authBusy.current=false;}
  }
  async function logout(){
    if(authBusy.current)return;
    if(!logoutIntent.current && !await confirmLeave())return;
    authBusy.current=true;logoutIntent.current=true;
    const generation=invalidate('destroy','logout');update('signingOut',null,generation);
    channel.current?.postMessage('logout-started');
    try {await apiRequest<void>('/auth/logout',{method:'POST',body:'{}'});if(logoutIntent.current){update('anonymous',null);logoutIntent.current=false;channel.current?.postMessage('logout-confirmed');}}
    catch {if(logoutIntent.current)update('unconfirmedLogout',null);}
    finally{authBusy.current=false;}
  }
  useEffect(()=>{
    setAuthFailureHandler((error,captured)=>{
      if(!isAuthFailure(error) || !isCurrentAuthBinding(captured))return false;
      const forbidden=error instanceof ApiError && error.code==='FORBIDDEN';
      invalidate(forbidden?'destroy':'suspend',forbidden?'forbidden':'unauthenticated');
      update(forbidden?'forbidden':current.current.user?'recovering':'anonymous',forbidden?null:current.current.user);
      return true;
    });
    void verify('initialCheck');
    if(typeof BroadcastChannel!=='undefined'){
      channel.current=new BroadcastChannel('sejuk-auth');
      channel.current.onmessage=event=>{
        if(!['logout-started','logout-confirmed','session-change'].includes(event.data))return;
        if(event.data!=='session-change'){
          invalidate('destroy','remoteLogout');
          if(logoutIntent.current){update(authBusy.current?'signingOut':'unconfirmedLogout',null);return;}
        }
        if(!logoutIntent.current)void verify('sessionChange');
      };
    }
    const visible=()=>{if(document.visibilityState==='visible' && !authBusy.current && !logoutIntent.current)void verify('visibility');};
    document.addEventListener('visibilitychange',visible);
    return()=>{checking.current?.abort();channel.current?.close();document.removeEventListener('visibilitychange',visible);setAuthFailureHandler(()=>false);};
  },[]);
  const binding={accountId:state.user?.id??null,authGeneration:state.generation};
  return <Context.Provider value={{...binding,binding,phase:state.phase,user:state.user,isCurrent:isCurrentAuthBinding,handleAuthError,refreshSession:async()=>{logoutIntent.current=false;await verify('sessionChange');},login,logout}}>{children}</Context.Provider>;
}
