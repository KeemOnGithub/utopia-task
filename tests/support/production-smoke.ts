import {spawn} from 'node:child_process';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
const child=spawn(process.execPath,['build/server.mjs'],{env:{...process.env,NODE_ENV:'production',PUBLIC_ORIGIN:'https://operations.example.test',DATABASE_URL:'postgresql://app_runtime:synthetic-unused@localhost:55999/sejuk_test',LOGIN_LIMIT_HMAC_SECRET:'production-smoke-synthetic-secret-32bytes',PORT:'55901'},stdio:['ignore','pipe','pipe']});
let stderr='';child.stderr.on('data',d=>{stderr+=String(d);});
try{
 await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw new Error(`Production server exited before ready: ${stderr}`);}),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Production server readiness timed out')),15000).unref())]);
 const root=await fetch('http://127.0.0.1:55901/orders');assert.equal(root.status,200);const html=await root.text();assert.match(html,/<div id="root">/);assert.match(root.headers.get('content-security-policy')??'',/script-src 'self';/);assert.doesNotMatch(root.headers.get('content-security-policy')??'',/script-src[^;]*unsafe/);assert.equal(root.headers.get('x-content-type-options'),'nosniff');
 const asset=html.match(/src="([^"]+\.js)"/)?.[1];assert.ok(asset);assert.equal((await fetch(`http://127.0.0.1:55901${asset}`)).status,200);
 const miss=await fetch('http://127.0.0.1:55901/api/not-a-route');assert.equal(miss.status,404);assert.equal((await miss.json() as {error:{code:string}}).error.code,'NOT_FOUND');
 const unavailable=await fetch('http://127.0.0.1:55901/api/auth/session',{headers:{cookie:`__Host-session=${randomBytes(32).toString('base64url')}`}});assert.equal(unavailable.status,503);assert.equal(unavailable.headers.get('set-cookie'),null);assert.equal(unavailable.headers.get('cache-control'),'no-store');
 console.info('PASS native Node24 production bundle: SPA deep link, static asset, JSON API miss, strict script CSP, sanitized cookie-neutral database outage');
}finally{child.kill();await once(child,'exit').catch(()=>{});}
