import pg,{type PoolClient} from 'pg';
import type {Config} from './config.js';
export type Queryable=Pick<PoolClient,'query'>;
export function createPool(config:Config){const url=new URL(config.databaseUrl);const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);for(const key of ['sslmode','sslcert','sslkey','sslrootcert'])url.searchParams.delete(key);return new pg.Pool({connectionString:url.toString(),max:config.poolMax,connectionTimeoutMillis:5000,ssl:local&&!config.production?false:{rejectUnauthorized:true}});}
export async function transaction<T>(pool:pg.Pool,fn:(client:PoolClient)=>Promise<T>):Promise<T>{const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='5s'");await c.query("SET LOCAL statement_timeout='15s'");const result=await fn(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}}
