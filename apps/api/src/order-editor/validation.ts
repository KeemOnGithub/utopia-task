import { isUuid, isUuidV4, isValidUnicode, normalizeLineEndings, parsePrice, serviceTypeLabels, type OrderFields } from '@sejuk/contracts/service-orders';
import { isDraftVersion, type DraftFields, type EditorOperation } from '@sejuk/contracts/drafts';
import { AppError } from '../errors.js';
export const FIELD_LIMITS = {customerName:200,phone:50,address:2000,problemDescription:5000,adminNotes:5000} as const;
export function malformed():never { throw new AppError(400,'MALFORMED_REQUEST','Invalid editor request.'); }
export function strictObject(value:unknown, keys:string[]):Record<string,unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return malformed();
  const o=value as Record<string,unknown>;
  if (Object.keys(o).length!==keys.length || keys.some(k=>!Object.hasOwn(o,k))) return malformed();
  return o;
}
function normalizeFields(value:unknown, final:boolean): DraftFields | (OrderFields & {quotedPriceSen:number}) {
  const priceKey=final?'quotedPrice':'quotedPriceInput';
  if (!value || typeof value!=='object' || Array.isArray(value)) return malformed();
  const raw=value as Record<string,unknown>;
  const keys=[...Object.keys(FIELD_LIMITS),'serviceType',priceKey,'assignedTechnicianId'];
  if(Object.keys(raw).some(k=>!keys.includes(k))) return malformed();
  const errors:Record<string,string[]>={}; const text:Record<string,string>={};
  for(const [key,limit] of [...Object.entries(FIELD_LIMITS),[priceKey,32]] as [string,number][]){
    let v=raw[key]; if(final&&key==='adminNotes'&&v===null)v='';
    if(typeof v!=='string'){errors[key]=['Enter a valid text value.'];continue;}
    if(!isValidUnicode(v)){errors[key]=['Enter valid text without NUL or unpaired surrogates.'];continue;}
    const normalized=normalizeLineEndings(v);
    if(Array.from(v).length>limit||Array.from(normalized).length>limit){errors[key]=[`Use ${limit} characters or fewer.`];continue;}
    text[key]=final?normalized.trim():normalized;
  }
  const service=raw.serviceType;
  if (!(typeof service==='string'&&Object.hasOwn(serviceTypeLabels,service)) && !(service===null&&!final)) errors.serviceType=[final?'Select a service type.':'Select a valid service type.'];
  const technician=raw.assignedTechnicianId;
  if(!isUuid(technician)&&!(technician===null&&!final))errors.assignedTechnicianId=['Select a technician.'];
  let price:{sen:number;amount:string}|undefined;
  if(final){
    const required={customerName:'Enter the customer name.',phone:'Enter a phone number.',address:'Enter the address.',problemDescription:'Describe the problem.',quotedPrice:'Enter a quoted price.'};
    for(const [key,message] of Object.entries(required))if(text[key]===''&&!errors[key])errors[key]=[message];
    if(text.phone&&!/[0-9]/.test(text.phone))errors.phone=['Enter a phone number containing at least one digit.'];
    if(text.quotedPrice)try{price=parsePrice(text.quotedPrice);}catch(e){errors.quotedPrice=[(e as Error).message];}
  }else if(Object.keys(errors).length===0&&!Object.values(text).some(v=>v.trim())&&service===null&&technician===null)errors._form=['Enter at least one detail before saving a draft.'];
  if(Object.keys(errors).length)throw new AppError(422,'VALIDATION_ERROR','Check the highlighted fields.',errors);
  const common={customerName:text.customerName!,phone:text.phone!,address:text.address!,problemDescription:text.problemDescription!,serviceType:service as DraftFields['serviceType']};
  if(final)return {...common,serviceType:service as OrderFields['serviceType'],quotedPrice:price!.amount,assignedTechnicianId:(technician as string).toLowerCase(),adminNotes:text.adminNotes||null,quotedPriceSen:price!.sen};
  return {...common,quotedPriceInput:text.quotedPriceInput!,assignedTechnicianId:technician===null?null:(technician as string).toLowerCase(),adminNotes:text.adminNotes!};
}
export function normalizeDraftFields(value:unknown):DraftFields{return normalizeFields(value,false) as DraftFields;}
export function normalizeOrderFields(value:unknown):OrderFields & {quotedPriceSen:number}{return normalizeFields(value,true) as OrderFields & {quotedPriceSen:number};}
export type MutationIntent={operation:EditorOperation;targetDraftId:string|null;expectedVersion:number|null;fields:DraftFields|OrderFields|null;quotedPriceSen?:number};
export function parseIntent(operation:EditorOperation,target:unknown,body:unknown,key:unknown):MutationIntent{
  if(!isUuidV4(key))return malformed();
  const targeted=['saveDraft','deleteDraft','submitDraft'].includes(operation);
  if(targeted&&!isUuid(target))return malformed();
  const versioned=targeted;
  const o=strictObject(body,operation==='deleteDraft'?['expectedVersion']:versioned?['expectedVersion','fields']:['fields']);
  if(versioned&&!isDraftVersion(o.expectedVersion))return malformed();
  let fields:MutationIntent['fields']=null;let quotedPriceSen:number|undefined;
  if(operation!=='deleteDraft'){
    if(!o.fields||typeof o.fields!=='object'||Array.isArray(o.fields))return malformed();
    if(operation==='createOrder'||operation==='submitDraft'){const normalized=normalizeOrderFields(o.fields);quotedPriceSen=normalized.quotedPriceSen;const {quotedPriceSen:_,...canonical}=normalized;fields=canonical;}
    else fields=normalizeDraftFields(o.fields);
  }
  return {operation,targetDraftId:targeted?(target as string).toLowerCase():null,expectedVersion:versioned?o.expectedVersion as number:null,fields,...(quotedPriceSen===undefined?{}:{quotedPriceSen})};
}
