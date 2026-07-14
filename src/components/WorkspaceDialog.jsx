import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { WORKSPACE_ICON_OPTIONS } from '../lib/workspaceIcons.jsx'

export function WorkspaceDialog({ workspace, onClose, onSubmit, busy }) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [icon, setIcon] = useState('Layers')
  const [error, setError] = useState('')

  useEffect(() => {
    setName(workspace?.name || '')
    setSlug(workspace?.slug || '')
    setIcon(workspace?.icon || 'Layers')
    setError('')
  }, [workspace])

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    try {
      await onSubmit({ name: name.trim(), slug: slug.trim(), icon })
    } catch (submitError) {
      setError(submitError.message)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="shortcut-dialog workspace-dialog" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="workspace-dialog-title">
        <header><h2 id="workspace-dialog-title">{workspace ? 'Edit workspace' : 'New workspace'}</h2><button type="button" onClick={onClose} aria-label="Close"><X /></button></header>
        <label>Workspace name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} /></label>
        <label>URL slug <span>{workspace ? '(renaming does not change it unless edited)' : '(optional)'}</span><input value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="generated-from-name" /></label>
        <fieldset className="workspace-glyph-field"><legend>Workspace glyph</legend><div className="workspace-dialog-icon-grid">
          {WORKSPACE_ICON_OPTIONS.map(({ value, label, Icon }) => <button key={value} className={String(icon).toLowerCase() === value.toLowerCase() ? 'active' : ''} type="button" onClick={() => setIcon(value)} aria-label={label} title={label}><Icon /></button>)}
        </div></fieldset>
        {error && <p className="form-error">{error}</p>}
        <footer><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Saving…' : workspace ? 'Save workspace' : 'Create workspace'}</button></footer>
      </form>
    </div>
  )
}
