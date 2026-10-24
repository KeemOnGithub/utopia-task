import {decodeListingCursor,type ListKind} from '@sejuk/contracts/listing-cursor';
import {isUuid} from '@sejuk/contracts/service-orders';
import {getAuthBinding,isCurrentAuthBinding,subscribeAuthLifecycle} from '../auth';
import {guardedNavigate} from '../navigation';
type Binding={accountId:string|null;authGeneration:number};
export type ListReturnContext={pathname:'/orders'|'/drafts';cursor:string|null;originatingItemId:string|null;scrollY:number};
export type OrderListReturn=ListReturnContext & {pathname:'/orders'};
export type DetailReturnIntent={kind:'newestOrders'}|{kind:'restoreOrders';context:OrderListReturn};
export type DraftReturnIntent={kind:'newestDrafts'}|{kind:'restoreDrafts';context:ListReturnContext};
const contexts=new Map<string,{accountId:string;context:ListReturnContext}>();
export const cursorHistories=new Map<string,(string|null)[]>();
export function validListContext(value:ListReturnContext):boolean{try{if(!['/orders','/drafts'].includes(value.pathname)||!Number.isFinite(value.scrollY)||value.scrollY<0||(value.originatingItemId!==null&&!isUuid(value.originatingItemId)))return false;if(value.cursor!==null)decodeListingCursor(value.cursor,value.pathname.slice(1) as ListKind);return true;}catch{return false;}}
export function rememberListReturn(binding:Binding,context:ListReturnContext):string {if(!binding.accountId||!isCurrentAuthBinding(binding)||!validListContext(context))return '';const key=crypto.randomUUID();contexts.set(key,{accountId:binding.accountId,context:{...context}});return key;}
export function resolveListReturn(binding:Binding,key:unknown):ListReturnContext|null{const stored=typeof key==='string'?contexts.get(key):null;return stored&&stored.accountId===binding.accountId?{...stored.context}:null;}
export function clearListNavigation():void{contexts.clear();cursorHistories.clear();}
subscribeAuthLifecycle(event=>{if(event.type==='destroy')clearListNavigation();});
function open(pathname:'/orders'|'/drafts',context?:ListReturnContext){const binding=getAuthBinding();const valid=context&&context.pathname===pathname&&validListContext(context)?context:{pathname,cursor:null,originatingItemId:null,scrollY:0};const key=rememberListReturn(binding,valid);void guardedNavigate(`${pathname}${valid.cursor?`?${new URLSearchParams({cursor:valid.cursor})}`:''}`,{state:key});}
export function openOrders(intent:DetailReturnIntent):void{open('/orders',intent.kind==='restoreOrders'?intent.context:undefined);}
export function openDrafts(intent:DraftReturnIntent):void{open('/drafts',intent.kind==='restoreDrafts'?intent.context:undefined);}
