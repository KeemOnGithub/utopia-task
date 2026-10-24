import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {createHash,randomBytes} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import {isolatedDatabase} from '../../../../tests/support/database.js';
import {buildApp} from '../app.js';
import {loadConfig} from '../config.js';
import {listOrderSummaries,listDraftSummaries} from './queries.js';
import {decodeListingCursor} from '@sejuk/contracts/listing-cursor';
const a='50000000-0000-4000-8000-000000000001',b='50000000-0000-4000-8000-000000000002';
let db:Awaited<ReturnType<typeof isolatedDatabase>>,app:FastifyInstance,cookieA:string,cookieB:string;
async function cookie(account:string){const token=randomBytes(32).toString('base64url');await db.owner.query("INSERT INTO app_private.sessions(token_hash,account_id,created_at,expires_at) VALUES($1,$2,clock_timestamp(),clock_timestamp()+interval '8 hours')",[createHash('sha256').update(token).digest(),account]);return `dev_session=${token}`;}
beforeAll(async()=>{
 db=await isolatedDatabase(56493);
 await db.owner.query("INSERT INTO app_private.accounts(id,email,password_hash,role) VALUES($1,'a@example.test','unused','admin'),($2,'b@example.test','unused','admin')",[a,b]);
 await db.owner.query(`INSERT INTO app_private.service_orders(id,customer_name,phone,address,problem_description,service_type,quoted_price_sen,currency,assigned_technician_id,created_by_account_id,assigned_by_account_id,created_at,assigned_at) SELECT ('30000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Demo '||n,'0123','Demo address','Demo problem','repair',0,'MYR','10000000-0000-4000-8000-000000000001',$1,$1,'2026-10-23T07:40:00Z'::timestamptz+(n%3)*interval '1 microsecond','2026-10-23T07:40:00Z'::timestamptz+(n%3)*interval '1 microsecond' FROM generate_series(1,61) n`,[a]);
 await db.owner.query(`INSERT INTO app_private.service_order_drafts(id,creator_account_id,customer_name,phone,address,problem_description,service_type,quoted_price_input,admin_notes,last_saved_at) SELECT ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,CASE WHEN n%2=0 THEN $1::uuid ELSE $2::uuid END,' Draft '||n||' ','','','',NULL,CASE WHEN n%3=0 THEN '0' ELSE '12.' END,'','2026-10-23T07:40:00Z'::timestamptz+n*interval '1 microsecond' FROM generate_series(1,60) n`,[a,b]);
 cookieA=await cookie(a);cookieB=await cookie(b);
 app=buildApp(loadConfig({DATABASE_URL:db.runtimeUrl,PUBLIC_ORIGIN:'http://localhost:5173',LOGIN_LIMIT_HMAC_SECRET:'x'.repeat(32)}),db.runtime);
},60000);
afterAll(async()=>{if(app)await app.close();if(db)await db.close();},30000);
describe('real Postgres listings',()=>{
 it('traverses microsecond keys and UUID ties without skips; new inserts do not shift boundary',async()=>{
  const first=await listOrderSummaries(db.runtime,null);expect(first.items).toHaveLength(25);const position=decodeListingCursor(first.pagination.nextCursor!,'orders');expect(position.at).toMatch(/\.00000[12]Z$/);
  await db.owner.query("INSERT INTO app_private.service_orders(customer_name,phone,address,problem_description,service_type,quoted_price_sen,currency,assigned_technician_id,created_by_account_id,assigned_by_account_id) VALUES('New demo','0123','Demo address','Demo problem','repair',0,'MYR','10000000-0000-4000-8000-000000000001',$1,$1)",[a]);
  const second=await listOrderSummaries(db.runtime,position);const third=await listOrderSummaries(db.runtime,decodeListingCursor(second.pagination.nextCursor!,'orders'));
  const ids=[...first.items,...second.items,...third.items].map(item=>item.id);expect(ids).toHaveLength(61);expect(new Set(ids).size).toBe(61);expect(third.pagination).toEqual({nextCursor:null,hasNextPage:false});
  expect((await listOrderSummaries(db.runtime,null)).items[0]?.customerName).toBe('New demo');
  const expected=await db.owner.query('SELECT id FROM app_private.service_orders WHERE customer_name<>$1 ORDER BY created_at DESC,id DESC',['New demo']);expect(ids).toEqual(expected.rows.map(row=>row.id));
 });
 it('filters private drafts before LIMIT even using another owner cursor',async()=>{
  const first=await listDraftSummaries(db.runtime,{accountId:a,role:'admin'},null);expect(first.items).toHaveLength(25);
  const second=await listDraftSummaries(db.runtime,{accountId:b,role:'admin'},decodeListingCursor(first.pagination.nextCursor!,'drafts'));
  expect(second.items.every(item=>Number(item.id.slice(-12))%2===1)).toBe(true);
  expect(first.items.every(item=>Number(item.id.slice(-12))%2===0)).toBe(true);expect(first.items.some(item=>item.quotedPrice.kind==='money'&&item.quotedPrice.amount==='0.00')).toBe(true);
  expect(Object.keys(first.items[0]!).sort()).toEqual(['customerName','id','lastSavedAt','proposedTechnician','quotedPrice','serviceType']);
 });
 it('excludes submitted/deleted drafts and reflects save reordering',async()=>{
  const order=await db.owner.query('SELECT id FROM app_private.service_orders LIMIT 1');
  await db.owner.query('UPDATE app_private.service_order_drafts SET submitted_order_id=$1,submitted_at=clock_timestamp() WHERE id=$2',[order.rows[0].id,'20000000-0000-4000-8000-000000000060']);
  await db.owner.query("DELETE FROM app_private.service_order_drafts WHERE id='20000000-0000-4000-8000-000000000058'");
  await db.owner.query("UPDATE app_private.service_order_drafts SET last_saved_at=clock_timestamp() WHERE id='20000000-0000-4000-8000-000000000002'");
  const page=await listDraftSummaries(db.runtime,{accountId:a,role:'admin'},null);expect(page.items[0]?.id).toBe('20000000-0000-4000-8000-000000000002');expect(page.items.map(item=>item.id)).not.toContain('20000000-0000-4000-8000-000000000060');
 });
 it('authorizes before invalid query validation; sets no-store and never writes cookies',async()=>{
  const anonymous=await app.inject({url:'/api/service-orders?bad=1'});expect(anonymous.statusCode).toBe(401);
  for(const url of ['/api/service-orders?cursor=','/api/service-orders?cursor=x&cursor=x','/api/drafts?creator=other']){const response=await app.inject({url,headers:{cookie:cookieA}});expect(response.statusCode).toBe(400);expect(response.json().error.code).toBe('MALFORMED_REQUEST');expect(response.headers['cache-control']).toBe('no-store');expect(response.headers['set-cookie']).toBeUndefined();}
  for(const cookie of [cookieA,cookieB]){const response=await app.inject({url:'/api/service-orders',headers:{cookie}});expect(response.statusCode).toBe(200);expect(response.json().data.items).toHaveLength(25);expect(response.headers['set-cookie']).toBeUndefined();}
 });
 it('accepts a valid absent boundary and returns correct empty metadata',async()=>{const page=await listOrderSummaries(db.runtime,{v:1,kind:'orders',at:'0001-01-01T00:00:00.000001Z',id:'ffffffff-ffff-ffff-ffff-ffffffffffff'});expect(page).toEqual({items:[],pagination:{hasNextPage:false,nextCursor:null}});});
 it('denies active nonadmin, inactive and expired sessions before domain validation',async()=>{
  const manager='50000000-0000-4000-8000-000000000003',inactive='50000000-0000-4000-8000-000000000004';
  await db.owner.query("INSERT INTO app_private.accounts(id,email,password_hash,role,is_active) VALUES($1,'manager@example.test','unused','manager',true),($2,'inactive@example.test','unused','admin',false)",[manager,inactive]);
  const managerCookie=await cookie(manager),inactiveCookie=await cookie(inactive),expiredCookie=await cookie(a);
  const token=expiredCookie.slice('dev_session='.length);await db.owner.query("UPDATE app_private.sessions SET created_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 hour' WHERE token_hash=$1",[createHash('sha256').update(token).digest()]);
  for(const [cookie,status] of [[managerCookie,403],[inactiveCookie,401],[expiredCookie,401]] as const){const response=await app.inject({url:'/api/drafts?bad=1',headers:{cookie}});expect(response.statusCode).toBe(status);expect(response.headers['set-cookie']).toBeUndefined();expect(response.headers['cache-control']).toBe('no-store');}
 });
 it('rejects a GET body after authorization',async()=>{const response=await app.inject({method:'GET',url:'/api/service-orders',headers:{cookie:cookieA,'content-type':'application/json'},payload:'{}'});expect(response.statusCode).toBe(400);expect(response.json().error.code).toBe('MALFORMED_REQUEST');});
});
