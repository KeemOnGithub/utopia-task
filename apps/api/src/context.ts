import type {Pool} from 'pg';
import type {Config} from './config.js';
declare module 'fastify' {interface FastifyInstance {db:Pool;config:Config;}}
