import { ApiError } from '../api/client';
export type AuthPhase='checking'|'anonymous'|'authenticated'|'recovering'|'forbidden'|'unavailable'|'signingOut'|'unconfirmedLogout';
export type AuthBinding={accountId:string|null;authGeneration:number};
export type AuthLifecycleEvent=
  |{type:'suspend';reason:'initialCheck'|'visibility'|'sessionChange'|'unauthenticated'|'login';binding:AuthBinding}
  |{type:'destroy';reason:'accountChanged'|'forbidden'|'logout'|'remoteLogout';binding:AuthBinding}
  |{type:'resume';reason:'initialCheck'|'visibility'|'sessionChange'|'login';binding:{accountId:string;authGeneration:number}};
const listeners=new Set<(event:AuthLifecycleEvent)=>void>();
let binding:AuthBinding={accountId:null,authGeneration:0};
let phase:AuthPhase='checking';
let failureHandler:(error:unknown,captured:AuthBinding)=>boolean=()=>false;
export const subscribeAuthLifecycle=(listener:(event:AuthLifecycleEvent)=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
export function publishAuth(event:AuthLifecycleEvent){binding=event.binding;for(const listener of listeners)listener(event);}
export function setAuthPhase(value:AuthPhase){phase=value;}
export const getAuthBinding=():AuthBinding=>({...binding});
export const isCurrentAuthBinding=(captured:AuthBinding)=>phase==='authenticated' && captured.accountId===binding.accountId && captured.authGeneration===binding.authGeneration;
export function setAuthFailureHandler(handler:typeof failureHandler){failureHandler=handler;}
export const handleAuthError=(error:unknown,captured:AuthBinding)=>failureHandler(error,captured);
export const isAuthFailure=(error:unknown)=>error instanceof ApiError && ((error.status===401 && error.code==='UNAUTHENTICATED') || (error.status===403 && error.code==='FORBIDDEN'));
