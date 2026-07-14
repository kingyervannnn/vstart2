import { useEffect, useState } from 'react'
import { Database, Mail, NotebookPen, X } from 'lucide-react'

export function ServiceRailView({ kind, onClose }) {
  const [state, setState] = useState({ loading: true, error: '', data: null })

  useEffect(() => {
    const controller = new AbortController()
    setState({ loading: true, error: '', data: null })
    const request = kind === 'notes'
      ? fetch('/notes/api/v1/vault/default/notes', { signal: controller.signal }).then((response) => response.ok ? response.json() : Promise.reject(new Error('Notes service is unavailable')))
      : fetch('/gmail/health', { signal: controller.signal }).then((response) => response.ok ? response.json() : Promise.reject(new Error('Gmail service is unavailable')))
    request.then((data) => setState({ loading: false, error: '', data })).catch((error) => {
      if (error.name !== 'AbortError') setState({ loading: false, error: error.message, data: null })
    })
    return () => controller.abort()
  }, [kind])

  const Icon = kind === 'notes' ? NotebookPen : Mail
  return (
    <section className="service-rail-view" aria-label={kind === 'notes' ? 'Notes' : 'Mail'}>
      <header><div><Icon /><span><small>WIDGET VIEW</small><h2>{kind === 'notes' ? 'Notes' : 'Mail'}</h2></span></div><button type="button" onClick={onClose} aria-label={`Close ${kind}`}><X /></button></header>
      {state.loading && <div className="service-state">Connecting to the V Start 2 service…</div>}
      {state.error && <div className="service-state error">{state.error}</div>}
      {!state.loading && !state.error && kind === 'notes' && <div className="notes-service-list">
        {(state.data.notes || []).map((note) => <article key={note.id}><NotebookPen /><div><strong>{note.title || note.id}</strong><p>{String(note.content || '').slice(0, 220) || 'Empty note'}</p></div></article>)}
        {!(state.data.notes || []).length && <div className="service-state">No notes found in the mounted vault.</div>}
      </div>}
      {!state.loading && !state.error && kind === 'mail' && <div className="mail-service-status"><Database /><div><strong>Gmail service is running</strong><p>{state.data.hasClientId && state.data.hasClientSecret ? 'OAuth credentials are available. Account selection and inbox rendering use the imported Gmail service.' : 'Add Gmail OAuth credentials to the Docker environment to connect an account.'}</p></div></div>}
    </section>
  )
}
