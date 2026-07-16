import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { api } from '../lib/api.js'

export function ShortcutDialog({ item, kind = 'shortcut', point, onClose, onSubmit, onDelete, onDuplicate, busy }) {
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('https://')
  const [imageUrl, setImageUrl] = useState('')
  const [iconData, setIconData] = useState(null)
  const [iconMimeType, setIconMimeType] = useState(null)
  const [error, setError] = useState('')
  const titleOrigin = useRef('empty')
  const clearedTitleUrl = useRef(null)
  const isFolder = item?.kind === 'folder' || kind === 'folder'

  useEffect(() => {
    setTitle(item?.title || '')
    setUrl(item?.url || 'https://')
    setImageUrl(item?.iconOverrideUrl || '')
    setIconData(null)
    setIconMimeType(null)
    setError('')
    titleOrigin.current = item?.title ? 'manual' : 'empty'
    clearedTitleUrl.current = null
  }, [item])

  useEffect(() => {
    if (isFolder || titleOrigin.current === 'manual') return undefined
    if (titleOrigin.current === 'cleared' && clearedTitleUrl.current === url) return undefined
    let parsed
    try {
      parsed = new URL(url)
      if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) return undefined
    } catch {
      return undefined
    }

    const controller = new AbortController()
    const timeout = setTimeout(async () => {
      try {
        const result = await api.shortcutMetadata(parsed.toString(), controller.signal)
        if (!controller.signal.aborted && titleOrigin.current !== 'manual' && titleOrigin.current !== 'cleared' && result.title) {
          setTitle(result.title)
          titleOrigin.current = 'auto'
        }
      } catch (metadataError) {
        if (metadataError.name !== 'AbortError') return
      }
    }, 450)
    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [isFolder, url])

  const changeTitle = (event) => {
    setTitle(event.target.value)
    titleOrigin.current = 'manual'
  }

  const clearTitle = () => {
    setTitle('')
    titleOrigin.current = 'cleared'
    clearedTitleUrl.current = url
  }

  const changeUrl = (event) => {
    const nextUrl = event.target.value
    setUrl(nextUrl)
    if (titleOrigin.current === 'auto') {
      setTitle('')
      titleOrigin.current = 'empty'
    } else if (titleOrigin.current === 'cleared' && nextUrl !== clearedTitleUrl.current) {
      titleOrigin.current = 'empty'
    }
  }

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
        <label>{isFolder ? 'Folder name' : 'Shortcut name'}<span className="clearable-input"><input autoFocus aria-label={isFolder ? 'Folder name' : 'Shortcut name'} value={title} onChange={changeTitle} required maxLength={120} />{title && <button type="button" className="clear-input-button" onClick={clearTitle} aria-label={`Clear ${isFolder ? 'folder' : 'shortcut'} name`} title="Clear name"><X /></button>}</span></label>
        {!isFolder && (
          <>
            <label>Destination URL<input value={url} onChange={changeUrl} required type="url" /></label>
            <label>Shortcut image URL <span>(optional)</span><input value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} type="url" placeholder="https://example.com/icon.png" /></label>
            <p className="field-help">Paste a direct image URL, or a webpage URL to use that page’s icon. This overrides retrieval from the destination URL.</p>
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
