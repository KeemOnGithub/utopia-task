import { formatOrderNumber, isUuid, isValidUnicode, normalizeUuid, parsePrice, type ServiceOrder } from './service-orders.js';

export type OrderDetail = ServiceOrder;
export type OrderDetailResponse = { data: OrderDetail };
export class OrderDetailConsistencyError extends Error {
  constructor(public readonly mismatch=false) { super('The saved order details could not be verified. Retry loading or return to Service orders.'); }
}
function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
export function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}
export function isCanonicalOrderNumber(value: unknown): value is string {
  if (typeof value !== 'string' || !/^SO-\d{6,}$/.test(value)) return false;
  const digits = value.slice(3).replace(/^0+/, '');
  return !!digits && formatOrderNumber(digits) === value;
}
function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value && Array.from(value).length <= max && isValidUnicode(value) && !value.includes('\r');
}
export function validateOrderDetail(value: unknown, expectedId: string): OrderDetail {
  const fail = () => { throw new OrderDetailConsistencyError(); };
  if (!exact(value, ['id','orderNumber','customerName','phone','address','problemDescription','serviceType','quotedPrice','assignedTechnician','adminNotes','status','createdByAccountId','createdAt','assignedByAccountId','assignedAt'])) return fail();
  if(isUuid(value.id) && value.id.toLowerCase()!==normalizeUuid(expectedId)) throw new OrderDetailConsistencyError(true);
  if (!isUuid(value.id) || value.id !== normalizeUuid(expectedId) || value.id !== value.id.toLowerCase() || !isCanonicalOrderNumber(value.orderNumber)) return fail();
  if (!text(value.customerName,200) || !text(value.phone,50) || !/[0-9]/.test(value.phone) || !text(value.address,2000) || !text(value.problemDescription,5000) || !(value.adminNotes === null || text(value.adminNotes,5000))) return fail();
  if (!['installation','servicing','repair'].includes(value.serviceType as string) || value.status !== 'assigned') return fail();
  if (!exact(value.quotedPrice,['currency','amount']) || value.quotedPrice.currency !== 'MYR' || typeof value.quotedPrice.amount !== 'string') return fail();
  try { if (parsePrice(value.quotedPrice.amount).amount !== value.quotedPrice.amount) return fail(); } catch { return fail(); }
  if (!exact(value.assignedTechnician,['id','name']) || !isUuid(value.assignedTechnician.id) || value.assignedTechnician.id !== value.assignedTechnician.id.toLowerCase() || !text(value.assignedTechnician.name,100)) return fail();
  if (!isUuid(value.createdByAccountId) || !isUuid(value.assignedByAccountId) || value.createdByAccountId !== value.createdByAccountId.toLowerCase() || value.assignedByAccountId !== value.createdByAccountId || !isCanonicalTimestamp(value.createdAt) || value.assignedAt !== value.createdAt) return fail();
  return value as OrderDetail;
}
