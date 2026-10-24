import { draftEditPath,isOrderEditorRecoveryV1, type OrderEditorRecoveryV1 } from '@sejuk/contracts/drafts';
import { recoveryStore } from '../auth/index.js';
import { type EditorState } from './state.js';
export function captureEditor(accountId:string,returnPath:string,state:EditorState,listReturnKey:string|null=null):void{
 const payload:OrderEditorRecoveryV1={schemaVersion:1,mode:state.draftId?'draft':'new',draftId:state.draftId,draftVersion:state.version,fields:state.fields,savedBaseline:state.baseline,pending:state.pending?{...state.pending,state:'uncertain'}:null,submissionKey:state.submissionKey,conflictCode:state.conflictCode,listReturnKey};
 recoveryStore.capture({accountId,returnPath,payload:structuredClone(payload)});
}
export function restoreEditor(accountId:string,returnPath:string):OrderEditorRecoveryV1|null{
 const snapshot=recoveryStore.takeFor(accountId);
 if(!snapshot||snapshot.returnPath!==returnPath||!isOrderEditorRecoveryV1(snapshot.payload))return null;
 if(snapshot.payload.mode==='new'?returnPath!=='/orders/new':returnPath!==draftEditPath(snapshot.payload.draftId!))return null;
 return {...snapshot.payload,pending:snapshot.payload.pending?{...snapshot.payload.pending,state:'uncertain'}:null};
}
