import {describe,it,expect,vi} from 'vitest';
import {parseListingQuery} from './cursor.js';
import {listOrderSummaries,listDraftSummaries} from './queries.js';
import {decodeListingCursor} from '@sejuk/contracts/listing-cursor';
import type {Queryable} from '../db.js';
const row=(n:number)=>({id:`30000000-0000-4000-8000-${String(n).padStart(12,'0')}`,boundary_at:'2026-10-23T07:40:00.123456Z',created_at:new Date('2026-10-23T07:40:00.123Z'),last_saved_at:new Date('2026-10-23T07:40:00.123Z'),order_number_value:String(n),customer_name:'  Demo  ',service_type:'repair',technician_id:null,technician_name:null,quoted_price_sen:0,quoted_price_input:'12.',status:'assigned',currency:'MYR'});
describe('listing query',()=>{
 it.each(['?cursor=','?cursor=a&cursor=b','?limit=25','?cursor[]=a'])('rejects invalid query %s',query=>expect(()=>parseListingQuery(`/api/service-orders${query}`,'orders')).toThrow());
 it.each([0,1,25,26])('handles %i rows with lookahead',async n=>{const query=vi.fn().mockResolvedValue({rows:Array.from({length:n},(_,i)=>row(i+1))});const page=await listOrderSummaries({query} as unknown as Queryable,null);expect(page.items).toHaveLength(Math.min(25,n));expect(page.pagination.hasNextPage).toBe(n>25);if(n>25)expect(decodeListingCursor(page.pagination.nextCursor!,'orders').id).toBe(row(25).id);else expect(page.pagination.nextCursor).toBeNull();expect(query.mock.calls[0]![0]).toContain('LIMIT 26');});
 it('scopes drafts in SQL and projects incomplete data without raw input',async()=>{const query=vi.fn().mockResolvedValue({rows:[row(1)]});const page=await listDraftSummaries({query} as unknown as Queryable,{accountId:'actor',role:'admin'},null);expect(query.mock.calls[0]![0]).toContain('d.creator_account_id=$1::uuid AND d.submitted_order_id IS NULL');expect(query.mock.calls[0]![1]).toEqual(['actor']);expect(page.items[0]).toMatchObject({customerName:'Demo',quotedPrice:{kind:'incomplete'},proposedTechnician:null});expect(page.items[0]).not.toHaveProperty('quotedPriceInput');});
});
