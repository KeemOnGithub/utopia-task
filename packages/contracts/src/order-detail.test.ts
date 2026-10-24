import { describe, expect, it } from 'vitest';
import { validateOrderDetail, isCanonicalTimestamp, OrderDetailConsistencyError } from './order-detail.js';
export const detailFixture = {
  id:'30000000-0000-4000-8000-000000000001',orderNumber:'SO-000001',customerName:'Demo Customer A',phone:'+60 12 345 6789',address:'12 Demo Street\nShah Alam',problemDescription:'Air conditioner is not cooling.',serviceType:'repair',quotedPrice:{currency:'MYR',amount:'150.00'},assignedTechnician:{id:'10000000-0000-4000-8000-000000000001',name:'Ali'},adminNotes:null,status:'assigned',createdByAccountId:'50000000-0000-4000-8000-000000000001',createdAt:'2026-10-23T07:40:00.000Z',assignedByAccountId:'50000000-0000-4000-8000-000000000001',assignedAt:'2026-10-23T07:40:00.000Z',
};
describe('exact order detail boundary',()=>{
  it('accepts canonical fixture, zero/max money and expanded numbers',()=>{
    expect(validateOrderDetail(detailFixture,detailFixture.id.toUpperCase())).toBe(detailFixture);
    for(const amount of ['0.00','999999.99']) expect(validateOrderDetail({...detailFixture,orderNumber:'SO-1000000',quotedPrice:{currency:'MYR',amount}},detailFixture.id).quotedPrice.amount).toBe(amount);
  });
  it.each([
    {id:'30000000-0000-4000-8000-000000000002'},{extra:'secret'},{adminNotes:''},{customerName:' padded '},{phone:'no digits'},
    {address:'line\rbreak'},{problemDescription:'\uD800'},{serviceType:'other'},{status:'closed'},
    {quotedPrice:{currency:'MYR',amount:'01.00'}},{quotedPrice:{currency:'MYR',amount:'1.1'}},{quotedPrice:{currency:'USD',amount:'1.00'}},
    {assignedTechnician:null},{assignedTechnician:{...detailFixture.assignedTechnician,isActive:true}},
    {createdAt:'2026-02-30T00:00:00.000Z'},{assignedAt:'2026-10-23T07:41:00.000Z'}, {orderNumber:'SO-000000'},
  ])('rejects malformed or mismatched data %j',patch=>{expect(()=>validateOrderDetail({...detailFixture,...patch},detailFixture.id)).toThrow(OrderDetailConsistencyError);});
  it('rejects missing keys and accepts well-formed supplementary unicode',()=>{
    const {phone:_,...missing}=detailFixture;expect(()=>validateOrderDetail(missing,detailFixture.id)).toThrow();
    expect(validateOrderDetail({...detailFixture,customerName:'Customer \u{1F600}'},detailFixture.id).customerName).toContain('\u{1F600}');
  });
  it('validates calendar dates without accepting normalization',()=>{expect(isCanonicalTimestamp('2024-02-29T00:00:00.000Z')).toBe(true);expect(isCanonicalTimestamp('2025-02-29T00:00:00.000Z')).toBe(false);});
});
