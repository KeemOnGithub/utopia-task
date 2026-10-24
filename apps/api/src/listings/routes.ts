import type {FastifyInstance} from 'fastify';
import {requireAdmin} from '../auth/index.js';
import {parseListingQuery,malformed} from './cursor.js';
import {listOrderSummaries,listDraftSummaries} from './queries.js';
export function registerListingRoutes(app:FastifyInstance):void {
 for(const kind of ['orders','drafts'] as const)app.get(kind==='orders'?'/api/service-orders':'/api/drafts',async(request,reply)=>{
  reply.header('Cache-Control','no-store');
  const actor=await requireAdmin(request,reply);
  if(request.body!==undefined||Number(request.headers['content-length']??0)>0||request.headers['transfer-encoding'])throw malformed();
  const position=parseListingQuery(request.raw.url??request.url,kind);
  return {data:kind==='orders'?await listOrderSummaries(app.db,position):await listDraftSummaries(app.db,actor,position)};
 });
}
