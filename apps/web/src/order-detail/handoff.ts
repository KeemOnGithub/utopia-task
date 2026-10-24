import { isCanonicalOrderNumber, isCanonicalTimestamp } from '../../../../packages/contracts/src/order-detail.js';
import { isUuid, normalizeUuid, type OrderCreatedResult } from '../../../../packages/contracts/src/service-orders.js';
import { isCurrentAuthBinding, subscribeAuthLifecycle } from '../auth/index.js';

type Binding = {accountId:string|null;authGeneration:number};
export type DetailVisit = {visitId:string;orderId:string;receipt:OrderCreatedResult|null;dismissed:boolean;creationIntent:boolean;accountId:string};
const pending = new Map<string,OrderCreatedResult>();
const visits = new Map<string,DetailVisit>();
export function rememberCreatedOrder(binding: Binding, receipt: OrderCreatedResult): void {
  if (!binding.accountId || !isCurrentAuthBinding(binding) || !isUuid(receipt.orderId) || !isCanonicalOrderNumber(receipt.orderNumber) || !isCanonicalTimestamp(receipt.createdAt)) return;
  pending.set(`${binding.accountId}:${normalizeUuid(receipt.orderId)}`,{orderId:normalizeUuid(receipt.orderId),orderNumber:receipt.orderNumber,createdAt:receipt.createdAt});
}
export function beginDetailVisit(binding: Binding, orderId: string, visitId: string): DetailVisit {
  if (!binding.accountId || !isCurrentAuthBinding(binding)) throw new Error('Detail visit requires verified authentication.');
  const id = normalizeUuid(orderId);
  const existing = visits.get(visitId);
  if (existing && existing.accountId === binding.accountId && existing.orderId === id) return existing;
  const key = `${binding.accountId}:${id}`;
  const receipt = pending.get(key) ?? null;
  pending.delete(key);
  const visit = {visitId,orderId:id,accountId:binding.accountId,receipt,dismissed:false,creationIntent:!!receipt};
  visits.set(visitId,visit);
  return visit;
}
export function dismissCreation(visitId:string):void { const visit=visits.get(visitId); if(visit) visit.dismissed=true; }
export function endDetailVisit(visitId:string):void { visits.delete(visitId); }
export function clearDetailState():void { pending.clear(); visits.clear(); }
subscribeAuthLifecycle(event => { if(event.type==='destroy') clearDetailState(); });
