import type { Actor } from '@sejuk/contracts/api';
import { formatOrderNumber } from '@sejuk/contracts/service-orders';
import type { DraftRecord, OperationCheck } from '@sejuk/contracts/drafts';
import type { Queryable } from '../db.js';
import { AppError } from '../errors.js';
export const iso=(value:Date|string):string=>new Date(value).toISOString();
export async function listSelectableTechnicians(db:Queryable){const {rows}=await db.query('SELECT id,display_name AS name FROM app_private.technicians WHERE is_active ORDER BY display_name,id');return rows as {id:string;name:string}[];}
export async function loadOwnedDraft(db:Queryable,actor:Actor,id:string):Promise<DraftRecord>{
  const {rows}=await db.query(`SELECT d.id,d.version,d.customer_name,d.phone,d.address,d.problem_description,d.service_type,d.quoted_price_input,d.proposed_technician_id,d.admin_notes,d.created_at,d.last_saved_at,d.submitted_order_id,d.submitted_at,t.display_name,t.is_active,o.order_number_value FROM app_private.service_order_drafts d LEFT JOIN app_private.technicians t ON t.id=d.proposed_technician_id LEFT JOIN app_private.service_orders o ON o.id=d.submitted_order_id WHERE d.id=$1 AND d.creator_account_id=$2`,[id,actor.accountId]);
  const r=rows[0];if(!r)throw new AppError(404,'NOT_FOUND','Draft not found.');
  return {id:r.id,version:r.version,fields:{customerName:r.customer_name,phone:r.phone,address:r.address,problemDescription:r.problem_description,serviceType:r.service_type,quotedPriceInput:r.quoted_price_input,assignedTechnicianId:r.proposed_technician_id,adminNotes:r.admin_notes},createdAt:iso(r.created_at),lastSavedAt:iso(r.last_saved_at),proposedTechnician:r.proposed_technician_id?{id:r.proposed_technician_id,name:r.display_name,isActive:r.is_active}:null,lifecycle:r.submitted_order_id?{state:'submitted',orderId:r.submitted_order_id,orderNumber:formatOrderNumber(r.order_number_value),submittedAt:iso(r.submitted_at)}:{state:'active'}};
}
export function receiptCheck(r:Record<string,any>):OperationCheck{
  const operation=r.operation_type;
  const result=operation==='createOrder'||operation==='submitDraft'?{orderId:r.result_order_id,orderNumber:formatOrderNumber(r.result_order_number_value),createdAt:iso(r.result_timestamp)}:operation==='deleteDraft'?{draftId:r.result_draft_id,deleted:true as const}:{draftId:r.result_draft_id,version:r.result_version,savedAt:iso(r.result_timestamp)};
  return {state:'completed',operation,targetDraftId:r.target_draft_id,result} as OperationCheck;
}
export async function checkOwnedOperation(db:Queryable,actor:Actor,key:string):Promise<OperationCheck>{const {rows}=await db.query('SELECT operation_type,target_draft_id,result_draft_id,result_version,result_order_id,result_order_number_value,result_timestamp FROM app_private.order_editor_operations WHERE account_id=$1 AND operation_key=$2',[actor.accountId,key]);return rows[0]?receiptCheck(rows[0]):{state:'not_found'};}
