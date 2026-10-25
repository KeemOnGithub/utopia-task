import { afterAll,beforeAll,describe,expect,it,vi } from 'vitest';
import { isolatedDatabase } from '../../../../tests/support/database.js';
import { buildApp } from '../app.js';
import { hashPassword } from './password.js';
import { generateToken,hashToken } from './session.js';
import { admitLogin } from './rate-limit.js';
import { runAccountCommand } from '../cli/accounts.js';
import type { FastifyInstance } from 'fastify';

describe('real PostgreSQL auth boundary',()=>{
  let db:Awaited<ReturnType<typeof isolatedDatabase>>;let app:FastifyInstance;let accountId:string;
  const headers={origin:'http://localhost:5173','x-csrf-protection':'1','content-type':'application/json'};
  beforeAll(async()=>{
    db=await isolatedDatabase(25744);
    app=buildApp({databaseUrl:db.runtimeUrl,publicOrigin:'http://localhost:5173',production:false,port:3000,poolMax:10,trustedProxy:[],hmacSecret:'auth-test-secret-32-bytes-long-00000'},db.runtime);
    const hash=await hashPassword('synthetic password');
    accountId=(await db.owner.query("INSERT INTO app_private.accounts(email,password_hash,role) VALUES('auth@example.test',$1,'admin') RETURNING id",[hash])).rows[0].id;
  },120000);
  afterAll(async()=>{await app?.close();await db?.close();},30000);
  it('logs in with a fresh HttpOnly cookie and authorizes without writing cookies',async()=>{
    const login=await app.inject({method:'POST',url:'/api/auth/login',headers,payload:{email:' AUTH@Example.Test ',password:'synthetic password'}});
    expect(login.statusCode).toBe(200);expect(login.headers['set-cookie']).toMatch(/dev_session=[\w-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=28800/);
    expect(login.json().data.user).toEqual({id:accountId,email:'auth@example.test',role:'admin'});expect(login.body).not.toContain('password');
    const cookie=String(login.headers['set-cookie']).split(';')[0]!;
    const session=await app.inject({url:'/api/auth/session',headers:{cookie}});expect(session.statusCode).toBe(200);expect(session.headers['set-cookie']).toBeUndefined();expect(session.headers['cache-control']).toBe('no-store');
    const raw=cookie.split('=')[1]!;const stored=await db.owner.query('SELECT token_hash FROM app_private.sessions WHERE account_id=$1',[accountId]);expect(stored.rows[0].token_hash.equals(hashToken(raw))).toBe(true);
    const logout=await app.inject({method:'POST',url:'/api/auth/logout',headers:{...headers,cookie},payload:{}});expect(logout.statusCode).toBe(204);expect(logout.body).toBe('');expect(logout.headers['set-cookie']).toContain('Max-Age=0');
    const expired=await app.inject({url:'/api/auth/session',headers:{cookie}});expect(expired.statusCode).toBe(401);expect(expired.headers['set-cookie']).toBeUndefined();
  });
  it('keeps failed credential and CSRF responses cookie-neutral',async()=>{
    const wrong=await app.inject({method:'POST',url:'/api/auth/login',headers,payload:{email:'auth@example.test',password:'wrong password'}});expect(wrong.statusCode).toBe(401);expect(wrong.json().error.code).toBe('INVALID_CREDENTIALS');expect(wrong.headers['set-cookie']).toBeUndefined();
    for(const origin of [undefined,'null','https://evil.test']){
      const testHeaders:Record<string,string>={...headers};delete testHeaders.origin;if(origin!==undefined)testHeaders.origin=origin;
      const rejected=await app.inject({method:'POST',url:'/api/auth/logout',headers:testHeaders,payload:{}});expect(rejected.statusCode).toBe(403);expect(rejected.json().error.code).toBe('CSRF_REJECTED');expect(rejected.headers['set-cookie']).toBeUndefined();
    }
  });
  it('observes role/activity/expiry live and logout revokes only the presented token',async()=>{
    const a=generateToken(),b=generateToken();
    await db.owner.query("INSERT INTO app_private.sessions(token_hash,account_id,expires_at) VALUES($1,$3,now()+interval '8 hours'),($2,$3,now()+interval '8 hours')",[hashToken(a),hashToken(b),accountId]);
    await db.owner.query("UPDATE app_private.accounts SET role='manager' WHERE id=$1",[accountId]);
    const mgr=await app.inject({url:'/api/auth/session',headers:{cookie:`dev_session=${a}`}});expect(mgr.statusCode).toBe(200);expect(mgr.json().data.user.role).toBe('manager');
    await db.owner.query("UPDATE app_private.accounts SET role='technician' WHERE id=$1",[accountId]);
    const denied=await app.inject({url:'/api/auth/session',headers:{cookie:`dev_session=${a}`}});expect(denied.statusCode).toBe(403);expect(denied.headers['set-cookie']).toBeUndefined();
    await db.owner.query('UPDATE app_private.accounts SET is_active=false WHERE id=$1',[accountId]);
    expect((await app.inject({url:'/api/auth/session',headers:{cookie:`dev_session=${a}`}})).statusCode).toBe(401);
    expect((await app.inject({method:'POST',url:'/api/auth/logout',headers:{...headers,cookie:`dev_session=${a}`},payload:{}})).statusCode).toBe(204);
    expect((await db.owner.query('SELECT 1 FROM app_private.sessions WHERE token_hash=$1',[hashToken(b)])).rowCount).toBe(1);
    await db.owner.query("UPDATE app_private.accounts SET role='admin',is_active=true WHERE id=$1",[accountId]);
    await db.owner.query("UPDATE app_private.sessions SET created_at=now()-interval '9 hours',expires_at=now() WHERE token_hash=$1",[hashToken(b)]);
    expect((await app.inject({url:'/api/auth/session',headers:{cookie:`dev_session=${b}`}})).statusCode).toBe(401);
  });
  it('admits exactly five concurrent email attempts and never extends blocked windows',async()=>{
    const now=new Date('2026-10-23T16:00:00Z');const secret='limiter-isolated-test-secret-000000';
    const admitted=await Promise.all(Array.from({length:12},()=>admitLogin(db.runtime,'rate@example.test','192.0.2.8',now,secret)));
    expect(admitted.filter(result=>result.allowed)).toHaveLength(5);expect(admitted.filter(result=>!result.allowed).every(result=>result.retryAfterSeconds===900)).toBe(true);
    const blocked=await admitLogin(db.runtime,'rate@example.test','192.0.2.8',new Date(now.getTime()+1000),secret);expect(blocked).toEqual({allowed:false,retryAfterSeconds:899});
    expect((await admitLogin(db.runtime,'rate@example.test','192.0.2.8',new Date(now.getTime()+900000),secret)).allowed).toBe(true);
  });
  it('enforces the exact runtime privilege boundary',async()=>{
    await expect(db.runtime.query("UPDATE app_private.accounts SET is_active=false WHERE id=$1",[accountId])).rejects.toThrow();
    await expect(db.runtime.query('DELETE FROM app_private.login_limits')).rejects.toThrow();
    await expect(db.runtime.query('UPDATE app_private.sessions SET expires_at=expires_at')).rejects.toThrow();
    await expect(db.runtime.query('TRUNCATE app_private.sessions')).rejects.toThrow();
    await db.runtime.query('BEGIN');await db.runtime.query('SELECT id FROM app_private.accounts WHERE id=$1 FOR UPDATE',[accountId]);await db.runtime.query('ROLLBACK');
  });
  it('shares a thirty-attempt IP allowance across distinct emails',async()=>{
    const now=new Date('2026-10-23T17:00:00Z');
    const results=await Promise.all(Array.from({length:36},(_,i)=>admitLogin(db.runtime,`distinct-${i}@example.test`,'::ffff:192.0.2.9',now,'different-ip-test-secret-0000000000')));
    expect(results.filter(result=>result.allowed)).toHaveLength(30);
    expect((await admitLogin(db.runtime,'one-more@example.test','192.0.2.9',now,'different-ip-test-secret-0000000000')).allowed).toBe(false);
  });
  it('operator tooling normalizes accounts, revokes on password/deactivation and never logs secrets',async()=>{
    const previous=process.env.PROVISION_DATABASE_URL;process.env.PROVISION_DATABASE_URL=db.ownerUrl;
    const audit=vi.spyOn(console,'info').mockImplementation(()=>{});
    const prompt=vi.fn(async()=> 'operator synthetic password');
    try {
      await runAccountCommand(['create-admin',' CLI@Example.Test '],prompt);
      const id=(await db.owner.query("SELECT id FROM app_private.accounts WHERE email='cli@example.test'")).rows[0].id;
      await expect(runAccountCommand(['create-admin','cli@example.test'],prompt)).rejects.toThrow('already exists');
      const seed=async()=>{const token=generateToken();await db.owner.query("INSERT INTO app_private.sessions(token_hash,account_id,expires_at) VALUES($1,$2,now()+interval '8 hours')",[hashToken(token),id]);return token;};
      await seed();await runAccountCommand(['replace-password',id],prompt);expect((await db.owner.query('SELECT 1 FROM app_private.sessions WHERE account_id=$1',[id])).rowCount).toBe(0);
      await seed();await runAccountCommand(['deactivate',id],prompt);expect((await db.owner.query('SELECT is_active FROM app_private.accounts WHERE id=$1',[id])).rows[0].is_active).toBe(false);
      await runAccountCommand(['activate',id],prompt);expect((await db.owner.query('SELECT 1 FROM app_private.sessions WHERE account_id=$1',[id])).rowCount).toBe(0);
      await seed();await runAccountCommand(['revoke-sessions',id],prompt);expect((await db.owner.query('SELECT 1 FROM app_private.sessions WHERE account_id=$1',[id])).rowCount).toBe(0);
      await runAccountCommand(['create-manager',' MGR@Example.Test '],prompt);
      const mgrId=(await db.owner.query("SELECT id,role FROM app_private.accounts WHERE email='mgr@example.test'")).rows[0];
      expect(mgrId.role).toBe('manager');
      await runAccountCommand(['cleanup-auth'],prompt);
      await runAccountCommand(['cleanup-ai'],prompt);
      expect(JSON.stringify(audit.mock.calls)).not.toContain('operator synthetic password');expect(JSON.stringify(audit.mock.calls)).not.toContain('cli@example.test');
      await expect(runAccountCommand(['create-admin','test@example.test','argv-password'],prompt)).rejects.toThrow('hidden prompts');
    } finally {audit.mockRestore();if(previous===undefined)delete process.env.PROVISION_DATABASE_URL;else process.env.PROVISION_DATABASE_URL=previous;}
  },15000);
});
