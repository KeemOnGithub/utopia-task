import { useEffect,useRef,useState } from 'react';
import { useLocation,useParams } from 'react-router-dom';
import { isUuid,type OrderCreatedResult } from '@sejuk/contracts/service-orders';
import { draftEditPath,type DraftSavedResult,type DraftDeletedResult,type DraftWriteRequest,type DraftUpdateRequest,type DraftDeleteRequest,type CreateOrderRequest,type SubmitDraftRequest,type EditorConflictCode,type OperationCheck } from '@sejuk/contracts/drafts';
import * as api from '../api/order-editor.js';
import { ApiError } from '../api/client.js';
import { useAuth,subscribeAuthLifecycle,isCurrentAuthBinding,recoveryStore } from '../auth/index.js';
import { GuardedLink,guardedNavigate } from '../navigation.js';
import { rememberCreatedOrder } from '../order-detail/handoff.js';
import { openDrafts,resolveListReturn } from '../listings/navigation.js';
import { OrderForm,type TechnicianState } from '../order-editor/OrderForm.js';
import { editorReducer,initialEditorState,dirtyFields,type EditorState,type EditorEvent,type Pending } from '../order-editor/state.js';
import { orderFields,validateFields } from '../order-editor/validation.js';
import { captureEditor,restoreEditor } from '../order-editor/recovery.js';
import { EditorConfirmation,confirmEditor,useEditorGuard } from '../order-editor/navigation.js';

