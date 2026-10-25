import type { FastifyInstance } from 'fastify';
import { isUuid, normalizeUuid } from '../../../../packages/contracts/src/service-orders.js';
import { requireOrderReader } from '../auth/index.js';
import { AppError } from '../errors.js';
import { loadOrderDetail } from './queries.js';

export function registerOrderDetailRoutes(app: FastifyInstance): void {
  app.get<{Params:{orderId:string}}>('/api/service-orders/:orderId', async (request,reply) => {
    await requireOrderReader(request,reply);
    if (!isUuid(request.params.orderId) || request.url.includes('?') || request.body !== undefined || (request.headers['content-length'] !== undefined && request.headers['content-length'] !== '0') || request.headers['transfer-encoding']) {
      throw new AppError(400,'MALFORMED_REQUEST','Invalid order link.');
    }
    return { data: await loadOrderDetail(app.db,normalizeUuid(request.params.orderId)) };
  });
}
