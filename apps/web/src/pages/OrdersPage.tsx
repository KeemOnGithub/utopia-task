import { serviceTypeLabels, orderStatusLabels, formatMoney } from '@sejuk/contracts/service-orders';
import { fetchOrders } from '../api/listings';
import { ListingView } from '../listings/ListingView';
import { formatTimestamp } from '../listings/format';

export function OrdersPage() {
  return (
    <ListingView
      kind="orders"
      fetchPage={fetchOrders}
      columns={['Order number', 'Customer name', 'Service type', 'Assigned technician', 'Quoted price', 'Status', 'Created at']}
      label={item => item.orderNumber}
      path={item => `/orders/${item.id}`}
      values={item => [
        <span key="cust" style={{ fontWeight: 600 }}>{item.customerName}</span>,
        <span key="type" className="tech-badge" style={{ borderRadius: 6, fontSize: 12 }}>{serviceTypeLabels[item.serviceType]}</span>,
        <span key="tech" className="tech-badge">
          <span className="tech-avatar">{item.assignedTechnician.name.charAt(0)}</span>
          <span>{item.assignedTechnician.name}</span>
        </span>,
        <span key="price" className="tabular-nums" style={{ fontWeight: 600 }}>{formatMoney(item.quotedPrice)}</span>,
        <span key="status" className="status-pill status-assigned">
          <span className="status-dot"></span>
          <span>{orderStatusLabels[item.status]}</span>
        </span>,
        <time key="time" dateTime={item.createdAt} className="tabular-nums muted">{formatTimestamp(item.createdAt)}</time>
      ]}
    />
  );
}
