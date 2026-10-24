import {describe,it,expect} from 'vitest';
import {encodeListingCursor,decodeListingCursor,type CursorPosition} from './listing-cursor.js';
const position:CursorPosition={v:1,kind:'orders',at:'2026-10-23T07:40:00.123456Z',id:'30000000-0000-4000-8000-000000000001'};
const token=(text:string)=>Buffer.from(text).toString('base64url');
describe('listing cursor',()=>{
 it('preserves microseconds and canonicalizes UUID',()=>{expect(decodeListingCursor(encodeListingCursor(position),'orders')).toEqual(position);expect(encodeListingCursor({...position,id:position.id.toUpperCase()})).toBe(encodeListingCursor(position));});
 it.each(['','a','abc=','!','x'.repeat(1025)])('rejects malformed encoding %s',input=>expect(()=>decodeListingCursor(input,'orders')).toThrow());
 it.each(['0000-01-01T00:00:00.000000Z','2026-02-29T00:00:00.000000Z','1900-02-29T00:00:00.000000Z','2026-13-01T00:00:00.000000Z','2026-01-01T24:00:00.000000Z','2026-01-01T00:00:60.000000Z','2026-01-01T00:00:00.000Z'])('rejects invalid calendar %s',at=>expect(()=>decodeListingCursor(token(JSON.stringify({...position,at})),'orders')).toThrow());
 it('accepts Gregorian leap day',()=>expect(decodeListingCursor(encodeListingCursor({...position,at:'2000-02-29T00:00:00.000001Z'}),'orders').at).toContain('.000001'));
 it('rejects duplicate/unknown keys, wrong kind/version, whitespace and invalid UTF8',()=>{for(const input of [JSON.stringify(position).replace('"v":1','"v":1,"v":1'),JSON.stringify({...position,extra:1}),JSON.stringify({...position,v:2}),` ${JSON.stringify(position)}`])expect(()=>decodeListingCursor(token(input),'orders')).toThrow();expect(()=>decodeListingCursor(encodeListingCursor(position),'drafts')).toThrow();expect(()=>decodeListingCursor(Buffer.from([0xff]).toString('base64url'),'orders')).toThrow();});
});
