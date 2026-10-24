import { serviceTypeLabels, formatMoney } from '@sejuk/contracts/service-orders';
import { deriveDraftLabel, draftEditPath } from '@sejuk/contracts/drafts';
import { fetchMyDrafts } from '../api/listings';
import { ListingView } from '../listings/ListingView';
import { formatTimestamp } from '../listings/format';

export function DraftsPage() {
  return (
    <ListingView
      kind="drafts"
      fetchPage={fetchMyDrafts}
      columns={['Customer', 'Service type', 'Proposed technician', 'Quoted price', 'Last saved']}
      label={deriveDraftLabel}
      path={item => draftEditPath(item.id)}
      values={item => [
        item.serviceType ? <span className="tech-badge" style={{ borderRadius: 6, fontSize: 12 }}>{serviceTypeLabels[item.serviceType]}</span> : 'Not provided',
        item.proposedTechnician?.name ? (
          <span className="tech-badge">
            <span className="tech-avatar">{item.proposedTechnician.name.charAt(0)}</span>
            <span>{item.proposedTechnician.name}</span>
          </span>
        ) : 'Not provided',
        item.quotedPrice.kind === 'money' ? (
          <span className="tabular-nums" style={{ fontWeight: 600 }}>{formatMoney(item.quotedPrice)}</span>
        ) : item.quotedPrice.kind === 'incomplete' ? (
          <span className="muted" style={{ fontStyle: 'italic' }}>Incomplete price</span>
        ) : 'Not provided',
        <time key="saved" dateTime={item.lastSavedAt} className="tabular-nums muted">{formatTimestamp(item.lastSavedAt)}</time>
      ]}
    />
  );
}
