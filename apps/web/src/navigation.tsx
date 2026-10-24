import { useEffect, useRef } from 'react';
import { Link, useBlocker, useNavigate, type LinkProps } from 'react-router-dom';
const guards=new Set<()=>Promise<boolean>>();
let navigateImpl:ReturnType<typeof useNavigate>|null=null;
let bypass=false;
let confirming:Promise<boolean>|null=null;
export function registerLeaveGuard(guard:()=>Promise<boolean>):()=>void {guards.add(guard);return()=>{guards.delete(guard);};}
export function confirmLeave():Promise<boolean>{
  if(confirming)return confirming;
  confirming=(async()=>{for(const guard of guards)if(!await guard())return false;return true;})().finally(()=>{confirming=null;});
  return confirming;
}
export async function guardedNavigate(to:string,options:{replace?:boolean;state?:unknown;bypassGuard?:boolean}={}):Promise<boolean>{
  if(!navigateImpl)return false;
  if(!options.bypassGuard && !await confirmLeave())return false;
  bypass=true;
  const state=typeof options.state==='string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(options.state)?options.state:undefined;
  try{await navigateImpl(to,{replace:options.replace,state});}finally{bypass=false;}
  return true;
}
export function NavigationBridge(){
  const navigate=useNavigate();navigateImpl=navigate;
  const blocker=useBlocker(()=>!bypass && guards.size>0);
  const pending=useRef(false);
  useEffect(()=>{
    if(blocker.state!=='blocked' || pending.current)return;
    pending.current=true;
    void confirmLeave().then(leave=>{if(leave)blocker.proceed();else blocker.reset();}).finally(()=>{pending.current=false;});
  },[blocker]);
  useEffect(()=>()=>{navigateImpl=null;},[]);
  return null;
}
export function GuardedLink({onClick,...props}:LinkProps){return <Link {...props} onClick={event=>{
  onClick?.(event);
  if(event.defaultPrevented || event.button!==0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || props.target==='_blank')return;
  event.preventDefault();
  const to=typeof props.to==='string'?props.to:`${props.to.pathname??''}${props.to.search??''}${props.to.hash??''}`;
  void guardedNavigate(to,{replace:props.replace,state:props.state});
}}/>;}
