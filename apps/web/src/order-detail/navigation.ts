import { decodeListingCursor } from '../../../../packages/contracts/src/listing-cursor.js';
import { isUuid } from '../../../../packages/contracts/src/service-orders.js';
import type { DetailReturnIntent, OrderListReturn } from '../listings/navigation.js';

export function resolveDetailReturn(creationIntent:boolean,context:unknown):DetailReturnIntent {
  if (creationIntent || !context || typeof context!=='object') return {kind:'newestOrders'};
  const value=context as OrderListReturn;
  if (value.pathname!=='/orders' || !(value.cursor===null || typeof value.cursor==='string') || !(value.originatingItemId===null || isUuid(value.originatingItemId)) || !Number.isFinite(value.scrollY) || value.scrollY<0) return {kind:'newestOrders'};
  try { if(value.cursor!==null) decodeListingCursor(value.cursor,'orders'); } catch { return {kind:'newestOrders'}; }
  return {kind:'restoreOrders',context:{pathname:'/orders',cursor:value.cursor,originatingItemId:value.originatingItemId,scrollY:value.scrollY}};
}
