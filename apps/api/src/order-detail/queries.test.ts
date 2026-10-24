import { describe,expect,it,vi } from 'vitest';
import type { Queryable } from '../db.js';
import { loadOrderDetail } from './queries.js';
const id='30000000-0000-4000-8000-000000000001';
const row={id,order_number_value:'1000000',customer_name:'Saved customer',phone:'0123',address:'Saved address',problem_description:'Saved problem',service_type:'repair',quoted_price_sen:0,currency:'MYR',assigned_technician_id:'10000000-0000-4000-8000-000000000001',technician_name:'Ali',admin_notes:null,status:'assigned',created_by_account_id:'50000000-0000-4000-8000-000000000001',assigned_by_account_id:'50000000-0000-4000-8000-000000000001',created_at:new Date('2026-10-23T07:40:00.000Z'),assigned_at:new Date('2026-10-23T07:40:00.000Z')};
describe('saved detail projection',()=>{
  it('uses one narrow bound read with historical technician and exact money/number',async()=>{
    const query=vi.fn().mockResolvedValue({rows:[row]});const result=await loadOrderDetail({query} as unknown as Queryable,id);
    expect(result.customerName).toBe('Saved customer');expect(result.orderNumber).toBe('SO-1000000');expect(result.quotedPrice.amount).toBe('0.00');
    expect(query).toHaveBeenCalledTimes(1);expect(query.mock.calls[0]![1]).toEqual([id]);const sql=query.mock.calls[0]![0] as string;
    expect(sql).not.toMatch(/SELECT\s+\*|is_active|JOIN\s+.*accounts|drafts|operations|UPDATE|INSERT/i);
  });
  it('distinguishes missing, malformed rows and database outage without secrets',async()=>{
    await expect(loadOrderDetail({query:vi.fn().mockResolvedValue({rows:[]})} as unknown as Queryable,id)).rejects.toMatchObject({status:404,code:'NOT_FOUND'});
    await expect(loadOrderDetail({query:vi.fn().mockResolvedValue({rows:[{...row,admin_notes:''}]})} as unknown as Queryable,id)).rejects.toMatchObject({status:500,message:'Could not load the service order. Try again.'});
    await expect(loadOrderDetail({query:vi.fn().mockRejectedValue({code:'08006',message:'secret SQL'})} as unknown as Queryable,id)).rejects.toMatchObject({status:503,message:'Could not load the service order. Try again.'});
  });
});
