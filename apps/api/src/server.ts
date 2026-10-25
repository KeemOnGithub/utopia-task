import {loadConfig} from './config.js';
import {buildApp} from './app.js';
import fastifyStatic from '@fastify/static';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const config=loadConfig();const app=buildApp(config);
if(config.production){
  const distPath=existsSync(resolve('apps/web/dist'))
    ? resolve('apps/web/dist')
    : fileURLToPath(new URL('../apps/web/dist', import.meta.url));
  await app.register(fastifyStatic,{root:distPath,wildcard:false});
  app.get('/*',async(req,reply)=>{if(req.url.startsWith('/api'))return reply.code(404).send({error:{code:'NOT_FOUND',message:'Not found.',requestId:req.id}});return reply.sendFile('index.html');});
}
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{void app.close().then(()=>process.exit(0));});
await app.listen({port:config.port,host:config.host ?? '127.0.0.1'});
console.info(`Server listening on ${config.host ?? '127.0.0.1'}:${config.port}`);
