import type {FastifyInstance} from 'fastify';
import {requireAdmin, requireOrderReader} from '../auth/index.js';
import {parseListingQuery,malformed} from './cursor.js';
import {listOrderSummaries,listDraftSummaries} from './queries.js';
export function registerListingRoutes(app:FastifyInstance):void {
  app.get('/api/service-orders',async(request,reply)=>{
    reply.header('Cache-Control','no-store');
    await requireOrderReader(request,reply);
    if(request.body!==undefined||Number(request.headers['content-length']??0)>0||request.headers['transfer-encoding'])throw malformed();
    const position=parseListingQuery(request.raw.url??request.url,'orders');
    return {data:await listOrderSummaries(app.db,position)};
  });
  app.get('/api/drafts',async(request,reply)=>{
    reply.header('Cache-Control','no-store');
    const actor=await requireAdmin(request,reply);
    if(request.body!==undefined||Number(request.headers['content-length']??0)>0||request.headers['transfer-encoding'])throw malformed();
    const position=parseListingQuery(request.raw.url??request.url,'drafts');
    return {data:await listDraftSummaries(app.db,actor,position)};
  });
}
