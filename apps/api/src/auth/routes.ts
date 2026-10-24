import type { FastifyInstance } from 'fastify';
import { transaction } from '../db.js';
import { AppError } from '../errors.js';
import { loginCredentials } from './validation.js';
import { admitLogin } from './rate-limit.js';
import { dummyHash, hashPassword, needsRehash, verifyPassword } from './password.js';
import { generateToken, getSessionToken, hashToken, resolveSession } from './session.js';

const invalid = () => new AppError(401,'INVALID_CREDENTIALS','Invalid email or password.');
function cookie(app:FastifyInstance,token:string,expires:Date,clear=false):string {
  return `${app.config.production?'__Host-session':'dev_session'}=${token}; Path=/; HttpOnly; SameSite=Lax${app.config.production?'; Secure':''}; Max-Age=${clear?0:28800}; Expires=${expires.toUTCString()}`;
}
export function registerAuthRoutes(app:FastifyInstance):void {
  app.post('/api/auth/login',{bodyLimit:4096},async(request,reply)=>{
    const {email,password}=loginCredentials(request.body);
    const admission=await admitLogin(app.db,email,request.ip,new Date(),app.config.hmacSecret);
    if(!admission.allowed)throw new AppError(429,'RATE_LIMITED','Too many sign-in attempts. Try again later.',undefined,admission.retryAfterSeconds);
    let account;
    try { account=(await app.db.query('SELECT id,email,password_hash,role,is_active FROM app_private.accounts WHERE email=$1',[email])).rows[0]; }
    catch { throw new AppError(503,'SERVICE_UNAVAILABLE','Sign in is unavailable. Try again.'); }
    const eligible=account?.is_active && account.role==='admin';
    const verified=await verifyPassword(eligible?account.password_hash:dummyHash,password);
    if(!eligible || !verified)throw invalid();
    const replacement=needsRehash(account.password_hash)?await hashPassword(password):null;
    const token=generateToken();
    const presented=getSessionToken(request);
    const data=await transaction(app.db,async client=>{
      const locked=(await client.query('SELECT id,email,password_hash,role,is_active FROM app_private.accounts WHERE id=$1 FOR UPDATE',[account.id])).rows[0];
      if(!locked?.is_active || locked.role!=='admin' || locked.password_hash!==account.password_hash)throw invalid();
      if(replacement)await client.query('UPDATE app_private.accounts SET password_hash=$1 WHERE id=$2 AND password_hash=$3',[replacement,account.id,account.password_hash]);
      if(presented)await client.query('DELETE FROM app_private.sessions WHERE token_hash=$1',[hashToken(presented)]);
      const {rows}=await client.query("WITH t AS (SELECT clock_timestamp() AS at) INSERT INTO app_private.sessions(token_hash,account_id,created_at,expires_at) SELECT $1,$2,at,at+interval '8 hours' FROM t RETURNING expires_at",[hashToken(token),account.id]);
      return {user:{id:account.id as string,email:account.email as string,role:'admin' as const},expiresAt:new Date(rows[0].expires_at).toISOString()};
    });
    reply.header('Set-Cookie',cookie(app,token,new Date(data.expiresAt)));
    return {data};
  });
  app.get('/api/auth/session',async(request)=>({data:await resolveSession(app.db,getSessionToken(request))}));
  app.post('/api/auth/logout',{bodyLimit:4096},async(request,reply)=>{
    if(!request.body || typeof request.body!=='object' || Array.isArray(request.body) || Object.keys(request.body).length)throw new AppError(400,'MALFORMED_REQUEST','Send an empty JSON object.');
    const token=getSessionToken(request);
    if(token)try { await transaction(app.db,async client=>{await client.query('DELETE FROM app_private.sessions WHERE token_hash=$1',[hashToken(token)]);}); }
    catch { throw new AppError(503,'SERVICE_UNAVAILABLE','Sign-out could not be confirmed. Retry.'); }
    reply.header('Set-Cookie',cookie(app,'',new Date(0),true)).code(204).send();
  });
}
