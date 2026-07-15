import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

export function ShortcutDialog({ item, kind = 'shortcut', point, onClose, onSubmit, onDelete, onDuplicate, busy }) {
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('https://')
  const [imageUrl, setImageUrl] = useState('')
  const [iconData, setIconData] = useState(null)
  const [iconMimeType, setIconMimeType] = useState(null)
  const [error, setError] = useState('')
  const isFolder = item?.kind === 'folder' || kind === 'folder'

  useEffect(() => {
    setTitle(item?.title || '')
    setUrl(item?.url || 'https://')
    setImageUrl(item?.iconOverrideUrl || '')
    setIconData(null)
    setIconMimeType(null)
    setError('')
  }, [item])

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    try {
      await onSubmit({ title, url, iconOverrideUrl: imageUrl || null, iconData, iconMimeType, point })
    } catch (submitError) {
      setError(submitError.message)
    }
  }

  const chooseIcon = (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (file.size > 768 * 1024) {
      setError('Custom shortcut icons must be smaller than 768 KB.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const value = String(reader.result || '')
      setIconData(value.slice(value.indexOf(',') + 1))
      setIconMimeType(file.type)
      setError('')
    }
    reader.onerror = () => setError('The custom icon could not be read.')
    reader.readAsDataURL(file)
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="shortcut-dialog" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="shortcut-dialog-title">
        <header><h2 id="shortcut-dialog-title">{item ? (isFolder ? 'Edit folder' : 'Edit shortcut') : (isFolder ? 'New folder' : 'New shortcut')}</h2><button type="button" onClick={onClose} aria-label="Close"><X /></button></header>
        <label>{isFolder ? 'Folder name' : 'Shortcut name'}<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={120} /></label>
        {!isFolder && (
          <>
            <label>Destination URL<input value={url} onChange={(event) => setUrl(event.target.value)} required type="url" /></label>
            <label>Shortcut image URL <span>(optional)</span><input value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} type="url" placeholder="https://example.com/icon.png" /></label>
            <p className="field-help">Overrides normal icon retrieval from the destination URL.</p>
            <label>Upload custom icon <span>(optional, highest priority)</span><input className="file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={chooseIcon} /></label>
            {iconData && <p className="field-help selected-file">Custom icon selected.</p>}
          </>
        )}
        {error && <p className="form-error">{error}</p>}
        {item && <div className="item-danger-actions">
          {item.kind === 'shortcut' && <button type="button" onClick={() => onDuplicate(item)} disabled={busy}>Duplicate</button>}
          {item.kind === 'folder' && <button type="button" onClick={() => onDelete(item, 'returnChildren')} disabled={busy}>Delete folder, keep shortcuts</button>}
          <button className="danger" type="button" onClick={() => onDelete(item, 'deleteChildren')} disabled={busy}>{item.kind === 'folder' ? 'Delete folder and shortcuts' : 'Delete shortcut'}</button>
        </div>}
        <footer><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Saving…' : isFolder ? 'Save folder' : 'Save shortcut'}</button></footer>
      </form>
    </div>
  )
}
