import type { DraftFields } from '@sejuk/contracts/drafts';
import { serviceTypeLabels, type TechnicianRef } from '@sejuk/contracts/service-orders';
import type { EditorState } from './state.js';
import { dirtyFields, isFrozen } from './state.js';

export type TechnicianState = { phase: 'loading' | 'ready' | 'error'; items: TechnicianRef[] };

export function OrderForm({
  state,
  technicians,
  onEdit,
  onSave,
  onCreate,
  onDelete,
  onRetryTechnicians
}: {
  state: EditorState;
  technicians: TechnicianState;
  onEdit: (key: keyof DraftFields, value: string | null) => void;
  onSave: () => void;
  onCreate: () => void;
  onDelete: () => void;
  onRetryTechnicians: () => void;
}) {
  const frozen = isFrozen(state) || ['submittedDraft', 'missing', 'loadingDraft', 'loadError'].includes(state.phase);
  const actionBlocked = frozen || state.phase === 'conflict';
  const selected = state.fields.assignedTechnicianId;
  const unavailable = !!selected && !technicians.items.some(t => t.id === selected);
  const selectionReady = !selected || (technicians.phase === 'ready' && !unavailable);

  function error(key: string) {
    const messages = state.fieldErrors[key === 'quotedPriceInput' ? 'quotedPrice' : key] ?? state.fieldErrors[key];
    return messages?.length ? (
      <p className="error" id={`${key}-error`} style={{ fontSize: 13, marginTop: 4 }}>
        {messages.join(' ')}
      </p>
    ) : null;
  }

  function props(key: keyof DraftFields) {
    return {
      id: key,
      name: key,
      value: state.fields[key] ?? '',
      disabled: frozen,
      'aria-invalid': !!(state.fieldErrors[key]?.length || (key === 'quotedPriceInput' && state.fieldErrors.quotedPrice?.length)),
      'aria-describedby': `${key}-error`,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
        onEdit(key, e.target.value || (['serviceType', 'assignedTechnicianId'].includes(key) ? null : ''))
    };
  }

  function text(key: 'customerName' | 'phone', label: string) {
    return (
      <div>
        <label htmlFor={key}>{label}</label>
        <input {...props(key)} type={key === 'phone' ? 'tel' : 'text'} autoComplete={key === 'phone' ? 'tel' : 'name'} />
        {error(key)}
      </div>
    );
  }

  function area(key: 'address' | 'problemDescription' | 'adminNotes', label: string) {
    return (
      <div className="full-width">
        <label htmlFor={key}>{label}</label>
        <textarea {...props(key)} rows={key === 'address' ? 3 : 4} autoComplete={key === 'address' ? 'street-address' : undefined} />
        {error(key)}
      </div>
    );
  }

  return (
    <form className="surface" aria-busy={state.phase === 'mutating' || state.phase === 'reconciling'} onSubmit={e => { e.preventDefault(); onCreate(); }} noValidate>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingBottom: 16, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>All fields are required unless marked optional. Drafts may be incomplete.</p>
        <div className="order-link-pill" style={{ fontSize: 12, padding: '4px 10px' }}>
          <strong>Order number:</strong> Generated when created
        </div>
      </div>

      <section>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <span>👤</span>
          <h2 style={{ margin: 0 }}>Customer details</h2>
        </div>
        <div className="form-grid">
          {text('customerName', 'Customer name')}
          {text('phone', 'Phone')}
          {area('address', 'Address')}
        </div>
      </section>

      <section>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <span>❄️</span>
          <h2 style={{ margin: 0 }}>Service details</h2>
        </div>
        <div className="form-grid">
          <div>
            <label htmlFor="serviceType">Service type</label>
            <select {...props('serviceType')}>
              <option value="">Select a service type</option>
              {Object.entries(serviceTypeLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
            {error('serviceType')}
          </div>
          <div>
            <label htmlFor="quotedPriceInput">Quoted price (MYR)</label>
            <input {...props('quotedPriceInput')} type="text" inputMode="decimal" placeholder="0.00" />
            {error('quotedPriceInput')}
          </div>
          {area('problemDescription', 'Problem description')}
        </div>
      </section>

      <section>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <span>🛠️</span>
          <h2 style={{ margin: 0 }}>Assignment and notes</h2>
        </div>
        <div className="form-grid">
          <div>
            <label htmlFor="assignedTechnicianId">
              {state.draftId ? 'Proposed technician' : 'Assigned technician'}
            </label>
            <select {...props('assignedTechnicianId')}>
              <option value="">Select a technician</option>
              {unavailable && <option value={selected!}>{state.record?.proposedTechnician?.name ?? 'Selected technician'} (unavailable)</option>}
              {technicians.items.map(t => (
                <option value={t.id} key={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            {error('assignedTechnicianId')}
            {technicians.phase === 'loading' && <p role="status" className="muted" style={{ fontSize: 13, marginTop: 4 }}>Loading technicians...</p>}
            {technicians.phase === 'error' && (
              <p className="error" style={{ fontSize: 13, marginTop: 4 }}>
                Technicians could not be loaded. <button type="button" onClick={onRetryTechnicians}>Retry technicians</button>
              </p>
            )}
            {technicians.phase === 'ready' && !technicians.items.length && (
              <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>No technicians are available. You can save an incomplete draft without a technician.</p>
            )}
            {unavailable && technicians.phase === 'ready' && (
              <p className="error" style={{ fontSize: 13, marginTop: 4 }}>This technician is no longer available. Select another technician or clear the draft selection.</p>
            )}
          </div>
          {area('adminNotes', 'Admin notes (optional)')}
        </div>
      </section>

      <div className="actions" style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
        <button className="primary" type="submit" disabled={actionBlocked || technicians.phase !== 'ready' || !selected || unavailable}>
          Create order
        </button>
        <button
          type="button"
          disabled={
            actionBlocked ||
            !selectionReady ||
            (!!state.draftId && !dirtyFields(state.fields, state.baseline)) ||
            !Object.values(state.fields).some(v => v?.trim())
          }
          onClick={onSave}
        >
          Save draft
        </button>
        {state.draftId && (
          <button type="button" className="danger" disabled={actionBlocked} onClick={onDelete}>
            Delete draft
          </button>
        )}
      </div>
      {state.draftId && !dirtyFields(state.fields, state.baseline) && <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>No unsaved changes</p>}
    </form>
  );
}
