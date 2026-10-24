export type ServiceType = 'installation' | 'servicing' | 'repair';
export type OrderStatus = 'assigned';
export type Money = { currency: 'MYR'; amount: string };
export type TechnicianRef = { id: string; name: string };
export type SelectableTechnician = TechnicianRef;
export type OrderFields = {
  customerName: string; phone: string; address: string; problemDescription: string;
  serviceType: ServiceType; quotedPrice: string; assignedTechnicianId: string;
  adminNotes: string | null;
};
export type ServiceOrder = {
  id: string; orderNumber: string; customerName: string; phone: string; address: string;
  problemDescription: string; serviceType: ServiceType; quotedPrice: Money;
  assignedTechnician: TechnicianRef; adminNotes: string | null; status: OrderStatus;
  createdByAccountId: string; createdAt: string; assignedByAccountId: string; assignedAt: string;
};
export type OrderCreatedResult = { orderId: string; orderNumber: string; createdAt: string };
export type CreateOrderRequest = { fields: OrderFields };
export const serviceTypeLabels = { installation: 'Installation', servicing: 'Servicing', repair: 'Repair' } as const;
export const orderStatusLabels = { assigned: 'Assigned' } as const;
export const SERVICE_TYPE_LABELS = serviceTypeLabels;
export const ORDER_STATUS_LABELS = orderStatusLabels;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): value is string { return typeof value === 'string' && UUID_PATTERN.test(value); }
export function normalizeUuid(value: unknown): string { if (!isUuid(value)) throw new Error('Invalid UUID.'); return value.toLowerCase(); }
export function isUuidV4(value: unknown): value is string { return isUuid(value) && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
export const PRICE_ERROR = 'Enter a price from MYR 0.00 to MYR 999,999.99 with at most two decimal places.';
export function parsePrice(input: string): { sen: number; amount: string } {
  if (typeof input !== 'string' || Array.from(input).length > 32) throw new Error(PRICE_ERROR);
  const text = input.trim();
  if (!/^[0-9]+(?:\.[0-9]{1,2})?$/.test(text)) throw new Error(PRICE_ERROR);
  const [wholeInput, fraction = ''] = text.split('.');
  const whole = wholeInput!.replace(/^0+(?=\d)/, '');
  if (whole.length > 6) throw new Error(PRICE_ERROR);
  const cents = fraction.padEnd(2, '0');
  return { sen: Number(whole) * 100 + Number(cents), amount: `${whole}.${cents}` };
}
export function moneyFromSen(sen: number): Money {
  if (!Number.isInteger(sen) || sen < 0 || sen > 99999999) throw new Error(PRICE_ERROR);
  return { currency: 'MYR', amount: `${Math.floor(sen / 100)}.${String(sen % 100).padStart(2, '0')}` };
}
export function formatMoney(money: Money): string {
  if (money.currency !== 'MYR' || parsePrice(money.amount).amount !== money.amount) throw new Error('Invalid money.');
  return `MYR ${money.amount}`;
}
export function formatOrderNumber(value: string | bigint): string {
  const digits = String(value);
  if (!/^[1-9][0-9]*$/.test(digits)) throw new Error('Invalid order number.');
  return `SO-${digits.padStart(6, '0')}`;
}
export function isValidUnicode(value: string): boolean { return !/[\u0000\uD800-\uDFFF]/u.test(value); }
export function normalizeLineEndings(value: string): string { return value.replace(/\r\n?/g, '\n'); }
