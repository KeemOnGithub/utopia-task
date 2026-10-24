import {decodeListingCursor,type ListKind} from '@sejuk/contracts/listing-cursor';
import {AppError} from '../errors.js';
export {encodeListingCursor} from '@sejuk/contracts/listing-cursor';
export function parseListingQuery(url:string,kind:ListKind){
  const query=new URL(url,'http://localhost').searchParams;
  if([...query.keys()].some(key=>key!=='cursor')||query.getAll('cursor').length>1)throw malformed();
  const token=query.get('cursor');
  if(token===null)return null;
  try{return decodeListingCursor(token,kind);}catch{throw malformed();}
}
export function malformed(){return new AppError(400,'MALFORMED_REQUEST','This list location is no longer valid. Return to the newest page.');}
