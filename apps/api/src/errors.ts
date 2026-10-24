import type {FastifyReply} from 'fastify';
export class AppError extends Error { constructor(public status:number,public code:string,message:string,public fieldErrors?:Record<string,string[]>,public retryAfterSeconds?:number){super(message);} }
export function sendApiError(reply:FastifyReply,error:unknown,requestId:string){
 const code=(error as {code?:string})?.code??'';
 const unavailable=code.startsWith('08')||['ECONNREFUSED','ECONNRESET','ETIMEDOUT','EHOSTUNREACH','ENOTFOUND','57P01','57P02','57P03','53300'].includes(code);
 const e=error instanceof AppError?error:new AppError(unavailable?503:500,unavailable?'SERVICE_UNAVAILABLE':'INTERNAL_ERROR','The request could not be completed. Try again.');
 if(!(error instanceof AppError))console.error(JSON.stringify({event:'api_error',requestId,code:e.code,status:e.status}));
 if(e.retryAfterSeconds) reply.header('Retry-After',e.retryAfterSeconds);
 return reply.code(e.status).send({error:{code:e.code,message:e.message,...(e.fieldErrors?{fieldErrors:e.fieldErrors}:{}),requestId}});
}
