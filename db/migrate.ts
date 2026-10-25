import pg from 'pg';
import {readdir,readFile} from 'node:fs/promises';
import {existsSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

function loadCaCert(): string | undefined {
  const candidates = [
    resolve('supabase-ca.pem'),
    resolve(process.cwd(), 'supabase-ca.pem'),
    fileURLToPath(new URL('../supabase-ca.pem', import.meta.url))
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try { return readFileSync(candidate, 'utf8'); } catch {}
    }
  }
  return undefined;
}

export async function migrate(connectionString:string){
 let url:URL;try{url=new URL(connectionString);if(!['postgres:','postgresql:'].includes(url.protocol))throw new Error();}catch{throw new Error('Invalid migration database connection configuration');}const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);for(const key of ['sslmode','sslcert','sslkey','sslrootcert'])url.searchParams.delete(key);const ca=loadCaCert();const client=new pg.Client({connectionString:url.toString(),ssl:local&&process.env.NODE_ENV!=='production'?false:(ca?{rejectUnauthorized:true,ca}:{rejectUnauthorized:true})});await client.connect();
 try{await client.query('SELECT pg_advisory_lock(73432918)');await client.query('CREATE TABLE IF NOT EXISTS public.app_migrations(name text PRIMARY KEY,checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
 for(const name of (await readdir(new URL('./migrations/',import.meta.url))).filter(x=>/^\d{3}_.+\.sql$/.test(x)).sort()){
 const sql=await readFile(new URL(`./migrations/${name}`,import.meta.url),'utf8');const checksum=createHash('sha256').update(sql).digest('hex');const existing=await client.query('SELECT checksum FROM public.app_migrations WHERE name=$1',[name]);if(existing.rowCount){if(existing.rows[0].checksum!==checksum)throw new Error(`Applied migration checksum changed: ${name}`);continue;}
 await client.query('BEGIN');try{await client.query(sql);await client.query('INSERT INTO public.app_migrations(name,checksum) VALUES($1,$2)',[name,checksum]);await client.query('COMMIT');console.info(`Applied ${name}`);}catch(e){await client.query('ROLLBACK');throw e;}}
 }finally{await client.query('SELECT pg_advisory_unlock(73432918)').catch(()=>{});await client.end();}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){if(!process.env.MIGRATION_DATABASE_URL)throw new Error('MIGRATION_DATABASE_URL is required');await migrate(process.env.MIGRATION_DATABASE_URL);}
