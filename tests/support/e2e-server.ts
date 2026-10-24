import {isolatedDatabase} from './database.js';
import {buildApp} from '../../apps/api/src/app.js';
import {createServer} from 'vite';
import argon2 from 'argon2';
const db=await isolatedDatabase(0);
const hash=await argon2.hash('browser synthetic password',{type:argon2.argon2id,memoryCost:65536,timeCost:3,parallelism:1,hashLength:32});
await db.owner.query("INSERT INTO app_private.accounts(id,email,password_hash,role) VALUES('50000000-0000-4000-8000-000000000001','browser@example.test',$1,'admin'),('50000000-0000-4000-8000-000000000002','other@example.test',$1,'admin')",[hash]);
// Separate synthetic accounts keep each journey below the real per-email login allowance.
for(let i=0;i<24;i++)await db.owner.query("INSERT INTO app_private.accounts(email,password_hash,role) VALUES($1,$2,'admin')",[`browser${i}@example.test`,hash]);
await db.owner.query("INSERT INTO app_private.service_orders(customer_name,phone,address,problem_description,service_type,quoted_price_sen,currency,assigned_technician_id,created_by_account_id,assigned_by_account_id) SELECT 'Synthetic listed customer '||n,'0123','Synthetic Street','Synthetic service problem','repair',1000,'MYR','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001' FROM generate_series(1,30) n");
const app=buildApp({databaseUrl:db.runtimeUrl,publicOrigin:'http://localhost:5178',production:false,port:3018,poolMax:10,trustedProxy:[],hmacSecret:'isolated-browser-test-hmac-secret-32bytes'},db.runtime);
await app.listen({host:'127.0.0.1',port:3018});
const web=await createServer({configFile:'apps/web/vite.config.ts',root:'apps/web',server:{port:5178,proxy:{'/api':'http://localhost:3018'}}});await web.listen();
console.info('Isolated browser test application ready');
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{void web.close().then(()=>app.close()).then(()=>db.close()).then(()=>process.exit(0));});
