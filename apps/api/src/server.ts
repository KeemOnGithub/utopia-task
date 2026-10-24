import {loadConfig} from './config.js';
import {buildApp} from './app.js';
import fastifyStatic from '@fastify/static';
import {resolve} from 'node:path';
const config=loadConfig();const app=buildApp(config);
if(config.production){await app.register(fastifyStatic,{root:resolve('apps/web/dist'),wildcard:false});app.get('/*',async(req,reply)=>{if(req.url.startsWith('/api'))return reply.code(404).send({error:{code:'NOT_FOUND',message:'Not found.',requestId:req.id}});return reply.sendFile('index.html');});}
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{void app.close().then(()=>process.exit(0));});
await app.listen({port:config.port,host:'127.0.0.1'});
console.info(`Server listening on loopback port ${config.port}`);
