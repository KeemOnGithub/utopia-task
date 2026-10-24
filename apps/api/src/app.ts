import './context.js';
import Fastify from 'fastify';
import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import type {Config} from './config.js';
import {createPool} from './db.js';
import {AppError,sendApiError} from './errors.js';
import {assertMutationOrigin} from './security.js';
import {registerAuthRoutes} from './auth/routes.js';
import {registerListingRoutes} from './listings/routes.js';
import {registerOrderEditorRoutes} from './order-editor/routes.js';
import {registerOrderDetailRoutes} from './order-detail/routes.js';
export function buildApp(config:Config,pool?:Pool){
 const app=Fastify({logger:false,requestIdHeader:false,genReqId:()=>randomUUID(),trustProxy:config.trustedProxy.length?config.trustedProxy:false,bodyLimit:196608});
 app.decorate('config',config);app.decorate('db',pool??createPool(config));
 app.addHook('onRequest',async(req,reply)=>{reply.header('X-Request-ID',req.id).header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff').header('Referrer-Policy','no-referrer').header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");if(req.url.startsWith('/api')&&['POST','PUT','PATCH','DELETE'].includes(req.method))assertMutationOrigin(req);});
 app.setErrorHandler((error,req,reply)=>{if(error instanceof AppError)return sendApiError(reply,error,req.id);const code=(error as {code?:string}).code;const status=code==='FST_ERR_CTP_BODY_TOO_LARGE'?413:code==='FST_ERR_CTP_INVALID_MEDIA_TYPE'?415:(error as {statusCode?:number}).statusCode===400?400:undefined;return sendApiError(reply,status?new AppError(status,status===413?'PAYLOAD_TOO_LARGE':status===415?'UNSUPPORTED_MEDIA_TYPE':'MALFORMED_REQUEST','The request could not be read.'):error,req.id);});
 app.setNotFoundHandler((req,reply)=>sendApiError(reply,new AppError(404,'NOT_FOUND','Not found.'),req.id));
 registerAuthRoutes(app);registerListingRoutes(app);registerOrderEditorRoutes(app);registerOrderDetailRoutes(app);
 app.addHook('onClose',async()=>{if(!pool)await app.db.end();});return app;
}
