import { useEffect, useRef, useState } from 'react';
import { isUuid, normalizeUuid } from '../../../../packages/contracts/src/service-orders.js';
import { OrderDetailConsistencyError, type OrderDetail } from '../../../../packages/contracts/src/order-detail.js';
import { fetchOrderDetail } from '../api/order-detail.js';
import { ApiError } from '../api/client.js';
import { getAuthBinding, handleAuthError, isCurrentAuthBinding, subscribeAuthLifecycle, useAuth } from '../auth/index.js';
import { beginDetailVisit, endDetailVisit, type DetailVisit } from './handoff.js';

export type DetailState =
  | {kind:'invalidLink'|'loading'}
  | {kind:'ready';order:OrderDetail}
  | {kind:'missing'|'loadError'|'consistencyError';message:string;retryAt:number;suppressReceipt?:boolean};
export function useOrderDetail(rawId:string) {
  const auth=useAuth();
  const id=isUuid(rawId)?normalizeUuid(rawId):null;
  const [state,setState]=useState<DetailState>({kind:id?'loading':'invalidLink'});
  const [visit,setVisit]=useState<DetailVisit|null>(null);
  const [focus,setFocus]=useState<{sequence:number;target:'detail'|'error'}|null>(null);
  const current=useRef<{id:string|null;state:DetailState;visit:DetailVisit|null;controller:AbortController|null;sequence:number;active:boolean;restart:boolean;retry:boolean;visitId:string;cleanup:number}>({id,state,visit:null,controller:null,sequence:0,active:false,restart:false,retry:false,visitId:crypto.randomUUID(),cleanup:0});
  const run=useRef<(explicit?:boolean)=>void>(()=>{});
  run.current=(explicit=false)=>{
    const store=current.current;
    const binding=getAuthBinding();
    if(!store.active || !store.id || !binding.accountId || !isCurrentAuthBinding(binding)) return;
    store.controller?.abort();
    const controller=new AbortController(); store.controller=controller;
    const sequence=++store.sequence; store.retry=explicit;store.restart=false;
    store.state={kind:'loading'};setState(store.state);
    let receiptMismatch=false;
    void fetchOrderDetail(store.id,controller.signal).then(order=>{
      if(!store.active || sequence!==store.sequence || !isCurrentAuthBinding(binding)) return;
      const receipt=store.visit?.receipt;
      if(receipt && (receipt.orderId!==order.id || receipt.orderNumber!==order.orderNumber || receipt.createdAt!==order.createdAt)){receiptMismatch=true;throw new OrderDetailConsistencyError();}
      store.state={kind:'ready',order};setState(store.state);
      if(explicit)setFocus({sequence,target:'detail'});
    }).catch((error:unknown)=>{
      if(!store.active || sequence!==store.sequence || controller.signal.aborted || !isCurrentAuthBinding(binding))return;
      if(handleAuthError(error,binding))return;
      const api=error instanceof ApiError?error:null;
      store.state=error instanceof OrderDetailConsistencyError
        ? {kind:'consistencyError',message:error.message,retryAt:0,suppressReceipt:receiptMismatch || error.mismatch}
        : api?.status===400 ? {kind:'invalidLink'}
         : {kind:api?.status===404?'missing':'loadError',message:api?.status===404?(store.visit?.receipt?'Order not found. Its saved details are not available.':'Order not found.'):'Could not load the service order. Try again.',retryAt:api?.retryAfterSeconds?Date.now()+api.retryAfterSeconds*1000:0};
      setState(store.state);if(explicit)setFocus({sequence,target:'error'});
    });
  };
  useEffect(()=>{
    const store=current.current;
    store.active=true;store.cleanup++;
    if(store.id!==id){endDetailVisit(store.visitId);store.visitId=crypto.randomUUID();store.id=id;store.visit=null;store.state={kind:id?'loading':'invalidLink'};setVisit(null);setState(store.state);}
    const binding=getAuthBinding();
    if(id && binding.accountId && isCurrentAuthBinding(binding)){
      store.visit=beginDetailVisit(binding,id,store.visitId);setVisit(store.visit);
      if(store.state.kind==='loading')run.current(store.retry);
    }
    const unsubscribe=subscribeAuthLifecycle(event=>{
      if(event.type==='suspend'){
        store.sequence++;store.controller?.abort();
        if(store.state.kind==='loading')store.restart=true;
        if(event.reason==='unauthenticated'){store.state={kind:'loading'};store.restart=true;setState(store.state);}
      }else if(event.type==='destroy'){
        store.sequence++;store.controller?.abort();store.visit=null;store.state={kind:'loading'};store.restart=true;setVisit(null);setState(store.state);
      }else if(store.active && store.id){
        store.visit=beginDetailVisit(event.binding,store.id,store.visitId);setVisit(store.visit);
        if(store.restart || store.state.kind==='loading')run.current(store.retry);
      }
    });
    return ()=>{
      unsubscribe();store.active=false;store.sequence++;store.controller?.abort();
      const cleanup=++store.cleanup;
      // StrictMode effect replay reclaims the visit before this microtask runs.
      queueMicrotask(()=>{if(!store.active && store.cleanup===cleanup)endDetailVisit(store.visitId);});
    };
  },[id]);
  const sameTarget=current.current.id===id;
  const visible=auth.phase==='authenticated' && (!visit || auth.accountId===visit.accountId);
  return {state:sameTarget?state:{kind:id?'loading':'invalidLink'} as DetailState,visit:sameTarget?visit:null,focus,visible,retry:()=>{if(current.current.state.kind!=='loading')run.current(true);},refreshVisit:()=>setVisit(current.current.visit?{...current.current.visit}:null)};
}
