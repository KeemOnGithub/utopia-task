import type { ServiceOrder } from './service-orders.js';
export type { DraftSummary } from './drafts.js';
export type Page<T> = {items:T[];pagination:{nextCursor:string|null;hasNextPage:boolean}};
export type OrderSummary = Pick<ServiceOrder,'id'|'orderNumber'|'customerName'|'serviceType'|'assignedTechnician'|'quotedPrice'|'status'|'createdAt'>;
export type ListingResponse<T> = {data:Page<T>};
