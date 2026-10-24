import {encodeListingCursor,type CursorPosition,type ListKind} from '@sejuk/contracts/listing-cursor';
import type {Page,OrderSummary,DraftSummary} from '@sejuk/contracts/listings';
import {deriveDraftPriceSummary} from '@sejuk/contracts/drafts';
import {formatOrderNumber,moneyFromSen,type ServiceType} from '@sejuk/contracts/service-orders';
import type {Actor} from '@sejuk/contracts/api';
import type {Queryable} from '../db.js';
type Row={id:string;boundary_at:string;customer_name:string;service_type:ServiceType|null;technician_id:string|null;technician_name:string|null;created_at:Date;last_saved_at:Date;order_number_value:string;quoted_price_sen:number;quoted_price_input:string;currency:'MYR';status:'assigned'};
export function pageFromRows<T>(rows:Row[],kind:ListKind,map:(row:Row)=>T):Page<T>{const shown=rows.slice(0,25);const last=shown.at(-1);const hasNextPage=rows.length>25;return {items:shown.map(map),pagination:{hasNextPage,nextCursor:hasNextPage&&last?encodeListingCursor({v:1,kind,at:last.boundary_at,id:last.id}):null}};}
export async function listOrderSummaries(db:Queryable,position:CursorPosition|null):Promise<Page<OrderSummary>>{
 const result=await db.query<Row>(`SELECT o.id,o.order_number_value,o.customer_name,o.service_type,o.quoted_price_sen,o.currency,o.status,o.created_at,t.id AS technician_id,t.display_name AS technician_name,to_char(o.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS boundary_at FROM app_private.service_orders o INNER JOIN app_private.technicians t ON t.id=o.assigned_technician_id ${position?'WHERE (o.created_at,o.id)<($1::timestamptz,$2::uuid)':''} ORDER BY o.created_at DESC,o.id DESC LIMIT 26`,position?[position.at,position.id]:[]);
 return pageFromRows(result.rows,'orders',r=>({id:r.id,orderNumber:formatOrderNumber(r.order_number_value),customerName:r.customer_name,serviceType:r.service_type!,assignedTechnician:{id:r.technician_id!,name:r.technician_name!},quotedPrice:moneyFromSen(r.quoted_price_sen),status:r.status,createdAt:r.created_at.toISOString()}));
}
export async function listDraftSummaries(db:Queryable,actor:Actor,position:CursorPosition|null):Promise<Page<DraftSummary>>{
 const result=await db.query<Row>(`SELECT d.id,d.customer_name,d.service_type,d.quoted_price_input,d.last_saved_at,t.id AS technician_id,t.display_name AS technician_name,to_char(d.last_saved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS boundary_at FROM app_private.service_order_drafts d LEFT JOIN app_private.technicians t ON t.id=d.proposed_technician_id WHERE d.creator_account_id=$1::uuid AND d.submitted_order_id IS NULL ${position?'AND (d.last_saved_at,d.id)<($2::timestamptz,$3::uuid)':''} ORDER BY d.last_saved_at DESC,d.id DESC LIMIT 26`,position?[actor.accountId,position.at,position.id]:[actor.accountId]);
 return pageFromRows(result.rows,'drafts',r=>({id:r.id,customerName:r.customer_name.trim()||null,serviceType:r.service_type,proposedTechnician:r.technician_id?{id:r.technician_id,name:r.technician_name!}:null,quotedPrice:deriveDraftPriceSummary(r.quoted_price_input),lastSavedAt:r.last_saved_at.toISOString()}));
}
