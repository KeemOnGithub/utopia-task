import { normalizeUuid } from '../../../../packages/contracts/src/service-orders.js';
import { validateOrderDetail, type OrderDetail } from '../../../../packages/contracts/src/order-detail.js';
import { apiRequest } from './client.js';

export async function fetchOrderDetail(orderId: string, signal: AbortSignal): Promise<OrderDetail> {
  const id = normalizeUuid(orderId);
  return validateOrderDetail(await apiRequest<unknown>(`/service-orders/${id}`,{signal}),id);
}
