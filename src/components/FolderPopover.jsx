import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUpRight, FolderOpen, Pencil, Plus, X } from 'lucide-react'
import { clampPlacement, collides, placementStyle, pointToLogical } from '../lib/canvas.js'

export function FolderPopover({ folder, children, placements, profile, editMode, openInNewTab, labelOpensInline, onClose, onEdit, onMove, onMoveOut, onOpenInline, onCreate, onBlankContextMenu, onItemContextMenu }) {
  const canvasRef = useRef(null)
  const dragRef = useRef(null)
  const [preview, setPreview] = useState(null)
  if (!folder) return null
  const childPlacements = placements.filter((value) => value.containerKey === folder.id && value.profile === profile)
  const logicalPoint = (event) => pointToLogical(event.clientX, event.clientY, canvasRef.current.getBoundingClientRect(), profile)

  const beginDrag = (event, child, value) => {
    if (!editMode || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const bounds = canvasRef.current.getBoundingClientRect()
    dragRef.current = { child, value, pointerId: event.pointerId, start: pointToLogical(event.clientX, event.clientY, bounds, profile), bounds, moved: false }
    setPreview({ itemId: child.id, value, invalid: false })
  }

  const moveDrag = (event) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const point = pointToLogical(event.clientX, event.clientY, drag.bounds, profile)
    const candidate = clampPlacement({ ...drag.value, x: drag.value.x + point.x - drag.start.x, y: drag.value.y + point.y - drag.start.y }, profile)
    const invalid = collides(candidate, childPlacements, drag.child.id)
    dragRef.current = { ...drag, candidate, invalid, moved: drag.moved || Math.hypot(point.x - drag.start.x, point.y - drag.start.y) > 4 }
    setPreview({ itemId: drag.child.id, value: candidate, invalid })
  }

  const endDrag = async (event) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    setPreview(null)
    if (!drag.moved) return
    const outside = event.clientX < drag.bounds.left || event.clientX > drag.bounds.right || event.clientY < drag.bounds.top || event.clientY > drag.bounds.bottom
    if (outside) return onMoveOut(drag.child)
    if (!drag.invalid) await onMove(drag.child, drag.candidate)
  }

  return createPortal(
    <div className="folder-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="folder-popover" role="dialog" aria-modal="true" aria-label={folder.title}>
        <header><FolderOpen /><h2>{folder.title}</h2><button type="button" onClick={() => onCreate(null)}><Plus /> Add shortcut</button>{editMode && <button type="button" onClick={() => onEdit(folder)}>Edit folder</button>}<button type="button" onClick={onClose} aria-label="Close"><X /></button></header>
        <div
          ref={canvasRef}
          className="folder-canvas"
          onDoubleClick={(event) => !event.target.closest('.folder-child, button') && onCreate(logicalPoint(event))}
          onContextMenu={(event) => {
            if (event.target.closest('.folder-child')) return
            event.preventDefault()
            onBlankContextMenu({ x: event.clientX, y: event.clientY, point: logicalPoint(event), folder })
          }}
        >
          {children.map((child) => {
            const childPlacement = childPlacements.find((value) => value.itemId === child.id)
            if (!childPlacement) return null
            const current = preview?.itemId === child.id ? preview.value : childPlacement
            return (
              <div
                key={child.id}
                className={`folder-child ${preview?.itemId === child.id ? 'dragging' : ''} ${preview?.itemId === child.id && preview.invalid ? 'invalid' : ''}`}
                style={placementStyle(current, profile)}
                role="link"
                tabIndex={0}
                aria-label={child.title}
                onContextMenu={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  onItemContextMenu({ x: event.clientX, y: event.clientY, item: child, folder })
                }}
                onPointerDown={(event) => beginDrag(event, child, childPlacement)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onClick={() => !editMode && window.open(child.url, openInNewTab ? '_blank' : '_self')}
                onKeyDown={(event) => {
                  if (event.target.closest('.shortcut-inline-label')) return
                  if (event.key === 'Enter') editMode ? onEdit(child) : window.open(child.url, openInNewTab ? '_blank' : '_self')
                }}
              >
                <ShortcutIcon item={child} />
                {labelOpensInline
                  ? <button
                      type="button"
                      className="folder-child-name shortcut-inline-label"
                      title={`Open ${child.title} inline`}
                      aria-label={`Open ${child.title} inline`}
                      onPointerDown={(event) => { if (!editMode) event.stopPropagation() }}
                      onKeyDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        if (editMode) return
                        event.preventDefault()
                        event.stopPropagation()
                        onOpenInline(child)
                      }}
                    >{child.title}</button>
                  : <span className="folder-child-name">{child.title}</span>}
                {editMode && <div className="folder-child-actions"><button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => onEdit(child)} aria-label={`Edit ${child.title}`}><Pencil /></button><button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => onMoveOut(child)} aria-label={`Move ${child.title} out of folder`}><ArrowUpRight /></button></div>}
              </div>
            )
          })}
          {!children.length && <p className="empty-folder">This folder is empty.</p>}
        </div>
      </section>
    </div>,
    document.body,
  )
}

export function ShortcutIcon({ item }) {
  const sources = [...new Set([
    item.iconOverrideUrl || null,
    item.iconAssetId ? `/api/assets/${item.iconAssetId}` : null,
    item.faviconUrl || null,
  ].filter(Boolean))]
  const [failedSources, setFailedSources] = useState(() => new Set())
  useEffect(() => setFailedSources(new Set()), [item.faviconUrl, item.iconAssetId, item.iconOverrideUrl])
  const source = sources.find((candidate) => !failedSources.has(candidate))
  if (source) {
    return <img src={source} alt="" draggable="false" loading="eager" referrerPolicy="no-referrer" onError={() => setFailedSources((current) => new Set([...current, source]))} />
  }
  const letter = (item.title || '?').trim().charAt(0).toUpperCase()
  return <span className="generated-icon" aria-hidden="true">{letter}</span>
}
