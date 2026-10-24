import Fastify from 'fastify';
import { describe,it,expect,vi } from 'vitest';
import type { Pool } from 'pg';
import { AppError,sendApiError } from '../errors.js';
const auth=vi.hoisted(()=>({denied:false}));
vi.mock('../auth/index.js',()=>({requireAdmin:async()=>{if(auth.denied)throw new AppError(401,'UNAUTHENTICATED','Sign in.');return {accountId:'20000000-0000-4000-8000-000000000001',role:'admin'};},authorizeAdmin:vi.fn(),getSessionToken:()=>null}));
import { registerOrderEditorRoutes,EDITOR_BODY_LIMIT } from './routes.js';
import { emptyDraftFields } from '@sejuk/contracts/drafts';
async function app(){const server=Fastify({bodyLimit:EDITOR_BODY_LIMIT});server.decorate('db',{} as Pool);server.setErrorHandler((e,req,reply)=>sendApiError(reply,(e as {code?:string}).code==='FST_ERR_CTP_BODY_TOO_LARGE'?new AppError(413,'PAYLOAD_TOO_LARGE','Too large.'):e,req.id));registerOrderEditorRoutes(server);return server;}
describe('editor request admission',()=>{
 it('admits exactly 196608 bytes for schema validation and rejects 196609 bytes',async()=>{const server=await app();try{for(const [size,status] of [[196608,400],[196609,413]]){const shell='{"padding":""}';const payload=`{"padding":"${'x'.repeat(size!-shell.length)}"}`;expect(Buffer.byteLength(payload)).toBe(size);const response=await server.inject({method:'POST',url:'/api/drafts',headers:{'content-type':'application/json','idempotency-key':'20000000-0000-4000-8000-000000000001'},payload});expect(response.statusCode).toBe(status);}}finally{await server.close();}});
 it('authorizes before malformed key/version/fields domain validation',async()=>{const server=await app();auth.denied=true;try{const response=await server.inject({method:'POST',url:'/api/drafts/invalid/submit',payload:{expectedVersion:'bad',fields:null}});expect(response.statusCode).toBe(401);}finally{auth.denied=false;await server.close();}});
 it('read routes reject query/body rather than doing domain SQL',async()=>{const server=await app();try{for(const url of ['/api/technicians?x=1','/api/drafts/invalid','/api/order-editor-operations/invalid']){const response=await server.inject({url});expect(response.statusCode).toBe(400);}}finally{await server.close();}});
 it.each(['literal','supplementary escapes','BMP escapes','CRLF'])('admits maximum bounded %s fields before semantic validation',async kind=>{
  const fill=(n:number)=>kind==='CRLF'?'\r\n'.repeat(Math.floor(n/2))+(n%2?'x':''):(kind==='BMP escapes'?'\u4e00':'\u{1f600}').repeat(n);
  const fields={...emptyDraftFields(),customerName:fill(200),phone:fill(50),address:fill(2000),problemDescription:fill(5000),quotedPriceInput:fill(32),adminNotes:fill(5000),assignedTechnicianId:'invalid'};
  let payload=JSON.stringify({fields});if(kind==='supplementary escapes')payload=payload.replace(/\u{1f600}/gu,'\\ud83d\\ude00');if(kind==='BMP escapes')payload=payload.replace(/\u4e00/g,'\\u4e00');
  expect(Buffer.byteLength(payload)).toBeLessThan(EDITOR_BODY_LIMIT);const server=await app();try{const response=await server.inject({method:'POST',url:'/api/drafts',headers:{'content-type':'application/json','idempotency-key':'20000000-0000-4000-8000-000000000001'},payload});expect(response.statusCode).toBe(422);expect(Object.keys(response.json().error.fieldErrors)).toEqual(['assignedTechnicianId']);}finally{await server.close();}
 });
});
