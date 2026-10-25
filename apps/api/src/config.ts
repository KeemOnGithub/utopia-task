import ipaddr from 'ipaddr.js';
export type Config={
  databaseUrl:string;
  publicOrigin:string;
  production:boolean;
  host?:string;
  port:number;
  poolMax:number;
  trustedProxy:string[];
  hmacSecret:string;
  aiEnabled?:boolean;
  aiBaseUrl?:string;
  aiApiKey?:string;
  aiModel?:string;
  aiDailyQuestionLimit?:number;
  aiGlobalConcurrency?:number;
};
export function loadConfig(env:NodeJS.ProcessEnv=process.env):Config{
 const mode=env.NODE_ENV??'development';if(!['development','test','production'].includes(mode))throw new Error('Invalid NODE_ENV');
 const production=mode==='production';
 let origin:URL;try{origin=new URL(env.PUBLIC_ORIGIN??'http://localhost:5173');}catch{throw new Error('Invalid PUBLIC_ORIGIN');}
 if(!['http:','https:'].includes(origin.protocol))throw new Error('PUBLIC_ORIGIN must use HTTP or HTTPS');
 if(origin.origin!==env.PUBLIC_ORIGIN&&env.PUBLIC_ORIGIN)throw new Error('PUBLIC_ORIGIN must be a canonical origin');
 if(production&&origin.protocol!=='https:')throw new Error('Production requires HTTPS');
 if(!production&&!['localhost','127.0.0.1','[::1]'].includes(origin.hostname))throw new Error('Development cookie mode requires a loopback origin');
 if(!env.DATABASE_URL)throw new Error('DATABASE_URL is required');
 try{const database=new URL(env.DATABASE_URL);if(!['postgres:','postgresql:'].includes(database.protocol)||!database.hostname)throw new Error();}catch{throw new Error('Invalid DATABASE_URL');}
 if(!env.LOGIN_LIMIT_HMAC_SECRET||Buffer.byteLength(env.LOGIN_LIMIT_HMAC_SECRET)<32)throw new Error('LOGIN_LIMIT_HMAC_SECRET requires at least 32 bytes');
 const host=env.HOST??'127.0.0.1';
 const poolMax=Number(env.DB_POOL_MAX??10);if(!Number.isInteger(poolMax)||poolMax<1||poolMax>50)throw new Error('Invalid DB_POOL_MAX');
 const port=Number(env.PORT??3000);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid PORT');
 const trustedProxy=env.TRUSTED_PROXY_CIDRS?.split(',').map(value=>value.trim()).filter(Boolean)??[];
 try{for(const address of trustedProxy){if(address.includes('/')){if(ipaddr.parseCIDR(address)[1]===0)throw new Error();}else ipaddr.parse(address);}}catch{throw new Error('TRUSTED_PROXY_CIDRS requires specific IP addresses or non-global CIDRs');}
 const aiEnabled=env.AI_ENABLED==='true';
 let aiBaseUrl:string|undefined;
 if(aiEnabled){
   if(!env.AI_BASE_URL)throw new Error('AI_BASE_URL is required when AI is enabled');
   try{
     const u=new URL(env.AI_BASE_URL);
     if(u.search||u.hash||u.username||u.password)throw new Error();
     if(production&&u.protocol!=='https:')throw new Error();
     if(!['http:','https:'].includes(u.protocol))throw new Error();
     aiBaseUrl=u.origin+u.pathname.replace(/\/+$/,'');
   }catch{throw new Error('Invalid AI_BASE_URL');}
   if(!env.AI_API_KEY)throw new Error('AI_API_KEY is required when AI is enabled');
   if(!env.AI_MODEL)throw new Error('AI_MODEL is required when AI is enabled');
 }
 const aiDailyQuestionLimit=Number(env.AI_DAILY_QUESTION_LIMIT??500);
 if(!Number.isInteger(aiDailyQuestionLimit)||aiDailyQuestionLimit<1)throw new Error('Invalid AI_DAILY_QUESTION_LIMIT');
 const aiGlobalConcurrency=Number(env.AI_GLOBAL_CONCURRENCY??4);
 if(!Number.isInteger(aiGlobalConcurrency)||aiGlobalConcurrency<1)throw new Error('Invalid AI_GLOBAL_CONCURRENCY');
 return {
   databaseUrl:env.DATABASE_URL,
   publicOrigin:origin.origin,
   production,
   host,
   port,
   poolMax,
   trustedProxy,
   hmacSecret:env.LOGIN_LIMIT_HMAC_SECRET,
   aiEnabled,
   aiBaseUrl,
   aiApiKey:env.AI_API_KEY,
   aiModel:env.AI_MODEL,
   aiDailyQuestionLimit,
   aiGlobalConcurrency
 };
}
