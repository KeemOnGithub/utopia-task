import { emptyDraftFields, type DraftFields, type DraftRecord, type EditorConflictCode, type OrderEditorRecoveryV1 } from '@sejuk/contracts/drafts';
import { normalizeLineEndings } from '@sejuk/contracts/service-orders';
export type Pending=NonNullable<OrderEditorRecoveryV1['pending']>;
export type EditorPhase='loadingDraft'|'editing'|'fieldErrors'|'mutating'|'uncertain'|'reconciling'|'conflict'|'submittedDraft'|'missing'|'loadError';
export type EditorState={phase:EditorPhase;fields:DraftFields;baseline:DraftFields;draftId:string|null;version:number|null;pending:Pending|null;conflictCode:EditorConflictCode|null;fieldErrors:Record<string,string[]>;message:string;record:DraftRecord|null;submissionKey:string|null};
export function initialEditorState(id:string|null):EditorState{return {phase:id?'loadingDraft':'editing',fields:emptyDraftFields(),baseline:emptyDraftFields(),draftId:id,version:null,pending:null,conflictCode:null,fieldErrors:{},message:'',record:null,submissionKey:null};}
export function dirtyFields(fields:DraftFields,baseline:DraftFields):boolean{return Object.keys(fields).some(k=>{const key=k as keyof DraftFields;const a=fields[key],b=baseline[key];return typeof a==='string'&&typeof b==='string'?normalizeLineEndings(a)!==normalizeLineEndings(b):a!==b;});}
export function isFrozen(state:EditorState):boolean{return !!state.pending||state.conflictCode==='RECONCILIATION_MISMATCH'||state.conflictCode==='IDEMPOTENCY_CONFLICT';}
export type EditorEvent={type:'edit';key:keyof DraftFields;value:string|null}|{type:'begin';pending:Pending}|{type:'uncertain';message:string}|{type:'checking'}|{type:'notFound'}|{type:'conflict';code:EditorConflictCode;message:string}|{type:'errors';errors:Record<string,string[]>;message:string}|{type:'load';record:DraftRecord;preserve?:boolean}|{type:'replace';state:EditorState};
export function editorReducer(state:EditorState,event:EditorEvent):EditorState{
  switch(event.type){
    case 'replace':return event.state;
    case 'edit':if(isFrozen(state)||!['editing','fieldErrors','conflict'].includes(state.phase))return state;return {...state,fields:{...state.fields,[event.key]:event.value},fieldErrors:{...state.fieldErrors,[event.key]:[],...(event.key==='quotedPriceInput'?{quotedPrice:[]}:{})},message:state.phase==='conflict'?state.message:'',phase:state.phase==='fieldErrors'?'editing':state.phase};
    case 'begin':if(state.pending)return state;return {...state,phase:'mutating',pending:structuredClone(event.pending),submissionKey:event.pending.operationKey,fieldErrors:{},message:'',conflictCode:null};
    case 'uncertain':return {...state,phase:state.conflictCode==='IDEMPOTENCY_CONFLICT'||state.conflictCode==='RECONCILIATION_MISMATCH'?'conflict':'uncertain',pending:state.pending?{...state.pending,state:'uncertain'}:null,message:event.message};
    case 'checking':return {...state,phase:'reconciling',pending:state.pending?{...state.pending,state:'checking'}:null};
    case 'notFound':return {...state,phase:state.conflictCode==='IDEMPOTENCY_CONFLICT'||state.conflictCode==='RECONCILIATION_MISMATCH'?'conflict':'uncertain',pending:state.pending?{...state.pending,state:'retryAvailable'}:null,message:'No completed result is visible yet. This does not prove the operation failed.'};
    case 'conflict':return {...state,phase:'conflict',conflictCode:event.code,message:event.message,pending:['OPERATION_BUSY','IDEMPOTENCY_CONFLICT','RECONCILIATION_MISMATCH'].includes(event.code)?state.pending:null};
    case 'errors':return {...state,phase:'fieldErrors',pending:null,fieldErrors:event.errors,message:event.message};
    case 'load':{
      const r=event.record;const preserve=event.preserve;
      if(r.lifecycle.state==='submitted')return {...state,phase:'submittedDraft',record:r,version:r.version,pending:null};
      if(preserve&&state.version!==null&&state.version!==r.version)return {...state,phase:'conflict',record:r,conflictCode:'DRAFT_VERSION_CONFLICT',message:'This draft changed in another tab. Reload it or save your changes as a separate draft.'};
      return {...state,phase:'editing',record:r,draftId:r.id,version:r.version,fields:preserve?state.fields:r.fields,baseline:preserve?state.baseline:r.fields,pending:null,conflictCode:null,message:preserve?state.message:''};
    }
  }
}
