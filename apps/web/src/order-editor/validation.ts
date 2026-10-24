import { isUuid,isValidUnicode,normalizeLineEndings,parsePrice,serviceTypeLabels,type OrderFields } from '@sejuk/contracts/service-orders';
import type { DraftFields } from '@sejuk/contracts/drafts';
export const limits={customerName:200,phone:50,address:2000,problemDescription:5000,adminNotes:5000,quotedPriceInput:32};
export function validateFields(fields:DraftFields,final:boolean):Record<string,string[]>{
 const errors:Record<string,string[]>={};
 for(const [key,max] of Object.entries(limits)){const v=fields[key as keyof DraftFields];if(typeof v!=='string'||!isValidUnicode(v))errors[key]=['Enter valid text.'];else if(Array.from(v).length>max)errors[key]=[`Use ${max} characters or fewer.`];}
 if(fields.serviceType!==null&&!Object.hasOwn(serviceTypeLabels,fields.serviceType))errors.serviceType=['Select a service type.'];
 if(fields.assignedTechnicianId!==null&&!isUuid(fields.assignedTechnicianId))errors.assignedTechnicianId=['Select a technician.'];
 if(final){for(const [key,message] of Object.entries({customerName:'Enter the customer name.',phone:'Enter a phone number.',address:'Enter the address.',problemDescription:'Describe the problem.',quotedPriceInput:'Enter a quoted price.'}))if(!fields[key as keyof DraftFields]?.trim())errors[key]=[message];
 if(fields.phone.trim()&&!/[0-9]/.test(fields.phone))errors.phone=['Enter a phone number containing at least one digit.'];
 if(!fields.serviceType)errors.serviceType=['Select a service type.'];if(!fields.assignedTechnicianId)errors.assignedTechnicianId=['Select a technician.'];
 if(fields.quotedPriceInput.trim())try{parsePrice(fields.quotedPriceInput);}catch(e){errors.quotedPriceInput=[(e as Error).message];}
 }else if(!Object.values(fields).some(v=>typeof v==='string'&&v.trim()))errors._form=['Enter at least one detail before saving a draft.'];
 return errors;
}
export function orderFields(fields:DraftFields):OrderFields{return {customerName:normalizeLineEndings(fields.customerName).trim(),phone:normalizeLineEndings(fields.phone).trim(),address:normalizeLineEndings(fields.address).trim(),problemDescription:normalizeLineEndings(fields.problemDescription).trim(),serviceType:fields.serviceType!,quotedPrice:parsePrice(fields.quotedPriceInput).amount,assignedTechnicianId:fields.assignedTechnicianId!,adminNotes:normalizeLineEndings(fields.adminNotes).trim()||null};}
