import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUpRight, FolderOpen, Pencil, Plus, X } from 'lucide-react'
import { clampPlacement, collides, nearestOpenPlacement, placementStyle, pointToLogical } from '../lib/canvas.js'
import { folderPopoverPosition } from '../lib/folderPopover.js'

const DRAG_START_THRESHOLD = 7
const CLICK_SUPPRESSION_MS = 420

export function FolderPopover({ folder, children, placements, profile, anchorRect, editMode, openInNewTab, labelOpensInline, spotlightItemId, onClose, onEdit, onMove, onMoveOut, onOpenInline, onCreate, onBlankContextMenu, onItemContextMenu }) {
  const folderIdentity = folder?.id
  const canvasRef = useRef(null)
  const popoverRef = useRef(null)
  const dragRef = useRef(null)
  const suppressedClickRef = useRef(null)
  const closeTimerRef = useRef(null)
  const openFrameRef = useRef(null)
  const revealFrameRef = useRef(null)
  const [preview, setPreview] = useState(null)
  const [widePosition, setWidePosition] = useState(null)
  const [entered, setEntered] = useState(false)
  const [closing, setClosing] = useState(false)

  useEffect(() => () => {
    window.clearTimeout(closeTimerRef.current)
    window.cancelAnimationFrame(openFrameRef.current)
    window.cancelAnimationFrame(revealFrameRef.current)
  }, [])

  useLayoutEffect(() => {
    setEntered(false)
    setClosing(false)
    window.cancelAnimationFrame(openFrameRef.current)
    window.cancelAnimationFrame(revealFrameRef.current)
    if (!folderIdentity) return undefined
    openFrameRef.current = window.requestAnimationFrame(() => {
      revealFrameRef.current = window.requestAnimationFrame(() => setEntered(true))
    })
    return () => {
      window.cancelAnimationFrame(openFrameRef.current)
      window.cancelAnimationFrame(revealFrameRef.current)
    }
  }, [folderIdentity])

  useLayoutEffect(() => {
    if (!folder || profile === 'compact') {
      setWidePosition(null)
      return undefined
    }
    const update = () => {
      const popover = popoverRef.current?.getBoundingClientRect()
      const tile = [...document.querySelectorAll('[data-shortcut-item-id]')].find((node) => node.dataset.shortcutItemId === folder.id)
      const anchor = anchorRect || tile?.getBoundingClientRect()
      if (!popover || !anchor) return setWidePosition(null)
      const viewport = {
        width: window.visualViewport?.width || document.documentElement.clientWidth,
        height: window.visualViewport?.height || document.documentElement.clientHeight,
      }
      const position = folderPopoverPosition(anchor, viewport, popover)
      setWidePosition({
        ...position,
        '--folder-origin-x': `${Math.max(0, Math.min(popover.width, anchor.left + anchor.width / 2 - position.left))}px`,
        '--folder-origin-y': `${Math.max(0, Math.min(popover.height, anchor.top + anchor.height / 2 - position.top))}px`,
      })
    }
    update()
    window.addEventListener('resize', update)
    window.visualViewport?.addEventListener('resize', update)
    return () => {
      window.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('resize', update)
    }
  }, [anchorRect, folder, profile])

  if (!folder) return null
  const childPlacements = placements.filter((value) => value.containerKey === folder.id && value.profile === profile)
  const logicalPoint = (event) => pointToLogical(event.clientX, event.clientY, canvasRef.current.getBoundingClientRect(), profile)
  const requestClose = (afterClose = onClose) => {
    if (closing) return
    setClosing(true)
    setEntered(false)
    closeTimerRef.current = window.setTimeout(afterClose, 230)
  }
  const editFolder = () => requestClose(() => onEdit(folder))

  const beginDrag = (event, child, value) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const bounds = canvasRef.current.getBoundingClientRect()
    dragRef.current = { child, value, pointerId: event.pointerId, start: pointToLogical(event.clientX, event.clientY, bounds, profile), bounds, moved: false }
  }

  const moveDrag = (event) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const point = pointToLogical(event.clientX, event.clientY, drag.bounds, profile)
    const candidate = clampPlacement({ ...drag.value, x: drag.value.x + point.x - drag.start.x, y: drag.value.y + point.y - drag.start.y }, profile)
    const invalid = collides(candidate, childPlacements, drag.child.id)
    const resolved = invalid ? nearestOpenPlacement(candidate, childPlacements, profile, drag.child.id) : candidate
    const moved = drag.moved || Math.hypot(point.x - drag.start.x, point.y - drag.start.y) > DRAG_START_THRESHOLD
    dragRef.current = { ...drag, candidate, resolved, invalid, moved }
    if (moved) setPreview({ itemId: drag.child.id, value: resolved || candidate, invalid })
  }

  const endDrag = async (event) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    setPreview(null)
    if (!drag.moved) return
    suppressedClickRef.current = { itemId: drag.child.id, until: Date.now() + CLICK_SUPPRESSION_MS }
    const outside = event.clientX < drag.bounds.left || event.clientX > drag.bounds.right || event.clientY < drag.bounds.top || event.clientY > drag.bounds.bottom
    if (outside) return onMoveOut(drag.child)
    if (drag.resolved) await onMove(drag.child, drag.resolved)
  }

  const cancelDrag = () => {
    dragRef.current = null
    setPreview(null)
  }

  const consumeSuppressedClick = (itemId) => {
    const suppressed = suppressedClickRef.current
    if (!suppressed || suppressed.itemId !== itemId || suppressed.until < Date.now()) return false
    suppressedClickRef.current = null
    return true
  }

  return createPortal(
    <div className={`folder-backdrop ${entered ? 'open' : ''} ${closing ? 'closing' : ''} ${profile === 'compact' ? 'folder-backdrop-centered' : 'folder-backdrop-anchored'}`} onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
      <section ref={popoverRef} className={`folder-popover ${entered ? 'open' : ''} ${closing ? 'closing' : ''}`} style={widePosition || undefined} role="dialog" aria-modal="true" aria-label={folder.title}>
        <header onDoubleClick={(event) => !event.target.closest('button') && editFolder()}><FolderOpen /><button type="button" className="folder-title-edit" onClick={editFolder} aria-label={`Rename ${folder.title}`} title="Rename folder">{folder.title}</button><button type="button" className="folder-add-shortcut" onClick={() => requestClose(() => onCreate(null))} aria-label="Add shortcut" title="Add shortcut"><Plus /></button>{editMode && <button type="button" onClick={editFolder}>Edit folder</button>}<button type="button" onClick={() => requestClose()} aria-label="Close"><X /></button></header>
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
                className={`folder-child ${preview?.itemId === child.id ? 'dragging' : ''} ${preview?.itemId === child.id && preview.invalid ? 'invalid' : ''} ${spotlightItemId === child.id ? 'shortcut-spotlight' : ''}`}
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
                onPointerCancel={cancelDrag}
                onClick={(event) => {
                  if (consumeSuppressedClick(child.id)) {
                    event.preventDefault()
                    event.stopPropagation()
                    return
                  }
                  if (!editMode) window.open(child.url, openInNewTab ? '_blank' : '_self')
                }}
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
                      onPointerDown={(event) => event.stopPropagation()}
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
