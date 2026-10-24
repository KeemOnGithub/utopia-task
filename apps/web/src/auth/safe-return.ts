import { decodeListingCursor } from '@sejuk/contracts/listing-cursor';
const uuid='[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
export function safeReturnPath(input:unknown):string {
  if(typeof input!=='string' || !input.startsWith('/') || input.startsWith('//') || /[\\#%]/.test(input.split('?')[0]!) || input.includes('#'))return '/orders';
  const [path,query,...extra]=input.split('?');
  if(extra.length)return '/orders';
  const listing=path==='/orders'?'orders':path==='/drafts'?'drafts':null;
  if(!listing && path!=='/orders/new' && !new RegExp(`^/orders/${uuid}$`).test(path!) && !new RegExp(`^/drafts/${uuid}/edit$`).test(path!))return '/orders';
  if(query!==undefined){
    if(!listing || /%(?![0-9a-f]{2})/i.test(query))return '/orders';
    const params=new URLSearchParams(query);const values=[...params];
    if(values.length!==1 || values[0]![0]!=='cursor' || !values[0]![1])return '/orders';
    try{decodeListingCursor(values[0]![1],listing);}catch{return '/orders';}
    return `${path}?${new URLSearchParams({cursor:values[0]![1]})}`;
  }
  return path!.toLowerCase();
}
