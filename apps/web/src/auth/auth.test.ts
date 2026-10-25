import { describe,it,expect } from 'vitest';
import { encodeListingCursor } from '@sejuk/contracts/listing-cursor';
import { safeReturnPath } from './safe-return';
import { recoveryStore } from './recovery';
describe('safe return targets',()=>{
  it('accepts only known paths and canonicalizes UUIDs',()=>{
    expect(safeReturnPath('/orders/AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA')).toBe('/orders/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(safeReturnPath('/operations-assistant')).toBe('/operations-assistant');
    expect(safeReturnPath('/operations-assistant?x=1')).toBe('/orders');
    expect(safeReturnPath('/drafts','manager')).toBe('/orders');
    expect(safeReturnPath('/orders/new','manager')).toBe('/orders');
    expect(safeReturnPath('/operations-assistant','manager')).toBe('/operations-assistant');
    for(const value of ['https://evil.test','//evil.test','/orders\\new','/orders%2fnew','/orders/new#x','/unknown','/orders/new?x=y','/orders?cursor=','/orders?cursor=x&cursor=y','/orders?cursor=%ZZ'])expect(safeReturnPath(value)).toBe('/orders');
  });
  it('retains only one validated kind-matched listing cursor',()=>{
    const cursor=encodeListingCursor({v:1,kind:'drafts',at:'2026-10-23T16:00:00.000001Z',id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'});
    expect(safeReturnPath(`/drafts?cursor=${cursor}`)).toBe(`/drafts?cursor=${cursor}`);expect(safeReturnPath(`/orders?cursor=${cursor}`)).toBe('/orders');
  });
});
describe('memory-only recovery',()=>{
  it('consumes only same-account state and destroys mismatches',()=>{
    recoveryStore.capture({accountId:'a',returnPath:'/orders/new',payload:{key:'opaque'}});
    expect(recoveryStore.takeFor('b')).toBe(null);expect(recoveryStore.takeFor('a')).toBe(null);
    recoveryStore.capture({accountId:'a',returnPath:'/orders/new',payload:{key:'opaque'}});
    expect(recoveryStore.takeFor('a')?.payload).toEqual({key:'opaque'});expect(recoveryStore.takeFor('a')).toBe(null);
  });
});
