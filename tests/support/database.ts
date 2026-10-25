import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import {migrate} from '../../db/migrate.js';
// Always creates a new synthetic cluster; never accepts environment database URLs.
export async function isolatedDatabase(port:number){
 if(port===0){const listener=createServer();await new Promise<void>((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);});port=(listener.address() as {port:number}).port;await new Promise<void>((resolve,reject)=>listener.close(error=>error?reject(error):resolve()));}
 const directory=await mkdtemp(join(tmpdir(),'sejuk-test-'));
 const password=randomBytes(24).toString('hex');
 const instance=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:true,authMethod:'scram-sha-256',initdbFlags:['--encoding=UTF8','--locale=C'],onLog:()=>{},onError:()=>{}});
 await instance.initialise();await instance.start();await instance.createDatabase('sejuk_test');
 const ownerUrl=`postgresql://postgres:${password}@localhost:${port}/sejuk_test`;
 const owner=new pg.Pool({connectionString:ownerUrl});
 await owner.query('CREATE ROLE app_runtime LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT');
 await owner.query(`ALTER ROLE app_runtime PASSWORD '${password}'`);
 await owner.query('CREATE ROLE app_migration_owner LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT CREATEROLE');
 await owner.query(`ALTER ROLE app_migration_owner PASSWORD '${password}'`);
 await owner.query('ALTER DATABASE sejuk_test OWNER TO app_migration_owner');
 const migrationUrl=`postgresql://app_migration_owner:${password}@localhost:${port}/sejuk_test`;
 try{await migrate(migrationUrl);}catch(error){await owner.end();await instance.stop();await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:200}).catch(()=>{});throw error;}
 const runtimeUrl=`postgresql://app_runtime:${password}@localhost:${port}/sejuk_test`;
 const runtime=new pg.Pool({connectionString:runtimeUrl,max:12});
 return {owner,runtime,runtimeUrl,ownerUrl,migrationUrl,async close(){await runtime.end();await owner.end();await instance.stop();await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:200}).catch(()=>{});}};
}
