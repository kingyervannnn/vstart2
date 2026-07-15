import { useRef, useState } from 'react'
import { Folder, Pencil, Plus } from 'lucide-react'
import { clampPlacement, collides, placementStyle, pointToLogical } from '../lib/canvas.js'
import { ShortcutIcon } from './FolderPopover.jsx'

export function DialCanvas({
  workspace,
  items,
  placements,
  profile,
  editMode,
  alwaysShowNames,
  showFolderLabels,
  labelOpensInline,
  openInNewTab,
  onCreateAt,
  onMove,
  onDropOnItem,
  onOpenFolder,
  onOpenInline,
  onEdit,
  onBlankContextMenu,
  onItemContextMenu,
}) {
  const canvasRef = useRef(null)
  const dragRef = useRef(null)
  const [preview, setPreview] = useState(null)
  const rootItems = items.filter((item) => item.workspaceId === workspace.id && !item.parentFolderId)
  const rootPlacements = placements.filter((value) => value.workspaceId === workspace.id && value.containerKey === 'root' && value.profile === profile)
  const placementByItem = new Map(rootPlacements.map((value) => [value.itemId, value]))
  const childrenByFolder = new Map()
  for (const item of items) {
    if (!item.parentFolderId) continue
    const children = childrenByFolder.get(item.parentFolderId) || []
    children.push(item)
    childrenByFolder.set(item.parentFolderId, children)
  }

  const logicalPoint = (event) => pointToLogical(event.clientX, event.clientY, canvasRef.current.getBoundingClientRect(), profile)

  const beginDrag = (event, item, value) => {
    if (!editMode || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const point = logicalPoint(event)
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { item, value, start: point, pointerId: event.pointerId, moved: false, candidate: value, target: null, invalid: false }
    setPreview({ itemId: item.id, value, targetId: null, invalid: false })
  }

  const moveDrag = (event) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const point = logicalPoint(event)
    const candidate = clampPlacement({
      ...drag.value,
      x: drag.value.x + point.x - drag.start.x,
      y: drag.value.y + point.y - drag.start.y,
    }, profile)
    const target = rootPlacements.find((value) => value.itemId !== drag.item.id &&
      point.x >= value.x && point.x <= value.x + value.width &&
      point.y >= value.y && point.y <= value.y + value.height)
    const invalid = !target && collides(candidate, rootPlacements, drag.item.id)
    dragRef.current = { ...drag, moved: drag.moved || Math.hypot(point.x - drag.start.x, point.y - drag.start.y) > 4, candidate, target, invalid }
    setPreview({ itemId: drag.item.id, value: candidate, targetId: target?.itemId || null, invalid })
  }

  const endDrag = async (event) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    setPreview(null)
    if (!drag.moved) return
    if (drag.target) {
      const targetItem = rootItems.find((item) => item.id === drag.target.itemId)
      if (targetItem) await onDropOnItem(drag.item, targetItem)
      return
    }
    if (!drag.invalid) await onMove(drag.item, drag.candidate)
  }

  const handleKeyboardMove = async (event, item, value) => {
    if (!editMode || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    const amount = event.shiftKey ? 1 : 10
    const next = clampPlacement({
      ...value,
      x: value.x + (event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0),
      y: value.y + (event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0),
    }, profile)
    if (!collides(next, rootPlacements, item.id)) await onMove(item, next)
  }

  const handleDoubleClick = (event) => {
    if (event.target.closest('.shortcut-tile, .add-shortcut-button')) return
    onCreateAt(logicalPoint(event))
  }

  const handleContextMenu = (event) => {
    if (event.target.closest('.shortcut-tile')) return
    event.preventDefault()
    onBlankContextMenu({ x: event.clientX, y: event.clientY, point: logicalPoint(event) })
  }

  return (
    <section ref={canvasRef} className={`dial-canvas ${alwaysShowNames ? 'labels-always' : 'labels-hover'}`} onDoubleClick={handleDoubleClick} onContextMenu={handleContextMenu} aria-label={`${workspace.name} speed dial`}>
      {editMode && (
        <button className="add-shortcut-button" type="button" onClick={() => onCreateAt(null)}>
          <Plus size={17} /> Add shortcut
        </button>
      )}
      {rootItems.map((item) => {
        const stored = placementByItem.get(item.id)
        if (!stored) return null
        const current = preview?.itemId === item.id ? preview.value : stored
        const target = preview?.targetId === item.id
        return (
          <div
            key={item.id}
            className={`shortcut-tile ${item.kind} ${preview?.itemId === item.id ? 'dragging' : ''} ${preview?.itemId === item.id && preview.invalid ? 'invalid' : ''} ${target ? 'drop-target' : ''}`}
            style={placementStyle(current, profile)}
            role="link"
            tabIndex={0}
            aria-label={item.title}
            onContextMenu={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onItemContextMenu({ x: event.clientX, y: event.clientY, item })
            }}
            onPointerDown={(event) => beginDrag(event, item, stored)}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !editMode) item.kind === 'folder' ? onOpenFolder(item) : window.open(item.url, openInNewTab ? '_blank' : '_self')
              if (event.key === 'Enter' && editMode) onEdit(item)
              handleKeyboardMove(event, item, stored)
            }}
            onClick={(event) => {
              if (editMode || dragRef.current) return
              if (item.kind === 'folder') onOpenFolder(item)
              else window.open(item.url, openInNewTab ? '_blank' : '_self')
              event.preventDefault()
            }}
          >
            <div className={`shortcut-icon-shell ${item.kind === 'folder' ? 'folder-preview-shell' : ''}`}>
              {item.kind === 'folder'
                ? <FolderPreview children={childrenByFolder.get(item.id) || []} />
                : <ShortcutIcon item={item} />}
            </div>
            {(item.kind !== 'folder' || showFolderLabels) && (item.kind === 'shortcut' && labelOpensInline
              ? <button
                  type="button"
                  className="shortcut-name shortcut-inline-label"
                  title={`Open ${item.title} inline`}
                  aria-label={`Open ${item.title} inline`}
                  onPointerDown={(event) => { if (!editMode) event.stopPropagation() }}
                  onKeyDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    if (editMode) return
                    event.preventDefault()
                    event.stopPropagation()
                    onOpenInline(item)
                  }}
                >{item.title}</button>
              : <span className="shortcut-name">{item.title}</span>)}
            {editMode && <button className="tile-edit" type="button" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onEdit(item) }} aria-label={`Edit ${item.title}`}><Pencil size={12} /></button>}
          </div>
        )
      })}
      {!rootItems.length && !editMode && <div className="empty-dial"><p>No shortcuts yet.</p><small>Double-click anywhere or right-click to create one.</small></div>}
    </section>
  )
}

function FolderPreview({ children }) {
  if (!children.length) return <Folder className="empty-folder-glyph" />
  const visible = children.slice(0, 9)
  return (
    <span className={`folder-preview ${visible.length <= 4 ? 'two-column' : 'three-column'}`} aria-hidden="true">
      {visible.map((child) => <span className="folder-preview-cell" key={child.id}><ShortcutIcon item={child} /></span>)}
    </span>
  )
}
