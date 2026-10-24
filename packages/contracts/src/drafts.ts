import { isUuid, isUuidV4, isValidUnicode, normalizeUuid, parsePrice, type Money, type ServiceType, type TechnicianRef, type OrderFields, type CreateOrderRequest, type OrderCreatedResult } from './service-orders.js';
export type { CreateOrderRequest, OrderCreatedResult } from './service-orders.js';
export type DraftFields = {
  customerName: string; phone: string; address: string; problemDescription: string;
  serviceType: ServiceType | null; quotedPriceInput: string; assignedTechnicianId: string | null; adminNotes: string;
};
export type DraftRecord = { id: string; version: number; fields: DraftFields; createdAt: string; lastSavedAt: string; proposedTechnician: (TechnicianRef & {isActive: boolean}) | null; lifecycle: {state:'active'} | {state:'submitted';orderId:string;orderNumber:string;submittedAt:string} };
export type DraftSummary = { id:string; customerName:string|null; serviceType:ServiceType|null; proposedTechnician:TechnicianRef|null; quotedPrice: {kind:'missing'}|{kind:'incomplete'}|({kind:'money'} & Money); lastSavedAt:string };
export type DraftWriteRequest = {fields:DraftFields};
export type DraftUpdateRequest = {expectedVersion:number;fields:DraftFields};
export type DraftDeleteRequest = {expectedVersion:number};
export type SubmitDraftRequest = {expectedVersion:number;fields:OrderFields};
export type DraftSavedResult = {draftId:string;version:number;savedAt:string};
export type DraftDeletedResult = {draftId:string;deleted:true};
export type EditorOperation = 'createDraft'|'saveDraft'|'deleteDraft'|'createOrder'|'submitDraft';
export type OperationCheck = {state:'not_found'} | {state:'completed';operation:'createDraft';targetDraftId:null;result:DraftSavedResult} | {state:'completed';operation:'saveDraft';targetDraftId:string;result:DraftSavedResult} | {state:'completed';operation:'deleteDraft';targetDraftId:string;result:DraftDeletedResult} | {state:'completed';operation:'createOrder';targetDraftId:null;result:OrderCreatedResult} | {state:'completed';operation:'submitDraft';targetDraftId:string;result:OrderCreatedResult};
export type EditorConflictCode = 'DRAFT_VERSION_CONFLICT'|'DRAFT_ALREADY_SUBMITTED'|'VERSION_EXHAUSTED'|'OPERATION_BUSY'|'IDEMPOTENCY_CONFLICT'|'RECONCILIATION_MISMATCH';
export type OrderEditorRecoveryV1 = {schemaVersion:1;mode:'new'|'draft';draftId:string|null;draftVersion:number|null;fields:DraftFields;savedBaseline:DraftFields;pending:null|{operationKey:string;operation:EditorOperation;targetId:string|null;requestBody:DraftWriteRequest|DraftUpdateRequest|DraftDeleteRequest|CreateOrderRequest|SubmitDraftRequest;state:'inFlight'|'uncertain'|'checking'|'retryAvailable'};submissionKey:string|null;conflictCode:EditorConflictCode|null;listReturnKey:string|null};
export function draftEditPath(id:string):string { return `/drafts/${normalizeUuid(id)}/edit`; }
export function deriveDraftPriceSummary(input:string):DraftSummary['quotedPrice'] { if (!input.trim()) return {kind:'missing'}; try { return {kind:'money',currency:'MYR',amount:parsePrice(input).amount}; } catch { return {kind:'incomplete'}; } }
export function deriveDraftLabel(value: string|null | Pick<DraftSummary,'customerName'>):string { const name = typeof value === 'object' && value !== null ? value.customerName : value; return name?.trim() || 'Untitled draft'; }
export const MAX_DRAFT_VERSION = 2147483647;
export function isDraftVersion(value:unknown): value is number { return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_DRAFT_VERSION; }
export function emptyDraftFields():DraftFields { return {customerName:'',phone:'',address:'',problemDescription:'',serviceType:null,quotedPriceInput:'',assignedTechnicianId:null,adminNotes:''}; }
function object(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value);}
function exact(value:Record<string,unknown>,keys:string[]):boolean{return Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));}
export function isDraftFields(value:unknown):value is DraftFields{
 if(!object(value)||!exact(value,Object.keys(emptyDraftFields())))return false;
 for(const [key,max] of Object.entries({customerName:200,phone:50,address:2000,problemDescription:5000,quotedPriceInput:32,adminNotes:5000})){const v=value[key];if(typeof v!=='string'||!isValidUnicode(v)||Array.from(v).length>max)return false;}
 return (value.serviceType===null||['installation','servicing','repair'].includes(value.serviceType as string))&&(value.assignedTechnicianId===null||isUuid(value.assignedTechnicianId));
}
export function isOrderEditorRecoveryV1(value:unknown):value is OrderEditorRecoveryV1{
 if(!object(value)||!exact(value,['schemaVersion','mode','draftId','draftVersion','fields','savedBaseline','pending','submissionKey','conflictCode','listReturnKey']))return false;
 if(value.schemaVersion!==1||!['new','draft'].includes(value.mode as string)||!isDraftFields(value.fields)||!isDraftFields(value.savedBaseline))return false;
 if(value.mode==='new'?(value.draftId!==null||value.draftVersion!==null):(!isUuid(value.draftId)||!isDraftVersion(value.draftVersion)))return false;
 if(value.submissionKey!==null&&!isUuidV4(value.submissionKey))return false;
 if(value.listReturnKey!==null&&!isUuid(value.listReturnKey))return false;
 if(value.conflictCode!==null&&!['DRAFT_VERSION_CONFLICT','DRAFT_ALREADY_SUBMITTED','VERSION_EXHAUSTED','OPERATION_BUSY','IDEMPOTENCY_CONFLICT','RECONCILIATION_MISMATCH'].includes(value.conflictCode as string))return false;
 if(value.pending!==null){
  const p=value.pending;if(!object(p)||!exact(p,['operationKey','operation','targetId','requestBody','state'])||!isUuidV4(p.operationKey)||!['inFlight','uncertain','checking','retryAvailable'].includes(p.state as string))return false;
  if(!['createDraft','saveDraft','deleteDraft','createOrder','submitDraft'].includes(p.operation as string))return false;
  const targeted=['saveDraft','deleteDraft','submitDraft'].includes(p.operation as string);
  if(targeted?!isUuid(p.targetId):p.targetId!==null)return false;
  if(targeted&&(value.mode!=='draft'||p.targetId!==value.draftId))return false;
  const b=p.requestBody;if(!object(b)||!exact(b,p.operation==='deleteDraft'?['expectedVersion']:targeted?['expectedVersion','fields']:['fields']))return false;
  if(targeted&&!isDraftVersion(b.expectedVersion))return false;
  if(p.operation==='createDraft'||p.operation==='saveDraft'){if(!isDraftFields(b.fields))return false;}
  if(p.operation==='createOrder'||p.operation==='submitDraft'){
   const f=b.fields;if(!object(f)||!exact(f,['customerName','phone','address','problemDescription','serviceType','quotedPrice','assignedTechnicianId','adminNotes']))return false;
   const {quotedPrice,...rest}=f;if(!isDraftFields({...rest,adminNotes:f.adminNotes??'',quotedPriceInput:quotedPrice}))return false;
   if(typeof f.quotedPrice!=='string'||!isUuid(f.assignedTechnicianId)||f.serviceType===null)return false;
   try{parsePrice(f.quotedPrice);}catch{return false;}
  }
 }
 return true;
}