export function CreateOrderPage(){
 const {draftId:routeDraftId}=useParams();const location=useLocation();const auth=useAuth();
 const validRoute=!routeDraftId||isUuid(routeDraftId);const routeId=validRoute?routeDraftId?.toLowerCase()??null:null;
 const [state,setState]=useState<EditorState>(()=>initialEditorState(routeId));const current=useRef(state);current.current=state;
 const [technicians,setTechnicians]=useState<TechnicianState>({phase:'loading',items:[]});
 const [earlier,setEarlier]=useState<OperationCheck|null>(null);
 const requestSequence=useRef(0);const read=useRef<AbortController|null>(null);const techRead=useRef<AbortController|null>(null);const mounted=useRef(true);const binding=useRef(auth.binding);binding.current=auth.binding;
 const path=useRef(location.pathname);path.current=location.pathname;
 const errorRef=useRef<HTMLDivElement>(null);
 const interrupted=useRef<'draft'|'check'|null>(null);const confirmedExpiry=useRef(false);
 const listReturnKey=useRef<string|null>(typeof location.state==='string'&&isUuid(location.state)?location.state:null);
 const savedDuringVisit=useRef(false);
 function send(event:EditorEvent){const next=editorReducer(current.current,event);current.current=next;setState(next);}
 function replace(next:EditorState){send({type:'replace',state:next});}
 function active(captured:typeof auth.binding){return mounted.current&&isCurrentAuthBinding(captured);}
 function showError(error:unknown,captured:typeof auth.binding){if(!active(captured))return;if(auth.handleAuthError(error,captured))return;const message=error instanceof Error?error.message:'The operation could not be completed.';replace({...current.current,message});}
 function focusErrors(errors:Record<string,string[]>){queueMicrotask(()=>{const order=['customerName','phone','address','serviceType','quotedPriceInput','problemDescription','assignedTechnicianId','adminNotes'];const key=order.find(k=>errors[k]?.length||(k==='quotedPriceInput'&&errors.quotedPrice?.length));if(key)document.getElementById(key)?.focus();else errorRef.current?.focus();});}
 async function loadTechnicians(){const captured=binding.current;techRead.current?.abort();const controller=new AbortController();techRead.current=controller;setTechnicians(t=>({...t,phase:'loading'}));try{const result=await api.fetchTechnicians(controller.signal);if(active(captured)&&!controller.signal.aborted)setTechnicians({phase:'ready',items:result.technicians});}catch(e){if(controller.signal.aborted||!active(captured))return;if(auth.handleAuthError(e,captured))return;setTechnicians(t=>({...t,phase:'error'}));}}
 async function loadDraft(id:string,preserve=false){const captured=binding.current;const sequence=++requestSequence.current;read.current?.abort();const controller=new AbortController();read.current=controller;interrupted.current='draft';
  try{const record=await api.fetchDraft(id,controller.signal);if(!active(captured)||sequence!==requestSequence.current)return;interrupted.current=null;send({type:'load',record,preserve:preserve&&current.current.version!==null});}
  catch(e){if(controller.signal.aborted||!active(captured)||sequence!==requestSequence.current)return;interrupted.current=null;if(auth.handleAuthError(e,captured))return;replace({...current.current,phase:e instanceof ApiError&&e.status===404?'missing':'loadError',message:e instanceof Error?e.message:'Could not load this draft.'});}
 }
 useEditorGuard(dirtyFields(state.fields,state.baseline)||!!state.pending,!!state.pending);
 useEffect(()=>{
  mounted.current=true;
  if(!validRoute){replace({...initialEditorState(null),phase:'missing',message:'Invalid draft link.'});return;}
  const existing=current.current;
  if(existing.draftId!==routeId){listReturnKey.current=typeof location.state==='string'&&isUuid(location.state)?location.state:null;savedDuringVisit.current=false;setEarlier(null);replace(initialEditorState(routeId));}
  const restored=auth.accountId?restoreEditor(auth.accountId,location.pathname):null;
  if(restored){listReturnKey.current=restored.listReturnKey;replace({...initialEditorState(restored.draftId),fields:restored.fields,baseline:restored.savedBaseline,version:restored.draftVersion,pending:restored.pending,submissionKey:restored.submissionKey,conflictCode:restored.conflictCode,phase:restored.pending?(restored.conflictCode?'conflict':'uncertain'):'editing'});}
  void loadTechnicians();
  if(routeId&&!current.current.pending&&current.current.version===null)void loadDraft(routeId);
  else if(routeId&&restored&&!restored.pending)void loadDraft(routeId,true);
  return()=>{mounted.current=false;read.current?.abort();techRead.current?.abort();requestSequence.current++;};
 },[routeId]);
 useEffect(()=>subscribeAuthLifecycle(event=>{
  read.current?.abort();techRead.current?.abort();requestSequence.current++;
  if(event.type==='destroy'){replace(initialEditorState(routeId));listReturnKey.current=null;savedDuringVisit.current=false;setEarlier(null);setTechnicians({phase:'loading',items:[]});return;}
  if(event.type==='suspend'){
   if(event.reason==='unauthenticated')confirmedExpiry.current=true;
   if(current.current.pending)send({type:'uncertain',message:'The operation outcome is unconfirmed. Check its result before doing anything else.'});
   if(event.binding.accountId)captureEditor(event.binding.accountId,path.current,current.current,listReturnKey.current);
  }else{
   binding.current=event.binding;
   recoveryStore.clear();
   if(technicians.phase==='loading'||confirmedExpiry.current)void loadTechnicians();
   if(interrupted.current==='check'&&current.current.pending)void reconcile();
   else if(current.current.draftId&&!current.current.pending&&(interrupted.current==='draft'||confirmedExpiry.current))void loadDraft(current.current.draftId,current.current.version!==null);
   confirmedExpiry.current=false;
  }
 }),[routeId,technicians.phase]);
 async function applyResult(pending:Pending,result:DraftSavedResult|DraftDeletedResult|OrderCreatedResult,captured:typeof auth.binding,reconciled:boolean){
  if(!active(captured))return;
  recoveryStore.clear();
  if(pending.operation==='createOrder'||pending.operation==='submitDraft'){
   const receipt=result as OrderCreatedResult;
   if(!isUuid(receipt.orderId)||!/^SO-[0-9]{6,}$/.test(receipt.orderNumber)||!Number.isFinite(Date.parse(receipt.createdAt)))throw new Error('The creation receipt could not be verified.');
   rememberCreatedOrder(captured,receipt);replace(initialEditorState(null));await guardedNavigate(`/orders/${receipt.orderId}`,{replace:true,bypassGuard:true});return;
  }
  if(pending.operation==='deleteDraft'){const receipt=result as DraftDeletedResult;if(receipt.deleted!==true||receipt.draftId!==pending.targetId)throw new Error('The deletion receipt could not be verified.');replace(initialEditorState(null));await guardedNavigate('/drafts',{replace:true,bypassGuard:true});return;}
  const receipt=result as DraftSavedResult;
  if(!isUuid(receipt.draftId)||!Number.isInteger(receipt.version)||receipt.version<1||receipt.version>2147483647||!Number.isFinite(Date.parse(receipt.savedAt))||(pending.targetId!==null&&receipt.draftId!==pending.targetId))throw new Error('The draft receipt could not be verified.');
  const fields=(pending.requestBody as DraftWriteRequest).fields;
  savedDuringVisit.current=true;
  listReturnKey.current=null;
  replace({...current.current,phase:'editing',draftId:receipt.draftId,version:receipt.version,fields,baseline:fields,pending:null,conflictCode:null,message:'Draft saved.',fieldErrors:{}});
  if(!pending.targetId)await guardedNavigate(draftEditPath(receipt.draftId),{replace:true,bypassGuard:true});
  if(reconciled)await loadDraft(receipt.draftId,true);
 }
 async function dispatchMutation(pending:Pending){
  const captured=binding.current;
  replace({...current.current,phase:'mutating',pending:{...pending,state:'inFlight'},message:''});
  try{
   let result:DraftSavedResult|DraftDeletedResult|OrderCreatedResult;
   switch(pending.operation){case 'createDraft':result=await api.createDraft(pending.requestBody as DraftWriteRequest,pending.operationKey);break;case 'saveDraft':result=await api.saveDraft(pending.targetId!,pending.requestBody as DraftUpdateRequest,pending.operationKey);break;case 'deleteDraft':result=await api.deleteDraft(pending.targetId!,pending.requestBody as DraftDeleteRequest,pending.operationKey);break;case 'createOrder':result=await api.createOrder(pending.requestBody as CreateOrderRequest,pending.operationKey);break;case 'submitDraft':result=await api.submitDraft(pending.targetId!,pending.requestBody as SubmitDraftRequest,pending.operationKey);break;}
   await applyResult(pending,result,captured,pending.state!=='inFlight');
  }catch(e){
   if(!active(captured))return;
   if(auth.handleAuthError(e,captured))return;
   if(pending.state!=='inFlight'&&!(e instanceof ApiError&&e.code==='IDEMPOTENCY_CONFLICT')){
    send({type:'uncertain',message:'This retry was rejected, but the earlier attempt is still unconfirmed. Check the original result or retry the same request; do not start a new operation.'});
    queueMicrotask(()=>errorRef.current?.focus());return;
   }
   if(e instanceof ApiError&&e.status===422){send({type:'errors',errors:e.fieldErrors??{},message:e.message});focusErrors(e.fieldErrors??{});}
   else if(e instanceof ApiError&&e.status===409){send({type:'conflict',code:e.code as EditorConflictCode,message:e.message});if(['DRAFT_VERSION_CONFLICT','DRAFT_ALREADY_SUBMITTED'].includes(e.code)&&pending.targetId){try{const record=await api.fetchDraft(pending.targetId,new AbortController().signal);if(active(captured))replace({...current.current,record});}catch(error){showError(error,captured);}}}
   else if(e instanceof ApiError&&[400,403,404,413,415,429].includes(e.status)){replace({...current.current,phase:e.status===404?'missing':'editing',pending:null,message:e.message});}
   else send({type:'uncertain',message:'The result could not be confirmed. It may already have completed. Check the result or retry the exact same request.'});
   queueMicrotask(()=>errorRef.current?.focus());
  }
 }
 async function start(kind:'save'|'create'|'delete'|'separate'){
  const s=current.current;if(s.pending)return;
  if(s.phase==='conflict'&&!((kind==='separate'&&['DRAFT_VERSION_CONFLICT','DRAFT_ALREADY_SUBMITTED','VERSION_EXHAUSTED'].includes(s.conflictCode??''))||(kind==='delete'&&s.conflictCode==='VERSION_EXHAUSTED')))return;
  if(kind==='delete'&&!await confirmEditor('Delete this saved draft? This cannot be undone.','Delete draft','Cancel'))return;
  const errors=kind==='delete'?{}:validateFields(s.fields,kind==='create');
  if(Object.keys(errors).length){send({type:'errors',errors,message:'Check the highlighted fields.'});focusErrors(errors);return;}
  const operation=kind==='delete'?'deleteDraft':kind==='create'?(s.draftId?'submitDraft':'createOrder'):kind==='separate'||!s.draftId?'createDraft':'saveDraft';
  const targetId=['saveDraft','deleteDraft','submitDraft'].includes(operation)?s.draftId:null;
  const fields=kind==='create'?orderFields(s.fields):structuredClone(s.fields);
  const requestBody=operation==='deleteDraft'?{expectedVersion:s.version!}:targetId?{expectedVersion:s.version!,fields}:{fields};
  const pending:Pending={operation,operationKey:crypto.randomUUID(),targetId,requestBody:requestBody as Pending['requestBody'],state:'inFlight'};
  send({type:'begin',pending});await dispatchMutation(pending);
 }
 async function reconcile(){
  const s=current.current;const pending=s.pending;if(!pending)return;const captured=binding.current;const sequence=++requestSequence.current;read.current?.abort();const controller=new AbortController();read.current=controller;interrupted.current='check';send({type:'checking'});
  try{const check=await api.checkOperation(pending.operationKey,controller.signal);if(!active(captured)||sequence!==requestSequence.current)return;
   interrupted.current=null;
   if(check.state==='not_found'){send({type:'notFound'});return;}
   if(check.operation!==pending.operation||check.targetDraftId!==pending.targetId){send({type:'conflict',code:'RECONCILIATION_MISMATCH',message:'The result does not match this operation. Your input is retained. Retry this read or leave without making another change.'});return;}
   if(current.current.conflictCode==='RECONCILIATION_MISMATCH'){send({type:'conflict',code:'RECONCILIATION_MISMATCH',message:'The result could not be safely applied. Leave with confirmation to discard this intent.'});return;}
   if(current.current.conflictCode==='IDEMPOTENCY_CONFLICT'){setEarlier(check);send({type:'conflict',code:'IDEMPOTENCY_CONFLICT',message:'This key belongs to an earlier completed request. This does not confirm your current fields were saved. Review the earlier result or discard this intent.'});return;}
   await applyResult(pending,check.result,captured,true);
  }catch(e){if(controller.signal.aborted||!active(captured)||sequence!==requestSequence.current)return;interrupted.current=null;if(auth.handleAuthError(e,captured))return;send({type:'uncertain',message:'The result could not be checked. Retry checking; no new operation has been sent.'});}
 }
 async function reload(){if(!current.current.draftId||!await confirmEditor('Discard local changes and reload the saved version?','Reload saved version','Cancel'))return;await loadDraft(current.current.draftId);}
 function backToDrafts(){const context=listReturnKey.current?resolveListReturn(binding.current,listReturnKey.current):null;openDrafts(!savedDuringVisit.current&&context?.pathname==='/drafts'?{kind:'restoreDrafts',context}:{kind:'newestDrafts'});}
 const frozen=!!state.pending;const conflict=state.conflictCode;
 const progress=state.phase==='mutating'?(state.pending?.operation==='deleteDraft'?'Deleting draft...':state.pending?.operation==='createOrder'||state.pending?.operation==='submitDraft'?'Creating order...':'Saving draft...'):state.phase==='reconciling'?'Checking result...':'';
 return <div className="order-editor page-enter" style={{ maxWidth: 900, margin: '0 auto' }}>
  <header className="page-header">
    <div>
      <p className="eyebrow">Order Management</p>
      <h1 style={{ margin: 0 }}>{routeId ? 'Edit service order draft' : 'Create service order'}</h1>
    </div>
    <div className="actions">
      {state.draftId ? (
        <button type="button" onClick={backToDrafts}>Back to my drafts</button>
      ) : (
        <GuardedLink className="button" to="/orders">Back to service orders</GuardedLink>
      )}
      {state.draftId && state.phase === 'editing' && (
        <button type="button" onClick={() => openDrafts({ kind: 'newestDrafts' })}>My drafts</button>
      )}
    </div>
  </header>
 <p role="status">{progress||(!state.message&&dirtyFields(state.fields,state.baseline)?'Unsaved changes':state.message==='Draft saved.'?'Draft saved.':'')}</p>
 {state.message&&state.message!=='Draft saved.'&&<div ref={errorRef} tabIndex={-1} role="alert" className="error panel"><p>{state.message}</p>{Object.entries(state.fieldErrors).filter(([key])=>key==='_form'||!['customerName','phone','address','problemDescription','serviceType','quotedPrice','quotedPriceInput','assignedTechnicianId','adminNotes'].includes(key)).map(([key,messages])=><p key={key}>{messages.join(' ')}</p>)}</div>}
 {state.phase==='loadingDraft'?<p role="status">Loading draft...</p>:state.phase==='loadError'?<button onClick={()=>state.draftId&&loadDraft(state.draftId,true)}>Retry loading draft</button>:state.phase==='missing'?<section><h2>Draft not found</h2><p>The draft is missing or is not available to this account.</p>{dirtyFields(state.fields,state.baseline)&&!frozen&&<button onClick={()=>start('separate')}>Save changes as a separate draft</button>}</section>:state.phase==='submittedDraft'?<section><h2>This draft has already been submitted</h2>{state.record?.lifecycle.state==='submitted'&&<GuardedLink to={`/orders/${state.record.lifecycle.orderId}`}>View order {state.record.lifecycle.orderNumber}</GuardedLink>}{dirtyFields(state.fields,state.baseline)&&!frozen&&<button onClick={()=>start('separate')}>Save changes as a separate draft</button>}</section>:<OrderForm state={state} technicians={technicians} onEdit={(key,value)=>send({type:'edit',key,value})} onSave={()=>void start('save')} onCreate={()=>void start('create')} onDelete={()=>void start('delete')} onRetryTechnicians={()=>void loadTechnicians()}/>}
 {(state.phase==='uncertain'||state.phase==='conflict'||state.phase==='reconciling')&&<section className="panel" aria-label="Operation recovery"><h2>Resolve this operation</h2><div className="actions">
 {state.pending&&<button disabled={state.phase==='reconciling'} onClick={()=>void reconcile()}>Check result</button>}
 {state.pending&&!['IDEMPOTENCY_CONFLICT','RECONCILIATION_MISMATCH'].includes(conflict??'')&&<button disabled={state.phase==='reconciling'} onClick={()=>void dispatchMutation({...state.pending!,state:'retryAvailable'})}>Retry same request</button>}
 {conflict==='DRAFT_VERSION_CONFLICT'&&<><button onClick={()=>void reload()}>Reload saved version</button><button onClick={()=>void start('separate')}>Save changes as a separate draft</button></>}
 {conflict==='VERSION_EXHAUSTED'&&<><button onClick={()=>void start('separate')}>Save changes as a separate draft</button><button onClick={()=>void start('delete')}>Delete draft</button></>}
 {conflict==='DRAFT_ALREADY_SUBMITTED'&&state.record?.lifecycle.state==='submitted'&&<><GuardedLink to={`/orders/${state.record.lifecycle.orderId}`}>View order</GuardedLink><button onClick={()=>void start('separate')}>Save changes as a separate draft</button></>}
 {earlier?.state==='completed'&&(earlier.operation==='createOrder'||earlier.operation==='submitDraft')&&<GuardedLink to={`/orders/${earlier.result.orderId}`}>View earlier order</GuardedLink>}
 {earlier?.state==='completed'&&(earlier.operation==='createDraft'||earlier.operation==='saveDraft')&&<button onClick={async()=>{if(await confirmEditor('Discard this conflicting intent and review the currently saved draft?')){replace(initialEditorState(earlier.result.draftId));await guardedNavigate(draftEditPath(earlier.result.draftId),{replace:true,bypassGuard:true});void loadDraft(earlier.result.draftId);}}}>Read current draft</button>}
 </div></section>}
 <EditorConfirmation/></div>;
}
