import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { isolatedDatabase } from '../../../../tests/support/database.js';
import { buildApp } from '../app.js';
import { generateToken,hashToken } from '../auth/session.js';

describe('persisted order detail authorization and projection',()=>{
  let db:Awaited<ReturnType<typeof isolatedDatabase>>;let app:FastifyInstance;
  let orderId:string;let actor:string;const cookies:string[]=[];
  beforeAll(async()=>{
    db=await isolatedDatabase(25746);
    app=buildApp({databaseUrl:db.runtimeUrl,publicOrigin:'http://localhost:5173',production:false,port:3000,poolMax:10,trustedProxy:[],hmacSecret:'detail-test-secret-32-bytes-long-0000'},db.runtime);
    for(const [index,role] of ['admin','admin','manager'].entries()){
      const id=(await db.owner.query('INSERT INTO app_private.accounts(email,password_hash,role) VALUES($1,$2,$3) RETURNING id',[`detail${index}@example.test`,'synthetic-not-used-for-login',role])).rows[0].id;
      actor??=id;const token=generateToken();cookies.push(`dev_session=${token}`);
      await db.owner.query("INSERT INTO app_private.sessions(token_hash,account_id,expires_at) VALUES($1,$2,now()+interval '8 hours')",[hashToken(token),id]);
    }
    orderId=(await db.owner.query(`INSERT INTO app_private.service_orders(order_number_value,customer_name,phone,address,problem_description,service_type,quoted_price_sen,currency,assigned_technician_id,admin_notes,created_by_account_id,assigned_by_account_id,created_at,assigned_at)
      VALUES(1000000,'Persisted authority','012345','Saved line one'||chr(10)||'Saved line two','Saved problem','repair',99999999,'MYR','10000000-0000-4000-8000-000000000001',NULL,$1,$1,'2026-10-23T07:40:00.123456Z','2026-10-23T07:40:00.123456Z') RETURNING id`,[actor])).rows[0].id;
  },120000);
  afterAll(async()=>{await app?.close();await db?.close();},30000);
  it('returns persisted data identically to both admins, even after technician deactivation',async()=>{
    await db.owner.query("UPDATE app_private.technicians SET is_active=false WHERE id='10000000-0000-4000-8000-000000000001'");
    for(const cookie of cookies.slice(0,2)){
      const response=await app.inject({url:`/api/service-orders/${orderId.toUpperCase()}`,headers:{cookie}});
      expect(response.statusCode).toBe(200);expect(response.headers['cache-control']).toBe('no-store');expect(response.headers['x-request-id']).toBeTruthy();expect(response.headers['set-cookie']).toBeUndefined();
      const order=response.json().data;expect(order.customerName).toBe('Persisted authority');expect(order.orderNumber).toBe('SO-1000000');expect(order.quotedPrice).toEqual({currency:'MYR',amount:'999999.99'});expect(order.createdAt).toBe('2026-10-23T07:40:00.123Z');expect(order.assignedTechnician.name).toBe('Ali');expect(order.createdByAccountId).toBe(actor);
      expect(Object.keys(order)).toHaveLength(15);expect(response.body).not.toMatch(/password|sourceDraft|session|fingerprint|email/i);
    }
  });
  it('authenticates before invalid-link and missing-record disclosure',async()=>{
    for(const suffix of ['not-a-uuid',orderId]){
      expect((await app.inject({url:`/api/service-orders/${suffix}`})).statusCode).toBe(401);
      expect((await app.inject({url:`/api/service-orders/${suffix}`,headers:{cookie:cookies[2]}})).statusCode).toBe(403);
    }
    for(const suffix of ['not-a-uuid',`${orderId}?created=true`,`${orderId}?x=&x=2`])expect((await app.inject({url:`/api/service-orders/${suffix}`,headers:{cookie:cookies[0]}})).statusCode).toBe(400);
    const missing=await app.inject({url:'/api/service-orders/00000000-0000-0000-0000-000000000000',headers:{cookie:cookies[0]}});expect(missing.statusCode).toBe(404);expect(missing.json().error.message).toBe('Order not found.');expect(missing.headers['set-cookie']).toBeUndefined();
  });
  it('GET leaves domain records and session deadlines unchanged',async()=>{
    const snapshot=async()=> (await db.owner.query(`SELECT (SELECT count(*) FROM app_private.service_orders)::text AS orders,(SELECT count(*) FROM app_private.order_editor_operations)::text AS receipts,(SELECT count(*) FROM app_private.service_order_drafts)::text AS drafts,(SELECT json_agg(expires_at ORDER BY token_hash) FROM app_private.sessions)::text AS expiry`)).rows;
    const before=await snapshot();await app.inject({url:`/api/service-orders/${orderId}`,headers:{cookie:cookies[0]}});expect(await snapshot()).toEqual(before);
    await expect(db.runtime.query('UPDATE app_private.service_orders SET status=status WHERE id=$1',[orderId])).rejects.toThrow();
  });
});
