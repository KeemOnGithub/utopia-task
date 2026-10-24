import { formatOrderNumber, moneyFromSen } from '../../../../packages/contracts/src/service-orders.js';
import { validateOrderDetail, type OrderDetail } from '../../../../packages/contracts/src/order-detail.js';
import type { Queryable } from '../db.js';
import { AppError } from '../errors.js';

export async function loadOrderDetail(db: Queryable, orderId: string): Promise<OrderDetail> {
  try {
    const result = await db.query(`SELECT o.id, o.order_number_value, o.customer_name, o.phone,
      o.address, o.problem_description, o.service_type, o.quoted_price_sen, o.currency,
      o.assigned_technician_id, t.display_name AS technician_name, o.admin_notes, o.status,
      o.created_by_account_id, o.created_at, o.assigned_by_account_id, o.assigned_at
      FROM app_private.service_orders AS o
      INNER JOIN app_private.technicians AS t ON t.id = o.assigned_technician_id
      WHERE o.id = $1::uuid`, [orderId]);
    const row = result.rows[0];
    if (!row) throw new AppError(404,'NOT_FOUND','Order not found.');
    const timestamp = (value: unknown) => value instanceof Date ? value.toISOString() : value;
    return validateOrderDetail({
      id: row.id, orderNumber: formatOrderNumber(row.order_number_value),
      customerName: row.customer_name, phone: row.phone, address: row.address,
      problemDescription: row.problem_description, serviceType: row.service_type,
      quotedPrice: { ...moneyFromSen(row.quoted_price_sen), currency: row.currency },
      assignedTechnician: { id: row.assigned_technician_id, name: row.technician_name },
      adminNotes: row.admin_notes, status: row.status, createdByAccountId: row.created_by_account_id,
      createdAt: timestamp(row.created_at), assignedByAccountId: row.assigned_by_account_id,
      assignedAt: timestamp(row.assigned_at),
    },orderId);
  } catch (error) {
    if (error instanceof AppError) throw error;
    const code = (error as {code?:string}).code ?? '';
    const unavailable = code.startsWith('08') || ['ECONNREFUSED','ECONNRESET','57P01','53300'].includes(code);
    throw new AppError(unavailable ? 503 : 500, unavailable ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_ERROR','Could not load the service order. Try again.');
  }
}
