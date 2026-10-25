import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

let appInstance: FastifyInstance | null = null;
let initPromise: Promise<FastifyInstance> | null = null;

async function getFastify(): Promise<FastifyInstance> {
  if (appInstance) return appInstance;
  if (!initPromise) {
    initPromise = (async () => {
      const publicOrigin =
        process.env.PUBLIC_ORIGIN ||
        (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined) ||
        (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined) ||
        'https://utopia-task.vercel.app';

      const config = loadConfig({
        ...process.env,
        PUBLIC_ORIGIN: publicOrigin,
        DB_POOL_MAX: process.env.DB_POOL_MAX || '2'
      });

      const app = buildApp(config);
      await app.ready();
      appInstance = app;
      return app;
    })();
  }
  return initPromise;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const app = await getFastify();
  await new Promise<void>((resolve, reject) => {
    res.on('finish', resolve);
    res.on('close', resolve);
    res.on('error', reject);
    app.server.emit('request', req, res);
  });
}

