import { AlertTriangle, X } from 'lucide-react'

export function ConfirmDialog({ title, message, confirmLabel, busy, onCancel, onConfirm }) {
  return (
    <div className="modal-backdrop confirm-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onCancel()}>
      <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-message">
        <header><AlertTriangle /><h2 id="confirm-dialog-title">{title}</h2><button type="button" onClick={onCancel} disabled={busy} aria-label="Cancel"><X /></button></header>
        <p id="confirm-dialog-message">{message}</p>
        <footer><button type="button" onClick={onCancel} disabled={busy}>Cancel</button><button className="danger" type="button" onClick={onConfirm} disabled={busy}>{busy ? 'Deleting…' : confirmLabel}</button></footer>
      </section>
    </div>
  )
}
