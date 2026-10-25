import type {FastifyRequest} from 'fastify';
import {AppError} from './errors.js';
export function assertMutationOrigin(request:FastifyRequest){
 const origin=request.headers.origin;
 const isVercelSameOrigin=Boolean(process.env.VERCEL&&origin&&origin===`https://${request.headers.host}`&&(request.headers.host?.endsWith('.vercel.app')||false));
 if((origin!==request.server.config.publicOrigin&&!isVercelSameOrigin)||request.headers['x-csrf-protection']!=='1')throw new AppError(403,'CSRF_REJECTED','The request origin could not be verified.');
 if(!/^application\/json(?:\s*;\s*charset=(?:utf-8|"utf-8"))?\s*$/i.test(request.headers['content-type']??'')||!['identity',undefined].includes(request.headers['content-encoding']?.toLowerCase()))throw new AppError(415,'UNSUPPORTED_MEDIA_TYPE','Use an uncompressed JSON request.');
}
