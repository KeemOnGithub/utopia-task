import {useEffect,useRef,useState} from 'react';
import {useLocation,useNavigate} from 'react-router-dom';
import type {Page} from '@sejuk/contracts/listings';
import {decodeListingCursor,type ListKind} from '@sejuk/contracts/listing-cursor';
import {useAuth,subscribeAuthLifecycle} from '../auth';
import {ApiError} from '../api/client';
import {cursorHistories,resolveListReturn} from './navigation';
type Intent={cursor:string|null;kind:'entry'|'next'|'previous'|'newest';history:(string|null)[]};
export function useListing<T>(kind:ListKind,fetchPage:(cursor:string|null,signal:AbortSignal)=>Promise<Page<T>>){
 const auth=useAuth(),location=useLocation(),navigate=useNavigate();
 const [state,setState]=useState<{page:Page<T>|null;cursor:string|null;loading:boolean;error:string|null;invalid:boolean;message:string;blockedNext:boolean;retryAt:number}>({page:null,cursor:null,loading:true,error:null,invalid:false,message:'',blockedNext:false,retryAt:0});
 const [,tick]=useState(0);const sequence=useRef(0),controller=useRef<AbortController|null>(null),pending=useRef<Intent|null>(null),failed=useRef<Intent|null>(null),history=useRef<(string|null)[]>([]),stateRef=useRef(state),runRef=useRef<(intent:Intent)=>void>(()=>{});stateRef.current=state;
 const heading=useRef<HTMLHeadingElement>(null);const needsResume=useRef(false);const committedNavigation=useRef<{cursor:string|null}|null>(null);
 function run(intent:Intent){
  if(auth.phase!=='authenticated')return;
  controller.current?.abort();const abort=new AbortController();controller.current=abort;const id=++sequence.current;const captured={...auth.binding};pending.current=intent;failed.current=null;
  setState(s=>({...s,loading:true,error:null,message:`Loading ${kind==='orders'?'service orders':'drafts'}...`}));
  void fetchPage(intent.cursor,abort.signal).then(page=>{
   if(id!==sequence.current||!auth.isCurrent(captured)||abort.signal.aborted)return;
   pending.current=null;
   if(intent.kind==='next'&&!page.items.length){setState(s=>({...s,loading:false,blockedNext:true,message:`No more ${kind}`}));return;}
   history.current=intent.history;cursorHistories.set(`${captured.accountId}:${kind}:${intent.cursor??''}`,intent.history);
   setState({page,cursor:intent.cursor,loading:false,error:null,invalid:false,message:`${page.items.length} ${kind==='orders'?'service orders':'drafts'} loaded`,blockedNext:false,retryAt:0});
   if(intent.kind!=='entry'){committedNavigation.current={cursor:intent.cursor};navigate({pathname:`/${kind}`,search:intent.cursor?`?${new URLSearchParams({cursor:intent.cursor})}`:''},{replace:intent.kind==='newest'});}
   requestAnimationFrame(()=>{if(id!==sequence.current||!auth.isCurrent(captured))return;const restore=resolveListReturn(captured,location.state);if(intent.kind==='entry'&&restore&&(restore.originatingItemId!==null||restore.scrollY>0)){const item=restore.originatingItemId?document.getElementById(`list-item-${restore.originatingItemId}`):null;if(item){item.focus({preventScroll:true});window.scrollTo(0,restore.scrollY);}else{heading.current?.focus();heading.current?.scrollIntoView();}}else if(intent.kind==='next'||intent.kind==='previous'){heading.current?.focus();heading.current?.scrollIntoView();}});
  }).catch((error:unknown)=>{
   if(id!==sequence.current||abort.signal.aborted||!auth.isCurrent(captured))return;
   failed.current=intent;
   if(auth.handleAuthError(error,captured))return;
   pending.current=null;
   const invalid=error instanceof ApiError&&error.status===400;
   const seconds=error instanceof ApiError&&error.status===429?error.retryAfterSeconds??1:0;
   setState(s=>({...s,loading:false,invalid,error:invalid?'This list location is no longer valid. Return to the newest page.':`Could not load ${kind==='orders'?'service orders':'drafts'}. Try again.${seconds?' Wait before retrying.':''}`,retryAt:Date.now()+seconds*1000,message:''}));
  });
 }
 runRef.current=run;
 useEffect(()=>{const query=new URLSearchParams(location.search);const values=query.getAll('cursor');const cursor:string|null=values[0]??null;try{if([...query.keys()].some(k=>k!=='cursor')||values.length>1)throw Error();if(cursor!==null)decodeListingCursor(cursor,kind);}catch{++sequence.current;controller.current?.abort();pending.current=null;setState(s=>({...s,page:null,loading:false,invalid:true,error:'This list location is no longer valid. Return to the newest page.'}));return;}
  if(committedNavigation.current?.cursor===cursor){committedNavigation.current=null;return;}
  history.current=cursorHistories.get(`${auth.accountId}:${kind}:${cursor??''}`)??[];
  runRef.current({cursor,kind:'entry',history:history.current});
 },[location.key,kind]);
 useEffect(()=>subscribeAuthLifecycle(event=>{
  if(event.type==='suspend'){++sequence.current;controller.current?.abort();if(event.reason==='unauthenticated'){setState(s=>({...s,page:null}));if(!pending.current)pending.current={cursor:stateRef.current.cursor,kind:'entry',history:history.current};}needsResume.current=!!pending.current;}
  if(event.type==='destroy'){++sequence.current;controller.current?.abort();pending.current=null;failed.current=null;history.current=[];needsResume.current=true;setState({page:null,cursor:null,loading:false,error:null,invalid:false,message:'',blockedNext:false,retryAt:0});}
  if(event.type==='resume')needsResume.current=needsResume.current||!!pending.current||!stateRef.current.page;
 }),[]);
 useEffect(()=>{if(auth.phase==='authenticated'&&needsResume.current){needsResume.current=false;const cursor=new URLSearchParams(location.search).get('cursor');try{if(cursor!==null)decodeListingCursor(cursor,kind);}catch{setState(s=>({...s,page:null,loading:false,invalid:true,error:'This list location is no longer valid. Return to the newest page.'}));return;}runRef.current(pending.current??{cursor,kind:'entry',history:history.current});}},[auth.phase,auth.authGeneration]);
 useEffect(()=>()=>{++sequence.current;controller.current?.abort();},[]);
 useEffect(()=>{if(state.retryAt>Date.now()){const timer=setTimeout(()=>tick(n=>n+1),state.retryAt-Date.now());return()=>clearTimeout(timer);}},[state.retryAt]);
 return {state,heading,canPrevious:history.current.length>0,retryDisabled:state.retryAt>Date.now(),retry:()=>{if(failed.current)run(failed.current);},newest:()=>run({cursor:null,kind:'newest',history:[]}),next:()=>{if(state.page?.pagination.nextCursor)run({cursor:state.page.pagination.nextCursor,kind:'next',history:[...history.current,state.cursor]});},previous:()=>{if(history.current.length)run({cursor:history.current.at(-1)!,kind:'previous',history:history.current.slice(0,-1)});}};
}
