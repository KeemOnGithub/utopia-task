import { createHash } from 'node:crypto';
import type { Actor } from '@sejuk/contracts/api';
import type { DraftFields } from '@sejuk/contracts/drafts';
import type { OrderFields } from '@sejuk/contracts/service-orders';
import type { Queryable } from '../db.js';
import { AppError } from '../errors.js';
import type { MutationIntent } from './validation.js';
import { receiptCheck } from './queries.js';
export function fingerprintOperation(intent:MutationIntent):Buffer{
  const f=intent.fields;
  const fields=f===null?null:'quotedPriceInput' in f?{customerName:f.customerName,phone:f.phone,address:f.address,problemDescription:f.problemDescription,serviceType:f.serviceType,quotedPriceInput:f.quotedPriceInput,assignedTechnicianId:f.assignedTechnicianId,adminNotes:f.adminNotes}:{customerName:f.customerName,phone:f.phone,address:f.address,problemDescription:f.problemDescription,serviceType:f.serviceType,quotedPrice:f.quotedPrice,assignedTechnicianId:f.assignedTechnicianId,adminNotes:f.adminNotes};
  return createHash('sha256').update(JSON.stringify({contractVersion:1,operation:intent.operation,targetDraftId:intent.targetDraftId,expectedVersion:intent.expectedVersion,fields})).digest();
}
export function advisoryLockKey(accountId:string,key:string):string{return createHash('sha256').update(`${accountId.toLowerCase()}:${key.toLowerCase()}`).digest().readBigInt64BE(0).toString();}
export const conflictMessages={DRAFT_VERSION_CONFLICT:'This draft changed in another tab. Reload it or save your changes as a separate draft.',DRAFT_ALREADY_SUBMITTED:'This draft has already been submitted.',VERSION_EXHAUSTED:'This draft has reached its version limit. Save your changes as a separate draft or delete this draft.',IDEMPOTENCY_CONFLICT:'This request key was already used for a different request.',OPERATION_BUSY:'This operation is still being processed. Check its result or retry the same request.'};
export function conflict(code:keyof typeof conflictMessages):never{throw new AppError(409,code,conflictMessages[code]);}
export async function executeEditorMutation(db:Queryable,actor:Actor,intent:MutationIntent,key:string){
  const digest=fingerprintOperation(intent); const {operation,targetDraftId,expectedVersion,fields}=intent;
  await db.query('SELECT pg_advisory_xact_lock($1::bigint)',[advisoryLockKey(actor.accountId,key)]);
  const prior=await db.query('SELECT operation_type,target_draft_id,request_fingerprint,result_draft_id,result_version,result_order_id,result_order_number_value,result_timestamp FROM app_private.order_editor_operations WHERE account_id=$1 AND operation_key=$2',[actor.accountId,key]);
  const status=operation==='createDraft'||operation==='createOrder'||operation==='submitDraft'?201:200;
  if(prior.rows[0]){const r=prior.rows[0];if(r.operation_type!==operation||r.target_draft_id!==targetDraftId||!Buffer.from(r.request_fingerprint).equals(digest))conflict('IDEMPOTENCY_CONFLICT');const check=receiptCheck(r);if(check.state!=='completed')throw new Error('Invalid receipt.');return {status,result:check.result,operation};}
  if(targetDraftId){const {rows}=await db.query('SELECT version,submitted_order_id FROM app_private.service_order_drafts WHERE id=$1 AND creator_account_id=$2 FOR UPDATE',[targetDraftId,actor.accountId]);const draft=rows[0];if(!draft)throw new AppError(404,'NOT_FOUND','Draft not found.');if(draft.submitted_order_id)conflict('DRAFT_ALREADY_SUBMITTED');if(draft.version!==expectedVersion)conflict('DRAFT_VERSION_CONFLICT');if(operation!=='deleteDraft'&&draft.version===2147483647)conflict('VERSION_EXHAUSTED');}
  if(fields?.assignedTechnicianId){const {rows}=await db.query('SELECT app_private.lock_active_technician($1::uuid) AS active',[fields.assignedTechnicianId]);if(!rows[0]?.active)throw new AppError(422,'VALIDATION_ERROR','Check the highlighted fields.',{assignedTechnicianId:['This technician is no longer available. Select another technician.']});}
  // Keep the timestamp in Postgres text form so all writes retain its full precision.
  const {rows:clock}=await db.query('SELECT clock_timestamp()::text AS at');const at=clock[0].at;
  let draftId:string|null=null,version:number|null=null,orderId:string|null=null,number:string|null=null;
  if(operation==='createDraft'||operation==='saveDraft'){
    const f=fields as DraftFields;const values=[f.customerName,f.phone,f.address,f.problemDescription,f.serviceType,f.quotedPriceInput,f.assignedTechnicianId,f.adminNotes];
    if(operation==='createDraft'){const {rows}=await db.query(`INSERT INTO app_private.service_order_drafts (customer_name,phone,address,problem_description,service_type,quoted_price_input,proposed_technician_id,admin_notes,creator_account_id,created_at,last_saved_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING id,version`,[...values,actor.accountId,at]);draftId=rows[0].id;version=rows[0].version;}
    else {const {rows}=await db.query(`UPDATE app_private.service_order_drafts SET customer_name=$1,phone=$2,address=$3,problem_description=$4,service_type=$5,quoted_price_input=$6,proposed_technician_id=$7,admin_notes=$8,version=version+1,last_saved_at=$9 WHERE id=$10 RETURNING id,version`,[...values,at,targetDraftId]);draftId=rows[0].id;version=rows[0].version;}
  }else if(operation==='deleteDraft'){await db.query('DELETE FROM app_private.service_order_drafts WHERE id=$1',[targetDraftId]);draftId=targetDraftId;}
  else {const f=fields as OrderFields;const {rows}=await db.query(`INSERT INTO app_private.service_orders (customer_name,phone,address,problem_description,service_type,quoted_price_sen,currency,assigned_technician_id,admin_notes,created_by_account_id,assigned_by_account_id,created_at,assigned_at,source_draft_id) VALUES ($1,$2,$3,$4,$5,$6,'MYR',$7,$8,$9,$9,$10,$10,$11) RETURNING id,order_number_value`,[f.customerName,f.phone,f.address,f.problemDescription,f.serviceType,intent.quotedPriceSen,f.assignedTechnicianId,f.adminNotes,actor.accountId,at,targetDraftId]);orderId=rows[0].id;number=rows[0].order_number_value;if(targetDraftId)await db.query('UPDATE app_private.service_order_drafts SET version=version+1,submitted_order_id=$1,submitted_at=$2 WHERE id=$3',[orderId,at,targetDraftId]);}
  const {rows}=await db.query(`INSERT INTO app_private.order_editor_operations (account_id,operation_key,operation_type,target_draft_id,request_fingerprint,result_draft_id,result_version,result_order_id,result_order_number_value,result_timestamp) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING operation_type,target_draft_id,result_draft_id,result_version,result_order_id,result_order_number_value,result_timestamp`,[actor.accountId,key,operation,targetDraftId,digest,draftId,version,orderId,number,at]);
  const check=receiptCheck(rows[0]);if(check.state!=='completed')throw new Error('Invalid receipt.');return {status,result:check.result,operation};
}
