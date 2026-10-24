import type {Page,OrderSummary,DraftSummary} from '@sejuk/contracts/listings';
import {apiRequest} from './client';
export function fetchOrders(cursor:string|null,signal:AbortSignal):Promise<Page<OrderSummary>>{return apiRequest(`/service-orders${cursor===null?'':`?${new URLSearchParams({cursor})}`}`,{signal});}
export function fetchMyDrafts(cursor:string|null,signal:AbortSignal):Promise<Page<DraftSummary>>{return apiRequest(`/drafts${cursor===null?'':`?${new URLSearchParams({cursor})}`}`,{signal});}
