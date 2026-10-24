import { describe,it,expect } from 'vitest';
import { parsePrice,formatMoney,moneyFromSen,formatOrderNumber,isValidUnicode } from '@sejuk/contracts/service-orders';
import { emptyDraftFields,deriveDraftPriceSummary,isDraftVersion,isOrderEditorRecoveryV1 } from '@sejuk/contracts/drafts';
import { normalizeDraftFields,normalizeOrderFields,parseIntent } from './validation.js';
import { fingerprintOperation,advisoryLockKey } from './operations.js';
const technician='10000000-0000-4000-8000-000000000001';
const key='20000000-0000-4000-8000-000000000001';
const final={customerName:' Demo ',phone:'+60 012',address:' A\r\nB ',problemDescription:' Problem ',serviceType:'repair',quotedPrice:'00012.5',assignedTechnicianId:technician,adminNotes:'  '};
describe('canonical MYR money and numbers',()=>{
 it.each([['0',0,'0.00'],['0.00',0,'0.00'],['12',1200,'12.00'],['12.5',1250,'12.50'],['00012.50',1250,'12.50'],['999999.99',99999999,'999999.99']])('parses %s exactly',(input,sen,amount)=>expect(parsePrice(input as string)).toEqual({sen,amount}));
 it.each(['-0','1e2','1,000','.5','12.','12.345','1000000','Infinity','MYR 2','0'.repeat(33)])('rejects %s',input=>expect(()=>parsePrice(input)).toThrow());
 it.each([0,1,9,10,99,100,101,99999998,99999999])('round trips sen %i',sen=>{const money=moneyFromSen(sen);expect(parsePrice(money.amount).sen).toBe(sen);expect(formatMoney(money)).toBe(`MYR ${money.amount}`);});
 it.each([['1','SO-000001'],['999999','SO-999999'],['1000000','SO-1000000'],['9007199254740993','SO-9007199254740993']])('formats bigint %s',(input,number)=>expect(formatOrderNumber(input)).toBe(number));
 it('distinguishes draft zero, missing and unfinished',()=>{expect(deriveDraftPriceSummary(' ')).toEqual({kind:'missing'});expect(deriveDraftPriceSummary('0')).toEqual({kind:'money',currency:'MYR',amount:'0.00'});expect(deriveDraftPriceSummary('12.')).toEqual({kind:'incomplete'});});
});
describe('Unicode, structural validation and normalization',()=>{
 it('normalizes final fields but preserves internal spacing',()=>expect(normalizeOrderFields(final)).toMatchObject({customerName:'Demo',address:'A\nB',quotedPrice:'12.50',quotedPriceSen:1250,adminNotes:null}));
 it('counts supplementary code points, rejecting unpaired surrogates and NUL',()=>{expect(isValidUnicode('\u{1f600}')).toBe(true);expect(normalizeDraftFields({...emptyDraftFields(),customerName:'\u{1f600}'.repeat(200)}).customerName).toHaveLength(400);for(const customerName of ['\u{1f600}'.repeat(201),'\ud800','\udfff','\0'])expect(()=>normalizeDraftFields({...emptyDraftFields(),customerName})).toThrow();});
 it('enforces raw limits before LF normalization',()=>expect(()=>normalizeDraftFields({...emptyDraftFields(),customerName:'\r\n'.repeat(101)})).toThrow());
 it('preserves draft whitespace/unfinished input and LF normalizes',()=>expect(normalizeDraftFields({...emptyDraftFields(),phone:' + ',quotedPriceInput:'12.',address:' A\rB '})).toMatchObject({phone:' + ',quotedPriceInput:'12.',address:' A\nB '}));
 it.each(['\u0009','\u000a','\u000b','\u000c','\u000d','\u0020','\u00a0','\u1680','\u2000','\u200a','\u2028','\u2029','\u202f','\u205f','\u3000','\ufeff'])('trims agreed edge %j',space=>{expect(normalizeOrderFields({...final,customerName:`${space}Demo${space}`})).toMatchObject({customerName:'Demo'});expect(()=>normalizeDraftFields({...emptyDraftFields(),customerName:space})).toThrow();});
 it('accepts selected-only draft',()=>expect(normalizeDraftFields({...emptyDraftFields(),serviceType:'repair'})).toMatchObject({serviceType:'repair'}));
 it.each([{...final,phone:'abc'},{...final,customerName:null},{...final,assignedTechnicianId:'bad'},{...final,serviceType:'other'},{...final,status:'assigned'}])('rejects invalid final fields',fields=>expect(()=>normalizeOrderFields(fields)).toThrow());
 it('rejects unknown envelope fields and version structure',()=>{for(const body of [{fields:final,actor:'fake'},{fields:final,expectedVersion:0},{fields:final,expectedVersion:2147483648},{fields:final,expectedVersion:1.1}])expect(()=>parseIntent('submitDraft',key,body,key)).toThrow();});
 it.each([1,2147483647])('accepts version %i',version=>{expect(isDraftVersion(version)).toBe(true);expect(parseIntent('deleteDraft',key,{expectedVersion:version},key).expectedVersion).toBe(version);});
});
describe('retained fingerprint contract',()=>{
 it('final semantic equivalents have equal fingerprints',()=>{const a=parseIntent('createOrder',null,{fields:final},key);const b=parseIntent('createOrder',null,{fields:{...final,quotedPrice:'12.50',customerName:'Demo',address:'A\nB',adminNotes:null}},key);expect(fingerprintOperation(a)).toEqual(fingerprintOperation(b));});
 it('fresh property construction ignores client key order',()=>{const fields=Object.fromEntries(Object.entries(final).reverse());expect(fingerprintOperation(parseIntent('createOrder',null,{fields},key))).toEqual(fingerprintOperation(parseIntent('createOrder',null,{fields:final},key)));});
 it('draft whitespace/version/target/operation remain meaningful',()=>{const a=parseIntent('saveDraft',key,{fields:{...emptyDraftFields(),customerName:'A'},expectedVersion:1},key);for(const b of [{...a,expectedVersion:2},{...a,targetDraftId:technician},{...a,operation:'createDraft' as const},{...a,fields:{...a.fields!,customerName:' A'}}])expect(fingerprintOperation(a)).not.toEqual(fingerprintOperation(b));});
 it('advisory derivation is signed exact int64 and UUID-case invariant',()=>{const a=advisoryLockKey(key,technician);expect(BigInt(a)).toBeGreaterThanOrEqual(-(2n**63n));expect(BigInt(a)).toBeLessThan(2n**63n);expect(a).toBe(advisoryLockKey(key.toUpperCase(),technician.toUpperCase()));});
});
describe('recovery boundary validation',()=>{
 const payload={schemaVersion:1,mode:'new',draftId:null,draftVersion:null,fields:emptyDraftFields(),savedBaseline:emptyDraftFields(),pending:null,submissionKey:null,conflictCode:null,listReturnKey:null};
 it('accepts blank new snapshot without saving it',()=>expect(isOrderEditorRecoveryV1(payload)).toBe(true));
 it.each([{schemaVersion:2},{draftId:key},{fields:{}},{conflictCode:'unknown'},{pending:{operationKey:key,operation:'deleteDraft',targetId:key,requestBody:{expectedVersion:2147483648},state:'uncertain'}}])('rejects malformed payload',changes=>expect(isOrderEditorRecoveryV1({...payload,...changes})).toBe(false));
 it('retains sticky key conflict and original pending request',()=>expect(isOrderEditorRecoveryV1({...payload,conflictCode:'IDEMPOTENCY_CONFLICT',submissionKey:key,pending:{operationKey:key,operation:'createOrder',targetId:null,requestBody:{fields:{...final,customerName:'Demo',quotedPrice:'12.50',adminNotes:null}},state:'uncertain'}})).toBe(true));
});
