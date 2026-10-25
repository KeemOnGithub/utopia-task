import type { Pool, PoolClient } from 'pg';
import {
  type AssistantEvidence,
  type OperationalOrder,
  type QueryPlan,
  type RankingItem,
  type ResolvedFilters,
  escapeSqlLike,
  extractExcerpt,
  formatOrderNumber,
  parseOrderNumberValue
} from '../../../../packages/contracts/src/operations-assistant.js';

export function senToMyr(totalSenStr: string): string {
  const sen = BigInt(totalSenStr);
  const ringgit = sen / 100n;
  const remainder = sen % 100n;
  return `${ringgit.toString()}.${remainder.toString().padStart(2, '0')}`;
}

type WhereClauseResult = {
  sql: string;
  params: unknown[];
};

export function buildWhereClause(
  filters: QueryPlan['filters'],
  resolved: ResolvedFilters
): WhereClauseResult {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (filters.technicianId) {
    conditions.push(`o.assigned_technician_id = $${paramIdx++}`);
    params.push(filters.technicianId);
  }

  if (filters.serviceType) {
    conditions.push(`o.service_type = $${paramIdx++}`);
    params.push(filters.serviceType);
  }

  const dateCol = filters.dateBasis === 'assignedAt' ? 'o.assigned_at' : 'o.created_at';
  if (resolved.startUtc && resolved.endUtc) {
    conditions.push(`${dateCol} >= $${paramIdx++}`);
    params.push(resolved.startUtc);
    conditions.push(`${dateCol} < $${paramIdx++}`);
    params.push(resolved.endUtc);
  }

  if (filters.customerName) {
    conditions.push(`o.customer_name ILIKE ('%' || $${paramIdx++} || '%') ESCAPE '\\'`);
    params.push(escapeSqlLike(filters.customerName));
  }

  if (filters.serviceText) {
    const esc = escapeSqlLike(filters.serviceText);
    const p1 = paramIdx++;
    params.push(esc);
    conditions.push(
      `(o.problem_description ILIKE ('%' || $${p1} || '%') ESCAPE '\\' OR (o.admin_notes IS NOT NULL AND o.admin_notes ILIKE ('%' || $${p1} || '%') ESCAPE '\\'))`
    );
  }

  const sql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { sql, params };
}

