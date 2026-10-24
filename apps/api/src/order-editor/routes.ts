import type { FastifyInstance, FastifyRequest } from 'fastify';
import { isUuid, isUuidV4 } from '@sejuk/contracts/service-orders';
import type { EditorOperation } from '@sejuk/contracts/drafts';
import { requireAdmin, authorizeAdmin, getSessionToken } from '../auth/index.js';
import { transaction } from '../db.js';
import { parseIntent, malformed } from './validation.js';
import { executeEditorMutation, conflict } from './operations.js';
import { checkOwnedOperation, listSelectableTechnicians, loadOwnedDraft } from './queries.js';
export const EDITOR_BODY_LIMIT=196608;
function noQuery(request:FastifyRequest){if(request.url.includes('?'))malformed();}
function readInput(request:FastifyRequest){noQuery(request);if(request.body!==undefined||(request.headers['content-length']!==undefined&&request.headers['content-length']!=='0')||request.headers['transfer-encoding'])malformed();}
export function registerOrderEditorRoutes(app:FastifyInstance):void{
  app.get('/api/technicians',async(request,reply)=>{await requireAdmin(request,reply);readInput(request);return {data:{technicians:await listSelectableTechnicians(app.db)}};});
  app.get<{Params:{draftId:string}}>('/api/drafts/:draftId',async(request,reply)=>{const actor=await requireAdmin(request,reply);readInput(request);if(!isUuid(request.params.draftId))malformed();return {data:await loadOwnedDraft(app.db,actor,request.params.draftId.toLowerCase())};});
  app.get<{Params:{operationKey:string}}>('/api/order-editor-operations/:operationKey',async(request,reply)=>{const actor=await requireAdmin(request,reply);readInput(request);if(!isUuidV4(request.params.operationKey))malformed();return {data:await checkOwnedOperation(app.db,actor,request.params.operationKey.toLowerCase())};});
  const routes:[string,'POST'|'PUT'|'DELETE',EditorOperation][]=[['/api/drafts','POST','createDraft'],['/api/drafts/:draftId','PUT','saveDraft'],['/api/drafts/:draftId','DELETE','deleteDraft'],['/api/service-orders','POST','createOrder'],['/api/drafts/:draftId/submit','POST','submitDraft']];
  for(const [url,method,operation] of routes)app.route<{Params:{draftId?:string}}>({url,method,bodyLimit:EDITOR_BODY_LIMIT,handler:async(request,reply)=>{
    await requireAdmin(request,reply);noQuery(request);const key=request.headers['idempotency-key'];const intent=parseIntent(operation,request.params.draftId,request.body,key);
    try{const outcome=await transaction(app.db,async(client)=>{await client.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');const actor=await authorizeAdmin(client,getSessionToken(request));return executeEditorMutation(client,actor,intent,(key as string).toLowerCase());});return reply.code(outcome.status).send({data:outcome.result});}
    catch(error){if((error as {code?:string}).code==='55P03')conflict('OPERATION_BUSY');throw error;}
  }});
}
