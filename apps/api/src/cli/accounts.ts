import pg from 'pg';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { userInfo } from 'node:os';
import { transaction, loadCaCert } from '../db.js';
import { hashPassword } from '../auth/password.js';
import { normalizeEmail } from '../auth/validation.js';

export async function hiddenPrompt(label:string):Promise<string> {
  if(!process.stdin.isTTY || !process.stdout.isTTY)throw new Error('An interactive terminal is required.');
  process.stdout.write(label);
  const output=new Writable({write(_chunk,_encoding,done){done();}});
  const reader=createInterface({input:process.stdin,output,terminal:true});
  try { return await new Promise<string>((resolve,reject)=>{reader.once('SIGINT',()=>reject(new Error('Cancelled.')));reader.once('close',()=>reject(new Error('Cancelled.')));reader.question('',resolve);}); }
  finally {reader.close();process.stdout.write('\n');}
}
export async function runAccountCommand(args:string[],prompt:(label:string)=>Promise<string>=hiddenPrompt):Promise<void> {
  const [operation,target,...extra]=args;
  const commands=['create-admin','create-manager','replace-password','activate','deactivate','revoke-sessions','cleanup-auth','cleanup-ai'];
  if(!operation || !commands.includes(operation) || extra.length || (['cleanup-auth','cleanup-ai'].includes(operation)?target!==undefined:!target))throw new Error('Use create-admin/create-manager <email>, replace-password/activate/deactivate/revoke-sessions <account UUID>, or cleanup-auth/cleanup-ai. Passwords are accepted only through hidden prompts.');
  const connectionString=process.env.PROVISION_DATABASE_URL;
  if(!connectionString)throw new Error('PROVISION_DATABASE_URL is required.');
  if(connectionString===process.env.DATABASE_URL)throw new Error('Provisioning requires credentials separate from runtime.');
  const url=new URL(connectionString);
  for(const key of ['sslmode','sslcert','sslkey','sslrootcert'])url.searchParams.delete(key);
  const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  const ca=loadCaCert();
  const pool=new pg.Pool({connectionString:url.toString(),max:1,ssl:local && process.env.NODE_ENV!=='production'?false:(ca?{rejectUnauthorized:true,ca}:{rejectUnauthorized:true})});
  let accountId:string|null=null;
  try {
    let hash:string|undefined;
    if(operation==='create-admin' || operation==='create-manager' || operation==='replace-password') {
      const password=await prompt('Password: ');
      const confirmation=await prompt('Confirm password: ');
      if(password!==confirmation)throw new Error('Passwords do not match.');
      hash=await hashPassword(password);
    }
    if(operation==='create-admin' || operation==='create-manager') {
      const email=normalizeEmail(target);
      if(!email)throw new Error('Enter a valid email address.');
      const role=operation==='create-admin'?'admin':'manager';
      try {accountId=(await pool.query("INSERT INTO app_private.accounts(email,password_hash,role) VALUES($1,$2,$3) RETURNING id",[email,hash,role])).rows[0].id;}
      catch(error){if((error as {code?:string}).code==='23505')throw new Error('An account already exists for this email.');throw error;}
    } else if(operation==='cleanup-auth') {
      await transaction(pool,async client=>{await client.query('DELETE FROM app_private.sessions WHERE expires_at<=clock_timestamp()');await client.query("DELETE FROM app_private.login_limits WHERE window_started_at<clock_timestamp()-interval '24 hours'");});
    } else if(operation==='cleanup-ai') {
      await transaction(pool,async client=>{
        await client.query('DELETE FROM app_private.ai_request_leases WHERE expires_at<=clock_timestamp()');
        await client.query("DELETE FROM app_private.ai_account_usage WHERE window_started_at<clock_timestamp()-interval '30 days'");
        await client.query("DELETE FROM app_private.ai_daily_usage WHERE myt_day<(clock_timestamp() AT TIME ZONE 'Asia/Kuala_Lumpur')::date-30");
      });
    } else {
      if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(target!))throw new Error('Enter an account UUID.');
      accountId=target!.toLowerCase();
      await transaction(pool,async client=>{
        const {rows}=await client.query('SELECT id FROM app_private.accounts WHERE id=$1 FOR UPDATE',[accountId]);
        if(!rows.length)throw new Error('Account not found.');
        if(operation==='replace-password')await client.query('UPDATE app_private.accounts SET password_hash=$1,updated_at=clock_timestamp() WHERE id=$2',[hash,accountId]);
        if(operation==='activate' || operation==='deactivate')await client.query('UPDATE app_private.accounts SET is_active=$1,updated_at=clock_timestamp() WHERE id=$2',[operation==='activate',accountId]);
        if(operation!=='activate')await client.query('DELETE FROM app_private.sessions WHERE account_id=$1',[accountId]);
      });
    }
    console.info(JSON.stringify({operation,accountId,outcome:'success',timestamp:new Date().toISOString(),operator:userInfo().username}));
  } catch(error) {
    console.info(JSON.stringify({operation,accountId,outcome:'failure',timestamp:new Date().toISOString(),operator:userInfo().username}));
    throw error;
  } finally {await pool.end();}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)runAccountCommand(process.argv.slice(2)).catch(()=>{console.error('Account command failed. Check command arguments, account state and trusted database configuration.');process.exitCode=1;});