export async function executeAssistantQuery(
  pool: Pool,
  plan: QueryPlan,
  resolved: ResolvedFilters
): Promise<AssistantEvidence> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '5s'");

    const { sql: whereSql, params } = buildWhereClause(plan.filters, resolved);

    switch (plan.operation) {
      case 'findOrders': {
        // 1. Total matching count
        const countQuery = `SELECT count(*)::text as matching_count FROM app_private.service_orders o ${whereSql}`;
        const countRes = await client.query(countQuery, params);
        const matchingCount = countRes.rows[0]?.matching_count ?? '0';

        // 2. Fetch up to 25 newest orders
        const rowsQuery = `
          SELECT
            o.id,
            o.order_number_value,
            o.customer_name,
            o.service_type,
            o.quoted_price_sen,
            o.status,
            o.created_at,
            o.assigned_at,
            o.assigned_technician_id,
            t.display_name as technician_name,
            o.problem_description,
            o.admin_notes
          FROM app_private.service_orders o
          JOIN app_private.technicians t ON t.id = o.assigned_technician_id
          ${whereSql}
          ORDER BY o.created_at DESC, o.id DESC
          LIMIT 25
        `;
        const rowsRes = await client.query(rowsQuery, params);

        const items: OperationalOrder[] = rowsRes.rows.map((r: any) => {
          let excerpts: { problemDescription?: string; adminNotes?: string } | undefined;
          if (plan.filters.serviceText) {
            const prob = extractExcerpt(r.problem_description, plan.filters.serviceText);
            const notes = r.admin_notes ? extractExcerpt(r.admin_notes, plan.filters.serviceText) : null;
            if (prob || notes) {
              excerpts = {};
              if (prob) excerpts.problemDescription = prob;
              if (notes) excerpts.adminNotes = notes;
            }
          }

          return {
            id: r.id,
            orderNumber: formatOrderNumber(r.order_number_value),
            customerName: r.customer_name,
            serviceType: r.service_type,
            technician: { id: r.assigned_technician_id, name: r.technician_name },
            status: 'assigned',
            quotedPrice: {
              currency: 'MYR',
              amount: senToMyr(r.quoted_price_sen.toString())
            },
            createdAt: new Date(r.created_at).toISOString(),
            assignedAt: new Date(r.assigned_at).toISOString(),
            excerpts
          };
        });

        await client.query('COMMIT');
        const returnedCount = items.length;
        const truncated = BigInt(matchingCount) > BigInt(returnedCount);

        return {
          kind: 'findOrders',
          data: {
            items,
            matchingCount,
            returnedCount,
            truncated
          }
        };
      }

      case 'countOrders': {
        const query = `SELECT count(*)::text as matching_count FROM app_private.service_orders o ${whereSql}`;
        const res = await client.query(query, params);
        await client.query('COMMIT');
        return {
          kind: 'countOrders',
          data: {
            matchingCount: res.rows[0]?.matching_count ?? '0'
          }
        };
      }

      case 'totalQuotedValue': {
        const query = `
          SELECT
            count(*)::text as matching_count,
            coalesce(sum(o.quoted_price_sen), 0)::text as total_sen
          FROM app_private.service_orders o
          ${whereSql}
        `;
        const res = await client.query(query, params);
        await client.query('COMMIT');
        const row = res.rows[0] ?? { matching_count: '0', total_sen: '0' };
        return {
          kind: 'totalQuotedValue',
          data: {
            matchingCount: row.matching_count,
            totalQuotedValue: senToMyr(row.total_sen)
          }
        };
      }

      case 'rankTechnicians': {
        const metric = plan.rankingMetric ?? 'orderCount';
        const query = `
          SELECT
            t.id as technician_id,
            t.display_name as technician_name,
            count(o.id)::text as order_count,
            coalesce(sum(o.quoted_price_sen), 0)::text as total_sen
          FROM app_private.service_orders o
          JOIN app_private.technicians t ON t.id = o.assigned_technician_id
          ${whereSql}
          GROUP BY t.id, t.display_name
        `;
        const res = await client.query(query, params);
        await client.query('COMMIT');

        // Sort rows by metric descending; ties broken by technician_name ASC, technician_id ASC
        const rows = res.rows.map((r: any) => ({
          technician: { id: r.technician_id, name: r.technician_name },
          orderCount: r.order_count as string,
          totalQuotedValue: senToMyr(r.total_sen.toString()),
          orderCountBig: BigInt(r.order_count),
          quotedSenBig: BigInt(r.total_sen)
        }));

        rows.sort((a: any, b: any) => {
          const comp = metric === 'orderCount'
            ? (b.orderCountBig > a.orderCountBig ? 1 : b.orderCountBig < a.orderCountBig ? -1 : 0)
            : (b.quotedSenBig > a.quotedSenBig ? 1 : b.quotedSenBig < a.quotedSenBig ? -1 : 0);
          if (comp !== 0) return comp;
          const nameComp = a.technician.name.localeCompare(b.technician.name);
          if (nameComp !== 0) return nameComp;
          return a.technician.id.localeCompare(b.technician.id);
        });

        // Compute competition ranking (1, 1, 3...)
        const items: RankingItem[] = [];
        let currentRank = 1;
        for (let i = 0; i < rows.length; i++) {
          const item = rows[i]!;
          if (i > 0) {
            const prev = rows[i - 1]!;
            const prevMetric = metric === 'orderCount' ? prev.orderCountBig : prev.quotedSenBig;
            const currMetric = metric === 'orderCount' ? item.orderCountBig : item.quotedSenBig;
            if (currMetric !== prevMetric) {
              currentRank = i + 1;
            }
          }
          items.push({
            technician: item.technician,
            rank: currentRank,
            orderCount: item.orderCount,
            totalQuotedValue: item.totalQuotedValue
          });
        }

        return {
          kind: 'rankTechnicians',
          data: {
            items,
            metric
          }
        };
      }

      case 'lookupOrder': {
        const orderNumberVal = parseOrderNumberValue(plan.orderNumber!);
        const query = `
          SELECT
            o.id,
            o.order_number_value,
            o.customer_name,
            o.service_type,
            o.quoted_price_sen,
            o.status,
            o.created_at,
            o.assigned_at,
            o.assigned_technician_id,
            t.display_name as technician_name
          FROM app_private.service_orders o
          JOIN app_private.technicians t ON t.id = o.assigned_technician_id
          WHERE o.order_number_value = $1
        `;
        const res = await client.query(query, [orderNumberVal.toString()]);
        await client.query('COMMIT');

        const row = res.rows[0];
        let order: OperationalOrder | null = null;
        if (row) {
          order = {
            id: row.id,
            orderNumber: formatOrderNumber(row.order_number_value),
            customerName: row.customer_name,
            serviceType: row.service_type,
            technician: { id: row.assigned_technician_id, name: row.technician_name },
            status: 'assigned',
            quotedPrice: {
              currency: 'MYR',
              amount: senToMyr(row.quoted_price_sen.toString())
            },
            createdAt: new Date(row.created_at).toISOString(),
            assignedAt: new Date(row.assigned_at).toISOString()
          };
        }

        return {
          kind: 'lookupOrder',
          data: { order }
        };
      }
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

