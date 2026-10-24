import { normalizeUuid } from './service-orders.js';
export type ListKind = 'orders'|'drafts';
export type CursorPosition = {v:1;kind:ListKind;at:string;id:string};
export class ListingCursorError extends Error { constructor(){super('This list location is no longer valid. Return to the newest page.');} }
function validate(value:unknown,kind:ListKind):CursorPosition {
  if(!value || typeof value!=='object' || Array.isArray(value)||!['orders','drafts'].includes(kind)) throw new ListingCursorError();
  const p=value as Record<string,unknown>;
  if(Object.keys(p).join(',')!=='v,kind,at,id'||p.v!==1||p.kind!==kind||typeof p.at!=='string'||typeof p.id!=='string') throw new ListingCursorError();
  const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6})Z$/.exec(p.at);
  if(!m)throw new ListingCursorError();
  const year=Number(m[1]),month=Number(m[2]),day=Number(m[3]),hour=Number(m[4]),minute=Number(m[5]),second=Number(m[6]);
  const leap=year%4===0&&(year%100!==0||year%400===0);
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  if(year<1||month<1||month>12||day<1||day>(days[month-1]??0)||hour>23||minute>59||second>59)throw new ListingCursorError();
  try{return {v:1,kind,at:p.at,id:normalizeUuid(p.id)};}catch{throw new ListingCursorError();}
}
function encode(p:CursorPosition):string {const bytes=new TextEncoder().encode(JSON.stringify(p));return btoa(Array.from(bytes,b=>String.fromCharCode(b)).join('')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
export function encodeListingCursor(position:CursorPosition):string {return encode(validate(position,position.kind));}
export function decodeListingCursor(token:string,kind:ListKind):CursorPosition {
  try {
    if(typeof token!=='string'||!token.length||token.length>1024||!/^[A-Za-z0-9_-]+$/.test(token))throw new ListingCursorError();
    const raw=atob(token.replace(/-/g,'+').replace(/_/g,'/'));
    if(raw.length>768)throw new ListingCursorError();
    const text=new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(raw,c=>c.charCodeAt(0)));
    const parsed=JSON.parse(text) as unknown;
    const position=validate(parsed,kind);
    // Re-encoding rejects duplicate keys, whitespace, alternate escapes and base64 pad bits.
    const original=parsed as CursorPosition;
    if(encode(original)!==token)throw new ListingCursorError();
    return position;
  }catch{throw new ListingCursorError();}
}
