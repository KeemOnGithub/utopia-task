export class ApiError extends Error {constructor(public status:number,public code:string,message:string,public fieldErrors?:Record<string,string[]>,public requestId?:string,public retryAfterSeconds?:number){super(message);}}
function structuredError(value:unknown):value is {code:string;message:string;fieldErrors?:Record<string,string[]>;requestId?:string}{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const e=value as Record<string,unknown>;
 return typeof e.code==='string'&&/^[A-Z][A-Z_]{0,63}$/.test(e.code)&&typeof e.message==='string'&&e.message.length>0&&e.message.length<=2000&&(e.requestId===undefined||typeof e.requestId==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(e.requestId))&&(e.fieldErrors===undefined||!!e.fieldErrors&&typeof e.fieldErrors==='object'&&!Array.isArray(e.fieldErrors)&&Object.values(e.fieldErrors).every(messages=>Array.isArray(messages)&&messages.length>0&&messages.every(message=>typeof message==='string')));
}
export async function apiRequest<T>(path:string,options:RequestInit={}):Promise<T>{
 const method=(options.method??'GET').toUpperCase();const headers=new Headers(options.headers);if(!['GET','HEAD'].includes(method)){headers.set('Content-Type','application/json');headers.set('X-CSRF-Protection','1');}
 const r=await fetch(`/api${path}`,{...options,headers,credentials:'same-origin',cache:'no-store'});
 if(r.status===204)return undefined as T;
 const body=await r.json().catch(()=>null);
 if(!r.ok){const e=structuredError(body?.error)?body.error:null;const retry=r.headers.get('Retry-After');const seconds=retry&&/^\d+$/.test(retry)?Number(retry):NaN;throw new ApiError(r.status,e?.code??'HTTP_ERROR',e?.message??'The request could not be completed.',e?.fieldErrors,e?.requestId,Number.isSafeInteger(seconds)&&seconds>=0?seconds:undefined);}
 if(!body||typeof body!=='object'||!Object.hasOwn(body,'data'))throw new Error('The server response could not be verified.');return body.data as T;
}
